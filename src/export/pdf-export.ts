import type { Canvas, CanvasEdge, CanvasNode, NodeSide } from "../types/canvas-internal";
import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";

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
		return { pageWidth: contentWidth * scale, pageHeight: contentHeight * scale, scale, x: 0, y: 0 };
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

function imageFormat(path: string): string | null {
	const extension = path.split(".").pop()?.toUpperCase();
	if (extension === "JPG" || extension === "JPEG") return "JPEG";
	if (extension === "PNG" || extension === "WEBP") return extension;
	return null;
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
	const nodes = Array.from(canvas.nodes.values()).filter((node) => node.type !== "group");
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
		return `<path d="${edgePath(edge)}" class="edge" stroke="${stroke}"${edge.to.end === "arrow" ? " marker-end=\"url(#arrow)\"" : ""}/>${labelMarkup}`;
	}).join("");
	const nodeMarkup = nodes.map((node) => {
		const color = nodeColor(node.color);
		const lines = textLines(nodeText(node), node.width - 28);
		const lineHeight = 18;
		const startY = node.y + node.height / 2 - ((lines.length - 1) * lineHeight) / 2 + 6;
		const labels = lines.map((line, index) =>
			`<text x="${node.x + 14}" y="${startY + index * lineHeight}" class="node-label">${escapeXml(line)}</text>`
		).join("");
		return `<g><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" class="node" stroke="${color}"/>${labels}</g>`;
	}).join("");

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}" role="img" aria-label="Mind map export"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker><style>.edge{fill:none;stroke-width:2.5}.edge-label{font:14px sans-serif;fill:#4b5563;text-anchor:middle;paint-order:stroke;stroke:#fff;stroke-width:5px;stroke-linejoin:round}.node{fill:#fff;stroke-width:3}.node-label{font:15px sans-serif;fill:#1f2937}</style></defs><rect x="${bounds.minX - PADDING}" y="${bounds.minY - PADDING}" width="${width}" height="${height}" fill="#fff"/>${edgeMarkup}${nodeMarkup}</svg>`;
}

/** Create a vector PDF and embed local PNG, JPEG, and WebP Canvas file nodes. */
export async function createMindmapPdf(
	canvas: Canvas,
	title: string,
	resolveImage: ImageDataResolver,
	pageSize: PdfPageSize = "a4"
): Promise<ArrayBuffer | null> {
	const svg = createMindmapSvg(canvas);
	if (!svg) return null;
	const nodes = Array.from(canvas.nodes.values()).filter((node) => node.type !== "group");
	const bounds = canvasBounds(nodes);
	if (!bounds) return null;

	const width = bounds.maxX - bounds.minX + PADDING * 2;
	const height = bounds.maxY - bounds.minY + PADDING * 2;
	const layout = getPdfPageLayout(width, height, pageSize);
	const pdf = new jsPDF({
		unit: "pt",
		format: [layout.pageWidth, layout.pageHeight],
		compress: true,
	});
	pdf.setProperties({ title });
	const parser = new DOMParser();
	const svgElement = parser.parseFromString(svg, "image/svg+xml").documentElement;
	await svg2pdf(svgElement, pdf, {
		x: layout.x,
		y: layout.y,
		width: width * layout.scale,
		height: height * layout.scale,
	});

	const filePaths = new Map(canvas.getData().nodes.map((node) => [node.id, node.file]));
	for (const node of nodes) {
		if (node.type !== "file") continue;
		const path = filePaths.get(node.id);
		if (!path) continue;
		const format = imageFormat(path);
		if (!format) continue;
		const data = await resolveImage(path);
		if (!data) continue;
		try {
			const properties = pdf.getImageProperties(data);
			const imageRatio = properties.width / properties.height;
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
			pdf.addImage(
				data,
				format,
				layout.x + x * layout.scale,
				layout.y + y * layout.scale,
				imageWidth * layout.scale,
				imageHeight * layout.scale,
				node.id,
				"FAST"
			);
		} catch {
			// Unsupported or corrupt image: leave the vector node placeholder intact.
		}
	}

	return pdf.output("arraybuffer");
}
