// La revue du Stock (1.284.0, docs/revue-modules.md S1, S2, S5) : ce qu'il faut commander d'un article sous son seuil
// (jusqu'au « stock à atteindre » s'il en a un, sinon jusqu'au seuil — la règle d'avant), d'où il vient (le fournisseur de
// son dernier achat ou de sa dernière réception, au prix HT de la ligne) et ce qu'il s'est vendu (factures émises moins
// avoirs, par article et non par libellé, remise globale comprise).

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Donnees = Record<string, unknown>;
const core = ecranDeLaPlateforme('core.js') as {
  stockAlerts: (data: Donnees) => { itemId: string; kind: string; qty: number; aCommander?: number }[];
  quantiteACommander: (data: Donnees, r: { itemId: string; qty: number; minStock: number }) => number;
  fournisseurDeLArticle: (data: Donnees, itemId: string, toIso?: string) => { supplierId: string; unitCost: number; date: string; docId: string; source: string } | null;
  ventesDeLArticle: (data: Donnees, company: Donnees, itemId: string, fromIso: string, toIso: string) => { ht: number; qty: number; pieces: number };
};

const societe = { currency: 'DT' };
const achat = (id: string, supplierId: string, date: string, itemId: string, qty: number, unitPrice: number, extra: Donnees = {}) => ({
  id, kind: 'facture', number: `FA-${id}`, date, supplierId, currency: 'DT', createdAt: Date.parse(date), payments: [],
  lines: [{ label: itemId, itemId, qty, unitPrice, vatRate: 19, destination: 'stock', deductible: true }], ...extra });
const article = (id: string, extra: Donnees = {}) => ({ id, label: `Article ${id}`, unit: 'u', unitPrice: 30, unitCost: 16, vatRate: 19, tracked: true, ...extra });

describe('commander ce qui manque', () => {
  it('jusqu\'au stock à atteindre ; sans lui, jusqu\'au seuil (la règle inconnue ne fait rien)', () => {
    const data = { company: societe, catalog: [article('a', { minStock: 10, stockCible: 40, initialQty: 7 }), article('b', { minStock: 10, initialQty: 7 }),
      article('c', { minStock: 0, initialQty: 0 }), article('d', { minStock: 10, stockCible: 6, initialQty: 7 }), article('e', { minStock: 3, initialQty: 0 })], purchases: [], documents: [] };
    const al = Object.fromEntries(core.stockAlerts(data).map((r) => [r.itemId, r.aCommander]));
    // a : 40 − 7 ; b : 10 − 7 ; c : sans seuil, pas d'alerte ; d : une cible sous le seuil ne baisse pas la commande ;
    // e : en rupture, jusqu'au seuil.
    expect(al).toEqual({ a: 33, b: 3, d: 3, e: 3 });
  });

  it('un stock négatif n\'a rien « à commander » : il lui manque un achat', () => {
    const data = { company: societe, catalog: [article('a', { minStock: 5 })], purchases: [], documents: [],
      stockAdjustments: [{ id: 'x', date: '2026-10-01', itemId: 'a', qty: -2, unitCost: '', source: 'ajustement' }] };
    const [r] = core.stockAlerts(data);
    expect([r?.kind, r?.aCommander]).toEqual(['negatif', undefined]);
  });
});

describe('d\'où vient un article', () => {
  it('le fournisseur de l\'entrée la plus récente, à son prix HT, pas le premier venu', () => {
    const data = { company: societe, catalog: [article('a')], documents: [],
      purchases: [achat('p1', 's1', '2026-09-01', 'a', 6, 16.8), achat('p2', 's2', '2026-10-20', 'a', 2, 17.5), achat('p3', 's1', '2026-10-01', 'a', 1, 99)] };
    expect(core.fournisseurDeLArticle(data, 'a')).toMatchObject({ supplierId: 's2', unitCost: 17.5, date: '2026-10-20', docId: 'p2', source: 'achat' });
  });

  it('la TVA non déductible n\'entre pas dans le prix du bon suivant ; un achat en devise donne le coût en dinars', () => {
    const nd = achat('p1', 's1', '2026-10-01', 'a', 1, 100, { lines: [{ label: 'a', itemId: 'a', qty: 1, unitPrice: 100, vatRate: 19, destination: 'stock', deductible: false }] });
    expect(core.fournisseurDeLArticle({ company: societe, catalog: [article('a')], documents: [], purchases: [nd] }, 'a')?.unitCost).toBe(100);
    const eur = achat('p2', 's3', '2026-10-02', 'a', 1, 50, { currency: 'EUR', exchangeRate: 3.4 });
    expect(core.fournisseurDeLArticle({ company: societe, catalog: [article('a')], documents: [], purchases: [eur] }, 'a')?.unitCost).toBe(170);
  });

  it('rien d\'acheté encore : on ne devine pas de fournisseur', () => {
    expect(core.fournisseurDeLArticle({ company: societe, catalog: [article('a', { initialQty: 5 })], purchases: [], documents: [] }, 'a')).toBeNull();
  });
});

describe('ce qu\'un article s\'est vendu', () => {
  const facture = (id: string, date: string, lignes: Donnees[], extra: Donnees = {}) => ({ id, type: 'facture', status: 'envoyée', number: `F-${id}`, date, clientId: 'c',
    currency: 'DT', discountRate: 0, applyStamp: false, withholdingRate: 0, payments: [], lines: lignes, ...extra });
  it('factures émises moins avoirs, remise globale comprise, par article ; brouillons, annulées et hors période ne comptent pas', () => {
    const data = { company: societe, catalog: [article('a')], purchases: [], documents: [
      facture('1', '2026-06-10', [{ label: 'Article a', itemId: 'a', qty: 3, unitPrice: 25, vatRate: 19 }, { label: 'Autre', itemId: 'z', qty: 9, unitPrice: 10, vatRate: 19 }]),
      // Renommé sur la pièce : c'est toujours l'article a.
      facture('2', '2026-07-10', [{ label: 'Ciment (promo)', itemId: 'a', qty: 2, unitPrice: 30, vatRate: 19 }], { discountRate: 10 }),
      facture('3', '2026-07-11', [{ label: 'Article a', itemId: 'a', qty: 100, unitPrice: 25, vatRate: 19 }], { status: 'brouillon' }),
      facture('4', '2026-07-12', [{ label: 'Article a', itemId: 'a', qty: 100, unitPrice: 25, vatRate: 19 }], { status: 'annulée' }),
      facture('5', '2025-01-12', [{ label: 'Article a', itemId: 'a', qty: 100, unitPrice: 25, vatRate: 19 }]),
      facture('6', '2026-08-01', [{ label: 'Article a', itemId: 'a', qty: 1, unitPrice: 25, vatRate: 19 }], { type: 'avoir' }),
    ] };
    // 3 × 25 + 2 × 30 × 0,9 − 25 = 75 + 54 − 25 = 104 ; 3 + 2 − 1 = 4 ; trois pièces.
    expect(core.ventesDeLArticle(data, societe, 'a', '2025-11-05', '2026-11-05')).toEqual({ ht: 104, qty: 4, pieces: 3 });
  });
});
