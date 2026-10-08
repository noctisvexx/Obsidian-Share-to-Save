import { sha256 } from '@noble/hashes/sha2.js';

export function contentHash(bytes: Uint8Array): string {
	return Array.from(sha256(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
