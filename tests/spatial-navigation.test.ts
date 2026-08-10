import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../src/types/canvas-internal";
import { findNearestNodeInDirection } from "../src/ui/spatial-navigation";

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
