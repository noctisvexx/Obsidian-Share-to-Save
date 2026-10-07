import type { Downloader } from './downloader';
import type { ProcessResult } from './types';
import { mobileRequest } from './mobile-http';
import { ResolverRegistry } from './resolver-registry';
import type { PlatformResolver } from './resolver-registry';
import { UrlNormalizer } from './url-normalizer';

export class MobileClipper {
	private registry: ResolverRegistry;
	constructor(private pipeline: Downloader) {
		const createResolver = (generic: boolean): PlatformResolver => ({
			name: generic ? 'Generic HTML' : 'Existing site converter',
			matches: url => /(?:^|\.)(?:mp\.weixin\.qq\.com|xiaohongshu\.com|xhslink\.com|zhihu\.com|publish\.obsidian\.md)$/.test(new URL(url).hostname),
			resolve: async url => {
				const response = await mobileRequest(url, new URL(url).origin);
				const canonicalUrl = UrlNormalizer.canonical(response.text, response.url);
				const parsed = pipeline.processDocToParsed(response.text, canonicalUrl, generic);
				if (!parsed) throw new Error('Could not extract body');
				return { ...parsed, originalUrl: url, canonicalUrl, platform: new URL(canonicalUrl).hostname };
			},
		});
		this.registry = new ResolverRegistry([createResolver(false)], createResolver(true));
	}
	async processUrl(url: string, id: string, folder?: string): Promise<ProcessResult> {
		try {
			const existing = await this.pipeline.existingTaskNote(id, folder);
			if (existing) return existing;
			const parsed = await this.registry.resolve(UrlNormalizer.normalize(url));
			return await this.pipeline.saveNote(parsed, parsed.canonicalUrl || url, id, url, folder);
		} catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
	}
}
