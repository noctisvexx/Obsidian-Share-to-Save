import type { Vault } from 'obsidian';
import type { QueueEntry, QueueEntryWithPath } from './types';
import { UrlNormalizer } from './url-normalizer';
import { randomId } from './random-id';

function validBase(value: unknown): value is Pick<QueueEntry, 'id' | 'url' | 'source' | 'createdAt'> {
	if (!value || typeof value !== 'object') return false;
	const e = value as QueueEntry;
	try {
		return typeof e.id === 'string' && /^[\w-]{1,128}$/.test(e.id)
			&& typeof e.url === 'string' && ['http:', 'https:'].includes(new URL(e.url).protocol)
			&& ['mobile', 'desktop'].includes(e.source) && typeof e.createdAt === 'string' && Number.isFinite(Date.parse(e.createdAt));
	} catch { return false; }
}

export class QueueManager {
	private issues: string[] = [];
	getIssues(): string[] { return [...this.issues]; }
	private readonly owner = randomId();
	private enqueueTail: Promise<unknown> = Promise.resolve();
	private completing = new Set<string>();
	constructor(private vault: Vault, private getQueueFolder: () => string,
		private getLegacyFolder: () => string = () => 'Share-to-Save', private deviceId = '') {}

	static buildEntry(url: string, source: QueueEntry['source']): QueueEntry {
		const now = new Date().toISOString();
		return { type: 'share-to-save', version: 1, id: randomId(), url, source,
			createdAt: now, updatedAt: now, status: 'pending' };
	}

	private folder(): string {
		const folder = this.getQueueFolder();
		if (!folder || folder.startsWith('/') || /[\\:]/.test(folder) || Array.from(folder).some(c => c.charCodeAt(0) < 32)
			|| folder.split('/').some(p => !p || p === '.' || p === '..')
			|| folder === this.getLegacyFolder() || folder.startsWith(this.getLegacyFolder() + '/'))
			throw new Error('Task folder must be a separate Vault folder');
		return folder;
	}
	private path(entry: QueueEntry): string { return `${this.folder()}/${entry.id}.json`; }
	private checkPath(entry: QueueEntryWithPath): void {
		if (entry.filePath !== this.path(entry)) throw new Error('Task path is not canonical');
	}

	enqueue(entry: QueueEntry): Promise<'queued'> {
		const result = this.enqueueTail.then(() => this.enqueueOne(entry));
		this.enqueueTail = result.catch(() => {});
		return result;
	}

	private async enqueueOne(entry: QueueEntry): Promise<'queued'> {
		const url = UrlNormalizer.normalize(entry.url);
		const matches = (await this.getEntries()).filter(e => UrlNormalizer.normalize(e.url) === url && e.noteFolder === entry.noteFolder);
		const existing = matches.find(e => e.status === 'pending' || e.status === 'processing')
			|| matches.find(e => e.status === 'failed');
		if (existing) {
			if (existing.status === 'failed') { await this.retry(existing, entry.target, entry.allowDesktopFallback); return 'queued'; }
			return 'queued';
		}
		await this.appendEntry({ ...entry, id: randomId(), url });
		return 'queued';
	}

	private async receipt(entry: QueueEntryWithPath): Promise<QueueEntry | undefined> {
		const path = `${entry.filePath}.done`;
		if (!await this.vault.adapter.exists(path)) return undefined;
		const receipt: unknown = JSON.parse(await this.vault.adapter.read(path));
		if (!QueueManager.isQueueEntry(receipt) || receipt.status !== 'completed' || receipt.id !== entry.id || receipt.url !== entry.url)
			throw new Error('Completion receipt conflicts with task');
		return receipt;
	}

	async appendEntry(entry: QueueEntry): Promise<void> {
		if (!QueueManager.isQueueEntry(entry)) throw new Error('Invalid Share to Save task');
		const folder = this.folder();
		if (!await this.vault.adapter.exists(folder)) {
			try { await this.vault.createFolder(folder); }
			catch (error) { if (!await this.vault.adapter.exists(folder)) throw error; }
		}
		const path = this.path(entry);
		if (!await this.vault.adapter.exists(path)) {
			try { await this.vault.create(path, JSON.stringify(entry)); return; }
			catch (error) { if (!await this.vault.adapter.exists(path)) throw error; }
		}
		{
			const existing: unknown = JSON.parse(await this.vault.adapter.read(path));
			if (!QueueManager.isQueueEntry(existing) || existing.url !== entry.url || existing.id !== entry.id)
				throw new Error('Task ID conflicts with existing data');
		}
	}

	async getEntries(): Promise<QueueEntryWithPath[]> {
		this.issues = [];
		await this.migrateLegacy();
		const folder = this.folder();
		if (!await this.vault.adapter.exists(folder)) return [];
		const entries: QueueEntryWithPath[] = [];
		const files = (await this.vault.adapter.list(folder)).files;
		for (const path of files.filter(p => p.endsWith('.json'))) {
			try {
				const entry: unknown = JSON.parse(await this.vault.adapter.read(path));
				if (QueueManager.isQueueEntry(entry) && path === this.path(entry)) {
					const task = { ...entry, filePath: path };
					const completed = await this.receipt(task);
					const current = { ...(completed || entry), filePath: path };
					if (current.status === 'completed' && !this.completing.has(path)) {
						try { await this.cleanupCompleted(current); continue; }
						catch { this.issues.push(`已保存任务暂未清理，将在下次检查重试 / Saved task cleanup deferred: ${path}`); }
					}
					entries.push(current);
				} else this.issues.push(`未执行无法识别或冲突的任务文件 / Unrecognized or conflicting task retained: ${path}`);
			} catch { this.issues.push(`任务文件暂不可读取，已保留 / Unreadable task retained: ${path}`); }
		}
		// Recover a crash after deleting the task but before deleting its temporary receipt.
		for (const path of files.filter(p => p.endsWith('.json.done'))) {
			const filePath = path.slice(0, -5);
			if (this.completing.has(filePath) || await this.vault.adapter.exists(filePath) || !await this.vault.adapter.exists(path)) continue;
			try {
				const completed: unknown = JSON.parse(await this.vault.adapter.read(path));
				if (!QueueManager.isQueueEntry(completed) || completed.status !== 'completed') throw Error('Invalid completion receipt');
				await this.cleanupCompleted({ ...completed, filePath });
			} catch { this.issues.push(`确认文件无法安全清理，已保留 / Completion receipt retained: ${path}`); }
		}
		return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}

	private async cleanupCompleted(entry: QueueEntryWithPath): Promise<void> {
		this.checkPath(entry);
		const raw = await this.vault.adapter.exists(entry.filePath) ? await this.vault.adapter.read(entry.filePath) : undefined;
		const current: unknown = raw === undefined ? undefined : JSON.parse(raw);
		if (raw !== undefined && (!QueueManager.isQueueEntry(current) || current.id !== entry.id || current.url !== entry.url))
			throw Error('Task changed before cleanup');
		const completed = await this.receipt(entry) || (QueueManager.isQueueEntry(current) && current.status === 'completed' ? current : undefined);
		if (!completed) throw Error('Task has no confirmed completion');
		const claimPath = entry.filePath + '.claim';
		if (await this.vault.adapter.exists(claimPath)) {
			const claim = JSON.parse(await this.vault.adapter.read(claimPath)) as { owner?: string };
			if (typeof claim.owner !== 'string' || claim.owner !== completed.owner) throw Error('Claim ownership changed before cleanup');
		}
		if (raw !== undefined) {
			if (await this.vault.adapter.read(entry.filePath) !== raw) throw Error('Task changed before cleanup');
			await this.vault.adapter.remove(entry.filePath);
		}
		if (await this.vault.adapter.exists(claimPath)) await this.vault.adapter.remove(claimPath);
		if (await this.vault.adapter.exists(entry.filePath + '.done')) await this.vault.adapter.remove(entry.filePath + '.done');
	}

	async getPendingEntries(target?: 'mobile' | 'desktop', fallback = false): Promise<QueueEntryWithPath[]> {
		return (await this.getEntries()).filter(e => {
			if (!target) return e.status === 'pending';
			if (target === 'mobile') return e.status === 'pending' && e.target === 'mobile' && e.originDevice === this.deviceId;
			return (e.status === 'pending' && (e.target === 'desktop' || !e.target))
				|| (fallback && e.status === 'failed' && e.allowDesktopFallback === true);
		});
	}

	private async migrateLegacy(): Promise<void> {
		const folder = this.getLegacyFolder();
		if (folder === this.getQueueFolder() || !await this.vault.adapter.exists(folder)) return;
		for (const path of (await this.vault.adapter.list(folder)).files) {
			if (!/\/toBeSaved_[^/]+\.json$/.test(path)) continue;
			try {
				const original = await this.vault.adapter.read(path);
				const legacy: unknown = JSON.parse(original);
				if (!validBase(legacy)) continue;
				if ('type' in legacy || 'version' in legacy) continue;
				const entry = { ...QueueManager.buildEntry(legacy.url, legacy.source), id: legacy.id, createdAt: legacy.createdAt,
					target: 'desktop' as const, noteFolder: folder };
				await this.appendEntry(entry);
				const saved: unknown = JSON.parse(await this.vault.adapter.read(this.path(entry)));
				if (QueueManager.isQueueEntry(saved) && saved.id === entry.id && saved.url === entry.url
					&& await this.vault.adapter.read(path) === original)
					await this.vault.adapter.remove(path);
			} catch { /* Never remove legacy data without a verified destination. */ }
		}
	}

	async claim(entry: QueueEntryWithPath, fallback = false): Promise<boolean> {
		this.checkPath(entry);
		if (await this.receipt(entry)) return false;
		const current = JSON.parse(await this.vault.adapter.read(entry.filePath)) as QueueEntry;
		if (!QueueManager.isQueueEntry(current) || current.id !== entry.id) return false;
		if (current.status !== 'pending' && !(fallback && current.status === 'failed' && current.allowDesktopFallback)) return false;
		const lockPath = `${entry.filePath}.claim`;
		try { await this.vault.create(lockPath, JSON.stringify({ owner: this.owner, leaseUntil: new Date(Date.now() + 10 * 60_000).toISOString() })); }
		catch { return false; }
		try { await this.update(entry.filePath, { ...current, status: 'processing', owner: this.owner,
			target: fallback && current.status === 'failed' ? 'desktop' : current.target,
			leaseUntil: new Date(Date.now() + 10 * 60_000).toISOString() }); }
		catch (error) {
			const lock = JSON.parse(await this.vault.adapter.read(lockPath)) as { owner?: string };
			if (lock.owner === this.owner) await this.vault.adapter.remove(lockPath);
			throw error;
		}
		return (JSON.parse(await this.vault.adapter.read(entry.filePath)) as QueueEntry).owner === this.owner;
	}

	private async update(path: string, entry: QueueEntry): Promise<void> {
		await this.vault.adapter.write(path, JSON.stringify({ ...entry, updatedAt: new Date().toISOString() }));
	}

	async finish(entry: QueueEntryWithPath, error?: string, warning?: string): Promise<void> {
		this.checkPath(entry);
		if (await this.receipt(entry)) return;
		const current = JSON.parse(await this.vault.adapter.read(entry.filePath)) as QueueEntry;
		const lock = JSON.parse(await this.vault.adapter.read(`${entry.filePath}.claim`)) as { owner?: string };
		if (!QueueManager.isQueueEntry(current) || current.owner !== this.owner || lock.owner !== this.owner)
			throw new Error('Task ownership changed');
		const updated: QueueEntry = { ...current, status: error ? 'failed' : 'completed', error: error || warning,
			allowDesktopFallback: error && current.target === 'mobile' ? current.allowDesktopFallback : false, leaseUntil: undefined };
		this.completing.add(entry.filePath);
		try {
			if (!error) await this.vault.create(`${entry.filePath}.done`, JSON.stringify({ ...updated, updatedAt: new Date().toISOString() }));
			await this.update(entry.filePath, updated);
			if (error) await this.vault.adapter.remove(`${entry.filePath}.claim`);
			else {
				try { await this.cleanupCompleted({ ...updated, filePath: entry.filePath }); }
				catch { this.issues.push(`已保存任务暂未清理，将在下次检查重试 / Saved task cleanup deferred: ${entry.filePath}`); }
			}
		} finally { this.completing.delete(entry.filePath); }
	}

	async retry(entry: QueueEntryWithPath, target?: 'mobile' | 'desktop', fallbackAllowed?: boolean): Promise<void> {
		this.checkPath(entry);
		if (await this.receipt(entry)) return;
		const current = JSON.parse(await this.vault.adapter.read(entry.filePath)) as QueueEntry;
		if (!QueueManager.isQueueEntry(current) || current.id !== entry.id || current.url !== entry.url) throw new Error('Task data changed');
		if (!['failed', 'processing', 'pending'].includes(current.status)) return;
		if (current.status === 'processing' && Date.parse(current.leaseUntil || '') > Date.now()) return;
		if (await this.vault.adapter.exists(`${entry.filePath}.claim`)) {
			const claim = JSON.parse(await this.vault.adapter.read(`${entry.filePath}.claim`)) as { leaseUntil?: string };
			if (Date.parse(claim.leaseUntil || '') > Date.now()) return;
			await this.vault.adapter.remove(`${entry.filePath}.claim`);
		}
		await this.update(entry.filePath, { ...current, status: 'pending', target: target || current.target,
			allowDesktopFallback: fallbackAllowed ?? current.allowDesktopFallback,
			originDevice: target === 'mobile' ? this.deviceId : current.originDevice,
			owner: undefined, error: undefined, leaseUntil: undefined });
	}

	static isQueueEntry(value: unknown): value is QueueEntry {
		if (!validBase(value)) return false;
		const entry = value as QueueEntry;
		return entry.type === 'share-to-save' && entry.version === 1
			&& ['pending', 'processing', 'failed', 'completed'].includes(entry.status)
			&& typeof entry.updatedAt === 'string' && Number.isFinite(Date.parse(entry.updatedAt))
			&& (entry.target === undefined || ['mobile', 'desktop'].includes(entry.target))
			&& (entry.allowDesktopFallback === undefined || typeof entry.allowDesktopFallback === 'boolean')
			&& (entry.originDevice === undefined || typeof entry.originDevice === 'string')
			&& (entry.noteFolder === undefined || (typeof entry.noteFolder === 'string' && Boolean(entry.noteFolder)
				&& !entry.noteFolder.startsWith('/') && !/[\\:]/.test(entry.noteFolder)
				&& !entry.noteFolder.split('/').some(p => !p || p === '.' || p === '..')))
			&& (entry.error === undefined || typeof entry.error === 'string');
	}
}
