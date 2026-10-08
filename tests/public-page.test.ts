import { beforeEach, expect, it, vi } from 'vitest';
import { DOMParser } from 'linkedom';
import { AccessError, publicPage } from '../src/platforms/shared';
beforeEach(() => vi.stubGlobal('DOMParser', DOMParser));
it.each([
	['<meta name="rating" content="adult">', '', 'Age-restricted'],
	['<title>Login</title>', '', 'requires login'],
	['<title>安全验证</title>', 'captcha', 'Verification required'],
	['<title>Instagram</title>', '视频已删除', 'unavailable'],
	['<title>Instagram</title>', '访问过于频繁', 'rate limited'],
])('reports a specific access reason without treating HTTP 200 as content (%s)', (head, body, reason) => {
	const page = { text: `<html><head>${head}</head><body>${body}</body></html>`, url: 'https://example.com/post', headers: {} };
	expect(() => publicPage(page)).toThrow(AccessError);
	expect(() => publicPage(page)).toThrow(reason);
});
