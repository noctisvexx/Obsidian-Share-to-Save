import type { Vault } from 'obsidian';
import type { QueueEntry, QueueEntryWithPath } from './types';

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
	private readonly owner = crypto.randomUUID();
	constructor(private vault: Vault, private getQueueFolder: () => string,
		private getLegacyFolder: () => string = () => 'Share-to-Save', private deviceId = '') {}

	static buildEntry(url: string, source: QueueEntry['source']): QueueEntry {
		const now = new Date().toISOString();
		return { type: 'share-to-save', version: 1, id: crypto.randomUUID(), url, source,
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

	async appendEntry(entry: QueueEntry): Promise<void> {
		if (!QueueManager.isQueueEntry(entry)) throw new Error('Invalid Share to Save task');
		const folder = this.folder();
		if (!await this.vault.adapter.exists(folder)) await this.vault.createFolder(folder);
		const path = this.path(entry);
		if (!await this.vault.adapter.exists(path)) await this.vault.create(path, JSON.stringify(entry));
		else {
			const existing: unknown = JSON.parse(await this.vault.adapter.read(path));
			if (!QueueManager.isQueueEntry(existing) || existing.url !== entry.url || existing.id !== entry.id)
				throw new Error('Task ID conflicts with existing data');
		}
	}

	async getEntries(): Promise<QueueEntryWithPath[]> {
		await this.migrateLegacy();
		const folder = this.folder();
		if (!await this.vault.adapter.exists(folder)) return [];
		const entries: QueueEntryWithPath[] = [];
		for (const path of (await this.vault.adapter.list(folder)).files.filter(p => p.endsWith('.json'))) {
			try {
				const entry: unknown = JSON.parse(await this.vault.adapter.read(path));
				if (QueueManager.isQueueEntry(entry)) entries.push({ ...entry, filePath: path });
			} catch { /* Partial sync files remain intact. */ }
		}
		return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
				const legacy: unknown = JSON.parse(await this.vault.adapter.read(path));
				if (!validBase(legacy)) continue;
				if ('type' in legacy || 'version' in legacy) continue;
				const entry = { ...QueueManager.buildEntry(legacy.url, legacy.source), id: legacy.id, createdAt: legacy.createdAt,
					target: 'desktop' as const, noteFolder: folder };
				await this.appendEntry(entry);
				const saved: unknown = JSON.parse(await this.vault.adapter.read(this.path(entry)));
				if (QueueManager.isQueueEntry(saved) && saved.id === entry.id && saved.url === entry.url)
					await this.vault.adapter.remove(path);
			} catch { /* Never remove legacy data without a verified destination. */ }
		}
	}

	async claim(entry: QueueEntryWithPath, fallback = false): Promise<boolean> {
		const current = JSON.parse(await this.vault.adapter.read(entry.filePath)) as QueueEntry;
		if (!QueueManager.isQueueEntry(current) || current.id !== entry.id) return false;
		if (current.status !== 'pending' && !(fallback && current.status === 'failed' && current.allowDesktopFallback)) return false;
		const lockPath = `${entry.filePath}.claim`;
		try { await this.vault.create(lockPath, JSON.stringify({ owner: this.owner, leaseUntil: new Date(Date.now() + 10 * 60_000).toISOString() })); }
		catch { return false; }
		await this.update(entry.filePath, { ...current, status: 'processing', owner: this.owner,
			target: fallback && current.status === 'failed' ? 'desktop' : current.target,
			leaseUntil: new Date(Date.now() + 10 * 60_000).toISOString() });
		return (JSON.parse(await this.vault.adapter.read(entry.filePath)) as QueueEntry).owner === this.owner;
	}

	private async update(path: string, entry: QueueEntry): Promise<void> {
		await this.vault.adapter.write(path, JSON.stringify({ ...entry, updatedAt: new Date().toISOString() }));
	}

	async finish(entry: QueueEntryWithPath, error?: string, warning?: string): Promise<void> {
		const current = JSON.parse(await this.vault.adapter.read(entry.filePath)) as QueueEntry;
		const lock = JSON.parse(await this.vault.adapter.read(`${entry.filePath}.claim`)) as { owner?: string };
		if (!QueueManager.isQueueEntry(current) || current.owner !== this.owner || lock.owner !== this.owner)
			throw new Error('Task ownership changed');
		await this.update(entry.filePath, { ...current, status: error ? 'failed' : 'completed', error: error || warning,
			allowDesktopFallback: error && current.target === 'mobile' ? current.allowDesktopFallback : false, leaseUntil: undefined });
		if (error) await this.vault.adapter.remove(`${entry.filePath}.claim`);
	}

	async retry(entry: QueueEntryWithPath, target?: 'mobile' | 'desktop'): Promise<void> {
		const current = JSON.parse(await this.vault.adapter.read(entry.filePath)) as QueueEntry;
		if (!['failed', 'processing', 'pending'].includes(current.status)) return;
		if (current.status === 'processing' && Date.parse(current.leaseUntil || '') > Date.now()) return;
		if (await this.vault.adapter.exists(`${entry.filePath}.claim`)) {
			const claim = JSON.parse(await this.vault.adapter.read(`${entry.filePath}.claim`)) as { leaseUntil?: string };
			if (Date.parse(claim.leaseUntil || '') > Date.now()) return;
			await this.vault.adapter.remove(`${entry.filePath}.claim`);
		}
		await this.update(entry.filePath, { ...current, status: 'pending', target: target || current.target,
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
