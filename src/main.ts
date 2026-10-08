/**
 * Share to Save 插件主入口
 * Share to Save plugin main entry
 *
 * 手机端：接收分享 URL，写入 toBeSaved_*.json 队列文件
 * 电脑端：轮询队列目录，下载内容并保存为 .md
 *
 * Mobile: receive shared URLs, write toBeSaved_*.json queue files
 * Desktop: poll queue directory, download content and save as .md
 */

import { Plugin, Platform, getLanguage } from 'obsidian';
import type { ShareToSaveSettings } from './types';
import { DEFAULT_SETTINGS, ShareToSaveSettingTab } from './settings';
import { detectLocale, createTranslator } from './i18n';
import type { Translator } from './i18n';
import { extractUrl, extractUrls } from './url-extractor';
import { QueueManager } from './queue-manager';
import type { Downloader } from './downloader';
import { FileWatcher } from './file-watcher';
import { ShareMenuInjector } from './share-menu-injector';
import { ImageShareMenuInjector } from './image-share-injector';
import { InputModal } from './input-modal';
import { TextSaver } from './text-saver';
import { showNotice, clearMobileNotice } from './notice-utils';
import { attachmentPath } from './attachment-storage';
import { TaskModal } from './task-modal';
import type { ProcessResult } from './types';
import { checkCancelled } from './cancellation';
import { randomId } from './random-id';
import { validateFolderPath } from './text-utils';

export default class ShareToSavePlugin extends Plugin {
	settings!: ShareToSaveSettings;
	private t!: Translator;
	private queueManager!: QueueManager;
	private processor?: Promise<{ processUrl(url: string, id: string, folder?: string, signal?: AbortSignal): Promise<ProcessResult> }>;
	private fileWatcher!: FileWatcher;
	private shareMenuInjector!: ShareMenuInjector;
	private imageShareInjector!: ImageShareMenuInjector;
	private ribbonIconEl!: HTMLElement;
	private textSaver!: TextSaver;
	private isInputModalOpen = false;
	private unloaded = false;

	async onload(): Promise<void> {
		this.unloaded = false;
		// ── 加载设置 / Load settings ──
		await this.loadSettings();
		if (this.unloaded) return;

		// ── 初始化 i18n / Initialize i18n ──
		const locale = detectLocale(getLanguage());
		this.t = createTranslator(locale);

		// ── 初始化队列管理器 / Initialize queue manager ──
		this.queueManager = new QueueManager(
			this.app.vault,
			() => this.settings.queueFolder,
			() => this.settings.outputFolder,
			this.settings.deviceId,
		);

		// ── 初始化文字保存器 / Initialize text saver ──
		this.textSaver = new TextSaver(this.app.vault, this.settings);

		// ── 初始化分享菜单注入器（移动端）/ Initialize share menu injector (mobile) ──
		this.shareMenuInjector = new ShareMenuInjector(
			(text) => this.handleTextSave(text, this.settings.timestampEnabled),
			(url) => this.handleSharedUrl(url),
			this.t,
		);

		if (Platform.isMobile) {
			this.shareMenuInjector.start();
		}

		// ── 初始化图片分享菜单注入器（移动端）/ Initialize image share menu injector (mobile) ──
		this.imageShareInjector = new ImageShareMenuInjector(
			this.app,
			() => this.settings.outputFolder,
			this.t,
			(filename, sourcePath) => attachmentPath(this.app, this.settings, filename, sourcePath),
		);
		if (Platform.isMobile) {
			this.imageShareInjector.start();
		}

		// ── 初始化下载器和文件监听器（桌面端）/ Initialize downloader & watcher (desktop) ──
		{
			this.fileWatcher = new FileWatcher(
				this.queueManager,
				{ processUrl: async (url, id, folder, signal) => {
					checkCancelled(signal);
					const processor = await this.getProcessor();
					checkCancelled(signal);
					return processor.processUrl(url, id, folder, signal);
				} },
				(msg) => {
					console.debug(`Share to Save: ${msg}`);
				},
				() => this.getPollIntervalMs(),
				this.t,
				Platform.isMobile ? 'mobile' : 'desktop',
				() => this.settings.desktopFallback,
				() => Platform.isDesktop || this.settings.mobileFirst,
			);
			if (Platform.isDesktop) this.fileWatcher.start();
			this.fileWatcher.onProcessingChange = (processing) => {
				this.ribbonIconEl?.classList.toggle('sts-processing', processing);
			};
		}

		// ── Ribbon 按钮（全平台）/ Ribbon button (all platforms) ──
		this.ribbonIconEl = this.addRibbonIcon('cloud-download', this.t('ribbon.tooltip'), async () => {
			await this.openInputModal();
		});

		// ── 命令（全平台）/ Command (all platforms) ──
		this.addCommand({
			id: 'save-url',
			name: this.t('ribbon.tooltip'),
			callback: async () => {
				await this.openInputModal();
			},
		});

		// ── 自定义 URI 协议处理 / Custom URI protocol handler ──
		// 支持 obsidian://share-to-save 快速唤起 URL 输入框（Android 桌面快捷方式等）
		// Supports obsidian://share-to-save to quickly open the URL input modal (Android shortcuts, etc.)
		this.registerObsidianProtocolHandler('share-to-save', async (params) => {
			if (params.url || params.text) await this.handleUrlInput(params.url || params.text || '');
			else await this.openInputModal();
		});
		this.addCommand({ id: 'view-tasks', name: '查看剪藏任务 / view clipping tasks', callback: () => this.showTasks() });

		// ── 设置页 / Settings tab ──
		this.addSettingTab(new ShareToSaveSettingTab(this.app, this, this.t));
	}

	onunload(): void {
		this.unloaded = true;
		this.shareMenuInjector?.stop();
		this.imageShareInjector?.stop();
		this.fileWatcher?.stop();
		clearMobileNotice();
		// 清理残留的移动端 toast / Clean up lingering mobile toast
		activeDocument.querySelector('.sts-mobile-toast')?.remove();
	}

	// ─── 核心方法 / Core methods ────────────────────────────────────────────

	/**
	 * 统一的 URL 处理入口（来自分享菜单或直接输入）
	 * Unified URL handling entry point (from share menu or direct input)
	 *
	 * 处理流程 / Flow:
	 *   提取 URL → 写入队列 → 桌面端立即触发处理 / extract URL → write queue → trigger desktop processing
	 */
	private async handleSharedUrl(text: string): Promise<void> {
		const url = extractUrl(text);
		if (!url) {
			showNotice(this.t('notice.noUrl'));
			return;
		}

		await this.enqueueUrl(url);

		// 桌面端立即触发处理 / Desktop: trigger immediate processing
		if (Platform.isDesktop || this.settings.mobileFirst) {
			await this.fileWatcher?.processNow();
		}

		showNotice('任务已接收，可在剪藏任务中查看结果 / Task received; see clipping tasks');
	}

	/**
	 * 保存文字到 Sts-memos.md（非 URL，不进入下载队列）
	 * Save text to Sts-memos.md (non-URL, bypasses download queue)
	 */
	private async handleTextSave(text: string, addTimestamp: boolean): Promise<void> {
		try {
			await this.textSaver.save(text, addTimestamp);
			showNotice(this.t('notice.textSaved'));
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			console.error('Share to Save: 保存文字失败 / Text save failed:', errMsg);
			showNotice(this.t('notice.downloadFailed', { error: errMsg }), 5000);
		}
	}

	/**
	 * 处理 InputModal 的提交（支持多 URL，逐一入队后立即处理）
	 * Handle submission from InputModal (supports multiple URLs, enqueue then process)
	 *
	 * @param text 用户输入的文本 / User input text
	 */
	private async handleUrlInput(text: string): Promise<void> {
		try {
			const urls = extractUrls(text);
			if (urls.length === 0) {
				showNotice(this.t('notice.noUrl'));
				return;
			}

			// 统一入队 / Enqueue all URLs
			for (const url of urls) {
				await this.enqueueUrl(url);
			}

			// 数量通知 / Count notification
			showNotice(`已接收 ${urls.length} 个剪藏任务 / ${urls.length} clipping task(s) received`);

			// 立即处理（桌面端）/ Process immediately (desktop)
			if (Platform.isDesktop || this.settings.mobileFirst) {
				await this.fileWatcher?.processNow();
			}
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			console.error('Share to Save: URL 处理失败 / URL processing failed:', errMsg);
			showNotice(this.t('notice.downloadFailed', { error: errMsg }), 5000);
		}
	}

	/**
	 * 打开 输入模态框 / Open input modal
	 *
	 * 桌面端存在 pending 条目时预填 URL，点击"保存网页"直接触发处理
	 * On desktop, pre-fill pending URLs and trigger processing directly on submit
	 */
	private async openInputModal(): Promise<void> {
		// 防重入守卫：如果已有输入框打开则跳过 / Re-entry guard: skip if modal already open
		// 先置 true 避免 await 期间的竞态 / Set true first to prevent race during await
		if (this.isInputModalOpen) return;
		this.isInputModalOpen = true;

		// 无 pending 条目时使用原有流程（提取 URL → 入队 → 处理）
		// Use existing flow when no pending entries (extract URL → enqueue → process)
		new InputModal(
			this.app, this.t,
			(text, addTimestamp) => this.handleTextSave(text, addTimestamp),
			(text) => this.handleUrlInput(text),
			'',
			() => { this.isInputModalOpen = false; },
			this.settings.timestampEnabled,
			async (enabled) => {
				this.settings.timestampEnabled = enabled;
				await this.saveSettings();
			},
		).open();
	}

	// ─── 设置管理 / Settings management ────────────────────────────────────

	/** 计算轮询间隔（毫秒）/ Calculate poll interval in milliseconds */
	private getPollIntervalMs(): number {
		const { pollIntervalValue, pollIntervalUnit } = this.settings;
		switch (pollIntervalUnit) {
			case 'seconds': return pollIntervalValue * 1000;
			case 'minutes': return pollIntervalValue * 60_000;
			case 'hours': return pollIntervalValue * 3_600_000;
			default: return 30_000;
		}
	}

	async loadSettings(): Promise<void> {
		const stored: unknown = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored && typeof stored === 'object' ? stored : {});
		for (const key of ['outputFolder', 'queueFolder', 'attachmentFolder'] as const) {
			const value: unknown = this.settings[key];
			if (typeof value !== 'string' || validateFolderPath(value) || value.split('/').some(p => p === '.' || p === '..'))
				this.settings[key] = DEFAULT_SETTINGS[key];
		}
		for (const key of ['mobileFirst', 'desktopFallback'] as const)
			if (typeof this.settings[key] !== 'boolean') this.settings[key] = DEFAULT_SETTINGS[key];
		// Device identity stays local; only queue tasks participate in Vault sync.
		const deviceId: unknown = this.app.loadLocalStorage('share-to-save-device');
		this.settings.deviceId = typeof deviceId === 'string' && deviceId ? deviceId : randomId();
		if (deviceId !== this.settings.deviceId) this.app.saveLocalStorage('share-to-save-device', this.settings.deviceId);
		if (this.settings.queueFolder === this.settings.outputFolder || this.settings.queueFolder.startsWith(this.settings.outputFolder + '/'))
			this.settings.queueFolder = DEFAULT_SETTINGS.queueFolder;
		let index = 1;
		while (this.settings.queueFolder === this.settings.outputFolder || this.settings.queueFolder.startsWith(this.settings.outputFolder + '/'))
			this.settings.queueFolder = `_ShareToSaveQueue${index++}/queue`;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	showTasks(): void {
		new TaskModal(this.app, this.queueManager, () => this.fileWatcher?.processNow() ?? Promise.resolve(),
			() => Platform.isMobile && this.settings.mobileFirst ? 'mobile' : 'desktop').open();
	}

	private async enqueueUrl(url: string): Promise<void> {
		const entry = QueueManager.buildEntry(url, Platform.isDesktop ? 'desktop' : 'mobile');
		entry.target = Platform.isMobile && this.settings.mobileFirst ? 'mobile' : 'desktop';
		entry.originDevice = this.settings.deviceId;
		entry.allowDesktopFallback = this.settings.desktopFallback;
		entry.noteFolder = this.settings.outputFolder;
		await this.queueManager.enqueue(entry);
	}

	private async getProcessor(): Promise<{ processUrl(url: string, id: string, folder?: string, signal?: AbortSignal): Promise<ProcessResult> }> {
		if (!this.processor) this.processor = (async () => {
			const { Downloader } = await import('./downloader');
			if (this.unloaded) throw new Error('Clipping cancelled');
			const pipeline: Downloader = new Downloader(this.app.vault, this.settings, this.t,
				(filename, sourcePath) => attachmentPath(this.app, this.settings, filename, sourcePath));
			if (!Platform.isMobile) return pipeline;
			const { MobileClipper } = await import('./mobile-clipper');
			return new MobileClipper(pipeline);
		})().catch((error: unknown) => { this.processor = undefined; throw error; });
		return this.processor;
	}

	async changeQueueFolder(value: string): Promise<boolean> {
		if (value === this.settings.queueFolder) return true;
		const folder = this.settings.queueFolder;
		if (await this.app.vault.adapter.exists(folder) && (await this.app.vault.adapter.list(folder)).files.length > 0) {
			showNotice('已有剪藏任务，暂不能切换任务目录 / Existing tasks must stay accessible');
			return false;
		}
		this.settings.queueFolder = value;
		await this.saveSettings();
		return true;
	}
}
