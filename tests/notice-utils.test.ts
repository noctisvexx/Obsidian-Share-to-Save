import { afterEach, expect, it, vi } from 'vitest';
import { Platform } from 'obsidian';
import { clearMobileNotice, showNotice } from '../src/notice-utils';

afterEach(() => { clearMobileNotice(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('clears mobile notification timers on replacement and unload', () => {
	vi.useFakeTimers();
	Platform.isMobile = true;
	vi.stubGlobal('window', globalThis);
	const remove = vi.fn();
	vi.stubGlobal('activeDocument', {
		querySelector: () => null,
		body: { createDiv: () => ({ remove, className: '', textContent: '' }) },
	});
	showNotice('first');
	expect(vi.getTimerCount()).toBe(1);
	showNotice('second');
	expect(remove).toHaveBeenCalledTimes(1);
	expect(vi.getTimerCount()).toBe(1);
	clearMobileNotice();
	expect(remove).toHaveBeenCalledTimes(2);
	expect(vi.getTimerCount()).toBe(0);
});
