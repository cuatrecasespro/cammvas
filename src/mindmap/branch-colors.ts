import type { Canvas, CanvasNode, CanvasEdge } from "../types/canvas-internal";
import { CanvasAPI } from "../canvas/canvas-api";
import { buildForest, TreeNode } from "./tree-model";
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
	 * Color a single branch (node + all descendants + edges).
	 */
	private colorBranch(canvas: Canvas, node: TreeNode, color: string): void {
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
