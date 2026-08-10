import { Platform } from "obsidian";
import type { Canvas, CanvasDragHandler, CanvasNode } from "../types/canvas-internal";
import { CanvasAPI } from "./canvas-api";
import {
	collectDescendantIdsForRoots,
	findDropTarget,
	getTopLevelSelectedIds,
} from "./drag-reparent-state";
import { getGroupIds } from "../mindmap/tree-model";

const DROP_TARGET_CLASS = "cammvas-reparent-drop-target";

export function registerDragReparent(
	canvas: Canvas,
	canvasApi: CanvasAPI,
	isEnabled: () => boolean,
	onReparent: (nodes: CanvasNode[], newParent: CanvasNode) => void
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
		const groupIds = getGroupIds(canvas);
		const selectedNodes = Array.from(canvas.selection)
			.map((item) => canvas.nodes.get(item.id))
			.filter((node): node is CanvasNode => !!node && !groupIds.has(node.id));
		const candidateNodes = directNode && !canvas.selection.has(directNode)
			? [directNode]
			: selectedNodes.length > 0
				? selectedNodes
				: directNode
					? [directNode]
					: [];
		const candidateIds = new Set(candidateNodes.map((node) => node.id));
		const topLevelIds = getTopLevelSelectedIds(
			candidateIds,
			(nodeId) => {
				const node = canvas.nodes.get(nodeId);
				return node ? canvasApi.getParentNode(canvas, node)?.id ?? null : null;
			}
		);
		const draggedNodes = candidateNodes.filter((node) => topLevelIds.has(node.id));
		const eligible = isEnabled()
			&& draggedNodes.length > 0
			&& (!directNode || !groupIds.has(directNode.id));

		const handler = original.call(this, event, dragEl, directNode);
		if (!handler || !eligible) return handler;

		const descendantIds = collectDescendantIdsForRoots(
			draggedNodes.map((node) => node.id),
			(nodeId) => canvasApi.getOutgoingEdges(canvas, nodeId).map((edge) => edge.to.node.id)
		);
		const excludedIds = new Set(descendantIds);
		for (const node of draggedNodes) excludedIds.add(node.id);
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
				if (target && isEnabled() && !duplicating) onReparent(draggedNodes, target);
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
