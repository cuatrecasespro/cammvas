import { describe, expect, it, vi } from "vitest";
import type { Canvas, CanvasDragHandler, CanvasNode } from "../src/types/canvas-internal";
import type { CanvasAPI } from "../src/canvas/canvas-api";
import { registerAutoLayoutOnMove } from "../src/canvas/auto-layout-on-move";

function node(id: string): CanvasNode {
	return { id, x: 0, y: 0, width: 100, height: 50, color: "" } as CanvasNode;
}

interface Setup {
	canvas: Canvas;
	canvasApi: CanvasAPI;
	nodes: Map<string, CanvasNode>;
	selection: Set<CanvasNode>;
	parents: Map<string, CanvasNode>;
	fireDrag: (directNode?: CanvasNode) => CanvasDragHandler;
}

function setup(originalHandler: (() => CanvasDragHandler) | null = () => ({})): Setup {
	const nodes = new Map<string, CanvasNode>();
	const selection = new Set<CanvasNode>();
	const parents = new Map<string, CanvasNode>();

	const canvas = {
		nodes,
		selection,
		getData: () => ({ nodes: [], edges: [] }),
		handleSelectionDrag: originalHandler
			? (_event: PointerEvent, _dragEl: HTMLElement, _directNode?: CanvasNode) => originalHandler()
			: undefined,
	} as unknown as Canvas;

	const canvasApi = {
		getParentNode: (_canvas: Canvas, target: CanvasNode) => parents.get(target.id) ?? null,
	} as unknown as CanvasAPI;

	const fireDrag = (directNode?: CanvasNode): CanvasDragHandler => {
		const handler = canvas.handleSelectionDrag?.({} as PointerEvent, {} as HTMLElement, directNode);
		if (!handler) throw new Error("handler was not created");
		return handler;
	};

	return { canvas, canvasApi, nodes, selection, parents, fireDrag };
}

describe("registerAutoLayoutOnMove", () => {
	it("does nothing when the canvas has no handleSelectionDrag", () => {
		const { canvas, canvasApi } = setup(null);
		const onSettled = vi.fn();

		const cleanup = registerAutoLayoutOnMove(canvas, canvasApi, () => true, onSettled);

		expect(canvas.handleSelectionDrag).toBeUndefined();
		expect(() => cleanup()).not.toThrow();
	});

	it("does not call onSettled when the pointer never moved (plain click)", () => {
		const { canvas, canvasApi, nodes, selection, parents } = setup();
		const dragged = node("child");
		const parent = node("parent");
		nodes.set(dragged.id, dragged);
		selection.add(dragged);
		parents.set(dragged.id, parent);
		const onSettled = vi.fn();

		registerAutoLayoutOnMove(canvas, canvasApi, () => true, onSettled);
		const handler = canvas.handleSelectionDrag!({} as PointerEvent, {} as HTMLElement, dragged);
		handler!.end?.({ type: "pointerup" } as PointerEvent);

		expect(onSettled).not.toHaveBeenCalled();
	});

	it("calls onSettled with the dragged node's parent id after a real move", () => {
		const { canvas, canvasApi, nodes, selection, parents } = setup();
		const dragged = node("child");
		const parent = node("parent");
		nodes.set(dragged.id, dragged);
		selection.add(dragged);
		parents.set(dragged.id, parent);
		const onSettled = vi.fn();

		registerAutoLayoutOnMove(canvas, canvasApi, () => true, onSettled);
		const handler = canvas.handleSelectionDrag!({} as PointerEvent, {} as HTMLElement, dragged);
		handler!.move?.({} as PointerEvent);
		handler!.end?.({ type: "pointerup" } as PointerEvent);

		expect(onSettled).toHaveBeenCalledTimes(1);
		expect(onSettled).toHaveBeenCalledWith(new Set([parent.id]));
	});

	it("does not call onSettled when disabled", () => {
		const { canvas, canvasApi, nodes, selection, parents } = setup();
		const dragged = node("child");
		const parent = node("parent");
		nodes.set(dragged.id, dragged);
		selection.add(dragged);
		parents.set(dragged.id, parent);
		const onSettled = vi.fn();

		registerAutoLayoutOnMove(canvas, canvasApi, () => false, onSettled);
		const handler = canvas.handleSelectionDrag!({} as PointerEvent, {} as HTMLElement, dragged);
		handler!.move?.({} as PointerEvent);
		handler!.end?.({ type: "pointerup" } as PointerEvent);

		expect(onSettled).not.toHaveBeenCalled();
	});

	it("does not call onSettled for a root node with no parent", () => {
		const { canvas, canvasApi, nodes, selection } = setup();
		const root = node("root");
		nodes.set(root.id, root);
		selection.add(root);
		const onSettled = vi.fn();

		registerAutoLayoutOnMove(canvas, canvasApi, () => true, onSettled);
		const handler = canvas.handleSelectionDrag!({} as PointerEvent, {} as HTMLElement, root);
		handler!.move?.({} as PointerEvent);
		handler!.end?.({ type: "pointerup" } as PointerEvent);

		expect(onSettled).not.toHaveBeenCalled();
	});

	it("skips a node that was reparented during the drag, leaving it to drag-to-reparent", () => {
		const { canvas, canvasApi, nodes, selection, parents } = setup();
		const dragged = node("child");
		const oldParent = node("old-parent");
		const newParent = node("new-parent");
		nodes.set(dragged.id, dragged);
		selection.add(dragged);
		parents.set(dragged.id, oldParent);
		const onSettled = vi.fn();

		registerAutoLayoutOnMove(canvas, canvasApi, () => true, onSettled);
		const handler = canvas.handleSelectionDrag!({} as PointerEvent, {} as HTMLElement, dragged);
		handler!.move?.({} as PointerEvent);
		// Simulate drag-to-reparent having changed the node's parent by the
		// time the drag ends (it runs its own logic inside the original end).
		parents.set(dragged.id, newParent);
		handler!.end?.({ type: "pointerup" } as PointerEvent);

		expect(onSettled).not.toHaveBeenCalled();
	});

	it("still snaps back siblings whose parent did not change, alongside a reparented one", () => {
		const { canvas, canvasApi, nodes, selection, parents } = setup();
		const reparented = node("reparented");
		const stationary = node("stationary");
		const oldParent = node("old-parent");
		const newParent = node("new-parent");
		nodes.set(reparented.id, reparented);
		nodes.set(stationary.id, stationary);
		selection.add(reparented);
		selection.add(stationary);
		parents.set(reparented.id, oldParent);
		parents.set(stationary.id, oldParent);
		const onSettled = vi.fn();

		registerAutoLayoutOnMove(canvas, canvasApi, () => true, onSettled);
		const handler = canvas.handleSelectionDrag!({} as PointerEvent, {} as HTMLElement, undefined);
		handler!.move?.({} as PointerEvent);
		parents.set(reparented.id, newParent);
		handler!.end?.({ type: "pointerup" } as PointerEvent);

		expect(onSettled).toHaveBeenCalledTimes(1);
		expect(onSettled).toHaveBeenCalledWith(new Set([oldParent.id]));
	});

	it("still invokes the original drag handler's move/end callbacks", () => {
		const originalMove = vi.fn();
		const originalEnd = vi.fn();
		const { canvas, canvasApi, nodes, selection, parents } = setup(() => ({
			move: originalMove,
			end: originalEnd,
		}));
		const dragged = node("child");
		const parent = node("parent");
		nodes.set(dragged.id, dragged);
		selection.add(dragged);
		parents.set(dragged.id, parent);

		registerAutoLayoutOnMove(canvas, canvasApi, () => true, vi.fn());
		const handler = canvas.handleSelectionDrag!({} as PointerEvent, {} as HTMLElement, dragged);
		const moveEvent = { type: "pointermove" } as PointerEvent;
		const endEvent = { type: "pointerup" } as PointerEvent;
		handler!.move?.(moveEvent);
		handler!.end?.(endEvent);

		expect(originalMove).toHaveBeenCalledWith(moveEvent);
		expect(originalEnd).toHaveBeenCalledWith(endEvent);
	});

	it("restores the original handleSelectionDrag on cleanup", () => {
		const { canvas, canvasApi } = setup();
		const original = canvas.handleSelectionDrag;

		const cleanup = registerAutoLayoutOnMove(canvas, canvasApi, () => true, vi.fn());
		expect(canvas.handleSelectionDrag).not.toBe(original);

		cleanup();
		expect(canvas.handleSelectionDrag).toBe(original);
	});
});
