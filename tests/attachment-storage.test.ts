import { it, expect, vi } from 'vitest';
import type { App } from 'obsidian';
import type { ShareToSaveSettings } from '../src/types';
import { attachmentPath } from '../src/attachment-storage';

it('delegates relative/default attachment locations to Obsidian with note context', async () => {
	const getAvailablePathForAttachment = vi.fn().mockResolvedValue('clips/media/image.png');
	const app = { fileManager: { getAvailablePathForAttachment } } as unknown as App;
	const path = await attachmentPath(app, { attachmentPolicy: 'obsidian' } as ShareToSaveSettings, 'image.png', 'clips/note.md');
	 expect(path).toBe('clips/media/image.png');
	 expect(getAvailablePathForAttachment).toHaveBeenCalledWith('image.png', 'clips/note.md');
});

it('keeps custom attachments in the Vault and avoids overwriting existing media', async () => {
	const exists = vi.fn(async (path: string) => path === 'media' || path === 'media/video.mp4');
	const app = { vault: { adapter: { exists }, createFolder: vi.fn() } } as unknown as App;
	const settings = { attachmentPolicy: 'custom', attachmentFolder: 'media' } as ShareToSaveSettings;
	expect(await attachmentPath(app, settings, 'video.mp4', 'clips/note.md')).toBe('media/video-1.mp4');
	await expect(attachmentPath(app, { ...settings, attachmentFolder: '../outside' }, 'image.png', 'clips/note.md')).rejects.toThrow();
});

it('rejects absolute folders and shared filenames containing path traversal', async () => {
	const app = {} as App;
	const settings = { attachmentPolicy: 'custom', attachmentFolder: 'C:/outside' } as ShareToSaveSettings;
	await expect(attachmentPath(app, settings, 'image.png', 'clips/note.md')).rejects.toThrow();
	await expect(attachmentPath(app, { ...settings, attachmentPolicy: 'obsidian' }, '../image.png', 'clips/note.md')).rejects.toThrow();
});
