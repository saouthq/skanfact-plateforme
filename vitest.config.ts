import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'moteur/**/*.test.ts'],
    // Les tests partagent UNE base : ils passent l'un après l'autre.
    fileParallelism: false,
    globalSetup: ['tests/preparer-base.ts'],
    testTimeout: 20_000,
    // Une attente à l'écran (expect.poll) couvre un aller-retour au serveur : une seconde (le défaut) ne le tient pas
    // sur une machine de GitHub chargée (1.110.1 : « retiré du cabinet » arrivé après la seconde, le test rouge).
    expect: { poll: { timeout: 10_000 } },
  },
});
