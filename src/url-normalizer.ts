export class UrlNormalizer {
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
			const trustedShortLink = /(?:^|\.)xhslink\.com$/.test(originalHost) && /(?:^|\.)xiaohongshu\.com$/.test(canonical.hostname);
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
