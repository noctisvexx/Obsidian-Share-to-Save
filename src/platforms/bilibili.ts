import type { PlatformResolver } from '../resolver-registry';
import type { ParsedContent } from '../types';
import { at, date, fallback, find, host, images, list, object, payloads, post, publicPage, string } from './shared';
import type { Data, FetchPage } from './shared';

export class BilibiliResolver implements PlatformResolver {
	readonly name = 'Bilibili';
	constructor(private fetch: FetchPage) {}
	matches(url: string): boolean { return host(url, ['bilibili.com', 'b23.tv']); }
	async resolve(input: string): Promise<ParsedContent> {
		let url = input, html: string | undefined;
		if (host(url, ['b23.tv'])) {
			const page = await this.fetch(url); publicPage(page); html = page.text;
			const doc = new DOMParser().parseFromString(html, 'text/html');
			url = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || doc.querySelector('meta[property="og:url"]')?.getAttribute('content') || page.url;
			if (!host(url, ['bilibili.com'])) throw new Error('Bilibili short link did not expose a video or dynamic URL');
		}
		const parsed = new URL(url);
		const video = parsed.pathname.match(/\/video\/(BV[\w]+|av\d+)/i)?.[1];
		const dynamic = parsed.pathname.match(/\/(?:opus|dynamic)\/(\d+)/)?.[1] || (parsed.hostname === 't.bilibili.com' ? parsed.pathname.match(/^\/(\d+)/)?.[1] : undefined);
		if (!video && !dynamic) throw new Error('Unsupported Bilibili link: share a video or dynamic post');
		const canonical = video ? `https://www.bilibili.com/video/${video}/` : `https://www.bilibili.com/opus/${dynamic}`;
		return fallback([
			async () => {
				const endpoint = video ? `https://api.bilibili.com/x/web-interface/view?${video.startsWith('av') ? 'aid=' + video.slice(2) : 'bvid=' + video}`
					: `https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=${dynamic}`;
				const response = object(JSON.parse((await this.fetch(endpoint, 'https://www.bilibili.com/')).text));
				if (response.code !== 0) throw new Error(`Bilibili public API rejected: ${String(response.code)} ${string(response.message)}`);
				return video ? this.video(object(response.data), canonical, video) : this.dynamic(object(at(response, 'data', 'item')), canonical, dynamic!);
			},
			async () => {
				const page = html ? { text: html, url, headers: {} } : await this.fetch(canonical); publicPage(page);
				for (const root of payloads(page.text)) {
					if (video) {
						const data = find(root, data => (string(data.bvid) === video || 'av' + String(data.aid) === video) && Boolean(data.owner));
						if (data) return this.video(data, canonical, video);
					} else {
						const item = find(root, data => string(data.id_str) === dynamic && Boolean(data.modules));
						if (item) return this.dynamic(item, canonical, dynamic!);
					}
				}
				throw new Error('Bilibili page has no matching public video/dynamic data');
			},
		]);
	}
	private video(data: Data, url: string, id: string): ParsedContent {
		if (!(string(data.bvid) === id || 'av' + String(data.aid) === id) || !string(data.title) || !string(at(data, 'owner', 'name')))
			throw new Error('Bilibili video metadata is incomplete or mismatched');
		const result = post('bilibili', url, string(data.title), string(at(data, 'owner', 'name')), string(data.desc), images([data.pic], url, image => [image]), date(data.pubdate), 'video');
		result.authorUrl = `https://space.bilibili.com/${String(at(data, 'owner', 'mid'))}`;
		return result;
	}
	private dynamic(data: Data, url: string, id: string): ParsedContent {
		if (string(data.id_str) !== id) throw new Error('Bilibili dynamic ID mismatch');
		if (Array.isArray(data.modules)) return this.opus(data, url);
		const author = object(at(data, 'modules', 'module_author'));
		const dynamic = object(at(data, 'modules', 'module_dynamic'));
		const major = object(dynamic.major);
		const opus = object(major.opus);
		const archive = object(major.archive);
		const content = string(at(opus, 'summary', 'text')) || string(at(dynamic, 'desc', 'text')) || string(archive.desc);
		const title = string(opus.title) || string(archive.title) || content.slice(0, 60);
		const pictures = list(opus.pics).length ? list(opus.pics) : list(at(major, 'draw', 'items'));
		const attachments = images(pictures, url, image => [at(image, 'url'), at(image, 'src')]);
		if (archive.cover) attachments.push(...images([archive.cover], url, image => [image]));
		if (!string(author.name)) throw new Error('Bilibili dynamic author is missing');
		const result = post('bilibili', url, title, string(author.name), content, attachments, date(author.pub_ts), archive.title ? 'video' : 'post');
		result.authorUrl = `https://space.bilibili.com/${String(author.mid)}`;
		return result;
	}
	private opus(data: Data, url: string): ParsedContent {
		const modules = list(data.modules).map(object);
		if (modules.some(module => module.module_blocked || module.module_paywall)) throw new Error('Bilibili opus is blocked or paywalled');
		const titleModule = modules.find(module => module.module_type === 'MODULE_TYPE_TITLE');
		const authorModule = modules.find(module => module.module_type === 'MODULE_TYPE_AUTHOR');
		const author = object(authorModule?.module_author);
		const parts: string[] = [], pictures: unknown[] = [];
		const paragraphs = modules.flatMap(module => list(at(module, 'module_content', 'paragraphs')));
		for (const paragraph of paragraphs) {
			const words = list(at(paragraph, 'text', 'nodes')).map(node => string(at(node, 'word', 'words')) || string(at(node, 'rich', 'text'))).join('');
			if (words) parts.push(words);
			pictures.push(...list(at(paragraph, 'pic', 'pics')));
			if (at(paragraph, 'code', 'content')) parts.push(string(at(paragraph, 'code', 'content')));
		}
		const name = string(author.name) || string(at(author, 'author', 'name'));
		if (!name) throw new Error('Bilibili opus author is missing');
		return post('bilibili', url, string(at(titleModule, 'module_title', 'text')) || parts.join('\n').slice(0, 60), name,
			parts.join('\n\n'), images(pictures, url, picture => [at(picture, 'url')]), date(author.pub_ts));
	}
}
