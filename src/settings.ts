/**
 * 插件设置 / Plugin settings
 */

import { PluginSettingTab, Setting, App, setIcon, Platform } from 'obsidian';
import { showNotice } from './notice-utils';
import type ShareToSavePlugin from './main';
import type { ShareToSaveSettings, PollIntervalUnit, TimestampFormat } from './types';
import type { Translator } from './i18n';
import { validateFolderPath } from './text-utils';

/** 默认设置 / Default settings */
export const DEFAULT_SETTINGS: ShareToSaveSettings = {
	outputFolder: 'Share-to-Save',
	queueFolder: '_ShareToSave/queue',
	attachmentPolicy: 'obsidian',
	attachmentFolder: '_ShareToSave/attachments',
	mobileFirst: true,
	desktopFallback: true,
	deviceId: '',
	pollIntervalValue: 30,
	pollIntervalUnit: 'seconds',
	timestampFormat: 'h1',
	timestampEnabled: true,
};

export class ShareToSaveSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: ShareToSavePlugin,
		private t: Translator,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		for (const [key, label] of [['mobileFirst', '手机优先剪藏 / Clip on mobile first'], ['desktopFallback', '桌面自动兜底 / Desktop fallback']] as const) {
			new Setting(containerEl).setName(label).addToggle(toggle => toggle.setValue(this.plugin.settings[key]).onChange(async value => {
				this.plugin.settings[key] = value; await this.plugin.saveSettings();
			}));
		}
		for (const [key, label] of [['queueFolder', '任务保存目录 / Task folder'], ['attachmentFolder', '自定义附件目录 / Custom attachment folder']] as const) {
			new Setting(containerEl).setName(label).addText(text => text.setValue(this.plugin.settings[key]).onChange(async value => {
				if (validateFolderPath(value) || value.split('/').some(p => p === '..' || p === '.')) return;
				if (key === 'queueFolder' && (value === this.plugin.settings.outputFolder || value.startsWith(this.plugin.settings.outputFolder + '/'))) return;
				if (key === 'queueFolder') {
					if (!await this.plugin.changeQueueFolder(value.trim())) text.setValue(this.plugin.settings.queueFolder);
					return;
				}
				this.plugin.settings[key] = value.trim(); await this.plugin.saveSettings();
			}));
		}
		new Setting(containerEl).setName('附件保存位置 / Attachment location').addDropdown(dropdown => dropdown
			.addOption('obsidian', '遵循 Obsidian / Obsidian default').addOption('custom', '自定义目录 / Custom folder')
			.setValue(this.plugin.settings.attachmentPolicy).onChange(async value => {
				this.plugin.settings.attachmentPolicy = value as 'obsidian' | 'custom'; await this.plugin.saveSettings();
			}));
		new Setting(containerEl).setName('剪藏任务 / Clipping tasks').addButton(button => button.setIcon('list').setTooltip('查看 / View').onClick(() => this.plugin.showTasks()));

		// ── 页面标题 / Page title ──
		new Setting(containerEl)
			.setName(this.t('settings.title'))
			.setHeading();

// ── 使用说明 / Usage Instructions ──
		const usageBox = containerEl.createDiv({ cls: 'sts-usage-box' });

		const usageHeading = usageBox.createDiv({ cls: 'sts-usage-heading' });
		usageHeading.setText(this.t('settings.usage.heading'));

		const descEl = usageBox.createDiv({ cls: 'setting-item-description' });
		// 链接文本 / Link text
		const linkText = 'Fast Note Sync';
		const linkHref = 'https://github.com/haierkeys/obsidian-fast-note-sync';
		const content = this.t('settings.usage.content', { link: linkText });
		const linkIdx = content.indexOf(linkText);
		if (linkIdx >= 0) {
			descEl.createSpan({ text: content.slice(0, linkIdx) });
			descEl.createEl('a', { href: linkHref, text: linkText });
			descEl.createSpan({ text: content.slice(linkIdx + linkText.length) });
		} else {
			descEl.setText(content);
		}

// ── 保存文件夹 / Output folder ──
		new Setting(containerEl)
			.setName(this.t('settings.folder.name'))
			.setDesc(this.t('settings.folder.desc'))
			.addText(text =>
				text
					.setPlaceholder('Share-to-Save')
					.setValue(this.plugin.settings.outputFolder)
					.onChange(async (value) => {
						const errorKey = validateFolderPath(value);
						if (errorKey) {
							showNotice(this.t(errorKey));
							return;
						}
						const trimmed = value.trim();
						if (this.plugin.settings.queueFolder === trimmed || this.plugin.settings.queueFolder.startsWith(trimmed + '/')) return;
						this.plugin.settings.outputFolder = trimmed;
						await this.plugin.saveSettings();
					})
			);

// ── 轮询间隔（仅桌面端）/ Polling interval (desktop only) ──
	if (Platform.isDesktop) {
		new Setting(containerEl)
			.setName(this.t('settings.pollInterval.name'))
			.setDesc(this.t('settings.pollInterval.desc'))
			.addText(text =>
				text
					.setPlaceholder('30')
					.setValue(String(this.plugin.settings.pollIntervalValue))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (num >= 1 && num <= 60) {
							this.plugin.settings.pollIntervalValue = num;
							await this.plugin.saveSettings();
						}
					})
			)
			.addDropdown(dropdown =>
				dropdown
					.addOption('seconds', this.t('settings.pollInterval.seconds'))
					.addOption('minutes', this.t('settings.pollInterval.minutes'))
					.addOption('hours', this.t('settings.pollInterval.hours'))
					.setValue(this.plugin.settings.pollIntervalUnit)
					.onChange(async (value) => {
						this.plugin.settings.pollIntervalUnit = value as PollIntervalUnit;
						await this.plugin.saveSettings();
					})
			);
		}

	// ── 时间戳格式 / Timestamp format ──
		new Setting(containerEl)
			.setName(this.t('settings.timestampFormat.name'))
			.setDesc(this.t('settings.timestampFormat.desc'))
			.addDropdown(dropdown =>
				dropdown
					.addOption('h1', this.t('settings.timestampFormat.h1'))
					.addOption('h2', this.t('settings.timestampFormat.h2'))
					.addOption('h3', this.t('settings.timestampFormat.h3'))
					.addOption('body', this.t('settings.timestampFormat.body'))
					.setValue(this.plugin.settings.timestampFormat)
					.onChange(async (value) => {
						this.plugin.settings.timestampFormat = value as TimestampFormat;
						await this.plugin.saveSettings();
					})
			);

	// ── 添加桌面快捷方式 / Add to Home Screen ──
		const shortcutBox = containerEl.createDiv({ cls: 'sts-shortcut-box' });

		// 大标题 / Main heading
		const headingEl = shortcutBox.createDiv({ cls: 'sts-shortcut-heading' });
		headingEl.setText(this.t('settings.shortcut.heading'));

		// ── iOS ──
		const iosSection = shortcutBox.createDiv({ cls: 'sts-shortcut-section' });
		const iosHeading = iosSection.createDiv({ cls: 'sts-shortcut-subheading' });
		iosHeading.setText(this.t('settings.shortcut.ios.heading'));
		const iosDesc = iosSection.createDiv({ cls: 'setting-item-description' });
		iosDesc.setText(this.t('settings.shortcut.ios.desc'));
		const iosRow = iosSection.createDiv({ cls: 'sts-shortcut-row' });
		iosRow.createSpan({ cls: 'sts-shortcut-label', text: this.t('settings.shortcut.ios.uriLabel') });
		iosRow.createSpan({ cls: 'sts-shortcut-value', text: 'obsidian://share-to-save' });
		const iosCopyBtn = iosRow.createSpan({ cls: 'sts-shortcut-copy-btn' });
		setIcon(iosCopyBtn, 'clipboard-copy');
		iosCopyBtn.setAttribute('aria-label', this.t('settings.shortcut.copy'));
		iosCopyBtn.addEventListener('click', () => {
			void navigator.clipboard.writeText('obsidian://share-to-save').then(() => {
				showNotice(this.t('settings.shortcut.copied'));
			});
		});

		// ── Android ──
		const androidSection = shortcutBox.createDiv({ cls: 'sts-shortcut-section' });
		const androidHeading = androidSection.createDiv({ cls: 'sts-shortcut-subheading' });
		androidHeading.setText(this.t('settings.shortcut.android.heading'));
		const androidDesc = androidSection.createDiv({ cls: 'setting-item-description' });
		const shortcutLinkText = 'Shortcut Maker';
		const shortcutLinkHref = 'https://play.google.com/store/apps/details?id=rk.android.app.shortcutmaker';
		const androidDescContent = this.t('settings.shortcut.android.desc', { link: shortcutLinkText });
		const androidDescLinkIdx = androidDescContent.indexOf(shortcutLinkText);
		if (androidDescLinkIdx >= 0) {
			androidDesc.createSpan({ text: androidDescContent.slice(0, androidDescLinkIdx) });
			androidDesc.createEl('a', { href: shortcutLinkHref, text: shortcutLinkText });
			androidDesc.createSpan({ text: androidDescContent.slice(androidDescLinkIdx + shortcutLinkText.length) });
		} else {
			androidDesc.setText(androidDescContent);
		}
		const shortcutFields = [
			{ labelKey: 'settings.shortcut.action', value: 'android.intent.action.VIEW' },
			// eslint-disable-next-line obsidianmd/hardcoded-config-path -- Android package identifier, not a Vault path.
			{ labelKey: 'settings.shortcut.package', value: 'md.obsidian' },
			// eslint-disable-next-line obsidianmd/hardcoded-config-path -- Android activity identifier, not a Vault path.
			{ labelKey: 'settings.shortcut.class', value: 'md.obsidian.MainActivity' },
			{ labelKey: 'settings.shortcut.data', value: 'obsidian://share-to-save' },
		];
		for (const field of shortcutFields) {
			const row = androidSection.createDiv({ cls: 'sts-shortcut-row' });
			row.createSpan({ cls: 'sts-shortcut-label', text: this.t(field.labelKey) });
			row.createSpan({ cls: 'sts-shortcut-value', text: field.value });
			const copyBtn = row.createSpan({ cls: 'sts-shortcut-copy-btn' });
			setIcon(copyBtn, 'clipboard-copy');
			copyBtn.setAttribute('aria-label', this.t('settings.shortcut.copy'));
			copyBtn.addEventListener('click', () => {
				void navigator.clipboard.writeText(field.value).then(() => {
					showNotice(this.t('settings.shortcut.copied'));
				});
			});
		}
	}

}
