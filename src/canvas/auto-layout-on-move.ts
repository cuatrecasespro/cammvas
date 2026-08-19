import type { Canvas, CanvasDragHandler, CanvasNode } from "../types/canvas-internal";
import { CanvasAPI } from "./canvas-api";
import { getGroupIds } from "../mindmap/tree-model";

/**
 * When enabled, re-arranges a manually dragged node (and its subtree) back
 * into its auto-layout slot under its parent once the drag ends — restoring
 * the mind map structure after a manual reposition.
 *
 * Only triggers when the pointer actually moved during the drag (a plain
 * click/selection is not treated as a move), and only for nodes that have
 * a parent (root nodes have no fixed "slot" to snap back to).
 */
export function registerAutoLayoutOnMove(
	canvas: Canvas,
	canvasApi: CanvasAPI,
	isEnabled: () => boolean,
	onSettled: (parentIds: ReadonlySet<string>) => void
): () => void {
	const original = canvas.handleSelectionDrag;
	if (!original) return () => {};

	const replacement = function (
		this: Canvas,
		event: PointerEvent,
		dragEl: HTMLElement,
		directNode?: CanvasNode
	): CanvasDragHandler | void {
		const handler = original.call(this, event, dragEl, directNode);
		if (!handler) return handler;

		let moved = false;
		const originalMove = handler.move;
		const originalEnd = handler.end;

		handler.move = (moveEvent: PointerEvent) => {
			moved = true;
			originalMove?.call(handler, moveEvent);
		};
		handler.end = (endEvent: PointerEvent) => {
			try {
				originalEnd?.call(handler, endEvent);
			} finally {
				if (moved && isEnabled()) {
					const groupIds = getGroupIds(canvas);
					const draggedNodes = directNode && !canvas.selection.has(directNode)
						? [directNode]
						: Array.from(canvas.selection)
							.map((item) => canvas.nodes.get(item.id))
							.filter((node): node is CanvasNode => !!node && !groupIds.has(node.id));
					const parentIds = new Set<string>();
					for (const node of draggedNodes) {
						const parent = canvasApi.getParentNode(canvas, node);
						if (parent) parentIds.add(parent.id);
					}
					if (parentIds.size > 0) onSettled(parentIds);
				}
			}
		};

		return handler;
	};

	canvas.handleSelectionDrag = replacement;

	return () => {
		if (canvas.handleSelectionDrag === replacement) {
			canvas.handleSelectionDrag = original;
		}
	};
}
