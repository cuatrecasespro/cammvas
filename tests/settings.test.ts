import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	Platform: { isMobile: false },
	PluginSettingTab: class {},
}));

import { DEFAULT_SETTINGS, normalizeSettings } from "../src/settings";

describe("mind map spacing settings", () => {
	it("uses a touch-friendly 40px sibling gap by default", () => {
		expect(DEFAULT_SETTINGS.verticalGap).toBe(40);
		expect(normalizeSettings(undefined).verticalGap).toBe(40);
	});

	it("preserves an explicitly configured sibling gap", () => {
		expect(normalizeSettings({ verticalGap: 28 }).verticalGap).toBe(28);
	});
});
