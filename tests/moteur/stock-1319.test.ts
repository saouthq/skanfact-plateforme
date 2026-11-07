// 1.319.0 (le Stock joué par une droguerie de l'Ariana) : l'état du stock que l'entreprise envoie à son comptable, et
// l'inventaire que le comptable en reprend. Deux chemins, un chiffre : la valeur de l'état est celle de la page Stock au
// millime (le coût moyen exact), et l'inventaire du Cabinet repris de lui vaut la même somme — pas la quantité fois le coût
// arrondi. Les données discriminent : 40 pots à 61 puis 20 à 63 (3 700 pour 60, coût moyen arrondi 61,667) ; 23 sortis à
// 61,667, il en reste 37 qui valent 3 700 − 1 418,341 = 2 281,659 (et non 37 × 61,667 = 2 281,679) ; leur coût unitaire est
// 2 281,659 / 37 = 61,666. Les montants attendus sont calculés à la main.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Donnees = Record<string, unknown>;
type Ligne = { itemId?: string; ref: string; libelle: string; quantite: number; cout: number; valeur?: number };
const C = ecranDeLaPlateforme('core.js') as {
  etatDuStock: (data: Donnees, date: string) => { date: string; total: number; lignes: (Ligne & { unite: string })[] };
  stockTotals: (data: Donnees, date: string) => { value: number };
};
const KC = ecranDeLaPlateforme('compta.js') as {
  lignesInventaireDepuisTexte: (t: string) => { lignes: Ligne[]; refus: { motif: string }[] };
  inventaireValide: (inv: Donnees) => { ok: boolean; motifs: string[] };
  totalInventaire: (inv: Donnees) => number;
};

const article = (id: string, label: string, extra: Donnees = {}) => ({ id, label, unit: 'pot', unitPrice: 89, vatRate: 19, tracked: true, ...extra });
const achat = (id: string, date: string, itemId: string, qty: number, unitPrice: number) => ({
  id, kind: 'facture', number: `FA-${id}`, date, supplierId: 'f1', currency: 'DT', createdAt: Date.parse(date), payments: [],
  lines: [{ label: itemId, itemId, qty, unitPrice, vatRate: 19, destination: 'stock', deductible: true }] });
const sortie = (id: string, date: string, itemId: string, qty: number) => ({ id, date, itemId, qty: -qty, unitCost: '', source: 'ajustement' });
const droguerie = (): Donnees => ({
  company: { currency: 'DT' },
  catalog: [
    article('peint', 'Peinture murale blanche 10 L', { code: 'PNT-10', initialQty: 40, initialCost: 61, initialDate: '2025-01-02' }),
    article('mastic', 'Mastic de la maison', { unit: 'tube', initialQty: 20, initialCost: 1.8, initialDate: '2025-01-02' }),
    article('vernis', 'Vernis bois 1 L', { initialQty: 5, initialCost: 22, initialDate: '2025-01-02' }),
    { id: 'pose', label: 'Pose (heure)', unitPrice: 25, vatRate: 19 },
  ],
  purchases: [achat('p1', '2025-03-10', 'peint', 20, 63)],
  documents: [],
  // 23 pots sortis en juin, les 5 vernis tous partis en octobre ; 3 pots de plus sortis en janvier 2026 (après la date).
  stockAdjustments: [sortie('s1', '2025-06-15', 'peint', 23), sortie('s2', '2025-10-01', 'vernis', 5), sortie('s3', '2026-01-12', 'peint', 3)],
});

describe('l\'état du stock pour le comptable (1.319.0)', () => {
  it('au 31/12 : chaque article qui a du stock, à sa valeur de la page Stock ; le total est la valeur du stock au millime', () => {
    const data = droguerie();
    const e = C.etatDuStock(data, '2025-12-31');
    // Le vernis, à zéro, n'y est pas ; la pose n'est pas suivie en stock ; la sortie de janvier 2026 ne compte pas.
    expect(e.lignes.map((l) => [l.ref, l.libelle, l.unite, l.quantite, l.cout, l.valeur])).toEqual([
      ['', 'Mastic de la maison', 'tube', 20, 1.8, 36],
      ['PNT-10', 'Peinture murale blanche 10 L', 'pot', 37, 61.666, 2281.659],
    ]);
    expect(e.total).toBe(2317.659);
    expect(e.total).toBe(C.stockTotals(data, '2025-12-31').value);
    // 37 × 61,667 = 2 281,679 : la quantité fois le coût moyen arrondi n'est pas la valeur du stock.
    expect(Math.round(37 * 61.667 * 1000) / 1000).toBe(2281.679);
  });

  it('l\'inventaire du Cabinet repris de cet état vaut la même somme : la valeur dite de chaque ligne, contrôlée', () => {
    const e = C.etatDuStock(droguerie(), '2025-12-31');
    // Ce que la saisie du Cabinet reçoit : cinq colonnes, la référence vide en tête pour le mastic.
    const texte = e.lignes.map((l) => [l.ref, l.libelle, String(l.quantite).replace('.', ','), String(l.cout).replace('.', ','), String(l.valeur).replace('.', ',')].join('\t')).join('\n');
    const lu = KC.lignesInventaireDepuisTexte(texte);
    expect(lu.refus).toEqual([]);
    expect(lu.lignes.map((l) => [l.ref, l.libelle, l.quantite, l.cout, l.valeur])).toEqual([
      ['', 'Mastic de la maison', 20, 1.8, 36],
      ['PNT-10', 'Peinture murale blanche 10 L', 37, 61.666, 2281.659],
    ]);
    const inv = { date: e.date, compte: '37', lignes: lu.lignes };
    expect(KC.inventaireValide(inv)).toEqual({ ok: true, motifs: [] });
    expect(KC.totalInventaire(inv)).toBe(e.total);
    // Une ligne sans valeur se calcule comme avant (quantité fois coût).
    expect(KC.totalInventaire({ lignes: [{ ref: '', libelle: 'Peinture', quantite: 37, cout: 61.667 }] })).toBe(2281.679);
  });

  it('une valeur qui n\'est pas la quantité fois le coût, à l\'arrondi près, est refusée en le disant', () => {
    // 37 × 61,667 = 2 281,679 ; l'arrondi du coût au millime permet 37 × 0,0005 + 0,001 = 0,0195 d'écart, pas 0,100.
    const lu = KC.lignesInventaireDepuisTexte('PNT-10\tPeinture\t37\t61,667\t2281,579');
    expect(KC.inventaireValide({ date: '2025-12-31', lignes: lu.lignes }).motifs).toEqual(['Ligne 1 : la valeur 2\u202f281,579 n\'est pas la quantité fois le coût unitaire (2\u202f281,679).']);
    expect(KC.inventaireValide({ date: '2025-12-31', lignes: KC.lignesInventaireDepuisTexte('PNT-10\tPeinture\t37\t61,667\t2281,661').lignes }).ok).toBe(true);
    expect(KC.lignesInventaireDepuisTexte('PNT-10\tPeinture\t37\t61,667\tdeux mille').refus.map((r) => r.motif))
      .toEqual(['Ligne 1 (Peinture) : « deux mille » n\'est pas une valeur. Écris-la en chiffres.']);
  });

  it('la tabulation de tête reste la case vide de la référence ; une ligne à quatre ou trois cases se lit comme avant', () => {
    const l = (t: string) => KC.lignesInventaireDepuisTexte(t).lignes.map((x) => [x.ref, x.libelle, x.quantite, x.cout, x.valeur]);
    expect(l('\tMastic\t20\t1,8\t36')).toEqual([['', 'Mastic', 20, 1.8, 36]]);
    expect(l('REF-01\tCâble HDMI 2 m\t24\t7,500')).toEqual([['REF-01', 'Câble HDMI 2 m', 24, 7.5, undefined]]);
    expect(l('Câble HDMI 2 m;24;7,5;')).toEqual([['', 'Câble HDMI 2 m', 24, 7.5, undefined]]);
  });
});
