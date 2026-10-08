import { parseYaml } from 'obsidian';
import type { Vault } from 'obsidian';

export async function findTaskNote(vault: Vault, id: string, folder: string): Promise<string | null> {
	if (!/^[\w-]{1,128}$/.test(id) || !folder || folder.startsWith('/') || /[\\:]/.test(folder)
		|| folder.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid task note location');
	const legacy = `${folder}/Clip-${id}.md`;
	if (await vault.adapter.exists(legacy)) {
		if (noteOwner(await vault.adapter.read(legacy)) !== id) throw new Error('Existing note path belongs to another note');
		return legacy;
	}
	if (!await vault.adapter.exists(folder)) return null;
	// Explicit task lookup, never task discovery or a startup scan.
	for (const path of (await vault.adapter.list(folder)).files) {
		if (!path.startsWith(folder + '/') || path.slice(folder.length + 1).includes('/') || !path.endsWith('.md')) continue;
		if (noteOwner(await vault.adapter.read(path)) === id) return path;
	}
	return null;
}

export function noteOwner(content: string): string | undefined {
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
	if (!frontmatter?.[1]) return undefined;
	try {
		const value: unknown = parseYaml(frontmatter[1]);
		if (value && typeof value === 'object' && 'sts_id' in value && typeof value.sts_id === 'string') return value.sts_id;
	} catch { /* Invalid YAML never establishes ownership. */ }
	return undefined;
}
