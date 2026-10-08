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
		const fetchPage = async (url: string) => {
			let current = url;
			for (let hop = 0; hop < 4; hop++) {
				const response = await mobileRequest(current, new URL(current).origin, false, signal);
				const target = UrlNormalizer.shortLinkTarget(response.text, response.url);
				if (!target) return response;
				if (target === current) throw new Error('小红书短链跳转循环 / Short-link redirect loop');
				current = target;
			}
			throw new Error('小红书短链跳转次数过多 / Too many short-link redirects');
		};
		const createResolver = (generic: boolean): PlatformResolver => ({
			name: generic ? 'Generic HTML' : 'Existing site converter',
			matches: url => /(?:^|\.)(?:mp\.weixin\.qq\.com|xiaohongshu\.com|xhslink\.(?:com|cn)|zhihu\.com|publish\.obsidian\.md)$/.test(new URL(url).hostname),
			resolve: async url => {
				if (!pages.has(url)) pages.set(url, fetchPage(url));
				const response = await pages.get(url)!;
				checkCancelled(signal);
				const contentType = response.headers['content-type'] || response.headers['Content-Type'] || '';
				if (/(?:application\/json|image\/|video\/)/i.test(contentType)) throw new Error('Response is not an HTML page');
				const canonicalUrl = UrlNormalizer.canonical(response.text, response.url);
				if (/(?:^|\.)(?:xiaohongshu\.com|xhslink\.(?:com|cn))$/.test(new URL(canonicalUrl).hostname)) {
					const doc = new DOMParser().parseFromString(response.text, 'text/html');
					doc.querySelectorAll('script, style').forEach(element => element.remove());
					const visible = doc.body.textContent?.trim() || '';
					if (generic && !visible) throw new Error('笔记初始化数据未提供可用正文，页面也没有可提取正文 / No usable SSR note or visible body');
					if (visible.length < 500 && /笔记已删除|笔记不存在|当前笔记暂时无法浏览|你访问的页面不见了|请完成验证|访问频次过高/.test(visible))
						throw new Error(`页面报告内容不可访问或需验证 / Page unavailable or verification required: ${visible.slice(0, 160)}`);
				}
				const parsed = this.pipeline.processDocToParsed(response.text, canonicalUrl, generic);
				if (!parsed) throw new Error('Could not extract body');
				const resolvedUrl = parsed.canonicalUrl || canonicalUrl;
				return { ...parsed, originalUrl: url, canonicalUrl: resolvedUrl, platform: new URL(resolvedUrl).hostname };
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
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const xhs = /(?:^|\.)(?:xiaohongshu\.com|xhslink\.(?:com|cn))$/.test(new URL(url).hostname);
			return { success: false, error: xhs
				? `小红书剪藏失败 / Xiaohongshu: ${message}. 页面可能受登录或访问限制，或未返回可解析的笔记初始化数据；任务已保留，可重试或使用桌面兜底。`
				: message };
		}
	}
}
