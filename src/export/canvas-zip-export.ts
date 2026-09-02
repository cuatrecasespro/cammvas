import { strToU8, zipSync } from "fflate";
import type { CanvasFileData } from "../types/canvas-internal";

export interface CanvasZipResult {
	archive: Uint8Array;
	missingPaths: string[];
}

/** Bundle a Canvas file and its direct file-node attachments into a portable ZIP. */
export async function createCanvasZip(
	canvasPath: string,
	data: CanvasFileData,
	readFile: (path: string) => Promise<Uint8Array | null>
): Promise<CanvasZipResult> {
	const packageFolder = getPackageFolder(canvasPath);
	const canvasFileName = canvasPath.split("/").pop() || "mindmap.canvas";
	const copiedData: CanvasFileData = { ...data, nodes: data.nodes.map((node) => ({ ...node })) };
	const files: Record<string, Uint8Array> = {};
	const missingPaths: string[] = [];
	const attachmentPaths = new Set<string>();

	for (const node of copiedData.nodes) {
		if (node.type !== "file" || typeof node.file !== "string") continue;
		const sourcePath = node.file;
		if (!isVaultPath(sourcePath)) {
			missingPaths.push(sourcePath);
			continue;
		}
		attachmentPaths.add(sourcePath);
		node.file = `${packageFolder}/attachments/${sourcePath}`;
	}

	for (const path of attachmentPaths) {
		const content = await readFile(path);
		if (content) files[`${packageFolder}/attachments/${path}`] = content;
		else missingPaths.push(path);
	}
	files[`${packageFolder}/${canvasFileName}`] = strToU8(JSON.stringify(copiedData, null, 2));

	return { archive: zipSync(files, { level: 6 }), missingPaths };
}

function isVaultPath(path: string): boolean {
	return !!path && !path.startsWith("/") && !path.split("/").includes("..");
}

function getPackageFolder(canvasPath: string): string {
	const name = (canvasPath.split("/").pop() || "mindmap")
		.replace(/\.canvas$/i, "")
		.replace(/[\\/:*?"<>|]/g, "-");
	return `${name || "mindmap"} Cammvas export`;
}
