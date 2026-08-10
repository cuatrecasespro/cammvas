import type { Canvas, CanvasNode } from "../types/canvas-internal";
import { CanvasAPI } from "../canvas/canvas-api";
import { buildForest, findTreeForNode, countChildrenPerSide, BranchDirection } from "./tree-model";
import { collectDescendantIds } from "../canvas/drag-reparent-state";

export interface NodeOpsConfig {
	nodeWidth: number;
	nodeHeight: number;
	horizontalGap: number;
	verticalGap: number;
}

/**
 * Core mind map node operations: add child, add sibling, delete.
 */
export class NodeOperations {
	constructor(
		private canvasApi: CanvasAPI,
		private config: NodeOpsConfig
	) {}

	/**
	 * Add a child node to the selected node.
	 * If parent is root, places on the side with fewer children (ties go right).
	 * If parent is non-root, inherits direction from its branch.
	 * Returns the new node so the caller can start editing it.
	 */
	addChild(canvas: Canvas, parentNode: CanvasNode): CanvasNode | null {
		const forest = buildForest(canvas);
		const parentTreeNode = findTreeForNode(forest, parentNode.id);
		const isRoot = parentTreeNode && !parentTreeNode.parent;

		// Determine direction for the new child
		let direction: BranchDirection;
		if (isRoot && parentTreeNode) {
			const counts = countChildrenPerSide(parentTreeNode);
			direction = counts.left < counts.right ? "left" : "right";
		} else {
			direction = this.detectDirection(canvas, parentNode);
		}

		const existingChildren = this.canvasApi.getChildNodes(canvas, parentNode);

		// Position depends on direction
		let x: number;
		if (direction === "right") {
			x = parentNode.x + parentNode.width + this.config.horizontalGap;
		} else {
			x = parentNode.x - this.config.nodeWidth - this.config.horizontalGap;
		}

		// Position below the last same-side child, or vertically centered with parent
		let y: number;
		if (existingChildren.length > 0) {
			// Filter children on the same side
			const sameSideChildren = existingChildren.filter(c => {
				const childCx = c.x + c.width / 2;
				const parentCx = parentNode.x + parentNode.width / 2;
				return direction === "right" ? childCx > parentCx : childCx < parentCx;
			});
			if (sameSideChildren.length > 0) {
				const lastChild = sameSideChildren[sameSideChildren.length - 1];
				y = lastChild.y + lastChild.height + this.config.verticalGap;
			} else {
				y = parentNode.y + (parentNode.height - this.config.nodeHeight) / 2;
			}
		} else {
			y = parentNode.y + (parentNode.height - this.config.nodeHeight) / 2;
		}

		const newNode = this.canvasApi.createTextNode(
			canvas, x, y, "", this.config.nodeWidth, this.config.nodeHeight
		);

		if (parentNode.color) newNode.setColor(parentNode.color);

		if (direction === "right") {
			this.canvasApi.createEdge(canvas, parentNode, newNode, "right", "left", parentNode.color || undefined);
		} else {
			this.canvasApi.createEdge(canvas, parentNode, newNode, "left", "right", parentNode.color || undefined);
		}

		canvas.requestSave();
		return newNode;
	}

	/**
	 * Add a sibling node below the selected node (same parent).
	 * Inherits the branch direction from the current node.
	 * Returns the new node.
	 */
	addSibling(canvas: Canvas, currentNode: CanvasNode): CanvasNode | null {
		const parent = this.canvasApi.getParentNode(canvas, currentNode);
		if (!parent) {
			// Root node — can't add sibling, add child instead
			return this.addChild(canvas, currentNode);
		}

		const direction = this.detectDirection(canvas, currentNode);

		// Position below the current node, same x
		const x = currentNode.x;
		const y = currentNode.y + currentNode.height + this.config.verticalGap;

		const newNode = this.canvasApi.createTextNode(
			canvas, x, y, "", this.config.nodeWidth, this.config.nodeHeight
		);

		if (currentNode.color) newNode.setColor(currentNode.color);

		if (direction === "right") {
			this.canvasApi.createEdge(canvas, parent, newNode, "right", "left", currentNode.color || undefined);
		} else {
			this.canvasApi.createEdge(canvas, parent, newNode, "left", "right", currentNode.color || undefined);
		}

		canvas.requestSave();
		return newNode;
	}

	/** Replace a node's incoming edge while preserving its complete subtree. */
	reparent(canvas: Canvas, node: CanvasNode, newParent: CanvasNode): boolean {
		if (node.id === newParent.id) return false;

		const descendants = collectDescendantIds(
			node.id,
			(nodeId) => this.canvasApi.getOutgoingEdges(canvas, nodeId).map((edge) => edge.to.node.id)
		);
		if (descendants.has(newParent.id)) return false;

		const incomingEdges = this.canvasApi.getConnectedEdges(canvas, node)
			.filter((edge) => edge.to.node.id === node.id);
		if (incomingEdges.length === 1 && incomingEdges[0].from.node.id === newParent.id) {
			return false;
		}

		for (const edge of incomingEdges) canvas.removeEdge(edge);
		this.canvasApi.invalidateEdgeIndex();

		const nodeCenterX = node.x + node.width / 2;
		const parentCenterX = newParent.x + newParent.width / 2;
		if (nodeCenterX >= parentCenterX) {
			this.canvasApi.createEdge(canvas, newParent, node, "right", "left", newParent.color || undefined);
		} else {
			this.canvasApi.createEdge(canvas, newParent, node, "left", "right", newParent.color || undefined);
		}

		return true;
	}

	/** Delete a non-root node, reconnect its children, and return its parent. */
	deleteAndFocusParent(canvas: Canvas, currentNode: CanvasNode): CanvasNode | null {
		const parent = this.canvasApi.getParentNode(canvas, currentNode);
		if (!parent) return null;

		const direction = this.detectDirection(canvas, currentNode);
		for (const child of this.canvasApi.getChildNodes(canvas, currentNode)) {
			if (direction === "right") {
				this.canvasApi.createEdge(canvas, parent, child, "right", "left");
			} else {
				this.canvasApi.createEdge(canvas, parent, child, "left", "right");
			}
		}

		this.canvasApi.removeNode(canvas, currentNode);
		canvas.requestSave();
		return parent;
	}

	/**
	 * Flip a branch to the other side of its parent.
	 * Mirrors the node and all descendants horizontally around the parent's center X.
	 * Returns the parent node (for caller to trigger restack/layout).
	 */
	flipBranch(canvas: Canvas, node: CanvasNode): CanvasNode | null {
		const parent = this.canvasApi.getParentNode(canvas, node);
		if (!parent) return null;

		const parentCx = parent.x + parent.width / 2;

		// Collect node + all descendants via BFS
		const allNodes = [node];
		const visited = new Set<string>([node.id]);
		const queue = [node.id];
		while (queue.length > 0) {
			const id = queue.shift()!;
			for (const edge of this.canvasApi.getOutgoingEdges(canvas, id)) {
				const childId = edge.to.node.id;
				if (!visited.has(childId)) {
					visited.add(childId);
					allNodes.push(edge.to.node);
					queue.push(childId);
				}
			}
		}

		// Mirror each node's X around parent's center
		for (const n of allNodes) {
			const newX = 2 * parentCx - n.x - n.width;
			n.moveTo({ x: newX, y: n.y });
		}

		return parent;
	}

	/**
	 * Detect the branch direction of a node based on actual positions.
	 * If node has children, uses their position. Otherwise, uses parent position.
	 */
	private detectDirection(canvas: Canvas, node: CanvasNode): BranchDirection {
		const nodeCx = node.x + node.width / 2;

		// If node has children, direction matches where they actually are
		const existingChildren = this.canvasApi.getChildNodes(canvas, node);
		if (existingChildren.length > 0) {
			const firstChildCx = existingChildren[0].x + existingChildren[0].width / 2;
			return firstChildCx < nodeCx ? "left" : "right";
		}

		// No children — determine from parent position (which side of parent am I on?)
		const parent = this.canvasApi.getParentNode(canvas, node);
		if (parent) {
			const parentCx = parent.x + parent.width / 2;
			return nodeCx < parentCx ? "left" : "right";
		}

		return "right";
	}
}
