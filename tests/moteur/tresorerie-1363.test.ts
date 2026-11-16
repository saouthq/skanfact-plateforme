// 1.363.0 — bout en bout 30 (Nour, 16/11/2026) : les ventes par carte. La banque verse en UNE ligne les ventes par carte
// d'un jour, moins sa commission (« REMISE TPE … 158,270 » pour deux tickets de 107,100 et 53,550). La ligne passait pour
// absente de SkanFact, et « Créer le mouvement » proposait une « Autre entrée » : les ventes comptées deux fois.
// Montants calculés à la main : 107,100 + 53,550 = 160,650 ; 160,650 − 158,270 = 2,380 (1,48 %).
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const mv = (id: string, date: string, amount: number, method = 'carte', reconciled = false) => ({ id, date, amount, method, reconciled });
const ids = (l: Obj[]) => l.map((x) => x.id);

describe('la remise de cartes, moins la commission', () => {
  const tickets = [mv('t1', '2026-11-16', 107.1), mv('t2', '2026-11-16', 53.55)];

  it('la ligne nette retrouve les ventes par carte du jour, et la différence est la commission', () => {
    const r = C.apparierReleve([{ date: '2026-11-17', montant: 158.27, libelle: 'REMISE TPE' }],
      [...tickets, mv('esp', '2026-11-16', 53.55, 'especes'), mv('vir', '2026-11-16', 160.65, 'virement', true)]);
    expect(r.remisesCarte).toHaveLength(1);
    expect(ids(r.remisesCarte[0].mouvements)).toEqual(['t1', 't2']);
    expect(r.remisesCarte[0].ventes).toBe(160.65);
    expect(r.remisesCarte[0].commission).toBe(2.38);
    // Plus « absente » : la créer compterait les ventes deux fois.
    expect(r.absentes).toEqual([]);
    expect(ids(r.restants)).toEqual(['esp']);
  });

  it('un paiement qui n\'est pas par carte ne se propose jamais, même au bon montant', () => {
    const r = C.apparierReleve([{ date: '2026-11-17', montant: 158.27 }], [mv('v1', '2026-11-16', 107.1, 'virement'), mv('v2', '2026-11-16', 53.55, 'cheque')]);
    expect(r.remisesCarte).toEqual([]);
    expect(r.absentes).toHaveLength(1);
  });

  it('au-delà de 5 % d\'écart, ce n\'est plus une commission ; et la banque ne verse jamais plus que les ventes', () => {
    // 160,650 × 0,95 = 152,6175 : 152,617 est juste en dessous, 152,618 juste au-dessus.
    expect(C.apparierReleve([{ date: '2026-11-17', montant: 152.617 }], tickets).remisesCarte).toEqual([]);
    expect(C.apparierReleve([{ date: '2026-11-17', montant: 152.618 }], tickets).remisesCarte).toHaveLength(1);
    expect(C.apparierReleve([{ date: '2026-11-17', montant: 160.651 }], tickets).remisesCarte).toEqual([]);
  });

  it('un week-end versé en une fois : deux jours d\'affilée ; cinq tickets versés entiers : commission nulle', () => {
    const we = [mv('s1', '2026-11-14', 200), mv('s2', '2026-11-14', 100.5), mv('d1', '2026-11-15', 80.25)];
    const r = C.apparierReleve([{ date: '2026-11-16', montant: 375.045 }], we);
    expect(ids(r.remisesCarte[0].mouvements)).toEqual(['s1', 's2', 'd1']);
    expect(r.remisesCarte[0].commission).toBe(5.705);
    const cinq = [1, 2, 3, 4, 5].map((i) => mv('c' + i, '2026-11-16', 10.1 * i));
    const brut = C.apparierReleve([{ date: '2026-11-17', montant: 151.5 }], cinq);
    expect(brut.remises).toEqual([]);
    expect(brut.remisesCarte[0].commission).toBe(0);
    expect(brut.remisesCarte[0].mouvements).toHaveLength(5);
  });

  it('deux suites de jours qui conviennent : rien ne se propose ; ni une vente d\'après la ligne, ni de plus de sept jours', () => {
    // Le 14 seul (100) et le 15 seul (100,5) tiennent tous deux à 5 % de 99 : une ambiguïté n'est jamais sûre.
    expect(C.apparierReleve([{ date: '2026-11-16', montant: 99 }], [mv('a', '2026-11-14', 100), mv('b', '2026-11-15', 100.5)]).remisesCarte).toEqual([]);
    expect(C.apparierReleve([{ date: '2026-11-15', montant: 158.27 }], tickets).remisesCarte).toEqual([]);
    expect(C.apparierReleve([{ date: '2026-11-24', montant: 158.27 }], tickets).remisesCarte).toEqual([]);
    expect(C.apparierReleve([{ date: '2026-11-23', montant: 158.27 }], tickets).remisesCarte).toHaveLength(1);
  });

  it('deux remises du même relevé prennent chacune leur jour, sans se voler les tickets', () => {
    const r = C.apparierReleve([{ date: '2026-11-17', montant: 158.27 }, { date: '2026-11-18', montant: 98.5 }], [...tickets, mv('u1', '2026-11-17', 100)]);
    expect(r.remisesCarte.map((x: Obj) => ids(x.mouvements))).toEqual([['t1', 't2'], ['u1']]);
    expect(r.restants).toEqual([]);
  });
});

describe('le ticket de caisse dans la trésorerie', () => {
  it('un ticket sans client se dit « Vente au comptoir », et porte son mode', () => {
    const data = { ...C.DEFAULT_DATA, company: { ...C.DEFAULT_COMPANY, currency: 'DT' }, clients: [],
      accounts: [{ id: 'b1', name: 'BIAT', kind: 'banque', opening: 0, openingDate: '2026-01-01', isDefault: true }],
      documents: [{ id: 'd1', type: 'facture', number: 'TIC-2026-001', status: 'envoyée', date: '2026-11-16', clientId: '', caisse: { mode: 'carte' },
        lines: [{ label: 'Coffret', qty: 2, unitPrice: 45, vatRate: 19 }], stamp: false,
        payments: [{ id: 'p1', date: '2026-11-16', amount: 107.1, method: 'carte', accountId: 'b1' }] }] };
    const m = C.cashMovements(data, data.company, null, 'b1');
    expect(m).toHaveLength(1);
    expect(m[0].party).toBe('Vente au comptoir');
    expect(m[0].method).toBe('carte');
  });
});
