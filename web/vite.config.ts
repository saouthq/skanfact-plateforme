// L'application web (12 § 4). Construite dans dist/web, que le programme serveur sert à côté de l'API
// (même origine : pas de partage de ressources entre sites à ouvrir). Deux parties :
//   - l'entrée (index.html, React) : se connecter, créer son compte, le code du téléphone, la porte ;
//   - l'application elle-même : le CODE de la v10, copié tel quel dans public/v10 (décision de
//     Skander, 28/09/2026), avec son point de contact et sa mise en page du téléphone dans
//     public/plateforme. Vite copie public/ tel quel ; nos scripts et nos styles y perdent ensuite leurs
//     commentaires, rien d'autre (alleger.ts).
// Une seconde page, à part : la console de l'équipe SkanFact (console/index.html, docs/console.md), servie sous /console/.
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { build, defineConfig, type Plugin } from 'vite';
import { allegerLesEcrans } from './alleger.ts';

// La console se construit À PART, dans console/ (ses fichiers sous /console/assets) : construite avec l'entrée, les deux
// pages se partageaient un morceau de code (React), que l'entrée aurait téléchargé deux fois à sa première ouverture —
// le serveur marque d'une empreinte les adresses que la page écrit, pas celles qu'un script importe (serveur/ecrans.ts).
function laConsole(): Plugin {
  return {
    name: 'skanfact-console',
    apply: 'build',
    async writeBundle(sortie) {
      if (!sortie.dir) return;
      await build({
        configFile: false, root: path.join(import.meta.dirname, 'console'), base: '/console/', logLevel: 'error', plugins: [react()],
        build: { outDir: path.join(sortie.dir, 'console'), emptyOutDir: true },
      });
    },
  };
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), {
    // Les écrans partent sans leurs commentaires (docs/leger.md, L6) : public/ est copié tel quel, puis allégé.
    name: 'skanfact-ecrans-sans-commentaires',
    apply: 'build',
    writeBundle(sortie) { if (sortie.dir) allegerLesEcrans(sortie.dir); },
  }, laConsole()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  // En développement, l'API tourne à côté (npm run serveur).
  server: { proxy: { '/v1': 'http://127.0.0.1:8080' } },
});
