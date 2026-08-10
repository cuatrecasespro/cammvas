import type { CanvasNode } from "../types/canvas-internal";

export type SpatialDirection = "left" | "right" | "up" | "down";

export function findNearestNodeInDirection(
	origin: CanvasNode,
	candidates: CanvasNode[],
	direction: SpatialDirection
): CanvasNode | null {
	const originX = origin.x + origin.width / 2;
	const originY = origin.y + origin.height / 2;
	let nearest: CanvasNode | null = null;
	let nearestScore = Infinity;

	for (const candidate of candidates) {
		if (candidate.id === origin.id) continue;
		const dx = candidate.x + candidate.width / 2 - originX;
		const dy = candidate.y + candidate.height / 2 - originY;
		const primary = direction === "right" ? dx
			: direction === "left" ? -dx
			: direction === "down" ? dy
			: -dy;
		if (primary <= 0) continue;

		const perpendicular = direction === "left" || direction === "right"
			? Math.abs(dy)
			: Math.abs(dx);
		// Prefer alignment with the requested axis while still accounting for distance.
		const score = primary + perpendicular * 2;
		if (score < nearestScore) {
			nearest = candidate;
			nearestScore = score;
		}
	}

	return nearest;
}
