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

	it("applies a native Canvas color to a complete branch", () => {
		const root = { ...node("root"), x: 0, y: 0, width: 100, height: 50 };
		const child = { ...node("child"), x: 200, y: 0, width: 100, height: 50 };
		const connection = edge(root, child);
		const data = {
			nodes: [
				{ id: "root", type: "text" as const, x: 0, y: 0, width: 100, height: 50 },
				{ id: "child", type: "text" as const, x: 200, y: 0, width: 100, height: 50 },
			],
			edges: [],
		};
		const canvas = {
			nodes: new Map([["root", root], ["child", child]]),
			edges: new Map([["root-child", connection]]),
			getData: () => data,
			requestSave: vi.fn(),
			requestFrame: vi.fn(),
		} as unknown as Canvas;
		const colors = new BranchColors({
			getConnectedEdges: () => [connection],
		} as never);

		colors.setBranchColor(canvas, "child", "4");

		expect(child.setColor).toHaveBeenCalledWith("4");
		expect(connection.setColor).toHaveBeenCalledWith("4");
	});
});
