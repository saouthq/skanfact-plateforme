// La vente à l'exportation et la TVA (1.360.1, bout en bout 23). Cocher « Vente à l'exportation » remettait à 0 % les lignes
// déjà posées ; une ligne ajoutée APRÈS prenait le taux par défaut, et la facture « sans TVA » comptait 19 % (475 € sur
// 2 500). La règle vit maintenant dans le calcul d'une pièce encore en brouillon. Une pièce déjà émise garde le calcul
// qu'elle a eu : c'est celui que le serveur a scellé et que le client a reçu. Et une facture d'export n'est plus
// signalée comme « aucune ligne ne porte de TVA » : elle est sans TVA par la loi.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, unknown>;
const C = ecranDeLaPlateforme('core.js') as {
  computeTotals: (doc: Obj, company: Obj) => { totalHT: number; totalVAT: number; totalTTC: number; netToPay: number; lines: { vatRate: number; vat: number }[] };
  factureSansTvaSuspecte: (doc: Obj, company: Obj) => boolean;
};

const company = { name: 'Pâtisserie Amira', currency: 'DT', stampFee: 1, regimeTva: 'reel', defaultVatRate: 19 };
const facture = (o: Obj = {}) => ({
  id: 'f1', type: 'facture', status: 'brouillon', currency: 'EUR', exchangeRate: 3.412, applyStamp: false, discountRate: 0, withholdingRate: 0,
  lines: [{ label: 'Plateaux de petits-fours', qty: 1, unitPrice: 2500, vatRate: 19 }, { label: 'Transport', qty: 1, unitPrice: 300, vatRate: 7 }], ...o,
});

describe('une vente à l\'exportation ne porte aucune TVA', () => {
  it('un brouillon d\'export : chaque ligne à 0 %, quel que soit le taux qu\'elle porte', () => {
    const t = C.computeTotals(facture({ export: true }), company);
    expect(t.totalHT).toBe(2800);
    expect(t.totalVAT).toBe(0);
    expect(t.totalTTC).toBe(2800);
    expect(t.netToPay).toBe(2800);
    expect(t.lines.map(l => [l.vatRate, l.vat])).toEqual([[0, 0], [0, 0]]);
    // Le même brouillon sans la case : la TVA de chaque ligne (475 + 21).
    expect(C.computeTotals(facture(), company).totalVAT).toBe(496);
  });

  it('une pièce déjà émise garde le calcul qu\'elle a eu', () => {
    // Une facture d'export émise AVANT la 1.360.1 avec une ligne à 19 % : le client l'a reçue TVA comprise.
    expect(C.computeTotals(facture({ export: true, status: 'envoyée', number: 'FAC-2026-004' }), company).totalVAT).toBe(496);
  });

  it('une facture d\'export n\'est pas « sans TVA par oubli » ; la même facture hors export l\'est', () => {
    const exoneree = facture({ lines: [{ label: 'Plateaux', qty: 1, unitPrice: 2500, vatRate: 0 }] });
    expect(C.factureSansTvaSuspecte({ ...exoneree, export: true }, company)).toBe(false);
    expect(C.factureSansTvaSuspecte(exoneree, company)).toBe(true);
  });
});
