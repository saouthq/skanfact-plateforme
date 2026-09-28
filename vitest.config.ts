import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'moteur/**/*.test.ts'],
    // Les tests partagent UNE base : ils passent l'un après l'autre.
    fileParallelism: false,
    globalSetup: ['tests/preparer-base.ts'],
    testTimeout: 20_000,
  },
});
