import { setIcon } from "obsidian";
import type { Canvas, CanvasEdge, CanvasNode } from "../types/canvas-internal";
import { CanvasAPI } from "./canvas-api";
import { collectCollapsedDescendantIds } from "./branch-collapse-state";

const BUTTON_CLASS = "cammvas-canvas-collapse-button";
export const COLLAPSED_HIDDEN_CLASS = "cammvas-canvas-branch-hidden";

export interface BranchCollapseHandle {
	refresh: () => void;
	cleanup: () => void;
}

export function registerBranchCollapse(
	canvas: Canvas,
	canvasApi: CanvasAPI
): BranchCollapseHandle {
	let disposed = false;
	let refreshRaf: number | null = null;
	let observer: MutationObserver;
	const win = canvas.wrapperEl.win;

	const scheduleRefresh = (): void => {
		if (disposed || refreshRaf !== null) return;
		refreshRaf = win.requestAnimationFrame(() => {
			refreshRaf = null;
			refresh();
		});
	};

	const toggle = (nodeId: string): void => {
		const data = canvas.getData();
		const collapsed = new Set(data.mindmapCollapsed ?? []);
		if (collapsed.has(nodeId)) collapsed.delete(nodeId);
		else collapsed.add(nodeId);
		data.mindmapCollapsed = [...collapsed];
		canvas.setData(data);
		canvas.requestSave();
		scheduleRefresh();
		win.setTimeout(scheduleRefresh, 50);
	};

	const syncButton = (
		node: CanvasNode,
		collapsed: boolean,
		descendantCount: number
	): void => {
		let button = node.nodeEl.querySelector<HTMLElement>(`:scope > .${BUTTON_CLASS}`);
		if (!button) {
			button = node.nodeEl.createEl("button");
			button.className = `${BUTTON_CLASS} clickable-icon`;
			button.setAttribute("type", "button");
			button.addEventListener("pointerdown", (event) => {
				event.preventDefault();
				event.stopPropagation();
			});
			button.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				toggle(node.id);
			});
			node.nodeEl.appendChild(button);
		}

		const state = collapsed ? "collapsed" : "expanded";
		if (button.dataset.state !== state) {
			button.empty();
			setIcon(button, collapsed ? "chevron-right" : "chevron-down");
			button.dataset.state = state;
		}
		button.setAttribute(
			"aria-label",
			`${collapsed ? "Expand" : "Collapse"} branch (${descendantCount} descendant${descendantCount === 1 ? "" : "s"})`
		);
	};

	const setEdgeHidden = (edge: CanvasEdge, hidden: boolean): void => {
		edge.lineGroupEl?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.lineEl?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.lineEndGroupEl?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.startGroupEl?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.endGroupEl?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.fromLineEnd?.el?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.toLineEnd?.el?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.labelElement?.wrapperEl?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.path?.display?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
		edge.path?.interaction?.toggleClass(COLLAPSED_HIDDEN_CLASS, hidden);
	};

	const refresh = (): void => {
		if (disposed) return;
		observer.disconnect();
		canvasApi.invalidateEdgeIndex();

		const collapsedIds = new Set(canvas.getData().mindmapCollapsed ?? []);
		const childIds = (nodeId: string): string[] =>
			canvasApi.getOutgoingEdges(canvas, nodeId).map((edge) => edge.to.node.id);
		const hiddenIds = collectCollapsedDescendantIds(collapsedIds, childIds);
		const hiddenSelection = Array.from(canvas.selection).some((item) => {
			if ("nodeEl" in item) return hiddenIds.has(item.id);
			return hiddenIds.has(item.from.node.id) || hiddenIds.has(item.to.node.id);
		});
		if (hiddenSelection) canvas.deselectAll();

		for (const node of canvas.nodes.values()) {
			node.nodeEl.toggleClass(COLLAPSED_HIDDEN_CLASS, hiddenIds.has(node.id));
			const children = childIds(node.id);
			const existing = node.nodeEl.querySelector<HTMLElement>(`:scope > .${BUTTON_CLASS}`);
			if (children.length === 0) {
				existing?.remove();
				continue;
			}
			const descendants = collectCollapsedDescendantIds([node.id], childIds);
			syncButton(node, collapsedIds.has(node.id), descendants.size);
		}

		for (const edge of canvas.edges.values()) {
			setEdgeHidden(
				edge,
				hiddenIds.has(edge.from.node.id) || hiddenIds.has(edge.to.node.id)
			);
		}

		observer.observe(canvas.wrapperEl, { childList: true, subtree: true });
	};

	const Observer = Reflect.get(win, "MutationObserver") as typeof MutationObserver;
	observer = new Observer(scheduleRefresh);
	observer.observe(canvas.wrapperEl, { childList: true, subtree: true });
	refresh();

	return {
		refresh: scheduleRefresh,
		cleanup: () => {
			disposed = true;
			observer.disconnect();
			if (refreshRaf !== null) win.cancelAnimationFrame(refreshRaf);
			for (const node of canvas.nodes.values()) {
				node.nodeEl.removeClass(COLLAPSED_HIDDEN_CLASS);
				node.nodeEl.querySelector<HTMLElement>(`:scope > .${BUTTON_CLASS}`)?.remove();
			}
			for (const edge of canvas.edges.values()) setEdgeHidden(edge, false);
		},
	};
}
