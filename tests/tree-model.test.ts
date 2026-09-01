import { describe, expect, it } from "vitest";
import type { Canvas, CanvasEdge, CanvasNode } from "../src/types/canvas-internal";
import { buildForest, findTreeForNode, getDescendants, getNodeTitle } from "../src/mindmap/tree-model";

function node(id: string, x: number, y: number): CanvasNode {
	return { id, x, y, width: 100, height: 50 } as CanvasNode;
}

function canvas(nodes: CanvasNode[], pairs: Array<[CanvasNode, CanvasNode]>, groupIds: string[] = [], collapsed: string[] = []): Canvas {
	const edges = pairs.map(([from, to], index) => ({
		id: `edge-${index}`,
		from: { node: from, side: "right", end: "none" },
		to: { node: to, side: "left", end: "arrow" },
	})) as CanvasEdge[];

	return {
		nodes: new Map(nodes.map((item) => [item.id, item])),
		edges: new Map(edges.map((edge) => [edge.id, edge])),
		getData: () => ({
			nodes: nodes.map((item) => ({
				id: item.id,
				type: groupIds.includes(item.id) ? "group" : "text",
				x: item.x,
				y: item.y,
				width: item.width,
				height: item.height,
			})),
			edges: [],
			mindmapCollapsed: collapsed,
		}),
	} as unknown as Canvas;
}

describe("buildForest", () => {
	it("builds nested trees and assigns branch directions", () => {
		const root = node("root", 0, 0);
		const left = node("left", -200, 0);
		const right = node("right", 200, 100);
		const grandchild = node("grandchild", -400, 0);
		const forest = buildForest(canvas(
			[root, left, right, grandchild],
			[[root, left], [root, right], [left, grandchild]]
		));

		expect(forest).toHaveLength(1);
		expect(forest[0].children.map((child) => child.canvasNode.id)).toEqual(["left", "right"]);
		expect(findTreeForNode(forest, "left")?.direction).toBe("left");
		expect(findTreeForNode(forest, "right")?.direction).toBe("right");
		expect(findTreeForNode(forest, "grandchild")?.direction).toBe("left");
		expect(getDescendants(forest[0]).map((item) => item.canvasNode.id)).toEqual([
			"left",
			"grandchild",
			"right",
		]);
	});

	it("excludes Canvas groups and sorts larger trees first", () => {
		const largeRoot = node("large-root", 0, 0);
		const child = node("child", 200, 0);
		const smallRoot = node("small-root", 0, 200);
		const group = node("group", -50, -50);
		const forest = buildForest(canvas(
			[smallRoot, group, largeRoot, child],
			[[largeRoot, child]],
			["group"]
		));

		expect(forest.map((root) => root.canvasNode.id)).toEqual(["large-root", "small-root"]);
		expect(findTreeForNode(forest, "group")).toBeNull();
	});

	it("omits collapsed descendants only when requested by the layout", () => {
		const root = node("root", 0, 0);
		const branch = node("branch", 200, 0);
		const hidden = node("hidden", 400, 0);
		const visible = node("visible", 200, 200);
		const source = canvas([root, branch, hidden, visible], [[root, branch], [branch, hidden], [root, visible]], [], ["branch"]);

		expect(findTreeForNode(buildForest(source), "hidden")).not.toBeNull();
		expect(findTreeForNode(buildForest(source, true), "hidden")).toBeNull();
		expect(buildForest(source, true)[0].children.map((child) => child.canvasNode.id)).toEqual(["visible"]);
	});
});

describe("getNodeTitle", () => {
	it("uses a linked Markdown filename when the runtime node has no text", () => {
		const fileNode = { id: "note", text: "" } as CanvasNode;

		expect(getNodeTitle(fileNode, {
			id: "note",
			type: "file",
			x: 0,
			y: 0,
			width: 100,
			height: 50,
			file: "Projects/Meeting notes.md",
		})).toBe("Meeting notes");
	});
});
