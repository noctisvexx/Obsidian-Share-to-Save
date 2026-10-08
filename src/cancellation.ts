export function checkCancelled(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error('Clipping cancelled');
}
