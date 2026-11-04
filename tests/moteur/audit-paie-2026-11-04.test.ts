// L'audit global du 4 novembre 2026, lot B, côté moteur de paie (docs/audit-global-suivi.md : G08, G09, G10). Sur l'écran
// de la plateforme, avec les exemples de l'audit (des montants qui discriminent : un arrondi faux se voit) :
//   - G08 : le rappel d'une augmentation sur un mois payé au prorata, avec une absence, se calcule sur un prorata refait au
//     nouveau salaire (46,154 DT, pas 95,858) ; une deuxième augmentation ne rappelle pas encore ce que la première a porté ;
//   - G09 : l'heure sup d'un temps partiel se paie sur les heures de SON contrat (24 h par semaine : 104 h), pas sur celles
//     d'un temps plein de l'entreprise ; la retenue d'un retard aussi ; un temps plein ne change pas ;
//   - G10 : un congé du 30/12 au 02/01 compte ses jours de décembre en 2026 et ceux de janvier en 2027, jamais tous aux deux.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Salarie = { id: string; name: string; grossSalary: number; weeklyHours?: number; regularisations?: unknown[]; [k: string]: unknown };
type Bulletin = { year: number; month: number; gross: number; workedDays: number; absentDays: number; bonuses: unknown[]; deductions: unknown[]; prorata: Record<string, number> | null; computed?: Record<string, number> };
type Dossier = { employees: Salarie[]; leaves: Record<string, unknown>[]; payslips: unknown[]; timesheets?: unknown[]; payrollSettings: Record<string, unknown> };

const core = ecranDeLaPlateforme('core.js') as {
  computePayslip: (e: Salarie, i: unknown, s: unknown) => Record<string, number>;
  payrollSettings: (d: Dossier) => Record<string, unknown>;
  ecartDeRappel: (e: Salarie, p: Bulletin, s: unknown) => number;
  heuresDuMoisDe: (s: unknown, e: Salarie) => number;
  poserHeuresSup: (d: Dossier, e: Salarie, annee: number, mois: number, majoration: number, heures: number) => boolean;
  heuresSupDuMois: (d: Dossier, e: Salarie, annee: number, mois: number) => { amount: number }[];
  retardsDuMois: (d: Dossier, e: Salarie, annee: number, mois: number, p?: unknown) => { amount: number }[];
  poserRetard: (d: Dossier, e: Salarie, annee: number, mois: number, jour: number, minutes: number) => boolean;
  leaveBalance: (d: Dossier, id: string, annee: number, aujourdhui?: string) => { taken: number; byKind: Record<string, number>; list: { days: number; joursAnnee: number }[] };
  workingDays: (de: string, a: string, repos?: unknown) => number;
};

const dossier = (employees: Salarie[], reglages: Record<string, unknown> = {}): Dossier => ({ employees, leaves: [], payslips: [], timesheets: [], payrollSettings: reglages });

describe('l\'audit du 04/11/2026, lot B, au moteur de paie', () => {
  it('G08 : le rappel d\'un mois au prorata avec absence se calcule sur un prorata refait ; une deuxième augmentation ne le rappelle pas deux fois', () => {
    const d = dossier([]);
    const st = core.payrollSettings(d);
    // L'exemple de l'audit : 1 300 DT, entré pour 14 jours sur 26 (700 DT), 2 jours d'absence : 600 DT de brut, payé.
    const avant: Salarie = { id: 's', name: 'Sonia', grossSalary: 1300 };
    const saisie = { year: 2026, month: 9, gross: 700, workedDays: 26, absentDays: 2, bonuses: [], deductions: [], prorata: { jours: 14, sur: 26, brutFiche: 1300, brut: 700 } };
    const paye: Bulletin = { ...saisie, computed: core.computePayslip(avant, saisie, st) };
    expect(paye.computed?.gross).toBe(600);
    // Augmenté à 1 400 DT depuis septembre : 1 400 × 14 / 26 = 753,846, moins 1 400 × 2 / 26 = 107,692, soit 646,154.
    const augmente = { ...avant, grossSalary: 1400 };
    expect(core.ecartDeRappel(augmente, paye, st)).toBe(46.154);
    // Ce rappel porté, une deuxième augmentation à 1 500 DT ne rappelle que la sienne : 807,692 − 115,385 = 692,307, moins
    // les 600 payés, moins les 46,154 déjà rappelés.
    const rappele = { ...avant, grossSalary: 1500, regularisations: [{ id: 'r1', rappel: true, amount: 46.154, rappelDe: [{ mois: '2026-09', brut: 46.154 }] }] };
    expect(core.ecartDeRappel(rappele, paye, st)).toBe(46.153);
    expect(core.ecartDeRappel({ ...rappele, regularisations: [] }, paye, st)).toBe(92.307);
    // Un mois complet, sans prorata ni absence : la différence de salaire, tout simplement.
    const plein = { year: 2026, month: 10, gross: 1300, workedDays: 26, absentDays: 0, bonuses: [], deductions: [], prorata: null };
    expect(core.ecartDeRappel(augmente, { ...plein, computed: core.computePayslip(avant, plein, st) }, st)).toBe(100);
  });

  it('G09 : l\'heure sup et le retard d\'un temps partiel se valorisent sur les heures de son contrat ; un temps plein ne change pas', () => {
    const partiel: Salarie = { id: 'p', name: 'Karim', grossSalary: 650, weeklyHours: 24 };
    const plein: Salarie = { id: 'f', name: 'Nadia', grossSalary: 650 };
    const d = dossier([partiel, plein], { heuresMois: 208, hsMaj1: 25, retenirRetards: true });
    const st = core.payrollSettings(d);
    expect([core.heuresDuMoisDe(st, partiel), core.heuresDuMoisDe(st, plein)]).toEqual([104, 208]);
    for (const e of [partiel, plein]) core.poserHeuresSup(d, e, 2026, 9, 25, 1);
    // L'exemple de l'audit : 650 × 1 × 1,25 / 104 = 7,813 (au lieu de 3,906, le taux d'un temps plein).
    expect(core.heuresSupDuMois(d, partiel, 2026, 9).map((x) => x.amount)).toEqual([7.813]);
    expect(core.heuresSupDuMois(d, plein, 2026, 9).map((x) => x.amount)).toEqual([3.906]);
    // 30 minutes de retard : 650 × 30 / 60 / 104 = 3,125 retenus au temps partiel, 1,563 au temps plein.
    for (const e of [partiel, plein]) core.poserRetard(d, e, 2026, 9, 2, 30);
    expect(core.retardsDuMois(d, partiel, 2026, 9).map((x) => x.amount)).toEqual([-3.125]);
    expect(core.retardsDuMois(d, plein, 2026, 9).map((x) => x.amount)).toEqual([-1.563]);
  });

  it('G10 : un congé à cheval sur deux années compte, dans chacune, les jours qui y tombent', () => {
    const d = dossier([{ id: 's', name: 'Sonia', grossSalary: 1000, hireDate: '2020-01-01' }]);
    d.leaves.push({ id: 'l1', employeeId: 's', kind: 'conges', from: '2026-12-30', to: '2027-01-02', statut: 'accepte' });
    const tout = core.workingDays('2026-12-30', '2027-01-02'), dec = core.workingDays('2026-12-30', '2026-12-31'), jan = core.workingDays('2027-01-01', '2027-01-02');
    expect([tout, dec + jan]).toEqual([4, 4]);
    const b26 = core.leaveBalance(d, 's', 2026, '2027-03-01'), b27 = core.leaveBalance(d, 's', 2027, '2027-03-01');
    expect([b26.taken, b27.taken]).toEqual([dec, jan]);
    expect([b26.byKind.conges, b27.byKind.conges]).toEqual([dec, jan]);
    // La liste de chaque année montre le congé entier, et la part de l'année.
    expect(b26.list.map((l) => [l.days, l.joursAnnee])).toEqual([[4, dec]]);
    // Une demande pas encore acceptée ne compte dans aucune année.
    d.leaves.push({ id: 'l2', employeeId: 's', kind: 'conges', from: '2026-12-28', to: '2026-12-29', statut: 'demande' });
    expect(core.leaveBalance(d, 's', 2026, '2027-03-01').taken).toBe(dec);
  });
});
