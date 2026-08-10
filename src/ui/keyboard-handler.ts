import { Platform, Plugin } from "obsidian";
import type { Canvas, CanvasNode, CMEditorView, CMContentElement } from "../types/canvas-internal";
import { CanvasAPI } from "../canvas/canvas-api";
import { NodeOperations } from "../mindmap/node-operations";
import { LayoutEngine } from "../mindmap/layout-engine";
import { BranchColors } from "../mindmap/branch-colors";
import { COLLAPSED_HIDDEN_CLASS } from "../canvas/branch-collapse";
import {
	buildForest,
	findTreeForNode,
	getNextSibling,
	getPrevSibling,
	getGroupIds,
	TreeNode,
} from "../mindmap/tree-model";
import { findNearestNodeInDirection, SpatialDirection } from "./spatial-navigation";
import { shouldCreateChildOnTab, shouldCreateSiblingOnEnter } from "./editing-enter";
import { isNodeEditorFocused } from "./editing-state";

/**
 * Registers all mind map keyboard shortcuts on the canvas.
 */
export class KeyboardHandler {
	/** Called before actions that leave the current node, to finalize auto-resize. */
	onBeforeLeaveNode: (() => void) | null = null;
	/** Padding (px) added around target node when zooming after navigation. */
	zoomPadding: number = 0;
	private arrowKeySelectionOnly = false;
	private arrowNavigationCanvas: Canvas | null = null;
	private arrowKeyRestorers: Array<() => void> = [];

	constructor(
		private plugin: Plugin,
		private canvasApi: CanvasAPI,
		public nodeOps: NodeOperations,
		public layoutEngine: LayoutEngine,
		public branchColors: BranchColors,
		private autoColorEnabled: () => boolean,
		private autoLayoutEnabled: () => boolean,
		private arrowKeyNavigationEnabled: () => boolean,
		private enterCreatesSiblingEnabled: () => boolean,
		private isMindmapEnabled: (canvas: Canvas) => boolean = () => true,
		private onNodesChanged: (canvas: Canvas) => void = () => {}
	) {}

	register(): void {
		// Enter → Edit selected node (cursor at end)
		this.plugin.addCommand({
			id: "mindmap-edit-node",
			name: "Edit selected node",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				// Don't consume Enter when focus is outside the canvas (e.g. outline rename)
				const activeEl = canvas.wrapperEl.doc.activeElement;
				if (activeEl && !canvas.wrapperEl.contains(activeEl)) return false;
				const node = this.canvasApi.getSelectedNode(canvas);
				if (!node) return false;
				if (node.isEditing) return false;
				if (checking) return true;

				node.startEditing();
			},
		});

		// Ctrl+S → Save and exit edit mode
		this.plugin.addCommand({
			id: "mindmap-save-node",
			name: "Save and exit edit mode",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				const node = this.canvasApi.getSelectedNode(canvas);
				if (!node) return false;
				if (!node.isEditing) return false;
				if (checking) return true;

				this.onBeforeLeaveNode?.();
				node.blur();
			},
		});

		// Create child node
		this.plugin.addCommand({
			id: "mindmap-add-child",
			name: "Add child node",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				const node = this.canvasApi.getSelectedNode(canvas);
				if (!node) return false;
				if (checking) return true;

				let selectedText: string | null = null;
				if (node.isEditing) {
					selectedText = this.extractAndDeleteSelection(node);
				}
				this.onBeforeLeaveNode?.();
				const newNode = this.nodeOps.addChild(canvas, node);
				if (newNode) {
					if (selectedText) newNode.setText(selectedText);
					if (this.autoLayoutEnabled()) {
						this.layoutEngine.layoutChildren(canvas, node.id, new Set([newNode.id]));
					}
					if (this.autoColorEnabled() && this.isMindmapEnabled(canvas)) {
						this.branchColors.applyColors(canvas);
					}
					this.onNodesChanged(canvas);
					this.canvasApi.selectAndEdit(canvas, newNode, this.zoomPadding);
				}
			},
		});

		// Create sibling node
		this.plugin.addCommand({
			id: "mindmap-add-sibling",
			name: "Add sibling node",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				const node = this.canvasApi.getSelectedNode(canvas);
				if (!node) return false;
				if (checking) return true;

				let selectedText: string | null = null;
				if (node.isEditing) {
					selectedText = this.extractAndDeleteSelection(node);
				}
				this.onBeforeLeaveNode?.();
				const newNode = this.nodeOps.addSibling(canvas, node);
				if (newNode) {
					if (selectedText) newNode.setText(selectedText);
					const parent = this.canvasApi.getParentNode(canvas, node);
					if (parent) {
						if (this.autoLayoutEnabled()) {
							this.layoutEngine.layoutChildren(canvas, parent.id, new Set([newNode.id]));
						}
					}
					if (this.autoColorEnabled() && this.isMindmapEnabled(canvas)) {
						this.branchColors.applyColors(canvas);
					}
					this.onNodesChanged(canvas);
					this.canvasApi.selectAndEdit(canvas, newNode, this.zoomPadding);
				}
			},
		});

		// Ctrl+Shift+Enter → Delete node, focus parent
		this.plugin.addCommand({
			id: "mindmap-delete-node",
			name: "Delete node and focus parent",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				const node = this.canvasApi.getSelectedNode(canvas);
				if (!node) return false;
				if (checking) return true;

				this.onBeforeLeaveNode?.();
				const parent = this.nodeOps.deleteAndFocusParent(canvas, node);
				if (parent) {
					if (this.autoLayoutEnabled()) this.layoutEngine.layoutChildren(canvas, parent.id);
					if (this.autoColorEnabled() && this.isMindmapEnabled(canvas)) {
						this.branchColors.applyColors(canvas);
					}
					this.onNodesChanged(canvas);
					this.canvasApi.selectAndEdit(canvas, parent, this.zoomPadding);
				}
			},
		});

		// Ctrl+Shift+S → Swap/flip branch to other side
		this.plugin.addCommand({
			id: "mindmap-flip-branch",
			name: "Flip branch to other side",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				if (!this.isMindmapEnabled(canvas)) return false;
				const node = this.canvasApi.getSelectedNode(canvas);
				if (!node) return false;
				const parent = this.canvasApi.getParentNode(canvas, node);
				if (!parent) return false;
				if (checking) return true;

				const wasEditing = node.isEditing;
				if (!wasEditing) this.onBeforeLeaveNode?.();
				const parentNode = this.nodeOps.flipBranch(canvas, node);
				if (parentNode) {
					this.layoutEngine.layoutChildren(canvas, parentNode.id);
					if (this.autoColorEnabled()) {
						this.branchColors.applyColors(canvas);
					}
					this.onNodesChanged(canvas);
					if (wasEditing) node.startEditing();
				}
			},
		});

		// Ctrl+Shift+D → Toggle balanced layout (distribute children on both sides)
		this.plugin.addCommand({
			id: "mindmap-toggle-balance",
			name: "Toggle balanced layout",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				if (!this.isMindmapEnabled(canvas)) return false;
				const node = this.canvasApi.getSelectedNode(canvas);
				if (!node) return false;
				const children = this.canvasApi.getChildNodes(canvas, node);
				if (children.length < 2) return false;
				if (checking) return true;

				this.onBeforeLeaveNode?.();

				const nodeCx = node.x + node.width / 2;

				// Check if all children are on one side
				let allRight = true;
				let allLeft = true;
				for (const child of children) {
					const childCx = child.x + child.width / 2;
					if (childCx >= nodeCx) allLeft = false;
					else allRight = false;
				}
				const allOneSide = allRight || allLeft;

				if (allOneSide) {
					// Balance: distribute evenly, alternating right/left
					const sorted = [...children].sort((a, b) => a.y - b.y);
					for (let i = 0; i < sorted.length; i++) {
						const child = sorted[i];
						if (i % 2 === 1) {
							// Move to the other side
							const mirrorX = nodeCx - (child.x + child.width / 2 - nodeCx) - child.width / 2;
							child.moveTo({ x: mirrorX, y: child.y });
						}
					}
				} else {
					// Collapse all to right side
					for (const child of children) {
						const childCx = child.x + child.width / 2;
						if (childCx < nodeCx) {
							const mirrorX = nodeCx + (nodeCx - childCx) - child.width / 2;
							child.moveTo({ x: mirrorX, y: child.y });
						}
					}
				}

				// Re-layout to clean up positions
				this.layoutEngine.layoutChildren(canvas, node.id);
				if (this.autoColorEnabled()) {
					this.branchColors.applyColors(canvas);
				}
				this.onNodesChanged(canvas);
			},
		});

		// Ctrl+Alt+Right → Navigate spatially right
		this.plugin.addCommand({
			id: "mindmap-nav-right",
			name: "Navigate right",
			checkCallback: (checking: boolean) => {
				return this.navigateCommand(checking, (tree) => {
					if (!tree.direction) {
						// Root: go to nearest right-side child
						const rightChildren = tree.children.filter(c => c.direction === "right");
						return this.nearestChild(tree, rightChildren);
					}
					// Non-root: use actual positions
					const nodeCx = tree.canvasNode.x + tree.canvasNode.width / 2;
					if (tree.children.length > 0) {
						const childCx = tree.children[0].canvasNode.x + tree.children[0].canvasNode.width / 2;
						if (childCx >= nodeCx) return this.nearestChild(tree); // children are to the right
						// Children are to the left → right goes to parent
						return tree.parent?.canvasNode ?? null;
					}
					// Leaf: right goes to parent if parent is to the right
					if (tree.parent) {
						const parentCx = tree.parent.canvasNode.x + tree.parent.canvasNode.width / 2;
						if (parentCx >= nodeCx) return tree.parent.canvasNode;
					}
					return null;
				}, "right");
			},
		});

		// Ctrl+Alt+Left → Navigate spatially left
		this.plugin.addCommand({
			id: "mindmap-nav-left",
			name: "Navigate left",
			checkCallback: (checking: boolean) => {
				return this.navigateCommand(checking, (tree) => {
					if (!tree.direction) {
						// Root: go to nearest left-side child
						const leftChildren = tree.children.filter(c => c.direction === "left");
						return this.nearestChild(tree, leftChildren);
					}
					// Non-root: use actual positions
					const nodeCx = tree.canvasNode.x + tree.canvasNode.width / 2;
					if (tree.children.length > 0) {
						const childCx = tree.children[0].canvasNode.x + tree.children[0].canvasNode.width / 2;
						if (childCx < nodeCx) return this.nearestChild(tree); // children are to the left
						// Children are to the right → left goes to parent
						return tree.parent?.canvasNode ?? null;
					}
					// Leaf: left goes to parent if parent is to the left
					if (tree.parent) {
						const parentCx = tree.parent.canvasNode.x + tree.parent.canvasNode.width / 2;
						if (parentCx < nodeCx) return tree.parent.canvasNode;
					}
					return null;
				}, "left");
			},
		});

		// Ctrl+Alt+Down → Navigate to next sibling (side-aware if balanced, Y-order if single-side)
		this.plugin.addCommand({
			id: "mindmap-nav-next-sibling",
			name: "Navigate to next sibling",
			checkCallback: (checking: boolean) => {
				return this.navigateCommand(checking, (tree) => {
					if (!tree.parent) return null;
					// Try balanced navigation for two-sided layouts
					const balanced = this.balancedSiblingNav(tree, "down");
					if (balanced) return balanced;
					// Fall back to Y-order for vertical stacks
					const next = getNextSibling(tree);
					if (next) return next.canvasNode;
					return tree.parent.children[0].canvasNode;
				}, "down");
			},
		});

		// Ctrl+Alt+Up → Navigate to previous sibling (side-aware if balanced, Y-order if single-side)
		this.plugin.addCommand({
			id: "mindmap-nav-prev-sibling",
			name: "Navigate to previous sibling",
			checkCallback: (checking: boolean) => {
				return this.navigateCommand(checking, (tree) => {
					if (!tree.parent) return null;
					// Try balanced navigation for two-sided layouts
					const balanced = this.balancedSiblingNav(tree, "up");
					if (balanced) return balanced;
					// Fall back to Y-order for vertical stacks
					const prev = getPrevSibling(tree);
					if (prev) return prev.canvasNode;
					const siblings = tree.parent.children;
					return siblings[siblings.length - 1].canvasNode;
				}, "up");
			},
		});

		// Register physical-key fallback for non-Latin keyboard layouts
		this.registerPhysicalKeyShortcuts();
		this.plugin.register(() => this.unregisterArrowKeyNavigation());
	}

	handleEditingEnter(canvas: Canvas, event: KeyboardEvent): boolean {
		const node = this.canvasApi.getSelectedNode(canvas);
		if (!node || !this.isMindmapEnabled(canvas)) return false;
		if (!shouldCreateSiblingOnEnter(event, this.enterCreatesSiblingEnabled(), node.isEditing)) {
			return false;
		}

		const executeCommand = this.getCommandExecutor();
		if (!executeCommand) return false;
		event.preventDefault();
		event.stopImmediatePropagation();
		executeCommand("cammvas:mindmap-add-sibling");
		return true;
	}

	handleChildTab(canvas: Canvas, event: KeyboardEvent): boolean {
		const node = this.canvasApi.getSelectedNode(canvas);
		if (!node || !this.isMindmapEnabled(canvas)) return false;
		if (!shouldCreateChildOnTab(event, this.enterCreatesSiblingEnabled(), true)) return false;

		const executeCommand = this.getCommandExecutor();
		if (!executeCommand) return false;
		event.preventDefault();
		event.stopImmediatePropagation();
		executeCommand("cammvas:mindmap-add-child");
		return true;
	}

	registerArrowKeyNavigation(canvas: Canvas): void {
		this.unregisterArrowKeyNavigation();
		const commandIds: ReadonlyArray<readonly [string, string]> = [
			["ArrowRight", "cammvas:mindmap-nav-right"],
			["ArrowLeft", "cammvas:mindmap-nav-left"],
			["ArrowDown", "cammvas:mindmap-nav-next-sibling"],
			["ArrowUp", "cammvas:mindmap-nav-prev-sibling"],
		];

		const entries = canvas.view.scope?.keys;
		if (!entries) return;

		for (const [key, commandId] of commandIds) {
			const entry = entries.find(
				(candidate) => candidate.key === key && candidate.modifiers === ""
			);
			if (!entry) continue;
			const original = entry.func;
			const replacement = (event: KeyboardEvent, context?: unknown): unknown => {
				const node = this.canvasApi.getSelectedNode(canvas);
				if (!this.arrowKeyNavigationEnabled()
					|| !this.isMindmapEnabled(canvas)
					|| !node
					|| isNodeEditorFocused(node)) {
					return original(event, context);
				}

				const executeCommand = this.getCommandExecutor();
				if (!executeCommand) return original(event, context);
				event.preventDefault();
				this.arrowKeySelectionOnly = true;
				this.arrowNavigationCanvas = canvas;
				try {
					executeCommand(commandId);
				} finally {
					this.arrowKeySelectionOnly = false;
					this.arrowNavigationCanvas = null;
				}
				return false;
			};
			entry.func = replacement;
			this.arrowKeyRestorers.push(() => {
				if (entry.func === replacement) entry.func = original;
			});
		}

		this.registerCanvasKeyOverride(
			canvas,
			"Enter",
			(event) => this.handleEditingEnter(canvas, event)
		);
		this.registerCanvasKeyOverride(
			canvas,
			"Tab",
			(event) => this.handleChildTab(canvas, event)
		);
	}

	private registerCanvasKeyOverride(
		canvas: Canvas,
		key: string,
		handle: (event: KeyboardEvent) => boolean
	): void {
		const scope = canvas.view.scope;
		const existing = scope.keys.find(
			(candidate) => candidate.key === key && candidate.modifiers === ""
		);
		const original = existing?.func;
		const replacement = (event: KeyboardEvent, context?: unknown): unknown => {
			if (handle(event)) return false;
			if (original) return original(event, context);
			return scope.parent?.handleKey(event, context);
		};

		if (existing) {
			existing.func = replacement;
			this.arrowKeyRestorers.push(() => {
				if (existing.func === replacement) existing.func = original!;
			});
			return;
		}

		const entry = scope.register([], key, replacement);
		this.arrowKeyRestorers.push(() => scope.unregister(entry));
	}

	unregisterArrowKeyNavigation(): void {
		for (const restore of this.arrowKeyRestorers) restore();
		this.arrowKeyRestorers = [];
		this.arrowNavigationCanvas = null;
	}

	/**
	 * Access the CodeMirror 6 EditorView inside a canvas node's iframe.
	 */
	private getEditorView(node: CanvasNode): CMEditorView | null {
		const iframe = node.contentEl?.querySelector<HTMLIFrameElement>("iframe");
		const doc = iframe?.contentDocument ?? node.contentEl?.ownerDocument;
		if (!doc) return null;
		const container = iframe?.contentDocument ?? node.contentEl;
		const cmContent = container?.querySelector<CMContentElement>(".cm-content");
		return cmContent?.cmView?.view ?? null;
	}

	/**
	 * Extract the selected text from a node's editor and delete it.
	 * Returns the selected text, or null if nothing is selected.
	 */
	private extractAndDeleteSelection(node: CanvasNode): string | null {
		const view = this.getEditorView(node);
		if (!view) return null;
		const { from, to } = view.state.selection.main;
		if (from === to) return null;
		const text = view.state.sliceDoc(from, to);
		view.dispatch({ changes: { from, to, insert: "" } });
		return text;
	}

	/**
	 * Fallback keydown listener that uses event.code (physical key position)
	 * instead of event.key (character). Activates only when a non-Latin layout
	 * is detected (event.key doesn't match the expected Latin character),
	 * so it won't double-fire with Obsidian's built-in hotkey system.
	 */
	private registerPhysicalKeyShortcuts(): void {
		const shortcuts = [
			{ code: "Period", key: ".", ctrl: true, shift: false, alt: false, cmdId: "cammvas:mindmap-add-child" },
			{ code: "KeyS", key: "s", ctrl: true, shift: false, alt: false, cmdId: "cammvas:mindmap-save-node" },
			{ code: "KeyS", key: "s", ctrl: true, shift: true, alt: false, cmdId: "cammvas:mindmap-flip-branch" },
			{ code: "KeyD", key: "d", ctrl: true, shift: true, alt: false, cmdId: "cammvas:mindmap-toggle-balance" },
			{ code: "KeyL", key: "l", ctrl: true, shift: true, alt: false, cmdId: "cammvas:mindmap-resize-subtree" },
			{ code: "KeyR", key: "r", ctrl: true, shift: true, alt: true, cmdId: "cammvas:mindmap-resize-all" },
		];

		const keydownHandler = (e: KeyboardEvent): void => {
			const canvas = this.canvasApi.getActiveCanvas();
			if (!canvas) return;
			const ctrlOrCmd = Platform.isMacOS ? e.metaKey : e.ctrlKey;
			if (!ctrlOrCmd) return;

			// Undo/Redo fallback for non-Latin layouts
			if (e.code === "KeyZ" && !e.altKey && e.key.toLowerCase() !== "z") {
				e.preventDefault();
				e.stopPropagation();
				if (e.shiftKey) {
					canvas.redo?.();
				} else {
					canvas.undo?.();
				}
				return;
			}
			if (e.code === "KeyY" && !e.shiftKey && !e.altKey && e.key.toLowerCase() !== "y") {
				e.preventDefault();
				e.stopPropagation();
				canvas.redo?.();
				return;
			}

			const executeCommand = this.getCommandExecutor();
			if (!executeCommand) return;

			for (const s of shortcuts) {
				if (
					e.code === s.code &&
					ctrlOrCmd === s.ctrl &&
					e.shiftKey === s.shift &&
					e.altKey === s.alt
				) {
					// If event.key matches expected Latin char, Obsidian's
					// hotkey system will handle it — don't double-fire
					if (e.key.toLowerCase() === s.key) return;
					// Non-Latin layout: Obsidian won't match, so we handle it
					e.preventDefault();
					e.stopPropagation();
					executeCommand(s.cmdId);
					return;
				}
			}
		};
		const registerDocument = (doc: Document): void => {
			this.plugin.registerDomEvent(doc, "keydown", keydownHandler);
		};
		registerDocument(this.plugin.app.workspace.containerEl.doc);
		this.plugin.registerEvent(this.plugin.app.workspace.on("window-open", (_workspace, win) => {
			registerDocument(win.document);
		}));
	}

	private getCommandExecutor(): ((id: string) => boolean) | null {
		const app: unknown = this.plugin.app;
		if (!this.hasCommandExecutor(app)) return null;
		return (id: string) => Boolean(app.commands.executeCommandById(id));
	}

	private hasCommandExecutor(value: unknown): value is {
		commands: { executeCommandById: (id: string) => unknown };
	} {
		if (typeof value !== "object" || value === null || !("commands" in value)) return false;
		const commands: unknown = value.commands;
		return typeof commands === "object"
			&& commands !== null
			&& "executeCommandById" in commands
			&& typeof commands.executeCommandById === "function";
	}

	/**
	 * Navigate to a sibling using side-aware Y-order for balanced (two-sided) layouts.
	 * Within the same side, moves to the next/prev sibling by Y position.
	 * At the boundary, crosses to the other side's extreme (top↔top, bottom↔bottom).
	 * Returns null if siblings are all on one side (caller should fall back to Y-order).
	 */
	private balancedSiblingNav(tree: TreeNode, direction: "up" | "down"): CanvasNode | null {
		if (!tree.parent || tree.parent.children.length < 2) return null;

		const siblings = tree.parent.children;
		const parentNode = tree.parent.canvasNode;
		const parentCx = parentNode.x + parentNode.width / 2;

		// Partition siblings into left and right sides, sorted by Y ascending
		const leftSiblings: TreeNode[] = [];
		const rightSiblings: TreeNode[] = [];
		for (const s of siblings) {
			const sCx = s.canvasNode.x + s.canvasNode.width / 2;
			if (sCx < parentCx) leftSiblings.push(s);
			else rightSiblings.push(s);
		}

		if (leftSiblings.length === 0 || rightSiblings.length === 0) return null; // single side → use Y-order

		const byCy = (a: TreeNode, b: TreeNode) =>
			(a.canvasNode.y + a.canvasNode.height / 2) - (b.canvasNode.y + b.canvasNode.height / 2);
		leftSiblings.sort(byCy);
		rightSiblings.sort(byCy);

		// Determine which side the current node is on
		const currentCx = tree.canvasNode.x + tree.canvasNode.width / 2;
		const sameSide = currentCx < parentCx ? leftSiblings : rightSiblings;
		const otherSide = currentCx < parentCx ? rightSiblings : leftSiblings;

		const idx = sameSide.indexOf(tree);
		if (idx === -1) return null;

		if (direction === "down") {
			if (idx < sameSide.length - 1) return sameSide[idx + 1].canvasNode;
			// At bottommost → jump to bottommost on other side
			return otherSide[otherSide.length - 1].canvasNode;
		} else {
			if (idx > 0) return sameSide[idx - 1].canvasNode;
			// At topmost → jump to topmost on other side
			return otherSide[0].canvasNode;
		}
	}

	/**
	 * Find the child whose vertical center is closest to the current node's.
	 */
	private nearestChild(tree: TreeNode, candidates?: TreeNode[]): CanvasNode | null {
		const children = candidates ?? tree.children;
		if (children.length === 0) return null;

		const nodeCy = tree.canvasNode.y + tree.canvasNode.height / 2;
		let best = children[0];
		let bestDist = Math.abs((best.canvasNode.y + best.canvasNode.height / 2) - nodeCy);

		for (let i = 1; i < children.length; i++) {
			const childCy = children[i].canvasNode.y + children[i].canvasNode.height / 2;
			const dist = Math.abs(childCy - nodeCy);
			if (dist < bestDist) {
				best = children[i];
				bestDist = dist;
			}
		}

		return best.canvasNode;
	}

	/**
	 * Helper for navigation commands.
	 */
	private navigateCommand(
		checking: boolean,
		getTarget: (tree: TreeNode) => CanvasNode | null,
		spatialDirection: SpatialDirection
	): boolean {
		const canvas = this.arrowNavigationCanvas ?? this.canvasApi.getActiveCanvas();
		if (!canvas) return false;

		const node = this.canvasApi.getSelectedNode(canvas);
		if (!node) return false;

		// Short-circuit: avoid expensive buildForest during frequent checking calls
		if (checking) return true;

		const forest = buildForest(canvas);
		if (forest.length === 0) return false;

		const treeNode = findTreeForNode(forest, node.id);
		if (!treeNode) return false;

		const groupIds = getGroupIds(canvas);
		const spatialCandidates = Array.from(canvas.nodes.values()).filter(
			(candidate) => !groupIds.has(candidate.id)
				&& !candidate.nodeEl.hasClass(COLLAPSED_HIDDEN_CLASS)
		);
		const target = getTarget(treeNode)
			?? findNearestNodeInDirection(node, spatialCandidates, spatialDirection)
			?? node;
		if (target.id === node.id) return true;
		if (target.nodeEl.hasClass(COLLAPSED_HIDDEN_CLASS)) return false;

		this.onBeforeLeaveNode?.();
		if (!this.arrowKeySelectionOnly) {
			// Explicit navigation commands preserve their existing relayout behavior.
			let root = treeNode;
			while (root.parent) root = root.parent;
			if (this.autoLayoutEnabled()) this.layoutEngine.layoutChildren(canvas, root.canvasNode.id);
			this.onNodesChanged(canvas);
		}
		if (this.arrowKeySelectionOnly) {
			this.canvasApi.selectAndZoom(canvas, target, this.zoomPadding);
		} else {
			this.canvasApi.selectAndEdit(canvas, target, this.zoomPadding);
		}
		return true;
	}
}
