import { beforeEach, expect, it, vi } from 'vitest';
import { DOMParser } from 'linkedom';
import { InstagramResolver } from '../src/platforms/instagram';
import type { FetchPage } from '../src/platforms/shared';
import { buildHeaders } from '../src/http-utils';
beforeEach(() => vi.stubGlobal('DOMParser', DOMParser));
const code = 'DdrPNX1jVEz';
const url = `https://www.instagram.com/p/${code}/`;
// Reduced observed public embed contextJSON shape, media URLs anonymized.
const media = { __typename: 'GraphSidecar', shortcode: code, owner: { username: 'jocelincarmes' },
	edge_media_to_caption: { edges: [{ node: { text: 'The Weather App Didn’t Mention This\n#digitalpainting' } }] },
	edge_sidecar_to_children: { edges: [{ node: { display_url: 'https://example.com/one.jpg', display_resources: [{ src: 'https://example.com/one-backup.jpg' }] } }, { node: { display_url: 'https://example.com/two.jpg' } }] } };
const page = (value: unknown, target = url) => ({ text: '<html><head></head><body><script type="application/json">' + JSON.stringify({ require: [['Embed', null, [], [{ contextJSON: JSON.stringify({ gql_data: { shortcode_media: value } }) }]]] }) + '</script></body></html>', url: target, headers: {} });
it.each([url + '?img_index=2&stkn=share', `https://www.instagram.com/jocelincarmes/p/${code}/`, `https://instagr.am/p/${code}/`])('keeps all carousel images for a normal or alias link (%s)', async input => {
	const parsed = await new InstagramResolver(vi.fn<FetchPage>().mockResolvedValue(page(media))).resolve(input);
	expect(parsed.author).toBe('jocelincarmes'); expect(parsed.content).toContain('Weather'); expect(parsed.media).toHaveLength(2); expect(parsed.media?.[0]?.candidates).toHaveLength(2);
});
it('expands an Instagram share link using public post identity', async () => {
	const response = page(media, 'https://www.instagram.com/share/example');
	response.text = response.text.replace('<head>', `<head><meta property="og:url" content="${url}">`);
	expect((await new InstagramResolver(vi.fn<FetchPage>().mockResolvedValue(response)).resolve(response.url)).canonicalUrl).toBe(url);
});
it('uses public embed contextJSON after an ordinary page has metadata only', async () => {
	const fetch = vi.fn<FetchPage>().mockResolvedValueOnce({ text: '<html><head><title>Instagram</title></head><body></body></html>', url, headers: {} }).mockResolvedValueOnce(page(media));
	expect((await new InstagramResolver(fetch).resolve(url)).media).toHaveLength(2);
	expect(fetch.mock.calls[1]?.[0]).toBe(url + 'embed/captioned/');
});

it('reads the observed embed boot JSON-string literal without running boot code', async () => {
	const boot = { contextJSON: JSON.stringify({ gql_data: { shortcode_media: media } }) };
	const text = '<html><head></head><body><script>requireLazy([],function(){boot(' + JSON.stringify(JSON.stringify(boot)) + ');throw Error("must not execute");});</script></body></html>';
	const parsed = await new InstagramResolver(vi.fn<FetchPage>().mockResolvedValue({ text, url, headers: {} })).resolve(url);
	expect(parsed.media).toHaveLength(2); expect(parsed.content).toContain('Weather');
});
it('reads publicly embedded Polaris image_versions2 and video cover data, not video files', async () => {
	const value = { code, media_type: 2, user: { username: 'creator' }, caption: { text: 'Video caption' }, taken_at: 1700000000,
		image_versions2: { candidates: [{ url: 'https://example.com/poster.jpg' }, { url: 'https://example.com/poster2.jpg' }] }, video_versions: [{ url: 'https://example.com/video.mp4' }] };
	const parsed = await new InstagramResolver(vi.fn<FetchPage>().mockResolvedValue(page(value))).resolve(url);
	expect(parsed.media?.[0]?.candidates).toEqual(['https://example.com/poster.jpg', 'https://example.com/poster2.jpg']); expect(parsed.published).toBe('2023-11-14T22:13:20.000Z');
});
it('supports a genuine captionless single-image post', async () => {
	const parsed = await new InstagramResolver(vi.fn<FetchPage>().mockResolvedValue(page({ shortcode: code, owner: { username: 'creator' }, display_url: 'https://example.com/photo.jpg' }))).resolve(url);
	expect(parsed.content).toBe(''); expect(parsed.media).toHaveLength(1);
});
it('rejects a carousel cover without its children', async () => {
	const fetch = vi.fn<FetchPage>().mockResolvedValue(page({ ...media, edge_sidecar_to_children: { edges: [] }, display_url: 'https://example.com/cover.jpg' }));
	await expect(new InstagramResolver(fetch).resolve(url)).rejects.toThrow('cover alone');
});
it.each(['login', 'challenge'])('does not try embed or oEmbed after an explicit %s wall', async path => {
	const fetch = vi.fn<FetchPage>().mockResolvedValue({ text: '<html><body>Please sign in</body></html>', url: `https://www.instagram.com/${path}/`, headers: {} });
	await expect(new InstagramResolver(fetch).resolve(url)).rejects.toThrow('login'); expect(fetch).toHaveBeenCalledOnce();
});
it.skipIf(process.env.STS_LIVE_PLATFORM !== '1')('checks the live user Instagram carousel without credentials', async () => {
	const request: FetchPage = async target => {
		const headers = buildHeaders();
		if (new URL(target).pathname.includes('/embed/')) {
			delete headers['User-Agent']; delete headers['Accept-Language'];
		}
		// eslint-disable-next-line no-restricted-globals -- Opt-in Node acceptance probe, not production networking.
		const response = await fetch(target, { headers, signal: AbortSignal.timeout(20000) });
		if (!response.ok) throw Error('HTTP ' + response.status);
		return { text: await response.text(), url: response.url, headers: {} };
	};
	const parsed = await new InstagramResolver(request).resolve(url);
	expect(parsed.authorUrl).toContain('jocelincarmes'); expect(parsed.content).toContain('Weather'); expect(parsed.media!.length).toBeGreaterThan(1);
}, 90000);
