// (1.386.4 ; issue 11, CABSAISIE-4) Le livre-journal après une contre-passation : deux écritures, chacune son numéro.
// L'écriture d'origine et son miroir portent le même journal, la même pièce et, contre-passée le jour même, la même
// date : groupées par pièce, elles devenaient « 1 pièce · 6 lignes » sous le numéro du miroir, et le numéro de
// l'origine disparaissait du journal.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Ligne = { date: string; journal: string; piece: string; compte: string; debit: number; credit: number; numero?: number; ecritureId?: string };
const KC = ecranDeLaPlateforme('compta.js') as {
  journalDepuisLignes: (lignes: Ligne[]) => { pieces: { numero: number | null; lignes: Ligne[]; debit: number; credit: number; equilibree: boolean }[]; numeros: string };
};

describe('le livre-journal, une écriture par pièce', () => {
  it('une écriture et son miroir du même jour restent deux pièces, chacune sous son numéro', () => {
    const base = { date: '2026-10-07', journal: 'AC', piece: 'FA-12' };
    const j = KC.journalDepuisLignes([
      { ...base, compte: '6061', debit: 100, credit: 0, numero: 460, ecritureId: 'a' },
      { ...base, compte: '4366', debit: 19, credit: 0, numero: 460, ecritureId: 'a' },
      { ...base, compte: '401', debit: 0, credit: 119, numero: 460, ecritureId: 'a' },
      { ...base, compte: '6061', debit: 0, credit: 100, numero: 461, ecritureId: 'b' },
      { ...base, compte: '4366', debit: 0, credit: 19, numero: 461, ecritureId: 'b' },
      { ...base, compte: '401', debit: 119, credit: 0, numero: 461, ecritureId: 'b' },
    ]);
    expect(j.numeros).toBe('livre');
    expect(j.pieces.map((p) => [p.numero, p.lignes.length, p.debit, p.credit, p.equilibree])).toEqual([[460, 3, 119, 119, true], [461, 3, 119, 119, true]]);
  });
  it('les lignes d\'un paquet, sans identifiant d\'écriture, se groupent encore par journal, pièce et date', () => {
    const base = { date: '2026-10-07', journal: 'AC', piece: 'FA-12' };
    const j = KC.journalDepuisLignes([{ ...base, compte: '6061', debit: 100, credit: 0 }, { ...base, compte: '401', debit: 0, credit: 100 }]);
    expect(j.pieces.map((p) => p.lignes.length)).toEqual([2]);
  });
});
