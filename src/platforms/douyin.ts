import type { PlatformResolver } from '../resolver-registry';
import type { ParsedContent } from '../types';
import { AccessError, at, date, fallback, find, host, images, list, object, payloads, post, publicPage, string } from './shared';
import type { FetchPage, Page } from './shared';

export class DouyinResolver implements PlatformResolver {
	readonly name = 'Douyin';
	constructor(private fetch: FetchPage) {}
	matches(url: string): boolean { return host(url, ['douyin.com', 'iesdouyin.com']); }
	async resolve(input: string): Promise<ParsedContent> {
		let url = input;
		let first: Page | undefined;
		if (new URL(input).hostname === 'v.douyin.com') {
			first = await this.fetch(input); publicPage(first);
			const doc = new DOMParser().parseFromString(first.text, 'text/html');
			url = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || first.url;
			if (!host(url, ['douyin.com', 'iesdouyin.com'])) throw new Error('Douyin share redirected outside the platform');
		}
		const parsed = new URL(url);
		const id = parsed.pathname.match(/\/(?:video|note)\/(\d+)/)?.[1] || parsed.searchParams.get('modal_id') || parsed.searchParams.get('aweme_id');
		if (id && !/^\d+$/.test(id)) throw new Error('Invalid Douyin item ID');
		return fallback([
			async () => this.extract(first || await this.fetch(url), id || undefined),
			async () => {
				if (!id) throw new Error('Douyin short link did not expose its item ID');
				return this.extract(await this.fetch(`https://www.iesdouyin.com/share/video/${id}/`), id);
			},
		]);
	}
	private extract(page: Page, id?: string): ParsedContent {
		publicPage(page);
		if (page.text.includes('_$jsvmprt')) throw new AccessError('Douyin returned a JavaScript verification page; no challenge is executed');
		for (const root of payloads(page.text)) {
			const item = find(root, data => {
				const current = string(data.aweme_id) || string(data.awemeId);
				return Boolean(current && /^\d+$/.test(current) && (!id || current === id) && data.author && (data.video || data.images || data.image_post_info));
			});
			if (!item) continue;
			const current = string(item.aweme_id) || string(item.awemeId);
			const caption = string(item.desc);
			const author = string(at(item, 'author', 'nickname'));
			if (!author) throw new Error('Douyin author metadata is missing');
			const gallery = list(item.images).length ? list(item.images) : list(at(item, 'image_post_info', 'images'));
			const canonical = `https://www.douyin.com/${gallery.length ? 'note' : 'video'}/${current}`;
			const attachments = images(gallery, canonical, image => [...list(at(image, 'url_list')), ...list(at(image, 'display_image', 'url_list'))]);
			if (gallery.length && gallery.length !== attachments.length) throw new Error('Douyin gallery is incomplete');
			if (!gallery.length) attachments.push(...images([object(item.video)], canonical, video => [
				...list(at(video, 'origin_cover', 'url_list')), ...list(at(video, 'cover', 'url_list')), ...list(at(video, 'dynamic_cover', 'url_list')),
			]));
			const result = post('douyin', canonical, caption.slice(0, 80), author, caption, attachments, date(item.create_time), gallery.length ? 'post' : 'video');
			const secUid = string(at(item, 'author', 'sec_uid'));
			if (secUid) result.authorUrl = `https://www.douyin.com/user/${encodeURIComponent(secUid)}`;
			return result;
		}
		throw new Error('Douyin public page has no matching RENDER_DATA/_ROUTER_DATA item; login, restriction or page changes may prevent access');
	}
}
