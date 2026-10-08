import { requestUrl } from 'obsidian';
import { buildHeaders } from './http-utils';
import { checkCancelled } from './cancellation';

export const XHS_MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

export async function mobileRequest(url: string, referer?: string, binary = false, signal?: AbortSignal): Promise<{ text: string; arrayBuffer: ArrayBuffer; headers: Record<string, string>; url: string }> {
	checkCancelled(signal);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let rejectAbort: (() => void) | undefined;
	try {
		return await Promise.race([
			(async () => {
				let current = url;
				for (let hop = 0; hop <= 5; hop++) {
					checkCancelled(signal);
					const headers = buildHeaders(referer);
					if (!binary && /(?:^|\.)(?:xiaohongshu\.com|xhslink\.(?:com|cn))$/.test(new URL(current).hostname))
						headers['User-Agent'] = XHS_MOBILE_UA;
					if (referer) headers.Referer = referer;
					const response = await requestUrl({ url: current, headers, throw: false });
					checkCancelled(signal);
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
			new Promise<never>((_, reject) => {
				rejectAbort = () => reject(new Error('Clipping cancelled'));
				signal?.addEventListener('abort', rejectAbort, { once: true });
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
		if (rejectAbort) signal?.removeEventListener('abort', rejectAbort);
	}
}
