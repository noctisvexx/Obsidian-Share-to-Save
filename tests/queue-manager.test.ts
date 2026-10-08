import { describe, it, expect, vi } from 'vitest';
import type { Vault } from 'obsidian';
import { QueueManager } from '../src/queue-manager';

function setup() {
	const files = new Map<string, string>();
	const folders = new Set(['clips']);
	const adapter = {
		exists: async (p: string) => folders.has(p) || files.has(p),
		list: async (p: string) => ({ files: [...files.keys()].filter(f => f.slice(0, f.lastIndexOf('/')) === p), folders: [] }),
		read: vi.fn(async (p: string) => { if (!files.has(p)) throw Error('missing'); return files.get(p)!; }),
		write: async (p: string, s: string) => { files.set(p, s); },
		remove: vi.fn(async (p: string) => { files.delete(p); }),
	};
	const vault = { adapter, createFolder: async (p: string) => { folders.add(p); },
		create: async (p: string, s: string) => { if (files.has(p)) throw Error('exists'); files.set(p, s); } } as unknown as Vault;
	return { files, adapter, vault, queue: new QueueManager(vault, () => '_ShareToSave/queue', () => 'clips') };
}

describe('safe queue storage', () => {
	it('deduplicates repeated shares including offline producers using deterministic IDs', async () => {
		const a = setup(); const b = setup();
		await a.queue.enqueue({ ...QueueManager.buildEntry('https://example.com/post?utm_source=phone', 'mobile'), noteFolder: 'clips' });
		await a.queue.enqueue({ ...QueueManager.buildEntry('https://example.com/post', 'desktop'), noteFolder: 'clips' });
		await b.queue.enqueue({ ...QueueManager.buildEntry('https://example.com/post', 'desktop'), noteFolder: 'clips' });
		expect(await a.queue.getEntries()).toHaveLength(1);
		expect((await a.queue.getEntries())[0]?.id).toBe((await b.queue.getEntries())[0]?.id);
	});
	it('keeps success authoritative when sync restores stale pending or failed state', async () => {
		const { queue, files } = setup();
		await queue.appendEntry(QueueManager.buildEntry('https://example.com', 'desktop'));
		const entry = (await queue.getEntries())[0]!;
		await queue.claim(entry); await queue.finish(entry);
		for (const status of ['pending', 'failed'] as const) {
			files.set(entry.filePath, JSON.stringify({ ...entry, status, allowDesktopFallback: true }));
			expect((await queue.getEntries())[0]?.status).toBe('completed');
			expect(await queue.claim(entry, true)).toBe(false);
			await queue.retry(entry);
			expect(await queue.getPendingEntries('desktop', true)).toHaveLength(0);
		}
	});
	it('retains completion when acknowledgement fails after the note has been saved', async () => {
		const { queue, vault } = setup();
		await queue.appendEntry(QueueManager.buildEntry('https://example.com', 'desktop'));
		const entry = (await queue.getEntries())[0]!;
		await queue.claim(entry);
		vault.adapter.write = vi.fn().mockRejectedValue(Error('sync write failed'));
		await expect(queue.finish(entry)).rejects.toThrow();
		expect((await queue.getEntries())[0]?.status).toBe('completed');
	});
	it('preserves sync-conflict copies and reports them without processing twice', async () => {
		const { queue, files } = setup();
		const entry = QueueManager.buildEntry('https://example.com', 'desktop');
		await queue.appendEntry(entry);
		files.set('_ShareToSave/queue/conflict-copy.json', JSON.stringify(entry));
		expect(await queue.getPendingEntries()).toHaveLength(1);
		expect(queue.getIssues()).toHaveLength(1);
		expect(files.has('_ShareToSave/queue/conflict-copy.json')).toBe(true);
	});
	it('refuses forged mutation paths and unknown task data', async () => {
		const { queue, files } = setup();
		const foreign = 'clips/ordinary.json';
		files.set(foreign, '{"important":"user data"}');
		const entry = { ...QueueManager.buildEntry('https://example.com', 'desktop'), filePath: foreign };
		await expect(queue.retry(entry)).rejects.toThrow('canonical');
		await expect(queue.claim(entry)).rejects.toThrow('canonical');
		expect(files.get(foreign)).toBe('{"important":"user data"}');
	});
	it('leaves legacy source intact if it changes while migration is in progress', async () => {
		const { queue, files, vault } = setup();
		const path = 'clips/toBeSaved_old.json';
		const old = { id: 'old-id', url: 'https://example.com', source: 'mobile', createdAt: new Date().toISOString() };
		files.set(path, JSON.stringify(old));
		vault.create = vi.fn(async (newPath: string, content: string) => {
			files.set(newPath, content); files.set(path, JSON.stringify({ ...old, url: 'https://example.org/new' }));
			return {} as never;
		});
		await queue.getEntries();
		expect(files.get(path)).toContain('example.org/new');
	});
	it('releases its own claim when the processing-state write fails', async () => {
		const { queue, files, vault } = setup();
		await queue.appendEntry(QueueManager.buildEntry('https://example.com', 'desktop'));
		const entry = (await queue.getEntries())[0]!;
		vault.adapter.write = vi.fn().mockRejectedValue(Error('disk full'));
		await expect(queue.claim(entry)).rejects.toThrow();
		expect(files.has(entry.filePath + '.claim')).toBe(false);
		expect((await queue.getEntries())[0]?.status).toBe('pending');
	});
	it('allows interrupted work to be retried only after both leases expire', async () => {
		const { queue, files } = setup();
		await queue.appendEntry(QueueManager.buildEntry('https://example.com', 'desktop'));
		const entry = (await queue.getEntries())[0]!;
		await queue.claim(entry); await queue.retry(entry);
		expect((await queue.getEntries())[0]?.status).toBe('processing');
		files.set(entry.filePath, JSON.stringify({ ...entry, status: 'processing', leaseUntil: '2000-01-01T00:00:00Z' }));
		files.set(entry.filePath + '.claim', JSON.stringify({ leaseUntil: '2000-01-01T00:00:00Z' }));
		await queue.retry(entry, 'mobile');
		expect((await queue.getEntries())[0]).toMatchObject({ status: 'pending', target: 'mobile' });
	});
	it('allows only the originating phone to process mobile pending work', async () => {
		const { vault } = setup();
		const phone = new QueueManager(vault, () => '_ShareToSave/queue', () => 'clips', 'phone-a');
		const other = new QueueManager(vault, () => '_ShareToSave/queue', () => 'clips', 'phone-b');
		await phone.appendEntry({ ...QueueManager.buildEntry('https://example.com', 'mobile'), target: 'mobile', originDevice: 'phone-a', allowDesktopFallback: true });
		expect(await phone.getPendingEntries('mobile')).toHaveLength(1);
		expect(await other.getPendingEntries('mobile')).toHaveLength(0);
		expect(await other.getPendingEntries('desktop', true)).toHaveLength(0);
	});
	it('retains mobile failures and permits one optional desktop fallback', async () => {
		const { queue, vault } = setup();
		const desktop = new QueueManager(vault, () => '_ShareToSave/queue', () => 'clips');
		await queue.appendEntry({ ...QueueManager.buildEntry('https://example.com', 'mobile'), target: 'mobile', allowDesktopFallback: true });
		const entry = (await queue.getEntries())[0]!;
		await queue.claim(entry);
		await queue.finish(entry, 'mobile network failure');
		expect(await desktop.getPendingEntries('desktop', false)).toHaveLength(0);
		expect(await desktop.getPendingEntries('desktop', true)).toHaveLength(1);
		expect(await desktop.claim(entry, true)).toBe(true);
		await desktop.finish(entry, 'desktop also failed');
		expect(await desktop.getPendingEntries('desktop', true)).toHaveLength(0);
		expect((await queue.getEntries())[0]?.status).toBe('failed');
	});
	it('does not send successful mobile tasks to desktop', async () => {
		const { queue } = setup();
		await queue.appendEntry({ ...QueueManager.buildEntry('https://example.com', 'mobile'), target: 'mobile', allowDesktopFallback: true });
		const entry = (await queue.getEntries())[0]!;
		await queue.claim(entry); await queue.finish(entry);
		expect(await queue.getPendingEntries('desktop', true)).toHaveLength(0);
	});
	it('permits only one claimant on a shared current filesystem', async () => {
		const { queue, vault } = setup();
		const other = new QueueManager(vault, () => '_ShareToSave/queue', () => 'clips');
		await queue.appendEntry(QueueManager.buildEntry('https://example.com', 'desktop'));
		const entry = (await queue.getEntries())[0]!;
		const claimed = await Promise.all([queue.claim(entry), other.claim(entry)]);
		expect(claimed.filter(Boolean)).toHaveLength(1);
	});
	it('never reads, modifies or deletes Web Clipper Markdown or attachments', async () => {
		const { files, queue, adapter } = setup();
		files.set('clips/web-clipper.md', '---\nsource: https://example.com\n---\nArticle ![[photo.png]]');
		files.set('clips/plain.md', '[Title](https://example.org)');
		files.set('clips/photo.png', 'binary');
		const before = [...files];
		expect(await queue.getPendingEntries()).toEqual([]);
		expect([...files]).toEqual(before);
		expect(adapter.read).not.toHaveBeenCalled();
		expect(adapter.remove).not.toHaveBeenCalled();
	});
	it('isolates versioned tasks and preserves failure for retry', async () => {
		const { files, queue } = setup();
		await queue.appendEntry(QueueManager.buildEntry('https://example.com', 'mobile'));
		expect([...files.keys()][0]).toMatch(/^_ShareToSave\/queue\//);
		const entry = (await queue.getPendingEntries())[0]!;
		expect(await queue.claim(entry)).toBe(true);
		expect(await queue.claim(entry)).toBe(false);
		await queue.finish(entry, 'timeout');
		expect((await queue.getEntries())[0]).toMatchObject({ status: 'failed', error: 'timeout' });
		await queue.retry(entry);
		expect(await queue.getPendingEntries()).toHaveLength(1);
	});
	it('migrates valid legacy data once and leaves unknown JSON intact', async () => {
		const { files, queue } = setup();
		const old = { id: 'legacy-id', url: 'https://example.com', source: 'mobile', createdAt: new Date().toISOString() };
		files.set('clips/toBeSaved_old.json', JSON.stringify(old));
		files.set('clips/toBeSaved_unknown.json', '{"url":"https://example.com"}');
		expect(await queue.getPendingEntries()).toHaveLength(1);
		expect(await queue.getPendingEntries()).toHaveLength(1);
		expect(files.has('clips/toBeSaved_old.json')).toBe(false);
		expect(files.has('clips/toBeSaved_unknown.json')).toBe(true);
	});
	it('keeps source data when migration write fails', async () => {
		const { files, queue, vault } = setup();
		files.set('clips/toBeSaved_old.json', JSON.stringify({ id: 'old', url: 'https://example.com', source: 'desktop', createdAt: new Date().toISOString() }));
		vault.create = vi.fn().mockRejectedValue(Error('disk full'));
		await queue.getEntries();
		expect(files.has('clips/toBeSaved_old.json')).toBe(true);
	});
	it('rejects arbitrary JSON and invalid URLs', async () => {
		const { queue } = setup();
		await expect(queue.appendEntry({ ...QueueManager.buildEntry('file:///private', 'mobile') })).rejects.toThrow();
		expect(QueueManager.isQueueEntry({ id: 'x', url: 'https://example.com', source: 'mobile', createdAt: new Date().toISOString() })).toBe(false);
	});
});
