import { App, Modal, Setting, Platform } from 'obsidian';
import type { QueueManager } from './queue-manager';

export class TaskModal extends Modal {
	constructor(app: App, private queue: QueueManager, private process: () => Promise<void>,
		private getTarget: () => 'mobile' | 'desktop' = () => Platform.isMobile ? 'mobile' : 'desktop') { super(app); }
	onOpen(): void { void this.refresh(); }
	private async refresh(): Promise<void> {
		this.contentEl.empty();
		this.titleEl.setText('剪藏任务 / clipping tasks');
		const entries = await this.queue.getEntries();
		if (!entries.length) this.contentEl.createEl('p', { text: '暂无任务 / no tasks' });
		for (const entry of entries) {
			const labels = { pending: '待处理 / Pending', processing: '剪藏中 / Processing', failed: '失败 / Failed', completed: '已保存 / Saved' };
			const row = new Setting(this.contentEl).setName(entry.url).setDesc(`${labels[entry.status]}${entry.error ? ': ' + entry.error : ''}`);
			if (entry.status === 'failed' || entry.status === 'pending' || (entry.status === 'processing' && Date.parse(entry.leaseUntil || '') < Date.now()))
				row.addButton(button => button.setIcon('rotate-ccw').setTooltip('重试 / retry').onClick(async () => {
					await this.queue.retry(entry, this.getTarget()); await this.process(); await this.refresh();
				}));
		}
	}
}
