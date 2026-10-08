import { beforeEach, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { DOMParser, parseHTML } from 'linkedom';
import { Platform, requestUrl } from 'obsidian';
import { MobileClipper } from '../src/mobile-clipper';
import { Downloader } from '../src/downloader';
import { QueueManager } from '../src/queue-manager';
import { FileWatcher } from '../src/file-watcher';
import { testVault } from './helpers/vault';
import type { ShareToSaveSettings } from '../src/types';
import type { Translator } from '../src/i18n';
vi.mock('obsidian', async importOriginal => ({ ...await importOriginal<object>(), requestUrl: vi.fn() }));
vi.mock('../src/notice-utils', () => ({ showNotice: vi.fn() }));
const network = requestUrl as unknown as Mock<(options: { url: string }) => Promise<unknown>>;
beforeEach(() => {
	const { window } = parseHTML('<html><head></head><body></body></html>');
	vi.stubGlobal('DOMParser', DOMParser); vi.stubGlobal('window', window); vi.stubGlobal('document', window.document);
	Platform.isMobile = true; network.mockReset();
});
const t = ((key: string) => key) as Translator;
const html = (data: unknown) => '<html><head></head><body><script type="application/json">' + JSON.stringify(data) + '</script></body></html>';
const cases = [
	{ platform: 'Bilibili', url: 'https://www.bilibili.com/video/BV123/', title: 'Video title', data: { code: 0, data: { bvid: 'BV123', title: 'Video title', desc: 'Video description', owner: { name: 'UP', mid: 1 }, pic: 'https://example.com/1.jpg' } }, json: true },
	{ platform: 'Douyin', url: 'https://www.douyin.com/video/123', title: 'Douyin caption', data: { aweme_detail: { aweme_id: '123', desc: 'Douyin caption', author: { nickname: 'Creator' }, video: { cover: { url_list: ['https://example.com/1.jpg'] } } } } },
	{ platform: 'X', url: 'https://x.com/user/status/123', title: 'Tweet caption', data: { rest_id: '123', details: { full_text: 'Tweet caption' }, author: { core: { name: 'User' } }, media_entities2: [{ media_url_https: 'https://example.com/1.jpg' }] } },
	{ platform: 'Instagram', url: 'https://www.instagram.com/p/ABC/', title: 'Instagram caption', data: { shortcode: 'ABC', owner: { username: 'Creator' }, edge_media_to_caption: { edges: [{ node: { text: 'Instagram caption' } }] }, edge_sidecar_to_children: { edges: [{ node: { display_url: 'https://example.com/1.jpg' } }, { node: { display_url: 'https://example.com/2.jpg' } }] } } },
];
it.each(cases)('dispatches $platform through the registered resolver, queue and shared saver', async sample => {
	const storage = testVault();
	storage.files.set('clips/Existing.md', 'Original user note');
	network.mockImplementation(async ({ url }) => url.endsWith('.jpg')
		? { status: 200, arrayBuffer: new Uint8Array(url.endsWith('2.jpg') ? [2] : [1]).buffer, headers: { 'content-type': 'image/jpeg' } }
		: { status: 200, text: sample.json ? JSON.stringify(sample.data) : html(sample.data), headers: {} });
	const settings = { outputFolder: 'clips' } as ShareToSaveSettings;
	const pipeline = new Downloader(storage.vault, settings, t, async name => `media/${name}`);
	const clipper = new MobileClipper(pipeline);
	const queue = new QueueManager(storage.vault, () => '_ShareToSave/queue', () => 'clips', 'phone');
	await queue.enqueue({ ...QueueManager.buildEntry(sample.url, 'mobile'), target: 'mobile', originDevice: 'phone', noteFolder: 'clips', allowDesktopFallback: true });
	const watcher = new FileWatcher(queue, clipper, vi.fn(), () => 1000, t, 'mobile');
	await watcher.processNow();
	expect(await queue.getEntries()).toEqual([]);
	expect(storage.files.get(`clips/${sample.title}.md`)).toContain('sts_id:');
	expect(storage.files.get(`clips/${sample.title}.md`)).toContain('![[media/sts-');
	expect(storage.files.get('clips/Existing.md')).toBe('Original user note');
	const count = network.mock.calls.length;
	expect(await queue.enqueue({ ...QueueManager.buildEntry(sample.url, 'mobile'), target: 'mobile', originDevice: 'phone', noteFolder: 'clips' })).toBe('queued');
	await watcher.processNow(); expect(network.mock.calls.length).toBeGreaterThan(count);
	expect([...storage.files.keys()].filter(path => path.endsWith('.md'))).toHaveLength(3);
	expect(await queue.getEntries()).toEqual([]);
});
it.each(cases)('retains an HTTP-200 login failure for $platform without writing a note', async sample => {
	const storage = testVault();
	network.mockResolvedValue({ status: 200, text: '<html><head><title>Log in</title></head><body>Sign in to view</body></html>', headers: {} });
	const pipeline = new Downloader(storage.vault, { outputFolder: 'clips' } as ShareToSaveSettings, t);
	const queue = new QueueManager(storage.vault, () => '_ShareToSave/queue', () => 'clips', 'phone');
	await queue.enqueue({ ...QueueManager.buildEntry(sample.url, 'mobile'), target: 'mobile', originDevice: 'phone', noteFolder: 'clips', allowDesktopFallback: true });
	await new FileWatcher(queue, new MobileClipper(pipeline), vi.fn(), () => 1000, t, 'mobile').processNow();
	expect((await queue.getEntries())[0]).toMatchObject({ status: 'failed', allowDesktopFallback: true });
	expect([...storage.files.keys()].filter(path => path.endsWith('.md'))).toHaveLength(0);
});
