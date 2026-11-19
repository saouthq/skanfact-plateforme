// (1.387.53, issue 13, ENTACHATS-7) La fiche stock d'un article : après un avoir fournisseur de 4 sacs à 62,500 sur un
// stock acheté 20 × 62,500 puis 10 × 68,000, la ligne de l'avoir affichait « coût moyen après 64,333 » — celui d'AVANT —
// pendant que la valeur du stock, elle, valait 64,615 l'unité ; l'entrée suivante ne tombait juste qu'avec ce dernier.
// Calcul à la main : 1 250 + 680 = 1 930 pour 30 (64,333) ; l'avoir retire 4 × 62,500 = 250 : 1 680 pour 26 = 64,615 ;
// 15 sacs à 62,500 entrent : 1 680 + 937,5 = 2 617,5 pour 41 = 63,841. La ligne se nomme « Avoir fournisseur ».
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Mvt = { qty: number; unitCost?: number | null };
const C = ecranDeLaPlateforme('core.js') as {
  runningStock: (m: Mvt[]) => { rows: { cmpAfter: number; valueAfter: number; qtyAfter: number }[]; cmp: number; value: number };
  moveSourceLabel: (k: string, m?: Record<string, unknown>) => string;
};

describe('le coût moyen après un avoir fournisseur (issue 13, ENTACHATS-7)', () => {
  it('la sortie au prix de l\'avoir recalcule le coût moyen, et l\'entrée suivante tombe juste', () => {
    const r = C.runningStock([{ qty: 20, unitCost: 62.5 }, { qty: 10, unitCost: 68 }, { qty: -4, unitCost: 62.5 }, { qty: 15, unitCost: 62.5 }]);
    expect(r.rows.map((x) => [x.qtyAfter, x.valueAfter, x.cmpAfter])).toEqual([[20, 1250, 62.5], [30, 1930, 64.333], [26, 1680, 64.615], [41, 2617.5, 63.841]]);
  });
  it('une sortie au coût moyen (une vente) ne change rien au coût moyen', () => {
    const r = C.runningStock([{ qty: 20, unitCost: 62.5 }, { qty: 10, unitCost: 68 }, { qty: -5, unitCost: null }]);
    expect(r.rows.map((x) => x.cmpAfter)[2]).toBe(64.333);
  });
  it('la ligne d\'un avoir fournisseur se nomme « Avoir fournisseur », un achat reste « Achat »', () => {
    expect(C.moveSourceLabel('achat', { avoirFournisseur: true })).toBe('Avoir fournisseur');
    expect(C.moveSourceLabel('achat', {})).toBe('Achat');
  });
});
