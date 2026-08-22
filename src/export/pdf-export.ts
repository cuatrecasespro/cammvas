import type { Canvas, CanvasEdge, CanvasNode, CanvasNodeFileData, NodeSide } from "../types/canvas-internal";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const NODE_COLORS: Record<string, string> = {
	"1": "#e75545",
	"2": "#e9973f",
	"3": "#e0de71",
	"4": "#44cf6e",
	"5": "#53aaf5",
	"6": "#a882f7",
};

const PADDING = 48;
const A4_PORTRAIT = { width: 595.28, height: 841.89 };
const A3_PORTRAIT = { width: 841.89, height: 1190.55 };
const PDF_MARGIN = 36;

interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export type ImageDataResolver = (path: string) => Promise<Uint8Array | null>;
export type PdfPageSize = "a4" | "a3" | "full";

export interface PdfPageLayout {
	pageWidth: number;
	pageHeight: number;
	orientation: "portrait" | "landscape";
	scale: number;
	x: number;
	y: number;
}

/** Fit any exported canvas bounds to one A4 page with automatic orientation. */
export function getPdfPageLayout(
	contentWidth: number,
	contentHeight: number,
	pageSize: PdfPageSize = "a4"
): PdfPageLayout {
	if (pageSize === "full") {
		const scale = 0.75;
		const pageWidth = contentWidth * scale;
		const pageHeight = contentHeight * scale;
		return {
			pageWidth,
			pageHeight,
			orientation: pageWidth > pageHeight ? "landscape" : "portrait",
			scale,
			x: 0,
			y: 0,
		};
	}
	const paper = pageSize === "a3" ? A3_PORTRAIT : A4_PORTRAIT;
	const landscape = contentWidth > contentHeight;
	const pageWidth = landscape ? paper.height : paper.width;
	const pageHeight = landscape ? paper.width : paper.height;
	const scale = Math.min(
		(pageWidth - PDF_MARGIN * 2) / contentWidth,
		(pageHeight - PDF_MARGIN * 2) / contentHeight
	);
	return {
		pageWidth,
		pageHeight,
		orientation: landscape ? "landscape" : "portrait",
		scale,
		x: (pageWidth - contentWidth * scale) / 2,
		y: (pageHeight - contentHeight * scale) / 2,
	};
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function nodeText(node: CanvasNode): string {
	const text = node.text?.trim() || node.labelEl?.textContent?.trim() || "Untitled node";
	return text.replace(/\s+/g, " ");
}

function getNodeTypes(canvas: Canvas): Map<string, CanvasNodeFileData["type"]> {
	return new Map(canvas.getData().nodes.map((node) => [node.id, node.type]));
}

function nodeType(node: CanvasNode, nodeTypes: Map<string, CanvasNodeFileData["type"]>): CanvasNodeFileData["type"] {
	return nodeTypes.get(node.id) ?? node.type;
}

function nodeColor(color: string): string {
	return NODE_COLORS[color] ?? (color.startsWith("#") ? color : "#7f8c9a");
}

function anchor(node: CanvasNode, side: NodeSide): { x: number; y: number } {
	switch (side) {
		case "top": return { x: node.x + node.width / 2, y: node.y };
		case "bottom": return { x: node.x + node.width / 2, y: node.y + node.height };
		case "left": return { x: node.x, y: node.y + node.height / 2 };
		case "right": return { x: node.x + node.width, y: node.y + node.height / 2 };
	}
}

function controlPoint(point: { x: number; y: number }, side: NodeSide, distance: number): { x: number; y: number } {
	switch (side) {
		case "top": return { x: point.x, y: point.y - distance };
		case "bottom": return { x: point.x, y: point.y + distance };
		case "left": return { x: point.x - distance, y: point.y };
		case "right": return { x: point.x + distance, y: point.y };
	}
}

function edgePath(edge: CanvasEdge): string {
	const from = anchor(edge.from.node, edge.from.side);
	const to = anchor(edge.to.node, edge.to.side);
	const distance = Math.max(40, Math.abs(to.x - from.x) * 0.45, Math.abs(to.y - from.y) * 0.2);
	const cp1 = controlPoint(from, edge.from.side, distance);
	const cp2 = controlPoint(to, edge.to.side, distance);
	return `M ${from.x} ${from.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${to.x} ${to.y}`;
}

function canvasBounds(nodes: Iterable<CanvasNode>): Bounds | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const node of nodes) {
		minX = Math.min(minX, node.x);
		minY = Math.min(minY, node.y);
		maxX = Math.max(maxX, node.x + node.width);
		maxY = Math.max(maxY, node.y + node.height);
	}
	return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function imageMimeType(path: string): string | null {
	const extension = path.split(".").pop()?.toLowerCase();
	if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
	if (extension === "png") return "image/png";
	if (extension === "webp") return "image/webp";
	if (extension === "gif") return "image/gif";
	if (extension === "svg") return "image/svg+xml";
	if (extension === "bmp") return "image/bmp";
	if (extension === "avif") return "image/avif";
	return null;
}

function toPdfColor(color: string): ReturnType<typeof rgb> {
	const hex = nodeColor(color).slice(1);
	return rgb(
		parseInt(hex.slice(0, 2), 16) / 255,
		parseInt(hex.slice(2, 4), 16) / 255,
		parseInt(hex.slice(4, 6), 16) / 255
	);
}

function toPdfPoint(
	pageHeight: number,
	layout: PdfPageLayout,
	bounds: Bounds,
	x: number,
	y: number
): { x: number; y: number } {
	return {
		x: layout.x + (x - bounds.minX + PADDING) * layout.scale,
		y: pageHeight - layout.y - (y - bounds.minY + PADDING) * layout.scale,
	};
}

/** pdf-lib flips SVG paths vertically, unlike its rectangle and text APIs. */
function toPdfSvgPoint(
	pageHeight: number,
	layout: PdfPageLayout,
	bounds: Bounds,
	x: number,
	y: number
): { x: number; y: number } {
	const point = toPdfPoint(pageHeight, layout, bounds, x, y);
	return { x: point.x, y: -point.y };
}

function pdfEdgePath(edge: CanvasEdge, pageHeight: number, layout: PdfPageLayout, bounds: Bounds): string {
	const from = anchor(edge.from.node, edge.from.side);
	const to = anchor(edge.to.node, edge.to.side);
	const distance = Math.max(40, Math.abs(to.x - from.x) * 0.45, Math.abs(to.y - from.y) * 0.2);
	const cp1 = controlPoint(from, edge.from.side, distance);
	const cp2 = controlPoint(to, edge.to.side, distance);
	const start = toPdfSvgPoint(pageHeight, layout, bounds, from.x, from.y);
	const firstControl = toPdfSvgPoint(pageHeight, layout, bounds, cp1.x, cp1.y);
	const secondControl = toPdfSvgPoint(pageHeight, layout, bounds, cp2.x, cp2.y);
	const end = toPdfSvgPoint(pageHeight, layout, bounds, to.x, to.y);
	return `M ${start.x} ${start.y} C ${firstControl.x} ${firstControl.y}, ${secondControl.x} ${secondControl.y}, ${end.x} ${end.y}`;
}

function arrowPath(
	edge: CanvasEdge,
	end: "from" | "to",
	pageHeight: number,
	layout: PdfPageLayout,
	bounds: Bounds
): string {
	const endpoint = edge[end];
	const point = anchor(endpoint.node, endpoint.side);
	const other = edge[end === "from" ? "to" : "from"].node;
	const distance = Math.max(40, Math.abs(point.x - other.x) * 0.45, Math.abs(point.y - other.y) * 0.2);
	const control = controlPoint(point, endpoint.side, distance);
	const tip = toPdfSvgPoint(pageHeight, layout, bounds, point.x, point.y);
	const tail = toPdfSvgPoint(pageHeight, layout, bounds, control.x, control.y);
	const dx = tip.x - tail.x;
	const dy = tip.y - tail.y;
	const length = Math.hypot(dx, dy) || 1;
	const size = 8 * layout.scale;
	const baseX = tip.x - (dx / length) * size;
	const baseY = tip.y - (dy / length) * size;
	const perpendicularX = (-dy / length) * size * 0.55;
	const perpendicularY = (dx / length) * size * 0.55;
	return `M ${tip.x} ${tip.y} L ${baseX + perpendicularX} ${baseY + perpendicularY} L ${baseX - perpendicularX} ${baseY - perpendicularY} Z`;
}

async function rasterizeImageToPng(data: Uint8Array, mimeType: string): Promise<Uint8Array | null> {
	const blob = new Blob([data], { type: mimeType });
	const url = URL.createObjectURL(blob);
	try {
		const image = await new Promise<HTMLImageElement>((resolve, reject) => {
			const element = new Image();
			element.onload = () => resolve(element);
			element.onerror = () => reject(new Error("Unable to decode image"));
			element.src = url;
		});
		const canvas = createEl("canvas");
		canvas.width = image.naturalWidth;
		canvas.height = image.naturalHeight;
		canvas.getContext("2d")?.drawImage(image, 0, 0);
		const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
		return png ? new Uint8Array(await png.arrayBuffer()) : null;
	} finally {
		URL.revokeObjectURL(url);
	}
}

function textLines(text: string, width: number): string[] {
	const maxChars = Math.max(12, Math.floor(width / 8));
	const words = text.split(" ");
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		const next = line ? `${line} ${word}` : word;
		if (line && next.length > maxChars) {
			lines.push(line);
			line = word;
		} else {
			line = next;
		}
	}
	if (line) lines.push(line);
	return lines.slice(0, 8);
}

/** Build a self-contained SVG that remains vector-sharp when printed to PDF. */
export function createMindmapSvg(canvas: Canvas): string | null {
	const nodes = Array.from(canvas.nodes.values());
	const nodeTypes = getNodeTypes(canvas);
	const bounds = canvasBounds(nodes);
	if (!bounds) return null;

	const width = bounds.maxX - bounds.minX + PADDING * 2;
	const height = bounds.maxY - bounds.minY + PADDING * 2;
	const viewBox = `${bounds.minX - PADDING} ${bounds.minY - PADDING} ${width} ${height}`;
	const edges = Array.from(canvas.edges.values()).filter((edge) =>
		nodes.includes(edge.from.node) && nodes.includes(edge.to.node)
	);
	const edgeMarkup = edges.map((edge) => {
		const stroke = nodeColor(edge.color || edge.from.node.color);
		const label = edge.label?.trim();
		const from = anchor(edge.from.node, edge.from.side);
		const to = anchor(edge.to.node, edge.to.side);
		const labelMarkup = label
			? `<text x="${(from.x + to.x) / 2}" y="${(from.y + to.y) / 2 - 6}" class="edge-label">${escapeXml(label)}</text>`
			: "";
		return `<path d="${edgePath(edge)}" class="edge" stroke="${stroke}"${edge.from.end === "arrow" ? " marker-start=\"url(#arrow)\"" : ""}${edge.to.end === "arrow" ? " marker-end=\"url(#arrow)\"" : ""}/>${labelMarkup}`;
	}).join("");
	const groupMarkup = nodes.filter((node) => nodeType(node, nodeTypes) === "group").map((node) => {
		const color = nodeColor(node.color);
		return `<g><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" class="group" stroke="${color}"/><text x="${node.x + 14}" y="${node.y + 22}" class="group-label">${escapeXml(nodeText(node))}</text></g>`;
	}).join("");
	const nodeMarkup = nodes.filter((node) => nodeType(node, nodeTypes) !== "group").map((node) => {
		const color = nodeColor(node.color);
		const lines = textLines(nodeText(node), node.width - 28);
		const lineHeight = 18;
		const startY = node.y + node.height / 2 - ((lines.length - 1) * lineHeight) / 2 + 6;
		const labels = lines.map((line, index) =>
			`<text x="${node.x + 14}" y="${startY + index * lineHeight}" class="node-label">${escapeXml(line)}</text>`
		).join("");
		return `<g><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" class="node" stroke="${color}"/>${labels}</g>`;
	}).join("");

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}" role="img" aria-label="Mind map export"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker><style>.edge{fill:none;stroke-width:2.5}.edge-label{font:14px sans-serif;fill:#4b5563;text-anchor:middle;paint-order:stroke;stroke:#fff;stroke-width:5px;stroke-linejoin:round}.group{fill:#f8fafc;fill-opacity:.5;stroke-width:2;stroke-dasharray:6 4}.group-label{font:14px sans-serif;fill:#4b5563}.node{fill:#fff;stroke-width:3}.node-label{font:15px sans-serif;fill:#1f2937}</style></defs><rect x="${bounds.minX - PADDING}" y="${bounds.minY - PADDING}" width="${width}" height="${height}" fill="#fff"/>${groupMarkup}${edgeMarkup}${nodeMarkup}</svg>`;
}

/** Create a vector PDF and embed every browser-decodable Canvas image file node. */
export async function createMindmapPdf(
	canvas: Canvas,
	title: string,
	resolveImage: ImageDataResolver,
	pageSize: PdfPageSize = "a4"
): Promise<ArrayBuffer | null> {
	const nodes = Array.from(canvas.nodes.values());
	const nodeData = canvas.getData().nodes;
	const nodeTypes = new Map(nodeData.map((node) => [node.id, node.type]));
	const bounds = canvasBounds(nodes);
	if (!bounds) return null;

	const width = bounds.maxX - bounds.minX + PADDING * 2;
	const height = bounds.maxY - bounds.minY + PADDING * 2;
	const layout = getPdfPageLayout(width, height, pageSize);
	const pdf = await PDFDocument.create();
	pdf.setTitle(title);
	const page = pdf.addPage([layout.pageWidth, layout.pageHeight]);
	const font = await pdf.embedFont(StandardFonts.Helvetica);
	const pageHeight = layout.pageHeight;

	for (const node of nodes) {
		if (nodeType(node, nodeTypes) !== "group") continue;
		const topLeft = toPdfPoint(pageHeight, layout, bounds, node.x, node.y);
		const nodeWidth = node.width * layout.scale;
		const nodeHeight = node.height * layout.scale;
		page.drawRectangle({
			x: topLeft.x,
			y: topLeft.y - nodeHeight,
			width: nodeWidth,
			height: nodeHeight,
			borderColor: toPdfColor(node.color),
			borderWidth: 2 * layout.scale,
			opacity: 0.08,
		});
		page.drawText(nodeText(node).replace(/[^\x20-\xFF]/g, "?"), {
			x: topLeft.x + 14 * layout.scale,
			y: topLeft.y - 22 * layout.scale,
			size: 14 * layout.scale,
			font,
			color: rgb(0.29, 0.33, 0.39),
		});
	}

	for (const edge of canvas.edges.values()) {
		if (!nodes.includes(edge.from.node) || !nodes.includes(edge.to.node)) continue;
		const color = toPdfColor(edge.color || edge.from.node.color);
		page.drawSvgPath(pdfEdgePath(edge, pageHeight, layout, bounds), {
			borderColor: color,
			borderWidth: 2.5 * layout.scale,
		});
		if (edge.from.end === "arrow") page.drawSvgPath(arrowPath(edge, "from", pageHeight, layout, bounds), { color });
		if (edge.to.end === "arrow") page.drawSvgPath(arrowPath(edge, "to", pageHeight, layout, bounds), { color });
		if (edge.label?.trim()) {
			const from = anchor(edge.from.node, edge.from.side);
			const to = anchor(edge.to.node, edge.to.side);
			const point = toPdfPoint(pageHeight, layout, bounds, (from.x + to.x) / 2, (from.y + to.y) / 2 - 6);
			const label = edge.label.trim().replace(/[^\x20-\xFF]/g, "?");
			const fontSize = 14 * layout.scale;
			page.drawText(label, {
				x: point.x - font.widthOfTextAtSize(label, fontSize) / 2,
				y: point.y,
				size: fontSize,
				font,
				color: rgb(0.29, 0.33, 0.39),
			});
		}
	}

	for (const node of nodes) {
		if (nodeType(node, nodeTypes) === "group") continue;
		const topLeft = toPdfPoint(pageHeight, layout, bounds, node.x, node.y);
		const nodeWidth = node.width * layout.scale;
		const nodeHeight = node.height * layout.scale;
		page.drawRectangle({
			x: topLeft.x,
			y: topLeft.y - nodeHeight,
			width: nodeWidth,
			height: nodeHeight,
			borderColor: toPdfColor(node.color),
			borderWidth: 3 * layout.scale,
			color: rgb(1, 1, 1),
		});
		if (nodeType(node, nodeTypes) === "file") continue;
		const lines = textLines(nodeText(node), node.width - 28);
		const lineHeight = 18 * layout.scale;
		const startY = topLeft.y - nodeHeight / 2 + ((lines.length - 1) * lineHeight) / 2 - 6 * layout.scale;
		for (let index = 0; index < lines.length; index++) {
			page.drawText(lines[index].replace(/[^\x20-\xFF]/g, "?"), {
				x: topLeft.x + 14 * layout.scale,
				y: startY - index * lineHeight,
				size: 15 * layout.scale,
				font,
				color: rgb(0.12, 0.15, 0.18),
			});
		}
	}

	const filePaths = new Map(nodeData.map((node) => [node.id, node.file]));
	for (const node of nodes) {
		if (nodeType(node, nodeTypes) !== "file") continue;
		const path = filePaths.get(node.id);
		if (!path) continue;
		const mimeType = imageMimeType(path);
		if (!mimeType) continue;
		const data = await resolveImage(path);
		if (!data) continue;
		try {
			const imageData = mimeType === "image/png" || mimeType === "image/jpeg"
				? data
				: await rasterizeImageToPng(data, mimeType);
			if (!imageData) continue;
			const image = mimeType === "image/jpeg"
				? await pdf.embedJpg(imageData)
				: await pdf.embedPng(imageData);
			const imageRatio = image.width / image.height;
			const nodeRatio = node.width / node.height;
			const inset = 6;
			const imageWidth = nodeRatio > imageRatio
				? (node.height - inset * 2) * imageRatio
				: node.width - inset * 2;
			const imageHeight = nodeRatio > imageRatio
				? node.height - inset * 2
				: (node.width - inset * 2) / imageRatio;
			const x = node.x - bounds.minX + PADDING + (node.width - imageWidth) / 2;
			const y = node.y - bounds.minY + PADDING + (node.height - imageHeight) / 2;
			page.drawImage(image, {
				x: layout.x + x * layout.scale,
				y: pageHeight - layout.y - y * layout.scale - imageHeight * layout.scale,
				width: imageWidth * layout.scale,
				height: imageHeight * layout.scale,
			});
		} catch {
			// Unsupported or corrupt image: leave the vector node placeholder intact.
		}
	}

	const bytes = await pdf.save();
	const copy = new Uint8Array(bytes.length);
	copy.set(bytes);
	return copy.buffer;
}
