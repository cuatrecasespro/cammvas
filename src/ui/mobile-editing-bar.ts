import { setIcon } from "obsidian";
import type { Canvas, CanvasNode } from "../types/canvas-internal";
import { getMobileEditingNode } from "./mobile-editing-state";

export interface MobileEditingBarHandle {
	cleanup: () => void;
	refresh: () => void;
}

export function registerMobileEditingBar(
	canvas: Canvas,
	isEnabled: () => boolean,
	canAddSibling: (node: CanvasNode) => boolean,
	onAddChild: (node: CanvasNode) => void,
	onAddSibling: (node: CanvasNode) => void,
	onDone: (node: CanvasNode) => void
): MobileEditingBarHandle {
	const doc = canvas.wrapperEl.doc;
	const win = canvas.wrapperEl.win;
	const bar = doc.body.createDiv({ cls: "cammvas-mobile-editing-bar" });
	bar.hidden = true;
	bar.setAttribute("role", "toolbar");
	bar.setAttribute("aria-label", "Node editing actions");

	const createButton = (label: string, icon: string): HTMLButtonElement => {
		const button = bar.createEl("button", {
			cls: "cammvas-mobile-editing-action",
			attr: { type: "button", "aria-label": `Create ${label.toLowerCase()} node` },
		});
		const iconEl = button.createSpan({ cls: "cammvas-mobile-editing-action-icon" });
		setIcon(iconEl, icon);
		button.createSpan({ text: label });
		return button;
	};

	const childButton = createButton("Child", "corner-down-right");
	const siblingButton = createButton("Sibling", "list-plus");
	const doneButton = bar.createEl("button", {
		cls: "cammvas-mobile-editing-action cammvas-mobile-editing-done",
		attr: { type: "button", "aria-label": "Finish editing node" },
	});
	const doneIcon = doneButton.createSpan({ cls: "cammvas-mobile-editing-action-icon" });
	setIcon(doneIcon, "check");
	doneButton.createSpan({ text: "Done" });

	let activeNode: CanvasNode | null = null;
	let refreshRaf = 0;
	let refreshTimer = 0;

	const positionBar = (): void => {
		if (bar.hidden) return;
		const viewport = win.visualViewport;
		if (!viewport) {
			bar.removeClass("is-visual-viewport-positioned");
			bar.style.removeProperty("top");
			bar.style.removeProperty("left");
			return;
		}
		const height = bar.getBoundingClientRect().height;
		bar.addClass("is-visual-viewport-positioned");
		bar.style.setProperty("left", `${viewport.offsetLeft + viewport.width / 2}px`);
		bar.style.setProperty(
			"top",
			`${Math.max(viewport.offsetTop + 8, viewport.offsetTop + viewport.height - height - 8)}px`
		);
	};

	const refresh = (): void => {
		const node = getMobileEditingNode(canvas, isEnabled());
		activeNode = node;
		bar.hidden = !node;
		siblingButton.disabled = !node || !canAddSibling(node);
		if (node) positionBar();
	};

	const scheduleRefresh = (delay = 0): void => {
		if (refreshTimer) win.clearTimeout(refreshTimer);
		if (refreshRaf) win.cancelAnimationFrame(refreshRaf);
		if (delay > 0) {
			refreshTimer = win.setTimeout(() => {
				refreshTimer = 0;
				refresh();
			}, delay);
			return;
		}
		refreshRaf = win.requestAnimationFrame(() => {
			refreshRaf = 0;
			refresh();
		});
	};

	const preserveEditorFocus = (event: PointerEvent): void => {
		event.preventDefault();
		event.stopPropagation();
	};
	const runAction = (event: MouseEvent, action: (node: CanvasNode) => void): void => {
		event.preventDefault();
		event.stopPropagation();
		const node = activeNode ?? getMobileEditingNode(canvas, isEnabled());
		if (!node) return;
		action(node);
		scheduleRefresh();
	};

	const onChildClick = (event: MouseEvent) => runAction(event, onAddChild);
	const onSiblingClick = (event: MouseEvent) => runAction(event, onAddSibling);
	const onDoneClick = (event: MouseEvent) => runAction(event, (node) => {
		onDone(node);
		activeNode = null;
		bar.hidden = true;
	});
	for (const button of [childButton, siblingButton, doneButton]) {
		button.addEventListener("pointerdown", preserveEditorFocus);
	}
	childButton.addEventListener("click", onChildClick);
	siblingButton.addEventListener("click", onSiblingClick);
	doneButton.addEventListener("click", onDoneClick);

	const onFocusIn = () => scheduleRefresh();
	const onFocusOut = () => scheduleRefresh(80);
	const onCanvasPointerDown = () => scheduleRefresh(80);
	canvas.wrapperEl.addEventListener("focusin", onFocusIn);
	canvas.wrapperEl.addEventListener("focusout", onFocusOut);
	canvas.wrapperEl.addEventListener("pointerdown", onCanvasPointerDown);

	const Observer = Reflect.get(win, "MutationObserver") as typeof MutationObserver;
	const observer = new Observer(() => scheduleRefresh());
	observer.observe(canvas.wrapperEl, { childList: true, subtree: true });

	const viewport = win.visualViewport;
	viewport?.addEventListener("resize", positionBar);
	viewport?.addEventListener("scroll", positionBar);
	win.addEventListener("resize", positionBar);

	return {
		refresh: scheduleRefresh,
		cleanup: () => {
			if (refreshTimer) win.clearTimeout(refreshTimer);
			if (refreshRaf) win.cancelAnimationFrame(refreshRaf);
			observer.disconnect();
			canvas.wrapperEl.removeEventListener("focusin", onFocusIn);
			canvas.wrapperEl.removeEventListener("focusout", onFocusOut);
			canvas.wrapperEl.removeEventListener("pointerdown", onCanvasPointerDown);
			viewport?.removeEventListener("resize", positionBar);
			viewport?.removeEventListener("scroll", positionBar);
			win.removeEventListener("resize", positionBar);
			bar.remove();
		},
	};
}
