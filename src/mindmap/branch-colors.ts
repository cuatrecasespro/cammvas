import type { Canvas, CanvasNode, CanvasEdge } from "../types/canvas-internal";
import { CanvasAPI } from "../canvas/canvas-api";
import { buildForest, findTreeForNode, TreeNode } from "./tree-model";
import { DEFAULT_BRANCH_PALETTE, getBranchNodeColor, normalizePalette } from "./color-palette";

/**
 * Assigns distinct colors to top-level branches and cascades to descendants.
 */
export class BranchColors {
	private palette: string[];

	constructor(
		private canvasApi: CanvasAPI,
		palette: string[] = DEFAULT_BRANCH_PALETTE,
		private colorLeafNodes: boolean = true
	) {
		this.palette = normalizePalette(palette);
	}

	/**
	 * Apply auto-coloring to all branches.
	 */
	applyColors(canvas: Canvas): void {
		const forest = buildForest(canvas);
		if (forest.length === 0) return;
		// Each tree's top-level branches get distinct colors
		for (const root of forest) {
			root.children.forEach((child, index) => {
				const color = this.palette[index % this.palette.length];
				this.colorBranch(canvas, child, color);
			});
		}

		canvas.requestSave();
		canvas.requestFrame();
	}

	/**
	 * Complete colors for connections added directly in Canvas. Existing branch
	 * colors take precedence, so manually colored branches remain unchanged.
	 */
	inheritConnectionColors(canvas: Canvas): boolean {
		let changed = false;
		for (const edge of canvas.edges.values()) {
			const color = edge.from.node.color || this.findIncomingEdge(canvas, edge.from.node)?.color;
			if (!color) continue;
			if (!edge.color) {
				edge.setColor(color);
				changed = true;
			}
			if (!edge.to.node.color) {
				edge.to.node.setColor(color);
				changed = true;
			}
		}
		return changed;
	}

	/** Apply a native Canvas color to this node and its descendants. */
	setBranchColor(canvas: Canvas, nodeId: string, color: string): void {
		const forest = buildForest(canvas);
		const node = findTreeForNode(forest, nodeId);
		if (!node) return;

		this.colorBranch(canvas, node, color);
		canvas.requestSave();
		canvas.requestFrame();
	}

	/**
	 * Color a single branch (node + all descendants + edges).
	 */
	private colorBranch(
		canvas: Canvas,
		node: TreeNode,
		color: string
	): void {
		// A neutral leaf remains visually distinct while its incoming edge
		// keeps the branch color and still communicates its ancestry.
		node.canvasNode.setColor(getBranchNodeColor(color, node.children.length, this.colorLeafNodes));

		// Color the edge connecting to this node from its parent
		const incomingEdge = this.findIncomingEdge(canvas, node.canvasNode);
		if (incomingEdge) {
			incomingEdge.setColor(color);
		}

		// Recurse into all descendants
		for (const child of node.children) {
			this.colorBranch(canvas, child, color);
		}
	}

	/**
	 * Find the edge pointing TO this node.
	 */
	private findIncomingEdge(
		canvas: Canvas,
		node: CanvasNode
	): CanvasEdge | null {
		const edges = this.canvasApi.getConnectedEdges(canvas, node);
		return edges.find(e => e.to.node.id === node.id) ?? null;
	}

}
