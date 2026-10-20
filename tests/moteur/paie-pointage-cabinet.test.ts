// Le pointage au Cabinet (1.69.0 ; docs/paie.md, « Le pointage au Cabinet »). Le moteur du pointage vit dans le moteur
// commun (compta.js), que le Cabinet charge ; et un bulletin NOUVEAU du Cabinet part de `saisieDuMois`, lue sur la grille
// du mois du salarié. Deux chemins, un chiffre : cette saisie est celle de l'entreprise (core.js, `payslipInputFor`), au
// millime — l'entrée et la sortie proratisées, les congés non payés, les primes au jour, le pointage et ses heures
// supplémentaires — sans les avances, que le Cabinet ne lit pas.
// Les montants discriminent : un brut de 1 234,567, une prime au jour de 45,500 sur 11,5 jours payés.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Prime10 = { label: string; amount: number; taxable?: boolean; parJour?: boolean; mensuel?: number; jours?: number; sur?: number; hs?: number; heures?: number };
type Saisie = { gross: number; workedDays: number; absentDays: number; bonuses: Prime10[]; deductions?: unknown[]; prorata: { jours: number; sur: number; motif: string; brutFiche: number; brut: number } | null };
type Salarie = { id: string; name: string; grossSalary: number; hireDate?: string; endDate?: string; primes?: unknown[] };
type Dossier = { employees: Salarie[]; leaves: unknown[]; advances: unknown[]; payslips: unknown[]; timesheets: unknown[]; payrollSettings: Record<string, unknown> };

const compta = ecranDeLaPlateforme('compta.js') as {
  saisieDuMois: (d: Dossier, e: Salarie, annee: number, mois: number) => Saisie;
  poserPointage: (d: Dossier, e: Salarie, annee: number, mois: number, jour: number, code: string) => boolean;
  poserHeuresSup: (d: Dossier, e: Salarie, annee: number, mois: number, majoration: number, heures: number | string) => boolean;
  leaveIsPaid: (k: string) => boolean;
};
const core = ecranDeLaPlateforme('core.js') as {
  payslipInputFor: (d: Dossier, e: Salarie, annee: number, mois: number) => Saisie;
  pointageDuMois: unknown;
  LEAVE_KINDS: unknown;
};

// Octobre 2026 commence un jeudi : ses dimanches (le repos de la semaine) sont les 4, 11, 18 et 25.
function dossier(): { d: Dossier; entre: Salarie; sort: Salarie; plein: Salarie } {
  const entre: Salarie = {
    id: 's1', name: 'salarié 1', grossSalary: 1234.567, hireDate: '2026-10-14',
    primes: [{ label: 'Prime de présence', amount: 45.5, taxable: true, parJour: true }, { label: 'Prime de transport', amount: 60, taxable: true, parJour: false }],
  };
  const sort: Salarie = { id: 's2', name: 'salarié 2', grossSalary: 980, hireDate: '2024-03-01', endDate: '2026-10-09' };
  const plein: Salarie = { id: 's3', name: 'salarié 3', grossSalary: 1500.25, hireDate: '2025-01-06', primes: [{ label: 'Prime de rendement', amount: 80, taxable: true, parJour: true }] };
  const d: Dossier = {
    employees: [entre, sort, plein], advances: [], payslips: [], timesheets: [],
    leaves: [
      { id: 'l1', employeeId: 's1', kind: 'sans-solde', from: '2026-10-20', to: '2026-10-21' },
      { id: 'l2', employeeId: 's3', kind: 'maladie', from: '2026-10-05', to: '2026-10-07' },
      { id: 'l3', employeeId: 's3', kind: 'abandon', from: '2026-10-12', to: '2026-10-12' },
    ],
    payrollSettings: { hsMaj1: 25, heuresMois: 208 },
  };
  return { d, entre, sort, plein };
}
const sansAvances = (i: Saisie) => ({ gross: i.gross, workedDays: i.workedDays, absentDays: i.absentDays, bonuses: i.bonuses, prorata: i.prorata });

describe('le pointage au Cabinet : la saisie d\'un bulletin nouveau, au millime de l\'entreprise', () => {
  it('le moteur du pointage vit dans le moteur commun, et l\'entreprise le reprend', () => {
    expect(typeof compta.saisieDuMois).toBe('function');
    expect(core.LEAVE_KINDS).toBeTruthy();
    expect(compta.leaveIsPaid('sans-solde')).toBe(false);
    expect(compta.leaveIsPaid('maladie')).toBe(true);
  });

  it('une entrée en cours de mois, un congé sans solde : le brut proratisé, l\'absence, la prime au jour sur les jours payés', () => {
    const { d, entre } = dossier();
    const c = compta.saisieDuMois(d, entre, 2026, 10);
    // Onze jours ouvrables avant l'entrée (du 1er au 13, sans les dimanches 4 et 11) : 15 jours sur 26 ; deux jours sans
    // solde (mardi 20, mercredi 21) : 13 jours payés.
    expect(c.prorata).toEqual({ jours: 15, sur: 26, motif: 'entrée le 14/10/2026', brutFiche: 1234.567, brut: 712.25 });
    expect(c.gross).toBe(712.25);
    expect(c.absentDays).toBe(2);
    expect(c.bonuses).toEqual([
      { label: 'Prime de présence', amount: 22.75, taxable: true, parJour: true, mensuel: 45.5, jours: 13, sur: 26 },
      { label: 'Prime de transport', amount: 60, taxable: true },
    ]);
    expect(sansAvances(c)).toEqual(sansAvances(core.payslipInputFor(d, entre, 2026, 10)));
  });

  it('le mois pointé : ses absences, sa demi-journée et ses heures supplémentaires arrivent au bulletin', () => {
    const { d, entre } = dossier();
    expect(compta.poserPointage(d, entre, 2026, 10, 27, 'A')).toBe(true);
    expect(compta.poserPointage(d, entre, 2026, 10, 28, 'D')).toBe(true);
    expect(compta.poserHeuresSup(d, entre, 2026, 10, 25, '6')).toBe(true);
    const c = compta.saisieDuMois(d, entre, 2026, 10);
    // 2 jours sans solde + 1 absence + une demi-journée : 3,5 jours ; 26 − 11 − 3,5 = 11,5 jours payés.
    expect(c.absentDays).toBe(3.5);
    expect(c.bonuses).toEqual([
      { label: 'Prime de présence', amount: 20.125, taxable: true, parJour: true, mensuel: 45.5, jours: 11.5, sur: 26 },
      { label: 'Prime de transport', amount: 60, taxable: true },
      // 1 234,567 × 6 × 1,25 / 208 = 44,516 : le brut de la fiche, pas le brut proratisé.
      { label: 'Heures supplémentaires : 6 h à +25 %', amount: 44.516, taxable: true, hs: 25, heures: 6 },
    ]);
    expect(sansAvances(c)).toEqual(sansAvances(core.payslipInputFor(d, entre, 2026, 10)));
  });

  it('une sortie en cours de mois ; un mois plein où seule l\'absence injustifiée se retire, pas la maladie', () => {
    const { d, sort, plein } = dossier();
    const s = compta.saisieDuMois(d, sort, 2026, 10);
    // Après le vendredi 9 : 22 jours, moins les dimanches 11, 18 et 25 = 19 jours hors contrat ; 7 jours sur 26.
    expect(s.prorata).toEqual({ jours: 7, sur: 26, motif: 'sortie le 09/10/2026', brutFiche: 980, brut: 263.846 });
    expect(sansAvances(s)).toEqual(sansAvances(core.payslipInputFor(d, sort, 2026, 10)));
    const p = compta.saisieDuMois(d, plein, 2026, 10);
    expect(p.prorata).toBe(null);
    expect(p.gross).toBe(1500.25);
    expect(p.absentDays).toBe(1);
    expect(p.bonuses).toEqual([{ label: 'Prime de rendement', amount: 76.923, taxable: true, parJour: true, mensuel: 80, jours: 25, sur: 26 }]);
    expect(sansAvances(p)).toEqual(sansAvances(core.payslipInputFor(d, plein, 2026, 10)));
  });
});
