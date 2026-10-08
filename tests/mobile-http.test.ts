import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { requestUrl } from 'obsidian';
import { mobileRequest } from '../src/mobile-http';
vi.mock('obsidian', async importOriginal => ({ ...await importOriginal<object>(), requestUrl: vi.fn() }));
const network = requestUrl as unknown as Mock<(options: {url: string; headers: Record<string, string>}) => Promise<unknown>>;
beforeEach(() => { network.mockReset(); });
afterEach(() => vi.useRealTimers());

it('expands relative redirects and keeps the resolved URL', async () => {
	network.mockResolvedValueOnce({ status: 302, headers: { location: '/article' } })
		.mockResolvedValueOnce({ status: 200, text: 'body', arrayBuffer: new ArrayBuffer(0), headers: {} });
	expect((await mobileRequest('https://example.com/short')).url).toBe('https://example.com/article');
});

it('rejects HTTP failures and redirect loops', async () => {
	network.mockResolvedValue({ status: 403, headers: {} });
	await expect(mobileRequest('https://example.com')).rejects.toThrow('HTTP 403');
	network.mockResolvedValue({ status: 302, headers: { location: '/loop' } });
	await expect(mobileRequest('https://example.com')).rejects.toThrow('Too many redirects');
});

it('times out a stalled mobile request', async () => {
	vi.useFakeTimers();
	network.mockImplementation(() => new Promise(() => {}));
	const assertion = expect(mobileRequest('https://example.com')).rejects.toThrow('Network timeout');
	await vi.advanceTimersByTimeAsync(30001);
	await assertion;
});

it('uses native request headers for public Instagram embeds only', async () => {
	network.mockResolvedValue({ status: 200, text: 'body', headers: {} });
	await mobileRequest('https://www.instagram.com/p/DdrPNX1jVEz/embed/captioned/');
	const options = network.mock.calls[0]![0] as { headers: Record<string, string> };
	expect(options.headers['User-Agent']).toBeUndefined();
	expect(options.headers['Accept-Language']).toBeUndefined();
	await mobileRequest('https://www.instagram.com/p/DdrPNX1jVEz/');
	expect((network.mock.calls[1]![0] as { headers: Record<string, string> }).headers['User-Agent']).toBeDefined();
	await mobileRequest('https://www.xiaohongshu.com/explore/example');
	expect((network.mock.calls[2]![0] as { headers: Record<string, string> }).headers['User-Agent']).toContain('Android');
});

it('does not follow a late redirect after the request timeout', async () => {
	vi.useFakeTimers();
	let release!: (value: unknown) => void;
	network.mockImplementation(() => new Promise(resolve => { release = resolve; }));
	const pending = expect(mobileRequest('https://example.com/short')).rejects.toThrow('Network timeout');
	await vi.advanceTimersByTimeAsync(30001); await pending;
	release({ status: 302, headers: { location: '/late' } });
	await vi.advanceTimersByTimeAsync(1);
	expect(network).toHaveBeenCalledOnce();
});
