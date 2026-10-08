import { at, list, object, string } from './shared';
import type { Data, FetchPage } from './shared';

interface Cue { text: string; start?: number; end?: number }

export function subtitleMarkdown(source: string): string {
	let cues: Cue[] = [];
	try {
		const value: unknown = JSON.parse(source);
		cues = list(at(value, 'body')).map(item => ({ text: string(at(item, 'content')), start: Number(at(item, 'from')), end: Number(at(item, 'to')) }));
	} catch {
		const time = '(?:\\d{2}:)?\\d{2}:\\d{2}[.,]\\d{3}';
		const timing = new RegExp(`^(${time})\\s+-->\\s+(${time})(?:\\s.*)?$`);
		const seconds = (value: string): number => value.replace(',', '.').split(':').reduce((total, part) => total * 60 + Number(part), 0);
		for (const block of source.replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\s*\n/)) {
			const lines = block.split('\n');
			const index = lines.findIndex(line => timing.test(line.trim()));
			if (index < 0) continue;
			const match = timing.exec(lines[index]!.trim())!;
			cues.push({ text: lines.slice(index + 1).join(' '), start: seconds(match[1]!), end: seconds(match[2]!) });
		}
	}
	const paragraphs: string[] = [];
	let paragraph = '', previous = '', end: number | undefined;
	for (const cue of cues) {
		const doc = new DOMParser().parseFromString('<html><body>' + cue.text.replace(/<\d{2}:\d{2}(?::\d{2})?\.\d{3}>/g, '') + '</body></html>', 'text/html');
		doc.querySelectorAll('script,style').forEach(node => node.remove());
		const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
		if (!text) continue;
		if (text === previous) { end = cue.end; continue; }
		if (paragraph && ((Number.isFinite(cue.start) && Number.isFinite(end) && cue.start! - end! >= 2)
			|| (paragraph.length >= 450 && /[。！？.!?]$/.test(paragraph)))) {
			paragraphs.push(paragraph); paragraph = '';
		}
		const space = paragraph && !/[\u3400-\u9fff]$/.test(paragraph) && !/^[\u3400-\u9fff，。！？；：、]/.test(text) ? ' ' : '';
		paragraph += space + text; previous = text; end = cue.end;
	}
	if (paragraph) paragraphs.push(paragraph);
	return paragraphs.join('\n\n');
}

// Optional enhancement: only public URLs, no cookies or generated API signatures.
export async function videoSubtitles(fetch: FetchPage, data: Data, canonical: string): Promise<string> {
	const part = Number(new URL(canonical).searchParams.get('p') || 1);
	const pages = list(data.pages);
	const cid = pages.length ? at(pages[part - 1], 'cid') : part === 1 ? data.cid : undefined;
	if (!/^\d+$/.test(String(cid))) return '';
	let active = true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const work = async (): Promise<string> => {
		try {
			const query = new URLSearchParams({ cid: String(cid) });
			if (data.bvid) query.set('bvid', string(data.bvid)); else query.set('aid', String(data.aid));
			const response = object(JSON.parse((await fetch(`https://api.bilibili.com/x/player/wbi/v2?${query}`, canonical)).text));
			if (!active || response.code !== 0) return '';
			const tracks = list(at(response, 'data', 'subtitle', 'subtitles')).map(object);
			const rank = (track: Data): number => (/^(?:ai-)?zh(?:-|$)/i.test(string(track.lan)) ? 0 : 2) + (/^ai-/i.test(string(track.lan)) ? 1 : 0);
			tracks.sort((a, b) => rank(a) - rank(b));
			for (const track of tracks.slice(0, 3)) {
				if (!active) return '';
				try {
					const url = new URL(string(track.subtitle_url), canonical);
					if (url.protocol !== 'https:' || !/(?:^|\.)(?:hdslb\.com|bilibili\.com)$/.test(url.hostname)) continue;
					const text = subtitleMarkdown((await fetch(url.href, canonical)).text);
					if (active && text) return text;
				} catch { /* Try another publicly exposed language track. */ }
			}
		} catch { /* Subtitle access must never fail the video clip. */ }
		return '';
	};
	try {
		return await Promise.race([work(), new Promise<string>(resolve => { timer = setTimeout(() => { active = false; resolve(''); }, 4000); })]);
	} finally { active = false; if (timer) clearTimeout(timer); }
}
