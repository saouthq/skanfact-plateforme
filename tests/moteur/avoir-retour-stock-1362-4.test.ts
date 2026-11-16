// L'avoir qui ne rend pas de marchandise (1.362.4, bout en bout 28), joué par la pâtisserie de Nour : 30 coffrets en stock
// à 25 DT, 20 vendus à l'Hôtel Mouradi. Un avoir « Retour de marchandise » de 5 coffrets les remet en rayon ; un avoir
// « Remise accordée » sur les 20 (le prix baisse, rien ne revient) ne remettait pas moins de 20 coffrets en stock : le stock
// montait à 35, et le coût des ventes du mois devenait NÉGATIF (− 125 DT) — une remise qui fabriquait de la marge.
// Les montants sont calculés à la main : 30 × 25 = 750 entrés ; il reste 30 − 20 + 5 = 15 coffrets, soit 375 ; le coût des
// ventes de novembre vaut 750 − 375 = 375 (20 sortis à 25, 5 revenus à 25).
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Donnees = Record<string, unknown>;
const C = ecranDeLaPlateforme('core.js') as {
  stockOf: (data: Donnees, itemId: string, toIso?: string) => { qty: number; value: number };
  costOfGoodsSold: (data: Donnees, period: { from: string; to: string }) => number;
  stockMovements: (data: Donnees, itemId: string | null, toIso?: string) => { source: string; qty: number; docId: string }[];
};

const ligne = (qty: number, unitPrice: number, extra: Donnees = {}) => ({ label: 'Coffret de pâtisseries assorties', itemId: 'cof', qty, unitPrice, vatRate: 19, ...extra });
const piece = (id: string, type: string, status: string, date: string, lines: Donnees[], extra: Donnees = {}) => ({
  id, type, status, number: status === 'brouillon' ? '' : `${type === 'avoir' ? 'AVO' : 'FAC'}-2026-${id}`, date, clientId: 'hot',
  lines, discountRate: 0, withholdingRate: 0, applyStamp: type === 'facture', currency: 'DT', payments: [], createdAt: Date.parse(date), ...extra });
const patisserie = (avoirs: Donnees[]): Donnees => ({
  company: { currency: 'DT' },
  catalog: [{ id: 'cof', label: 'Coffret de pâtisseries assorties', unit: 'coffret', unitPrice: 45, vatRate: 19, tracked: true,
    initialQty: 30, initialCost: 25, initialDate: '2026-11-01' }],
  purchases: [], stockAdjustments: [],
  documents: [piece('007', 'facture', 'envoyée', '2026-11-10', [ligne(20, 45)]), ...avoirs],
});
const NOV = { from: '2026-11-01', to: '2026-11-30' };

describe('l\'avoir qui ne rend pas de marchandise (1.362.4)', () => {
  it('un retour de 5 coffrets les remet en rayon', () => {
    const d = patisserie([piece('003', 'avoir', 'envoyée', '2026-11-12', [ligne(5, 45)], { creditOf: '007', creditReason: 'Retour de marchandise' })]);
    expect(C.stockOf(d, 'cof').qty).toBe(15);
    expect(C.stockOf(d, 'cof').value).toBe(375);
    expect(C.costOfGoodsSold(d, NOV)).toBe(375);
  });
  it('une remise sur les 20 coffrets ne remet rien en stock, et le coût des ventes reste celui des 20 sortis', () => {
    const d = patisserie([piece('004', 'avoir', 'envoyée', '2026-11-14', [ligne(20, 5, { sansRetour: true })], { creditOf: '007', creditReason: 'Remise accordée' })]);
    expect(C.stockOf(d, 'cof').qty).toBe(10);
    expect(C.stockOf(d, 'cof').value).toBe(250);
    expect(C.costOfGoodsSold(d, NOV)).toBe(500);
    expect(C.stockMovements(d, 'cof').filter((m) => m.source === 'avoir')).toEqual([]);
  });
  it('les deux avoirs ensemble : seul le retour revient ; un avoir en brouillon ne rend rien', () => {
    const d = patisserie([
      piece('003', 'avoir', 'envoyée', '2026-11-12', [ligne(5, 45)], { creditOf: '007', creditReason: 'Retour de marchandise' }),
      piece('004', 'avoir', 'envoyée', '2026-11-14', [ligne(15, 5, { sansRetour: true })], { creditOf: '007', creditReason: 'Remise accordée' }),
      piece('b1', 'avoir', 'brouillon', '2026-11-15', [ligne(3, 45)], { creditOf: '007' }),
    ]);
    expect(C.stockOf(d, 'cof').qty).toBe(15);
    expect(C.costOfGoodsSold(d, NOV)).toBe(375);
    expect(C.stockMovements(d, 'cof').filter((m) => m.source === 'avoir').map((m) => [m.docId, m.qty])).toEqual([['003', 5]]);
  });
  it('un même avoir peut rendre une ligne et pas l\'autre', () => {
    const d = patisserie([piece('005', 'avoir', 'envoyée', '2026-11-16', [ligne(4, 45), ligne(16, 2, { sansRetour: true })], { creditOf: '007' })]);
    expect(C.stockOf(d, 'cof').qty).toBe(14);
    expect(C.costOfGoodsSold(d, NOV)).toBe(400);
  });
});
