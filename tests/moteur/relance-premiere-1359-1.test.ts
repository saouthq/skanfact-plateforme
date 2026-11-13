// La première relance d'une facture très en retard (1.359.1). Le ton de la dernière relance vient du retard (plus de 45
// jours), mais « Malgré nos précédents rappels » racontait des rappels qui n'avaient pas eu lieu : le modèle d'origine les
// tait quand la facture n'a jamais été relancée, et les garde dès qu'elle l'a été. Un modèle réécrit reste celui de la
// personne, mot pour mot.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, unknown>;
const C = ecranDeLaPlateforme('core.js') as {
  emailFor: (kind: string, doc: Obj, client: Obj, company: Obj, extra: Obj, data: Obj) => { subject: string; body: string };
};

const company = { name: 'Pâtisserie Amira', currency: 'DT', stampFee: 1, defaultLang: 'fr' };
const client = { id: 'c1', name: 'Hôtel Mouradi Gammarth', email: 'compta@exemple.tn' };
const facture = (reminders: Obj[], lang = 'fr') => ({
  id: 'f1', type: 'facture', number: 'FAC-2026-014', status: 'envoyée', clientId: 'c1', date: '2026-08-01', dueDate: '2026-08-31', lang,
  lines: [{ label: 'Buffet', qty: 1, unitPrice: 1000, vatRate: 0 }], applyStamp: false, payments: [], reminders,
});
const donnees = (d: Obj) => ({ documents: [d], clients: [client], accounts: [], movements: [] });
const mail = (kind: string, d: Obj, co: Obj = company) => C.emailFor(kind, d, client, co, { jours: '74' }, donnees(d));
const rappel = { date: '2026-09-20', level: 1, channel: 'email' };

describe('la première relance d\'une facture très en retard', () => {
  it('ne parle pas de rappels qui n\'ont pas eu lieu ; les garde dès qu\'il y en a eu', () => {
    const premiere = mail('relance3', facture([])).body;
    expect(premiere).not.toMatch(/précédents rappels/);
    expect(premiere).toMatch(/\n\nLa facture FAC-2026-014 \(1\s000,000\sDT, échue le 31\/08\/2026\) reste impayée après 74 jours\./);
    expect(mail('relance3', facture([rappel])).body).toContain('Malgré nos précédents rappels, la facture FAC-2026-014');
    // Un appel noté compte aussi : c'est un rappel que le client a reçu.
    expect(mail('relance3', facture([{ date: '2026-09-20', level: 1, channel: 'appel' }])).body).toContain('Malgré nos précédents rappels');
  });

  it('en anglais aussi, et « Second reminder » ne se dit pas d\'une première relance', () => {
    const en = mail('relance3', facture([], 'en'));
    expect(en.body).toContain('\n\nInvoice FAC-2026-014 (1,000.000');
    expect(en.body).not.toMatch(/previous reminders/);
    expect(mail('relance2', facture([], 'en')).subject).toMatch(/^Reminder — invoice FAC-2026-014/);
    expect(mail('relance2', facture([rappel], 'en')).subject).toMatch(/^Second reminder — invoice FAC-2026-014/);
  });

  it('une note d\'honoraires suit la même règle ; un modèle réécrit reste mot pour mot', () => {
    const liberal = { ...company, activity: 'sante' };
    const n = mail('relance3', facture([]), liberal).body;
    expect(n).toContain('\n\nLa note d\'honoraires FAC-2026-014');
    expect(n).not.toMatch(/précédents rappels/);
    const perso = { ...company, emailTemplates: { relance3: { subject: 'Ultime relance {numero}', body: 'Bonjour,\n\nMalgré nos précédents rappels, nous attendons {montant}.' } } };
    expect(mail('relance3', facture([]), perso).body).toMatch(/Malgré nos précédents rappels, nous attendons 1\s000,000\sDT\./);
  });
});
