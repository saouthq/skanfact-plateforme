// Les chemins que le Cabinet cite dans le SkanFact de son client (1.362.3, bout en bout 27). Sous les avances de Yassine,
// le Cabinet écrivait « Ce client les saisit dans son SkanFact (Paie › Avances) » ; ses taux, « Paie › Barèmes ». Aucune
// des deux n'existe dans la Paie de l'entreprise : les avances sont sous « L'équipe › Avances et prêts », les taux sous
// « Réglages ». Une phrase qui dit OÙ trouver une valeur est une promesse (10.9.2) : chaque étape d'un chemin « Paie › … »
// doit être un nom que l'écran de l'entreprise affiche — lu dans sa source, jamais recopié ici.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RACINE = path.join(import.meta.dirname, '../..');
const lire = (f: string) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const entreprise = lire('modules/personnel/ecrans/entreprise/paie.js');

// Les noms que la Paie de l'entreprise affiche : ses vues (PAIE_VUES), leurs sous-vues (PAIE_SOUS), et le bouton Réglages.
const noms = new Set<string>();
const tableau = (nom: string) => {
  const i = entreprise.indexOf(`const ${nom} = `);
  expect(i, nom).toBeGreaterThan(-1);
  const fin = entreprise.indexOf(';\n', i);
  return entreprise.slice(i, fin);
};
for (const t of [tableau('PAIE_VUES'), tableau('PAIE_SOUS')]) {
  for (const m of t.matchAll(/\['[a-z-]+', '((?:[^'\\]|\\.)+)'/g)) noms.add((m[1] ?? '').replace(/\\'/g, '\''));
}
if (/data-tab="baremes"[^`]*\} Réglages</.test(entreprise)) noms.add('Réglages');

describe('les chemins de la Paie cités au Cabinet existent dans l\'app de l\'entreprise', () => {
  it('les noms lus dans la source de l\'entreprise ne sont pas vides', () => {
    for (const n of ['Aujourd\'hui', 'L\'équipe', 'Congés et absences', 'Avances et prêts', 'Réglages']) expect(noms.has(n), n).toBe(true);
  });
  it('chaque étape d\'un « Paie › … » du Cabinet est un nom de l\'écran de l\'entreprise', () => {
    const sources = ['modules/personnel/ecrans/cabinet/paie.js', 'modules/socle/aide/cabguide.js'];
    const chemins: string[] = [];
    for (const f of sources) {
      for (const m of lire(f).matchAll(/Paie › ([^)<'"`\\]*(?:\\'[^)<'"`\\]*)*)/g)) chemins.push((m[1] ?? '').replace(/\\'/g, '\''));
    }
    expect(chemins.length).toBeGreaterThan(4);
    const faux = chemins.filter((c) => c.split(' › ').some((etape) => !noms.has(etape.trim())));
    expect(faux).toEqual([]);
  });
});
