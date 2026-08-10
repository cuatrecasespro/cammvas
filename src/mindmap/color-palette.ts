export const DEFAULT_BRANCH_PALETTE = ["1", "2", "3", "4", "5", "6"];

export function isValidCanvasColor(color: string): boolean {
	return /^[1-6]$/.test(color) || /^#[0-9a-f]{6}$/i.test(color);
}

export function normalizePalette(colors: string[]): string[] {
	const normalized = colors
		.map((color) => color.trim())
		.filter(isValidCanvasColor);
	return normalized.length > 0 ? normalized : [...DEFAULT_BRANCH_PALETTE];
}

export function parsePalette(value: string): string[] {
	return normalizePalette(value.split(","));
}

export function getBranchNodeColor(
	branchColor: string,
	childCount: number,
	colorLeafNodes: boolean
): string {
	return !colorLeafNodes && childCount === 0 ? "" : branchColor;
}
