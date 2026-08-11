import type { Canvas, CanvasNode } from "../types/canvas-internal";

export function getMobileEditingNode(canvas: Canvas, enabled: boolean): CanvasNode | null {
	if (!enabled || canvas.selection.size !== 1) return null;
	for (const item of canvas.selection) {
		return "nodeEl" in item && item.type === "text" && item.isEditing ? item : null;
	}
	return null;
}
