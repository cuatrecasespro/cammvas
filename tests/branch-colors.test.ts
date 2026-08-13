import { describe, expect, it, vi } from "vitest";
import type { Canvas, CanvasEdge, CanvasNode } from "../src/types/canvas-internal";
import { BranchColors } from "../src/mindmap/branch-colors";

function node(id: string, color = ""): CanvasNode {
	return { id, color, setColor: vi.fn() } as unknown as CanvasNode;
}

function edge(from: CanvasNode, to: CanvasNode, color = ""): CanvasEdge {
	return { from: { node: from }, to: { node: to }, color, setColor: vi.fn() } as unknown as CanvasEdge;
}

describe("BranchColors.inheritConnectionColors", () => {
	it("copies a parent's branch color to a neutral child and connection", () => {
		const parent = node("parent", "3");
		const child = node("child");
		const connection = edge(parent, child);
		const canvas = { edges: new Map([["parent-child", connection]]) } as unknown as Canvas;
		const colors = new BranchColors({ getConnectedEdges: () => [] } as never);

		expect(colors.inheritConnectionColors(canvas)).toBe(true);
		expect(connection.setColor).toHaveBeenCalledWith("3");
		expect(child.setColor).toHaveBeenCalledWith("3");
	});

	it("preserves an existing child and connection color", () => {
		const parent = node("parent", "3");
		const child = node("child", "5");
		const connection = edge(parent, child, "5");
		const canvas = { edges: new Map([["parent-child", connection]]) } as unknown as Canvas;
		const colors = new BranchColors({ getConnectedEdges: () => [] } as never);

		expect(colors.inheritConnectionColors(canvas)).toBe(false);
		expect(connection.setColor).not.toHaveBeenCalled();
		expect(child.setColor).not.toHaveBeenCalled();
	});
});
