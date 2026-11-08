// 1.324.0 — La phrase qui dit ce qu'une pièce explique de l'écart entre deux sociétés d'un groupe (KC.phraseEntreSocietes,
// partagée par la page Groupe de l'entreprise et l'onglet Inventaire du Cabinet) : une facture absente des achats de
// l'acheteur, un achat dont le vendeur n'a aucune facture de ce numéro, la même pièce à deux montants ; et un avoir.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Piece = { numero: string; date: string; type: 'facture' | 'avoir'; vendeur: string; acheteur: string; chezVendeur: string | null; chezAcheteur: string | null; manque: 'achats' | 'ventes' | null };
const KC = ecranDeLaPlateforme('compta.js') as { phraseEntreSocietes: (p: Piece, nom: (id: string) => string, argent: (v: unknown) => string) => string };
const noms: Record<string, string> = { h: 'Huilerie Ben Salah', d: 'Distribution Ben Salah' };
const nom = (id: string) => noms[id] ?? '—';
const argent = (v: unknown) => `${Number(v).toFixed(3).replace('.', ',')} DT`;
const piece = (x: Partial<Piece>): Piece => ({ numero: 'FAC-2026-014', date: '2026-11-05', type: 'facture', vendeur: 'h', acheteur: 'd', chezVendeur: '2449.631', chezAcheteur: null, manque: 'achats', ...x });

describe('ce qu\'une pièce dit de l\'écart entre deux sociétés (1.324.0)', () => {
  it('la facture du vendeur absente des achats de l\'acheteur, l\'achat sans facture chez le vendeur, la même pièce à deux montants', () => {
    expect(KC.phraseEntreSocietes(piece({}), nom, argent))
      .toBe('La facture FAC-2026-014 du 05/11/2026 (2449,631 DT) de Huilerie Ben Salah n\'est pas dans les achats de Distribution Ben Salah.');
    expect(KC.phraseEntreSocietes(piece({ numero: 'FAC-2026-14', chezVendeur: null, chezAcheteur: '416.5', manque: 'ventes' }), nom, argent))
      .toBe('Distribution Ben Salah a noté l\'achat « FAC-2026-14 » du 05/11/2026 (416,500 DT) venant de Huilerie Ben Salah, qui n\'a émis aucune facture de ce numéro.');
    expect(KC.phraseEntreSocietes(piece({ chezVendeur: '5312.55', chezAcheteur: '5310.239', manque: null }), nom, argent))
      .toBe('La facture FAC-2026-014 : 5312,550 DT chez Huilerie Ben Salah, 5310,239 DT dans les achats de Distribution Ben Salah.');
  });

  it('un avoir se dit avoir, et un achat noté sans numéro le dit', () => {
    expect(KC.phraseEntreSocietes(piece({ type: 'avoir', numero: 'AVO-2026-003' }), nom, argent))
      .toBe('L\'avoir AVO-2026-003 du 05/11/2026 (2449,631 DT) de Huilerie Ben Salah n\'est pas dans les achats de Distribution Ben Salah.');
    expect(KC.phraseEntreSocietes(piece({ type: 'avoir', numero: '', chezVendeur: null, chezAcheteur: '120', manque: 'ventes' }), nom, argent))
      .toBe('Distribution Ben Salah a noté l\'avoir « sans numéro » du 05/11/2026 (120,000 DT) venant de Huilerie Ben Salah, qui n\'a émis aucun avoir de ce numéro.');
  });
});
