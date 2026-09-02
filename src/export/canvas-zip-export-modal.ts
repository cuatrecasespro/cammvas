import { App, Modal, Notice, Setting } from "obsidian";

export class CanvasZipExportModal extends Modal {
	private fileName: string;
	private folder = "Cammvas Exports";

	constructor(
		app: App,
		initialFileName: string,
		private onExport: (fileName: string, folder: string) => void
	) {
		super(app);
		this.fileName = initialFileName;
	}

	onOpen(): void {
		this.setTitle("Save portable canvas zip");
		new Setting(this.contentEl)
			.setName("File name")
			.setDesc("The .zip extension is added automatically.")
			.addText((text) => {
				text.setValue(this.fileName);
				text.inputEl.select();
				text.onChange((value) => this.fileName = value);
			});
		new Setting(this.contentEl)
			.setName("Save in")
			.setDesc("Folder path in the vault. It is created automatically when needed; leave empty for the vault root.")
			.addText((text) => {
				text.setValue(this.folder);
				text.onChange((value) => this.folder = value);
			});
		this.contentEl.createEl("p", {
			text: "The zip includes this canvas and every file directly embedded as a canvas node. Extract it at the root of another vault.",
		});
		const actions = this.contentEl.createDiv({ cls: "cammvas-pdf-export-actions" });
		actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		actions.createEl("button", { text: "Export zip", cls: "mod-cta" }).addEventListener("click", () => {
			const fileName = this.fileName.trim();
			if (!fileName) {
				new Notice("Enter a file name before exporting.");
				return;
			}
			this.close();
			this.onExport(fileName, this.folder.trim());
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
