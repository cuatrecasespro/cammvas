import { describe, expect, it } from "vitest";
import type { Canvas, CanvasEdge, CanvasNode } from "../src/types/canvas-internal";
import { getMobileEditingNode } from "../src/ui/mobile-editing-state";

function canvasWithSelection(item: CanvasNode | CanvasEdge): Canvas {
	return { selection: new Set([item]) } as unknown as Canvas;
}

describe("getMobileEditingNode", () => {
	it("returns the selected text node while editing is enabled", () => {
		const node = { type: "text", isEditing: true, nodeEl: {} } as CanvasNode;
		expect(getMobileEditingNode(canvasWithSelection(node), true)).toBe(node);
	});

	it("hides the bar outside mindmap mode", () => {
		const node = { type: "text", isEditing: true, nodeEl: {} } as CanvasNode;
		expect(getMobileEditingNode(canvasWithSelection(node), false)).toBeNull();
	});

	it("ignores nodes that are not being edited", () => {
		const node = { type: "text", isEditing: false, nodeEl: {} } as CanvasNode;
		expect(getMobileEditingNode(canvasWithSelection(node), true)).toBeNull();
	});
});
