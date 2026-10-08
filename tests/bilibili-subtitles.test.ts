import { beforeEach, expect, it, vi } from 'vitest';
import { DOMParser } from 'linkedom';
import { subtitleMarkdown, videoSubtitles } from '../src/platforms/bilibili-subtitles';
import { BilibiliResolver } from '../src/platforms/bilibili';
import type { FetchPage } from '../src/platforms/shared';
beforeEach(() => vi.stubGlobal('DOMParser', DOMParser));
const url = 'https://www.bilibili.com/video/BV123/';
const data = { bvid: 'BV123', cid: 10, title: 'Video', owner: { name: 'UP', mid: 1 }, desc: 'Description', pic: 'https://i0.hdslb.com/cover.jpg' };
const response = (value: unknown) => ({ text: JSON.stringify(value), url, headers: {} });
const body = { body: [{ from: 0, to: 1, content: '你好，' }, { from: 1, to: 2, content: '你好，' }, { from: 2, to: 3, content: '世界。' }, { from: 6, to: 7, content: '下一段。' }] };
const track = (lan: string, name: string) => ({ lan, subtitle_url: `//i0.hdslb.com/${name}.json` });

it('formats Bilibili JSON without times, preserves text and removes adjacent duplicates only', () => {
	expect(subtitleMarkdown(JSON.stringify(body))).toBe('你好，世界。\n\n下一段。');
	expect(subtitleMarkdown(JSON.stringify({ body: [{ content: '123' }, { content: 'Other' }, { content: '123' }] }))).toBe('123 Other 123');
});
it.each(['1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:02,000 --> 00:00:03,000\nworld.',
	'WEBVTT\n\nNOTE metadata\nignored\n\ncue-id\n00:01.000 --> 00:02.000 align:start\n<v Speaker><b>Hello</b>\n\n00:02.000 --> 00:03.000\n<00:02.500>world.'])('removes SRT/VTT wrappers without removing spoken words', text => {
	expect(subtitleMarkdown(text)).toBe('Hello world.');
});
it('prefers Chinese official, then Chinese AI, before other languages', async () => {
	const fetch = vi.fn<FetchPage>().mockResolvedValueOnce(response({ code: 0, data: { subtitle: { subtitles: [track('en', 'english'), track('ai-zh', 'ai'), track('zh-CN', 'official')] } } }))
		.mockResolvedValueOnce(response(body));
	expect(await videoSubtitles(fetch, data, url)).toContain('你好');
	expect(fetch.mock.calls[1]![0]).toContain('/official.json');
});
it('falls back to accessible non-Chinese captions without translation', async () => {
	const fetch = vi.fn<FetchPage>().mockResolvedValueOnce(response({ code: 0, data: { subtitle: { subtitles: [track('ai-zh', 'ai'), track('en', 'english')] } } }))
		.mockRejectedValueOnce(Error('Forbidden')).mockResolvedValueOnce(response({ body: [{ content: 'Original English.' }] }));
	expect(await videoSubtitles(fetch, data, url)).toBe('Original English.');
});
it('selects the shared part CID rather than silently using the first part', async () => {
	const fetch = vi.fn<FetchPage>().mockResolvedValue(response({ code: 0 }));
	await videoSubtitles(fetch, { ...data, pages: [{ cid: 10 }, { cid: 20 }] }, url + '?p=2');
	expect(fetch.mock.calls[0]![0]).toContain('cid=20');
	fetch.mockClear(); await videoSubtitles(fetch, data, url + '?p=2'); expect(fetch).not.toHaveBeenCalled();
});
it.each([{ code: 0, data: { subtitle: { subtitles: [] } } }, { code: -101 }, { code: -352 }])('keeps video content when subtitles are absent or restricted (%j)', async player => {
	const fetch = vi.fn<FetchPage>().mockResolvedValueOnce(response({ code: 0, data })).mockResolvedValueOnce(response(player));
	const parsed = await new BilibiliResolver(fetch).resolve(url);
	expect(parsed.content).toBe('Description'); expect(parsed.title).toBe('Video'); expect(parsed.media).toHaveLength(1);
});
it('keeps the video on subtitle network failure and appends successful subtitles after its description', async () => {
	const failed = vi.fn<FetchPage>().mockResolvedValueOnce(response({ code: 0, data })).mockRejectedValueOnce(Error('Network'));
	expect((await new BilibiliResolver(failed).resolve(url)).content).toBe('Description');
	const fetch = vi.fn<FetchPage>().mockResolvedValueOnce(response({ code: 0, data })).mockResolvedValueOnce(response({ code: 0, data: { subtitle: { subtitles: [track('ai-zh', 'ai')] } } })).mockResolvedValueOnce(response(body));
	expect((await new BilibiliResolver(fetch).resolve(url)).content).toBe('Description\n\n## 视频字幕\n\n你好，世界。\n\n下一段。');
});
it('bounds optional waiting and does not launch late subtitle downloads', async () => {
	vi.useFakeTimers();
	try {
		let release!: (value: Awaited<ReturnType<FetchPage>>) => void;
		const fetch = vi.fn<FetchPage>().mockImplementation(() => new Promise(resolve => { release = resolve; }));
		const pending = videoSubtitles(fetch, data, url);
		await vi.advanceTimersByTimeAsync(4000); expect(await pending).toBe('');
		release(response({ code: 0, data: { subtitle: { subtitles: [track('zh', 'late')] } } }));
		await Promise.resolve(); expect(fetch).toHaveBeenCalledOnce();
	} finally { vi.useRealTimers(); }
});
