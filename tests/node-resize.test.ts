import { describe, expect, it, vi } from "vitest";
import type { Canvas, CanvasEdge, CanvasNode } from "../src/types/canvas-internal";
import {
	registerNodeResizeHandler,
	NodeResizeResult,
	syncWidthsAtSameDepth,
} from "../src/canvas/node-resize";

type Listener = (event: PointerEvent) => void;

function listenerTarget(): {
	addEventListener: (type: string, listener: Listener) => void;
	removeEventListener: (type: string, listener: Listener) => void;
	emit: (type: string, event: Partial<PointerEvent>) => void;
} {
	const listeners = new Map<string, Set<Listener>>();
	return {
		addEventListener: (type, listener) => {
			const values = listeners.get(type) ?? new Set();
			values.add(listener);
			listeners.set(type, values);
		},
		removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
		emit: (type, event) => {
			for (const listener of listeners.get(type) ?? []) listener(event as PointerEvent);
		},
	};
}

describe("registerNodeResizeHandler", () => {
	it("reports final width and height changes after release outside the canvas", () => {
		const wrapper = listenerTarget();
		const windowTarget = listenerTarget();
		const win = {
			...windowTarget,
			requestAnimationFrame: (callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			},
			cancelAnimationFrame: vi.fn(),
		};
		const node = { id: "node", width: 300, height: 60 } as CanvasNode;
		const canvas = {
			wrapperEl: Object.assign(wrapper, { win }),
			selection: new Set([node]),
			nodes: new Map([[node.id, node]]),
			getData: () => ({ nodes: [], edges: [] }),
		} as unknown as Canvas;
		const settled = vi.fn<(result: NodeResizeResult) => void>();
		const cleanup = registerNodeResizeHandler(canvas, () => true, settled);

		wrapper.emit("pointerdown", {
			pointerId: 7,
			target: { closest: () => ({}), offsetHeight: 10 } as unknown as EventTarget,
		});
		node.width = 420;
		node.height = 90;
		win.emit("pointerup", { pointerId: 7 });

		expect(settled).toHaveBeenCalledOnce();
		const result = settled.mock.calls[0][0];
		expect(result.nodes).toEqual([node]);
		expect(result.widthChangedNodeIds).toEqual(new Set([node.id]));
		cleanup();
	});
});

describe("syncWidthsAtSameDepth", () => {
	it("updates every affected sibling level without crossing tree roots", () => {
		const createNode = (id: string, x: number, y: number, width = 300): CanvasNode => {
			const node = { id, x, y, width, height: 60 } as CanvasNode;
			node.moveAndResize = vi.fn((size) => {
				Object.assign(node, size);
			});
			return node;
		};
		const root = createNode("root", 0, 0);
		const resized = createNode("resized", 400, 0, 420);
		const sibling = createNode("sibling", 400, 120);
		const otherRoot = createNode("other-root", 0, 500);
		const otherChild = createNode("other-child", 400, 500);
		const nodes = [root, resized, sibling, otherRoot, otherChild];
		const pairs: Array<[CanvasNode, CanvasNode]> = [
			[root, resized],
			[root, sibling],
			[otherRoot, otherChild],
		];
		const edges = pairs.map(([from, to], index) => ({
			id: `edge-${index}`,
			from: { node: from, side: "right", end: "none" },
			to: { node: to, side: "left", end: "arrow" },
		})) as CanvasEdge[];
		const requestSave = vi.fn();
		const canvas = {
			nodes: new Map(nodes.map((node) => [node.id, node])),
			edges: new Map(edges.map((edge) => [edge.id, edge])),
			requestSave,
			getData: () => ({
				nodes: nodes.map((node) => ({
					id: node.id,
					type: "text" as const,
					x: node.x,
					y: node.y,
					width: node.width,
					height: node.height,
				})),
				edges: [],
			}),
		} as unknown as Canvas;

		const affected = syncWidthsAtSameDepth(canvas, [resized]);

		expect(new Set(affected.map((node) => node.id))).toEqual(new Set(["resized", "sibling"]));
		expect(sibling.width).toBe(420);
		expect(otherChild.width).toBe(300);
		expect(requestSave).toHaveBeenCalledOnce();
	});
});
