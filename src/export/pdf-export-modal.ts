import { App, Modal, Notice, Setting, TFolder } from "obsidian";

export class PdfExportModal extends Modal {
	private fileName: string;
	private folder = "Cammvas Exports";
	private newFolder = "";

	constructor(
		app: App,
		initialFileName: string,
		private onExport: (fileName: string, folder: string) => void
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

		const folders = this.app.vault.getAllLoadedFiles()
			.filter((file): file is TFolder => file instanceof TFolder)
			.map((folder) => folder.path)
			.filter((path) => path && path !== "Cammvas Exports")
			.sort((a, b) => a.localeCompare(b));
		new Setting(this.contentEl)
			.setName("Save in")
			.addDropdown((dropdown) => {
				dropdown.addOption("Cammvas Exports", "Cammvas Exports");
				dropdown.addOption("", "Vault root");
				for (const folder of folders) dropdown.addOption(folder, folder);
				dropdown.setValue(this.folder);
				dropdown.onChange((value) => this.folder = value);
			});

		new Setting(this.contentEl)
			.setName("New folder")
			.setDesc("Optional. Creates this folder in the vault and saves the PDF there.")
			.addText((text) => text.onChange((value) => this.newFolder = value));

		const actions = this.contentEl.createDiv({ cls: "cammvas-pdf-export-actions" });
		actions.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
		actions.createEl("button", { text: "Export PDF", cls: "mod-cta" }).addEventListener("click", () => {
			const fileName = this.fileName.trim();
			if (!fileName) {
				new Notice("Enter a file name before exporting.");
				return;
			}
			this.close();
			this.onExport(fileName, this.newFolder.trim() || this.folder);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
