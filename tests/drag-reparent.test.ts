import { describe, expect, it, vi } from "vitest";
import type { Canvas, CanvasEdge, CanvasNode } from "../src/types/canvas-internal";
import type { CanvasAPI } from "../src/canvas/canvas-api";
import { collectDescendantIds, findDropTarget } from "../src/canvas/drag-reparent-state";
import { NodeOperations } from "../src/mindmap/node-operations";

function node(id: string, x = 0, y = 0, zIndex = 0): CanvasNode {
	return { id, x, y, width: 100, height: 50, zIndex, color: "" } as CanvasNode;
}

function edge(id: string, from: CanvasNode, to: CanvasNode): CanvasEdge {
	return { id, from: { node: from }, to: { node: to } } as CanvasEdge;
}

describe("drag reparent state", () => {
	it("collects every descendant and tolerates cycles", () => {
		const children = new Map([
			["root", ["child"]],
			["child", ["grandchild"]],
			["grandchild", ["root"]],
		]);

		expect(collectDescendantIds("root", (id) => children.get(id) ?? []))
			.toEqual(new Set(["child", "grandchild"]));
	});

	it("selects the topmost valid node under the pointer", () => {
		const lower = node("lower", 0, 0, 1);
		const upper = node("upper", 0, 0, 5);
		const excluded = node("excluded", 0, 0, 10);

		expect(findDropTarget([lower, upper, excluded], { x: 20, y: 20 }, new Set(["excluded"])))
			.toBe(upper);
	});

	it("returns null outside all valid nodes", () => {
		expect(findDropTarget([node("target")], { x: 200, y: 200 }, new Set())).toBeNull();
	});
});

describe("NodeOperations.reparent", () => {
	function setup() {
		const oldParent = node("old-parent", -200);
		const dragged = node("dragged");
		const child = node("child", 200);
		const newParent = node("new-parent", -300);
		const edges = new Map<string, CanvasEdge>([
			["old", edge("old", oldParent, dragged)],
			["child", edge("child", dragged, child)],
		]);
		const canvas = {
			edges,
			removeEdge: (item: CanvasEdge) => edges.delete(item.id),
		} as unknown as Canvas;
		const canvasApi = {
			getOutgoingEdges: (_canvas: Canvas, nodeId: string) =>
				Array.from(edges.values()).filter((item) => item.from.node.id === nodeId),
			getConnectedEdges: (_canvas: Canvas, target: CanvasNode) =>
				Array.from(edges.values()).filter((item) =>
					item.from.node.id === target.id || item.to.node.id === target.id
				),
			invalidateEdgeIndex: vi.fn(),
			createEdge: vi.fn((_canvas, from: CanvasNode, to: CanvasNode) => {
				edges.set("new", edge("new", from, to));
			}),
		} as unknown as CanvasAPI;
		const operations = new NodeOperations(canvasApi, {
			nodeWidth: 100,
			nodeHeight: 50,
			horizontalGap: 80,
			verticalGap: 20,
		});

		return { operations, canvas, edges, oldParent, dragged, child, newParent, canvasApi };
	}

	it("replaces only the incoming edge and preserves the subtree", () => {
		const { operations, canvas, edges, dragged, child, newParent, canvasApi } = setup();

		expect(operations.reparent(canvas, dragged, newParent)).toBe(true);
		expect(edges.has("old")).toBe(false);
		expect(edges.get("child")?.to.node).toBe(child);
		expect(edges.get("new")?.from.node).toBe(newParent);
		expect(edges.get("new")?.to.node).toBe(dragged);
		expect(canvasApi.invalidateEdgeIndex).toHaveBeenCalled();
	});

	it("rejects making a node the child of its own descendant", () => {
		const { operations, canvas, edges, dragged, child, canvasApi } = setup();

		expect(operations.reparent(canvas, dragged, child)).toBe(false);
		expect(edges.has("old")).toBe(true);
		expect(canvasApi.createEdge).not.toHaveBeenCalled();
	});
});
