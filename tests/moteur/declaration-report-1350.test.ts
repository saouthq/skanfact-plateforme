// Le crédit de TVA reporté d'un mois à l'autre, au Cabinet (1.350.0 ; docs/revue-modules.md). Il se LIT sur le 4366
// (9.6.0) — à condition que chaque mois précédent ait passé son écriture de déclaration, qui retire du compte la TVA
// déductible déjà imputée. La boulangerie de l'exemple avait ses déclarations de janvier à juillet déposées sans cette
// écriture : septembre annonçait un « crédit du mois précédent » de 2 505,389 DT alors que chaque mois était à payer —
// un chiffre que le comptable recopie sur le portail. Quand la TVA collectée n'est pas soldée à l'ouverture du mois, le
// report se refait par l'enchaînement des déclarations, et la case le dit.
//
// Les données discriminent (10.0.0) : janvier est à payer, février laisse un crédit de 70, et le 4366 porte 220 à
// l'ouverture de mars — trois réponses différentes selon la règle suivie (220 lu, 70 enchaîné, 0 remboursé).

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Case = { montant: number | null; note?: string };
type Ligne = { compte: string; debit: number; credit: number };
type Ecriture = { id: string; date: string; journal: string; statut: string; lignes: Ligne[] };
type Livre = { ecritures?: Ecriture[] };
const KC = ecranDeLaPlateforme('compta.js') as {
  livreVide: (id: string, annee: number) => Livre;
  declarationMensuelle: (livre: unknown, periode: string) => { cases: Record<string, Case> };
  formulaireMensuel: (livre: unknown, decl: unknown) => { rubriques: { id: string; lignes: { cle: string; montant: number | null; note: string }[] }[] };
};

const e = (id: string, date: string, journal: string, lignes: [string, number, number][]): Ecriture =>
  ({ id, date, journal, statut: 'validee', lignes: lignes.map(([compte, debit, credit]) => ({ compte, debit, credit })) });
// Le premier trimestre : ventes (TVA collectée) et achats (TVA déductible), sans écriture de déclaration.
const activite = (): Ecriture[] => [
  e('v1', '2026-01-10', 'VT', [['411', 1190, 0], ['706', 0, 1000], ['4367', 0, 190]]),
  e('a1', '2026-01-15', 'AC', [['601', 526.316, 0], ['4366', 100, 0], ['401', 0, 626.316]]),
  e('v2', '2026-02-10', 'VT', [['411', 313.158, 0], ['706', 0, 263.158], ['4367', 0, 50]]),
  e('a2', '2026-02-15', 'AC', [['601', 631.579, 0], ['4366', 120, 0], ['401', 0, 751.579]]),
  e('v3', '2026-03-10', 'VT', [['411', 1878.947, 0], ['706', 0, 1578.947], ['4367', 0, 300]]),
];
// Les écritures de déclaration telles que l'écran les passe (`ecritureDeclaration`) : janvier à payer 90, février un
// crédit de 70 qui reste au 4366.
const declarations = (): Ecriture[] => [
  e('d1', '2026-01-31', 'OD', [['4367', 190, 0], ['4366', 0, 100], ['4365', 0, 90]]),
  e('d2', '2026-02-28', 'OD', [['4367', 50, 0], ['4366', 0, 50]]),
];
const livreAvec = (ecritures: Ecriture[]) => { const l = KC.livreVide('d', 2026); l.ecritures = ecritures; return l; };

describe('le crédit de TVA reporté, au Cabinet (1.350.0)', () => {
  it('sans les écritures de déclaration des mois précédents, le crédit se refait mois par mois, et la case le dit', () => {
    const livre = livreAvec(activite());
    const decl = KC.declarationMensuelle(livre, '2026-03');
    // Le 4366 porte 220 à l'ouverture de mars ; le vrai crédit est celui que février a laissé : 70.
    expect(decl.cases.creditReporte?.montant).toBe(70);
    expect(decl.cases.netAPayer?.montant).toBe(230);
    expect(decl.cases.creditReporte?.note).toMatch(/^Les mois précédents n'ont pas tous leur écriture de déclaration : le compte 4367 n'est pas soldé au 01\/03\/2026/);
    const tva = KC.formulaireMensuel(livre, decl).rubriques.find((r) => r.id === 'tva');
    expect(tva?.lignes.find((l) => l.cle === 'tvaReport')).toMatchObject({ montant: 70, note: decl.cases.creditReporte?.note });
    // Février aussi : janvier était à payer, il ne laisse aucun crédit.
    expect(KC.declarationMensuelle(livre, '2026-02').cases.creditReporte?.montant).toBe(0);
  });

  it('avec les écritures passées, le crédit se lit sur le compte, sans note', () => {
    const decl = KC.declarationMensuelle(livreAvec([...activite(), ...declarations()]), '2026-03');
    expect(decl.cases.creditReporte?.montant).toBe(70);
    expect(decl.cases.creditReporte?.note).toBeUndefined();
  });

  it('le compte fait foi quand il est tenu : un crédit remboursé ne se reporte plus', () => {
    const remboursement = e('r1', '2026-02-28', 'BQ', [['532', 70, 0], ['4366', 0, 70]]);
    const decl = KC.declarationMensuelle(livreAvec([...activite(), ...declarations(), remboursement]), '2026-03');
    expect(decl.cases.creditReporte?.montant).toBe(0);
    expect(decl.cases.netAPayer?.montant).toBe(300);
  });

  // Ce cas départage les deux lectures (le remboursement ci-dessus, daté dans son mois, est vu par l'une comme par
  // l'autre) : une régularisation passée par le cabinet contre le 4365 a la forme d'une écriture de déclaration, donc
  // l'enchaînement des mois ne la voit pas — le compte, si. 70 de crédit, 30 régularisés : il en reste 40.
  it('sur un compte tenu, c\'est le compte qui parle : une régularisation du crédit se lit', () => {
    const regul = e('g1', '2026-02-28', 'OD', [['4365', 30, 0], ['4366', 0, 30]]);
    const decl = KC.declarationMensuelle(livreAvec([...activite(), ...declarations(), regul]), '2026-03');
    expect(decl.cases.creditReporte?.montant).toBe(40);
    expect(decl.cases.creditReporte?.note).toBeUndefined();
    expect(decl.cases.netAPayer?.montant).toBe(260);
  });
});
