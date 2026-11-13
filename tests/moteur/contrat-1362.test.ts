// La facture d'un contrat mensuel (1.362.0, bout en bout 25). L'hôtel est réglé à soixante jours sur sa fiche : la facture
// tapée à la main pour lui tombait à soixante jours, celle que son contrat prépare chaque mois à trente — le délai des
// réglages —, et la relance partait un mois trop tôt. Deux chemins, une échéance : l'écran (`buildRecurringInvoice`, et
// `echeancePour` que l'éditeur appelle) et le serveur qui émet seul (`factureDuContrat`). Les dates attendues sont
// comptées à la main sur le calendrier.

import { describe, expect, it } from 'vitest';
import { factureDuContrat } from '../../serveur/v10/contrats.ts';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const societe = { ...C.DEFAULT_COMPANY, currency: 'DT', paymentTermsDays: 30 };
const contrat = { id: 'r1', clientId: 'h1', subject: 'Viennoiseries — {mois}', lines: [{ label: 'Forfait', qty: 1, unitPrice: 1200, vatRate: 19 }], every: 'month', day: 13 };

describe('l\'échéance de la facture d\'un contrat', () => {
  const cas: [string, Obj | null, string][] = [
    ['un client sans délai à lui : celui des réglages (30 jours)', { id: 'h1', name: 'Hôtel' }, '2026-12-13'],
    ['l\'hôtel à soixante jours', { id: 'h1', name: 'Hôtel', paymentTermsDays: 60 }, '2027-01-12'],
    ['à trente jours fin de mois', { id: 'h1', name: 'Hôtel', paymentTermsDays: 30, paymentTermsEom: true }, '2026-12-31'],
    ['à réception (zéro est un délai)', { id: 'h1', name: 'Hôtel', paymentTermsDays: 0 }, '2026-11-13'],
    ['un délai vide sur la fiche : celui des réglages', { id: 'h1', name: 'Hôtel', paymentTermsDays: '' }, '2026-12-13'],
    ['sans fiche du client : celui des réglages', null, '2026-12-13'],
  ];
  it.each(cas)('%s', (_titre, client, attendu) => {
    expect(C.echeancePour('2026-11-13', client, societe)).toBe(attendu);
    expect(C.buildRecurringInvoice(contrat, '2026-11-13', societe, client).dueDate).toBe(attendu);
    // Le serveur qui émet seul tombe le même jour que l'écran.
    expect(factureDuContrat(contrat, '2026-11-13', societe, client).dueDate).toBe(attendu);
  });
  it('la vente à l\'exportation du contrat passe à chaque facture : lignes à 0 %, sans timbre', () => {
    const lyon = { ...contrat, clientId: 'o1', currency: 'EUR', exchangeRate: 3.4, export: true, lines: [{ label: 'Pain de mie', qty: 1, unitPrice: 300, vatRate: 19 }] };
    for (const f of [C.buildRecurringInvoice(lyon, '2026-11-13', societe, { id: 'o1' }), factureDuContrat(lyon, '2026-11-13', societe, { id: 'o1' })]) {
      expect([f.export, f.lines.map((l: Obj) => l.vatRate)]).toEqual([true, [0]]);
      const t = C.computeTotals(f, societe);
      // 300 € HT, ni TVA ni timbre : le net est le HT.
      expect([t.totalVAT, t.stamp, t.netToPay]).toEqual([0, 0, 300]);
    }
    // Sans la case, rien ne change : la ligne garde son taux.
    expect(C.buildRecurringInvoice({ ...lyon, export: undefined }, '2026-11-13', societe, { id: 'o1' }).lines[0].vatRate).toBe(19);
  });
  it('la fin de mois tient sur février, et sur un délai qui franchit l\'année', () => {
    const fdm = (j: number) => ({ id: 'h1', name: 'Hôtel', paymentTermsDays: j, paymentTermsEom: true });
    expect(C.echeancePour('2027-01-31', fdm(30), societe)).toBe('2027-03-31');
    expect(C.echeancePour('2027-01-15', fdm(30), societe)).toBe('2027-02-28');
    expect(factureDuContrat(contrat, '2027-01-15', societe, fdm(30)).dueDate).toBe('2027-02-28');
    expect(C.echeancePour('2026-12-10', fdm(30), societe)).toBe('2027-01-31');
    expect(factureDuContrat(contrat, '2026-12-10', societe, fdm(30)).dueDate).toBe('2027-01-31');
  });
});
