import type { ParsedContent } from './types';

export class QualityValidator {
	static validate(parsed: ParsedContent): { valid: boolean; reason?: string; score: number } {
		const text = parsed.content.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[#*_>`]/g, '').trim();
		const blocked = /^(?:log in|sign in|login required|access denied|page not found|打开\s*app|请登录|登录后|内容不存在|访问受限)/i;
		const placeholders = /(打开\s*app\s*(?:查看|阅读)|open (?:in |the )?app to|sign in to (?:continue|view|read)|登录后(?:查看|阅读))/i;
		if ((blocked.test(parsed.title.trim()) && text.length < 300) || (placeholders.test(text) && text.length < 300))
			return { valid: false, reason: 'Login wall, error page or app-only placeholder', score: 0 };
		const mediaCount = parsed.media?.filter(m => m.candidates.length).length ?? parsed.imageUrls.length;
		if (parsed.mediaOnly && mediaCount > 0) return { valid: true, score: 100 + mediaCount };
		if (!text || text === parsed.title.trim() || text.length < 40)
			return { valid: false, reason: 'Body is empty or incomplete', score: 0 };
		return { valid: true, score: Math.min(text.length, 10000) + mediaCount * 20 };
	}
}
