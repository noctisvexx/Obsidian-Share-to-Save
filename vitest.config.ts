import { defineConfig } from 'vitest/config';
// eslint-disable-next-line import/no-nodejs-modules -- The test runner executes in Node, not in Obsidian.
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      // Mock obsidian API for tests / Mock obsidian API 用于测试
      obsidian: fileURLToPath(new URL('tests/mocks/obsidian.ts', import.meta.url)),
    },
  },
});
