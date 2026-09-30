import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Le code de la v10 repris TEL QUEL (web/public/v10) n'est pas le nôtre à reformuler : il se
  // vérifie par ses empreintes (PROVENANCE.json), et ses adaptations sont écrites dans web/v10.
  // Le code d'un tiers recopié tel quel (web/public/tiers : le dessin des codes QR, brique 83) : un test le
  // compare octet pour octet à la version épinglée du paquet npm, il ne se reformule pas.
  { ignores: ['node_modules/**', 'banc/v10/**', 'dist/**', 'web/public/v10/**', 'web/public/tiers/**'] },
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
  { files: ['web/src/**', 'web/public/plateforme/**', 'web/public/espace/**'], languageOptions: { globals: { ...globals.browser } } },
  // Le service des écrans (brique 72) tourne à part, dans le navigateur, sans page.
  { files: ['web/public/sw.js'], languageOptions: { globals: { ...globals.serviceworker } } },
);
