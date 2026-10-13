// La reprise du code de l'interface v10 (décision de Skander, 28/09/2026) :
//
//   npm run reprendre-v10
//
// copie TELS QUELS les fichiers de la v10 dans web/public/v10, applique les adaptations de ./adaptations.mjs
// (chacune doit retrouver son endroit exact), et écrit web/public/v10/PROVENANCE.json : l'origine, et l'empreinte
// de chaque fichier tel qu'il sort de la reprise. Un test vérifie ces empreintes : personne ne retouche ces
// fichiers à la main sans passer par une adaptation écrite.
//
// La source est FIGÉE dans ce dépôt (web/v10/source, 13/10/2026) : la v10 n'a plus d'utilisateurs, son dépôt
// (saouthq/skanfact) est archivé, et la plateforme ne dépend plus de lui. ORIGINE.json dit d'où elle vient
// (branche beta, 35bfb8c) et l'empreinte de chaque fichier : un test refuse une source retouchée à la main.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ADAPTATIONS } from './adaptations.mjs';

if (process.argv[2]) {
  console.error('La source de la v10 est figée dans web/v10/source : « npm run reprendre-v10 », sans chemin.');
  process.exit(2);
}
const source = path.join(import.meta.dirname, 'source');
const origine = JSON.parse(fs.readFileSync(path.join(source, 'ORIGINE.json'), 'utf8'));
const { branche, commit } = origine;
const renderer = path.join(source, 'renderer');

const cible = path.join(import.meta.dirname, '../public/v10');
fs.rmSync(cible, { recursive: true, force: true });
fs.mkdirSync(cible, { recursive: true });
const fichiers = fs.readdirSync(renderer).filter((f) => /\.(html|css|js)$/.test(f)).sort();
for (const f of fichiers) fs.copyFileSync(path.join(renderer, f), path.join(cible, f));
// Le Cabinet (brique 37, docs/cabinet.md) : ses écrans et son moteur, dans cabinet/ ; les fichiers
// qu'il partage avec l'entreprise (compta.js, visite.js…) sont ceux de la copie ci-dessus, jamais une
// seconde copie qui divergerait.
const cabinet = path.join(source, 'cabinet');
fs.mkdirSync(path.join(cible, 'cabinet'));
for (const f of fs.readdirSync(cabinet).filter((x) => /\.(html|css|js)$/.test(x)).sort()) {
  fs.copyFileSync(path.join(cabinet, f), path.join(cible, 'cabinet', f));
  fichiers.push(`cabinet/${f}`);
}
fichiers.sort();

for (const a of ADAPTATIONS) {
  const p = path.join(cible, a.fichier);
  const texte = fs.readFileSync(p, 'utf8');
  const n = texte.split(a.avant).length - 1;
  if (n !== 1) { console.error(`Adaptation introuvable ou multiple (${n}) dans ${a.fichier} : ${a.pourquoi}`); process.exit(1); }
  // Une fonction, pas un texte : « $' » ou « $& » dans une adaptation resteraient tels quels.
  fs.writeFileSync(p, texte.replace(a.avant, () => a.apres));
}

const empreinte = (f) => createHash('sha256').update(fs.readFileSync(path.join(cible, f))).digest('hex');
const provenance = {
  depot: origine.depot, branche, commit, reprisLe: new Date().toISOString().slice(0, 10), adaptations: ADAPTATIONS.length,
  fichiers: Object.fromEntries(fichiers.map((f) => [f, empreinte(f)])),
};
fs.writeFileSync(path.join(cible, 'PROVENANCE.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(`Interface v10 reprise : ${fichiers.length} fichiers de ${branche}@${commit}, ${ADAPTATIONS.length} adaptations.`);
