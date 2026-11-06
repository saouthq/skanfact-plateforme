// 1.296.0 — Les statistiques jouées comme une quincaillerie qui facture les chantiers et vend au comptoir (Quincaillerie
// Ben Youssef) : le chiffre d'affaires se coupe entre les factures et les tickets sans rien perdre ; l'encaissé est celui du
// journal des encaissements ; les achats se répartissent par fournisseur et par catégorie, un avoir en moins, un acompte
// dehors ; les refus de devis se rangent par motif.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const co = { ...C.DEFAULT_COMPANY, name: 'Quincaillerie Ben Youssef', currency: 'DT' };
const ligne = (label: string, qty: number, unitPrice: number, vatRate = 19) => ({ label, qty, unitPrice, vatRate });
const piece = (id: string, type: string, date: string, extra: Obj = {}): Obj => ({
  id, type, date, number: id.toUpperCase(), status: type === 'devis' ? 'envoyé' : 'envoyée', clientId: 'sotub', lines: [], payments: [], applyStamp: false, createdAt: 1, ...extra,
});
const achat = (id: string, kind: string, date: string, supplierId: string, category: string, ht: number): Obj => ({
  id, kind, date, number: id.toUpperCase(), supplierId, category, lines: [{ label: 'Lot', qty: 1, unitPrice: ht, vatRate: 19 }], payments: [],
});
const D = 2026;
const donnees = (): Obj => ({
  company: co,
  clients: [{ id: 'sotub', name: 'Société Sotub' }, { id: 'hamdi', name: 'M. Hamdi' }],
  suppliers: [{ id: 'quinc', name: 'Grossiste Quincaillerie du Sahel' }, { id: 'beton', name: 'Béton Plus' }],
  catalog: [],
  documents: [
    piece('f0', 'facture', `${D - 1}-03-01`, { lines: [ligne('Chantier 2025', 1, 800.25)], payments: [{ id: 'p0', date: `${D - 1}-03-20`, amount: 952.298 }] }),
    piece('f1', 'facture', `${D}-03-10`, { lines: [ligne('Visserie chantier', 1, 1234.567)], payments: [{ id: 'p1', date: `${D}-04-02`, amount: 600 }] }),
    piece('f2', 'facture', `${D}-10-05`, { clientId: 'hamdi', lines: [ligne('Robinetterie', 3, 83.5)], payments: [{ id: 'p2', date: `${D + 1}-01-03`, amount: 100 }] }),
    piece('a1', 'avoir', `${D}-10-20`, { clientId: 'hamdi', status: 'émis', creditOf: 'f2', lines: [ligne('Robinet rendu', 1, 50.125)] }),
    // Le comptoir : un ticket de deux cadenas, puis un rendu le lendemain (un avoir sur le ticket, l'argent rendu en négatif).
    piece('t1', 'facture', `${D}-10-12`, { ticket: true, clientId: '', lines: [ligne('Cadenas 40 mm', 2, 12.345)], payments: [{ id: 'pt', date: `${D}-10-12`, amount: 29.381 }, { id: 'pr', date: `${D}-10-13`, amount: -14.691 }] }),
    piece('r1', 'avoir', `${D}-10-13`, { clientId: '', status: 'émis', creditOf: 't1', lines: [ligne('Cadenas 40 mm', 1, 12.345)] }),
    // Un brouillon ne vend rien.
    piece('b1', 'facture', `${D}-10-30`, { status: 'brouillon', number: '', lines: [ligne('Brouillon', 1, 999)] }),
    // Les devis : deux « trop cher » écrits différemment, un refus sans motif, un accepté, un en attente.
    piece('d1', 'devis', `${D}-05-01`, { status: 'refusé', reponse: { statut: 'refusé', motif: 'Trop cher' }, lines: [ligne('Portail', 1, 2000)] }),
    piece('d2', 'devis', `${D}-06-01`, { status: 'refusé', reponse: { statut: 'refusé', motif: ' trop cher ' }, lines: [ligne('Grille', 1, 500)] }),
    piece('d3', 'devis', `${D}-06-15`, { status: 'refusé', lines: [ligne('Serrure', 1, 100)] }),
    piece('d4', 'devis', `${D}-07-01`, { status: 'accepté', lines: [ligne('Porte', 1, 700)] }),
    piece('d5', 'devis', `${D}-07-10`, { status: 'envoyé', validUntil: '2099-01-01', lines: [ligne('Clôture', 1, 300)] }),
    piece('d6', 'devis', `${D - 1}-07-10`, { status: 'refusé', reponse: { statut: 'refusé', motif: 'Un concurrent' }, lines: [ligne('Ancien', 1, 10)] }),
  ],
  purchases: [
    achat('pa1', 'facture', `${D}-02-01`, 'quinc', 'Marchandises', 400.4),
    achat('pa2', 'depense', `${D}-03-05`, '', 'Carburant', 50.06),
    achat('pa3', 'avoir', `${D}-03-10`, 'quinc', 'marchandises', 40.04),
    achat('pa4', 'acompte', `${D}-04-01`, 'beton', 'Matériaux', 300),
    achat('pa5', 'facture', `${D - 1}-04-01`, 'beton', 'Matériaux', 123.45),
  ],
  serials: [],
});

describe('statistiques 1.296.0', () => {
  it('le chiffre d\'affaires se coupe entre factures et comptoir sans rien perdre ; un brouillon ne vend rien', () => {
    const d = donnees();
    const v = C.ventesParCanal(d, co, `${D}-01-01`, `${D}-12-31`);
    expect(v.factures).toMatchObject({ ht: 1434.942, pieces: 2, avoirs: 1, panier: 717.471 });
    expect(v.comptoir).toMatchObject({ ht: 12.345, pieces: 1, avoirs: 1, panier: 12.345 });
    // Deux chemins, un chiffre : la somme des deux canaux est le chiffre d'affaires de la carte.
    expect(C.round3(v.factures.ht + v.comptoir.ht)).toBe(C.salesTotals(d, co, `${D}-01-01`, `${D}-12-31`).ht);
    // L'an dernier : une facture, pas de comptoir.
    expect(C.ventesParCanal(d, co, `${D - 1}-01-01`, `${D - 1}-12-31`).comptoir).toMatchObject({ ht: 0, pieces: 0 });
  });

  it('l\'encaissé est celui du journal des encaissements : daté de la période, l\'argent rendu en moins', () => {
    const d = donnees();
    const e = C.encaisseSur(d, co, `${D}-01-01`, `${D}-12-31`);
    expect(e).toEqual({ montant: 614.69, reglements: 3 });
    const j = C.paymentsJournal(d, co, { from: `${D}-01-01`, to: `${D}-12-31` });
    expect(C.round3(j.reduce((s: number, r: Obj) => s + r.amount, 0))).toBe(e.montant);
    expect(C.encaisseSur(d, co, `${D}-10-01`, `${D}-10-31`).montant).toBe(14.69);
  });

  it('les achats par fournisseur et par catégorie : un avoir en moins, un acompte dehors, la casse ne sépare pas', () => {
    const d = donnees();
    const a = C.achatsRepartis(d, co, `${D}-01-01`, `${D}-12-31`);
    expect(a.ht).toBe(410.42);
    expect(a.pieces).toBe(3);
    expect(a.fournisseurs.map((x: Obj) => [x.label, x.ht, x.pieces])).toEqual([['Grossiste Quincaillerie du Sahel', 360.36, 2], ['Sans fournisseur', 50.06, 1]]);
    expect(a.categories.map((x: Obj) => [x.label, x.ht, x.pieces])).toEqual([['Marchandises', 360.36, 2], ['Carburant', 50.06, 1]]);
    // Le total est celui du journal des achats, acomptes retirés.
    const j = C.purchaseJournal(d, co, { from: `${D}-01-01`, to: `${D}-12-31` }).filter((r: Obj) => r.kind !== 'Acompte versé');
    expect(C.round3(j.reduce((s: number, r: Obj) => s + r.ht, 0))).toBe(a.ht);
    expect(C.achatsRepartis(d, co, `${D - 1}-01-01`, `${D - 1}-12-31`)).toMatchObject({ ht: 123.45, pieces: 1 });
  });

  it('les refus se rangent par motif, la casse et les espaces ne séparent pas, un refus sans motif vient en dernier', () => {
    const r = C.motifsDeRefus(donnees(), co, `${D}-01-01`, `${D}-12-31`);
    expect(r.map((x: Obj) => [x.label, x.count, x.sans])).toEqual([['Trop cher', 2, false], ['Sans motif noté', 1, true]]);
    expect(r[0].ttc).toBe(2975);
  });
});
