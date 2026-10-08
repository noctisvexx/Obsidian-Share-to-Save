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
	it.each(['https://mp.weixin.qq.com/s?mid=123', 'https://www.xiaohongshu.com/explore/123', 'https://zhuanlan.zhihu.com/p/123', 'https://example.com/article'])('treats another explicit share of a successful %s as a fresh task', async url => {
		const { queue, files } = setup();
		const request = { ...QueueManager.buildEntry(url, 'desktop'), target: 'desktop' as const, noteFolder: 'clips' };
		await queue.enqueue(request);
		const original = (await queue.getEntries())[0]!;
		files.set('clips/Article.md', `---\nsts_id: ${original.id}\n---\nArticle`);
		await queue.claim(original); await queue.finish(original);
		expect(await queue.getEntries()).toEqual([]);
		expect([...files.keys()].filter(path => path.startsWith('_ShareToSave/queue/'))).toEqual([]);
		await queue.enqueue(request); await queue.enqueue(request);
		const pending = await queue.getPendingEntries('desktop');
		expect(pending).toHaveLength(1);
		expect(pending[0]?.id).not.toBe(original.id);
		expect(files.get('clips/Article.md')).toContain(original.id);
		await queue.claim(pending[0]!); await queue.finish(pending[0]!, 'network failure');
		await queue.enqueue(request);
		expect((await queue.getPendingEntries('desktop'))[0]?.id).toBe(pending[0]?.id);
	});
	it('allows a new share without reading or changing previous or foreign notes', async () => {
		const { queue, files } = setup();
		const request = { ...QueueManager.buildEntry('https://example.com', 'desktop'), noteFolder: 'clips' };
		await queue.enqueue(request);
		const entry = (await queue.getEntries())[0]!;
		await queue.claim(entry); await queue.finish(entry);
		files.set('clips/Renamed.md', `---\nsts_id: ${entry.id}\n---\nSaved`);
		files.set('clips/Article.md', 'Foreign note');
		expect(await queue.enqueue(request)).toBe('queued');
		expect(await queue.getPendingEntries()).toHaveLength(1);
		expect(files.get('clips/Article.md')).toBe('Foreign note');
	});
	it('merges concurrent local shares only while their task is unfinished', async () => {
		const a = setup(); const b = setup();
		await Promise.all([
			a.queue.enqueue({ ...QueueManager.buildEntry('https://example.com/post?utm_source=phone', 'mobile'), noteFolder: 'clips' }),
			a.queue.enqueue({ ...QueueManager.buildEntry('https://example.com/post', 'desktop'), noteFolder: 'clips' }),
		]);
		await b.queue.enqueue({ ...QueueManager.buildEntry('https://example.com/post', 'desktop'), noteFolder: 'clips' });
		expect(await a.queue.getEntries()).toHaveLength(1);
		expect((await a.queue.getEntries())[0]?.id).not.toBe((await b.queue.getEntries())[0]?.id);
	});
	it('uses a temporary success receipt to prevent processing again while cleanup is blocked', async () => {
		const { queue, files, adapter } = setup();
		await queue.appendEntry(QueueManager.buildEntry('https://example.com', 'desktop'));
		const entry = (await queue.getEntries())[0]!;
		await queue.claim(entry);
		adapter.remove.mockRejectedValue(Error('cleanup blocked'));
		await queue.finish(entry);
		for (const status of ['pending', 'failed'] as const) {
			files.set(entry.filePath, JSON.stringify({ ...entry, status, allowDesktopFallback: true }));
			expect((await queue.getEntries())[0]?.status).toBe('completed');
			expect(await queue.claim(entry, true)).toBe(false);
			await queue.retry(entry);
			expect(await queue.getPendingEntries('desktop', true)).toHaveLength(0);
		}
		adapter.remove.mockImplementation(async path => { files.delete(path); });
		expect(await queue.getEntries()).toEqual([]);
		expect(files.size).toBe(0);
	});
	it('retains completion when acknowledgement fails after the note has been saved', async () => {
		const { queue, vault } = setup();
		await queue.appendEntry(QueueManager.buildEntry('https://example.com', 'desktop'));
		const entry = (await queue.getEntries())[0]!;
		await queue.claim(entry);
		vault.adapter.write = vi.fn().mockRejectedValue(Error('sync write failed'));
		await expect(queue.finish(entry)).rejects.toThrow();
		expect(await queue.getEntries()).toEqual([]);
	});
	it.each(['', '.claim', '.done'])('recovers partial successful cleanup at %s without touching notes', async suffix => {
		const { queue, files, vault, adapter } = setup();
		await queue.enqueue(QueueManager.buildEntry('https://example.com', 'desktop'));
		const entry = (await queue.getEntries())[0]!;
		files.set('clips/Saved.md', `---\nsts_id: ${entry.id}\n---\nUser result`);
		const saved = files.get('clips/Saved.md');
		await queue.claim(entry);
		let blocked = true;
		adapter.remove.mockImplementation(async path => {
			if (blocked && path === entry.filePath + suffix) throw Error('temporary storage failure');
			files.delete(path);
		});
		await queue.finish(entry);
		expect(files.has(entry.filePath + '.done')).toBe(true);
		expect(await queue.getPendingEntries()).toEqual([]);
		blocked = false;
		const restarted = new QueueManager(vault, () => '_ShareToSave/queue', () => 'clips');
		expect(await restarted.getEntries()).toEqual([]);
		expect([...files.keys()]).toEqual(['clips/Saved.md']);
		expect(files.get('clips/Saved.md')).toBe(saved);
	});
	it('cleans old successful receipts but preserves failed and unknown data', async () => {
		const { queue, files } = setup();
		const completed = { ...QueueManager.buildEntry('https://example.com/old', 'desktop'), status: 'completed' as const };
		const failed = { ...QueueManager.buildEntry('https://example.com/failed', 'mobile'), status: 'failed' as const, error: 'Unavailable' };
		await queue.appendEntry(completed); await queue.appendEntry(failed);
		files.set(`_ShareToSave/queue/${completed.id}.json.done`, JSON.stringify(completed));
		files.set('_ShareToSave/queue/unknown.json.done', '{"not":"a task"}');
		expect(await queue.getEntries()).toHaveLength(1);
		expect(files.has(`_ShareToSave/queue/${completed.id}.json`)).toBe(false);
		expect(files.has(`_ShareToSave/queue/${failed.id}.json`)).toBe(true);
		expect(files.has('_ShareToSave/queue/unknown.json.done')).toBe(true);
	});
	it('preserves a conflicting claim and task instead of deleting unconfirmed data', async () => {
		const { queue, files } = setup();
		const completed = { ...QueueManager.buildEntry('https://example.com', 'desktop'), status: 'completed' as const, owner: 'original' };
		await queue.appendEntry(completed);
		files.set(`_ShareToSave/queue/${completed.id}.json.claim`, JSON.stringify({ owner: 'someone-else' }));
		const before = [...files];
		expect(await queue.getEntries()).toHaveLength(1);
		expect([...files]).toEqual(before); expect(queue.getIssues()).toHaveLength(1);
	});
	it('does not clean a receipt while its completion write is still running', async () => {
		const { queue, files, vault } = setup();
		await queue.enqueue(QueueManager.buildEntry('https://example.com', 'desktop'));
		const entry = (await queue.getEntries())[0]!; await queue.claim(entry);
		let release!: () => void;
		const write = vi.fn(async (path: string, text: string) => {
			await new Promise<void>(resolve => { release = resolve; }); files.set(path, text);
		});
		vault.adapter.write = write;
		const finishing = queue.finish(entry);
		await vi.waitFor(() => expect(write).toHaveBeenCalled());
		expect((await queue.getEntries())[0]?.status).toBe('completed');
		expect(files.has(entry.filePath + '.done')).toBe(true);
		release(); await finishing;
		expect(files.size).toBe(0);
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
