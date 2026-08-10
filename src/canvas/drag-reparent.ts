import { Platform } from "obsidian";
import type { Canvas, CanvasDragHandler, CanvasNode } from "../types/canvas-internal";
import { CanvasAPI } from "./canvas-api";
import { collectDescendantIds, findDropTarget } from "./drag-reparent-state";
import { getGroupIds } from "../mindmap/tree-model";

const DROP_TARGET_CLASS = "cammvas-reparent-drop-target";

export function registerDragReparent(
	canvas: Canvas,
	canvasApi: CanvasAPI,
	isEnabled: () => boolean,
	onReparent: (node: CanvasNode, newParent: CanvasNode) => void
): () => void {
	const original = canvas.handleSelectionDrag;
	if (!original) return () => {};

	let highlighted: CanvasNode | null = null;

	const clearHighlight = (): void => {
		highlighted?.nodeEl.removeClass(DROP_TARGET_CLASS);
		highlighted = null;
	};

	const replacement = function (
		this: Canvas,
		event: PointerEvent,
		dragEl: HTMLElement,
		directNode?: CanvasNode
	): CanvasDragHandler | void {
		const selectedNode = canvasApi.getSelectedNode(canvas);
		const draggedNode = directNode ?? selectedNode ?? undefined;
		const directNodeHasSingleSelection = directNode
			? !canvas.selection.has(directNode) || canvas.selection.size === 1
			: canvas.selection.size === 1;
		const groupIds = getGroupIds(canvas);
		const eligible = isEnabled()
			&& !!draggedNode
			&& directNodeHasSingleSelection
			&& !groupIds.has(draggedNode.id);

		const handler = original.call(this, event, dragEl, directNode);
		if (!handler || !eligible || !draggedNode) return handler;

		const descendantIds = collectDescendantIds(
			draggedNode.id,
			(nodeId) => canvasApi.getOutgoingEdges(canvas, nodeId).map((edge) => edge.to.node.id)
		);
		const excludedIds = new Set(descendantIds);
		excludedIds.add(draggedNode.id);
		for (const groupId of groupIds) excludedIds.add(groupId);

		const targetAt = (pointerEvent: MouseEvent): CanvasNode | null =>
			findDropTarget(canvas.nodes.values(), canvas.posFromEvt(pointerEvent), excludedIds);

		const updateHighlight = (pointerEvent: MouseEvent): CanvasNode | null => {
			const target = isEnabled() ? targetAt(pointerEvent) : null;
			if (target === highlighted) return target;
			clearHighlight();
			target?.nodeEl.addClass(DROP_TARGET_CLASS);
			highlighted = target;
			return target;
		};

		const originalMove = handler.move;
		const originalEnd = handler.end;
		const originalCancel = handler.cancel;
		const originalCleanup = handler.cleanup;

		handler.move = (moveEvent: PointerEvent) => {
			originalMove?.call(handler, moveEvent);
			updateHighlight(moveEvent);
		};
		handler.end = (endEvent: PointerEvent) => {
			const target = updateHighlight(endEvent);
			clearHighlight();
			const duplicating = Platform.isMacOS ? endEvent.altKey : endEvent.ctrlKey;
			try {
				if (target && isEnabled() && !duplicating) onReparent(draggedNode, target);
			} finally {
				originalEnd?.call(handler, endEvent);
			}
		};
		handler.cancel = () => {
			clearHighlight();
			originalCancel?.call(handler);
		};
		handler.cleanup = () => {
			clearHighlight();
			originalCleanup?.call(handler);
		};

		return handler;
	};

	canvas.handleSelectionDrag = replacement;

	return () => {
		clearHighlight();
		if (canvas.handleSelectionDrag === replacement) {
			canvas.handleSelectionDrag = original;
		}
	};
}
