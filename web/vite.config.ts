// L'application web (12 § 4). Construite dans dist/web, que le programme serveur sert à côté de l'API
// (même origine : pas de partage de ressources entre sites à ouvrir). Deux parties :
//   - l'entrée (index.html, React) : se connecter, créer son compte, le code du téléphone, la porte ;
//   - l'application elle-même : le CODE de la v10, copié tel quel dans public/v10 (décision de
//     Skander, 28/09/2026), avec son point de contact et sa mise en page du téléphone dans
//     public/plateforme. Vite copie public/ tel quel ; les gros fichiers sont ensuite ASSEMBLÉS de leurs morceaux
//     (commun/assemblage.ts, modules/assemblage.json ; docs/cadrage/17-rangement.md § 4.1), puis nos scripts et nos
//     styles y perdent leurs commentaires, rien d'autre (alleger.ts).
// Une seconde page, à part : la console de l'équipe SkanFact (console/index.html, docs/console.md), servie sous /console/.
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { build, defineConfig, type Plugin } from 'vite';
import { assemblerOctets, ecrireLesAssembles, lireTable } from '../commun/assemblage.ts';
import { PLANCHER } from '../commun/navigateurs.ts';
import { controleDesFrontieres } from '../outils/rangement/frontieres.ts';
import { allegerLesEcrans, PRECOMPRESSER, precompresserLesEcrans } from './alleger.ts';

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
        build: { outDir: path.join(sortie.dir, 'console'), emptyOutDir: true, target: PLANCHER },
      });
    },
  };
}

// Les écrans assemblés en développement (17 § 4.1) : un intermédiaire sert chaque fichier assemblé à la volée, relu à
// chaque demande, sans rien garder.
function lesAssemblesEnDeveloppement(): Plugin {
  return {
    name: 'skanfact-assemblage-a-la-volee',
    apply: 'serve',
    configureServer(serveur) {
      serveur.middlewares.use((demande, reponse, suite) => {
        const servi = decodeURIComponent((demande.url ?? '').split('?')[0] ?? '').replace(/^\/+/, '');
        if (!(servi in lireTable())) { suite(); return; }
        reponse.setHeader('Content-Type', servi.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
        reponse.setHeader('Cache-Control', 'no-cache');
        reponse.end(assemblerOctets(servi));
      });
    },
  };
}

export default defineConfig({
  root: import.meta.dirname,
  // Le contrôle des frontières (17 § 4.2) d'abord, et seulement quand la construction pose SKANFACT_CONTROLE=1 (le
  // suiveur) : jamais dans les constructions des tests de navigateur.
  plugins: [controleDesFrontieres(), react(), lesAssemblesEnDeveloppement(), {
    // Les écrans partent assemblés (17 § 4.1), puis sans leurs commentaires (docs/leger.md, L6) : public/ est copié tel
    // quel, les gros fichiers y sont remplacés par la suite de leurs morceaux, puis tout est allégé — l'assemblage avant
    // l'allègement, dans la même étape.
    name: 'skanfact-ecrans-sans-commentaires',
    apply: 'build',
    writeBundle(sortie) {
      if (!sortie.dir) return;
      ecrireLesAssembles(sortie.dir);
      allegerLesEcrans(sortie.dir);
      // La production les compresse aussi d'avance, au plus fort (docs/leger.md, L7).
      if (process.env[PRECOMPRESSER] === '1') precompresserLesEcrans(sortie.dir);
    },
  }, laConsole()],
  // Le plancher des navigateurs (commun/navigateurs.ts) : Firefox 121 et non le 114 du défaut de Vite (« :has() »).
  build: { outDir: '../dist/web', emptyOutDir: true, target: PLANCHER },
  // En développement, l'API tourne à côté (npm run serveur).
  server: { proxy: { '/v1': 'http://127.0.0.1:8080' } },
});
