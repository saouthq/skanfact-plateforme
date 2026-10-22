// Écrit les pages à part qui vivent en fichier (1.108.0 ; commun/page-a-part.ts) : la page « Maintenance en cours » du
// frontal (exploitation/maintenance.html), et le mot « SkanFact a besoin de JavaScript » de l'application et de la console
// (entre ses deux marques). Un test vérifie que les fichiers du dépôt sont à jour.
//   node scripts/pages-a-part.ts
import fs from 'node:fs';
import path from 'node:path';
import { MARQUES_SANS_JAVASCRIPT, pageRedemarrage, sansJavascript } from '../commun/page-a-part.ts';

const racine = path.join(import.meta.dirname, '..');
fs.writeFileSync(path.join(racine, 'exploitation/maintenance.html'), pageRedemarrage());
for (const f of ['web/index.html', 'web/console/index.html']) {
  const p = path.join(racine, f), s = fs.readFileSync(p, 'utf8');
  const [debut, fin] = MARQUES_SANS_JAVASCRIPT;
  const a = s.indexOf(debut), b = s.indexOf(fin);
  if (a < 0 || b < a) throw new Error(`${f} : les marques « sans-javascript » manquent`);
  fs.writeFileSync(p, s.slice(0, a) + sansJavascript() + s.slice(b + fin.length));
}
console.log('exploitation/maintenance.html, web/index.html et web/console/index.html à jour.');
