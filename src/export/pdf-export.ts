import type { Canvas, CanvasEdge, CanvasNode, NodeSide } from "../types/canvas-internal";

const NODE_COLORS: Record<string, string> = {
	"1": "#e75545",
	"2": "#e9973f",
	"3": "#e0de71",
	"4": "#44cf6e",
	"5": "#53aaf5",
	"6": "#a882f7",
};

const PADDING = 48;

interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
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

/** Open the native print dialog without relying on a popup; SVG stays vector-sharp. */
export function printMindmapPdf(canvas: Canvas, title: string): boolean {
	const svg = createMindmapSvg(canvas);
	if (!svg) return false;
	const doc = canvas.wrapperEl.ownerDocument;
	const iframe = doc.createElement("iframe");
	iframe.setAttribute("aria-hidden", "true");
	iframe.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden";
	iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(title)}</title><style>@page{margin:12mm}html,body{margin:0;background:#fff}body{padding:0}svg{display:block;width:100%;height:auto}</style></head><body>${svg}</body></html>`;
	iframe.addEventListener("load", () => {
		const printWindow = iframe.contentWindow;
		if (!printWindow) {
			iframe.remove();
			return;
		}
		printWindow.focus();
		printWindow.print();
		canvas.wrapperEl.win.setTimeout(() => iframe.remove(), 1_000);
	}, { once: true });
	doc.body.appendChild(iframe);
	return true;
}
