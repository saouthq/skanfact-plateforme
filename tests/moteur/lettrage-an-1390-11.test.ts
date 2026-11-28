// (1.390.11, issue 9, CABDECLARER-7) Une pièce d'à-nouveaux porte chaque client sur sa ligne. Le lettrage automatique la
// tenait pour « utilisée » dès qu'une paire la touchait, et le lettrage additionnait toutes ses lignes du compte : l'Hôtel
// (2 558) et son virement ne se soldaient jamais, le reste étant le Café de la même pièce. Chaque client se lettre sur SES
// lignes, et la pose dit pour quel client, pour que le serveur fasse la même somme.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Ligne = { compte: string; debit: number; credit: number; tiersId?: string; tiers?: string; lettre?: string };
type Ecr = { id: string; date: string; piece: string; statut: string; lignes: Ligne[] };
type Livre = { ecritures: Ecr[]; lettrages: unknown[] };
const KC = ecranDeLaPlateforme('compta.js') as {
  livreVide: (id: string, annee: number) => Livre;
  lettrageAuto: (livre: Livre, compte: string, o?: Record<string, unknown>) => { ok: boolean; poses: { ecritures: string[]; tiers?: unknown }[]; restent: number };
  lignesDuTiers: (livre: unknown, compte: string, ids: string[], tiers?: unknown) => { lignes?: string[] };
};
const ecr = (id: string, date: string, piece: string, lignes: Ligne[]): Ecr => ({ id, date, piece, statut: 'validee', lignes });

describe('le lettrage d\'une pièce d\'à-nouveaux à plusieurs clients', () => {
  it('chaque client de l\'à-nouveau se lettre avec son règlement, et la pose nomme le client', () => {
    const livre = KC.livreVide('d1', 2026);
    livre.ecritures.push(
      ecr('an', '2026-01-01', 'AN-2026', [{ compte: '411', debit: 2558, credit: 0, tiersId: 'h' }, { compte: '411', debit: 1161, credit: 0, tiersId: 'c' }, { compte: '110', debit: 0, credit: 3719 }]),
      ecr('vir', '2026-01-10', 'VIR-0110', [{ compte: '532', debit: 2558, credit: 0 }, { compte: '411', debit: 0, credit: 2558, tiersId: 'h' }]),
      ecr('chq', '2026-01-12', 'CHQ-0112', [{ compte: '532', debit: 1161, credit: 0 }, { compte: '411', debit: 0, credit: 1161, tiersId: 'c' }]),
    );
    const r = KC.lettrageAuto(livre, '411', { jours: 365 });
    expect(r.poses.map((p) => [p.ecritures, p.tiers])).toEqual([[['an', 'vir'], { id: 'h' }], [['an', 'chq'], { id: 'c' }]]);
    expect(r.restent).toBe(0);
    const an = livre.ecritures.find((e) => e.id === 'an');
    expect(an?.lignes.map((l) => !!l.lettre)).toEqual([true, true, false]);
    expect(an?.lignes[0]?.lettre).not.toBe(an?.lignes[1]?.lettre);
  });

  it('un dossier qui ne nomme ses clients que par leur nom : la paire se lettre sur les lignes de ce nom', () => {
    const livre = KC.livreVide('d1', 2026);
    livre.ecritures.push(
      ecr('an', '2026-01-01', 'AN-2026', [{ compte: '411', debit: 300, credit: 0, tiers: 'Hôtel' }, { compte: '411', debit: 200, credit: 0, tiers: 'Café' }, { compte: '110', debit: 0, credit: 500 }]),
      ecr('vc', '2026-02-10', 'VIR-C', [{ compte: '532', debit: 200, credit: 0 }, { compte: '411', debit: 0, credit: 200, tiers: 'Café' }]),
    );
    const r = KC.lettrageAuto(livre, '411');
    expect(r.poses.map((p) => [p.ecritures, p.tiers])).toEqual([[['an', 'vc'], { libelle: 'Café' }]]);
    expect(livre.ecritures.find((e) => e.id === 'an')?.lignes.map((l) => !!l.lettre)).toEqual([false, true, false]);
    expect(r.restent).toBe(1);
  });

  it('les lignes d\'un client parmi des écritures : celles que le serveur lettrera', () => {
    const livre = { ecritures: [
      { id: 'an', lignes: [{ ligneId: 'l1', compte: '411', tiersId: 'h' }, { ligneId: 'l2', compte: '411', tiersId: 'c' }, { ligneId: 'l3', compte: '411', tiers: 'Épicerie' }, { ligneId: 'l4', compte: '110' }] },
      { id: 'vir', lignes: [{ ligneId: 'l5', compte: '532' }, { ligneId: 'l6', compte: '411', tiersId: 'h' }] },
      { id: 'autre', lignes: [{ ligneId: 'l7', compte: '411', tiersId: 'h' }] },
    ] };
    expect(KC.lignesDuTiers(livre, '411', ['an', 'vir'], { id: 'h' })).toEqual({ lignes: ['l1', 'l6'] });
    expect(KC.lignesDuTiers(livre, '411', ['an', 'vir'], { libelle: 'Épicerie' })).toEqual({ lignes: ['l3'] });
    expect(KC.lignesDuTiers(livre, '411', ['an', 'vir'])).toEqual({});
  });
});
