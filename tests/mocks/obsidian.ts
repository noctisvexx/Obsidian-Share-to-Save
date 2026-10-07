export function normalizePath(path: string): string { return path.replace(/\\/g, '/').replace(/\/+/g, '/'); }
export class Notice {}
export const Platform = { isMobile: false, isDesktop: true };
