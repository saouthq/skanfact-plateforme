// L'application web (12 § 4). Construite dans dist/web, que le programme serveur sert à côté de l'API
// (même origine : pas de partage de ressources entre sites à ouvrir). Deux parties :
//   - l'entrée (index.html, React) : se connecter, créer son compte, le code du téléphone, la porte ;
//   - l'application elle-même : le CODE de la v10, copié tel quel dans public/v10 (décision de
//     Skander, 28/09/2026), avec son point de contact et sa mise en page du téléphone dans
//     public/plateforme. Vite copie public/ tel quel ; nos scripts et nos styles y perdent ensuite leurs
//     commentaires, rien d'autre (alleger.ts).
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { allegerLesEcrans } from './alleger.ts';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), {
    // Les écrans partent sans leurs commentaires (docs/leger.md, L6) : public/ est copié tel quel, puis allégé.
    name: 'skanfact-ecrans-sans-commentaires',
    apply: 'build',
    writeBundle(sortie) { if (sortie.dir) allegerLesEcrans(sortie.dir); },
  }],
  build: { outDir: '../dist/web', emptyOutDir: true },
  // En développement, l'API tourne à côté (npm run serveur).
  server: { proxy: { '/v1': 'http://127.0.0.1:8080' } },
});
