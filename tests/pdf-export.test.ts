import { describe, expect, it } from "vitest";
import type { Canvas, CanvasEdge, CanvasNode, NodeSide } from "../src/types/canvas-internal";
import { createMindmapPdf, createMindmapSvg, getPdfPageLayout } from "../src/export/pdf-export";

function node(id: string, x: number, y: number, text: string, color = ""): CanvasNode {
	return {
		id, x, y, width: 180, height: 60, text, color, type: "text",
	} as CanvasNode;
}

function edge(from: CanvasNode, to: CanvasNode, fromSide: NodeSide = "right", toSide: NodeSide = "left"): CanvasEdge {
	return {
		id: `${from.id}-${to.id}`,
		from: { node: from, side: fromSide, end: "none" },
		to: { node: to, side: toSide, end: "arrow" },
		color: "",
		label: "",
	} as CanvasEdge;
}

function canvas(nodes: CanvasNode[], edges: CanvasEdge[] = []): Canvas {
	return {
		nodes: new Map(nodes.map((item) => [item.id, item])),
		edges: new Map(edges.map((item) => [item.id, item])),
		getData: () => ({ nodes: [], edges: [] }),
	} as unknown as Canvas;
}

describe("createMindmapSvg", () => {
	it("returns null for an empty canvas", () => {
		expect(createMindmapSvg(canvas([]))).toBeNull();
	});

	it("renders vector nodes, connectors, and arrowheads", () => {
		const root = node("root", 0, 0, "Root", "5");
		const child = node("child", 300, 20, "Child", "5");
		const svg = createMindmapSvg(canvas([root, child], [edge(root, child)]));

		expect(svg).toContain("<svg");
		expect(svg).toContain("viewBox=\"-48 -48 576 176\"");
		expect(svg).toContain("stroke=\"#53aaf5\"");
		expect(svg).toContain("marker-end=\"url(#arrow)\"");
		expect(svg).toContain(">Root</text>");
		expect(svg).toContain(">Child</text>");
	});

	it("escapes node and edge label content", () => {
		const root = node("root", 0, 0, "Root <important>");
		const child = node("child", 300, 20, "Child");
		const link = edge(root, child);
		link.label = "A & B";
		const svg = createMindmapSvg(canvas([root, child], [link]));

		expect(svg).toContain("Root &lt;important&gt;");
		expect(svg).toContain("A &amp; B");
	});

	it("excludes group nodes and their edges from the document", () => {
		const root = node("root", 0, 0, "Root");
		const group = node("group", 300, 20, "Group");
		group.type = "group";
		const svg = createMindmapSvg(canvas([root, group], [edge(root, group)]));

		expect(svg).toContain(">Root</text>");
		expect(svg).not.toContain(">Group</text>");
		expect(svg).not.toContain("marker-end");
	});
});

describe("getPdfPageLayout", () => {
	it("uses landscape A4 and centers a wide map inside margins", () => {
		const layout = getPdfPageLayout(2_000, 800, "a4");

		expect(layout.pageWidth).toBeCloseTo(841.89);
		expect(layout.pageHeight).toBeCloseTo(595.28);
		expect(layout.orientation).toBe("landscape");
		expect(layout.x).toBeCloseTo(36);
		expect(layout.y).toBeGreaterThan(36);
		expect(2_000 * layout.scale).toBeCloseTo(layout.pageWidth - 72);
	});

	it("uses portrait A4 and centers a tall map inside margins", () => {
		const layout = getPdfPageLayout(800, 2_000, "a4");

		expect(layout.pageWidth).toBeCloseTo(595.28);
		expect(layout.pageHeight).toBeCloseTo(841.89);
		expect(layout.orientation).toBe("portrait");
		expect(layout.x).toBeGreaterThan(36);
		expect(layout.y).toBeCloseTo(36);
		expect(2_000 * layout.scale).toBeCloseTo(layout.pageHeight - 72);
	});

	it("uses A3 dimensions when requested", () => {
		const layout = getPdfPageLayout(2_000, 800, "a3");

		expect(layout.pageWidth).toBeCloseTo(1190.55);
		expect(layout.pageHeight).toBeCloseTo(841.89);
		expect(layout.orientation).toBe("landscape");
		expect(2_000 * layout.scale).toBeCloseTo(layout.pageWidth - 72);
	});

	it("keeps natural map dimensions on a full-size page", () => {
		const layout = getPdfPageLayout(2_000, 800, "full");

		expect(layout.pageWidth).toBe(1_500);
		expect(layout.pageHeight).toBe(600);
		expect(layout.orientation).toBe("landscape");
		expect(layout.scale).toBe(0.75);
		expect(layout.x).toBe(0);
		expect(layout.y).toBe(0);
	});
});

describe("createMindmapPdf", () => {
	it("produces a PDF directly without browser script injection", async () => {
		const root = node("root", 0, 0, "Root");
		const child = node("child", 300, 20, "Child");
		const pdf = await createMindmapPdf(canvas([root, child], [edge(root, child)]), "Map", async () => null, "a3");

		expect(pdf).not.toBeNull();
		expect(Array.from(new Uint8Array(pdf!.slice(0, 5)))).toEqual([37, 80, 68, 70, 45]);
	});
});
