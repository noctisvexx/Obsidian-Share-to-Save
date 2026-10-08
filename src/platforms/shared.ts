import type { ParsedContent, ParsedMedia } from '../types';
import { QualityValidator } from '../quality-validator';

export interface Page { text: string; url: string; headers: Record<string, string> }
export type FetchPage = (url: string, referer?: string) => Promise<Page>;
export type Data = Record<string, unknown>;
export class AccessError extends Error {}
export function object(value: unknown): Data { return value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}; }
export function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
export function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
export function at(value: unknown, ...keys: string[]): unknown { return keys.reduce((current, key) => object(current)[key], value); }
export function host(url: string, domains: string[]): boolean {
	const name = new URL(url).hostname.toLowerCase();
	return domains.some(domain => name === domain || name.endsWith('.' + domain));
}
export function date(value: unknown): string {
	if (typeof value !== 'string' && typeof value !== 'number') return '';
	const result = new Date(typeof value === 'number' ? value * 1000 : value);
	return Number.isNaN(result.getTime()) ? '' : result.toISOString();
}
export function media(urls: unknown[], referer: string): ParsedMedia | undefined {
	const candidates = [...new Set(urls.map(string).map(url => url.startsWith('//') ? 'https:' + url : url).filter(url => /^https?:\/\//.test(url)))];
	return candidates.length ? { kind: 'image', candidates, referer } : undefined;
}
export function images(items: unknown[], referer: string, getUrls: (item: unknown) => unknown[]): ParsedMedia[] {
	return items.map(item => media(getUrls(item), referer)).filter((item): item is ParsedMedia => Boolean(item));
}
export function find(value: unknown, predicate: (data: Data) => boolean): Data | undefined {
	const pending = [value]; let count = 0;
	while (pending.length && count++ < 12000) {
		const next = pending.pop();
		if (typeof next === 'string' && next.length < 2000000 && (next.trim().startsWith('{') || next.trim().startsWith('['))) {
			try { pending.push(JSON.parse(next) as unknown); } catch { /* Only nested JSON, not executable expressions. */ }
			continue;
		}
		if (!next || typeof next !== 'object') continue;
		if (!Array.isArray(next) && predicate(object(next))) return object(next);
		pending.push(...(Array.isArray(next) ? list(next) : Object.values(object(next))));
	}
	return undefined;
}
function assignedObject(text: string): unknown {
	const start = text.indexOf('{'); if (start < 0) return undefined;
	let depth = 0, quoted = false, escaped = false;
	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
		else if (char === '"') quoted = true;
		else if (char === '{') depth++;
		else if (char === '}' && --depth === 0) {
			const raw = text.slice(start, i + 1).replace(/("(?:\\.|[^"\\])*")|\bundefined\b/g, (token, quote: string | undefined) => quote ? token : 'null');
			try { return JSON.parse(raw) as unknown; } catch { return undefined; }
		}
	}
	return undefined;
}
export function payloads(html: string): unknown[] {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const values: unknown[] = [];
	for (const script of Array.from(doc.querySelectorAll('script'))) {
		let text = script.textContent || '';
		if (script.id === 'RENDER_DATA') { try { text = decodeURIComponent(text); } catch { continue; } }
		if (script.type === 'application/json' || script.type === 'application/ld+json' || script.id === 'RENDER_DATA') {
			try { values.push(JSON.parse(text) as unknown); } catch { /* Not executable JavaScript. */ }
		} else {
			const match = /(?:window\.)?(?:__INITIAL_STATE__|_ROUTER_DATA|__NEXT_DATA__|_sharedData)\s*=/.exec(text);
			if (match) values.push(assignedObject(text.slice(match.index + match[0].length)));
		}
	}
	return values;
}
export function publicPage(page: Page): void {
	const doc = new DOMParser().parseFromString(page.text, 'text/html');
	const title = doc.querySelector('title')?.textContent?.trim() || '';
	const description = doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
	doc.querySelectorAll('script, style').forEach(el => el.remove());
	const body = doc.body.textContent?.trim() || '';
	if (doc.querySelector('meta[name="rating"]')?.getAttribute('content') === 'adult' || /age-restricted/i.test(description))
		throw new AccessError('年龄限制：请在平台完成年龄验证并确认访问权限；插件不绕过验证 / Age-restricted content requires platform verification and login');
	if (/\/(?:challenge|checkpoint)(?:\/|$)/.test(new URL(page.url).pathname)
		|| /^(?:just a moment|安全验证|验证码)/i.test(title)
		|| (body.length < 500 && /verify you are human|captcha|请完成验证/i.test(body)))
		throw new AccessError('页面要求验证码或安全验证，任务保留；请在平台处理 / Verification required, possibly including login');
	if (/you.?ll need to log in|sign in to (?:view|continue)/i.test(description)
		|| /\/(?:accounts\/login|login)(?:\/|$)/.test(new URL(page.url).pathname)
		|| /^(?:login|log in|sign in|登录)/i.test(title)
		|| (body.length < 500 && /登录后查看/i.test(body)))
		throw new AccessError('页面要求登录，任务已保留；请在浏览器确认可访问内容 / Public content requires login');
	if (/^access denied/i.test(title) || (body.length < 500 && /访问过于频繁/i.test(body)))
		throw new AccessError('平台限制访问或请求频率，任务已保留 / Access denied or rate limited');
	if (/content (?:is not|isn't) available/i.test(description) || (body.length < 500 && /内容不存在|视频已删除|page isn't available/i.test(body)))
		throw new AccessError('平台报告内容不可用，可能已删除或受访问限制 / Public content is unavailable or restricted');
}
export async function fallback(steps: (() => Promise<ParsedContent>)[]): Promise<ParsedContent> {
	const errors: string[] = [];
	for (const step of steps) {
		try { const parsed = await step(); const quality = QualityValidator.validate(parsed); if (quality.valid) return parsed; errors.push(quality.reason || 'Incomplete content'); }
		catch (error) { if (error instanceof AccessError) throw error; errors.push(error instanceof Error ? error.message : String(error)); }
	}
	throw new Error(errors.join('; '));
}
export function post(platform: string, url: string, title: string, author: string, content: string, attachments: ParsedMedia[], published = '', kind: 'post' | 'video' = 'post'): ParsedContent {
	return { platform, originalUrl: url, canonicalUrl: url, title, author, published, content, imageUrls: [], media: attachments, contentKind: kind };
}
