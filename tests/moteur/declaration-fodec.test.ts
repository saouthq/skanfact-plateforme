// La FODEC dans la déclaration du mois (1.155.0) : un fabricant la collecte sur ses factures (compte 4369, À VÉRIFIER) ; le
// Cabinet la lit sur ce compte, la range dans sa rubrique du formulaire et dans le récapitulatif. Un commerçant qui n'en
// collecte pas ne voit ni la rubrique ni la ligne.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Case = { montant: number | null; horsTotal?: string };
type Ligne = { compte: string; debit: number; credit: number };
type Ecriture = { id: string; date: string; journal: string; statut: string; lignes: Ligne[] };
type Livre = { ecritures?: Ecriture[] };
const KC = ecranDeLaPlateforme('compta.js') as {
  livreVide: (id: string, annee: number) => Livre;
  declarationMensuelle: (livre: unknown, periode: string) => { cases: Record<string, Case> };
  formulaireMensuel: (livre: unknown, decl: unknown) => { rubriques: { id: string; lignes: { montant: number | null }[] }[]; recap: { cle: string; montant: number | null }[]; total: number };
};

// Une vente de 1 234,567 HT d'un produit fabriqué : FODEC 1 % (12,346), TVA 19 % sur la base FODEC comprise (236,913).
const vente = (id: string, date: string): Ecriture => ({ id, date, journal: 'VT', statut: 'validee', lignes: [
  { compte: '411', debit: 1483.826, credit: 0 },
  { compte: '701', debit: 0, credit: 1234.567 },
  { compte: '4369', debit: 0, credit: 12.346 },
  { compte: '4367', debit: 0, credit: 236.913 },
] });

describe('la FODEC dans la déclaration du mois', () => {
  it('lue sur son compte, rangée dans sa rubrique et dans le récapitulatif, hors de l\'écriture à décaisser', () => {
    const livre = KC.livreVide('d1', 2026);
    livre.ecritures = [vente('e1', '2026-10-12'), vente('e2', '2026-09-30')];
    const decl = KC.declarationMensuelle(livre, '2026-10');
    expect(decl.cases.fodec?.montant).toBe(12.346);
    expect(decl.cases.fodec?.horsTotal).toMatch(/À VÉRIFIER/);
    const f = KC.formulaireMensuel(livre, decl);
    expect(f.rubriques.map((r) => r.id)).toEqual(['rs', 'tfp', 'foprolos', 'tva', 'fodec', 'timbre', 'tcl']);
    expect(f.rubriques.find((r) => r.id === 'fodec')?.lignes[0]?.montant).toBe(12.346);
    expect(f.recap.find((r) => r.cle === 'fodec')?.montant).toBe(12.346);
    // Le total du récapitulatif la compte : la TVA du mois (236,913) et la FODEC.
    expect(f.total).toBe(249.259);
  });

  it('un mois sans FODEC : ni rubrique ni ligne au récapitulatif', () => {
    const livre = KC.livreVide('d2', 2026);
    const decl = KC.declarationMensuelle(livre, '2026-10');
    expect(decl.cases.fodec?.montant).toBe(0);
    const f = KC.formulaireMensuel(livre, decl);
    expect(f.rubriques.some((r) => r.id === 'fodec')).toBe(false);
    expect(f.recap.some((r) => r.cle === 'fodec')).toBe(false);
  });
});
