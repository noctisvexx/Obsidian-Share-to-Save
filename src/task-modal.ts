import { App, Modal, Setting } from 'obsidian';
import type { QueueManager } from './queue-manager';

export class TaskModal extends Modal {
	constructor(app: App, private queue: QueueManager, private process: () => Promise<void>) { super(app); }
	onOpen(): void { void this.refresh(); }
	private async refresh(): Promise<void> {
		this.contentEl.empty();
		this.titleEl.setText('剪藏任务 / Clipping tasks');
		const entries = await this.queue.getEntries();
		if (!entries.length) this.contentEl.createEl('p', { text: '暂无任务 / No tasks' });
		for (const entry of entries) {
			const row = new Setting(this.contentEl).setName(entry.url).setDesc(`${entry.status}${entry.error ? ': ' + entry.error : ''}`);
			if (entry.status === 'failed' || (entry.status === 'processing' && Date.parse(entry.leaseUntil || '') < Date.now()))
				row.addButton(button => button.setIcon('rotate-ccw').setTooltip('重试 / Retry').onClick(async () => {
					await this.queue.retry(entry); await this.process(); await this.refresh();
				}));
		}
	}
}
