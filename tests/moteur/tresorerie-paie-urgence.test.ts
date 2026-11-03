// 1.266.7 — la prévision de trésorerie et les estimations de la paie (cadrage 16 § 10.1, points 4 et 10 ; nuit du
// 03/11/2026). Trois défauts, chacun reproduit ici :
//   - la part paie de la déclaration du mois, payée à part (« Noter déposée et payée », `dm-AAAA-MM`), sortait DEUX fois :
//     une fois comme paiement (dans le disponible, ou à sa date), une fois dans l'estimation du 28 ;
//   - un mois dont les bulletins ne sont pas encore faits ne prévoyait ni sa part paie (le 28 du mois suivant) ni sa CNSS
//     (au trimestre) : décembre et janvier sortaient sans impôts sur les salaires, et la CNSS du 4e trimestre au tiers ;
//   - sans bulletin du mois, le salaire prévu, le coût d'une heure et le contrôle d'une avance (tests/web/paie-1256-gestes)
//     oubliaient les primes de la fiche (`computePayslip(e, {}, s)`).
// Les montants discriminent : Mourad, 1 450,375 de brut, chef de famille, un enfant, une prime de transport « au jour » de
// 63,250 (imposable) et un panier de 41,500 (non imposable) ; « Parti », 900,125, sorti le 30/11/2026. Le second chemin est
// celui de l'écran : les bulletins établis par `payslipInputFor` (« Établir les bulletins du mois »), au millime.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const JOUR = '2026-11-03';
const co = () => ({ ...C.DEFAULT_COMPANY, currency: 'DT', stampFee: 1 });
const ligne = (label: string, qty: number, unitPrice: number) => ({ label, qty, unitPrice, vatRate: 19 });
const MOURAD = { id: 'e1', name: 'Mourad Trabelsi', grossSalary: 1450.375, contract: 'cdi', hireDate: '2019-04-01', headOfFamily: true, children: 1,
  primes: [{ label: 'Prime de transport', amount: 63.25, taxable: true, parJour: true }, { label: 'Panier', amount: 41.5, taxable: false }] };
const PARTI = { id: 'e2', name: 'Parti', grossSalary: 900.125, contract: 'cdi', hireDate: '2021-02-01', endDate: '2026-11-30' };
const base = (actives: string[]): Obj => ({
  company: co(), clients: [{ id: 'c1', name: 'Hôtel Amilcar' }], suppliers: [{ id: 's1', name: 'Bois du Nord' }],
  accounts: [{ id: 'b1', name: 'BIAT', kind: 'banque', opening: 4321.765, openingDate: '2026-01-01', isDefault: true }],
  documents: [], purchases: [], movements: [], employees: [], payslips: [], recurring: [], fiscalFilings: [], socialFilings: [],
  fiscalDeadlines: C.DEFAULT_FISCAL_DEADLINES.map((r: Obj) => ({ ...r, active: actives.includes(r.id) })),
});
// Le bulletin d'un mois, établi comme l'écran l'établit.
const etablir = (d: Obj, e: Obj, y: number, m: number) => {
  const saisie = { ...C.payslipInputFor(d, e, y, m), year: y, month: m };
  d.payslips.push({ id: `p-${e.id}-${y}-${m}`, employeeId: e.id, year: y, month: m, ...saisie, computed: C.computePayslip(e, saisie, C.payrollSettings(d)) });
};
const ev = (f: Obj, id: string) => f.events.find((e: Obj) => e.id === id);

describe('la prévision et les estimations de la paie (16 § 10.1, points 4 et 10)', () => {
  it('la part paie payée à part (« Noter déposée et payée ») ne sort pas une seconde fois : la TVA du mois reste, seule', () => {
    const d = base(['tva']);
    d.employees.push({ ...MOURAD });
    etablir(d, d.employees[0], 2026, 10);
    d.documents.push({ id: 'f1', type: 'facture', status: 'envoyée', number: 'F1', date: '2026-10-15', dueDate: '2026-11-15', clientId: 'c1', currency: 'DT', issuedTs: 1,
      lines: [ligne('Prestation', 1, 1000)], payments: [{ id: 'r', date: '2026-10-20', amount: 1190, method: 'virement' }] });
    d.purchases.push({ id: 'a1', kind: 'facture', supplierId: 's1', date: '2026-10-10', currency: 'DT', lines: [ligne('Planches', 1, 400)], fees: 0, payments: [{ id: 'x', date: '2026-10-11', amount: 476, method: 'virement' }] });
    const part = C.montantSocial(d, 'dm-2026-10').montant;
    expect(part).toBeGreaterThan(0);
    const avant = C.cashForecast(d, d.company, 30, JOUR);
    expect(ev(avant, 'tva@2026-11-28').amount).toBe(-C.round3(114 + part));
    // Payée hier : elle est dans le disponible, et le 28 n'attend plus que la TVA.
    d.socialFilings.push({ id: 'dm-2026-10', filedAt: '2026-11-02', paidDate: '2026-11-02', amount: part, accountId: 'b1', method: 'virement' });
    const apres = C.cashForecast(d, d.company, 30, JOUR);
    expect(C.round3(avant.start - apres.start)).toBe(part);
    expect(ev(apres, 'tva@2026-11-28').amount).toBe(-114);
    expect(ev(apres, 'tva@2026-11-28').detail.salaires).toBe(0);
    expect(C.round3(apres.end - avant.end)).toBe(0);
    // Payée pour le 20 : un mouvement à sa date, et toujours une seule fois.
    d.socialFilings[0].paidDate = '2026-11-20';
    const plusTard = C.cashForecast(d, d.company, 30, JOUR);
    expect(plusTard.events.filter((e: Obj) => e.kind === 'saisi' && e.source === 'social').map((e: Obj) => [e.date, e.amount])).toEqual([['2026-11-20', -part]]);
    expect(ev(plusTard, 'tva@2026-11-28').amount).toBe(-114);
    expect(C.round3(plusTard.end - avant.end)).toBe(0);
  });

  it('les mois sans bulletins : leur part paie le 28 et leur CNSS au trimestre, estimées sur les fiches, au millime des bulletins qu\'on établira', () => {
    const d = base(['tva', 'cnss']);
    d.employees.push({ ...MOURAD }, { ...PARTI });
    etablir(d, d.employees[0], 2026, 10);
    const f = C.cashForecast(d, d.company, 90, JOUR);
    const nov = ev(f, 'tva@2026-12-28'), dec = ev(f, 'tva@2027-01-28'), t4 = ev(f, 'cnss-2026-T4');
    expect([nov && nov.estime, dec && dec.estime, t4 && t4.estime]).toEqual([true, true, true]);
    // Le second chemin : les bulletins de novembre (Mourad et Parti) et de décembre (Mourad seul : Parti est sorti) établis.
    etablir(d, d.employees[0], 2026, 11); etablir(d, d.employees[1], 2026, 11); etablir(d, d.employees[0], 2026, 12);
    expect(nov.amount).toBe(-C.declarationMensuelleSalaires(d, 2026, 11).total);
    expect(dec.amount).toBe(-C.declarationMensuelleSalaires(d, 2026, 12).total);
    expect(t4.amount).toBe(-C.cnssDeclaration(d, 2026, 4).total);
    // Parti n'a ni octobre (passé, sans bulletin : rien d'estimé) ni décembre : la CNSS du trimestre ne compte que novembre.
    expect(C.cnssDeclaration(d, 2026, 4).rows.find((r: Obj) => r.employeeId === 'e2').months).toBe(1);
    // Établis, ils sortent pour leur montant à eux, et la prévision ne change pas d'un millime.
    const g = C.cashForecast(d, d.company, 90, JOUR);
    expect([ev(g, 'tva@2026-12-28').amount, ev(g, 'tva@2027-01-28').amount, ev(g, 'cnss-2026-T4').amount]).toEqual([nov.amount, dec.amount, t4.amount]);
  });

  it('le salaire prévu et le coût d\'une heure d\'un mois sans bulletin comptent les primes de la fiche', () => {
    const d = base([]);
    d.payrollSettings = { heuresMois: 208 };
    d.employees.push({ ...MOURAD });
    const f = C.cashForecast(d, d.company, 60, JOUR, { impots: false });
    const prevu = ev(f, 'e1@2026-12');
    const ch = C.coutHoraire(d, 'e1', 2026, 12);
    expect(ch.estime).toBe(true);
    // Le second chemin : le bulletin de décembre, établi comme l'écran l'établit.
    etablir(d, d.employees[0], 2026, 12);
    const c = d.payslips[0].computed;
    expect(c.bonuses.map((b: Obj) => b.amount)).toEqual([63.25, 41.5]);
    expect(prevu.amount).toBe(-c.net);
    expect(ch.coutMois).toBe(c.employerCost);
    expect(C.coutHoraire(d, 'e1', 2026, 12)).toEqual({ coutMois: c.employerCost, heuresMois: 208, estime: false, inconnu: false });
  });
});
