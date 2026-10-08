import { it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { Vault } from 'obsidian';
import { TextSaver } from '../src/text-saver';
import type { ShareToSaveSettings } from '../src/types';
function memoFile(): TFile { const file = new TFile(); file.path = 'clips/Sts-memos.md'; return file; }

it.each(['Existing plain note', '---\nsource: https://example.com\n---\nWeb Clipper article'])('refuses to modify a foreign memo-name collision', async content => {
	const process = vi.fn();
	const create = vi.fn();
	const vault = { adapter: { exists: async () => true, read: async () => content }, process, create } as unknown as Vault;
	await expect(new TextSaver(vault, { outputFolder: 'clips' } as ShareToSaveSettings).save('new text', false)).rejects.toThrow('another note');
	expect(process).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
});

it('rechecks memo ownership inside the atomic edit callback', async () => {
	const foreign = 'Another plugin replaced the file';
	const process = vi.fn((_file: unknown, fn: (text: string) => string) => fn(foreign));
	const vault = { adapter: { exists: async () => true, read: async () => '---\nsts_id: text\n---\nOwn memo' },
		getAbstractFileByPath: memoFile, process } as unknown as Vault;
	await expect(new TextSaver(vault, { outputFolder: 'clips' } as ShareToSaveSettings).save('new text', false)).rejects.toThrow('ownership');
});

it('continues to append to its own memo without changing existing text', async () => {
	let content = '---\nsts_id: text\n---\nExisting own memo';
	const vault = { adapter: { exists: async () => true, read: async () => content }, getAbstractFileByPath: memoFile,
		process: (_file: unknown, fn: (text: string) => string) => { content = fn(content); } } as unknown as Vault;
	await new TextSaver(vault, { outputFolder: 'clips' } as ShareToSaveSettings).save('new text', false);
	expect(content).toContain('new text'); expect(content).toContain('Existing own memo');
});
