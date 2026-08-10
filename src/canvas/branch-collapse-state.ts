export function collectCollapsedDescendantIds(
	collapsedIds: Iterable<string>,
	getChildren: (nodeId: string) => string[]
): Set<string> {
	const hidden = new Set<string>();
	for (const collapsedId of collapsedIds) {
		const visited = new Set<string>([collapsedId]);
		const queue = [...getChildren(collapsedId)];
		while (queue.length > 0) {
			const id = queue.shift()!;
			if (visited.has(id)) continue;
			visited.add(id);
			hidden.add(id);
			queue.push(...getChildren(id));
		}
	}
	return hidden;
}
