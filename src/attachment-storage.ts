import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import type { ShareToSaveSettings } from './types';

export async function attachmentPath(app: App, settings: ShareToSaveSettings, filename: string, sourcePath: string): Promise<string> {
	if (settings.attachmentPolicy === 'obsidian')
		return app.fileManager.getAvailablePathForAttachment(filename, sourcePath);
	const folder = normalizePath(settings.attachmentFolder);
	if (!folder || folder.split('/').some(p => p === '..' || p === '.') || folder.startsWith('/'))
		throw new Error('Invalid attachment folder');
	if (!await app.vault.adapter.exists(folder)) await app.vault.createFolder(folder);
	const base = normalizePath(`${folder}/${filename}`);
	if (filename.startsWith('sts-') && /^sts-[a-f0-9]{64}\.[a-z0-9]+$/.test(filename)) return base;
	let path = base;
	let index = 1;
	while (await app.vault.adapter.exists(path)) {
		const dot = base.lastIndexOf('.');
		path = dot > base.lastIndexOf('/') ? `${base.slice(0, dot)}-${index++}${base.slice(dot)}` : `${base}-${index++}`;
	}
	return path;
}
