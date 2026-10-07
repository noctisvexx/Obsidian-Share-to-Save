export function normalizePath(path: string): string { return path.replace(/\\/g, '/').replace(/\/+/g, '/'); }
export class Notice {}
export const Platform = { isMobile: false, isDesktop: true };
export async function requestUrl(_options: unknown): Promise<{status: number; text: string; arrayBuffer: ArrayBuffer; headers: Record<string, string>}> { throw new Error('Network mock not configured'); }
