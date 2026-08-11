export interface DropTargetNode {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	zIndex?: number;
}

export function collectDescendantIds(
	rootId: string,
	getChildIds: (nodeId: string) => Iterable<string>
): Set<string> {
	return collectDescendantIdsForRoots([rootId], getChildIds);
}

export function collectDescendantIdsForRoots(
	rootIds: Iterable<string>,
	getChildIds: (nodeId: string) => Iterable<string>
): Set<string> {
	const descendants = new Set<string>();
	const queue = Array.from(rootIds);
	const visited = new Set(queue);

	while (queue.length > 0) {
		const nodeId = queue.shift()!;
		for (const childId of getChildIds(nodeId)) {
			if (visited.has(childId)) continue;
			visited.add(childId);
			descendants.add(childId);
			queue.push(childId);
		}
	}

	return descendants;
}

export function findDropTarget<T extends DropTargetNode>(
	nodes: Iterable<T>,
	point: { x: number; y: number },
	excludedIds: ReadonlySet<string>,
	hitPadding = 0
): T | null {
	let best: T | null = null;
	let bestZIndex = -Infinity;
	const padding = Math.max(0, hitPadding);

	for (const node of nodes) {
		if (excludedIds.has(node.id)) continue;
		if (point.x < node.x - padding || point.x > node.x + node.width + padding) continue;
		if (point.y < node.y - padding || point.y > node.y + node.height + padding) continue;

		const zIndex = node.zIndex ?? 0;
		if (!best || zIndex >= bestZIndex) {
			best = node;
			bestZIndex = zIndex;
		}
	}

	return best;
}

export function shouldReparentOnDragEnd(eventType: string): boolean {
	return eventType === "pointerup";
}

export function getTopLevelSelectedIds(
	selectedIds: ReadonlySet<string>,
	getParentId: (nodeId: string) => string | null
): Set<string> {
	const roots = new Set<string>();

	for (const nodeId of selectedIds) {
		let parentId = getParentId(nodeId);
		const visited = new Set<string>([nodeId]);
		let nested = false;
		while (parentId && !visited.has(parentId)) {
			if (selectedIds.has(parentId)) {
				nested = true;
				break;
			}
			visited.add(parentId);
			parentId = getParentId(parentId);
		}
		if (!nested) roots.add(nodeId);
	}

	return roots;
}
