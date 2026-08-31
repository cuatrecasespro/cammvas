import { describe, expect, it, vi } from "vitest";
import type { Canvas, CanvasEdge, CanvasNode } from "../src/types/canvas-internal";
import { LayoutEngine } from "../src/mindmap/layout-engine";

function node(id: string, x: number, y: number): CanvasNode {
	const result = {
		id,
		x,
		y,
		width: 100,
		height: 50,
		nodeEl: { addClass: vi.fn(), removeClass: vi.fn() },
		moveTo: vi.fn((position: { x: number; y: number }) => {
			result.x = position.x;
			result.y = position.y;
		}),
	} as unknown as CanvasNode;
	return result;
}

function edge(id: string, from: CanvasNode, to: CanvasNode): CanvasEdge {
	return {
		id,
		from: { node: from, side: "right" },
		to: { node: to, side: "left" },
	} as CanvasEdge;
}

describe("LayoutEngine.layoutChildren", () => {
	it("moves only descendants of the selected branch parent", () => {
		const root = node("root", 0, 0);
		const selected = node("selected", 200, 100);
		const childA = node("child-a", 900, 300);
		const childB = node("child-b", 1000, 500);
		const nodes = new Map([root, selected, childA, childB].map((item) => [item.id, item]));
		const edges = new Map([
			["root-selected", edge("root-selected", root, selected)],
			["selected-a", edge("selected-a", selected, childA)],
			["selected-b", edge("selected-b", selected, childB)],
		]);
		const canvas = {
			nodes,
			edges,
			getData: () => ({
				nodes: Array.from(nodes.values(), (item) => ({
					id: item.id,
					type: "text",
					x: item.x,
					y: item.y,
					width: item.width,
					height: item.height,
				})),
				edges: [],
			}),
			requestSave: vi.fn(),
			requestFrame: vi.fn(),
		} as unknown as Canvas;
		const engine = new LayoutEngine({ animate: false, horizontalGap: 80, verticalGap: 20 });

		engine.layoutChildren(canvas, selected.id);

		expect(root.moveTo).not.toHaveBeenCalled();
		expect(selected.moveTo).not.toHaveBeenCalled();
		expect([root.x, root.y]).toEqual([0, 0]);
		expect([selected.x, selected.y]).toEqual([200, 100]);
		expect(childA.moveTo).toHaveBeenCalled();
		expect(childB.moveTo).toHaveBeenCalled();
	});

	it("preserves children on opposite sides of a non-root branch", () => {
		const root = node("root", 0, 0);
		const selected = node("selected", 200, 100);
		const leftChild = node("left-child", -100, 300);
		const rightChild = node("right-child", 900, 500);
		const nodes = new Map([root, selected, leftChild, rightChild].map((item) => [item.id, item]));
		const edges = new Map([
			["root-selected", edge("root-selected", root, selected)],
			["selected-left", edge("selected-left", selected, leftChild)],
			["selected-right", edge("selected-right", selected, rightChild)],
		]);
		const canvas = {
			nodes,
			edges,
			getData: () => ({
				nodes: Array.from(nodes.values(), (item) => ({
					id: item.id,
					type: "text",
					x: item.x,
					y: item.y,
					width: item.width,
					height: item.height,
				})),
				edges: [],
			}),
			requestSave: vi.fn(),
			requestFrame: vi.fn(),
		} as unknown as Canvas;
		const engine = new LayoutEngine({ animate: false, horizontalGap: 80, verticalGap: 20 });

		engine.layoutChildren(canvas, selected.id);

		expect(leftChild.x).toBe(20);
		expect(rightChild.x).toBe(380);
	});
});

describe("LayoutEngine.layout", () => {
	it("arranges a vertical layout below the root", () => {
		const root = node("root", 0, 0);
		const first = node("first", -500, 300);
		const second = node("second", 500, 500);
		const grandchild = node("grandchild", 1000, 900);
		const nodes = new Map([root, first, second, grandchild].map((item) => [item.id, item]));
		const canvas = {
			nodes,
			edges: new Map([
				["root-first", edge("root-first", root, first)],
				["root-second", edge("root-second", root, second)],
				["first-grandchild", edge("first-grandchild", first, grandchild)],
			]),
			getData: () => ({
				nodes: Array.from(nodes.values(), (item) => ({
					id: item.id, type: "text", x: item.x, y: item.y, width: item.width, height: item.height,
				})),
				edges: [],
			}),
			requestSave: vi.fn(),
			requestFrame: vi.fn(),
		} as unknown as Canvas;

		new LayoutEngine({ animate: false, horizontalGap: 80, verticalGap: 20 }).layout(canvas, new Set(), "vertical");

		expect([root.x, root.y]).toEqual([0, 0]);
		expect(first.y).toBe(70);
		expect(second.y).toBe(70);
		expect(grandchild.y).toBe(140);
		expect(first.x).toBeLessThan(second.x);
	});
});
