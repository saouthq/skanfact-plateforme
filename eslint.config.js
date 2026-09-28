import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['node_modules/**', 'banc/v10/**', 'dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Un nombre à virgule ne représente jamais de l'argent (01 R3) : le moteur travaille en bigint.
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.name='parseFloat']",
        message: 'Pas de parseFloat : l\'argent et les taux sont des entiers (01 R3).',
      }],
    },
  },
  // Les écrans tournent dans le navigateur.
  { files: ['web/src/**'], languageOptions: { globals: { ...globals.browser } } },
);
