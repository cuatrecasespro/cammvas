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
	const descendants = new Set<string>();
	const visited = new Set<string>([rootId]);
	const queue = [rootId];

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
	excludedIds: ReadonlySet<string>
): T | null {
	let best: T | null = null;
	let bestZIndex = -Infinity;

	for (const node of nodes) {
		if (excludedIds.has(node.id)) continue;
		if (point.x < node.x || point.x > node.x + node.width) continue;
		if (point.y < node.y || point.y > node.y + node.height) continue;

		const zIndex = node.zIndex ?? 0;
		if (!best || zIndex >= bestZIndex) {
			best = node;
			bestZIndex = zIndex;
		}
	}

	return best;
}
