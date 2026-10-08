export function randomId(): string {
	if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
	if (globalThis.crypto?.getRandomValues) {
		return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
	}
	// These IDs identify tasks/devices; they are not authentication credentials.
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
