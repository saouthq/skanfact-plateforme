// 1.266.0 — la trésorerie d'un expert (revue du 03/11 : « mets-toi à la place d'un designer et d'un expert du métier »).
// La prévision ne connaissait que ce qui était déjà saisi : ni les salaires des mois sans bulletin, ni la TVA du 28, ni le
// loyer. Chaque règle ajoutée se vérifie ici, sur des montants qui ne tombent pas ronds :
//   - les semaines refont la prévision au millime ; « prudent » retire exactement les factures échues ;
//   - « habitude » attend chaque client à son délai réel ; le seuil donne la date du PREMIER passage dessous ;
//   - les salaires projetés, la TVA et la CNSS estimées, les dépenses qui reviennent ; l'essai de décalage ;
//   - le portefeuille des effets, l'appariement d'un relevé.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const JOUR = '2026-11-03';
const co = (extra: Obj = {}) => ({ ...C.DEFAULT_COMPANY, currency: 'DT', stampFee: 1, ...extra });
const ligne = (label: string, qty: number, unitPrice: number) => ({ label, qty, unitPrice, vatRate: 19 });
const base = (): Obj => ({
  company: co(), clients: [{ id: 'c1', name: 'Hôtel Amilcar' }, { id: 'c2', name: 'Café Ennour' }], suppliers: [{ id: 's1', name: 'Bois du Nord' }],
  accounts: [{ id: 'b1', name: 'BIAT', kind: 'banque', opening: 4321.765, openingDate: '2026-01-01', isDefault: true }],
  documents: [], purchases: [], movements: [], employees: [], payslips: [], recurring: [], fiscalFilings: [], socialFilings: [],
  fiscalDeadlines: C.DEFAULT_FISCAL_DEADLINES.map((r: Obj) => ({ ...r, active: false })),
});
const facture = (id: string, client: string, date: string, dueDate: string, prix: number, payments: Obj[] = []) =>
  ({ id, type: 'facture', status: 'envoyée', number: id.toUpperCase(), date, dueDate, clientId: client, currency: 'DT', issuedTs: 1, lines: [ligne('Prestation', 1, prix)], payments });

describe('la trésorerie 1.266.0', () => {
  it('les semaines refont la prévision au millime ; « prudent » retire exactement les factures déjà échues', () => {
    const d = base();
    d.documents.push(facture('f1', 'c1', '2026-09-01', '2026-10-01', 1234.567), facture('f2', 'c2', '2026-10-20', '2026-11-20', 987.654));
    d.purchases.push({ id: 'a1', kind: 'facture', supplierId: 's1', date: '2026-10-25', dueDate: '2026-11-25', currency: 'DT', lines: [ligne('Planches', 3, 211.111)], fees: 0, payments: [] });
    const f = C.cashForecast(d, d.company, 60, JOUR, { impots: false, salaires: false });
    const sem = C.semainesTreso(f);
    expect(sem[sem.length - 1].solde).toBe(f.end);
    expect(C.round3(sem.reduce((x: number, w: Obj) => x + w.entrees, 0))).toBe(f.inflow);
    expect(sem[0].du).toBe(JOUR);
    const p = C.cashForecast(d, d.company, 60, JOUR, { prudent: true, impots: false, salaires: false });
    const echue = f.late.clients.reduce((x: number, e: Obj) => x + e.amount, 0);
    expect(echue).toBeGreaterThan(0);
    expect(C.round3(f.end - p.end)).toBe(C.round3(echue));
  });

  it('« habitude » attend un client à son délai réel ; sans deux factures soldées, à l\'échéance', () => {
    const d = base();
    // Café Ennour paie 12 puis 18 jours après l'échéance : il est attendu 15 jours après.
    d.documents.push(
      facture('p1', 'c2', '2026-07-01', '2026-07-31', 100, [{ id: 'r1', date: '2026-08-12', amount: 120, method: 'virement' }]),
      facture('p2', 'c2', '2026-08-01', '2026-08-31', 100, [{ id: 'r2', date: '2026-09-18', amount: 120, method: 'virement' }]),
      facture('o1', 'c2', '2026-11-01', '2026-12-01', 543.21), facture('o2', 'c1', '2026-11-01', '2026-12-01', 345.67));
    expect(C.delaiClient(d, d.company, 'c2', JOUR)).toEqual({ jours: 15, factures: 2 });
    expect(C.delaiClient(d, d.company, 'c1', JOUR)).toBe(null);
    const h = C.cashForecast(d, d.company, 90, JOUR, { encaissement: 'habitude', impots: false, salaires: false });
    expect(h.events.find((e: Obj) => e.id === 'o1').date).toBe('2026-12-16');
    expect(h.events.find((e: Obj) => e.id === 'o2').date).toBe('2026-12-01');
  });

  it('le seuil donne la date du premier passage dessous ; un seuil illisible vaut zéro', () => {
    const d = base();
    d.purchases.push({ id: 'a1', kind: 'facture', supplierId: 's1', date: '2026-11-01', dueDate: '2026-11-10', currency: 'DT', lines: [ligne('Machine', 1, 3000)], fees: 0, payments: [] });
    d.documents.push(facture('f1', 'c1', '2026-11-01', '2026-11-20', 2000));
    const solde = 4321.765 - 3570;
    expect(C.cashForecast(d, co({ tresoSeuil: 1000 }), 60, JOUR, { impots: false, salaires: false }).shortfall.date).toBe('2026-11-10');
    expect(C.cashForecast(d, co({ tresoSeuil: 500 }), 60, JOUR, { impots: false, salaires: false }).shortfall).toBe(null);
    expect(C.cashForecast(d, co({ tresoSeuil: 'beaucoup' }), 60, JOUR, { impots: false, salaires: false }).seuil).toBe(0);
    expect(C.round3(C.cashForecast(d, co(), 60, JOUR, { impots: false, salaires: false }).lowest.balance)).toBe(C.round3(solde));
  });

  it('les salaires des mois sans bulletin sortent, au net du contrat, à la fin de chaque mois', () => {
    const d = base();
    d.employees.push({ id: 'e1', name: 'Mourad Trabelsi', grossSalary: 1450.375, contract: 'cdi', hireDate: '2019-04-01' },
      { id: 'e2', name: 'Parti', grossSalary: 900, contract: 'cdi', hireDate: '2019-04-01', endDate: '2026-11-30' });
    d.payslips.push({ id: 'b11', employeeId: 'e1', year: 2026, month: 11, computed: { net: 1111.111 } });
    const f = C.cashForecast(d, d.company, 90, JOUR, { impots: false });
    const net = C.computePayslip(d.employees[0], {}, C.payrollSettings(d)).net;
    const e1 = f.events.filter((e: Obj) => e.kind === 'salaire-prevu' && e.id.startsWith('e1@'));
    expect(e1.map((e: Obj) => e.date)).toEqual(['2026-12-31', '2027-01-31']);
    expect(e1[0].amount).toBe(-C.round3(net));
    // Le bulletin de novembre existe : il sort pour son net à lui, pas pour une estimation.
    expect(f.events.filter((e: Obj) => e.id === 'e1@2026-11').length).toBe(0);
    // Parti fin novembre : sa paie de novembre est projetée, pas celle de décembre.
    expect(f.events.filter((e: Obj) => e.id.startsWith?.('e2@')).map((e: Obj) => e.id)).toEqual(['e2@2026-11']);
  });

  it('la TVA du mois écoulé sort le 28, estimée sur ce qui est saisi ; déclarée, elle ne sort plus', () => {
    const d = base();
    d.fiscalDeadlines = C.DEFAULT_FISCAL_DEADLINES.map((r: Obj) => ({ ...r, active: r.id === 'tva' }));
    d.documents.push({ ...facture('f1', 'c1', '2026-10-15', '2026-11-15', 1000), payments: [{ id: 'r', date: '2026-10-20', amount: 1190, method: 'virement' }] });
    d.purchases.push({ id: 'a1', kind: 'facture', supplierId: 's1', date: '2026-10-10', currency: 'DT', lines: [ligne('Planches', 1, 400)], fees: 0, payments: [{ id: 'x', date: '2026-10-11', amount: 476, method: 'virement' }] });
    const f = C.cashForecast(d, d.company, 30, JOUR, { salaires: false });
    const t = f.events.find((e: Obj) => e.kind === 'fiscal');
    expect(t.date).toBe('2026-11-28');
    expect(t.amount).toBe(-C.round3(190 - 76));
    expect(t.estime).toBe(true);
    d.fiscalFilings.push({ id: 'tva@2026-11-28' });
    expect(C.cashForecast(d, d.company, 30, JOUR, { salaires: false }).events.some((e: Obj) => e.kind === 'fiscal')).toBe(false);
  });

  it('un loyer qui se répète sort chaque mois ; une occurrence notée ne sort plus deux fois', () => {
    const d = base();
    d.movements.push({ id: 'loyer', date: '2026-10-05', kind: 'autre-sortie', amount: 850.5, accountId: 'b1', label: 'Loyer de l\'atelier', repete: 'mois' });
    let f = C.cashForecast(d, d.company, 70, JOUR, { impots: false, salaires: false });
    expect(f.events.filter((e: Obj) => e.kind === 'repete').map((e: Obj) => [e.date, e.amount])).toEqual([['2026-11-05', -850.5], ['2026-12-05', -850.5], ['2027-01-05', -850.5]]);
    d.movements.push({ id: 'l11', date: '2026-11-05', kind: 'autre-sortie', amount: 850.5, accountId: 'b1', label: 'Loyer de l\'atelier', repeteDe: 'loyer', occurrence: '2026-11-05' });
    f = C.cashForecast(d, d.company, 70, JOUR, { impots: false, salaires: false });
    expect(f.events.filter((e: Obj) => e.kind === 'repete').length).toBe(2);
    expect(f.events.filter((e: Obj) => e.id === 'l11').length).toBe(1);
  });

  it('l\'essai de décalage déplace une échéance sans rien enregistrer', () => {
    const d = base();
    d.purchases.push({ id: 'a1', kind: 'facture', supplierId: 's1', date: '2026-11-01', dueDate: '2026-11-10', currency: 'DT', lines: [ligne('Machine', 1, 3000)], fees: 0, payments: [] });
    const f = C.cashForecast(d, d.company, 60, JOUR, { impots: false, salaires: false, decalages: { 'fournisseur:a1': '2026-12-15' } });
    expect(f.events[0].date).toBe('2026-12-15');
    expect(f.events[0].decale).toBe(true);
    expect(d.purchases[0].dueDate).toBe('2026-11-10');
    expect(C.cashForecast(d, d.company, 30, JOUR, { impots: false, salaires: false, decalages: { 'fournisseur:a1': '2027-02-01' } }).events.length).toBe(0);
  });

  it('le portefeuille des effets et l\'appariement d\'un relevé', () => {
    const d = base();
    d.documents.push({ ...facture('f1', 'c1', '2026-10-01', '2026-10-31', 500), payments: [{ id: 't1', date: '2027-01-15', amount: 595, method: 'traite', reference: 'TR-0042', effet: { recuLe: '2026-10-30' } }] });
    const pf = C.portefeuilleEffets(d, d.company, JOUR);
    expect([pf.effets.length, pf.aRecevoir, pf.effets[0].echeance, pf.effets[0].recuLe]).toEqual([1, 595, '2027-01-15', '2026-10-30']);
    // L'argent de la traite n'est pas dans le disponible : il arrive à l'échéance.
    expect(C.cashPosition(d, d.company, JOUR).total).toBe(4321.765);
    const mv = [{ id: 'm1', date: '2026-10-28', amount: -123.456, reconciled: false }, { id: 'm2', date: '2026-10-29', amount: -123.456, reconciled: false }, { id: 'm3', date: '2026-10-01', amount: 77.7, reconciled: false }];
    const r = C.apparierReleve([{ date: '2026-10-29', montant: -123.456 }, { date: '2026-10-30', montant: -9.9 }, { date: '2026-10-20', montant: 77.7 }], mv);
    expect(r.paires.map((x: Obj) => x.mouvement.id)).toEqual(['m2']);
    expect(r.absentes.map((x: Obj) => x.montant)).toEqual([77.7, -9.9]);
    expect(r.restants.map((x: Obj) => x.id)).toEqual(['m1', 'm3']);
    // Une ligne du relevé déjà pointée dans SkanFact n'est pas « absente » : la dire absente ferait créer un doublon.
    const mv2 = [{ id: 'p1', date: '2026-10-24', amount: 20794.941, reconciled: true }, { id: 'p2', date: '2026-10-29', amount: -15, reconciled: false }];
    const r2 = C.apparierReleve([{ date: '2026-10-24', montant: 20794.941 }, { date: '2026-10-31', montant: -15 }, { date: '2026-10-31', montant: -2.5 }], mv2);
    expect([r2.paires.map((x: Obj) => x.mouvement.id), r2.dejaPointees.map((x: Obj) => x.mouvement.id), r2.absentes.map((x: Obj) => x.montant)]).toEqual([['p2'], ['p1'], [-2.5]]);
  });
});
