import type { Downloader } from './downloader';
import type { ProcessResult } from './types';
import { mobileRequest } from './mobile-http';
import { ResolverRegistry } from './resolver-registry';
import type { PlatformResolver } from './resolver-registry';
import { UrlNormalizer } from './url-normalizer';
import { checkCancelled } from './cancellation';

export class MobileClipper {
	constructor(private pipeline: Downloader) {}
	private registry(signal?: AbortSignal): ResolverRegistry {
		const pages = new Map<string, ReturnType<typeof mobileRequest>>();
		const createResolver = (generic: boolean): PlatformResolver => ({
			name: generic ? 'Generic HTML' : 'Existing site converter',
			matches: url => /(?:^|\.)(?:mp\.weixin\.qq\.com|xiaohongshu\.com|xhslink\.com|zhihu\.com|publish\.obsidian\.md)$/.test(new URL(url).hostname),
			resolve: async url => {
				if (!pages.has(url)) pages.set(url, mobileRequest(url, new URL(url).origin, false, signal));
				const response = await pages.get(url)!;
				checkCancelled(signal);
				const contentType = response.headers['content-type'] || response.headers['Content-Type'] || '';
				if (/(?:application\/json|image\/|video\/)/i.test(contentType)) throw new Error('Response is not an HTML page');
				const canonicalUrl = UrlNormalizer.canonical(response.text, response.url);
				const parsed = this.pipeline.processDocToParsed(response.text, canonicalUrl, generic);
				if (!parsed) throw new Error('Could not extract body');
				return { ...parsed, originalUrl: url, canonicalUrl, platform: new URL(canonicalUrl).hostname };
			},
		});
		return new ResolverRegistry([createResolver(false)], createResolver(true));
	}
	async processUrl(url: string, id: string, folder?: string, signal?: AbortSignal): Promise<ProcessResult> {
		try {
			checkCancelled(signal);
			const existing = await this.pipeline.existingTaskNote(id, folder);
			if (existing) return existing;
			const parsed = await this.registry(signal).resolve(UrlNormalizer.normalize(url));
			checkCancelled(signal);
			return await this.pipeline.saveNote(parsed, parsed.canonicalUrl || url, id, url, folder, signal);
		} catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
	}
}
