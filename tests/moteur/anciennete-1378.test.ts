// « Ce qui reste dû, par ancienneté », sur un compte pas encore lettré (1.378.8 ; issue 9, CABDECLARER-8). Vu : une
// facture de février et son règlement de juin tombaient dans deux tranches — « plus de 90 jours : 10 138,800 DT » pour
// un client qui ne devait rien de si vieux ; après lettrage, tout passait en « 31 à 60 jours ». Par tiers, ce qui n'est
// pas lettré en sens contraire s'impute aux pièces les plus anciennes ; seul le reste se range par âge.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Ligne = { compte: string; debit: number; credit: number; tiers?: string };
type Ecr = { id: string; numero: number; date: string; journal: string; piece: string; libelle: string; statut: string; lignes: Ligne[] };
type Livre = { ecritures: Ecr[]; exercice: { du: string; au: string } };
type Agee = { tranches: { label: string; montant: number }[]; tiers: { tiers: string; total: number; parTranche: { montant: number }[] }[]; total: number; impute: boolean };
const KC = ecranDeLaPlateforme('compta.js') as {
  livreVide: (id: string, annee: number) => Livre;
  lignesDuLivre: (l: Livre, o: { du: string; au: string }) => unknown[];
  balanceAgeeDepuisLignes: (lignes: unknown[], compte: string, aujourdhui: string) => Agee;
};
const facture = (n: number, date: string, tiers: string, ttc: number): Ecr => ({ id: `f${n}`, numero: n, date, journal: 'VT', piece: `FAC-${n}`, libelle: 'Vente', statut: 'validee',
  lignes: [{ compte: '411', debit: ttc, credit: 0, tiers }, { compte: '706', debit: 0, credit: ttc }] });
const reglement = (n: number, date: string, tiers: string, m: number): Ecr => ({ id: `r${n}`, numero: n, date, journal: 'BQ', piece: `VIR-${n}`, libelle: 'Règlement', statut: 'validee',
  lignes: [{ compte: '532', debit: m, credit: 0 }, { compte: '411', debit: 0, credit: m, tiers }] });
const agee = (ecritures: Ecr[]) => {
  const livre = KC.livreVide('d1', 2026);
  livre.ecritures.push(...ecritures);
  return KC.balanceAgeeDepuisLignes(KC.lignesDuLivre(livre, { du: livre.exercice.du, au: livre.exercice.au }), '411', '2026-11-17');
};
const parLabel = (a: Agee) => Object.fromEntries(a.tranches.filter((t) => t.montant).map((t) => [t.label, t.montant]));

describe('l\'ancienneté d\'un compte pas encore lettré', () => {
  it('un règlement non lettré solde la plus ancienne facture : rien ne reste « à plus de 90 jours »', () => {
    const a = agee([facture(1, '2026-02-10', 'Café Jasmin', 1000), reglement(2, '2026-06-15', 'Café Jasmin', 1000), facture(3, '2026-10-20', 'Café Jasmin', 300)]);
    expect(a.total).toBe(300);
    expect(Object.values(parLabel(a))).toEqual([300]);
    expect(Object.keys(parLabel(a))[0]).not.toMatch(/90/);
    expect(a.impute).toBe(true);
  });

  it('un règlement partiel entame la plus ancienne, le reste garde son âge', () => {
    const a = agee([facture(1, '2026-02-10', 'Café Jasmin', 1000), reglement(2, '2026-06-15', 'Café Jasmin', 400), facture(3, '2026-10-20', 'Café Jasmin', 300)]);
    expect(a.total).toBe(900);
    expect(Object.values(parLabel(a)).sort((x, y) => x - y)).toEqual([300, 600]);
  });

  it('sans rien en sens contraire, rien n\'est imputé ; un tiers ne paie pas pour un autre', () => {
    const a = agee([facture(1, '2026-02-10', 'Café Jasmin', 1000), facture(2, '2026-10-20', 'Hôtel Dar Jerba', 300), reglement(3, '2026-11-01', 'Hôtel Dar Jerba', 300)]);
    expect(a.tiers.map((t) => [t.tiers, t.total])).toEqual([['Café Jasmin', 1000]]);
    expect(a.total).toBe(1000);
  });
});
