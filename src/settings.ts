import { App, Platform, PluginSettingTab } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import type CanvasMindMapPlugin from "./main";
import { DEFAULT_BRANCH_PALETTE, parsePalette } from "./mindmap/color-palette";

export interface MindMapSettings {
	autoLayout: boolean;
	autoColor: boolean;
	branchPalette: string[];
	colorLeafNodes: boolean;
	arrowKeyNavigation: boolean;
	dragToReparent: boolean;
	enterCreatesSibling: boolean;
	horizontalGap: number;
	verticalGap: number;
	defaultNodeWidth: number;
	defaultNodeHeight: number;
	maxNodeHeight: number;
	defaultMindmapMode: boolean;
	navigationZoomPadding: number;
	mouseNavigation: boolean;
}

export const DEFAULT_SETTINGS: MindMapSettings = {
	autoLayout: true,
	autoColor: true,
	branchPalette: [...DEFAULT_BRANCH_PALETTE],
	colorLeafNodes: true,
	arrowKeyNavigation: true,
	dragToReparent: false,
	enterCreatesSibling: false,
	horizontalGap: 80,
	verticalGap: 20,
	defaultNodeWidth: 300,
	defaultNodeHeight: 60,
	maxNodeHeight: 300,
	defaultMindmapMode: true,
	navigationZoomPadding: 200,
	mouseNavigation: false,
};

const BOOLEAN_SETTING_KEYS = [
	"autoLayout",
	"autoColor",
	"colorLeafNodes",
	"arrowKeyNavigation",
	"dragToReparent",
	"enterCreatesSibling",
	"defaultMindmapMode",
	"mouseNavigation",
] as const;

const POSITIVE_NUMBER_SETTING_KEYS = [
	"horizontalGap",
	"verticalGap",
	"defaultNodeWidth",
	"defaultNodeHeight",
	"maxNodeHeight",
] as const;

function isSettingsData(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isSettingKey(key: string): key is keyof MindMapSettings {
	return key in DEFAULT_SETTINGS;
}

export function normalizeSettings(data: unknown): MindMapSettings {
	const settings: MindMapSettings = {
		...DEFAULT_SETTINGS,
		branchPalette: [...DEFAULT_SETTINGS.branchPalette],
	};
	if (!isSettingsData(data)) return settings;

	for (const key of BOOLEAN_SETTING_KEYS) {
		const value = data[key];
		if (typeof value === "boolean") settings[key] = value;
	}
	for (const key of POSITIVE_NUMBER_SETTING_KEYS) {
		const value = data[key];
		if (typeof value === "number" && Number.isFinite(value) && value > 0) {
			settings[key] = value;
		}
	}
	const zoomPadding = data.navigationZoomPadding;
	if (typeof zoomPadding === "number" && Number.isFinite(zoomPadding) && zoomPadding >= 0) {
		settings.navigationZoomPadding = zoomPadding;
	}
	const palette: unknown = data.branchPalette;
	if (Array.isArray(palette) && palette.every((color: unknown) => typeof color === "string")) {
		settings.branchPalette = parsePalette(palette.join(","));
	}
	return settings;
}

export class MindMapSettingTab extends PluginSettingTab {
	plugin: CanvasMindMapPlugin;

	constructor(app: App, plugin: CanvasMindMapPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const positiveNumber = (key: string) => ({
			type: "number" as const,
			key,
			min: 1,
			step: 1,
			validate: (value: number) => value > 0 ? undefined : "Enter a positive number.",
		});

		return [
			{ name: "Default mindmap mode", desc: "Whether canvases default to mindmap mode (can be toggled per canvas)", control: { type: "toggle", key: "defaultMindmapMode" } },
			{ name: "Auto-layout", desc: "Automatically arrange nodes after adding/deleting", control: { type: "toggle", key: "autoLayout" } },
			{ name: "Auto-color branches", desc: "Assign distinct colors to top-level branches", control: { type: "toggle", key: "autoColor" } },
			{ name: "Branch color palette", desc: "Comma-separated Canvas colors (1-6) or hex colors, assigned to top-level branches", control: { type: "text", key: "branchPalette", placeholder: "1, 2, 3, 4, 5, 6" } },
			{ name: "Color leaf nodes", desc: "Turn off to leave terminal nodes neutral while keeping their incoming edge colored", control: { type: "toggle", key: "colorLeafNodes" } },
			{ name: "Arrow key navigation", desc: "Navigate between selected mind map nodes with the arrow keys; disable to move Canvas cards natively", control: { type: "toggle", key: "arrowKeyNavigation" } },
			{ name: "Drag to reparent", desc: Platform.isMobile ? "Long-press and drag a node onto another node to make it a child while preserving its branch" : "Drop a node onto another node to make it a child while preserving its branch", control: { type: "toggle", key: "dragToReparent" } },
			{ name: "Mind mapping Enter and Tab", desc: Platform.isMobile ? "Use Enter and Tab from a hardware keyboard to create sibling and child nodes" : "Enter creates a sibling while editing, Tab creates a child, and Shift+Enter inserts a new line", control: { type: "toggle", key: "enterCreatesSibling" } },
			{ name: "Horizontal gap", desc: "Space between parent and child nodes (px)", control: positiveNumber("horizontalGap") },
			{ name: "Vertical gap", desc: "Space between sibling nodes (px)", control: positiveNumber("verticalGap") },
			{ name: "Default node width", desc: "Width of newly created nodes (px)", control: positiveNumber("defaultNodeWidth") },
			{ name: "Default node height", desc: "Height of newly created nodes (px)", control: positiveNumber("defaultNodeHeight") },
			{ name: "Max node height", desc: "Maximum height a node can grow to before scrolling (px)", control: positiveNumber("maxNodeHeight") },
			{ name: "Mouse back/forward navigation", desc: "Use mouse back/forward buttons for in-canvas navigation instead of Obsidian's default note navigation", visible: () => !Platform.isMobile, control: { type: "toggle", key: "mouseNavigation" } },
			{ name: "Navigation zoom padding", desc: "Extra space around the target node when zooming after navigation (px). 0 = tight zoom.", control: { type: "number", key: "navigationZoomPadding", min: 0, step: 1, validate: (value) => value >= 0 ? undefined : "Enter zero or a positive number." } },
		];
	}

	getControlValue(key: string): unknown {
		if (key === "branchPalette") return this.plugin.settings.branchPalette.join(", ");
		return isSettingKey(key) ? this.plugin.settings[key] : undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === "branchPalette" && typeof value === "string") {
			this.plugin.settings.branchPalette = parsePalette(value);
		} else if (BOOLEAN_SETTING_KEYS.some((settingKey) => settingKey === key)) {
			if (typeof value !== "boolean") return;
			Object.assign(this.plugin.settings, { [key]: value });
		} else if (POSITIVE_NUMBER_SETTING_KEYS.some((settingKey) => settingKey === key)) {
			if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;
			Object.assign(this.plugin.settings, { [key]: value });
		} else if (key === "navigationZoomPadding") {
			if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return;
			this.plugin.settings.navigationZoomPadding = value;
		} else {
			return;
		}
		await this.plugin.saveSettings();
	}
}
