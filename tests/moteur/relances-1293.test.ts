// 1.293.0 — Les relances jouées comme une gérante (Bâtiments Ezzahra doit trois factures, l'Hôtel Le Golfe une, Mme
// Trabelsi promet un chèque) : une facture relancée attend sa réponse une semaine hors de « À relancer » et revient seule ;
// un client qui doit plusieurs factures reçoit UN message qui les nomme toutes, au ton du plus grand retard, et ce message
// ne parle de « précédentes relances » que s'il y en a eu.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const co = { ...C.DEFAULT_COMPANY, name: 'Ascenseurs Ben Salah', currency: 'DT', stampFee: 0 };
const T = '2026-11-06';
const fac = (id: string, clientId: string, dueDate: string, prix: number, extra: Obj = {}) => ({
  id, type: 'facture', status: 'envoyée', number: `FAC-${id}`, date: C.addDays(dueDate, -30), dueDate, clientId, currency: 'DT', issuedTs: 1,
  lines: [{ label: 'Travaux', qty: 1, unitPrice: prix, vatRate: 19 }], payments: [], applyStamp: false, ...extra,
});
// Les montants s'écrivent avec des espaces insécables : on compare le texte lu.
const sp = (t: string) => t.replace(/[\u00a0\u202f]/g, ' ');
const base = (docs: Obj[]): Obj => ({ company: co, clients: [{ id: 'c1', name: 'Bâtiments Ezzahra' }, { id: 'c2', name: 'Hôtel Le Golfe' }], documents: docs, purchases: [] });

describe('relances 1.293.0', () => {
  it('relancée il y a moins de 7 jours : elle attend sa réponse, sort de « À relancer », et revient le jour dit', () => {
    const d = base([
      fac('a', 'c1', '2026-09-07', 720, { reminders: [{ date: '2026-11-03', level: 3, channel: 'email' }] }),
      fac('b', 'c1', '2026-10-07', 3480.5, { reminders: [{ date: '2026-10-29', level: 2, channel: 'tel' }] }),
      fac('c', 'c2', '2026-10-17', 5584, { remindAfter: '2026-11-20', reminders: [{ date: '2026-11-05', level: 2, channel: 'tel' }] }),
    ]);
    const l = C.overdueInvoices(d, co, T);
    const de = (id: string) => l.find((x: Obj) => x.doc.id === id);
    // a : relancée le 03/11, on attend jusqu'au 10/11 inclus, elle revient le 10.
    expect([de('a').attente, de('a').remontre, C.aRelancer(de('a'))]).toEqual([true, '2026-11-10', false]);
    // b : relancée le 29/10, plus de 7 jours : à relancer de nouveau.
    expect([de('b').attente, C.aRelancer(de('b'))]).toEqual([false, true]);
    // c : reportée au 20/11 ; le report l'emporte sur l'attente (elle n'est pas comptée deux fois).
    expect([de('c').snoozed, de('c').attente, C.aRelancer(de('c'))]).toEqual([true, false, false]);
    // Le jour où l'attente finit, elle revient.
    expect(C.aRelancer(C.overdueInvoices(d, co, '2026-11-10').find((x: Obj) => x.doc.id === 'a'))).toBe(true);
    // « À faire » de l'accueil compte ce que la page compte, et nomme l'attente.
    const t = C.todoList(d, co, T).find((x: Obj) => x.id === 'retards');
    expect(t.count).toBe(1);
    expect(t.detail).toContain('1 relancée cette semaine, en attente de réponse');
  });

  it('par client : un groupe par client, le plus grand retard et son ton, le reste dû total', () => {
    const d = base([fac('a', 'c1', '2026-09-07', 720), fac('b', 'c1', '2026-10-07', 3480.5), fac('e', 'c1', '2026-10-27', 1250), fac('c', 'c2', '2026-10-17', 5584)]);
    const g = C.relancesParClient(C.overdueInvoices(d, co, T).filter(C.aRelancer), co);
    expect(g.map((x: Obj) => [x.clientId, x.factures.map((f: Obj) => f.doc.id), x.retard, x.level, x.reste])).toEqual([
      // 720 × 1,19 = 856,800 ; 3 480,500 × 1,19 = 4 141,795 ; 1 250 × 1,19 = 1 487,500 : 6 486,095 DT.
      ['c1', ['a', 'b', 'e'], 60, 3, 6486.095],
      ['c2', ['c'], 20, 2, 6644.96],
    ]);
  });

  it('le message groupé nomme chaque facture et le total ; « précédentes relances » seulement s\'il y en a eu', () => {
    const d = base([fac('a', 'c1', '2026-09-07', 720), fac('b', 'c1', '2026-10-07', 3480.5)]);
    const items = C.overdueInvoices(d, co, T);
    const m0 = C.relanceGroupee(items, { name: 'Bâtiments Ezzahra' }, co, 3);
    const m = { subject: sp(m0.subject), body: sp(m0.body) };
    expect(m.subject).toBe('Dernière relance : 2 factures en attente de règlement — Ascenseurs Ben Salah');
    expect(m.body).toContain('- FAC-a du 08/08/2026, échue le 07/09/2026 : 856,800 DT (60 jours de retard)');
    expect(m.body).toContain('- FAC-b du 07/09/2026, échue le 07/10/2026 : 4 141,795 DT (30 jours de retard)');
    expect(m.body).toContain('Total dû : 4 998,595 DT.');
    expect(m.body).not.toContain('précédentes relances');
    expect(m.body).toContain('Ces factures sont échues depuis longtemps et restent impayées');
    // Une relance déjà faite sur l'une d'elles : la phrase devient vraie.
    items[0].reminders = [{ date: '2026-10-20', level: 2 }];
    expect(sp(C.relanceGroupee(items, { name: 'Bâtiments Ezzahra' }, co, 3).body)).toContain('Malgré nos précédentes relances, ces factures restent impayées');
    // Une seule facture, au ton courtois.
    const un = C.relanceGroupee(items.slice(1), { name: 'Bâtiments Ezzahra' }, co, 1);
    expect([un.subject, un.body.includes('cette facture est arrivée à échéance'), sp(un.body).includes('Total dû : 4 141,795 DT.')]).toEqual(['Rappel : 1 facture en attente de règlement — Ascenseurs Ben Salah', true, true]);
    // Deux devises : pas de total qui les additionnerait.
    const eur = C.relanceGroupee([items[0], { ...items[1], doc: { ...items[1].doc, currency: 'EUR' } }], { name: 'X' }, co, 2);
    expect(eur.body).not.toContain('Total dû');
  });
});
