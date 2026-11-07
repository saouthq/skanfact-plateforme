// 1.323.0 (les Statistiques jusqu'au comptable) : la Boulangerie El Amen, à Monastir, livre deux clients sur facture, vend au
// comptoir, revend en mai son vieux four à une boulangerie voisine (une facture née de la fiche du bien, puis un avoir : la
// porte était à reprendre) et achète un four neuf. Le comptable passe la revente aux produits des cessions (775), hors des
// comptes 70 qu'il lit comme le chiffre d'affaires : « Vendu HT », le meilleur client, ce qui se vend le mieux, le mois de mai
// et la marge comptaient le four comme une vente. Les données discriminent : une remise globale (144,999 − 3 % = 140,649),
// deux articles à 0,7 DT l'un de l'autre, un avoir sur la revente, un retour au comptoir. Les montants sont calculés à la main.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const co = { ...C.DEFAULT_COMPANY, name: 'Boulangerie El Amen', currency: 'DT' };
const ligne = (label: string, qty: number, unitPrice: number, vatRate = 7) => ({ label, qty, unitPrice, vatRate });
const piece = (id: string, type: string, date: string, clientId: string, lines: Obj[], extra: Obj = {}): Obj => ({
  id, type, date, number: id.toUpperCase(), status: type === 'avoir' ? 'émis' : 'envoyée', clientId, lines, payments: [], applyStamp: false, discountRate: 0, createdAt: 1, ...extra,
});
const D = 2026;
const boulangerie = (): Obj => ({
  company: co,
  clients: [{ id: 'dunes', name: 'Hôtel Les Dunes' }, { id: 'marina', name: 'Restaurant La Marina' }, { id: 'jaziri', name: 'Boulangerie Jaziri' }],
  suppliers: [{ id: 'equip', name: 'Équipements Boulangers du Centre' }, { id: 'moulins', name: 'Grands Moulins du Sahel' }],
  catalog: [],
  assets: [{ id: 'four1', label: 'Four à sole 6 bouches', category: 'materiel', amount: 42000, date: '2016-06-01', years: 10, disposal: { date: `${D}-05-12`, amount: 9450.5, reason: 'Revendu à la boulangerie Jaziri' } }],
  documents: [
    piece('f0', 'facture', `${D - 1}-05-10`, 'dunes', [ligne('Pain de campagne', 1, 500)]),
    piece('f1', 'facture', `${D}-02-14`, 'dunes', [ligne('Pain de campagne', 420, 0.875), ligne('Croissant', 600, 0.655)]),
    piece('a1', 'avoir', `${D}-02-20`, 'dunes', [ligne('Croissant', 40, 0.655)], { creditOf: 'f1' }),
    piece('f2', 'facture', `${D}-05-20`, 'marina', [ligne('Gâteau d\'anniversaire', 3, 48.333, 19)], { discountRate: 3 }),
    piece('t1', 'facture', `${D}-05-12`, '', [ligne('Baguette', 40, 0.19), ligne('Millefeuille', 12, 1.875)], { ticket: true }),
    piece('r1', 'avoir', `${D}-05-13`, '', [ligne('Millefeuille', 1, 1.875)], { creditOf: 't1' }),
    // La revente du vieux four, née de sa fiche ; puis 450,200 DT rendus pour la porte à reprendre.
    piece('c1', 'facture', `${D}-05-12`, 'jaziri', [ligne('Four à sole 6 bouches (occasion)', 1, 9450.5, 19)], { assetId: 'four1' }),
    piece('c2', 'avoir', `${D}-05-30`, 'jaziri', [ligne('Porte du four à reprendre', 1, 450.2, 19)], { creditOf: 'c1' }),
    piece('b1', 'facture', `${D}-06-01`, 'jaziri', [ligne('Brouillon', 1, 999)], { status: 'brouillon', number: '' }),
  ],
  purchases: [
    { id: 'pa1', kind: 'facture', date: `${D}-03-02`, number: 'EBC-77', supplierId: 'equip', category: 'Matériel', payments: [],
      lines: [{ label: 'Four rotatif neuf', qty: 1, unitPrice: 38500.75, vatRate: 19, destination: 'immobilisation' }, { label: 'Installation du four', qty: 1, unitPrice: 650.4, vatRate: 19, destination: 'charge' }] },
    { id: 'pa2', kind: 'facture', date: `${D}-04-10`, number: 'GMS-412', supplierId: 'moulins', category: 'Farine', payments: [],
      lines: [{ label: 'Farine T55', qty: 30, unitPrice: 46.375, vatRate: 7, destination: 'charge' }] },
  ],
  serials: [],
});
const an = { from: `${D}-01-01`, to: `${D}-12-31` };

describe('les Statistiques jusqu\'au comptable (1.323.0)', () => {
  it('« Vendu HT » est le chiffre d\'affaires du comptable : la revente du four est dite à part, sa TVA reste collectée', () => {
    const d = boulangerie();
    const s = C.salesTotals(d, co, an.from, an.to);
    // 760,500 − 26,200 + 140,649 + 30,100 − 1,875 : sans les 9 000,300 du four (9 450,500 − 450,200).
    expect([s.ht, s.invoices, s.count]).toEqual([903.174, 3, 5]);
    expect(s.cession).toMatchObject({ ht: 9000.3, tva: 1710.057 });
    expect(s.cession.biens).toEqual([{ assetId: 'four1', label: 'Four à sole 6 bouches', ht: 9000.3, pieces: [
      { id: 'c1', number: 'C1', date: `${D}-05-12`, type: 'facture' }, { id: 'c2', number: 'C2', date: `${D}-05-30`, type: 'avoir' }] }]);
    // La TVA des ventes (53,235 − 1,834 + 26,723 + 2,107 − 0,131), puis la TVA collectée, revente comprise.
    expect([s.vat, s.tvaCollectee]).toEqual([80.1, 1790.157]);
    // Deux chemins, un chiffre : les factures et le comptoir font le chiffre d'affaires, sans le four.
    const v = C.ventesParCanal(d, co, an.from, an.to);
    expect([v.factures.ht, v.factures.pieces, v.factures.avoirs, v.comptoir.ht, v.comptoir.pieces, v.comptoir.avoirs]).toEqual([874.949, 2, 1, 28.225, 1, 1]);
    expect(C.round3(v.factures.ht + v.comptoir.ht)).toBe(s.ht);
    // L'an dernier, rien n'a été revendu.
    expect(C.salesTotals(d, co, `${D - 1}-01-01`, `${D - 1}-12-31`)).toMatchObject({ ht: 500, cession: { ht: 0, tva: 0, biens: [] } });
  });

  it('le livre du comptable dit le même chiffre : 903,174 aux comptes 70, 9 000,300 au 775', () => {
    const d = boulangerie();
    const lignes = C.journalEntries(d, co, an, { sections: ['ventes'] }) as Obj[];
    const solde = (re: RegExp) => C.round3(lignes.filter((e) => re.test(String(e.account))).reduce((t: number, e) => t + e.credit - e.debit, 0));
    expect(solde(/^70/)).toBe(C.salesTotals(d, co, an.from, an.to).ht);
    expect(solde(/^775$/)).toBe(C.salesTotals(d, co, an.from, an.to).cession.ht);
  });

  it('le voisin qui rachète le four n\'est ni le meilleur client, ni un nouveau client ; le four ne se vend pas « le mieux » ; mai se lit sans lui', () => {
    const d = boulangerie();
    expect((C.topClients(d, co, an.from, an.to, 8) as Obj[]).map((x) => [x.name, x.ht])).toEqual([['Hôtel Les Dunes', 734.3], ['Restaurant La Marina', 140.649], ['Vente au comptoir', 28.225]]);
    expect((C.topItems(d, co, an.from, an.to, 8) as Obj[]).map((x) => [x.label, x.ht])).toEqual([
      ['Pain de campagne', 367.5], ['Croissant', 366.8], ['Gâteau d\'anniversaire', 140.649], ['Millefeuille', 20.625], ['Baguette', 7.6]]);
    const mois = C.revenueByMonth(d, co, an.from, an.to) as Obj[];
    expect([mois[1]?.ht, mois[4]?.ht]).toEqual([734.3, 168.874]);
    const m = C.clientMovement(d, co, an.from, an.to, 180, `${D}-12-31`);
    expect(m.nouveaux.map((x: Obj) => [x.name, x.ht])).toEqual([['Restaurant La Marina', 140.649]]);
    expect(m.dormants.map((x: Obj) => [x.name, x.days])).toEqual([['Hôtel Les Dunes', 314], ['Restaurant La Marina', 225]]);
  });

  it('la marge ne compte pas la revente comme une vente sans coût : la page Marges vend ce que vendent les Statistiques', () => {
    const d = boulangerie();
    const r = C.marginBy(d, co, an.from, an.to, 'client', 0) as Obj[];
    expect(r.map((x) => [x.label, x.revenue])).toEqual([['Hôtel Les Dunes', 734.3], ['Restaurant La Marina', 140.649], ['Vente au comptoir', 28.225]]);
    expect(C.round3(r.reduce((t, x) => t + x.revenue, 0))).toBe(C.salesTotals(d, co, an.from, an.to).ht);
  });

  it('le four neuf est un achat, mais pas une charge de l\'année : la part immobilisée se dit à côté des achats', () => {
    const a = C.achatsRepartis(boulangerie(), co, an.from, an.to);
    // 38 500,750 + 650,400 + 30 × 46,375 ; dont le four, au bilan.
    expect([a.ht, a.pieces, a.immo]).toEqual([40542.4, 2, 38500.75]);
    expect(a.fournisseurs.map((x: Obj) => [x.label, x.ht])).toEqual([['Équipements Boulangers du Centre', 39151.15], ['Grands Moulins du Sahel', 1391.25]]);
  });
});
