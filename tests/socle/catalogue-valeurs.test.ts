// Les valeurs d'un texte du catalogue (textes/textes.ts, `rendre`) : « {nom} » ou « {de:nom} », un nom en lettres. Un nom
// qui porte un chiffre (« {p95} ») ne se remplit JAMAIS : il s'affiche tel quel, entre accolades, sur l'écran de la console
// (vu le 13/10/2026 : « 95 % des lectures en moins de {p95} »). Chaque catalogue du dépôt est lu ici, ceux des écrans
// compris : ils ne passent par aucun autre test qui charge le serveur.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { clesDuCatalogue, texteFrancais } from '../../textes/index.ts';

const RACINE = path.join(import.meta.dirname, '../..');
// Chaque fichier qui déclare des textes, trouvé dans le dépôt : un catalogue ajouté demain est lu sans qu'on y pense.
const catalogues = ['serveur', 'web', 'textes'].flatMap((d) => fs.readdirSync(path.join(RACINE, d), { withFileTypes: true, recursive: true })
  .filter((f) => f.isFile() && f.name.endsWith('.ts') && !f.parentPath.includes('node_modules'))
  .map((f) => path.join(f.parentPath, f.name))
  .filter((f) => /\bdeclarerTextes\(\{/.test(fs.readFileSync(f, 'utf8'))));
for (const f of catalogues) await import(f);

describe('les valeurs des textes du catalogue', () => {
  it('chaque fichier qui déclare des textes est lu, ceux des écrans compris', () => {
    const rel = catalogues.map((f) => path.relative(RACINE, f));
    expect(rel).toContain('web/console/src/textes.ts');
    expect(rel).toContain('web/src/textes.ts');
    expect(rel).toContain('serveur/console/textes.ts');
  });

  it('une valeur se nomme en lettres : un nom qui porte un chiffre ne se remplit jamais', () => {
    const fautes: string[] = [];
    for (const cle of clesDuCatalogue()) {
      for (const m of (texteFrancais(cle) ?? '').matchAll(/\{[^{}]*\}/g)) {
        if (!/^\{(de:)?[a-zA-Z_]+\}$/.test(m[0])) fautes.push(`${cle} : ${m[0]}`);
      }
    }
    expect(fautes).toEqual([]);
  });
});
