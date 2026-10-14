import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'dist/**', 'vscode-extension/**', 'scratch/**', 'output/**'],
  },
});
