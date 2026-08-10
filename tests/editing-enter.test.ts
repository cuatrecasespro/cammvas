import { describe, expect, it } from "vitest";
import { shouldCreateChildOnTab, shouldCreateSiblingOnEnter } from "../src/ui/editing-enter";

function enterEvent(overrides: Partial<Parameters<typeof shouldCreateSiblingOnEnter>[0]> = {}) {
	return {
		key: "Enter",
		shiftKey: false,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		isComposing: false,
		...overrides,
	};
}

describe("shouldCreateSiblingOnEnter", () => {
	it("handles plain Enter while editing when enabled", () => {
		expect(shouldCreateSiblingOnEnter(enterEvent(), true, true)).toBe(true);
	});

	it("leaves Shift+Enter available for new lines", () => {
		expect(shouldCreateSiblingOnEnter(enterEvent({ shiftKey: true }), true, true)).toBe(false);
	});

	it("does not interfere when disabled, outside editing, or during composition", () => {
		expect(shouldCreateSiblingOnEnter(enterEvent(), false, true)).toBe(false);
		expect(shouldCreateSiblingOnEnter(enterEvent(), true, false)).toBe(false);
		expect(shouldCreateSiblingOnEnter(enterEvent({ isComposing: true }), true, true)).toBe(false);
	});
});

describe("shouldCreateChildOnTab", () => {
	it("handles plain Tab when the mode is enabled and a node is selected", () => {
		expect(shouldCreateChildOnTab(enterEvent({ key: "Tab" }), true, true)).toBe(true);
	});

	it("leaves modified Tab and disabled mode unchanged", () => {
		expect(shouldCreateChildOnTab(enterEvent({ key: "Tab", shiftKey: true }), true, true)).toBe(false);
		expect(shouldCreateChildOnTab(enterEvent({ key: "Tab" }), false, true)).toBe(false);
		expect(shouldCreateChildOnTab(enterEvent({ key: "Tab" }), true, false)).toBe(false);
	});
});
