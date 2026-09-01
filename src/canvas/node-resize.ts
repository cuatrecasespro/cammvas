import type { Canvas, CanvasNode } from "../types/canvas-internal";
import { buildForest, findTreeForNode, getDescendants, getGroupIds } from "../mindmap/tree-model";
import { isHtmlElement } from "../ui/dom";

interface ResizeState {
	pointerId: number;
	sizes: Map<string, { width: number; height: number }>;
}

export interface NodeResizeResult {
	nodes: CanvasNode[];
	widthChangedNodeIds: ReadonlySet<string>;
}

/** Propagate a manually chosen width to every node at the same tree depth. */
export function syncWidthsAtSameDepth(canvas: Canvas, resizedNodes: CanvasNode[]): CanvasNode[] {
	const forest = buildForest(canvas);
	const widthByLevel = new Map<string, {
		root: import("../mindmap/tree-model").TreeNode;
		depth: number;
		width: number;
	}>();
	for (const node of resizedNodes) {
		const treeNode = findTreeForNode(forest, node.id);
		if (!treeNode) continue;
		let root = treeNode;
		while (root.parent) root = root.parent;
		widthByLevel.set(`${root.canvasNode.id}:${treeNode.depth}`, {
			root,
			depth: treeNode.depth,
			width: node.width,
		});
	}

	const affected = new Map<string, CanvasNode>();
	let changed = false;
	for (const { root, depth, width } of widthByLevel.values()) {
		for (const treeNode of [root, ...getDescendants(root)]) {
			if (treeNode.depth !== depth) continue;
			const node = treeNode.canvasNode;
			affected.set(node.id, node);
			if (Math.abs(node.width - width) < 1) continue;
			node.moveAndResize({
				x: node.x,
				y: node.y,
				width,
				height: node.height,
			});
			changed = true;
		}
	}
	if (changed) canvas.requestSave();
	return Array.from(affected.values());
}

/** Detect completion of Obsidian's native Canvas node-resize gesture. */
export function registerNodeResizeHandler(
	canvas: Canvas,
	isEnabled: () => boolean,
	onSettled: (result: NodeResizeResult) => void
): () => void {
	const wrapper = canvas.wrapperEl;
	const win = wrapper.win;
	let resizeState: ResizeState | null = null;
	let settleRaf = 0;

	const onPointerDown = (event: PointerEvent): void => {
		const target = event.target;
		if (!isHtmlElement(target) || !target.closest(".canvas-node-resizer")) return;
		if (!isEnabled()) return;

		const groupIds = getGroupIds(canvas);
		const nodes = Array.from(canvas.selection)
			.map((item) => canvas.nodes.get(item.id))
			.filter((node): node is CanvasNode => !!node && !groupIds.has(node.id));
		if (nodes.length === 0) return;

		resizeState = {
			pointerId: event.pointerId,
			sizes: new Map(nodes.map((node) => [node.id, {
				width: node.width,
				height: node.height,
			}])),
		};
	};

	const finishResize = (event: PointerEvent): void => {
		const state = resizeState;
		if (!state || event.pointerId !== state.pointerId) return;
		resizeState = null;
		if (settleRaf) win.cancelAnimationFrame(settleRaf);
		settleRaf = win.requestAnimationFrame(() => {
			settleRaf = 0;
			if (!isEnabled()) return;
			const resizedNodes: CanvasNode[] = [];
			const widthChangedNodeIds = new Set<string>();
			for (const [nodeId, size] of state.sizes) {
				const node = canvas.nodes.get(nodeId);
				if (node && Math.abs(node.width - size.width) >= 1) {
					widthChangedNodeIds.add(node.id);
				}
				if (
					node
					&& (Math.abs(node.width - size.width) >= 1
						|| Math.abs(node.height - size.height) >= 1)
				) resizedNodes.push(node);
			}
			if (resizedNodes.length > 0) onSettled({
				nodes: resizedNodes,
				widthChangedNodeIds,
			});
		});
	};

	const cancelResize = (event: PointerEvent): void => {
		if (resizeState && event.pointerId === resizeState.pointerId) resizeState = null;
	};

	wrapper.addEventListener("pointerdown", onPointerDown, true);
	win.addEventListener("pointerup", finishResize, true);
	win.addEventListener("pointercancel", cancelResize, true);
	win.addEventListener("lostpointercapture", cancelResize, true);

	return () => {
		resizeState = null;
		if (settleRaf) win.cancelAnimationFrame(settleRaf);
		settleRaf = 0;
		wrapper.removeEventListener("pointerdown", onPointerDown, true);
		win.removeEventListener("pointerup", finishResize, true);
		win.removeEventListener("pointercancel", cancelResize, true);
		win.removeEventListener("lostpointercapture", cancelResize, true);
	};
}
