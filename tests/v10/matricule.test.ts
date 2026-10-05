// La forme d'un matricule fiscal, jugée par l'écran et par le serveur (lot facture, 05/10/2026 ; docs/facture-details.md,
// D6). La fiche société porte le matricule à l'entreprise quand il est bien formé (serveur/v10/identite.ts) ; l'écran dit
// avant d'émettre qu'il manque « un matricule fiscal valide » (web/public/v10/core.js, `companyGaps`). Deux chemins, un
// verdict : un matricule que l'écran laisse passer et que le serveur ne porte pas resterait faux sans que rien ne le dise.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { matriculeCanonique } from '../../serveur/v10/identite.ts';

type Core = { matriculeBienForme: (v: unknown) => boolean; companyGaps: (c: Record<string, unknown>) => string[] };
const module = { exports: {} as unknown };
const source = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/core.js'), 'utf8');
(vm.runInThisContext(`(function (module, exports, require) {${source}\n})`, { filename: 'core.js' }) as (m: unknown, e: unknown, r: unknown) => void)(module, module.exports, () => ({}));
const C = module.exports as Core;

describe('la forme d\'un matricule fiscal, à l\'écran et au serveur', () => {
  // Comme on les recopie d'une carte d'identification fiscale, d'un cachet ou d'une facture reçue.
  const ecrits = ['1234567A/A/M/000', '1234567a/a/m/000', ' 1234567 A A M 000 ', '1234567/A/A/M/000', '1234567-A-A-M-000', '1234567AAM000',
    '1234567A', '1234567', '1234567A/A/M', '123456A/A/M/000', 'A234567A/A/M/000', '1234567A/A/M/0000', '12345678', 'MF 1234567A/A/M/000', '', '   '];

  it('l\'écran et le serveur disent la même chose de chaque matricule écrit, et le serveur le garde sous sa forme lisible', () => {
    const bienFormes = ecrits.filter((m) => C.matriculeBienForme(m));
    // Le test mesure : il y a des deux.
    expect(bienFormes.length).toBeGreaterThan(3);
    expect(bienFormes.length).toBeLessThan(ecrits.length - 3);
    for (const m of ecrits) {
      const garde = matriculeCanonique(m);
      expect(typeof garde === 'string', m).toBe(C.matriculeBienForme(m));
    }
    expect(bienFormes.map(matriculeCanonique)).toEqual(Array(bienFormes.length).fill('1234567A/A/M/000'));
    expect(matriculeCanonique('   ')).toBeNull();
  });

  it('la fiche société nomme un matricule mal formé comme un matricule absent, et laisse en paix un matricule juste', () => {
    const fiche = (matricule: string) => C.companyGaps({ name: 'Pâtisserie Les Délices de Sfax', matricule, activity: 'boulangerie', rib: '' })
      .filter((g) => !/RIB/.test(g));
    expect(fiche('')).toEqual(['le matricule fiscal']);
    expect(fiche('1234567A')).toEqual(['un matricule fiscal valide (sept chiffres, une lettre, puis code TVA, catégorie et établissement : 1234567A/A/M/000)']);
    expect(fiche('1234567A/A/M/000')).toEqual([]);
  });
});
