import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { App } from 'obsidian';
import { Platform } from 'obsidian';
const lazy = vi.hoisted(() => ({ loads: 0 }));
vi.mock('../src/downloader', () => { lazy.loads++; return { Downloader: class {} }; });
vi.mock('../src/share-menu-injector', () => ({ ShareMenuInjector: class { start(): void {} stop(): void {} } }));
vi.mock('../src/image-share-injector', () => ({ ImageShareMenuInjector: class { start(): void {} stop(): void {} } }));
vi.mock('../src/notice-utils', () => ({ showNotice: vi.fn(), clearMobileNotice: vi.fn() }));
import ShareToSavePlugin from '../src/main';

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('window', globalThis);
	vi.stubGlobal('activeDocument', { querySelector: () => null });
	Platform.isMobile = true; Platform.isDesktop = false;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup() {
	const adapter = { exists: vi.fn().mockResolvedValue(false), list: vi.fn().mockResolvedValue({ files: [], folders: [] }), read: vi.fn(), write: vi.fn(), remove: vi.fn() };
	const plugin = new ShareToSavePlugin({} as App, {} as never);
	plugin.app = { vault: { adapter, getFiles: vi.fn(), getMarkdownFiles: vi.fn() }, loadLocalStorage: () => 'phone-id', saveLocalStorage: vi.fn() } as unknown as App;
	return { plugin, adapter };
}

it('mobile load and idle time do not load converters, scan the Vault or process tasks', async () => {
	const { plugin, adapter } = setup();
	await plugin.onload();
	await vi.advanceTimersByTimeAsync(600000);
	expect(lazy.loads).toBe(0);
	expect(adapter.exists).not.toHaveBeenCalled();
	expect(adapter.list).not.toHaveBeenCalled();
	expect(adapter.read).not.toHaveBeenCalled();
	expect(adapter.write).not.toHaveBeenCalled();
	expect(vi.getTimerCount()).toBe(0);
	plugin.onunload();
});

it('repairs malformed settings without scanning files and keeps the queue outside notes', async () => {
	const { plugin, adapter } = setup();
	vi.spyOn(plugin, 'loadData').mockResolvedValue({ outputFolder: '_ShareToSave', queueFolder: '_ShareToSave/queue', attachmentFolder: 42, mobileFirst: 'false' });
	await plugin.onload();
	expect(plugin.settings.queueFolder.startsWith(plugin.settings.outputFolder + '/')).toBe(false);
	expect(plugin.settings.mobileFirst).toBe(true);
	expect(typeof plugin.settings.attachmentFolder).toBe('string');
	expect(adapter.list).not.toHaveBeenCalled();
	plugin.onunload();
});

it('rejects queue-directory changes that would hide existing tasks', async () => {
	const { plugin, adapter } = setup();
	await plugin.onload();
	adapter.exists.mockResolvedValue(true);
	adapter.list.mockResolvedValue({ files: ['_ShareToSave/queue/task.json'], folders: [] });
	expect(await plugin.changeQueueFolder('new-queue')).toBe(false);
	expect(plugin.settings.queueFolder).toBe('_ShareToSave/queue');
	plugin.onunload();
});

it('does not register services if the plugin unloads during asynchronous settings load', async () => {
	const { plugin, adapter } = setup();
	let release!: (value: unknown) => void;
	vi.spyOn(plugin, 'loadData').mockImplementation(() => new Promise(resolve => { release = resolve; }));
	const register = vi.spyOn(plugin, 'addCommand');
	const loading = plugin.onload(); plugin.onunload(); release({}); await loading;
	expect(register).not.toHaveBeenCalled(); expect(adapter.list).not.toHaveBeenCalled();
});
