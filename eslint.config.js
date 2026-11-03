import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Le code repris de la v10 (web/public/v10) est le nôtre depuis la 1.151.0 (26/10/2026), mais il est écrit dans le
  // style de la v10 : il n'entre pas encore dans ce contrôle. Le rangement (docs/cadrage/17-rangement.md § 5, lot « Fin »)
  // l'y fait entrer, module par module, une fois rangé dans modules/. Sa source figée (web/v10/source) reste une archive.
  // Le code d'un tiers recopié tel quel (web/public/tiers : le dessin des codes QR, brique 83) : un test le
  // compare octet pour octet à la version épinglée du paquet npm, il ne se reformule pas.
  { ignores: ['node_modules/**', 'banc/v10/**', 'dist/**', 'web/public/v10/**', 'web/v10/source/**', 'web/public/tiers/**'] },
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
  { files: ['web/src/**', 'web/console/**', 'web/public/plateforme/**', 'web/public/espace/**'], languageOptions: { globals: { ...globals.browser } } },
  // Le service des écrans (brique 72) tourne à part, dans le navigateur, sans page.
  { files: ['web/public/sw.js'], languageOptions: { globals: { ...globals.serviceworker } } },
  // Le passage de la coque de bureau (brique 137) : CommonJS, dans la page.
  { files: ['bureau/coque/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.browser, ...globals.commonjs } },
    rules: { '@typescript-eslint/no-require-imports': 'off' } },
);
