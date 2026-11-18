// (1.387.9 ; issue 10, CABPAIE-35) Les refus d'un inventaire collé se lisent dans l'ordre des lignes : ceux de la lecture
// (une quantité illisible) passaient tous avant ceux du contrôle (une désignation qui manque) — « ligne 2, 4, 3 ».
// Et la phrase qui dit comment libérer une écriture au brouillard ne porte plus deux deux-points.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Lu = { lignes: Record<string, unknown>[]; refus: { ligne: number; motif: string }[] };
const KC = ecranDeLaPlateforme('compta.js') as {
  lignesInventaireDepuisTexte: (t: string) => Lu;
  inventaireValide: (inv: Record<string, unknown>) => { ok: boolean; motifs: string[] };
};

describe('l\'inventaire collé, ses refus', () => {
  it('les refus sortent dans l\'ordre des lignes, la lecture et le contrôle mêlés', () => {
    const lu = KC.lignesInventaireDepuisTexte('A;Farine;10;2\nB;Sucre;douze;3\nC;;5;1\nD;Sel;x;1');
    const v = KC.inventaireValide({ date: '2026-12-31', lignes: lu.lignes, refus: lu.refus });
    expect(v.ok).toBe(false);
    expect(v.motifs.map((m) => (/^Ligne (\d+)/.exec(m) || [])[1])).toEqual(['2', '3', '4']);
    expect(v.motifs[1]).toBe('Ligne 3 : la désignation manque.');
  });
  it('ce qui ne tient à aucune ligne se dit d\'abord', () => {
    const lu = KC.lignesInventaireDepuisTexte('A;Farine;dix;2');
    const v = KC.inventaireValide({ date: '', lignes: lu.lignes, refus: lu.refus });
    expect(v.motifs[0]).toMatch(/^La date de l'inventaire manque/);
    expect(v.motifs[1]).toMatch(/^Ligne 1 /);
  });
});
