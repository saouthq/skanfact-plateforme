// (1.388.55, rapport #17 FISC-8) La FODEC sur l'imprimé dit sa base, comme la TVA dit la sienne : « FODEC 1 % sur
// 1 000,000 ». Sans elle, le client ne pouvait pas savoir quelles lignes la portent.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Objet = Record<string, unknown>;
const C = ecranDeLaPlateforme('core.js') as { documentHtml: (doc: Objet, client: Objet, company: Objet) => string; computeTotals: (doc: Objet, company: Objet) => Record<string, number> };
const societe = { name: 'Atelier Métal', currency: 'DT', stampFee: 1, regimeTva: 'reel', fodec: true };
const texte = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[\s\u00a0\u202f]+/g, ' ');

describe('FISC-8 : la FODEC imprimée dit sa base', () => {
  it('la base remisée des seules lignes qui la portent', () => {
    // 4 poutrelles à 250 (FODEC) + 2 heures de pose à 100 (sans), remise globale 10 % : base FODEC 1 000 × 0,9 = 900.
    const doc = { id: 'f1', type: 'facture', number: 'FAC-2026-001', status: 'envoyée', date: '2026-11-16', clientId: 'c1', currency: 'DT', discountRate: 10,
      applyStamp: true, stampFee: 1, fodecRate: 1, payments: [],
      lines: [{ label: 'Poutrelle', qty: 4, unitPrice: 250, vatRate: 19, fodec: true }, { label: 'Pose', qty: 2, unitPrice: 100, vatRate: 19 }] };
    const t = C.computeTotals(doc, societe);
    expect(t.fodecBase).toBe(900);
    expect(t.fodec).toBe(9);
    expect(texte(C.documentHtml(doc, { name: 'Client' }, societe))).toContain('FODEC 1 % sur 900,000');
  });
});
