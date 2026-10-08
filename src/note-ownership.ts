import { parseYaml } from 'obsidian';

export function noteOwner(content: string): string | undefined {
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
	if (!frontmatter?.[1]) return undefined;
	try {
		const value: unknown = parseYaml(frontmatter[1]);
		if (value && typeof value === 'object' && 'sts_id' in value && typeof value.sts_id === 'string') return value.sts_id;
	} catch { /* Invalid YAML never establishes ownership. */ }
	return undefined;
}
