// 1.363.1 — bout en bout 30, côté Cabinet : la remise de cartes. Le client a pointé sa remise chez lui : le pont a écrit ses
// deux encaissements (107,100 et 53,550) et la commission de la banque (2,380, frais bancaires contre la banque). Le relevé
// du comptable porte UNE ligne de 158,270 : la Banque du Cabinet disait « Rien dans le livre en face ».
// 107,100 + 53,550 − 2,380 = 158,270, calculé à la main.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const KC = ecranDeLaPlateforme('compta.js') as Obj;

// Une écriture d'encaissement (532 au débit) ou de sortie (532 au crédit), comme le pont l'écrit.
const bq = (id: string, date: string, montant: number, piece = id, contre = '411') => ({
  id, journal: 'BQ', date, piece, libelle: `Chèque ${piece}`, statut: 'validee',
  lignes: montant > 0
    ? [{ compte: '532', libelle: `Chèque ${piece}`, debit: montant, credit: 0 }, { compte: contre, libelle: piece, debit: 0, credit: montant }]
    : [{ compte: contre, libelle: piece, debit: -montant, credit: 0 }, { compte: '532', libelle: piece, debit: 0, credit: -montant }],
});
const ligne = (id: string, date: string, montant: number, libelle = id) => ({ id, date, libelle, montant, rapprochement: { niveau: 'aucun', ecritureId: '', ligne: -1, le: '', par: '' } });
const livre = (ecritures: Obj[], lignes: Obj[], soldeFin = 0): Obj => ({
  ecritures, audit: [], plan: [{ compte: '532', libelle: 'Banque' }, { compte: '411', libelle: 'Clients' }, { compte: '627', libelle: 'Frais' }, { compte: '4111', libelle: 'Clients' }], releves: [{ id: 'R', compte: '532', du: '2026-10-01', au: '2026-10-31', soldeDebut: 0, soldeFin, lignes }],
});
const ids = (l: Obj[]) => l.map((c) => c.ecritureId);
const t1 = () => bq('t1', '2026-11-16', 107.1, 'TIC-001');
const t2 = () => bq('t2', '2026-11-16', 53.55, 'TIC-002');
const com = (montant = -2.38, date = '2026-11-16') => bq('com', date, montant, 'COMMISSION', '627');

describe('la remise de cartes au Cabinet (remiseDeLigne)', () => {
  it('les encaissements du jour et l\'écriture de commission font la ligne : ils se proposent ensemble', () => {
    const L = livre([t1(), t2(), com(), bq('loyer', '2026-11-16', -900, 'LOYER', '613')], [ligne('l', '2026-11-17', 158.27, 'REMISE TPE')]);
    const r = KC.remiseDeLigne(L, 'R', 'l');
    expect(ids(r.ecritures).sort()).toEqual(['com', 't1', 't2']);
    expect([r.combinaisons, r.commission]).toEqual([1, 2.38]);
  });

  it('sans écriture de frais bancaires, rien ne se propose : une sortie au 613 du même montant n\'est pas une commission', () => {
    const L = livre([t1(), t2(), bq('x', '2026-11-16', -2.38, 'DIVERS', '613')], [ligne('l', '2026-11-17', 158.27)]);
    expect(KC.remiseDeLigne(L, 'R', 'l').ecritures).toEqual([]);
  });

  it('la somme doit faire la ligne au millime ; une commission déjà rapprochée ailleurs ne sert pas deux fois', () => {
    expect(KC.remiseDeLigne(livre([t1(), t2(), com(-2.381)], [ligne('l', '2026-11-17', 158.27)]), 'R', 'l').ecritures).toEqual([]);
    const L = livre([t1(), t2(), com()], [ligne('l', '2026-11-17', 158.27), ligne('autre', '2026-11-16', -2.38)]);
    L.releves[0].lignes[1].rapprochement = { niveau: 'certain', ecritureId: 'com', ligne: 1, le: '', par: '' };
    expect(KC.remiseDeLigne(L, 'R', 'l').ecritures).toEqual([]);
  });

  it('un jour qui mêle un virement et les cartes : les seules écritures qui font la ligne ; deux réponses : rien', () => {
    const L = livre([t1(), t2(), com(), bq('vir', '2026-11-16', 1429)], [ligne('l', '2026-11-17', 158.27)]);
    expect(ids(KC.remiseDeLigne(L, 'R', 'l').ecritures).sort()).toEqual(['com', 't1', 't2']);
    // t2 et son jumeau du même montant : deux façons de faire la ligne, aucune n'est sûre.
    const D = livre([t1(), t2(), bq('t3', '2026-11-16', 53.55, 'TIC-003'), com()], [ligne('l', '2026-11-17', 158.27)]);
    expect(KC.remiseDeLigne(D, 'R', 'l').ecritures).toEqual([]);
  });

  it('la remise de chèques de même sens passe d\'abord, et une ligne qui sort n\'est jamais une remise de cartes', () => {
    const L = livre([bq('a', '2026-11-15', 100.125), bq('b', '2026-11-16', 58.145), com()], [ligne('l', '2026-11-17', 158.27)]);
    const r = KC.remiseDeLigne(L, 'R', 'l');
    expect(ids(r.ecritures)).toEqual(['a', 'b']);
    expect(r.commission).toBeUndefined();
    expect(KC.remiseDeLigne(livre([t1(), t2(), com()], [ligne('l', '2026-11-17', -158.27)]), 'R', 'l').ecritures).toEqual([]);
  });
});
