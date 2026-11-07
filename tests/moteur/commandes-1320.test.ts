// 1.320.0 (les commandes fournisseurs jouées par la droguerie de l'Ariana, jusqu'au bilan) : ce qui est REÇU SANS FACTURE à
// une date. La marchandise reçue le 28 décembre est dans le stock compté ; sa facture, datée du 8 janvier, ne la couvre pas au
// 31 décembre. Sans sa charge, le bénéfice de 2025 est trop haut : l'état envoyé au comptable la porte, et le comptable la
// passe en facture non parvenue (607 / 408). Les données discriminent : 30 pots à 63,245 (1 897,350), 12 brosses à 4,375
// (52,500) ; une réception couverte par une facture de décembre, une reçue en janvier, une encore en brouillon. Les
// montants attendus sont calculés à la main.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Donnees = Record<string, unknown>;
type Recue = { numero: string; date: string; fournisseur: string; commande: string; ht: number };
type Etat = { date: string; total: number; lignes: { libelle: string; quantite: number; cout: number; valeur: number }[]; sansFacture: { total: number; receptions: Recue[] } };
const C = ecranDeLaPlateforme('core.js') as {
  etatDuStock: (data: Donnees, date: string) => Etat;
  receptionsSansFactureAu: (data: Donnees, date: string) => { total: number; receptions: Recue[] };
};
const KC = ecranDeLaPlateforme('compta.js') as {
  ecritureFacturesNonParvenues: (etat: unknown, annee: number) => {
    ok: boolean; motif?: string; total?: number;
    ecriture?: { journal: string; date: string; piece: string; libelle: string; lignes: { compte: string; libelle: string; debit: number; credit: number }[] };
  };
};

const reception = (id: string, number: string, date: string, supplierId: string, orderNumber: string, itemId: string, qty: number, unitPrice: number, status = 'validée') => ({
  id, number, date, supplierId, orderId: `o-${id}`, orderNumber, status, currency: 'DT', createdAt: Date.parse(date),
  lines: [{ label: itemId, itemId, qty, unitPrice, vatRate: 19, ligneCommande: 0 }] });
const factureDe = (id: string, date: string, rec: string, itemId: string, qty: number, unitPrice: number) => ({
  id, kind: 'facture', number: `FA-${id}`, date, supplierId: 'f1', currency: 'DT', createdAt: Date.parse(date), payments: [], receptions: [{ id: rec }],
  lines: [{ label: itemId, itemId, qty, unitPrice, vatRate: 19, destination: 'stock', deductible: true, recue: true }] });
const droguerie = (): Donnees => ({
  company: { currency: 'DT' },
  catalog: [
    { id: 'peint', label: 'Peinture murale blanche 10 L', code: 'PNT-10', unit: 'pot', unitPrice: 89, vatRate: 19, tracked: true, initialQty: 40, initialCost: 61, initialDate: '2025-01-02' },
    { id: 'brosse', label: 'Brosse plate 50 mm', unit: 'pièce', unitPrice: 7, vatRate: 19 },
  ],
  suppliers: [{ id: 'f1', name: 'Grossiste Sfax' }, { id: 'f2', name: 'Quincaillerie du Nord' }],
  purchases: [
    { id: 'p1', kind: 'facture', number: 'FA-p1', date: '2025-03-10', supplierId: 'f1', currency: 'DT', createdAt: 1, payments: [],
      lines: [{ label: 'peint', itemId: 'peint', qty: 20, unitPrice: 63, vatRate: 19, destination: 'stock', deductible: true }] },
    factureDe('p2', '2025-12-20', 'r1', 'peint', 10, 63.5),
    factureDe('p3', '2026-01-08', 'r2', 'peint', 30, 63.245),
  ],
  receptions: [
    reception('r1', 'BR-2025-001', '2025-12-15', 'f1', 'BCF-2025-001', 'peint', 10, 63.5),
    reception('r2', 'BR-2025-002', '2025-12-28', 'f1', 'BCF-2025-002', 'peint', 30, 63.245),
    reception('r3', 'BR-2025-003', '2025-12-30', 'f2', 'BCF-2025-003', 'brosse', 12, 4.375),
    reception('r4', 'BR-2026-001', '2026-01-05', 'f1', 'BCF-2025-004', 'peint', 5, 63),
    reception('r5', 'BR-2025-004', '2025-12-29', 'f2', 'BCF-2025-005', 'brosse', 6, 4.375, 'brouillon'),
  ],
  documents: [],
  stockAdjustments: [{ id: 's1', date: '2025-06-15', itemId: 'peint', qty: -23, unitCost: '', source: 'ajustement' }],
});

describe('ce qui est reçu sans facture, jusqu\'au bilan (1.320.0)', () => {
  it('au 31/12 : la réception du 28 que la facture du 8 janvier ne couvre pas encore, et celle sans facture ; pas les autres', () => {
    const r = C.receptionsSansFactureAu(droguerie(), '2025-12-31');
    // r1 est couverte par la facture du 20 décembre ; r4 arrive en janvier ; r5 n'est qu'un brouillon.
    expect(r.receptions.map((x) => [x.numero, x.date, x.fournisseur, x.commande, x.ht])).toEqual([
      ['BR-2025-002', '2025-12-28', 'Grossiste Sfax', 'BCF-2025-002', 1897.35],
      ['BR-2025-003', '2025-12-30', 'Quincaillerie du Nord', 'BCF-2025-003', 52.5],
    ]);
    expect(r.total).toBe(1949.85);
    // Au 31 janvier, la facture du 8 couvre r2 ; r4, reçue le 5, attend encore la sienne.
    expect(C.receptionsSansFactureAu(droguerie(), '2026-01-31').receptions.map((x) => [x.numero, x.ht])).toEqual([['BR-2025-003', 52.5], ['BR-2026-001', 315]]);
  });

  it('l\'état du stock au 31/12 compte la marchandise reçue, et porte ce qui est reçu sans facture', () => {
    const e = C.etatDuStock(droguerie(), '2025-12-31');
    // 40 à 61 et 20 à 63 (3 700), 23 sortis à 61,667 (1 418,341) : 2 281,659 ; +10 à 63,5 (635) et +30 à 63,245
    // (1 897,350) reçus en décembre : 77 pots, 4 814,009 ; coût unitaire 4 814,009 / 77 = 62,520. La brosse n'est pas suivie.
    expect(e.lignes.map((l) => [l.libelle, l.quantite, l.cout, l.valeur])).toEqual([['Peinture murale blanche 10 L', 77, 62.52, 4814.009]]);
    expect(e.total).toBe(4814.009);
    expect(e.sansFacture.total).toBe(1949.85);
  });

  it('au Cabinet : 607 au débit pour le total, un 408 par fournisseur, au jour de l\'état ; rien reçu sans facture, rien à passer', () => {
    const e = C.etatDuStock(droguerie(), '2025-12-31');
    const r = KC.ecritureFacturesNonParvenues(e, 2025);
    expect(r.ok).toBe(true);
    expect(r.ecriture).toMatchObject({ journal: 'OD', date: '2025-12-31', piece: 'FNP-2025', libelle: 'Factures non parvenues au 31/12/2025' });
    expect(r.ecriture?.lignes.map((l) => [l.compte, l.libelle, l.debit, l.credit])).toEqual([
      ['607', 'Reçu sans facture au 31/12/2025', 1949.85, 0],
      ['408', 'Facture non parvenue — Grossiste Sfax', 0, 1897.35],
      ['408', 'Facture non parvenue — Quincaillerie du Nord', 0, 52.5],
    ]);
    // Deux réceptions du même fournisseur font une seule ligne au 408 (une facture non parvenue par fournisseur).
    const deux = { date: '2025-12-31', sansFacture: { receptions: [{ fournisseur: 'Grossiste Sfax', ht: 1897.35 }, { fournisseur: 'Grossiste Sfax', ht: 10.005 }] } };
    expect(KC.ecritureFacturesNonParvenues(deux, 2025).ecriture?.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual([['607', 1907.355, 0], ['408', 0, 1907.355]]);
    expect(KC.ecritureFacturesNonParvenues({ date: '2025-12-31', sansFacture: { receptions: [] } }, 2025))
      .toEqual({ ok: false, motif: 'Le client n\'a rien reçu sans facture à cette date : il n\'y a pas de facture non parvenue à passer.' });
    expect(KC.ecritureFacturesNonParvenues(e, 2026).motif).toBe('L\'état du 31/12/2025 n\'est pas de l\'exercice 2026.');
  });
});
