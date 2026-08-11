import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../src/types/canvas-internal";
import { findNearestNodeInDirection, isRectFullyVisible } from "../src/ui/spatial-navigation";

function node(id: string, x: number, y: number): CanvasNode {
	return { id, x, y, width: 100, height: 50 } as CanvasNode;
}

describe("findNearestNodeInDirection", () => {
	const origin = node("origin", 0, 0);
	const nodes = [
		origin,
		node("right-aligned", 200, 10),
		node("right-diagonal", 120, 200),
		node("left", -200, 0),
		node("up", 0, -150),
		node("down", 0, 150),
	];

	it("prefers a node aligned with the requested axis", () => {
		expect(findNearestNodeInDirection(origin, nodes, "right")?.id).toBe("right-aligned");
	});

	it.each([
		["left", "left"],
		["up", "up"],
		["down", "down"],
	] as const)("finds the nearest node to the %s", (direction, expected) => {
		expect(findNearestNodeInDirection(origin, nodes, direction)?.id).toBe(expected);
	});

	it("returns null when no node exists in that half-plane", () => {
		expect(findNearestNodeInDirection(origin, [origin, node("left", -100, 0)], "right")).toBeNull();
	});
});

describe("isRectFullyVisible", () => {
	const viewport = { top: 0, right: 800, bottom: 600, left: 0 };

	it("returns true when the node is fully inside the viewport", () => {
		expect(isRectFullyVisible(
			{ top: 100, right: 300, bottom: 200, left: 100 },
			viewport
		)).toBe(true);
	});

	it("returns false when any part of the node is outside the viewport", () => {
		expect(isRectFullyVisible(
			{ top: 100, right: 850, bottom: 200, left: 650 },
			viewport
		)).toBe(false);
	});
});
