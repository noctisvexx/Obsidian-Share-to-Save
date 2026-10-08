import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createTranslator } from '../src/i18n';

it('uses noctis branding without changing the existing installation identity', () => {
	const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as Record<string, unknown>;
	expect(manifest.name).toBe('noctis'); expect(manifest.author).toBe('noctis');
	expect(manifest.id).toBe('share-to-save'); expect(manifest.isDesktopOnly).toBe(false);
	for (const locale of ['zh', 'en'] as const) {
		const t = createTranslator(locale);
		expect(t('ribbon.tooltip')).toContain('noctis'); expect(t('settings.title')).toContain('noctis');
	}
});
it('retains upstream MIT attribution alongside modification attribution', () => {
	const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8');
	expect(license).toContain('Copyright (c) 2025 chenxiccc');
	expect(license).toContain('Copyright (c) 2026 noctis (modifications)');
	expect(license).toContain('Permission is hereby granted');
});
