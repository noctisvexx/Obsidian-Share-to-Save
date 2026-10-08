import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Platform, requestUrl } from 'obsidian';
import type { ShareToSaveSettings } from '../src/types';
import type { Translator } from '../src/i18n';
import { QueueManager } from '../src/queue-manager';
import { Downloader } from '../src/downloader';
import { MobileClipper } from '../src/mobile-clipper';
import { FileWatcher } from '../src/file-watcher';
import { testVault } from './helpers/vault';
vi.mock('obsidian', async importOriginal => ({ ...await importOriginal<object>(), requestUrl: vi.fn() }));
vi.mock('../src/notice-utils', () => ({ showNotice: vi.fn() }));
const network = requestUrl as unknown as Mock<(options: {url: string}) => Promise<unknown>>;
beforeEach(() => { Platform.isMobile = true; vi.stubGlobal('window', globalThis); network.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
const t = ((key: string) => key) as Translator;

function setup() {
	const storage = testVault();
	const queue = new QueueManager(storage.vault, () => '_ShareToSave/queue', () => 'clips', 'phone');
	const pipeline = new Downloader(storage.vault, { outputFolder: 'clips' } as ShareToSaveSettings, t, async name => `media/${name}`);
	const clipper = new MobileClipper(pipeline);
	return { ...storage, queue, pipeline, clipper };
}

it('retains a mobile HTTP failure, retries it by hand and confirms only one note', async () => {
	const { queue, clipper, files } = setup();
	network.mockResolvedValue({ status: 503, headers: {} });
	await queue.enqueue({ ...QueueManager.buildEntry('https://example.com', 'mobile'), target: 'mobile', originDevice: 'phone', allowDesktopFallback: true, noteFolder: 'clips' });
	const watcher = new FileWatcher(queue, clipper, vi.fn(), () => 1000, t, 'mobile');
	await watcher.processNow();
	const task = (await queue.getEntries())[0]!;
	expect(task.status).toBe('failed'); expect(task.error).toContain('503');
	expect([...files.keys()].filter(path => path.endsWith('.md'))).toHaveLength(0);
	vi.spyOn(clipper, 'processUrl').mockImplementation(async (_url, id) => {
		const path = `clips/Clip-${id}.md`;
		if (!files.has(path)) files.set(path, `---\nsts_id: ${id}\n---\nSaved article`);
		return { success: true };
	});
	await queue.retry(task, 'mobile'); await watcher.processNow(); await watcher.processNow();
	expect((await queue.getEntries())[0]?.status).toBe('completed');
	expect([...files.keys()].filter(path => path.endsWith('.md'))).toHaveLength(1);
});

it('desktop fallback consumes a mobile failure only when allowed and uses the same saver', async () => {
	const { queue, clipper, pipeline, files, adapter } = setup();
	const oldMarkdown = '---\nsource: https://example.com/old\n---\nExisting Web Clipper article';
	const oldBinary = new Uint8Array([9, 8, 7]).buffer;
	files.set('clips/web-clipper.md', oldMarkdown); files.set('clips/plain.md', '[URL](https://example.com)'); files.set('media/old.png', oldBinary);
	network.mockResolvedValue({ status: 403, headers: {} });
	await queue.enqueue({ ...QueueManager.buildEntry('https://example.com', 'mobile'), target: 'mobile', originDevice: 'phone', allowDesktopFallback: true, noteFolder: 'original' });
	await new FileWatcher(queue, clipper, vi.fn(), () => 1000, t, 'mobile').processNow();
	const desktopProcess = vi.spyOn(pipeline, 'processUrl').mockImplementation((url, id, folder) => pipeline.saveNote({ title: 'Recovered', author: '', published: '', content: 'A complete recovered article saved by the shared Markdown pipeline.', imageUrls: [] }, url, id, url, folder));
	let enabled = false;
	const desktop = new FileWatcher(queue, pipeline, vi.fn(), () => 1000, t, 'desktop', () => enabled);
	await desktop.processNow(); expect(desktopProcess).not.toHaveBeenCalled();
	enabled = true; await desktop.processNow(); await desktop.processNow();
	expect(desktopProcess).toHaveBeenCalledOnce(); expect((await queue.getEntries())[0]?.status).toBe('completed');
	expect([...files.keys()].some(path => path.startsWith('original/Clip-'))).toBe(true);
	expect(files.get('clips/web-clipper.md')).toBe(oldMarkdown); expect(files.get('media/old.png')).toBe(oldBinary);
	expect(files.get('clips/plain.md')).toBe('[URL](https://example.com)');
	expect(adapter.remove.mock.calls.every(([path]) => path.endsWith('.claim'))).toBe(true);
});
