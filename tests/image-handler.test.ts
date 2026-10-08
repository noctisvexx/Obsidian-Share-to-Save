import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Platform, requestUrl } from 'obsidian';
import type { Vault } from 'obsidian';
import { ImageHandler } from '../src/image-handler';
import { contentHash } from '../src/content-hash';
vi.mock('obsidian', async importOriginal => ({ ...await importOriginal<object>(), requestUrl: vi.fn() }));
const network = requestUrl as unknown as Mock<(options: {url: string}) => Promise<unknown>>;
const bytes = new Uint8Array([1, 2, 3]);
const name = `sts-${contentHash(bytes)}.png`;
beforeEach(() => {
	Platform.isMobile = true; vi.stubGlobal('window', globalThis);
	network.mockReset(); network.mockResolvedValue({ status: 200, arrayBuffer: bytes.buffer, headers: { 'content-type': 'image/png' } });
});
afterEach(() => vi.unstubAllGlobals());

function setup(dir: string, numbered = false) {
	const files = new Map<string, ArrayBuffer>();
	const createFolder = vi.fn();
	const createBinary = vi.fn(async (path: string, content: ArrayBuffer) => {
		if (files.has(path)) throw Error('file exists'); files.set(path, content); return {} as never;
	});
	const vault = { adapter: { exists: async (path: string) => files.has(path) || path === dir, readBinary: async (path: string) => files.get(path) }, createFolder, createBinary } as unknown as Vault;
	const path = (filename: string) => dir ? `${dir}/${filename}` : filename;
	const handler = new ImageHandler(vault, () => 'clips', async filename => {
		const original = path(filename);
		return numbered && files.has(original) ? original.replace('.png', ' 2.png') : original;
	});
	return { handler, files, createFolder, createBinary, path };
}

it.each(['', 'media', 'clips/attachments'])('stores and links repeated content once in "%s"', async dir => {
	const { handler, files, createBinary, createFolder, path } = setup(dir, true);
	const markdown = '![](https://example.com/a.png)\n![again](https://example.com/a.png)\n![](https://example.com/b.png)';
	const expected = `![[${path(name)}]]`;
	const first = await handler.processContent(markdown, 'Title', 'https://example.com', 'clips/note.md');
	expect(first.split(expected)).toHaveLength(4);
	expect(network).toHaveBeenCalledTimes(2);
	await handler.processContent(markdown, 'Other title', 'https://example.com', 'clips/other.md');
	expect(createBinary).toHaveBeenCalledOnce(); expect(files.size).toBe(1);
	if (!dir) expect(createFolder).not.toHaveBeenCalled();
});

it('preserves a foreign hash-name collision and reuses the safe suffixed attachment', async () => {
	const { handler, files, path, createBinary } = setup('media', true);
	const foreign = new Uint8Array([9, 8, 7]).buffer;
	files.set(path(name), foreign);
	const markdown = '![](https://example.com/a.png)';
	const first = await handler.processContent(markdown, 'Title');
	const second = await handler.processContent(markdown, 'Title');
	expect(first).toContain('-1.png'); expect(second).toBe(first);
	expect(files.get(path(name))).toBe(foreign); expect(createBinary).toHaveBeenCalledOnce();
});

it('preserves pre-existing local embeds and downloads nothing for them', async () => {
	const { handler, createBinary } = setup('media');
	const markdown = '![[old/photo.png]]\n![local](../attachments/image.png)';
	expect(await handler.processContent(markdown, 'Title')).toBe(markdown);
	expect(network).not.toHaveBeenCalled(); expect(createBinary).not.toHaveBeenCalled();
});

it('hashes without Node Buffer or WebCrypto subtle', async () => {
	const { handler, createBinary } = setup('media');
	vi.stubGlobal('crypto', {});
	const markdown = await handler.processContent('![](https://example.com/a.png)', 'Title');
	expect(markdown).toContain(name); expect(createBinary).toHaveBeenCalledOnce();
});

it('keeps the filename extension when HTTP content-type is absent', async () => {
	const { handler } = setup('media');
	network.mockResolvedValue({ status: 200, arrayBuffer: bytes.buffer, headers: {} });
	expect(await handler.processContent('![](https://example.com/a.png)', 'Title')).toContain('.png]]');
});
