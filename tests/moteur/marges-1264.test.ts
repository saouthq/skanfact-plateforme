// 1.264.0 — « Où en est le chantier » (Skander, 03/11 : « je n'aime pas les barres comme ça »). La frise lit les pièces
// de l'affaire et ne recalcule rien à part : ce qui reste à encaisser est la somme des restes de ses factures (ceux de la
// liste des factures), ce qui reste à payer celle des restes de ses achats, à la part de l'affaire pour un achat partagé.
// L'étape en cours est la première qui n'est pas faite ; c'est elle qui porte le geste suivant.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const co = { ...C.DEFAULT_COMPANY, currency: 'DT', stampFee: 1 };
const ligne = (label: string, qty: number, unitPrice: number, extra: Obj = {}) => ({ label, qty, unitPrice, vatRate: 19, ...extra });
const base = (): Obj => ({
  company: co, clients: [{ id: 'c1', name: 'Hôtel Amilcar' }], suppliers: [{ id: 's1', name: 'Bois du Nord' }],
  projects: [{ id: 'A', name: 'Cuisine Amilcar', clientId: 'c1', status: 'en cours' }, { id: 'B', name: 'Bureau Lac', status: 'en cours' }],
  catalog: [], documents: [], purchases: [], stockAdjustments: [], employees: [], payslips: [], projectTime: [],
});
const etape = (s: Obj, k: string) => s.etapes.find((e: Obj) => e.k === k);

describe('où en est le chantier 1.264.0', () => {
  it('rien, puis un devis, puis la facture : l\'étape en cours avance, et le geste avec elle', () => {
    const d = base();
    expect(C.suiviAffaire(d, co, 'A', '2026-05-01').ici).toBe('devis');
    d.documents.push({ id: 'q1', type: 'devis', status: 'accepté', number: 'D-1', date: '2026-02-01', clientId: 'c1', projectId: 'A', currency: 'DT', lines: [ligne('Cuisine', 1, 4213.517)] });
    let s = C.suiviAffaire(d, co, 'A', '2026-05-01');
    expect([s.ici, etape(s, 'devis').fait, etape(s, 'facture').reste, etape(s, 'facture').devisOuvert.id]).toEqual(['facture', true, 4213.517, 'q1']);
    // La facture tirée du devis le ferme : tout est facturé, on attend l'argent.
    d.documents.push({ id: 'f1', type: 'facture', status: 'envoyée', number: 'F-1', date: '2026-03-02', dueDate: '2026-04-01', fromQuoteId: 'q1', clientId: 'c1', projectId: 'A', currency: 'DT', issuedTs: 2,
      lines: [ligne('Cuisine', 1, 4213.517)], payments: [{ id: 'r1', date: '2026-03-20', amount: 1500.25, method: 'virement' }] });
    s = C.suiviAffaire(d, co, 'A', '2026-05-01');
    expect(etape(s, 'facture').fait).toBe(true);
    expect(s.ici).toBe('encaisse');
    // Le reste à encaisser est celui de la facture, tel que la liste des factures le dit.
    expect(s.aEncaisser).toBe(C.invoiceBalance(d.documents[1], d, co).remaining);
    expect(etape(s, 'encaisse').partiel).toBe(true);
    // Échue depuis le 01/04 : en retard, et c'est elle qu'on relance.
    expect([etape(s, 'encaisse').retards, etape(s, 'encaisse').aRelancer.id]).toEqual([1, 'f1']);
  });

  it('ce qui reste à payer : un achat entier compte tout son reste, un achat partagé la part de l\'affaire', () => {
    const d = base();
    d.documents.push({ id: 'f1', type: 'facture', status: 'payée', number: 'F-1', date: '2026-03-02', clientId: 'c1', projectId: 'A', currency: 'DT', issuedTs: 2, lines: [ligne('Pose', 1, 900)] });
    d.documents[0].payments = [{ id: 'r1', date: '2026-03-03', amount: C.computeTotals(d.documents[0], co).netToPay, method: 'virement' }];
    const p1 = { id: 'p1', kind: 'facture', supplierId: 's1', date: '2026-03-10', currency: 'DT', projectId: 'A', lines: [ligne('Quincaillerie', 3, 41.333)], fees: 0, payments: [] };
    const p2 = { id: 'p2', kind: 'facture', supplierId: 's1', date: '2026-03-12', currency: 'DT', projectId: 'A', fees: 0, payments: [],
      lines: [ligne('Plaques', 2, 110.125), ligne('Plaques', 1, 110.125, { projectId: 'B' })] };
    d.purchases.push(p1, p2);
    const s = C.suiviAffaire(d, co, 'A', '2026-05-01');
    expect(etape(s, 'encaisse').fait).toBe(true);
    expect(s.ici).toBe('paye');
    const r1 = C.purchaseBalance(p1, co, d).remaining, r2 = C.purchaseBalance(p2, co, d).remaining;
    const part = C.coutAchatPourAffaire(p2, co, d, 'A').part;
    expect(part).toBeCloseTo(2 / 3, 6);
    expect(s.aPayer).toBe(C.round3(r1 + C.round3(r2 * part)));
    expect([etape(s, 'paye').nbDus, etape(s, 'paye').achatDu.id]).toEqual([2, 'p1']);
    // Tout payé : le chantier est soldé, plus d'étape en cours.
    p1.payments = [{ id: 'x1', date: '2026-04-01', amount: r1, method: 'virement' }] as never;
    p2.payments = [{ id: 'x2', date: '2026-04-01', amount: r2, method: 'virement' }] as never;
    const fin = C.suiviAffaire(d, co, 'A', '2026-05-01');
    expect([fin.ici, fin.solde, fin.aPayer]).toEqual([null, true, 0]);
  });

  it('un chantier sans achat n\'a rien à payer : il est soldé quand tout est encaissé', () => {
    const d = base();
    d.documents.push({ id: 'f1', type: 'facture', status: 'payée', number: 'F-1', date: '2026-03-02', clientId: 'c1', projectId: 'A', currency: 'DT', issuedTs: 2, lines: [ligne('Conseil', 1, 333.333)] });
    d.documents[0].payments = [{ id: 'r1', date: '2026-03-03', amount: C.computeTotals(d.documents[0], co).netToPay, method: 'virement' }];
    const s = C.suiviAffaire(d, co, 'A', '2026-05-01');
    expect([etape(s, 'paye').rien, s.ici, s.solde]).toEqual([true, null, true]);
  });
});
