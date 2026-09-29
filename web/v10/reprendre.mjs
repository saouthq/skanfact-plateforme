// La reprise du code de l'interface v10 (décision de Skander, 28/09/2026) :
//
//   npm run reprendre-v10 -- /chemin/du/depot/skanfact
//
// copie TELS QUELS les fichiers de src/renderer (branche beta de préférence) dans web/public/v10,
// applique les adaptations de ./adaptations.mjs (chacune doit retrouver son endroit exact), et écrit
// web/public/v10/PROVENANCE.json : le dépôt, la branche, le commit, et l'empreinte de chaque fichier
// tel qu'il sort de la reprise. Un test vérifie ces empreintes : personne ne retouche ces fichiers à
// la main sans passer par une adaptation écrite.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ADAPTATIONS } from './adaptations.mjs';

const source = process.argv[2];
if (!source) { console.error('Usage : npm run reprendre-v10 -- /chemin/du/depot/skanfact'); process.exit(2); }
const renderer = path.join(source, 'src/renderer');
if (!fs.existsSync(path.join(renderer, 'app.js'))) { console.error(`Pas d'interface v10 dans ${renderer}`); process.exit(2); }
const git = (...a) => execFileSync('git', ['-C', source, ...a], { encoding: 'utf8' }).trim();
const branche = git('rev-parse', '--abbrev-ref', 'HEAD');
const commit = git('rev-parse', '--short', 'HEAD');
if (git('status', '--porcelain', '--', 'src/renderer', 'src/cabinet')) { console.error('src/renderer ou src/cabinet a des changements non enregistrés : on ne reprend que du code publié.'); process.exit(2); }

const cible = path.join(import.meta.dirname, '../public/v10');
fs.rmSync(cible, { recursive: true, force: true });
fs.mkdirSync(cible, { recursive: true });
const fichiers = fs.readdirSync(renderer).filter((f) => /\.(html|css|js)$/.test(f)).sort();
for (const f of fichiers) fs.copyFileSync(path.join(renderer, f), path.join(cible, f));
// Le Cabinet (brique 37, docs/cabinet.md) : ses écrans et son moteur, dans cabinet/ ; les fichiers
// qu'il partage avec l'entreprise (compta.js, visite.js…) sont ceux de la copie ci-dessus, jamais une
// seconde copie qui divergerait.
const cabinet = path.join(source, 'src/cabinet');
fs.mkdirSync(path.join(cible, 'cabinet'));
for (const f of fs.readdirSync(path.join(cabinet, 'renderer')).filter((x) => /\.(html|css|js)$/.test(x)).sort()) {
  fs.copyFileSync(path.join(cabinet, 'renderer', f), path.join(cible, 'cabinet', f));
  fichiers.push(`cabinet/${f}`);
}
fs.copyFileSync(path.join(cabinet, 'cabcore.js'), path.join(cible, 'cabinet', 'cabcore.js'));
fichiers.push('cabinet/cabcore.js');
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
  depot: 'saouthq/skanfact', branche, commit, reprisLe: new Date().toISOString().slice(0, 10), adaptations: ADAPTATIONS.length,
  fichiers: Object.fromEntries(fichiers.map((f) => [f, empreinte(f)])),
};
fs.writeFileSync(path.join(cible, 'PROVENANCE.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(`Interface v10 reprise : ${fichiers.length} fichiers de ${branche}@${commit}, ${ADAPTATIONS.length} adaptations.`);
