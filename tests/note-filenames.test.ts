import { beforeEach, expect, it, vi } from 'vitest';
import { Platform } from 'obsidian';
import { Downloader } from '../src/downloader';
import { testVault } from './helpers/vault';
import type { ShareToSaveSettings, ParsedContent } from '../src/types';
import type { Translator } from '../src/i18n';

beforeEach(() => { Platform.isMobile = true; vi.stubGlobal('window', globalThis); });
function setup() {
	const storage = testVault();
	const pipeline = new Downloader(storage.vault, { outputFolder: 'clips' } as ShareToSaveSettings, ((key: string) => key) as Translator);
	return { ...storage, pipeline };
}
const parsed: ParsedContent = { title: 'Article', author: '', published: '', content: 'A complete article body kept unchanged across saves and retries.', imageUrls: [] };

it('names notes by title and keeps the stable task ID in YAML', async () => {
	const { pipeline, files } = setup();
	await pipeline.saveNote({ ...parsed, title: 'Article: part/one?' }, 'https://example.com', 'title-task', 'https://example.com');
	const notes = [...files.entries()].filter(([path]) => path.endsWith('.md'));
	expect(notes).toHaveLength(1);
	expect(notes[0]?.[0]).toBe('clips/Article partone.md');
	expect(notes[0]?.[1]).toContain('sts_id: "title-task"');
});

it('preserves foreign same-title notes and handles separate articles with the same title', async () => {
	const { pipeline, files } = setup();
	files.set('clips/Article.md', 'User note with an article URL');
	await pipeline.saveNote(parsed, 'https://example.com/a', 'task-a', 'https://example.com/a');
	await pipeline.saveNote(parsed, 'https://example.com/b', 'task-b', 'https://example.com/b');
	expect(files.get('clips/Article.md')).toBe('User note with an article URL');
	expect(files.has('clips/Article (task-a).md')).toBe(true);
	expect(files.has('clips/Article (task-b).md')).toBe(true);
});

it('finds a saved task by YAML on retry even when its extracted title changes or the user renames it', async () => {
	const { pipeline, files, create, vault } = setup();
	await pipeline.saveNote(parsed, 'https://example.com', 'retry-task', 'https://example.com');
	const old = files.get('clips/Article.md')!;
	files.delete('clips/Article.md'); files.set('clips/User renamed.md', old);
	const otherDevice = new Downloader(vault, { outputFolder: 'clips' } as ShareToSaveSettings, ((key: string) => key) as Translator);
	await otherDevice.saveNote({ ...parsed, title: 'Changed title' }, 'https://example.com', 'retry-task', 'https://example.com');
	expect(files.get('clips/User renamed.md')).toBe(old);
	expect(create).toHaveBeenCalledOnce();
	expect(files.has('clips/Changed title.md')).toBe(false);
});

it('recognizes legacy Clip-ID notes without renaming or making title duplicates', async () => {
	const { pipeline, files, create } = setup();
	const old = '---\nsts_id: legacy-task\n---\nOld clip and ![[media/old.png]]';
	files.set('clips/Clip-legacy-task.md', old);
	await pipeline.saveNote(parsed, 'https://example.com', 'legacy-task', 'https://example.com');
	expect(files.get('clips/Clip-legacy-task.md')).toBe(old);
	expect(create).not.toHaveBeenCalled();
});

it.each(['', '  ', '///'])('uses task filename only when no usable title was extracted (%s)', async title => {
	const { pipeline, files } = setup();
	await pipeline.saveNote({ ...parsed, title }, 'https://example.com', 'fallback-task', 'https://example.com');
	expect(files.has('clips/Clip-fallback-task.md')).toBe(true);
});

it('keeps a real Untitled title and respects Android filename byte limits on a collision', async () => {
	const { pipeline, files } = setup();
	await pipeline.saveNote({ ...parsed, title: 'Untitled' }, 'https://example.com', 'real-title', 'https://example.com');
	expect(files.has('clips/Untitled.md')).toBe(true);
	const title = '文'.repeat(60);
	files.set(`clips/${title}.md`, 'Existing foreign note');
	await pipeline.saveNote({ ...parsed, title }, 'https://example.com', 'a'.repeat(128), 'https://example.com');
	const collision = [...files.keys()].find(path => path.includes(' ('))!;
	expect(new TextEncoder().encode(collision.split('/').pop()).length).toBeLessThan(256);
});

it('makes concurrent saves of the same task idempotent', async () => {
	const { pipeline, files } = setup();
	const results = await Promise.all([pipeline.saveNote(parsed, 'https://example.com', 'race-task', 'https://example.com'),
		pipeline.saveNote(parsed, 'https://example.com', 'race-task', 'https://example.com')]);
	expect(results.every(result => result.success)).toBe(true);
	expect([...files.keys()].filter(path => path.endsWith('.md'))).toEqual(['clips/Article.md']);
});
