import type { PlatformResolver } from '../resolver-registry';
import type { ParsedContent } from '../types';
import { AccessError, at, date, fallback, find, host, images, list, object, payloads, post, publicPage, string } from './shared';
import type { Data, FetchPage, Page } from './shared';
import { scriptObjects } from './static-script-data';

export class InstagramResolver implements PlatformResolver {
	readonly name = 'Instagram';
	constructor(private fetch: FetchPage) {}
	matches(url: string): boolean { return host(url, ['instagram.com', 'instagr.am']); }
	async resolve(input: string): Promise<ParsedContent> {
		const page = await this.fetch(input); publicPage(page);
		let shortcode = new URL(input).pathname.match(/\/(?:p|reel|tv)\/([\w-]+)/)?.[1];
		if (!shortcode) {
			const doc = new DOMParser().parseFromString(page.text, 'text/html');
			const url = doc.querySelector('meta[property="og:url"]')?.getAttribute('content') || page.url;
			if (!host(url, ['instagram.com', 'instagr.am'])) throw new Error('Instagram share redirected outside the platform');
			shortcode = new URL(url).pathname.match(/\/(?:p|reel|tv)\/([\w-]+)/)?.[1];
		}
		if (!shortcode) throw new Error('Instagram share does not expose a post shortcode');
		const code = shortcode, canonical = `https://www.instagram.com/p/${code}/`;
		return fallback([
			async () => this.extract(page, code, canonical),
			async () => this.extract(await this.fetch(`${canonical}embed/captioned/`), code, canonical),
			async () => {
				const response = object(JSON.parse((await this.fetch(`https://graph.facebook.com/v25.0/instagram_oembed?url=${encodeURIComponent(canonical)}`)).text));
				if (response.error) throw new Error('Public Instagram oEmbed refused access; no access token is supplied');
				// oEmbed confirms identity only; skeleton embed HTML is not article content.
				if (!string(response.html).includes(code)) throw new Error('Instagram oEmbed does not match requested post');
				throw new Error('Instagram oEmbed has no complete image/gallery payload; refusing a cover-only result');
			},
		]);
	}
	private extract(page: Page, code: string, canonical: string): ParsedContent {
		publicPage(page);
		for (const root of [...payloads(page.text), ...scriptObjects(page.text, 'shortcode', code)]) {
			const data = find(root, item => (string(item.shortcode) === code || string(item.code) === code)
				&& Boolean(item.display_url || item.image_versions2 || item.edge_sidecar_to_children || item.carousel_media));
			if (data) return this.media(data, code, canonical);
		}
		throw new Error('Instagram public page lacks complete matching media data (including nested embed contextJSON/Polaris data)');
	}
	private media(data: Data, code: string, canonical: string): ParsedContent {
		if (data.copyright_blocked || data.is_private || at(data, 'owner', 'is_private') || at(data, 'user', 'is_private')) throw new AccessError('Instagram media is restricted or private');
		const owner = object(data.owner || data.user);
		const username = string(owner.username);
		if (!username) throw new Error('Instagram owner identity is missing');
		const caption = string(at(data, 'caption', 'text')) || list(at(data, 'edge_media_to_caption', 'edges')).map(edge => string(at(edge, 'node', 'text'))).join('\n');
		const sidecar = list(at(data, 'edge_sidecar_to_children', 'edges')).map(edge => at(edge, 'node'));
		const carousel = list(data.carousel_media);
		const children = sidecar.length ? sidecar : carousel;
		const isCarousel = data.__typename === 'GraphSidecar' || data.media_type === 8 || Boolean(data.edge_sidecar_to_children || data.carousel_media);
		if (isCarousel && !children.length) throw new Error('Instagram carousel children are unavailable; cover alone is insufficient');
		if (typeof data.carousel_media_count === 'number' && data.carousel_media_count !== children.length) throw new Error('Instagram carousel is incomplete');
		const attachments = images(children.length ? children : [data], canonical, item => [
			at(item, 'display_url'), ...list(at(item, 'display_resources')).map(value => at(value, 'src')),
			...list(at(item, 'image_versions2', 'candidates')).map(value => at(value, 'url')),
		]);
		if (attachments.length !== (children.length || 1)) throw new Error('Instagram media set is incomplete');
		const result = post('instagram', canonical, caption.split('\n')[0]?.trim().slice(0, 80) || `Instagram ${code}`,
			string(owner.full_name) || username, caption, attachments, date(data.taken_at_timestamp || data.taken_at), 'post');
		result.authorUrl = `https://www.instagram.com/${username}/`;
		return result;
	}
}
