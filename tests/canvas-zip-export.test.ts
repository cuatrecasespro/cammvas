import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createCanvasZip } from "../src/export/canvas-zip-export";

describe("createCanvasZip", () => {
	it("packages the Canvas and direct file-node attachments at their vault paths", async () => {
		const result = await createCanvasZip("Maps/Project.canvas", {
			nodes: [
				{ id: "image", type: "file", file: "Assets/diagram.png", x: 0, y: 0, width: 100, height: 50 },
				{ id: "missing", type: "file", file: "Notes/missing.md", x: 0, y: 0, width: 100, height: 50 },
			],
			edges: [],
			mindmap: true,
		}, async (path) => path === "Assets/diagram.png" ? new Uint8Array([1, 2, 3]) : null);

		const files = unzipSync(result.archive);
		const canvas = JSON.parse(strFromU8(files["Project Cammvas export/Project.canvas"])) as {
			mindmap?: boolean;
			nodes: Array<{ file?: string }>;
		};
		expect(canvas).toMatchObject({ mindmap: true });
		expect(canvas.nodes[0].file).toBe("Project Cammvas export/attachments/Assets/diagram.png");
		expect(files["Project Cammvas export/attachments/Assets/diagram.png"]).toEqual(new Uint8Array([1, 2, 3]));
		expect(result.missingPaths).toEqual(["Notes/missing.md"]);
	});
});
