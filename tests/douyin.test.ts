import { beforeEach, expect, it, vi } from 'vitest';
import { DOMParser } from 'linkedom';
import { DouyinResolver } from '../src/platforms/douyin';
import type { FetchPage } from '../src/platforms/shared';
beforeEach(() => vi.stubGlobal('DOMParser', DOMParser));
// Public share-page loader layout documented by the producer/extractor sources;
// illustrative values, not an actual successful live response from this environment.
const item = { aweme_id: '1234567890', desc: 'A short video caption', create_time: 1700000000, author: { nickname: 'Creator', sec_uid: 'public-author' },
	video: { cover: { url_list: ['https://example.com/cover.jpg', 'https://example.com/cover-backup.jpg'] } } };
function page(value: unknown, url = 'https://www.douyin.com/video/1234567890') {
	return { text: '<html><head></head><body><script>window._ROUTER_DATA=' + JSON.stringify(value) + '</script></body></html>', url, headers: {} };
}
const route = (value: unknown) => ({ loaderData: { 'video_(id)/page': { videoInfoRes: { item_list: [value] } } } });
it.each(['https://www.douyin.com/video/1234567890', 'https://www.douyin.com/?modal_id=1234567890', 'https://www.iesdouyin.com/share/video/1234567890/'])('extracts a video cover and caption (%s)', async url => {
	const parsed = await new DouyinResolver(vi.fn<FetchPage>().mockResolvedValue(page(route(item)))).resolve(url);
	expect(parsed.content).toBe(item.desc); expect(parsed.media?.[0]?.candidates).toHaveLength(2); expect(parsed.media?.[0]?.kind).toBe('image');
});
it('uses SSR item ID when the short-link final URL is hidden', async () => {
	const parsed = await new DouyinResolver(vi.fn<FetchPage>().mockResolvedValue(page(route(item), 'https://v.douyin.com/sample/'))).resolve('https://v.douyin.com/sample/');
	expect(parsed.canonicalUrl).toBe('https://www.douyin.com/video/1234567890');
});
it('reads URL-encoded RENDER_DATA and preserves every photo with fallback URLs', async () => {
	const photos = { ...item, images: [{ url_list: ['https://example.com/a.jpg', 'https://example.com/a2.jpg'] }, { display_image: { url_list: ['https://example.com/b.jpg'] } }] };
	const response = { text: '<html><head></head><body><script id="RENDER_DATA" type="application/json">' + encodeURIComponent(JSON.stringify({ aweme_detail: photos })) + '</script></body></html>', url: 'https://www.douyin.com/note/1234567890', headers: {} };
	const parsed = await new DouyinResolver(vi.fn<FetchPage>().mockResolvedValue(response)).resolve(response.url);
	expect(parsed.media).toHaveLength(2); expect(parsed.media?.[0]?.candidates).toHaveLength(2); expect(parsed.contentKind).toBe('post');
});
it('does not select an unrelated recommended video', async () => {
	const fetch = vi.fn<FetchPage>().mockResolvedValue(page(route({ ...item, aweme_id: '111' })));
	await expect(new DouyinResolver(fetch).resolve('https://www.douyin.com/video/1234567890')).rejects.toThrow('no matching');
});
it.each([
	'<html><head><title>登录</title></head><body>登录后查看</body></html>',
	'<html><head></head><body></body><script>window._$jsvmprt=function(){}</script></html>',
	'<html><head></head><body><script id="RENDER_DATA">invalid</script></body></html>',
])('rejects a restricted, challenge or empty page', async html => {
	const fetch = vi.fn<FetchPage>().mockResolvedValue({ text: html, url: 'https://www.douyin.com/video/1234567890', headers: {} });
	await expect(new DouyinResolver(fetch).resolve('https://www.douyin.com/video/1234567890')).rejects.toThrow();
});
