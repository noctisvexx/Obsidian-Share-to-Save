export function normalizePath(path: string): string { return path.replace(/\\/g, '/').replace(/\/+/g, '/'); }
export class Notice {}
export const Platform = { isMobile: false, isDesktop: true };
export async function requestUrl(_options: unknown): Promise<{status: number; text: string; arrayBuffer: ArrayBuffer; headers: Record<string, string>}> { throw new Error('Network mock not configured'); }
// eslint-disable-next-line import/no-nodejs-modules -- Test-only YAML implementation.
import { createRequire } from 'node:module';
const yaml = createRequire(import.meta.url)('js-yaml') as { load(input: string): unknown };
export function parseYaml(input: string): unknown { return yaml.load(input); }
export class TFile { constructor(public path = '') {} }
export class App {}
export class Modal { constructor(..._args: unknown[]) {} }
export class PluginSettingTab { constructor(..._args: unknown[]) {} }
export class Setting {}
export class Plugin {
	app!: App;
	async loadData(): Promise<unknown> { return {}; }
	async saveData(_data: unknown): Promise<void> {}
	addRibbonIcon(..._args: unknown[]): HTMLElement { return { classList: { toggle: () => {} } } as unknown as HTMLElement; }
	addCommand(_command: unknown): void {}
	addSettingTab(_tab: unknown): void {}
	registerObsidianProtocolHandler(..._args: unknown[]): void {}
}
export function getLanguage(): string { return 'en'; }
export function setIcon(..._args: unknown[]): void {}
