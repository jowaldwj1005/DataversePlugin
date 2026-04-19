import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.js'],
    pool: 'forks',
    poolOptions: { forks: { maxForks: 1 } },
  },
});
