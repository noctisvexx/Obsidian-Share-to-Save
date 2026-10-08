import type { PlatformResolver } from '../resolver-registry';
import type { ParsedContent, ParsedMedia } from '../types';
import { at, date, fallback, find, host, images, list, object, payloads, post, publicPage, string } from './shared';
import type { Data, FetchPage, Page } from './shared';
import { scriptObjects } from './static-script-data';

export class TwitterResolver implements PlatformResolver {
	readonly name = 'X / Twitter';
	constructor(private fetch: FetchPage) {}
	matches(url: string): boolean { return host(url, ['x.com', 'twitter.com', 't.co']); }
	async resolve(input: string): Promise<ParsedContent> {
		let page: Page | undefined, url = input;
		if (host(input, ['t.co'])) {
			page = await this.fetch(input); publicPage(page);
			const doc = new DOMParser().parseFromString(page.text, 'text/html');
			url = doc.querySelector('meta[property="og:url"]')?.getAttribute('content') || page.url;
			if (!host(url, ['x.com', 'twitter.com'])) throw new Error('X short link does not identify a public post');
		}
		const parsed = new URL(url), id = parsed.pathname.match(/\/status\/(\d+)/)?.[1];
		if (!id) throw new Error('Unsupported X URL: a status link is required');
		const canonical = `https://x.com${parsed.pathname.replace(/\/(?:photo|video)\/\d+.*$/, '')}`;
		page = page || await this.fetch(canonical); publicPage(page);
		const html = page.text;
		return fallback([
			async () => {
				for (const root of payloads(html)) {
					const item = find(root, data => (string(data.rest_id) === id || string(data.id_str) === id) && Boolean(data.legacy || data.details));
					if (item) return this.tweet(item, canonical);
				}
				for (const item of scriptObjects(html, 'rest_id', id)) if (item.details || item.legacy) return this.tweet(item, canonical);
				throw new Error('No matching public X SSR post');
			},
			async () => {
				const data = object(JSON.parse((await this.fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en`, canonical)).text));
				if (string(data.id_str) !== id || !string(data.text)) throw new Error('Public syndication returned no matching post; no token is manufactured');
				const attachments = images(list(data.photos), canonical, photo => [at(photo, 'url')]);
				const cover = at(data, 'video', 'poster'); if (cover) attachments.push(...images([cover], canonical, value => [value]));
				return post('x', canonical, string(data.text).slice(0, 60), string(at(data, 'user', 'name')), string(data.text), attachments, date(data.created_at));
			},
			async () => this.metadata(html, canonical),
			async () => {
				const data = object(JSON.parse((await this.fetch(`https://publish.twitter.com/oembed?url=${encodeURIComponent(canonical)}&omit_script=true`)).text));
				if (!string(data.url).includes('/status/' + id)) throw new Error('oEmbed post does not match');
				const doc = new DOMParser().parseFromString(`<html><body>${string(data.html)}</body></html>`, 'text/html');
				const text = doc.querySelector('blockquote.twitter-tweet p')?.textContent?.trim() || '';
				if (!text || /https?:\/\/t\.co\/|pic\.twitter\.com/.test(text)) throw new Error('oEmbed is incomplete: media/long content require public page data');
				return post('x', canonical, text.slice(0, 60), string(data.author_name), text, []);
			},
		]);
	}
	private tweet(item: Data, url: string): ParsedContent {
		const legacy = object(item.legacy), details = object(item.details);
		const long = string(at(item, 'note_tweet', 'note_tweet_results', 'result', 'text'));
		const text = long || string(details.full_text) || string(legacy.full_text);
		if (!text || (legacy.truncated === true && !long)) throw new Error('X post text is missing or truncated');
		const user = object(at(item, 'core', 'user_results', 'result'));
		const author = string(at(user, 'legacy', 'name')) || string(at(user, 'core', 'name')) || string(at(item, 'author', 'core', 'name'));
		const handle = string(at(user, 'legacy', 'screen_name')) || string(at(user, 'core', 'screen_name')) || string(at(item, 'author', 'core', 'screen_name'));
		if (!author) throw new Error('X public author data is missing');
		const rawMedia = list(item.media_entities2).length ? list(item.media_entities2) : list(at(legacy, 'extended_entities', 'media'));
		const attachments = images(rawMedia, url, image => [at(image, 'media_url_https'), at(image, 'media_url')]);
		if (rawMedia.length !== attachments.length) throw new Error('X media set is incomplete');
		let body = text;
		const quote = object(at(item, 'quoted_status_result', 'result'));
		const quoteText = string(at(quote, 'details', 'full_text')) || string(at(quote, 'legacy', 'full_text'));
		if (quoteText) {
			body += '\n\n> ' + quoteText.replace(/\n/g, '\n> ');
			attachments.push(...images(list(quote.media_entities2).length ? list(quote.media_entities2) : list(at(quote, 'legacy', 'extended_entities', 'media')), url, image => [at(image, 'media_url_https'), at(image, 'media_url')]));
		}
		const result = post('x', url, text.slice(0, 60), author, body, attachments,
			date(typeof details.created_at_ms === 'number' ? details.created_at_ms / 1000 : legacy.created_at));
		if (handle) result.authorUrl = `https://x.com/${handle}`;
		return result;
	}
	private metadata(html: string, url: string): ParsedContent {
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const get = (key: string) => doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.getAttribute('content') || '';
		const canonical = get('og:url');
		if (!canonical || new URL(canonical).pathname.match(/\/status\/(\d+)/)?.[1] !== new URL(url).pathname.match(/\/status\/(\d+)/)?.[1]) throw new Error('X metadata does not identify the requested post');
		const text = get('og:description'), handle = get('twitter:creator').replace(/^@/, '');
		const author = get('og:title').split(' (@')[0] || '';
		const picture = get('og:image');
		if (!text || !handle || /(?:\.\.\.|…)$/.test(text) || /profile_images\//.test(picture)) throw new Error('X metadata is missing, truncated or only an avatar');
		const attachments: ParsedMedia[] = images(picture ? [picture] : [], url, value => [value]);
		return { ...post('x', url, text.slice(0, 60), author, text, attachments), authorUrl: `https://x.com/${handle}` };
	}
}
