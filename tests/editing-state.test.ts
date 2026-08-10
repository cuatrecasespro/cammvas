import { describe, expect, it, vi } from "vitest";
import type { CanvasNode } from "../src/types/canvas-internal";
import { isNodeEditorFocused } from "../src/ui/editing-state";

describe("isNodeEditorFocused", () => {
	it("uses the live embedded editor focus state", () => {
		const hasFocus = vi.fn(() => true);
		const node = { child: { editor: { hasFocus } } } as unknown as CanvasNode;

		expect(isNodeEditorFocused(node)).toBe(true);
		expect(hasFocus).toHaveBeenCalled();
	});

	it("ignores stale node.isEditing after Escape destroys the editor", () => {
		const node = { isEditing: true, child: {} } as unknown as CanvasNode;

		expect(isNodeEditorFocused(node)).toBe(false);
	});
});
