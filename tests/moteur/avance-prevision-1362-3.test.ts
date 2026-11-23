// L'avance sur salaire dans la prévision de trésorerie (1.362.3, bout en bout 27). La pâtisserie de Nour verse 300 DT
// d'avance à Yassine le 05/11, retenus sur ses bulletins de novembre et de décembre. La prévision estimait les salaires
// des mois sans bulletin au net de la fiche, sans la retenue : l'avance sortait deux fois — le 05/11, puis dans le
// salaire entier du 30/11. Le net prévu retranche maintenant ce que le bulletin retiendra, et jamais plus que ce qui reste
// à rembourser d'un mois sur l'autre. Les retenues attendues sont comptées à la main.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const JOUR = '2026-11-13';
const base = (): Obj => ({
  company: { ...C.DEFAULT_COMPANY, currency: 'DT', stampFee: 1 }, clients: [], suppliers: [],
  accounts: [{ id: 'b1', name: 'BIAT', kind: 'banque', opening: 5000, openingDate: '2026-01-01', isDefault: true }],
  documents: [], purchases: [], movements: [], payslips: [], recurring: [], fiscalFilings: [], socialFilings: [], advances: [],
  employees: [{ id: 'y1', name: 'Yassine Trabelsi', grossSalary: 1200, contract: 'cdi', hireDate: '2026-10-01' }],
  fiscalDeadlines: C.DEFAULT_FISCAL_DEADLINES.map((r: Obj) => ({ ...r, active: false })),
});
const salaires = (d: Obj) => C.cashForecast(d, d.company, 90, JOUR, { impots: false }).events
  .filter((e: Obj) => e.kind === 'salaire-prevu').map((e: Obj) => [e.id, e.amount, e.avanceRetenue || 0]);

describe('l\'avance sur salaire dans la prévision', () => {
  const net = () => C.round3(C.computePayslip(base().employees[0], C.saisieDeLaFiche(base().employees[0], C.payrollSettings(base())), C.payrollSettings(base())).net);
  it('sans avance, chaque mois sort le net de la fiche', () => {
    expect(salaires(base())).toEqual([['y1@2026-11', -net(), 0], ['y1@2026-12', -net(), 0], ['y1@2027-01', -net(), 0]]);
  });
  it('300 DT à 150 par mois : 150 retenus en novembre et en décembre, rien en janvier', () => {
    const d = base();
    d.advances.push({ id: 'av1', employeeId: 'y1', date: '2026-11-05', amount: 300, monthly: 150 });
    expect(salaires(d)).toEqual([['y1@2026-11', C.round3(-net() + 150), 150], ['y1@2026-12', C.round3(-net() + 150), 150], ['y1@2027-01', -net(), 0]]);
  });
  it('300 DT à 200 par mois : 200 en novembre, les 100 qui restent en décembre — jamais plus que l\'avance', () => {
    const d = base();
    d.advances.push({ id: 'av1', employeeId: 'y1', date: '2026-11-05', amount: 300, monthly: 200 });
    expect(salaires(d)).toEqual([['y1@2026-11', C.round3(-net() + 200), 200], ['y1@2026-12', C.round3(-net() + 100), 100], ['y1@2027-01', -net(), 0]]);
  });
  it('une avance déjà remboursée en partie par un vrai bulletin : seul le reste se retient', () => {
    const d = base();
    d.advances.push({ id: 'av1', employeeId: 'y1', date: '2026-10-05', amount: 300, monthly: 200 });
    d.payslips.push({ id: 'b10', employeeId: 'y1', year: 2026, month: 10, paidDate: '2026-10-31', computed: { net: 700 }, deductions: [{ label: 'Avance', amount: 200, advanceId: 'av1' }] });
    expect(salaires(d)).toEqual([['y1@2026-11', C.round3(-net() + 100), 100], ['y1@2026-12', -net(), 0], ['y1@2027-01', -net(), 0]]);
  });
  it('une avance versée en décembre ne se retient pas en novembre', () => {
    const d = base();
    d.advances.push({ id: 'av1', employeeId: 'y1', date: '2026-12-10', amount: 300, monthly: 150 });
    expect(salaires(d).map((x: Obj[]) => x[2])).toEqual([0, 150, 150]);
  });
  it('(GEST-10) un salarié qui entre le 24/12 : décembre porte le net proratisé (6 jours sur 26), janvier le net plein', () => {
    const d = base();
    const n1 = { id: 'n1', name: 'Nesrine Gharbi', grossSalary: 1000, contract: 'cdi', hireDate: '2026-12-24' };
    d.employees.push(n1);
    const s = C.payrollSettings(d);
    // Décembre 2026 : du 1er au 23, 23 jours dont 3 dimanches (6, 13, 20) → 20 jours ouvrables hors contrat ; 26 − 20 = 6 ;
    // brut 1 000 × 6 / 26 = 230,769 (calculé à la main sur le calendrier).
    const brut = 230.769;
    const netDec = C.round3(C.computePayslip(n1, { gross: brut, workedDays: 26, bonuses: [], prorata: { jours: 6, sur: 26, brutFiche: 1000, brut }, year: 2026, month: 12 }, s).net);
    const netPlein = C.round3(C.computePayslip(n1, C.saisieDeLaFiche(n1, s), s).net);
    expect(salaires(d).filter((x: [string]) => x[0].startsWith('n1@'))).toEqual([['n1@2026-12', -netDec, 0], ['n1@2027-01', -netPlein, 0]]);
    expect(netDec).toBeLessThan(netPlein / 3);
  });
  it('la ligne de la prévision dit la retenue', () => {
    const d = base();
    d.advances.push({ id: 'av1', employeeId: 'y1', date: '2026-11-05', amount: 300, monthly: 150 });
    const nov = C.cashForecast(d, d.company, 90, JOUR, { impots: false }).events.find((e: Obj) => e.id === 'y1@2026-11');
    expect(nov.label.replace(/\s+/g, ' ')).toBe('Salaire novembre 2026 — Yassine Trabelsi (avance retenue : 150,000 DT)');
  });
});
