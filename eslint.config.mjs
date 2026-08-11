import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{ ignores: ["main.js", "node_modules/**"] },
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
		},
	},
	{
		files: ["tests/**/*.ts"],
		rules: { "@typescript-eslint/unbound-method": "off" },
	},
	{
		files: ["esbuild.config.mjs"],
		languageOptions: { globals: { process: "readonly" } },
	},
]);
