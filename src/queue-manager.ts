import type { Vault } from 'obsidian';
import type { QueueEntry, QueueEntryWithPath } from './types';

function validBase(value: unknown): value is Pick<QueueEntry, 'id' | 'url' | 'source' | 'createdAt'> {
	if (!value || typeof value !== 'object') return false;
	const e = value as QueueEntry;
	try {
		return /^[\w-]{1,128}$/.test(e.id) && ['http:', 'https:'].includes(new URL(e.url).protocol)
			&& ['mobile', 'desktop'].includes(e.source) && Number.isFinite(Date.parse(e.createdAt));
	} catch { return false; }
}

export class QueueManager {
	private readonly owner = crypto.randomUUID();
	constructor(private vault: Vault, private getQueueFolder: () => string,
		private getLegacyFolder: () => string = () => 'Share-to-Save') {}

	static buildEntry(url: string, source: QueueEntry['source']): QueueEntry {
		const now = new Date().toISOString();
		return { type: 'share-to-save', version: 1, id: crypto.randomUUID(), url, source,
			createdAt: now, updatedAt: now, status: 'pending' };
	}

	private folder(): string {
		const folder = this.getQueueFolder();
		if (!folder || folder.startsWith('/') || /[\\:\x00-\x1f]/.test(folder)
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

	async getPendingEntries(): Promise<QueueEntryWithPath[]> {
		return (await this.getEntries()).filter(e => e.status === 'pending');
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
				const entry = { ...QueueManager.buildEntry(legacy.url, legacy.source), id: legacy.id, createdAt: legacy.createdAt };
				await this.appendEntry(entry);
				const saved: unknown = JSON.parse(await this.vault.adapter.read(this.path(entry)));
				if (QueueManager.isQueueEntry(saved) && saved.id === entry.id && saved.url === entry.url)
					await this.vault.adapter.remove(path);
			} catch { /* Never remove legacy data without a verified destination. */ }
		}
	}

	async claim(entry: QueueEntryWithPath): Promise<boolean> {
		const current = JSON.parse(await this.vault.adapter.read(entry.filePath)) as QueueEntry;
		if (current.status !== 'pending') return false;
		await this.update(entry.filePath, { ...current, status: 'processing', owner: this.owner,
			leaseUntil: new Date(Date.now() + 10 * 60_000).toISOString() });
		return (JSON.parse(await this.vault.adapter.read(entry.filePath)) as QueueEntry).owner === this.owner;
	}

	private async update(path: string, entry: QueueEntry): Promise<void> {
		await this.vault.adapter.write(path, JSON.stringify({ ...entry, updatedAt: new Date().toISOString() }));
	}

	async finish(entry: QueueEntryWithPath, error?: string): Promise<void> {
		const current = JSON.parse(await this.vault.adapter.read(entry.filePath)) as QueueEntry;
		if (current.owner !== this.owner) throw new Error('Task ownership changed');
		await this.update(entry.filePath, { ...current, status: error ? 'failed' : 'completed', error, leaseUntil: undefined });
	}

	async retry(entry: QueueEntryWithPath): Promise<void> {
		const current = JSON.parse(await this.vault.adapter.read(entry.filePath)) as QueueEntry;
		if (!['failed', 'processing'].includes(current.status)) return;
		if (current.status === 'processing' && Date.parse(current.leaseUntil || '') > Date.now()) return;
		await this.update(entry.filePath, { ...current, status: 'pending', owner: undefined, error: undefined, leaseUntil: undefined });
	}

	static isQueueEntry(value: unknown): value is QueueEntry {
		if (!validBase(value)) return false;
		const entry = value as QueueEntry;
		return entry.type === 'share-to-save' && entry.version === 1
			&& ['pending', 'processing', 'failed', 'completed'].includes(entry.status)
			&& Number.isFinite(Date.parse(entry.updatedAt));
	}
}
