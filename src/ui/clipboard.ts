import { Notice } from "obsidian";

export async function copyText(win: Window, text: string, successMessage: string): Promise<void> {
	try {
		await win.navigator.clipboard.writeText(text);
		new Notice(successMessage);
	} catch {
		new Notice("Unable to copy to the clipboard");
	}
}
