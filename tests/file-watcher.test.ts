import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileWatcher } from '../src/file-watcher';
import type { QueueManager } from '../src/queue-manager';
import type { Downloader } from '../src/downloader';
import type { Translator } from '../src/i18n';
vi.mock('../src/notice-utils', () => ({ showNotice: vi.fn() }));
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('window', globalThis); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('stop prevents claims when a queue read finishes after unloading', async () => {
	let release!: (entries: unknown[]) => void;
	const claim = vi.fn();
	const queue = { getPendingEntries: () => new Promise(resolve => { release = resolve; }), claim } as unknown as QueueManager;
	const watcher = new FileWatcher(queue, { processUrl: vi.fn() }, vi.fn(), () => 1000, ((key: string) => key) as Translator);
	watcher.start(); const processing = watcher.processNow(); watcher.stop();
	release([{ id: 'task' }]); await processing; await vi.advanceTimersByTimeAsync(5000);
	expect(claim).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it('continues after a claim fails and never downgrades success after an acknowledgement failure', async () => {
	const finish = vi.fn().mockRejectedValue(Error('acknowledgement failed'));
	const processUrl = vi.fn().mockResolvedValue({ success: true });
	const claim = vi.fn().mockRejectedValueOnce(Error('read failed')).mockResolvedValue(true);
	const queue = { getPendingEntries: async () => [{ id: 'a' }, { id: 'b' }], claim, finish } as unknown as QueueManager;
	const watcher = new FileWatcher(queue, { processUrl }, vi.fn(), () => 1000, ((key: string) => key) as Translator);
	await watcher.processNow();
	expect(processUrl).toHaveBeenCalledOnce(); expect(finish).toHaveBeenCalledOnce();
	expect(finish.mock.calls[0]?.[1]).toBeUndefined();
});

it('drains another explicit share received while processing without mobile polling', async () => {
	let release!: (value: { success: boolean }) => void;
	const processUrl = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue({ success: true });
	const getPendingEntries = vi.fn().mockResolvedValueOnce([{ id: 'first' }]).mockResolvedValueOnce([{ id: 'second' }]);
	const queue = { getPendingEntries, claim: async () => true, finish: async () => {} } as unknown as QueueManager;
	const watcher = new FileWatcher(queue, { processUrl }, vi.fn(), () => 1000, ((key: string) => key) as Translator, 'mobile');
	const first = watcher.processNow();
	await vi.waitFor(() => expect(processUrl).toHaveBeenCalledOnce());
	await watcher.processNow(); release({ success: true }); await first;
	expect(processUrl).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
});

it('aborts a running mobile processor on stop and retains its failed task', async () => {
	const finish = vi.fn();
	const processUrl = vi.fn((_url: string, _id: string, _folder: string | undefined, signal?: AbortSignal) => new Promise((_, reject) => {
		signal?.addEventListener('abort', () => reject(Error('Clipping cancelled')), { once: true });
	}));
	const queue = { getPendingEntries: async () => [{ id: 'first', url: 'https://example.com' }], claim: async () => true, finish } as unknown as QueueManager;
	const watcher = new FileWatcher(queue, { processUrl: processUrl as never }, vi.fn(), () => 1000, ((key: string) => key) as Translator, 'mobile');
	const processing = watcher.processNow(); await vi.waitFor(() => expect(processUrl).toHaveBeenCalledOnce());
	watcher.stop(); await processing;
	expect(finish).toHaveBeenCalledWith(expect.anything(), 'Clipping cancelled', undefined);
	expect(vi.getTimerCount()).toBe(0);
});

it.each([false, true])('acknowledges only after processing (success=%s)', async success => {
	const calls: string[] = [];
	const queue = {
		getPendingEntries: async () => [{ id: 'task', url: 'https://example.com', filePath: 'queue/task.json' }],
		claim: async () => { calls.push('claim'); return true; },
		finish: async (_entry: unknown, error?: string) => { calls.push(error ? 'failed' : 'completed'); },
	} as unknown as QueueManager;
	const downloader = { processUrl: async () => { calls.push('process'); return { success, error: success ? undefined : 'timeout' }; } } as unknown as Downloader;
	const watcher = new FileWatcher(queue, downloader, vi.fn(), () => 1000, ((key: string) => key) as Translator);
	await (watcher as unknown as { check(): Promise<void> }).check();
	expect(calls).toEqual(['claim', 'process', success ? 'completed' : 'failed']);
});
