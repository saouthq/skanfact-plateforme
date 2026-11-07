// 1.322.0 (les garanties jouées par un installateur de climatisation, jusqu'au bilan) : à la clôture, le comptable juge s'il
// faut une provision pour les réparations que l'entreprise fera gratuitement sur ce qu'elle a vendu. L'état du parc sous
// garantie lui dit, par article, combien d'appareils livrés sont encore garantis au 31 décembre, ce qu'ils ont été vendus
// hors taxes et jusqu'à quand court la plus longue garantie. Les données discriminent : une remise de ligne (2 380,500 − 5 %
// = 2 261,475), une remise globale (1 890,333 − 5 % = 1 795,816), une garantie finie le 01/11/2025, un onduleur livré en
// janvier, un PC sans garantie, un climatiseur encore en stock. Les montants attendus sont calculés à la main.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Donnees = Record<string, unknown>;
type Article = { libelle: string; nombre: number; ht: number; fin: string };
type Etat = { date: string; nombre: number; clients: number; ht: number; articles: Article[]; annee: { nombre: number; ht: number } };
const C = ecranDeLaPlateforme('core.js') as { etatDesGaranties: (data: Donnees, date: string, company?: Donnees) => Etat };
const KC = ecranDeLaPlateforme('compta.js') as {
  ecritureProvisionGaranties: (etat: unknown, montant: unknown, annee: number) => {
    ok: boolean; motif?: string; montant?: number;
    ecriture?: { journal: string; date: string; piece: string; libelle: string; lignes: { compte: string; debit: number; credit: number }[] };
  };
};

const facture = (id: string, date: string, clientId: string, itemId: string, qty: number, unitPrice: number, extra: Donnees = {}) => ({
  id, type: 'facture', number: `FAC-${id}`, status: 'envoyée', date, dueDate: date, clientId, currency: 'DT', stampFee: 1, payments: [], discountRate: 0,
  lines: [{ label: itemId, itemId, qty, unitPrice, vatRate: 19 }], ...extra });
const serie = (id: string, itemId: string, serial: string, status: string, outDate: string, outDocId: string, clientId: string, warrantyMonths: number) =>
  ({ id, itemId, serial, status, inDate: '2023-01-10', outDate, outDocId, clientId, warrantyMonths });
const installateur = (): Donnees => ({
  company: { currency: 'DT' },
  catalog: [
    { id: 'clim', label: 'Climatiseur 12 000 BTU', serialized: true, tracked: true, warrantyMonths: 24, unitPrice: 2450, vatRate: 19 },
    { id: 'ond', label: 'Onduleur 3 kVA', serialized: true, tracked: true, warrantyMonths: 12, unitPrice: 1890.333, vatRate: 19 },
    { id: 'pc', label: 'PC portable', serialized: true, tracked: true, warrantyMonths: 0, unitPrice: 1450, vatRate: 19 },
  ],
  clients: [{ id: 'c1', name: 'Hôtel Le Golfe' }, { id: 'c2', name: 'Clinique Les Pins' }],
  documents: [
    facture('f1', '2024-03-15', 'c1', 'clim', 1, 2450),
    facture('f2', '2025-06-10', 'c2', 'clim', 1, 2380.5, { lines: [{ label: 'clim', itemId: 'clim', qty: 1, unitPrice: 2380.5, vatRate: 19, discount: 5 }] }),
    facture('f3', '2025-12-20', 'c1', 'ond', 1, 1890.333, { discountRate: 5 }),
    facture('f4', '2023-11-02', 'c1', 'clim', 1, 2300),
    facture('f5', '2026-01-05', 'c2', 'ond', 1, 1900),
    facture('f6', '2025-05-05', 'c2', 'pc', 1, 1450),
  ],
  serials: [
    serie('s1', 'clim', 'CL-24-0091', 'vendu', '2024-03-15', 'f1', 'c1', 24),
    serie('s2', 'clim', 'CL-25-0412', 'vendu', '2025-06-10', 'f2', 'c2', 24),
    serie('s3', 'ond', 'ON-25-1107', 'vendu', '2025-12-20', 'f3', 'c1', 12),
    serie('s4', 'clim', 'CL-23-0017', 'vendu', '2023-11-02', 'f4', 'c1', 24),
    serie('s5', 'ond', 'ON-26-0003', 'vendu', '2026-01-05', 'f5', 'c2', 12),
    serie('s6', 'pc', 'PC-25-0550', 'vendu', '2025-05-05', 'f6', 'c2', 0),
    serie('s7', 'clim', 'CL-25-0500', 'stock', '', '', '', 24),
  ],
});

describe('les garanties jusqu\'au bilan (1.322.0)', () => {
  it('au 31/12 : ce qui est livré et encore garanti, par article, à sa valeur de vente hors taxes ; et les ventes garanties de l\'année', () => {
    const e = C.etatDesGaranties(installateur(), '2025-12-31');
    // s1 (jusqu'au 14/03/2026) et s2 (jusqu'au 09/06/2027) ; s3 (jusqu'au 19/12/2026). s4 a fini le 01/11/2025, s5 arrive en
    // janvier, s6 n'a pas de garantie, s7 est en stock.
    expect(e.articles.map((a) => [a.libelle, a.nombre, a.ht, a.fin])).toEqual([
      ['Climatiseur 12 000 BTU', 2, 4711.475, '2027-06-09'],
      ['Onduleur 3 kVA', 1, 1795.816, '2026-12-19'],
    ]);
    expect([e.date, e.nombre, e.clients, e.ht]).toEqual(['2025-12-31', 3, 2, 6507.291]);
    // Vendus en 2025 avec une garantie : s2 et s3 (le PC n'en a pas).
    expect(e.annee).toEqual({ nombre: 2, ht: 4057.291 });
    // Au 31/03/2026, la garantie de s1 est finie, s5 est livré.
    const avril = C.etatDesGaranties(installateur(), '2026-03-31');
    expect(avril.articles.map((a) => [a.libelle, a.nombre, a.ht])).toEqual([['Climatiseur 12 000 BTU', 1, 2261.475], ['Onduleur 3 kVA', 2, 3695.816]]);
    expect(avril.annee).toEqual({ nombre: 1, ht: 1900 });
  });

  it('un appareil rendu n\'est plus garanti chez le client ; une facture en euros se compte en dinars', () => {
    const d = installateur();
    const series = d.serials as Donnees[];
    (series[1] as Donnees).status = 'retour';
    const docs = d.documents as Donnees[];
    Object.assign(docs[2] as Donnees, { currency: 'EUR', exchangeRate: 3.4 });
    const e = C.etatDesGaranties(d, '2025-12-31');
    // s2 rendu : il sort du parc (mais reste une vente garantie de l'année) ; s3, une pièce en euros, se compte au centime :
    // 1 890,33 − 94,52 de remise = 1 795,81 €, × 3,4 = 6 105,754 DT.
    expect(e.articles.map((a) => [a.libelle, a.nombre, a.ht])).toEqual([['Climatiseur 12 000 BTU', 1, 2450], ['Onduleur 3 kVA', 1, 6105.754]]);
    expect(e.annee).toEqual({ nombre: 2, ht: 8367.229 });
  });

  it('au Cabinet : la provision au jour de l\'état, 6815 / 1512, au plus ce que ces appareils ont été vendus hors taxes', () => {
    const e = C.etatDesGaranties(installateur(), '2025-12-31');
    const r = KC.ecritureProvisionGaranties(e, '850,500', 2025);
    expect(r.ok).toBe(true);
    expect(r.ecriture).toMatchObject({ journal: 'OD', date: '2025-12-31', piece: 'PROV-GAR-2025', libelle: 'Provision pour garanties au 31/12/2025' });
    expect(r.ecriture?.lignes.map((x) => [x.compte, x.debit, x.credit])).toEqual([['6815', 850.5, 0], ['1512', 0, 850.5]]);
    expect(KC.ecritureProvisionGaranties(e, 6507.291, 2025).ok).toBe(true);
    expect(KC.ecritureProvisionGaranties(e, 6507.292, 2025).motif).toBe('Une provision pour garanties ne dépasse pas ce que ces appareils ont été vendus hors taxes (6 507,291).');
    expect(KC.ecritureProvisionGaranties(e, ' ', 2025).motif).toBe('Le montant de la provision manque : écris ce que tu retiens.');
    expect(KC.ecritureProvisionGaranties(e, 850, 2026).motif).toBe('L\'état du 31/12/2025 n\'est pas de l\'exercice 2026.');
    expect(KC.ecritureProvisionGaranties(C.etatDesGaranties(installateur(), '2028-12-31'), 850, 2028).motif)
      .toBe('Aucun appareil n\'est sous garantie à cette date : il n\'y a pas de provision à passer.');
  });
});
