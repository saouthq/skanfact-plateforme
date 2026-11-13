// Le chèque revenu impayé (1.359.0, bout en bout 21). Le rejet est un règlement NÉGATIF qui désigne le paiement qu'il
// annule (`rejetDe`) : la facture redevient due, ni le paiement rejeté ni le rejet ne comptent comme un « dernier
// règlement », la Trésorerie l'appelle « Chèque impayé », et la relance le dit d'abord au client.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, unknown>;
const C = ecranDeLaPlateforme('core.js') as {
  invoiceBalance: (d: Obj, data: Obj, company: Obj) => { remaining: number; paid: number };
  estRejet: (p: Obj) => boolean;
  estRemboursement: (p: Obj) => boolean;
  paiementsTenus: (d: Obj) => Obj[];
  rejetDuPaiement: (d: Obj, p: Obj) => Obj | null;
  dateDernierReglement: (d: Obj) => string;
  cashMovements: (data: Obj, company: Obj) => { id: string; label: string; kind: string }[];
  emailFor: (kind: string, doc: Obj, client: Obj, company: Obj, extra: Obj, data: Obj) => { body: string };
  libelleImpaye: (m: string) => string;
};

const company = { name: 'Pâtisserie Amira', currency: 'DT', stampFee: 1, defaultLang: 'fr' };
const client = { id: 'c1', name: 'Hôtel Mouradi Gammarth', email: 'compta@exemple.tn' };
const virement = { id: 'p0', date: '2026-10-20', amount: 24, method: 'virement', reference: 'VIR-01' };
const cheque = { id: 'p1', date: '2026-11-02', amount: 976, method: 'cheque', reference: 'CHQ 4521873 ATB' };
const rejet = { id: 'r1', date: '2026-11-06', amount: -976, method: 'cheque', reference: 'Rejet CHQ 4521873 ATB', rejetDe: 'p1' };
const facture = (payments: Obj[], lang = 'fr') => ({
  id: 'f1', type: 'facture', number: 'FAC-2026-014', status: 'envoyée', clientId: 'c1', date: '2026-10-01', dueDate: '2026-10-31', lang,
  lines: [{ label: 'Buffet', qty: 1, unitPrice: 1000, vatRate: 0 }], applyStamp: false, payments,
});
const donnees = (d: Obj) => ({ documents: [d], clients: [client], accounts: [{ id: 'b1', name: 'BIAT', kind: 'banque', isDefault: true }], movements: [] });

describe('le chèque revenu impayé', () => {
  it('la facture redevient due ; le paiement rejeté et son rejet ne sont ni « tenus » ni un dernier règlement', () => {
    const f = facture([virement, cheque, rejet]);
    expect(C.invoiceBalance(f, donnees(f), company).remaining).toBe(976);
    expect(C.estRejet(rejet)).toBe(true);
    expect(C.estRemboursement(rejet)).toBe(false);
    expect(C.rejetDuPaiement(f, cheque)).toBe(rejet);
    expect(C.rejetDuPaiement(f, virement)).toBeNull();
    expect(C.paiementsTenus(f).map((p) => p.id)).toEqual(['p0']);
    expect(C.dateDernierReglement(f)).toBe('2026-10-20');
    // Sans le rejet, le chèque est le dernier règlement.
    expect(C.dateDernierReglement(facture([virement, cheque]))).toBe('2026-11-02');
  });

  it('la Trésorerie l\'appelle par son nom, et un remboursement garde le sien', () => {
    const f = facture([virement, cheque, rejet, { id: 'p9', date: '2026-11-10', amount: -5, method: 'virement' }]);
    const m = C.cashMovements(donnees(f), company);
    expect(m.find((x) => x.id === 'r1')).toMatchObject({ label: 'Chèque impayé FAC-2026-014', kind: 'decaissement' });
    expect(m.find((x) => x.id === 'p9')).toMatchObject({ label: 'Remboursement FAC-2026-014' });
    expect(C.libelleImpaye('traite')).toBe('Effet impayé');
  });

  it('la relance le dit après la salutation, sans toucher au reste du modèle ; en anglais aussi', () => {
    const sans = C.emailFor('relance1', facture([virement]), client, company, {}, donnees(facture([virement]))).body;
    expect(sans).not.toMatch(/impayé/);
    const f = facture([virement, cheque, rejet]);
    const avec = C.emailFor('relance1', f, client, company, {}, donnees(f)).body;
    const [salut, phrase, ...reste] = avec.split('\n\n');
    expect(salut).toBe('Bonjour,');
    expect(String(phrase).replace(/\s/g, ' ')).toBe('Votre chèque CHQ 4521873 ATB du 02/11/2026 (976,000 DT) nous est revenu impayé le 06/11/2026.');
    // Le reste est le modèle tel quel : la même facture, sans le chèque, doit déjà 976 DT.
    expect(reste.join('\n\n')).toBe(sans.split('\n\n').slice(1).join('\n\n'));
    const en = facture([virement, cheque, rejet], 'en');
    expect(C.emailFor('relance1', en, client, company, {}, donnees(en)).body).toMatch(/Your cheque CHQ 4521873 ATB of 02\/11\/2026 \(976\.000\sDT\) was returned unpaid on 06\/11\/2026\./);
  });
});
