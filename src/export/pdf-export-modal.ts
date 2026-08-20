import { App, Modal, Notice, Setting } from "obsidian";
import type { PdfPageSize } from "./pdf-export";

export class PdfExportModal extends Modal {
	private fileName: string;
	private folder = "Cammvas Exports";
	private pageSize: PdfPageSize = "a4";

	constructor(
		app: App,
		initialFileName: string,
		private onExport: (fileName: string, folder: string, pageSize: PdfPageSize) => void
	) {
		super(app);
		this.fileName = initialFileName;
	}

	onOpen(): void {
		this.setTitle("Save mind map PDF");
		new Setting(this.contentEl)
			.setName("File name")
			.setDesc("The .pdf extension is added automatically.")
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

		new Setting(this.contentEl)
			.setName("Page size")
			.setDesc("Fixed paper sizes fit the whole map on one page. Full size preserves the map's natural dimensions.")
			.addDropdown((dropdown) => {
				dropdown.addOption("a4", "A4 (auto orientation)");
				dropdown.addOption("a3", "A3 (auto orientation)");
				dropdown.addOption("full", "Full size (one large page)");
				dropdown.setValue(this.pageSize);
				dropdown.onChange((value) => this.pageSize = value as PdfPageSize);
			});

		const actions = this.contentEl.createDiv({ cls: "cammvas-pdf-export-actions" });
		actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		actions.createEl("button", { text: "Export PDF", cls: "mod-cta" }).addEventListener("click", () => {
			const fileName = this.fileName.trim();
			if (!fileName) {
				new Notice("Enter a file name before exporting.");
				return;
			}
			this.close();
			this.onExport(fileName, this.folder.trim(), this.pageSize);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
