import type { Canvas, CanvasNode } from "../types/canvas-internal";
import { CanvasAPI, findNodeFromEvent } from "./canvas-api";
import { getTopLevelSelectedIds } from "./drag-reparent-state";

function collectDescendants(canvas: Canvas, canvasApi: CanvasAPI, nodeId: string): CanvasNode[] {
	const result: CanvasNode[] = [];
	const visited = new Set<string>([nodeId]);
	const queue = [nodeId];

	while (queue.length > 0) {
		const id = queue.shift()!;
		for (const edge of canvasApi.getOutgoingEdges(canvas, id)) {
			const childId = edge.to.node.id;
			if (visited.has(childId)) continue;
			visited.add(childId);
			result.push(edge.to.node);
			queue.push(childId);
		}
	}
	return result;
}

interface WrappedBranch {
	root: CanvasNode;
	descendants: CanvasNode[];
	originalMoveTo: (pos: { x: number; y: number }) => void;
}

/** Make every selected top-level node move its unselected descendants during a drag. */
export function registerSubtreeDragHandler(canvas: Canvas, canvasApi: CanvasAPI): () => void {
	let wrappedBranches: WrappedBranch[] = [];
	let activePointerId: number | null = null;
	let didMove = false;
	let cancelled = false;

	const selectedNodes = (): CanvasNode[] =>
		Array.from(canvas.selection)
			.filter((item): item is CanvasNode => "nodeEl" in item);

	const clearDragSession = (): void => {
		for (const { root } of wrappedBranches) {
			delete (root as { moveTo?: unknown }).moveTo;
		}
		wrappedBranches = [];
		activePointerId = null;
		didMove = false;
		cancelled = false;
	};

	const installWrappers = (candidates: CanvasNode[]): void => {
		const selectedIds = new Set(candidates.map((node) => node.id));
		const rootIds = getTopLevelSelectedIds(
			selectedIds,
			(nodeId) => {
				const node = canvas.nodes.get(nodeId);
				return node ? canvasApi.getParentNode(canvas, node)?.id ?? null : null;
			}
		);
		const claimedIds = new Set(selectedIds);

		for (const rootId of rootIds) {
			const root = canvas.nodes.get(rootId);
			if (!root) continue;
			const descendants = collectDescendants(canvas, canvasApi, root.id).filter((node) => {
				if (claimedIds.has(node.id)) return false;
				claimedIds.add(node.id);
				return true;
			});
			if (descendants.length === 0) continue;

			const proto = Object.getPrototypeOf(root) as CanvasNode;
			const originalMoveTo = proto.moveTo.bind(root);
			const branch: WrappedBranch = { root, descendants, originalMoveTo };
			wrappedBranches.push(branch);
			root.moveTo = (pos: { x: number; y: number }) => {
				didMove = true;
				const dx = pos.x - root.x;
				const dy = pos.y - root.y;
				originalMoveTo(pos);
				for (const descendant of branch.descendants) {
					const descendantProto = Object.getPrototypeOf(descendant) as CanvasNode;
					descendantProto.moveTo.call(descendant, {
						x: descendant.x + dx,
						y: descendant.y + dy,
					});
				}
			};
		}
	};

	const downHandler = (event: PointerEvent): void => {
		if (event.pointerType === "touch" && !event.isPrimary) {
			cancelled = true;
			return;
		}
		clearDragSession();
		if (event.altKey) return;

		const clickedNode = findNodeFromEvent(canvas, event);
		if (!clickedNode) return;
		activePointerId = event.pointerId;
		const currentSelection = selectedNodes();
		installWrappers(
			canvas.selection.has(clickedNode) && currentSelection.length > 1
				? currentSelection
				: [clickedNode]
		);
	};

	const moveHandler = (event: PointerEvent): void => {
		if (event.pointerType === "touch" && !event.isPrimary) {
			cancelled = true;
			return;
		}
		if (event.pointerId !== activePointerId) return;
		if (event.pointerType !== "touch" && event.buttons === 0) return;
		if (event.altKey) {
			clearDragSession();
			return;
		}
	};

	const upHandler = (event: PointerEvent): void => {
		if (event.pointerId !== activePointerId) return;
		if (wrappedBranches.length > 0 && didMove && !cancelled) canvas.requestSave();
		clearDragSession();
	};

	const cancelHandler = (event: PointerEvent): void => {
		if (event.pointerId === activePointerId) clearDragSession();
	};

	canvas.wrapperEl?.addEventListener("pointerdown", downHandler, true);
	canvas.wrapperEl?.addEventListener("pointermove", moveHandler);
	canvas.wrapperEl?.addEventListener("pointerup", upHandler);
	canvas.wrapperEl?.addEventListener("pointercancel", cancelHandler);
	canvas.wrapperEl?.addEventListener("lostpointercapture", cancelHandler);

	return () => {
		clearDragSession();
		canvas.wrapperEl?.removeEventListener("pointerdown", downHandler, true);
		canvas.wrapperEl?.removeEventListener("pointermove", moveHandler);
		canvas.wrapperEl?.removeEventListener("pointerup", upHandler);
		canvas.wrapperEl?.removeEventListener("pointercancel", cancelHandler);
		canvas.wrapperEl?.removeEventListener("lostpointercapture", cancelHandler);
	};
}
