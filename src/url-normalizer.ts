export class UrlNormalizer {
	static shortLinkTarget(html: string, fetchedUrl: string): string | null {
		if (!/(?:^|\.)xhslink\.(?:com|cn)$/.test(new URL(fetchedUrl).hostname)) return null;
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const refresh = Array.from(doc.querySelectorAll('meta')).find(meta => meta.getAttribute('http-equiv')?.toLowerCase() === 'refresh')?.getAttribute('content');
		const href = refresh?.match(/^\s*\d+(?:\.\d+)?\s*;\s*url\s*=\s*["']?([^"']+)["']?\s*$/i)?.[1]
			|| Array.from(doc.querySelectorAll('script')).map(script => script.textContent || '').join('\n')
				.match(/(?:window\.)?location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/)?.[1];
		if (!href) return null;
		try {
			const target = new URL(href.trim(), fetchedUrl);
			if (!['http:', 'https:'].includes(target.protocol) || !/(?:^|\.)(?:xiaohongshu\.com|xhslink\.(?:com|cn))$/.test(target.hostname)) return null;
			return UrlNormalizer.normalize(target.href);
		} catch { return null; }
	}
	static normalize(input: string): string {
		const url = new URL(input);
		if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only HTTP URLs can be clipped');
		url.hash = '';
		for (const key of Array.from(url.searchParams.keys())) {
			if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key)) url.searchParams.delete(key);
		}
		return url.href;
	}
	static canonical(html: string, fetchedUrl: string): string {
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const href = doc.querySelector('link[rel="canonical"]')?.getAttribute('href')
			|| doc.querySelector('meta[property="og:url"]')?.getAttribute('content');
		if (!href) return fetchedUrl;
		try {
			const canonical = new URL(href, fetchedUrl);
			const originalHost = new URL(fetchedUrl).hostname;
			const trustedShortLink = /(?:^|\.)xhslink\.(?:com|cn)$/.test(originalHost) && /(?:^|\.)xiaohongshu\.com$/.test(canonical.hostname);
			if (canonical.hostname !== originalHost && !trustedShortLink) return fetchedUrl;
			// Preserve access tokens omitted by canonical tags.
			for (const key of ['xsec_token', 'xsec_source']) {
				const value = new URL(fetchedUrl).searchParams.get(key);
				if (value && !canonical.searchParams.has(key)) canonical.searchParams.set(key, value);
			}
			return UrlNormalizer.normalize(canonical.href);
		} catch { return fetchedUrl; }
	}
}
