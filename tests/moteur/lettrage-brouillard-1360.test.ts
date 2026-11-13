// Le lettrage automatique et le brouillard (1.360.0). Un client règle deux factures d'un seul virement : chez le
// comptable, les deux règlements arrivent au brouillard, et le lettrage montre quatre lignes ouvertes sur le 411. Le
// compte rendu de « Lettrer automatiquement » disait « 3 lignes ouvertes » — il ne comptait que les validées — et faisait
// chercher la quatrième. Il compte maintenant à part ce qui attend au brouillard : ces lignes ne se lettrent qu'une fois
// validées, et le moteur ne les touche pas.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Ligne = { compte: string; debit: number; credit: number; tiersId?: string; lettre?: string };
type Ecr = { id: string; date: string; piece: string; statut: string; lignes: Ligne[] };
type Livre = { ecritures: Ecr[]; lettrages: unknown[] };
const KC = ecranDeLaPlateforme('compta.js') as {
  livreVide: (id: string, annee: number) => Livre;
  lettrageAuto: (livre: Livre, compte: string, o?: Record<string, unknown>) => { ok: boolean; poses: { ecritures: string[] }[]; restent: number; auBrouillard: number };
};

const ecr = (id: string, date: string, piece: string, statut: string, lignes: Ligne[]): Ecr => ({ id, date, piece, statut, lignes });

describe('le lettrage automatique compte le brouillard à part', () => {
  it('une paire validée se lettre ; les lignes au brouillard ne sont ni lettrées ni comptées ouvertes', () => {
    const livre = KC.livreVide('d1', 2026);
    livre.ecritures.push(
      ecr('f1', '2026-10-02', 'FAC-2026-001', 'validee', [{ compte: '411', debit: 600, credit: 0, tiersId: 'c1' }, { compte: '706', debit: 0, credit: 600 }]),
      ecr('r1', '2026-10-20', 'FAC-2026-001', 'validee', [{ compte: '532', debit: 600, credit: 0 }, { compte: '411', debit: 0, credit: 600, tiersId: 'c1' }]),
      ecr('f2', '2026-10-05', 'FAC-2026-002', 'validee', [{ compte: '411', debit: 477, credit: 0, tiersId: 'c1' }, { compte: '706', debit: 0, credit: 477 }]),
      // Le virement groupé : deux règlements au brouillard, sur deux factures.
      ecr('b1', '2026-11-10', 'FAC-2025-001', 'brouillard', [{ compte: '532', debit: 300, credit: 0 }, { compte: '411', debit: 0, credit: 300, tiersId: 'c1' }]),
      ecr('b2', '2026-11-10', 'FAC-2026-002', 'brouillard', [{ compte: '532', debit: 477, credit: 0 }, { compte: '411', debit: 0, credit: 477, tiersId: 'c1' }]),
      // Une ligne déjà lettrée au brouillard ne compte pas (rien à lettrer).
      ecr('b3', '2026-11-11', 'X', 'brouillard', [{ compte: '411', debit: 0, credit: 5, tiersId: 'c1', lettre: 'Z' }, { compte: '532', debit: 5, credit: 0 }]),
    );
    const r = KC.lettrageAuto(livre, '411');
    expect(r.ok).toBe(true);
    expect(r.poses.map(p => p.ecritures)).toEqual([['f1', 'r1']]);
    expect(r.restent).toBe(1);
    expect(r.auBrouillard).toBe(2);
    // Le règlement au brouillard de 477 ne se lettre pas avec la facture validée de 477.
    const b2 = livre.ecritures.find(e => e.id === 'b2');
    expect(b2?.lignes.every(l => !l.lettre)).toBe(true);
  });

  it('un compte sans rien au brouillard dit zéro', () => {
    const livre = KC.livreVide('d2', 2026);
    livre.ecritures.push(ecr('f1', '2026-10-02', 'A', 'validee', [{ compte: '411', debit: 10, credit: 0, tiersId: 'c1' }, { compte: '706', debit: 0, credit: 10 }]));
    const r = KC.lettrageAuto(livre, '411');
    expect(r.auBrouillard).toBe(0);
    expect(r.restent).toBe(1);
  });
});
