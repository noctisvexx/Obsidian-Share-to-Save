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
