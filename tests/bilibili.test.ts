import { beforeEach, expect, it, vi } from 'vitest';
import { DOMParser } from 'linkedom';
import { BilibiliResolver } from '../src/platforms/bilibili';
import type { FetchPage } from '../src/platforms/shared';
beforeEach(() => vi.stubGlobal('DOMParser', DOMParser));
// Reduced actual anonymous view response inspected on 2026-10-08; unrelated fields omitted.
const view = { code: 0, data: { bvid: 'BV1xx411c7mD', aid: 2, title: '字幕君交流场所', desc: 'www', pubdate: 1252458549,
	owner: { name: '碧诗', mid: 2 }, pic: 'https://i0.hdslb.com/bfs/archive/transparent.png' } };
const page = (value: unknown, url = 'https://www.bilibili.com/video/BV1xx411c7mD/') => ({ text: JSON.stringify(value), url, headers: {} });

it.each(['https://www.bilibili.com/video/BV1xx411c7mD/?p=2', 'https://m.bilibili.com/video/av2'])('clips public video metadata without fetching a video stream (%s)', async url => {
	const fetch = vi.fn<FetchPage>().mockResolvedValue(page(view));
	const parsed = await new BilibiliResolver(fetch).resolve(url);
	expect(parsed.title).toBe(view.data.title); expect(parsed.author).toBe('碧诗');
	expect(parsed.published).toBe('2009-09-09T01:09:09.000Z');
	expect(parsed.media).toHaveLength(1); expect(parsed.contentKind).toBe('video');
	expect(fetch).toHaveBeenCalledOnce();
});
it('expands a short share using public canonical metadata when final URL is hidden', async () => {
	const fetch = vi.fn<FetchPage>().mockResolvedValueOnce({ text: '<link rel="canonical" href="https://www.bilibili.com/video/BV1xx411c7mD/">', url: 'https://b23.tv/sample', headers: {} }).mockResolvedValueOnce(page(view));
	expect((await new BilibiliResolver(fetch).resolve('https://b23.tv/sample')).title).toBe(view.data.title);
});
it('extracts an opus dynamic with multiple pictures', async () => {
	const value = { code: 0, data: { item: { id_str: '123', modules: { module_author: { name: 'UP', mid: 2, pub_ts: 1700000000 }, module_dynamic: {
		major: { opus: { title: 'Dynamic title', summary: { text: 'Short actual post' }, pics: [{ url: 'https://example.com/1.jpg' }, { url: 'https://example.com/2.jpg' }] } },
	} } } } };
	const parsed = await new BilibiliResolver(vi.fn<FetchPage>().mockResolvedValue(page(value))).resolve('https://t.bilibili.com/123');
	expect(parsed.content).toBe('Short actual post'); expect(parsed.media).toHaveLength(2); expect(parsed.canonicalUrl).toBe('https://www.bilibili.com/opus/123');
});
it('uses matching HTML SSR after a public API failure', async () => {
	const fetch = vi.fn<FetchPage>().mockResolvedValueOnce(page({ code: -352 })).mockResolvedValueOnce({ text: '<html><head></head><body><script>window.__INITIAL_STATE__=' + JSON.stringify({ videoData: view.data }) + ';</script></body></html>', url: 'https://www.bilibili.com/video/BV1xx411c7mD/', headers: {} });
	expect((await new BilibiliResolver(fetch).resolve('https://www.bilibili.com/video/BV1xx411c7mD/')).title).toBe(view.data.title);
});

it('parses the actual opus module-array layout after the dynamic API is restricted', async () => {
	// Reduced layout observed in anonymous opus/1211500325209374726 on 2026-10-08.
	const detail = { id_str: '123', modules: [
		{ module_type: 'MODULE_TYPE_TITLE', module_title: { text: 'Public opus' } },
		{ module_type: 'MODULE_TYPE_AUTHOR', module_author: { author: { name: 'Author' }, pub_ts: 1700000000 } },
		{ module_type: 'MODULE_TYPE_CONTENT', module_content: { paragraphs: [
			{ para_type: 1, text: { nodes: [{ type: 'TEXT_NODE_TYPE_WORD', word: { words: 'Actual public paragraph content.' } }] } },
			{ para_type: 2, pic: { pics: [{ url: 'https://example.com/opus.jpg' }] } },
		] } },
	] };
	const fetch = vi.fn<FetchPage>().mockResolvedValueOnce(page({ code: -352 })).mockResolvedValueOnce({ text: '<html><head></head><body><script>window.__INITIAL_STATE__=' + JSON.stringify({ id: '123', detail }) + ';</script></body></html>', url: 'https://www.bilibili.com/opus/123', headers: {} });
	const parsed = await new BilibiliResolver(fetch).resolve('https://www.bilibili.com/opus/123');
	expect(parsed.content).toContain('Actual public paragraph'); expect(parsed.media).toHaveLength(1);
});
it.each([-352, -404])('rejects unavailable content without manufacturing a description (%s)', async code => {
	const fetch = vi.fn<FetchPage>().mockResolvedValue(page({ code }));
	await expect(new BilibiliResolver(fetch).resolve('https://www.bilibili.com/video/BV1xx411c7mD/')).rejects.toThrow('rejected');
});
