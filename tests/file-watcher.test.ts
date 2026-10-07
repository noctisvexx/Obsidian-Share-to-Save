import { it, expect, vi } from 'vitest';
import { FileWatcher } from '../src/file-watcher';
import type { QueueManager } from '../src/queue-manager';
import type { Downloader } from '../src/downloader';
import type { Translator } from '../src/i18n';
vi.mock('../src/notice-utils', () => ({ showNotice: vi.fn() }));

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
