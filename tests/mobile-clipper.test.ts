import { beforeEach, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { DOMParser, parseHTML } from 'linkedom';
import { Platform, requestUrl } from 'obsidian';
import type { Vault } from 'obsidian';
import { Downloader } from '../src/downloader';
import { MobileClipper } from '../src/mobile-clipper';
import type { ShareToSaveSettings } from '../src/types';
import type { Translator } from '../src/i18n';
vi.mock('obsidian', async importOriginal => ({ ...await importOriginal<object>(), requestUrl: vi.fn() }));
const network = requestUrl as unknown as Mock<(options: {url: string}) => Promise<unknown>>;

beforeEach(() => {
	vi.stubGlobal('DOMParser', DOMParser);
	const { window } = parseHTML('<html><head></head><body></body></html>');
	vi.stubGlobal('window', window);
	vi.stubGlobal('document', window.document);
	Platform.isMobile = true;
	network.mockReset();
});

function setup() {
	const files = new Map<string, string | ArrayBuffer>();
	const dirs = new Set<string>();
	const vault = {
		adapter: { exists: async (p: string) => files.has(p) || dirs.has(p), read: async (p: string) => files.get(p), readBinary: async (p: string) => files.get(p) },
		createFolder: async (p: string) => { dirs.add(p); },
		create: vi.fn(async (p: string, content: string) => { if (files.has(p)) throw Error('exists'); files.set(p, content); }),
		createBinary: async (p: string, content: ArrayBuffer) => { files.set(p, content); },
	} as unknown as Vault;
	const settings = { outputFolder: 'clips' } as ShareToSaveSettings;
	const pipeline = new Downloader(vault, settings, ((key: string) => key) as Translator, async filename => `media/${filename}`);
	vi.spyOn(pipeline, 'processUrl').mockImplementation(async () => { throw Error('Desktop path must never run'); });
	return { files, vault, pipeline, clipper: new MobileClipper(pipeline) };
}

it.each([
	['wechat', 'https://mp.weixin.qq.com/s?id=123', '<div id="js_content"><p>' + 'An informative public article with a readable body. '.repeat(5) + '</p></div>'],
	['xhs', 'https://www.xiaohongshu.com/explore/123?xsec_token=keep', '<script>window.__INITIAL_STATE__=' + JSON.stringify({ note: { noteDetailMap: { '123': { note: { type: 'normal', title: 'XHS title', desc: 'Do not replace undefined or NaN in article text. '.repeat(3), imageList: [], user: { nickname: 'Author' } } } } } }) + '</script>'],
	['zhihu', 'https://zhuanlan.zhihu.com/p/123', '<article class="Post-Main"><div class="RichText"><p>' + 'A detailed public Zhihu article with useful examples. '.repeat(5) + '</p></div></article>'],
	['generic', 'https://example.com/article', '<article><h1>Article</h1><p>' + 'A detailed public web article with useful examples. '.repeat(5) + '</p></article>'],
])('saves a complete %s fixture on mobile without the desktop processor', async (id, url, body) => {
	const { clipper, files } = setup();
	network.mockResolvedValue({ status: 200, text: `<html><head><title>Article</title></head><body>${body}</body></html>`, headers: { 'content-type': 'text/html' } });
	const result = await clipper.processUrl(url, id);
	expect(result.success).toBe(true);
	expect(files.has(`clips/Clip-${id}.md`)).toBe(true);
	if (id === 'xhs') {
		expect(files.get(`clips/Clip-${id}.md`)).toContain('undefined or NaN');
		expect(files.get(`clips/Clip-${id}.md`)).toContain('xsec_token=keep');
	}
	expect(network).toHaveBeenCalledOnce();
});

it('does not save a late HTTP response after mobile cancellation', async () => {
	const { clipper, files } = setup();
	let resolve!: (value: unknown) => void;
	network.mockImplementation(() => new Promise(done => { resolve = done; }));
	const controller = new AbortController();
	const pending = clipper.processUrl('https://example.com', 'cancelled', 'clips', controller.signal);
	await vi.waitFor(() => expect(network).toHaveBeenCalledOnce());
	controller.abort();
	expect((await pending).success).toBe(false);
	resolve({ status: 200, text: '<html><body><article>' + 'Complete body. '.repeat(50) + '</article></body></html>', headers: {} });
	await new Promise(done => setTimeout(done, 0));
	expect(files.size).toBe(0);
});

it('shares one HTTP response between a failed site converter and generic fallback', async () => {
	const { pipeline, clipper } = setup();
	vi.spyOn(pipeline, 'processDocToParsed').mockReturnValueOnce({ title: 'Article', author: '', published: '', content: '', imageUrls: [] })
		.mockReturnValueOnce({ title: 'Article', author: '', published: '', content: 'A useful complete public article with enough text to save safely.', imageUrls: [] });
	network.mockResolvedValue({ status: 200, text: '<html><body>body</body></html>', headers: {} });
	expect((await clipper.processUrl('https://mp.weixin.qq.com/s', 'fallback')).success).toBe(true);
	expect(network).toHaveBeenCalledOnce();
});

const body = 'This is a public article with a complete body that can be read offline without a login. It contains useful information and enough text to demonstrate reliable conversion.';

it('clips HTML and attachments on mobile using the shared saver without desktop processing', async () => {
	const { clipper, files, vault } = setup();
	network.mockImplementation(async (options: { url: string }) => {
		const url = (options as {url: string}).url;
		return url.includes('image.png')
			? { status: 200, text: '', arrayBuffer: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-type': 'image/png' } }
			: { status: 200, text: `<html><head><title>Mobile article</title></head><body><div id="js_content"><p>${body}</p><img src="https://example.com/image.png"></div></body></html>`, arrayBuffer: new ArrayBuffer(0), headers: {} };
	});
	const result = await clipper.processUrl('https://mp.weixin.qq.com/s?id=123', 'mobile-task');
	expect(result.success).toBe(true);
	expect(files.get('clips/Clip-mobile-task.md')).toContain('![[media/sts-');
	expect([...files.keys()].some(p => p.startsWith('media/'))).toBe(true);
	await clipper.processUrl('https://mp.weixin.qq.com/s?id=123', 'mobile-task');
	expect(network).toHaveBeenCalledTimes(2);
	// eslint-disable-next-line @typescript-eslint/unbound-method -- This method is a mock without a receiver.
	expect(vault.create).toHaveBeenCalledOnce();
});

it('does not save HTTP-200 login walls', async () => {
	const { clipper, files } = setup();
	network.mockResolvedValue({ status: 200, text: '<html><head><title>Sign in</title></head><body>Sign in to view this post</body></html>', arrayBuffer: new ArrayBuffer(0), headers: {} });
	expect((await clipper.processUrl('https://example.com', 'failed-task')).success).toBe(false);
	expect(files.size).toBe(0);
});

it('honors the task folder snapshot and never overwrites an unrelated note at its path', async () => {
	const { pipeline, files } = setup();
	const parsed = { title: 'Article', author: '', published: '', content: body, imageUrls: [] };
	await pipeline.saveNote(parsed, 'https://example.com', 'snapshot-task', 'https://example.com', 'original-clips');
	expect(files.has('original-clips/Clip-snapshot-task.md')).toBe(true);
	files.set('clips/Clip-conflict-task.md', 'Existing Web Clipper note');
	await expect(pipeline.saveNote(parsed, 'https://example.com', 'conflict-task', 'https://example.com')).rejects.toThrow('another note');
	expect(files.get('clips/Clip-conflict-task.md')).toBe('Existing Web Clipper note');
});

it('records missing attachments while retaining readable text and original media URLs', async () => {
	const { pipeline, files } = setup();
	network.mockResolvedValue({ status: 404, headers: {} });
	const result = await pipeline.saveNote({ title: 'Article', author: '', published: '', content: body + '\n![](https://example.com/missing.png)', imageUrls: ['https://example.com/missing.png'] }, 'https://example.com', 'partial-task', 'https://example.com');
	expect(result.success).toBe(true);
	expect(result.warnings).toHaveLength(1);
	expect(files.get('clips/Clip-partial-task.md')).toContain('https://example.com/missing.png');
});

it('tries candidate video URLs and shares the attachment strategy with images', async () => {
	const { pipeline, files } = setup();
	network.mockImplementation(async ({ url }) => url.includes('bad')
		? { status: 404, headers: {} }
		: { status: 200, arrayBuffer: new Uint8Array([4, 5, 6]).buffer, headers: { 'content-type': 'video/mp4' } });
	const result = await pipeline.saveNote({ title: 'Video', author: '', published: '', content: body, imageUrls: [], media: [{ kind: 'video', candidates: ['https://example.com/bad.mp4', 'https://example.com/good.mp4'], referer: 'https://example.com/post/123' }] }, 'https://example.com', 'video-task', 'https://example.com');
	expect(result.success).toBe(true);
	expect(result.warnings).toEqual([]);
	expect([...files.keys()].some(path => path.startsWith('media/') && path.endsWith('.mp4'))).toBe(true);
	const lastRequest: unknown = network.mock.calls[network.mock.calls.length - 1]?.[0];
	expect((lastRequest as { headers: Record<string, string> }).headers.Referer).toBe('https://example.com/post/123');
});

it.each([
	['WeChat', 'https://mp.weixin.qq.com/s', `<div id="js_content"><p>${body}</p></div>`],
	['Xiaohongshu', 'https://www.xiaohongshu.com/explore/1', `<div id="detail-desc">${body}</div>`],
	['Zhihu', 'https://zhuanlan.zhihu.com/p/1', `<article class="Post-Main"><div class="RichText"><p>${body}</p></div></article>`],
	// eslint-disable-next-line obsidianmd/hardcoded-config-path -- This is a public website URL.
	['Obsidian Publish', 'https://publish.obsidian.md/site/page', `<script id="publish-markdown" type="text/plain">${body}</script>`],
	['Generic', 'https://example.com/article', `<article><h1>Sample</h1><p>${body}</p><p>${body}</p></article>`],
])('retains %s conversion for static fixtures', (_platform, url, html) => {
	const { pipeline } = setup();
	const parsed = pipeline.processDocToParsed(`<html><head><title>Sample</title></head><body>${html}</body></html>`, url);
	expect(parsed?.content).toContain('public article');
});
