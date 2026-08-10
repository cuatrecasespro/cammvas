import { describe, expect, it } from "vitest";
import {
	DEFAULT_BRANCH_PALETTE,
	getBranchNodeColor,
	normalizePalette,
	parsePalette,
} from "../src/mindmap/color-palette";

describe("color palette", () => {
	it("trims colors and removes empty entries", () => {
		expect(parsePalette(" #ff0000, 2, invalid, 7, #xyz, #00ff00 ")).toEqual([
			"#ff0000",
			"2",
			"#00ff00",
		]);
	});

	it("falls back to a new copy of the default palette", () => {
		const palette = normalizePalette(["", "  "]);
		expect(palette).toEqual(DEFAULT_BRANCH_PALETTE);
		expect(palette).not.toBe(DEFAULT_BRANCH_PALETTE);
	});

	it("only neutralizes terminal nodes when leaf coloring is disabled", () => {
		expect(getBranchNodeColor("#ff0000", 0, false)).toBe("");
		expect(getBranchNodeColor("#ff0000", 1, false)).toBe("#ff0000");
		expect(getBranchNodeColor("#ff0000", 0, true)).toBe("#ff0000");
	});
});
