import { requestUrl } from 'obsidian';
import { buildHeaders } from './http-utils';

export async function mobileRequest(url: string, referer?: string, binary = false): Promise<{ text: string; arrayBuffer: ArrayBuffer; headers: Record<string, string>; url: string }> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			(async () => {
				let current = url;
				for (let hop = 0; hop <= 5; hop++) {
					const headers = buildHeaders(referer);
					if (referer) headers.Referer = referer;
					const response = await requestUrl({ url: current, headers, throw: false });
					if (response.status >= 300 && response.status < 400) {
						const location = response.headers.location || response.headers.Location;
						if (!location) throw new Error('Redirect missing destination');
						current = new URL(location, current).href;
						if (!['https:', 'http:'].includes(new URL(current).protocol)) throw new Error('Unsupported redirect');
						continue;
					}
					if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
					return { text: binary ? '' : response.text, arrayBuffer: binary ? response.arrayBuffer : new ArrayBuffer(0), headers: response.headers, url: current };
				}
				throw new Error('Too many redirects');
			})(),
			new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Network timeout')), 30000); }),
		]);
	} finally { if (timer) clearTimeout(timer); }
}
