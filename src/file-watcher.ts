/**
 * 文件监听器：定时轮询队列目录，检测新条目后触发下载
 * File watcher: poll queue directory periodically, trigger download on new entries
 *
 * 轮询间隔通过 getter 函数动态获取，设置变更即时生效
 * Poll interval dynamically obtained via getter function, setting changes take immediate effect
 *
 * 仅在桌面端运行 / Desktop only
 */

import type { QueueManager } from './queue-manager';
import type { ProcessResult } from './types';
import type { Translator } from './i18n';
import { showNotice } from './notice-utils';

export class FileWatcher {
	private timerId: number | null = null;
	private isProcessing = false; // 防止并发处理 / Prevent concurrent processing
	private currentIntervalMs: number;
	private running = false;
	private stopped = false;
	private rerunRequested = false;
	private controller = new AbortController();

	/** 处理状态变化回调，用于驱动 UI 更新 / Callback for processing state change, drives UI updates */
	onProcessingChange: ((processing: boolean) => void) | null = null;

	constructor(
		private queueManager: QueueManager,
		private downloader: { processUrl(url: string, id: string, folder?: string, signal?: AbortSignal): Promise<ProcessResult> },
		private debugLog: (msg: string) => void,
		private getPollIntervalMs: () => number,  // 动态配置，零耦合 / Dynamic config, zero coupling
		private t: Translator,
		private target: 'mobile' | 'desktop' = 'desktop',
		private getFallback: () => boolean = () => true,
		private getEnabled: () => boolean = () => true,
	) {
		this.currentIntervalMs = getPollIntervalMs();
	}

	/**
	 * 启动定时轮询 / Start scheduled polling
	 */
	start(): void {
		if (this.running) return;
		this.running = true;
		this.stopped = false;
		if (this.controller.signal.aborted) this.controller = new AbortController();
		this.scheduleNext();
		this.debugLog(`FileWatcher 已启动，间隔 ${this.currentIntervalMs}ms / FileWatcher started, ${this.currentIntervalMs}ms interval`);
	}

	/**
	 * 停止轮询 / Stop polling
	 */
	stop(): void {
		this.running = false;
		this.stopped = true;
		this.controller.abort();
		this.onProcessingChange = null;
		if (this.timerId !== null) {
			window.clearTimeout(this.timerId);
			this.timerId = null;
		}
		this.debugLog('FileWatcher 已停止 / FileWatcher stopped');
	}

	/**
	 * 立即触发处理（跳过等待，仍检查并发）
	 * Immediately trigger processing (skip wait, still check concurrency)
	 */
	async processNow(): Promise<void> {
		if (this.stopped) return;
		if (this.isProcessing) {
			this.rerunRequested = true;
			this.debugLog('正在处理中，跳过本次触发 / Already processing, skipping');
			return;
		}
		// 取消当前定时器，处理后重新调度 / Cancel current timer, reschedule after processing
		if (this.timerId !== null) {
			window.clearTimeout(this.timerId);
			this.timerId = null;
		}
		await this.check();
		this.scheduleNext();
	}

	/**
	 * 调度下一次轮询 / Schedule next poll
	 */
	private scheduleNext(): void {
		if (!this.running) return;
		const interval = this.getPollIntervalMs();
		this.currentIntervalMs = interval;
		this.timerId = window.setTimeout(() => {
			this.timerId = null;
			void this.check().then(() => this.scheduleNext());
		}, interval);
	}

	/**
	 * 单轮检测 / Single check cycle
	 */
	private async check(): Promise<void> {
		if (this.isProcessing || this.stopped) return;
		if (!this.getEnabled()) return;
		this.isProcessing = true;

		try {
			const entries = await this.queueManager.getPendingEntries(this.target, this.target === 'desktop' && this.getFallback());
			if (entries.length === 0 || this.stopped) return;

			this.isProcessing = true;
			this.onProcessingChange?.(true);
			this.debugLog(`发现 ${entries.length} 条待处理 / Found ${entries.length} pending entries`);

			for (const entry of entries) {
				if (this.stopped || !this.getEnabled()) break;
				try {
					if (!await this.queueManager.claim(entry, this.target === 'desktop' && this.getFallback())) continue;
					let result: ProcessResult;
					try {
						result = this.stopped ? { success: false, error: 'Clipping cancelled' }
							: await this.downloader.processUrl(entry.url, entry.id, entry.noteFolder, this.controller.signal);
					} catch (error) {
						result = { success: false, error: error instanceof Error ? error.message : String(error) };
					}
					await this.queueManager.finish(entry, result.success ? undefined : result.error || 'Content extraction failed', result.warnings?.join('; '));
					if (!this.stopped) showNotice(result.success ? this.t('notice.savedTitle', { title: result.title ?? entry.url })
						+ (result.warnings?.length ? '\n部分附件未下载，笔记保留远程链接 / Some attachments remain remote' : '')
						: this.t('notice.downloadFailed', { error: result.error || 'Content extraction failed' }));
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					this.debugLog(`Task retained after claim/confirmation error: ${entry.url} - ${errMsg}`);
				}
			}
		} catch (err) {
			this.debugLog(`轮询检查异常 / Polling check error: ${String(err)}`);
		} finally {
			this.isProcessing = false;
			this.onProcessingChange?.(false);
			if (this.rerunRequested && !this.stopped) {
				this.rerunRequested = false;
				await this.check();
			}
		}
	}
}
