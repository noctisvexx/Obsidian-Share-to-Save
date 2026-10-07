import { describe, it, expect, vi } from 'vitest';
import { DOMParser } from 'linkedom';
import { UrlNormalizer } from '../src/url-normalizer';
import { QualityValidator } from '../src/quality-validator';
import { ResolverRegistry } from '../src/resolver-registry';
import type { ParsedContent } from '../src/types';
vi.stubGlobal('DOMParser', DOMParser);
const good: ParsedContent = { title: 'Article', author: '', published: '', content: 'A complete public article with enough meaningful text to keep and read offline.', imageUrls: [] };

describe('normalization and quality', () => {
	it('removes tracking but preserves required shared-post tokens and IDs', () => {
		const url = new URL(UrlNormalizer.normalize('https://www.xiaohongshu.com/explore/123?xsec_token=secret&utm_source=app&id=123#top'));
		expect(url.searchParams.get('xsec_token')).toBe('secret');
		expect(url.searchParams.get('id')).toBe('123');
		expect(url.searchParams.has('utm_source')).toBe(false);
	});
	it('keeps access tokens when canonical tags omit them', () => {
		expect(UrlNormalizer.canonical('<html><head><link rel="canonical" href="/post/123"></head></html>', 'https://example.com/post/123?xsec_token=abc')).toContain('xsec_token=abc');
	});
	it.each(['', 'Article', '打开 App 查看完整内容', 'Sign in to view this post'])('rejects incomplete or blocked body: %s', content => {
		expect(QualityValidator.validate({ ...good, content }).valid).toBe(false);
	});
	it('does not confuse a cover-only article with a complete media post', () => {
		const media = { ...good, content: '![](https://example.com/cover.jpg)', imageUrls: ['https://example.com/cover.jpg'] };
		expect(QualityValidator.validate(media).valid).toBe(false);
		expect(QualityValidator.validate({ ...media, mediaOnly: true }).valid).toBe(true);
	});
	it('tries generic extraction after bad platform output', async () => {
		const generic = { name: 'generic', matches: () => true, resolve: vi.fn().mockResolvedValue(good) };
		const registry = new ResolverRegistry([{ name: 'platform', matches: () => true, resolve: async () => ({ ...good, content: '' }) }], generic);
		expect(await registry.resolve('https://example.com')).toEqual(good);
		expect(generic.resolve).toHaveBeenCalledOnce();
	});
});
