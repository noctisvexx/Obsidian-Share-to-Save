import { vi } from 'vitest';
import type { Vault } from 'obsidian';

export function testVault() {
	const files = new Map<string, string | ArrayBuffer>();
	const folders = new Set(['', 'clips', 'media']);
	const createFolder = vi.fn(async (folder: string) => {
		if (!folder) throw Error('Cannot create Vault root');
		folders.add(folder); return {} as never;
	});
	const create = vi.fn(async (path: string, content: string) => {
		if (files.has(path)) throw Error('Already exists'); files.set(path, content); return {} as never;
	});
	const createBinary = vi.fn(async (path: string, content: ArrayBuffer) => {
		if (files.has(path)) throw Error('Already exists'); files.set(path, content); return {} as never;
	});
	const adapter = {
		exists: async (p: string) => folders.has(p) || files.has(p),
		list: vi.fn(async (folder: string) => ({ files: [...files.keys()].filter(path => path.slice(0, path.lastIndexOf('/')) === folder), folders: [] })),
		read: async (path: string) => { const content = files.get(path); if (typeof content !== 'string') throw Error('Not text'); return content; },
		readBinary: async (path: string) => { const content = files.get(path); if (!(content instanceof ArrayBuffer)) throw Error('Not binary'); return content; },
		write: vi.fn(async (path: string, content: string) => { files.set(path, content); }),
		remove: vi.fn(async (path: string) => { files.delete(path); }),
	};
	const getMarkdownFiles = vi.fn(() => { throw Error('Full-Vault scan forbidden'); });
	return { files, adapter, create, createBinary, createFolder,
		vault: { adapter, create, createBinary, createFolder, getMarkdownFiles } as unknown as Vault };
}
