import { Plugin, Notice, TFile, TFolder, Menu, Platform, debounce, WorkspaceLeaf, setIcon, ItemView, addIcon } from "obsidian";
import type { Canvas, CanvasNode, CanvasEdge, CreateNodeOptions } from "./types/canvas-internal";
import { CanvasAPI } from "./canvas/canvas-api";
import { NodeOperations } from "./mindmap/node-operations";
import { LayoutEngine, LayoutOrientation } from "./mindmap/layout-engine";
import { BranchColors } from "./mindmap/branch-colors";
import { KeyboardHandler } from "./ui/keyboard-handler";

import { Navigation } from "./ui/navigation";
import {
	MindMapSettings,
	DEFAULT_SETTINGS,
	MindMapSettingTab,
	normalizeSettings,
} from "./settings";
import { registerDragEndHandler } from "./canvas/edge-updater";
import { registerSubtreeDragHandler } from "./canvas/subtree-drag";
import { registerDragReparent } from "./canvas/drag-reparent";
import { registerGroupDragHandler } from "./canvas/group-drag";
import { registerAutoLayoutOnMove } from "./canvas/auto-layout-on-move";
import { createMindmapPdf } from "./export/pdf-export";
import { PdfExportModal } from "./export/pdf-export-modal";
import { registerBranchCollapse, BranchCollapseHandle } from "./canvas/branch-collapse";
import { registerAutoResize, AutoResizeHandle, getEditorElements } from "./ui/auto-resize";
import { OutlineView, OUTLINE_VIEW_TYPE } from "./ui/outline-view";
import { isHtmlElement } from "./ui/dom";
import { copyText } from "./ui/clipboard";
import { registerMobileEditingBar, MobileEditingBarHandle } from "./ui/mobile-editing-bar";
import { freemindToCanvas } from "./import/freemind-import";
import { getGroupIds, buildForest, findTreeForNode } from "./mindmap/tree-model";

export default class CanvasMindMapPlugin extends Plugin {
	settings: MindMapSettings = DEFAULT_SETTINGS;

	private canvasApi!: CanvasAPI;
	private nodeOps!: NodeOperations;
	private layoutEngine!: LayoutEngine;
	private branchColors!: BranchColors;
	private keyboardHandler!: KeyboardHandler;

	private navigation!: Navigation;
	private cleanupClickHandler: (() => void) | null = null;
	private cleanupDragHandler: (() => void) | null = null;
	private cleanupSubtreeDragHandler: (() => void) | null = null;
	private cleanupDragReparentHandler: (() => void) | null = null;
	private cleanupGroupDragHandler: (() => void) | null = null;
	private cleanupAutoLayoutOnMoveHandler: (() => void) | null = null;
	private autoResizeHandle: AutoResizeHandle | null = null;
	private branchCollapseHandle: BranchCollapseHandle | null = null;
	private interceptedCanvas: Canvas | null = null;
	private toggleBtnEl: HTMLElement | null = null;
	private dragReparentBtnEl: HTMLElement | null = null;
	private autoLayoutOnEditBtnEl: HTMLElement | null = null;
	private layoutBtnEl: HTMLElement | null = null;
	private exportPdfBtnEl: HTMLElement | null = null;
	private enterTabBtnEl: HTMLElement | null = null;
	private mobileActionsBtnEl: HTMLElement | null = null;
	private mobileEditingBarHandle: MobileEditingBarHandle | null = null;
	private cleanupGroupBoundsHandler: (() => void) | null = null;
	private cleanupSelectionSyncHandler: (() => void) | null = null;
	private cleanupInsertNodeHandler: (() => void) | null = null;
	/** Pending timers/observers/RAFs to cancel on unload or canvas switch. */
	private pendingTimers = new Set<{ id: number; win: Window }>();
	private pendingRafs = new Set<{ id: number; win: Window }>();
	private pendingObservers: Set<MutationObserver> = new Set();
	private editExitGeneration = 0;
	/** Original canvas methods for unwrapping on cleanup. */
	private origCanvasMethods: {
		requestSave?: () => void;
		createGroupNode?: (options: CreateNodeOptions & { label?: string }) => import("./types/canvas-internal").CanvasNode;
		undo?: () => void;
		redo?: () => void;
		selectOnly?: (item: CanvasNode | CanvasEdge) => void;
	} = {};
	/** Set to true on unload to prevent deferred callbacks from running. */
	private unloaded = false;
	/** Navigation history for back/forward. */
	private navHistory: string[] = [];
	private navHistoryIndex = -1;
	private navSkipTracking = false;
	private lastNavCanvas: Canvas | null = null;
	private cleanupNavHandler: (() => void) | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.registerBranchColorIcons();

		// Initialize core services
		this.canvasApi = new CanvasAPI(this.app);
		this.nodeOps = new NodeOperations(this.canvasApi, {
			nodeWidth: this.settings.defaultNodeWidth,
			nodeHeight: this.settings.defaultNodeHeight,
			horizontalGap: this.settings.horizontalGap,
			verticalGap: this.settings.verticalGap,
		});
		this.layoutEngine = new LayoutEngine({
			horizontalGap: this.settings.horizontalGap,
			verticalGap: this.settings.verticalGap,
			nodeWidth: this.settings.defaultNodeWidth,
			nodeHeight: this.settings.defaultNodeHeight,
		});
		this.branchColors = new BranchColors(
			this.canvasApi,
			this.settings.branchPalette,
			this.settings.colorLeafNodes
		);
		this.navigation = new Navigation(this.canvasApi);

		// Register keyboard shortcuts
		this.keyboardHandler = new KeyboardHandler(
			this,
			this.canvasApi,
			this.nodeOps,
			this.layoutEngine,
			this.branchColors,
			() => this.settings.autoColor,
			() => this.settings.autoLayout,
			() => this.settings.autoLayoutOnEdit,
			() => this.settings.arrowKeyNavigation,
			() => this.settings.centerNodeOnArrowNavigation,
			() => this.settings.enterCreatesSibling,
			(canvas: Canvas) => this.isMindmapCanvas(canvas),
			(canvas: Canvas) => this.updateGroupBounds(canvas)
		);
		this.keyboardHandler.zoomPadding = this.settings.navigationZoomPadding;
		this.keyboardHandler.register();

		// Command: Re-layout entire mind map
		this.addCommand({
			id: "mindmap-relayout",
			name: "Re-layout mind map",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				if (!this.isMindmapCanvas(canvas)) return false;
				if (checking) return true;
				this.layoutEngine.layout(canvas);
				this.updateGroupBounds(canvas);
			},
		});

		this.addCommand({
			id: "mindmap-relayout-selected-branch",
			name: "Re-layout selected branch",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas || !this.isMindmapCanvas(canvas)) return false;
				const node = this.canvasApi.getSelectedNode(canvas);
				if (!node || this.canvasApi.getChildNodes(canvas, node).length === 0) return false;
				if (checking) return true;
				this.relayoutSelectedBranch(canvas);
			},
		});

		// Command: Create an independent root at the center of the visible canvas
		this.addCommand({
			id: "mindmap-create-root",
			name: "Create root node",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas || !this.isMindmapCanvas(canvas)) return false;
				if (this.canvasApi.getSelectedNode(canvas)?.isEditing) return false;
				if (checking) return true;
				this.createRootNode();
			},
		});

		// Command: Layout forest (arrange trees within a group)
		this.addCommand({
			id: "mindmap-layout-forest",
			name: "Layout forest",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				if (!this.isMindmapCanvas(canvas)) return false;

				// Find the group containing the selected node
				const selected = this.canvasApi.getSelectedNode(canvas);
				if (!selected) return false;

				const groupIds = getGroupIds(canvas);
				const cx = selected.x + selected.width / 2;
				const cy = selected.y + selected.height / 2;
				let targetGroupId: string | null = null;
				let smallestArea = Infinity;

				for (const gid of groupIds) {
					const g = canvas.nodes.get(gid);
					if (!g) continue;
					if (cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height) {
						const area = g.width * g.height;
						if (area < smallestArea) {
							smallestArea = area;
							targetGroupId = gid;
						}
					}
				}

				if (!targetGroupId) return false;
				if (checking) return true;
				this.layoutEngine.layoutForest(canvas, targetGroupId);
			},
		});

		// Command: Detach subtree as independent tree
		this.addCommand({
			id: "mindmap-detach-subtree",
			name: "Detach subtree as independent tree",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				if (!this.isMindmapCanvas(canvas)) return false;

				const node = this.canvasApi.getSelectedNode(canvas);
				if (!node) return false;

				const parent = this.canvasApi.getParentNode(canvas, node);
				if (!parent) return false;

				if (checking) return true;

				const edges = this.canvasApi.getOutgoingEdges(canvas, parent.id);
				const edge = edges.find(e => e.to.node.id === node.id);
				if (!edge) return;

				canvas.removeEdge(edge);
				this.canvasApi.invalidateEdgeIndex();

				if (this.settings.autoLayoutOnEdit) this.layoutEngine.layout(canvas);
				this.updateGroupBounds(canvas);
				canvas.requestSave();
			},
		});

		// Command: Resize + re-layout selected subtree (Ctrl+Shift+L)
		this.addCommand({
			id: "mindmap-resize-subtree",
			name: "Resize & re-layout selected subtree",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				const node = this.canvasApi.getSelectedNode(canvas);
				if (!node) return false;
				if (checking) return true;
				const wasEditing = node.isEditing;
				this.resizeNodes(canvas, this.collectSubtreeNodes(canvas, node));
				this.layoutEngine.layout(canvas);
				this.updateGroupBounds(canvas);
				if (wasEditing) node.startEditing();
			},
		});

		// Command: Resize all nodes to fit content (Ctrl+Shift+Alt+R)
		this.addCommand({
			id: "mindmap-resize-all",
			name: "Resize all nodes to fit content",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				if (!this.isMindmapCanvas(canvas)) return false;
				if (canvas.nodes.size === 0) return false;
				if (checking) return true;
				this.resizeNodes(canvas, Array.from(canvas.nodes.values()));
				this.layoutEngine.layout(canvas);
				this.updateGroupBounds(canvas);
			},
		});

		// Command: Apply branch colors
		this.addCommand({
			id: "mindmap-apply-colors",
			name: "Apply branch colors",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				if (!this.isMindmapCanvas(canvas)) return false;
				if (checking) return true;
				this.branchColors.applyColors(canvas);
			},
		});

		// Command: Export the current map through the native PDF print dialog.
		this.addCommand({
			id: "mindmap-export-pdf",
			name: "Export mind map as high-quality PDF",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas || !this.isMindmapCanvas(canvas) || canvas.nodes.size === 0) return false;
				if (checking) return true;
				void this.exportMindmapPdf(canvas);
			},
		});

		// Command: Toggle mindmap mode for current canvas
		this.addCommand({
			id: "mindmap-toggle-mode",
			name: "Toggle mindmap mode for this canvas",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas) return false;
				if (checking) return true;
				this.toggleMindmapMode(canvas);
			},
		});

		// Watch for canvas view activation to set up UI
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				this.onLeafChange(leaf);
			})
		);

		// Register outline sidebar view
		this.registerView(OUTLINE_VIEW_TYPE, (leaf) => new OutlineView(leaf));

		// Show outline if a mindmap canvas is already open on startup
		this.app.workspace.onLayoutReady(() => {
			const view = this.app.workspace.getActiveViewOfType(ItemView);
			if (view) this.onLeafChange(view.leaf);
		});

		// Import FreeMind: right-click context menu on folders
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				// Show on folders only
				if (!(file instanceof TFolder)) return;

				menu.addItem((item) => {
					item.setTitle("Import mind map (.mm) to canvas")
						.setIcon("file-input")
						.onClick(() => this.importFreeMindFile(file.path));
				});
			})
		);

		// Canvas background context menu: create an independent root node or export.
		this.registerEvent(
			this.app.workspace.on("canvas:menu", (menu: Menu, canvas: Canvas) => {
				if (!this.isMindmapCanvas(canvas)) return;
				menu.addItem((item) => item
					.setTitle("Create root node")
					.setIcon("circle-plus")
					.onClick(() => this.createRootNode()));
				menu.addItem((item) => item
					.setTitle("Export as high-quality PDF")
					.setIcon("file-down")
					.setDisabled(canvas.nodes.size === 0)
					.onClick(() => {
						void this.exportMindmapPdf(canvas);
					}));
			})
		);

		// Node referencing: "Copy node link" in canvas node context menu
		this.registerEvent(
			this.app.workspace.on("canvas:node-menu", (menu: Menu, node: CanvasNode) => {
				const canvas = node.canvas;

				menu.addItem((item) => {
					item.setTitle("Copy node link")
						.setIcon("link")
						.onClick(() => {
							const canvasPath = node.canvas.view.file.path;
							void copyText(
								node.nodeEl.win,
								`obsidian://cammvas-navigate?canvas=${encodeURIComponent(canvasPath)}&id=${node.id}`,
								"Node link copied"
							);
						});
				});
				if (Platform.isMobile && this.isMindmapCanvas(canvas)) {
					menu.addItem((item) => item
						.setTitle("Add child node")
						.setIcon("corner-down-right")
						.onClick(() => this.keyboardHandler.addChildNode(canvas, node)));
					menu.addItem((item) => item
						.setTitle("Add sibling node")
						.setIcon("list-plus")
						.onClick(() => this.keyboardHandler.addSiblingNode(canvas, node)));
					menu.addItem((item) => item
						.setTitle("Zoom to branch")
						.setIcon("scan")
						.onClick(() => this.navigation.zoomToBranch(canvas, node)));
				}
				const groupIds = getGroupIds(canvas);
				if (this.isMindmapCanvas(canvas) && !groupIds.has(node.id)) {
					const branchColors = [
						["1", "Red"],
						["2", "Orange"],
						["3", "Yellow"],
						["4", "Green"],
						["5", "Blue"],
						["6", "Purple"],
					] as const;
					menu.addItem((item) => item
						.setTitle("Branch color")
						.setIcon("palette")
						.onClick((event) => this.showBranchColorMenu(event, canvas, node.id, branchColors)));
				}

				if (groupIds.has(node.id)) {
					menu.addItem((item) => {
						item.setTitle("Layout forest")
							.setIcon("layout-grid")
							.onClick(() => {
								this.layoutEngine.layoutForest(canvas, node.id);
								this.updateGroupBounds(canvas);
							});
					});
				} else if (this.isMindmapCanvas(canvas)) {
					menu.addItem((item) => {
						item.setTitle("Re-layout selected branch")
							.setIcon("list-tree")
							.onClick(() => {
								this.relayoutSelectedBranch(canvas, node);
						});
					});
				}
				if (this.isMindmapCanvas(canvas)) {
					menu.addItem((item) => item
						.setTitle("Export as high-quality PDF")
						.setIcon("file-down")
						.onClick(() => {
							void this.exportMindmapPdf(canvas);
						}));
				}
			})
		);

		// Node referencing: handle obsidian://cammvas-navigate protocol
		this.registerObsidianProtocolHandler("cammvas-navigate", async (params) => {
			const nodeId = params.id;
			if (!nodeId) return;

			const canvasPath = params.canvas;
			let canvas: Canvas | null = null;
			if (canvasPath) {
				const file = this.app.vault.getAbstractFileByPath(canvasPath);
				if (file && file instanceof TFile) {
					const leaf = this.app.workspace.getLeaf();
					await leaf.openFile(file);
					canvas = await this.waitForCanvas(canvasPath, leaf.view.containerEl.win);
				}
				if (!canvas) {
					new Notice("Canvas not found");
					return;
				}
			}

			canvas ??= this.canvasApi.getActiveCanvas() ?? this.canvasApi.getAnyCanvas();
			if (!canvas) {
				new Notice("Canvas not found");
				return;
			}

			const node = canvas.nodes.get(nodeId);
			if (!node) {
				new Notice("Target node not found");
				return;
			}

			this.canvasApi.selectAndZoom(canvas, node, this.settings.navigationZoomPadding);
		});

		// Navigation history: back/forward commands
		this.addCommand({
			id: "mindmap-nav-back",
			name: "Navigate back",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas || this.navHistoryIndex <= 0) return false;
				if (checking) return true;
				this.navigateBack(canvas);
			},
		});
		this.addCommand({
			id: "mindmap-nav-forward",
			name: "Navigate forward",
			checkCallback: (checking: boolean) => {
				const canvas = this.canvasApi.getActiveCanvas();
				if (!canvas || this.navHistoryIndex >= this.navHistory.length - 1) return false;
				if (checking) return true;
				this.navigateForward(canvas);
			},
		});

		// Import FreeMind: command palette
		this.addCommand({
			id: "mindmap-import-freemind",
			name: "Import mind map (.mm) file to canvas",
			callback: () => this.importFreeMindFile(),
		});

		// Settings tab
		this.addSettingTab(new MindMapSettingTab(this.app, this));

	}

	private pushNavHistory(nodeId: string): void {
		if (this.navHistory[this.navHistoryIndex] === nodeId) return;
		this.navHistory.splice(this.navHistoryIndex + 1);
		this.navHistory.push(nodeId);
		if (this.navHistory.length > 50) this.navHistory.shift();
		this.navHistoryIndex = this.navHistory.length - 1;
	}

	private navigateBack(canvas: Canvas): void {
		if (this.navHistoryIndex <= 0) return;
		this.keyboardHandler?.onBeforeLeaveNode?.();
		this.navSkipTracking = true;
		this.navHistoryIndex--;
		const nodeId = this.navHistory[this.navHistoryIndex];
		const node = canvas.nodes.get(nodeId);
		if (!node) { this.navSkipTracking = false; return; }
		this.canvasApi.selectAndZoom(canvas, node, this.settings.navigationZoomPadding);
		this.navSkipTracking = false;
	}

	private navigateForward(canvas: Canvas): void {
		if (this.navHistoryIndex >= this.navHistory.length - 1) return;
		this.keyboardHandler?.onBeforeLeaveNode?.();
		this.navSkipTracking = true;
		this.navHistoryIndex++;
		const nodeId = this.navHistory[this.navHistoryIndex];
		const node = canvas.nodes.get(nodeId);
		if (!node) { this.navSkipTracking = false; return; }
		this.canvasApi.selectAndZoom(canvas, node, this.settings.navigationZoomPadding);
		this.navSkipTracking = false;
	}

	private async waitForCanvas(path: string, win: Window): Promise<Canvas | null> {
		for (let attempt = 0; attempt < 40; attempt++) {
			if (this.unloaded) return null;
			const canvas = this.canvasApi.getActiveCanvas();
			if (canvas?.view.file.path === path) return canvas;
			await new Promise<void>((resolve) => win.setTimeout(resolve, 50));
		}
		return null;
	}

	onunload(): void {
		this.unloaded = true;
		// Cancel all pending async operations first
		this.cancelPendingAsync();
		this.unwrapCanvasMethods();

		if (this.cleanupClickHandler) {
			this.cleanupClickHandler();
			this.cleanupClickHandler = null;
		}
		if (this.cleanupDragHandler) {
			this.cleanupDragHandler();
			this.cleanupDragHandler = null;
		}
		if (this.cleanupSubtreeDragHandler) {
			this.cleanupSubtreeDragHandler();
			this.cleanupSubtreeDragHandler = null;
		}
		if (this.cleanupAutoLayoutOnMoveHandler) {
			this.cleanupAutoLayoutOnMoveHandler();
			this.cleanupAutoLayoutOnMoveHandler = null;
		}
		if (this.cleanupDragReparentHandler) {
			this.cleanupDragReparentHandler();
			this.cleanupDragReparentHandler = null;
		}
		if (this.cleanupGroupDragHandler) {
			this.cleanupGroupDragHandler();
			this.cleanupGroupDragHandler = null;
		}
		if (this.cleanupGroupBoundsHandler) {
			this.cleanupGroupBoundsHandler();
			this.cleanupGroupBoundsHandler = null;
		}
		if (this.cleanupSelectionSyncHandler) {
			this.cleanupSelectionSyncHandler();
			this.cleanupSelectionSyncHandler = null;
		}
		if (this.cleanupInsertNodeHandler) {
			this.cleanupInsertNodeHandler();
			this.cleanupInsertNodeHandler = null;
		}
		if (this.cleanupNavHandler) {
			this.cleanupNavHandler();
			this.cleanupNavHandler = null;
		}
		if (this.autoResizeHandle) {
			this.autoResizeHandle.cleanup();
			this.autoResizeHandle = null;
		}
		if (this.mobileEditingBarHandle) {
			this.mobileEditingBarHandle.cleanup();
			this.mobileEditingBarHandle = null;
		}
		if (this.branchCollapseHandle) {
			this.branchCollapseHandle.cleanup();
			this.branchCollapseHandle = null;
		}
		this.keyboardHandler.unregisterArrowKeyNavigation();
		this.lastNavCanvas = null;
		if (this.toggleBtnEl) {
			this.toggleBtnEl.remove();
			this.toggleBtnEl = null;
		}
		if (this.dragReparentBtnEl) {
			this.dragReparentBtnEl.remove();
			this.dragReparentBtnEl = null;
		}
		if (this.autoLayoutOnEditBtnEl) {
			this.autoLayoutOnEditBtnEl.remove();
			this.autoLayoutOnEditBtnEl = null;
		}
		if (this.layoutBtnEl) {
			this.layoutBtnEl.remove();
			this.layoutBtnEl = null;
		}
		if (this.exportPdfBtnEl) {
			this.exportPdfBtnEl.remove();
			this.exportPdfBtnEl = null;
		}
		if (this.enterTabBtnEl) {
			this.enterTabBtnEl.remove();
			this.enterTabBtnEl = null;
		}
		if (this.mobileActionsBtnEl) {
			this.mobileActionsBtnEl.remove();
			this.mobileActionsBtnEl = null;
		}
	}

	/**
	 * Called when the active leaf changes — set up canvas-specific UI.
	 */
	private onLeafChange(leaf: WorkspaceLeaf | null): void {
		// Don't clean up when focus moves to sidebar panels
		if (leaf?.view?.getViewType() === OUTLINE_VIEW_TYPE) return;
		const root = leaf?.getRoot();
		if (root && root !== this.app.workspace.rootSplit) return;

		// Cancel pending async operations and unwrap previous canvas
		this.cancelPendingAsync();
		this.unwrapCanvasMethods();

		// Clean up previous canvas handlers
		if (this.cleanupClickHandler) {
			this.cleanupClickHandler();
			this.cleanupClickHandler = null;
		}
		if (this.cleanupDragHandler) {
			this.cleanupDragHandler();
			this.cleanupDragHandler = null;
		}
		if (this.cleanupSubtreeDragHandler) {
			this.cleanupSubtreeDragHandler();
			this.cleanupSubtreeDragHandler = null;
		}
		if (this.cleanupAutoLayoutOnMoveHandler) {
			this.cleanupAutoLayoutOnMoveHandler();
			this.cleanupAutoLayoutOnMoveHandler = null;
		}
		if (this.cleanupDragReparentHandler) {
			this.cleanupDragReparentHandler();
			this.cleanupDragReparentHandler = null;
		}
		if (this.cleanupGroupDragHandler) {
			this.cleanupGroupDragHandler();
			this.cleanupGroupDragHandler = null;
		}
		if (this.cleanupGroupBoundsHandler) {
			this.cleanupGroupBoundsHandler();
			this.cleanupGroupBoundsHandler = null;
		}
		if (this.cleanupSelectionSyncHandler) {
			this.cleanupSelectionSyncHandler();
			this.cleanupSelectionSyncHandler = null;
		}
		if (this.cleanupInsertNodeHandler) {
			this.cleanupInsertNodeHandler();
			this.cleanupInsertNodeHandler = null;
		}
		if (this.cleanupNavHandler) {
			this.cleanupNavHandler();
			this.cleanupNavHandler = null;
		}
		if (this.autoResizeHandle) {
			this.autoResizeHandle.cleanup();
			this.autoResizeHandle = null;
		}
		if (this.mobileEditingBarHandle) {
			this.mobileEditingBarHandle.cleanup();
			this.mobileEditingBarHandle = null;
		}
		if (this.branchCollapseHandle) {
			this.branchCollapseHandle.cleanup();
			this.branchCollapseHandle = null;
		}
		this.keyboardHandler.unregisterArrowKeyNavigation();

		const canvas = this.canvasApi.getActiveCanvas();

		// Only reset nav history when switching to a different canvas
		if (canvas && canvas !== this.lastNavCanvas) {
			this.navHistory = [];
			this.navHistoryIndex = -1;
		}
		if (canvas) {
			this.lastNavCanvas = canvas;
		}

		if (!canvas) {
			if (this.toggleBtnEl) {
				this.toggleBtnEl.remove();
				this.toggleBtnEl = null;
			}
			if (this.dragReparentBtnEl) {
				this.dragReparentBtnEl.remove();
				this.dragReparentBtnEl = null;
			}
			if (this.autoLayoutOnEditBtnEl) {
				this.autoLayoutOnEditBtnEl.remove();
				this.autoLayoutOnEditBtnEl = null;
			}
			if (this.layoutBtnEl) {
				this.layoutBtnEl.remove();
				this.layoutBtnEl = null;
			}
			if (this.exportPdfBtnEl) {
				this.exportPdfBtnEl.remove();
				this.exportPdfBtnEl = null;
			}
			if (this.enterTabBtnEl) {
				this.enterTabBtnEl.remove();
				this.enterTabBtnEl = null;
			}
			if (this.mobileActionsBtnEl) {
				this.mobileActionsBtnEl.remove();
				this.mobileActionsBtnEl = null;
			}
			this.hideOutline();
			return;
		}

		// Apply edge label font size CSS variable
		canvas.wrapperEl.style.setProperty("--cammvas-edge-label-font-size", `${this.settings.edgeLabelFontSize}px`);

		// Register after Canvas so Cammvas takes precedence over native node nudging.
		this.keyboardHandler.registerArrowKeyNavigation(canvas);

		// Inject mindmap toggle button into canvas toolbar
		this.injectToggleButton(canvas);
		this.updateLayoutButton(canvas);

		// Set up Ctrl+click zoom handler
		this.cleanupClickHandler = Platform.isMobile
			? null
			: this.navigation.registerClickHandler(canvas);

		// Set up drag-end edge update handler
		this.cleanupDragHandler =
			registerDragEndHandler(canvas);

		// Set up subtree drag handler (move descendants with parent)
		this.cleanupSubtreeDragHandler =
			registerSubtreeDragHandler(canvas, this.canvasApi);

		this.cleanupDragReparentHandler = registerDragReparent(
			canvas,
			this.canvasApi,
			() => this.settings.dragToReparent && this.isMindmapCanvas(canvas),
			(nodes, newParent) => {
				let changed = false;
				for (const node of nodes) {
					changed = this.nodeOps.reparent(canvas, node, newParent) || changed;
				}
				if (!changed) return;
				if (this.settings.autoLayoutOnReparent) this.layoutEngine.layout(canvas);
				this.updateGroupBounds(canvas);
				this.branchCollapseHandle?.refresh();
			}
		);

		// Snap a manually dragged node (and its subtree) back into its
		// auto-layout slot once released, when enabled.
		this.cleanupAutoLayoutOnMoveHandler = registerAutoLayoutOnMove(
			canvas,
			this.canvasApi,
			() => this.settings.autoLayoutOnEdit && this.isMindmapCanvas(canvas),
			(parentIds) => {
				if (parentIds.size > 0) this.layoutEngine.layout(canvas);
				this.updateGroupBounds(canvas);
				this.branchCollapseHandle?.refresh();
			}
		);

		// Set up group drag handler (Alt+drag leaves stranger nodes behind)
		this.cleanupGroupDragHandler = Platform.isMobile
			? null
			: registerGroupDragHandler(canvas, this.canvasApi);

		// Add persistent collapse controls to nodes that have descendants.
		this.branchCollapseHandle = registerBranchCollapse(canvas, this.canvasApi);

		// Update group bounds after any drag operation (deferred to let positions settle)
		const onDragEnd = () => this.trackedRaf(canvas.wrapperEl.win, () => this.updateGroupBounds(canvas));
		canvas.wrapperEl.addEventListener('pointerup', onDragEnd);
		this.cleanupGroupBoundsHandler = () =>
			canvas.wrapperEl.removeEventListener('pointerup', onDragEnd);

		// Sync outline highlight when canvas selection changes (click or Escape)
		const syncOutlineSelection = () => {
			this.trackedRaf(canvas.wrapperEl.win, () => {
				for (const leaf of this.app.workspace.getLeavesOfType(OUTLINE_VIEW_TYPE)) {
					if (leaf.view instanceof OutlineView) {
						leaf.view.syncHighlightFromCanvas(canvas);
					}
				}
			});
		};
		const onCanvasClick = () => syncOutlineSelection();
		const onCanvasKeydown = (e: KeyboardEvent) => {
			if (e.key === "Escape") syncOutlineSelection();
			if (e.key === "s" && (e.ctrlKey || e.metaKey) && !e.shiftKey) syncOutlineSelection();
		};
		canvas.wrapperEl.addEventListener("click", onCanvasClick);
		canvas.wrapperEl.addEventListener("keydown", onCanvasKeydown);
		this.cleanupSelectionSyncHandler = () => {
			canvas.wrapperEl.removeEventListener("click", onCanvasClick);
			canvas.wrapperEl.removeEventListener("keydown", onCanvasKeydown);
		};

		// Insert node between parent and child via Alt+click on connection point
		const onInsertNodeClick = (e: MouseEvent) => {
			if (!e.altKey) return;

			const target = e.target;
			if (!isHtmlElement(target)) return;
			const connectionPoint = target.closest(".canvas-node-connection-point");
			if (!connectionPoint) return;

			const side = connectionPoint.getAttribute("data-side");
			if (!side) return;

			// Connection point is an overlay, not inside .canvas-node — find node by position
			const canvasPos = canvas.posFromEvt(e);
			let clickedNode: CanvasNode | null = null;
			let closestDist = Infinity;
			for (const node of canvas.nodes.values()) {
				const cx = node.x + node.width / 2;
				const cy = node.y + node.height / 2;
				const dist = Math.hypot(canvasPos.x - cx, canvasPos.y - cy);
				if (dist < closestDist) {
					closestDist = dist;
					clickedNode = node;
				}
			}
			if (!clickedNode) return;

			// Collect ALL edges on this side of the clicked node
			const incomingEdges: CanvasEdge[] = [];
			const outgoingEdges: CanvasEdge[] = [];
			for (const edge of canvas.edges.values()) {
				if (edge.to.node.id === clickedNode.id && edge.to.side === side) {
					incomingEdges.push(edge);
				}
				if (edge.from.node.id === clickedNode.id && edge.from.side === side) {
					outgoingEdges.push(edge);
				}
			}

			const edges = outgoingEdges.length > 0 ? outgoingEdges : incomingEdges;
			if (edges.length === 0) return;

			e.preventDefault();
			e.stopPropagation();

			const isOutgoing = outgoingEdges.length > 0;
			const fromSide = edges[0].from.side;
			const toSide = edges[0].to.side;

			if (isOutgoing) {
				// Insert between clickedNode and all its children on this side
				const children = edges.map(edge => edge.to.node);
				const avgY = children.reduce((s, c) => s + c.y + c.height / 2, 0) / children.length;
				const midX = (clickedNode.x + clickedNode.width + children[0].x) / 2
					- this.settings.defaultNodeWidth / 2;
				const midY = avgY - this.settings.defaultNodeHeight / 2;

				const newNode = this.canvasApi.createTextNode(canvas, midX, midY);
				for (const edge of edges) canvas.removeEdge(edge);
				this.canvasApi.invalidateEdgeIndex();
				this.canvasApi.createEdge(canvas, clickedNode, newNode, fromSide, toSide);
				for (const child of children) {
					this.canvasApi.createEdge(canvas, newNode, child, fromSide, toSide);
				}

				this.finishInsertNode(canvas, newNode, clickedNode);
			} else {
				// Insert between parent and clickedNode (single incoming edge)
				const edge = edges[0];
				const parentNode = edge.from.node;
				const midX = (parentNode.x + parentNode.width / 2 + clickedNode.x + clickedNode.width / 2) / 2
					- this.settings.defaultNodeWidth / 2;
				const midY = (parentNode.y + parentNode.height / 2 + clickedNode.y + clickedNode.height / 2) / 2
					- this.settings.defaultNodeHeight / 2;

				const newNode = this.canvasApi.createTextNode(canvas, midX, midY);
				canvas.removeEdge(edge);
				this.canvasApi.invalidateEdgeIndex();
				this.canvasApi.createEdge(canvas, parentNode, newNode, fromSide, toSide);
				this.canvasApi.createEdge(canvas, newNode, clickedNode, fromSide, toSide);

				this.finishInsertNode(canvas, newNode, parentNode);
			}
		};
		if (!Platform.isMobile) {
			canvas.wrapperEl.addEventListener("click", onInsertNodeClick, true);
			this.cleanupInsertNodeHandler = () =>
				canvas.wrapperEl.removeEventListener("click", onInsertNodeClick, true);
		}

		// Set up auto-resize handler (grow/shrink nodes with content)
		this.autoResizeHandle = registerAutoResize(
			canvas,
			{
				minHeight: this.settings.defaultNodeHeight,
				maxHeight: this.settings.maxNodeHeight,
			},
			(canvas, editedNode) => {
				const generation = ++this.editExitGeneration;
				this.waitForPreview(editedNode, () => {
					if (generation !== this.editExitGeneration) return;
					// Guard: skip if canvas changed while waiting
					if (this.canvasApi.getActiveCanvas() !== canvas) return;
					const forest = buildForest(canvas);
					const treeNode = findTreeForNode(forest, editedNode.id);
					if (!treeNode) return;
					let root = treeNode;
					while (root.parent) root = root.parent;
					this.preserveViewport(canvas, () => {
						this.resizeNodes(canvas, this.collectSubtreeNodes(canvas, root.canvasNode));
						if (this.settings.autoLayoutOnEdit) this.layoutEngine.layout(canvas);
						this.updateGroupBounds(canvas);
					});
				});
			}
		);
		this.keyboardHandler.onBeforeLeaveNode = () => {
			const generation = ++this.editExitGeneration;
			this.autoResizeHandle?.finalizeNode();
			const node = this.canvasApi.getSelectedNode(canvas);
			if (node?.isEditing) {
				this.waitForPreview(node, () => {
					if (generation !== this.editExitGeneration) return;
					// Guard: skip if canvas changed while waiting
					if (this.canvasApi.getActiveCanvas() !== canvas) return;
					this.preserveViewport(canvas, () => {
						this.resizeNodes(canvas, [node]);
						this.finalizeEdit(canvas, node);
					});
				});
			}
		};
		if (Platform.isMobile) {
			this.mobileEditingBarHandle = registerMobileEditingBar(
				canvas,
				() => this.isMindmapCanvas(canvas),
				(node) => this.canvasApi.getParentNode(canvas, node) !== null,
				(node) => this.keyboardHandler.addChildNode(canvas, node, {
					immediateEdit: true,
					transferSelection: false,
				}),
				(node) => this.keyboardHandler.addSiblingNode(canvas, node, {
					immediateEdit: true,
					transferSelection: false,
				}),
				(node) => {
					this.keyboardHandler.onBeforeLeaveNode?.();
					node.blur();
				}
			);
		}
		// Mouse back/forward buttons for navigation history (optional)
		if (this.settings.mouseNavigation && !Platform.isMobile) {
			const onPointerDown = (e: PointerEvent) => {
				if (e.button === 3) {
					e.preventDefault();
					e.stopImmediatePropagation();
					this.navigateBack(canvas);
				}
				if (e.button === 4) {
					e.preventDefault();
					e.stopImmediatePropagation();
					this.navigateForward(canvas);
				}
			};
			canvas.wrapperEl.addEventListener("pointerdown", onPointerDown, true);
			this.cleanupNavHandler = () => canvas.wrapperEl.removeEventListener("pointerdown", onPointerDown, true);
		}

		// Auto-color if enabled (mindmap only)
		if (this.settings.autoColor && this.isMindmapCanvas(canvas)) {
			this.branchColors.applyColors(canvas);
		}

		// Intercept canvas methods (store originals for cleanup)
		const origSave = canvas.requestSave.bind(canvas);
		const origCreateGroup = canvas.createGroupNode.bind(canvas);
		const origUndo = canvas.undo?.bind(canvas);
		const origRedo = canvas.redo?.bind(canvas);
		const origSelectOnly = canvas.selectOnly.bind(canvas);
		this.origCanvasMethods = { requestSave: origSave, createGroupNode: origCreateGroup, undo: origUndo, redo: origRedo, selectOnly: origSelectOnly };
		this.interceptedCanvas = canvas;

		// Track selection changes for navigation history
		canvas.selectOnly = (item: CanvasNode | CanvasEdge) => {
			origSelectOnly(item);
			if (!this.navSkipTracking && "nodeEl" in item) {
				this.pushNavHistory(item.id);
			}
		};

		canvas.requestSave = () => {
			if (this.isMindmapCanvas(canvas)) {
				this.branchColors.inheritConnectionColors(canvas);
			}
			origSave();
			this.branchCollapseHandle?.refresh();
			this.debouncedOutlineRefresh();
		};
		canvas.createGroupNode = (options: CreateNodeOptions & { label?: string }) => {
			const group = origCreateGroup(options);
			this.updateGroupBounds(canvas);
			return group;
		};
		if (origUndo) {
			canvas.undo = () => {
				origUndo();
				this.canvasApi.invalidateEdgeIndex();
				this.branchCollapseHandle?.refresh();
				this.debouncedOutlineRefresh();
			};
		}
		if (origRedo) {
			canvas.redo = () => {
				origRedo();
				this.canvasApi.invalidateEdgeIndex();
				this.branchCollapseHandle?.refresh();
				this.debouncedOutlineRefresh();
			};
		}
		if (this.isMindmapCanvas(canvas)) {
			this.showOutline(canvas);
		} else {
			this.hideOutline();
		}
	}

	private debouncedOutlineRefresh = debounce(() => {
		if (this.unloaded) return;
		const canvas = this.canvasApi.getActiveCanvas()
			?? this.canvasApi.getAnyCanvas();
		if (canvas) {
			this.refreshOutline(canvas);
		}
	}, 300);

	private refreshOutline(canvas: Canvas): void {
		for (const leaf of this.app.workspace.getLeavesOfType(OUTLINE_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof OutlineView) {
				view.zoomPadding = this.settings.navigationZoomPadding;
				view.onForestLayout = (c, groupId) => {
					this.layoutEngine.layoutForest(c, groupId);
					this.updateGroupBounds(c);
				};
				view.refresh(canvas);
			}
		}
	}

	/**
	 * Collect a node and all its descendants via BFS.
	 */
	private collectSubtreeNodes(canvas: Canvas, root: import("./types/canvas-internal").CanvasNode): import("./types/canvas-internal").CanvasNode[] {
		const result = [root];
		const visited = new Set<string>([root.id]);
		const queue = [root.id];
		while (queue.length > 0) {
			const id = queue.shift()!;
			for (const edge of this.canvasApi.getOutgoingEdges(canvas, id)) {
				const childId = edge.to.node.id;
				if (!visited.has(childId)) {
					visited.add(childId);
					result.push(edge.to.node);
					queue.push(childId);
				}
			}
		}
		return result;
	}

	/**
	 * Recalculate bounds for all groups to tightly fit their contained subtrees.
	 * A root node belongs to a group if its center is inside the group's current bounds.
	 */
	updateGroupBounds(canvas: Canvas): void {
		const PADDING = 20;
		const groupIds = getGroupIds(canvas);
		if (groupIds.size === 0) return;

		let changed = false;

		for (const groupId of groupIds) {
			const group = canvas.nodes.get(groupId);
			if (!group) continue;

			const gx = group.x;
			const gy = group.y;
			const gw = group.width;
			const gh = group.height;

			// Collect subtrees of all non-group nodes whose center is inside this group
			const contained = new Set<import("./types/canvas-internal").CanvasNode>();
			for (const node of canvas.nodes.values()) {
				if (groupIds.has(node.id)) continue;
				const cx = node.x + node.width / 2;
				const cy = node.y + node.height / 2;
				if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) {
					for (const n of this.collectSubtreeNodes(canvas, node)) {
						contained.add(n);
					}
				}
			}

			// No nodes inside — leave group unchanged
			if (contained.size === 0) continue;

			// Compute bounding box
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			for (const node of contained) {
				minX = Math.min(minX, node.x);
				minY = Math.min(minY, node.y);
				maxX = Math.max(maxX, node.x + node.width);
				maxY = Math.max(maxY, node.y + node.height);
			}

			const newX = minX - PADDING;
			const newY = minY - PADDING;
			const newW = (maxX - minX) + PADDING * 2;
			const newH = (maxY - minY) + PADDING * 2;

			// Only resize if bounds actually changed
			if (newX !== gx || newY !== gy || newW !== gw || newH !== gh) {
				group.nodeEl?.addClass('mindmap-group-animating');
				group.moveAndResize({ x: newX, y: newY, width: newW, height: newH });
				changed = true;
			}
		}

		if (changed) {
			canvas.requestSave();
			// Remove animation class after transition completes
			this.trackedTimeout(canvas.wrapperEl.win, () => {
				for (const groupId of groupIds) {
					const group = canvas.nodes.get(groupId);
					group?.nodeEl?.removeClass('mindmap-group-animating');
				}
			}, 260);
		}
	}

	/**
	 * Wait for a node's preview sizer to appear in the DOM, then invoke callback.
	 * Uses MutationObserver instead of arbitrary setTimeout for precise timing.
	 */
	private waitForPreview(node: import("./types/canvas-internal").CanvasNode, callback: () => void): void {
		const sizer = node.contentEl?.querySelector(".markdown-preview-sizer");
		if (sizer && !node.isEditing) {
			callback();
			return;
		}
		const Observer = Reflect.get(node.contentEl.win, "MutationObserver") as typeof MutationObserver;
		const observer = new Observer(() => {
			const s = node.contentEl?.querySelector(".markdown-preview-sizer");
			if (s && !node.isEditing) {
				observer.disconnect();
				this.pendingObservers.delete(observer);
				this.trackedRaf(node.contentEl.win, () => callback());
			}
		});
		this.pendingObservers.add(observer);
		observer.observe(node.contentEl, { childList: true, subtree: true });
		this.trackedTimeout(node.contentEl.win, () => {
			observer.disconnect();
			this.pendingObservers.delete(observer);
		}, 500);
	}

	/** Preserve the current canvas viewport while automatic resize/layout mutates nodes. */
	private preserveViewport(canvas: Canvas, mutate: () => void): void {
		const viewport = { x: canvas.x, y: canvas.y, tx: canvas.tx, ty: canvas.ty, zoom: canvas.zoom, tZoom: canvas.tZoom };
		const restore = () => {
			canvas.x = viewport.x;
			canvas.y = viewport.y;
			canvas.tx = viewport.tx;
			canvas.ty = viewport.ty;
			canvas.zoom = viewport.zoom;
			canvas.tZoom = viewport.tZoom;
			canvas.requestFrame();
		};
		mutate();
		restore();
		this.trackedRaf(canvas.wrapperEl.win, restore);
	}

	/**
	 * Finalize an edit. By default, preserves manually arranged node positions.
	 * When autoLayoutOnEdit is enabled, re-arranges the edited node's tree.
	 */
	private finalizeEdit(canvas: Canvas, node: CanvasNode): void {
		if (this.settings.autoLayoutOnEdit) {
			const forest = buildForest(canvas);
			const treeNode = findTreeForNode(forest, node.id);
			if (treeNode) {
				let root = treeNode;
				while (root.parent) root = root.parent;
				this.layoutEngine.layout(canvas);
			}
		}
		this.updateGroupBounds(canvas);
	}

	/**
	 * Resize nodes to fit their rendered content, capped at maxNodeHeight.
	 * Handles both preview mode (markdown sizer) and edit mode (CodeMirror).
	 */
	private resizeNodes(canvas: Canvas, nodes: import("./types/canvas-internal").CanvasNode[]): void {
		const minH = this.settings.defaultNodeHeight;
		const maxH = this.settings.maxNodeHeight;
		const targetW = this.settings.defaultNodeWidth;
		const BORDER = 2;
		const SCALE = 1.2;
		let changed = false;
		const unmeasurable: import("./types/canvas-internal").CanvasNode[] = [];

		for (const node of nodes) {
			let contentH: number | null = null;
			let targetH = node.height;

			if (node.isEditing) {
				// Editing: measure via CodeMirror .cm-content
				const { cmContent, scroller } = getEditorElements(node);
				if (cmContent && scroller) {
					contentH = 0;
					for (const child of Array.from(cmContent.children)) {
						if (isHtmlElement(child)) contentH += child.offsetHeight;
					}
					targetH = Math.min(Math.max(Math.ceil(contentH * SCALE) + BORDER, minH), maxH);
					if (targetH !== node.height || targetW !== node.width) {
						node.moveAndResize({ x: node.x, y: node.y, width: targetW, height: targetH });
						changed = true;
					}
					continue;
				}
			}

			// Preview mode: measure via .markdown-preview-sizer children
			const sizer = node.contentEl?.querySelector<HTMLElement>(".markdown-preview-sizer");
			if (!sizer) {
				// DOM not rendered (off-screen node) — apply width, collect for height retry
				if (node.width !== targetW) {
					node.moveAndResize({ x: node.x, y: node.y, width: targetW, height: node.height });
					changed = true;
				}
				if (node.text) unmeasurable.push(node);
				continue;
			}

			contentH = 0;
			for (const child of Array.from(sizer.children)) {
				if (isHtmlElement(child)) contentH += child.offsetHeight;
			}

			// If we measured 0 but the node has text, the DOM isn't rendered yet
			// (off-screen virtualization). Apply width but skip height change.
			if (contentH === 0 && node.text) {
				if (node.width !== targetW) {
					node.moveAndResize({ x: node.x, y: node.y, width: targetW, height: node.height });
					changed = true;
				}
				unmeasurable.push(node);
				continue;
			}

			targetH = Math.min(Math.max(Math.ceil(contentH * SCALE) + BORDER, minH), maxH);
			if (targetH === node.height && targetW === node.width) continue;

			node.moveAndResize({ x: node.x, y: node.y, width: targetW, height: targetH });
			changed = true;
		}

		if (changed) canvas.requestSave();

		// Retry unmeasurable nodes after a delay to let Obsidian render them
		if (unmeasurable.length > 0) {
			this.trackedTimeout(canvas.wrapperEl.win, () => this.resizeNodesRetry(canvas, unmeasurable, minH, maxH, BORDER, SCALE), 200);
		}
	}

	/**
	 * Retry resizing nodes that couldn't be measured on the first pass.
	 * After layout repositions nodes, Obsidian may have rendered their content.
	 */
	private resizeNodesRetry(
		canvas: Canvas,
		nodes: import("./types/canvas-internal").CanvasNode[],
		minH: number, maxH: number, BORDER: number, SCALE: number
	): void {
		let changed = false;
		for (const node of nodes) {
			const sizer = node.contentEl?.querySelector<HTMLElement>(".markdown-preview-sizer");
			if (!sizer) continue;

			let contentH = 0;
			for (const child of Array.from(sizer.children)) {
				if (isHtmlElement(child)) contentH += child.offsetHeight;
			}
			if (contentH === 0) continue;

			const targetH = Math.min(Math.max(Math.ceil(contentH * SCALE) + BORDER, minH), maxH);
			if (targetH === node.height) continue;

			node.moveAndResize({ x: node.x, y: node.y, width: node.width, height: targetH });
			changed = true;
		}
		if (changed) canvas.requestSave();
	}

	private finishInsertNode(canvas: Canvas, newNode: CanvasNode, nearNode: CanvasNode): void {
		const forest = buildForest(canvas);
		const treeNode = findTreeForNode(forest, nearNode.id);
		if (treeNode) {
			let root = treeNode;
			while (root.parent) root = root.parent;
			if (this.settings.autoLayout) {
				this.layoutEngine.layout(canvas, new Set([newNode.id]));
			}
		}
		if (this.settings.autoColor && this.isMindmapCanvas(canvas)) {
			this.branchColors.applyColors(canvas);
		}
		this.updateGroupBounds(canvas);
		this.canvasApi.selectAndEdit(canvas, newNode, this.settings.navigationZoomPadding);
	}

	private showOutline(canvas: Canvas, reveal = !Platform.isMobile): void {
		const leaves = this.app.workspace.getLeavesOfType(OUTLINE_VIEW_TYPE);
		if (leaves.length > 0) {
			this.refreshOutline(canvas);
			if (reveal) void this.app.workspace.revealLeaf(leaves[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		void leaf.setViewState({ type: OUTLINE_VIEW_TYPE }).then(() => {
			if (reveal) void this.app.workspace.revealLeaf(leaf);
			if (!Platform.isMobile) this.reorderOutlineToTop(leaf);
			this.refreshOutline(canvas);
		});
	}

	private hideOutline(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(OUTLINE_VIEW_TYPE)) {
			leaf.detach();
		}
	}

	private reorderOutlineToTop(leaf: WorkspaceLeaf): void {
		const parent = leaf.parent;
		if (!parent?.children) return;
		const children = parent.children;
		const idx = children.indexOf(leaf);
		if (idx > 0) {
			children.splice(idx, 1);
			children.unshift(leaf);
		}
		parent.selectTab?.(leaf);
	}

	/**
	 * Import a FreeMind .mm file and create a .canvas file.
	 * @param folderPath Optional target folder; defaults to vault root.
	 */
	private importFreeMindFile(folderPath?: string): void {
		// Open native file picker for .mm files
		const input = createEl("input");
		input.type = "file";
		input.accept = ".mm";
		const handler = () => {
			input.removeEventListener("change", handler);
			const file = input.files?.[0];
			if (!file) return;

			void (async () => {
				const xml = await file.text();
				const canvasData = freemindToCanvas(xml, {
					nodeWidth: this.settings.defaultNodeWidth,
					nodeHeight: this.settings.defaultNodeHeight,
					maxNodeHeight: this.settings.maxNodeHeight,
					horizontalGap: this.settings.horizontalGap,
					verticalGap: this.settings.verticalGap,
				});

				if (!canvasData) {
					new Notice(
						"Failed to parse .mm file. Make sure it is a valid mind map file."
					);
					return;
				}

				const baseName = file.name.replace(/\.mm$/i, "");
				const folder = folderPath ? folderPath + "/" : "";
				let canvasPath = `${folder}${baseName}.canvas`;

				// Avoid overwriting existing files
				let counter = 1;
				while (this.app.vault.getAbstractFileByPath(canvasPath)) {
					canvasPath = `${folder}${baseName} ${counter}.canvas`;
					counter++;
				}

				await this.app.vault.create(
					canvasPath,
					JSON.stringify(canvasData, null, "\t")
				);

				// Open the new canvas
				const created = this.app.vault.getAbstractFileByPath(canvasPath);
				if (created instanceof TFile) {
					await this.app.workspace.getLeaf(false).openFile(created);
				}

				new Notice(
					`Imported "${file.name}" as "${canvasPath}"`
				);
			})();
		};
		input.addEventListener("change", handler);
		input.click();
	}

	isMindmapCanvas(canvas: Canvas): boolean {
		const data = canvas.getData();
		if (typeof data.mindmap === 'boolean') return data.mindmap;
		return this.settings.defaultMindmapMode;
	}

	private toggleMindmapMode(canvas: Canvas): void {
		const data = canvas.getData();
		const newValue = !this.isMindmapCanvas(canvas);
		data.mindmap = newValue;
		canvas.setData(data);
		canvas.requestSave();

		// Re-apply or remove auto-color
		if (newValue && this.settings.autoColor) {
			this.branchColors.applyColors(canvas);
		}

		if (newValue) {
			this.showOutline(canvas);
		} else {
			this.hideOutline();
		}

		this.updateToggleButton(canvas);
		this.updateDragReparentButton(canvas);
		this.updateAutoLayoutOnEditButton(canvas);
		this.updateLayoutButton(canvas);
		this.updateExportPdfButton(canvas);
		this.updateEnterTabButton(canvas);
		this.updateMobileActionsButton(canvas);
		this.mobileEditingBarHandle?.refresh();
	}

	private injectToggleButton(canvas: Canvas): void {
		// Remove previous button
		if (this.toggleBtnEl) {
			this.toggleBtnEl.remove();
			this.toggleBtnEl = null;
		}
		if (this.dragReparentBtnEl) {
			this.dragReparentBtnEl.remove();
			this.dragReparentBtnEl = null;
		}
		if (this.autoLayoutOnEditBtnEl) {
			this.autoLayoutOnEditBtnEl.remove();
			this.autoLayoutOnEditBtnEl = null;
		}
		if (this.layoutBtnEl) {
			this.layoutBtnEl.remove();
			this.layoutBtnEl = null;
		}
		if (this.exportPdfBtnEl) {
			this.exportPdfBtnEl.remove();
			this.exportPdfBtnEl = null;
		}
		if (this.enterTabBtnEl) {
			this.enterTabBtnEl.remove();
			this.enterTabBtnEl = null;
		}
		if (this.mobileActionsBtnEl) {
			this.mobileActionsBtnEl.remove();
			this.mobileActionsBtnEl = null;
		}
		const controls = canvas.view.containerEl.querySelector('.canvas-controls');
		if (!controls) return;

		const btn = controls.createEl('button', { attr: { type: 'button' } });
		btn.addClass('cammvas-toggle-btn', 'clickable-icon');
		btn.setAttribute('aria-label', 'Toggle mindmap mode');
		this.registerDomEvent(btn, 'click', (e) => {
			e.stopPropagation();
			this.toggleMindmapMode(canvas);
		});

		controls.prepend(btn);
		this.toggleBtnEl = btn;

		const dragBtn = controls.createEl('button', { attr: { type: 'button' } });
		dragBtn.addClass('cammvas-toggle-btn', 'cammvas-drag-reparent-btn', 'clickable-icon');
		this.registerDomEvent(dragBtn, 'click', (e) => {
			e.stopPropagation();
			if (!canvas.handleSelectionDrag) {
				new Notice("Drag to reparent is unavailable in this canvas version");
				return;
			}
			this.settings.dragToReparent = !this.settings.dragToReparent;
			this.updateDragReparentButton(canvas);
			void this.saveSettings();
		});
		btn.after(dragBtn);
		this.dragReparentBtnEl = dragBtn;

		const autoLayoutOnEditBtn = controls.createEl('button', { attr: { type: 'button' } });
		autoLayoutOnEditBtn.addClass('cammvas-toggle-btn', 'cammvas-auto-layout-on-edit-btn', 'clickable-icon');
		this.registerDomEvent(autoLayoutOnEditBtn, 'click', (e) => {
			e.stopPropagation();
			this.settings.autoLayoutOnEdit = !this.settings.autoLayoutOnEdit;
			this.updateAutoLayoutOnEditButton(canvas);
			void this.saveSettings();
		});
		dragBtn.after(autoLayoutOnEditBtn);
		this.autoLayoutOnEditBtnEl = autoLayoutOnEditBtn;

		const exportPdfBtn = controls.createEl('button', { attr: { type: 'button' } });
		exportPdfBtn.addClass('cammvas-toggle-btn', 'cammvas-export-pdf-btn', 'clickable-icon');
		this.registerDomEvent(exportPdfBtn, 'click', (event) => {
			event.stopPropagation();
			void this.exportMindmapPdf(canvas);
		});
		const layoutBtn = controls.createEl("button", { attr: { type: "button" } });
		layoutBtn.addClass("cammvas-toggle-btn", "cammvas-layout-btn", "clickable-icon");
		this.registerDomEvent(layoutBtn, "click", (event) => {
			event.stopPropagation();
			this.showLayoutMenu(event, canvas);
		});
		autoLayoutOnEditBtn.after(layoutBtn);
		this.layoutBtnEl = layoutBtn;

		layoutBtn.after(exportPdfBtn);
		this.exportPdfBtnEl = exportPdfBtn;

		if (Platform.isMobile) {
			const actionsBtn = controls.createEl('button', { attr: { type: 'button' } });
			actionsBtn.addClass('cammvas-toggle-btn', 'cammvas-mobile-actions-btn', 'clickable-icon');
			actionsBtn.setAttribute('aria-label', 'Mind map actions');
			setIcon(actionsBtn, 'list-plus');
			this.registerDomEvent(actionsBtn, 'click', (event) => {
				event.stopPropagation();
				this.showMobileActionsMenu(canvas, actionsBtn);
			});
			exportPdfBtn.after(actionsBtn);
			this.mobileActionsBtnEl = actionsBtn;
		} else {
			const enterTabBtn = controls.createEl('button', { attr: { type: 'button' } });
			enterTabBtn.addClass('cammvas-toggle-btn', 'cammvas-enter-tab-btn', 'clickable-icon');
			this.registerDomEvent(enterTabBtn, 'click', (event) => {
				event.stopPropagation();
				this.settings.enterCreatesSibling = !this.settings.enterCreatesSibling;
				this.updateEnterTabButton(canvas);
				void this.saveSettings();
			});
			autoLayoutOnEditBtn.after(enterTabBtn);
			this.enterTabBtnEl = enterTabBtn;
		}

		this.updateToggleButton(canvas);
		this.updateDragReparentButton(canvas);
		this.updateAutoLayoutOnEditButton(canvas);
		this.updateExportPdfButton(canvas);
		this.updateEnterTabButton(canvas);
		this.updateMobileActionsButton(canvas);
	}

	private showMobileActionsMenu(canvas: Canvas, anchor: HTMLElement): void {
		const menu = new Menu();
		const selected = this.canvasApi.getSelectedNode(canvas);
		const isMindmap = this.isMindmapCanvas(canvas);
		menu.addItem((item) => item
			.setTitle("Create root node")
			.setIcon("circle-plus")
			.setDisabled(!isMindmap)
			.onClick(() => this.createRootNode()));
		if (selected && isMindmap) {
			menu.addItem((item) => item
				.setTitle("Add child node")
				.setIcon("corner-down-right")
				.onClick(() => this.keyboardHandler.addChildNode(canvas, selected)));
			menu.addItem((item) => item
				.setTitle("Add sibling node")
				.setIcon("list-plus")
				.onClick(() => this.keyboardHandler.addSiblingNode(canvas, selected)));
			menu.addItem((item) => item
				.setTitle("Zoom to branch")
				.setIcon("scan")
				.onClick(() => this.navigation.zoomToBranch(canvas, selected)));
			menu.addItem((item) => item
				.setTitle("Re-layout selected branch")
				.setIcon("list-tree")
				.onClick(() => this.relayoutSelectedBranch(canvas, selected)));
		}
		menu.addItem((item) => item
			.setTitle("Re-layout mind map")
			.setIcon("layout-template")
			.setDisabled(!isMindmap)
			.onClick(() => {
				this.layoutEngine.layout(canvas);
				this.updateGroupBounds(canvas);
			}));
		menu.addItem((item) => item
			.setTitle("Export as high-quality PDF")
			.setIcon("file-down")
			.setDisabled(!isMindmap || canvas.nodes.size === 0)
			.onClick(() => {
				void this.exportMindmapPdf(canvas);
			}));
		menu.addItem((item) => item
			.setTitle("Open map outline")
			.setIcon("list-tree")
			.onClick(() => this.showOutline(canvas, true)));
		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom });
	}

	private showBranchColorMenu(
		event: MouseEvent | KeyboardEvent,
		canvas: Canvas,
		nodeId: string,
		colors: ReadonlyArray<readonly [string, string]>
	): void {
		const colorMenu = new Menu();
		for (const [color, label] of colors) {
			colorMenu.addItem((item) => item
				.setTitle(label)
				.setIcon(`cammvas-color-${color}`)
				.onClick(() => this.branchColors.setBranchColor(canvas, nodeId, color)));
		}
		colorMenu.showAtMouseEvent(event as MouseEvent);
	}

	private showLayoutMenu(event: MouseEvent, canvas: Canvas): void {
		if (!this.isMindmapCanvas(canvas)) return;
		const layoutMenu = new Menu();
		for (const [orientation, title, icon] of [
			["horizontal", "Horizontal layout", "rows-3"],
			["vertical", "Vertical layout", "columns-3"],
		] as const) {
			layoutMenu.addItem((item) => item
				.setTitle(title)
				.setIcon(icon)
				.onClick(() => this.applyLayout(canvas, orientation)));
		}
		layoutMenu.showAtMouseEvent(event);
	}

	private applyLayout(canvas: Canvas, orientation: LayoutOrientation): void {
		this.layoutEngine.layout(canvas, new Set(), orientation);
		this.updateGroupBounds(canvas);
	}

	private exportMindmapPdf(canvas: Canvas): void {
		const fileName = canvas.view.file.path.split("/").pop()?.replace(/\.canvas$/i, "") || "mindmap";
		new PdfExportModal(this.app, fileName, (name, folder, pageSize) => {
			void this.saveMindmapPdf(canvas, name, folder, pageSize);
		}).open();
	}

	private async saveMindmapPdf(
		canvas: Canvas,
		fileName: string,
		outputFolder: string,
		pageSize: import("./export/pdf-export").PdfPageSize
	): Promise<void> {
		const safeName = fileName.replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|]/g, "-") || "mindmap";
		try {
			const pdf = await createMindmapPdf(canvas, safeName, async (path) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) return null;
				return new Uint8Array(await this.app.vault.readBinary(file));
			}, pageSize);
			if (!pdf) {
				new Notice("Unable to prepare the PDF export.");
				return;
			}
			const folder = await this.ensureExportFolder(outputFolder);
			let outputPath = `${folder ? `${folder}/` : ""}${safeName}.pdf`;
			let index = 2;
			while (this.app.vault.getAbstractFileByPath(outputPath)) {
				outputPath = `${folder ? `${folder}/` : ""}${safeName} ${index++}.pdf`;
			}
			await this.app.vault.createBinary(outputPath, pdf);
			new Notice(`PDF exported (${pageSize.toUpperCase()}) to ${outputPath}`);
		} catch (error) {
			console.error("Cammvas PDF export failed", error);
			new Notice("Unable to export the PDF. Check the developer console for details.");
		}
	}

	private async ensureExportFolder(value: string): Promise<string> {
		const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
		if (parts.some((part) => part === "." || part === "..")) {
			throw new Error("Invalid export folder path");
		}
		let path = "";
		for (const part of parts) {
			path = path ? `${path}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(path);
			if (!existing) {
				await this.app.vault.createFolder(path);
			} else if (!(existing instanceof TFolder)) {
				throw new Error(`Export folder path is a file: ${path}`);
			}
		}
		return path;
	}

	private updateToggleButton(canvas: Canvas): void {
		if (!this.toggleBtnEl) return;
		const isActive = this.isMindmapCanvas(canvas);
		this.toggleBtnEl.empty();
		setIcon(this.toggleBtnEl, isActive ? 'network' : 'layout-dashboard');
		this.toggleBtnEl.toggleClass('is-active', isActive);
		this.toggleBtnEl.setAttribute('aria-label',
			isActive ? 'Mindmap mode (active)' : 'Mindmap mode (inactive)');
	}

	private updateDragReparentButton(canvas = this.canvasApi.getActiveCanvas()): void {
		if (!this.dragReparentBtnEl) return;
		const mindmapEnabled = !!canvas && this.isMindmapCanvas(canvas);
		const controlEnabled = mindmapEnabled && !!canvas.handleSelectionDrag;
		const isActive = controlEnabled && this.settings.dragToReparent;
		this.dragReparentBtnEl.empty();
		setIcon(this.dragReparentBtnEl, 'git-branch');
		this.dragReparentBtnEl.toggleClass('is-active', isActive);
		this.dragReparentBtnEl.toggleAttribute('disabled', !controlEnabled);
		this.dragReparentBtnEl.setAttribute('aria-disabled', String(!controlEnabled));
		this.dragReparentBtnEl.setAttribute(
			'aria-label',
			!mindmapEnabled
				? 'Drag to reparent (requires mindmap mode)'
				: isActive ? 'Drag to reparent (active)' : 'Drag to reparent (inactive)'
		);
	}

	private updateAutoLayoutOnEditButton(canvas = this.canvasApi.getActiveCanvas()): void {
		if (!this.autoLayoutOnEditBtnEl) return;
		const controlEnabled = !!canvas && this.isMindmapCanvas(canvas);
		const isActive = controlEnabled && this.settings.autoLayoutOnEdit;
		this.autoLayoutOnEditBtnEl.empty();
		setIcon(this.autoLayoutOnEditBtnEl, 'layout-grid');
		this.autoLayoutOnEditBtnEl.toggleClass('is-active', isActive);
		this.autoLayoutOnEditBtnEl.toggleAttribute('disabled', !controlEnabled);
		this.autoLayoutOnEditBtnEl.setAttribute('aria-disabled', String(!controlEnabled));
		this.autoLayoutOnEditBtnEl.setAttribute(
			'aria-label',
			!controlEnabled
				? 'Auto-layout on manual edits (requires mindmap mode)'
				: isActive ? 'Auto-layout on manual edits (active)' : 'Auto-layout on manual edits (inactive)'
		);
	}

	private updateLayoutButton(canvas = this.canvasApi.getActiveCanvas()): void {
		if (!this.layoutBtnEl) return;
		const enabled = !!canvas && this.isMindmapCanvas(canvas) && canvas.nodes.size > 0;
		this.layoutBtnEl.empty();
		setIcon(this.layoutBtnEl, "layout-template");
		this.layoutBtnEl.toggleAttribute("disabled", !enabled);
		this.layoutBtnEl.setAttribute("aria-disabled", String(!enabled));
		this.layoutBtnEl.setAttribute(
			"aria-label",
			enabled ? "Choose mindmap layout" : "Choose layout (requires a non-empty mindmap)"
		);
	}

	private updateExportPdfButton(canvas = this.canvasApi.getActiveCanvas()): void {
		if (!this.exportPdfBtnEl) return;
		const enabled = !!canvas && this.isMindmapCanvas(canvas) && canvas.nodes.size > 0;
		this.exportPdfBtnEl.empty();
		setIcon(this.exportPdfBtnEl, "file-down");
		this.exportPdfBtnEl.toggleAttribute("disabled", !enabled);
		this.exportPdfBtnEl.setAttribute("aria-disabled", String(!enabled));
		this.exportPdfBtnEl.setAttribute(
			"aria-label",
			enabled ? "Export as high-quality PDF" : "Export PDF (requires a non-empty mindmap)"
		);
	}

	private updateEnterTabButton(canvas = this.canvasApi.getActiveCanvas()): void {
		if (!this.enterTabBtnEl) return;
		const controlEnabled = !!canvas && this.isMindmapCanvas(canvas);
		const isActive = controlEnabled && this.settings.enterCreatesSibling;
		this.enterTabBtnEl.empty();
		setIcon(this.enterTabBtnEl, 'keyboard');
		this.enterTabBtnEl.toggleClass('is-active', isActive);
		this.enterTabBtnEl.toggleAttribute('disabled', !controlEnabled);
		this.enterTabBtnEl.setAttribute('aria-disabled', String(!controlEnabled));
		this.enterTabBtnEl.setAttribute(
			'aria-label',
			!controlEnabled
				? 'Mind mapping Enter and Tab (requires mindmap mode)'
				: isActive ? 'Mind mapping Enter and Tab (active)' : 'Mind mapping Enter and Tab (inactive)'
		);
	}

	private updateMobileActionsButton(canvas = this.canvasApi.getActiveCanvas()): void {
		if (!this.mobileActionsBtnEl) return;
		const controlEnabled = !!canvas && this.isMindmapCanvas(canvas);
		this.mobileActionsBtnEl.toggleAttribute('disabled', !controlEnabled);
		this.mobileActionsBtnEl.setAttribute('aria-disabled', String(!controlEnabled));
		this.mobileActionsBtnEl.setAttribute(
			'aria-label',
			controlEnabled ? 'Mind map actions' : 'Mind map actions (requires mindmap mode)'
		);
	}

	private relayoutSelectedBranch(canvas: Canvas, branchParent?: CanvasNode): void {
		if (!this.isMindmapCanvas(canvas)) {
			new Notice("Enable mindmap mode before re-layout");
			return;
		}
		const node = branchParent ?? this.canvasApi.getSelectedNode(canvas);
		if (!node) {
			new Notice("Select a branch parent before re-layout");
			return;
		}
		if (this.canvasApi.getChildNodes(canvas, node).length === 0) {
			new Notice("The selected node has no child branch to re-layout");
			return;
		}

		// Finalize live sizing without triggering the normal root-level edit-exit layout.
		this.autoResizeHandle?.finalizeNode();
		this.layoutEngine.layoutChildren(canvas, node.id);
		this.updateGroupBounds(canvas);
		this.branchCollapseHandle?.refresh();
	}

	/** Schedule a setTimeout that is automatically cancelled on unload/canvas switch. */
	private trackedTimeout(win: Window, callback: () => void, ms: number): void {
		const pending = { id: 0, win };
		pending.id = win.setTimeout(() => {
			this.pendingTimers.delete(pending);
			callback();
		}, ms);
		this.pendingTimers.add(pending);
	}

	/** Schedule a requestAnimationFrame that is automatically cancelled on cleanup. */
	private trackedRaf(win: Window, callback: () => void): void {
		const pending = { id: 0, win };
		pending.id = win.requestAnimationFrame(() => {
			this.pendingRafs.delete(pending);
			callback();
		});
		this.pendingRafs.add(pending);
	}

	/** Cancel all pending tracked timers, RAFs, and observers. */
	private cancelPendingAsync(): void {
		for (const pending of this.pendingTimers) pending.win.clearTimeout(pending.id);
		this.pendingTimers.clear();
		for (const pending of this.pendingRafs) pending.win.cancelAnimationFrame(pending.id);
		this.pendingRafs.clear();
		for (const obs of this.pendingObservers) obs.disconnect();
		this.pendingObservers.clear();
	}

	/** Restore wrapped canvas methods to originals. */
	private unwrapCanvasMethods(): void {
		if (this.interceptedCanvas) {
			if (this.origCanvasMethods.requestSave) {
				this.interceptedCanvas.requestSave = this.origCanvasMethods.requestSave;
			}
			if (this.origCanvasMethods.createGroupNode) {
				this.interceptedCanvas.createGroupNode = this.origCanvasMethods.createGroupNode;
			}
			if (this.origCanvasMethods.undo) {
				this.interceptedCanvas.undo = this.origCanvasMethods.undo;
			}
			if (this.origCanvasMethods.redo) {
				this.interceptedCanvas.redo = this.origCanvasMethods.redo;
			}
			if (this.origCanvasMethods.selectOnly) {
				this.interceptedCanvas.selectOnly = this.origCanvasMethods.selectOnly;
			}
		}
		this.interceptedCanvas = null;
		this.origCanvasMethods = {};
	}

	async loadSettings(): Promise<void> {
		const data: unknown = await this.loadData();
		this.settings = normalizeSettings(data);
	}

	async saveSettings(refreshBranchColors = false): Promise<void> {
		await this.saveData(this.settings);

		// Update services with new settings
		this.layoutEngine = new LayoutEngine({
			horizontalGap: this.settings.horizontalGap,
			verticalGap: this.settings.verticalGap,
			nodeWidth: this.settings.defaultNodeWidth,
			nodeHeight: this.settings.defaultNodeHeight,
		});
		this.nodeOps = new NodeOperations(this.canvasApi, {
			nodeWidth: this.settings.defaultNodeWidth,
			nodeHeight: this.settings.defaultNodeHeight,
			horizontalGap: this.settings.horizontalGap,
			verticalGap: this.settings.verticalGap,
		});
		this.branchColors = new BranchColors(
			this.canvasApi,
			this.settings.branchPalette,
			this.settings.colorLeafNodes
		);

		// Update keyboard handler references so it uses the new instances
		if (this.keyboardHandler) {
			this.keyboardHandler.nodeOps = this.nodeOps;
			this.keyboardHandler.layoutEngine = this.layoutEngine;
			this.keyboardHandler.branchColors = this.branchColors;
			this.keyboardHandler.zoomPadding = this.settings.navigationZoomPadding;
		}
		this.updateDragReparentButton();
		this.updateAutoLayoutOnEditButton();
		this.updateExportPdfButton();
		this.updateEnterTabButton();

		// Update edge label font size CSS variable
		const canvas = this.canvasApi.getActiveCanvas();
		if (canvas) {
			canvas.wrapperEl.style.setProperty("--cammvas-edge-label-font-size", `${this.settings.edgeLabelFontSize}px`);
		}

		if (refreshBranchColors && canvas && this.settings.autoColor && this.isMindmapCanvas(canvas)) {
			this.branchColors.applyColors(canvas);
		}
	}

	private createRootNode(): void {
		const canvas = this.canvasApi?.getActiveCanvas();
		if (!canvas) {
			new Notice("Open a canvas before creating a root node");
			return;
		}
		if (!this.isMindmapCanvas(canvas)) {
			new Notice("Enable mindmap mode before creating a root node");
			return;
		}

		const incomingIds = new Set(
			Array.from(canvas.edges.values(), (edge) => edge.to.node.id)
		);
		const groupIds = getGroupIds(canvas);
		const roots = Array.from(canvas.nodes.values()).filter(
			(node) => !groupIds.has(node.id) && !incomingIds.has(node.id)
		);

		let x: number;
		let y: number;
		const previousRoot = roots[roots.length - 1];
		if (previousRoot) {
			const subtree = this.collectSubtreeNodes(canvas, previousRoot);
			const subtreeBottom = Math.max(...subtree.map((node) => node.y + node.height));
			x = previousRoot.x;
			y = subtreeBottom + Math.max(40, this.settings.verticalGap * 2);
		} else {
			const rect = canvas.wrapperEl.getBoundingClientRect();
			const center = canvas.posFromEvt(new MouseEvent("mousemove", {
				clientX: rect.left + rect.width / 2,
				clientY: rect.top + rect.height / 2,
			}));
			x = center.x - this.settings.defaultNodeWidth / 2;
			y = center.y - this.settings.defaultNodeHeight / 2;
		}
		const node = this.canvasApi.createTextNode(
			canvas,
			x,
			y,
			"",
			this.settings.defaultNodeWidth,
			this.settings.defaultNodeHeight
		);
		canvas.requestSave();
		this.canvasApi.selectAndEdit(canvas, node, this.settings.navigationZoomPadding);
	}

	private registerBranchColorIcons(): void {
		const colors = [
			["1", "#e75545"],
			["2", "#e9973f"],
			["3", "#e0de71"],
			["4", "#44cf6e"],
			["5", "#53aaf5"],
			["6", "#a882f7"],
		] as const;
		for (const [id, color] of colors) {
			addIcon(`cammvas-color-${id}`, `<svg viewBox="0 0 24 24" fill="${color}"><circle cx="12" cy="12" r="8"/></svg>`);
		}
	}
}
