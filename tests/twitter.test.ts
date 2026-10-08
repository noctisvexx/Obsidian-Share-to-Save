import { beforeEach, expect, it, vi } from 'vitest';
import { DOMParser } from 'linkedom';
import { TwitterResolver } from '../src/platforms/twitter';
import { scriptObjects } from '../src/platforms/static-script-data';
import type { FetchPage } from '../src/platforms/shared';
beforeEach(() => vi.stubGlobal('DOMParser', DOMParser));
const id = '2107449641403039962';
const url = 'https://x.com/Allen0125/status/' + id;
const item = { rest_id: id, details: { full_text: 'Actual short public caption', created_at_ms: 1791290123000 },
	author: { core: { name: 'Allen', screen_name: 'Allen0125' } }, media_entities2: [{ type: 'photo', media_url_https: 'https://example.com/photo.jpg' }] };
const page = (value: unknown) => ({ text: '<html><head></head><body><script type="application/json">' + JSON.stringify({ data: { tweet: value } }) + '</script></body></html>', url, headers: {} });

it.each([url, url.replace('x.com', 'twitter.com') + '/photo/1'])('reads the exact public post and images (%s)', async input => {
	const fetch = vi.fn<FetchPage>().mockResolvedValue(page(item));
	const parsed = await new TwitterResolver(fetch).resolve(input);
	expect(parsed.content).toBe(item.details.full_text); expect(parsed.media).toHaveLength(1); expect(parsed.author).toBe('Allen');
});
it('expands a t.co link through public canonical metadata', async () => {
	const response = page(item); response.text = response.text.replace('<head>', `<head><meta property="og:url" content="${url}">`);
	response.url = 'https://t.co/example';
	expect((await new TwitterResolver(vi.fn<FetchPage>().mockResolvedValue(response)).resolve(response.url)).author).toBe('Allen');
});
it('extracts serialized SSR graph literals without executing calls, functions or getters', () => {
	// Assignment/reference layout observed in the user's live X page, reduced.
	const html = `<html><body><script>window.bad=()=>{throw Error('must not execute')}; let $R=[]; $R[1]={rest_id:"${id}",author:$R[2]={core:{name:"Allen",screen_name:"Allen0125"}},details:$R[3]={full_text:"Public text",created_at_ms:1791290123000},media_entities2:[],get secret(){window.bad()}}; window.bad();</script></body></html>`;
	const result = scriptObjects(html, 'rest_id', id)[0];
	expect(result?.details).toEqual({ full_text: 'Public text', created_at_ms: 1791290123000 });
	expect(result?.secret).toBeUndefined();
});
it('keeps long note text, quote text and multiple images', async () => {
	const rich = { ...item, legacy: { truncated: true }, note_tweet: { note_tweet_results: { result: { text: 'Complete long post. '.repeat(100) } } },
		quoted_status_result: { result: { details: { full_text: 'Quoted public post' }, media_entities2: [{ media_url_https: 'https://example.com/quote.jpg' }] } } };
	const parsed = await new TwitterResolver(vi.fn<FetchPage>().mockResolvedValue(page(rich))).resolve(url);
	expect(parsed.content).toContain('Complete long post. '.repeat(20)); expect(parsed.content).toContain('> Quoted public post'); expect(parsed.media).toHaveLength(2);
});
it('saves a video poster without fetching video variants', async () => {
	const parsed = await new TwitterResolver(vi.fn<FetchPage>().mockResolvedValue(page({ ...item, media_entities2: [{ type: 'video', media_url_https: 'https://example.com/poster.jpg', video_info: { variants: [{ url: 'https://example.com/stream.mp4' }] } }] }))).resolve(url);
	expect(parsed.media?.[0]?.candidates).toEqual(['https://example.com/poster.jpg']);
});
it('uses the observed public metadata layout if SSR and syndication are unavailable', async () => {
	const html = `<html><head><meta property="og:url" content="${url}"><meta property="og:title" content="Allen (@Allen0125) on X"><meta name="twitter:creator" content="@Allen0125"><meta property="og:description" content="我给炖了两个小时的牛肉又高压锅压了40分钟，兜兜吃美了"><meta property="og:image" content="https://pbs.twimg.com/media/HT8qReKbUAACeWc?format=webp&amp;name=large"></head><body></body></html>`;
	const fetch = vi.fn<FetchPage>().mockResolvedValueOnce({ text: html, url, headers: {} }).mockResolvedValueOnce({ text: '{}', url: 'https://cdn.syndication.twimg.com/tweet-result', headers: {} });
	const parsed = await new TwitterResolver(fetch).resolve(url);
	expect(parsed.content).toContain('牛肉'); expect(parsed.media?.[0]?.candidates[0]).toContain('&name=large');
});
it('rejects the actual age-restriction metadata without requesting alternative endpoints', async () => {
	const html = '<html><head><meta name="rating" content="adult"><meta property="og:description" content="Age-restricted adult content. To view this media, you’ll need to log in to X."></head><body></body></html>';
	const fetch = vi.fn<FetchPage>().mockResolvedValue({ text: html, url: 'https://x.com/Randgai_artz/status/2100577596954001735', headers: {} });
	await expect(new TwitterResolver(fetch).resolve('https://x.com/Randgai_artz/status/2100577596954001735')).rejects.toThrow('Age-restricted');
	expect(fetch).toHaveBeenCalledOnce();
});
it('does not accept an empty post, unrelated recommendations or an HTTP-200 login page', async () => {
	const fetch = vi.fn<FetchPage>().mockResolvedValue({ text: '<html><head><title>Log in</title></head><body>Sign in</body></html>', url, headers: {} });
	await expect(new TwitterResolver(fetch).resolve(url)).rejects.toThrow('login');
});
it.skipIf(process.env.STS_LIVE_PLATFORM !== '1')('checks the live user public post with anonymous headers', async () => {
	const request: FetchPage = async target => {
		// eslint-disable-next-line no-restricted-globals -- Opt-in Node test, not production Obsidian networking.
		const response = await fetch(target, { signal: AbortSignal.timeout(15000) });
		if (!response.ok) throw Error('HTTP ' + response.status);
		return { text: await response.text(), url: response.url, headers: {} };
	};
	const parsed = await new TwitterResolver(request).resolve(url);
	expect(parsed.content).toContain('牛肉'); expect(parsed.author).toBe('Allen'); expect(parsed.media).toHaveLength(1);
}, 60000);
