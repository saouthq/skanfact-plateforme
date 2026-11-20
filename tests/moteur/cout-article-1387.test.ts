// (1.387.66, issue 13, ENTACHATS-5) Un seul coût par article. La farine : coût saisi 62,500 ; achetée 20 sacs à 62,500
// puis 10 à 68,000 → coût moyen (20 × 62,5 + 10 × 68) / 30 = 1 930 / 30 = 64,333 (calcul à la main). Le catalogue, la
// liste de prix et la marge d'une vente lisaient 62,500 pendant que la fiche de stock disait 64,333.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

const C = ecranDeLaPlateforme('core.js') as {
  coutDeLArticle: (data: unknown, item: unknown) => { cout: number; source: string; fiche: number };
  lineCost: (line: unknown, data: unknown) => number;
  enLot: <T>(f: () => T) => T;
};
const farine = { id: 'far', label: 'Farine T55 sac 50 kg', unit: 'sac', tracked: true, unitPrice: 75.63, unitCost: 62.5 };
const conseil = { id: 'con', label: 'Conseil', unit: 'heure', unitPrice: 80, unitCost: 30 };
const achat = (id: string, date: string, qty: number, pu: number) => ({ id, kind: 'facture', number: id, date, createdAt: 1,
  lines: [{ label: farine.label, qty, unitPrice: pu, vatRate: 19, itemId: 'far', destination: 'stock' }] });
const donnees = (achats: unknown[]) => ({ company: { currency: 'DT' }, catalog: [farine, conseil], purchases: achats, documents: [], receptions: [], stockAdjustments: [] });

describe('un seul coût par article (issue 13, ENTACHATS-5)', () => {
  it('un article suivi qui a du stock : son coût moyen ; sans stock, ou non suivi : le coût de sa fiche', () => {
    const plein = donnees([achat('a1', '2026-11-01', 20, 62.5), achat('a2', '2026-11-05', 10, 68)]);
    expect(C.coutDeLArticle(plein, farine)).toEqual({ cout: 64.333, source: 'moyen', fiche: 62.5 });
    expect(C.coutDeLArticle(donnees([]), farine)).toEqual({ cout: 62.5, source: 'fiche', fiche: 62.5 });
    expect(C.coutDeLArticle(plein, conseil)).toEqual({ cout: 30, source: 'fiche', fiche: 30 });
    expect(C.coutDeLArticle(plein, { id: 'x', label: 'Sans coût', tracked: false })).toEqual({ cout: 0, source: '', fiche: 0 });
  });
  it('la marge d\'une ligne de vente lit ce même coût : 2 sacs coûtent 2 × 64,333 = 128,666, pas 125', () => {
    const plein = donnees([achat('a1', '2026-11-01', 20, 62.5), achat('a2', '2026-11-05', 10, 68)]);
    const ligne = { label: farine.label, qty: 2, unitPrice: 75.63, vatRate: 19 };
    expect(C.lineCost(ligne, plein)).toBe(128.666);
    expect(C.enLot(() => C.lineCost(ligne, plein))).toBe(128.666);
    // Le coût saisi sur la ligne l'emporte toujours.
    expect(C.lineCost({ ...ligne, unitCost: 70 }, plein)).toBe(140);
  });
});
