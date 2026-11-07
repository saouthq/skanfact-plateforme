// 1.321.0 (les relances jouées par une société d'ascenseurs, jusqu'au bilan) : une facture que le client CONTESTE ne se
// relance plus, et l'état des impayés envoyé au comptable dit, pour chaque facture en retard, ce qui reste dû (TTC et HT au
// prorata), le retard, les relances et le litige noté ; le comptable en tire une provision (6817 / 491). Les données
// discriminent : 2 500 HT + 19 % + 1 de timbre = 2 976, 1 000 payés, reste 1 976 dont 1 659,946 HT (1 976 × 2 500 / 2 976) ;
// 840,500 HT + 19 % + 1 = 1 001,195. Les montants attendus sont calculés à la main.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Donnees = Record<string, unknown>;
type Ligne = { numero: string; client: string; retard: number; resteTTC: number; resteHT: number; relances: number; derniereRelance: string; litige: string; litigeDepuis: string };
const C = ecranDeLaPlateforme('core.js') as {
  overdueInvoices: (data: Donnees, company: Donnees, today: string) => { doc: { number: string }; litige: { note: string } | null }[];
  aRelancer: (x: unknown) => boolean;
  etatDesImpayes: (data: Donnees, company: Donnees, today: string) => { lignes: Ligne[]; total: number; contestees: number };
};
const KC = ecranDeLaPlateforme('compta.js') as {
  ecritureProvisionCreance: (ligne: unknown, montant: unknown, au: string) => {
    ok: boolean; motif?: string; montant?: number;
    ecriture?: { journal: string; date: string; piece: string; libelle: string; lignes: { compte: string; debit: number; credit: number }[] };
  };
};

const facture = (id: string, number: string, date: string, dueDate: string, clientId: string, unitPrice: number, extra: Donnees = {}) => ({
  id, type: 'facture', number, status: 'envoyée', date, dueDate, clientId, currency: 'DT', stampFee: 1, payments: [],
  lines: [{ label: 'Maintenance d\'ascenseur', qty: 1, unitPrice, vatRate: 19 }], ...extra });
const societe = (): Donnees => ({
  company: { currency: 'DT' },
  clients: [{ id: 'c1', name: 'Bâtiments Ezzahra' }, { id: 'c2', name: 'Hôtel Le Golfe' }],
  documents: [
    facture('f1', 'FAC-2025-041', '2025-09-01', '2025-10-01', 'c1', 2500, {
      payments: [{ id: 'p1', date: '2025-10-15', amount: 1000, method: 'virement' }],
      reminders: [{ date: '2025-10-10', level: 1, channel: 'email' }, { date: '2025-11-05', level: 2, channel: 'tel', note: 'il conteste deux cabines' }],
      litige: { depuis: '2025-11-05', note: 'Il dit n\'avoir reçu que 8 cabines sur 10' } }),
    facture('f2', 'FAC-2025-052', '2025-11-20', '2025-12-20', 'c2', 840.5),
    facture('f3', 'FAC-2026-003', '2026-01-05', '2026-02-05', 'c2', 300),
  ],
});
const CO = { currency: 'DT' };

describe('les relances jusqu\'au bilan (1.321.0)', () => {
  it('une facture contestée reste en retard mais ne se relance plus ; un litige sans note n\'en est pas un', () => {
    const data = societe();
    const od = C.overdueInvoices(data, CO, '2026-01-15');
    expect(od.map((x) => [x.doc.number, x.litige ? x.litige.note : null, C.aRelancer(x)])).toEqual([
      ['FAC-2025-041', 'Il dit n\'avoir reçu que 8 cabines sur 10', false],
      ['FAC-2025-052', null, true],
    ]);
    ((data.documents as Donnees[])[0] as Donnees).litige = { depuis: '2025-11-05', note: '   ' };
    expect(C.aRelancer(C.overdueInvoices(data, CO, '2026-01-15')[0])).toBe(true);
  });

  it('l\'état des impayés : le reste TTC et HT au prorata, le retard, les relances, le litige ; la contestée d\'abord', () => {
    const e = C.etatDesImpayes(societe(), CO, '2026-01-15');
    expect(e.lignes.map((l) => [l.numero, l.client, l.retard, l.resteTTC, l.resteHT, l.relances, l.derniereRelance, l.litige, l.litigeDepuis])).toEqual([
      ['FAC-2025-041', 'Bâtiments Ezzahra', 106, 1976, 1659.946, 2, '2025-11-05', 'Il dit n\'avoir reçu que 8 cabines sur 10', '2025-11-05'],
      ['FAC-2025-052', 'Hôtel Le Golfe', 26, 1001.195, 840.5, 0, '', '', ''],
    ]);
    expect([e.total, e.contestees]).toEqual([2977.195, 1]);
    // La contestée vient d'abord, même moins en retard : c'est elle que le comptable regarde en premier.
    const d2 = societe(), docs = d2.documents as Donnees[];
    delete (docs[0] as Donnees).litige;
    (docs[1] as Donnees).litige = { depuis: '2026-01-02', note: 'Le contrat de maintenance est résilié' };
    expect(C.etatDesImpayes(d2, CO, '2026-01-15').lignes.map((l) => [l.numero, l.litige])).toEqual([['FAC-2025-052', 'Le contrat de maintenance est résilié'], ['FAC-2025-041', '']]);
  });

  it('au Cabinet : la provision au dernier jour de l\'exercice, 6817 / 491, au plus le reste hors taxes', () => {
    const l = C.etatDesImpayes(societe(), CO, '2026-01-15').lignes[0];
    const r = KC.ecritureProvisionCreance(l, '1 200,500', '2025-12-31');
    expect(r.ok).toBe(true);
    expect(r.ecriture).toMatchObject({ journal: 'OD', date: '2025-12-31', piece: 'PROV-FAC-2025-041', libelle: 'Provision — FAC-2025-041 (Bâtiments Ezzahra)' });
    expect(r.ecriture?.lignes.map((x) => [x.compte, x.debit, x.credit])).toEqual([['6817', 1200.5, 0], ['491', 0, 1200.5]]);
    expect(KC.ecritureProvisionCreance(l, 1659.946, '2025-12-31').ok).toBe(true);
    expect(KC.ecritureProvisionCreance(l, 1659.947, '2025-12-31').motif).toBe('Une provision ne dépasse pas ce qui reste dû hors taxes (1 659,946).');
    expect(KC.ecritureProvisionCreance(l, '', '2025-12-31').motif).toBe('Le montant de la provision manque : écris ce que tu retiens, hors taxes.');
  });
});
