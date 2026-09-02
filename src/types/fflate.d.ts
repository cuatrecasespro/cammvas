declare module "fflate" {
	export function strToU8(value: string): Uint8Array;
	export function strFromU8(value: Uint8Array): string;
	export function zipSync(files: Record<string, Uint8Array>, options?: { level?: number }): Uint8Array;
	export function unzipSync(data: Uint8Array): Record<string, Uint8Array>;
}
