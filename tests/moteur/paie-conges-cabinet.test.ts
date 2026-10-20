// Les congés au Cabinet (1.70.0 ; docs/paie.md, « Les congés au Cabinet »). Le moteur des congés de l'entreprise (5.1.0)
// vit dans le moteur commun (compta.js), que le Cabinet charge : le solde qu'il montre pour un salarié est celui de
// l'entreprise. Deux chemins, un chiffre : compta.js et core.js (qui le reprend) disent les mêmes jours et le même solde ;
// et le droit annuel gardé en texte dans la fiche d'un dossier tenu (« 21.5 ») compte comme le nombre de l'entreprise.
// Les données discriminent : un droit de 21,5 jours, une entrée le 16 mars, un congé à cheval sur juillet et août.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Conge = { id: string; employeeId: string; kind: string; from: string; to: string; paid?: boolean | null };
type Donnees = { employees: Record<string, unknown>[]; leaves: Conge[]; payrollSettings: Record<string, unknown> };
type Solde = { year: number; months: number; acquired: number; carry: number; taken: number; remaining: number; perYear: number; byKind: Record<string, number>; list: unknown[] };
type Moteur = {
  workingDays: (de: string, a: string, repos?: number[]) => number;
  leaveDaysInMonth: (c: Conge, annee: number, mois: number, repos?: number[]) => number;
  leavesOf: (d: Donnees, salarie: string, annee: number) => (Conge & { days: number; paid: boolean; kindLabel: string })[];
  leaveBalance: (d: Donnees, salarie: string, annee: number, aujourdhui?: string) => Solde;
  leaveKindLabel: (k: string) => string;
};
const compta = ecranDeLaPlateforme('compta.js') as Moteur;
const core = ecranDeLaPlateforme('core.js') as Moteur;

// 2026 : le 27 juillet est un lundi ; aujourd'hui, le 20 octobre.
const AUJOURDHUI = '2026-10-20';
function donnees(droit: number | string): Donnees {
  return {
    employees: [
      { id: 's1', name: 'salarié 1', grossSalary: 1234.567, hireDate: '2026-03-16' },
      { id: 's2', name: 'salarié 2', grossSalary: 980, hireDate: '2024-02-01', endDate: '2026-06-30' },
    ],
    leaves: [
      { id: 'l1', employeeId: 's1', kind: 'conges', from: '2026-07-27', to: '2026-08-07' },
      { id: 'l2', employeeId: 's1', kind: 'maladie', from: '2026-09-14', to: '2026-09-16' },
      { id: 'l3', employeeId: 's1', kind: 'sans-solde', from: '2026-10-05', to: '2026-10-06' },
      { id: 'l4', employeeId: 's2', kind: 'conges', from: '2026-05-04', to: '2026-05-16', paid: false },
    ],
    payrollSettings: { leaveDaysPerYear: droit },
  };
}

describe('les congés au Cabinet : le moteur de l\'entreprise, dans le moteur commun', () => {
  it('les jours ouvrables d\'un congé, et sa part dans chaque mois', () => {
    const [juilletAout] = donnees(21.5).leaves;
    // Du lundi 27 juillet au vendredi 7 août : onze jours ouvrables (le dimanche 2 août n'en est pas), cinq en juillet, six en août.
    expect(compta.workingDays('2026-07-27', '2026-08-07')).toBe(11);
    expect(compta.leaveDaysInMonth(juilletAout as Conge, 2026, 7)).toBe(5);
    expect(compta.leaveDaysInMonth(juilletAout as Conge, 2026, 8)).toBe(6);
    expect(compta.leaveDaysInMonth(juilletAout as Conge, 2026, 9)).toBe(0);
    expect(compta.leaveKindLabel('sans-solde')).toBe(core.leaveKindLabel('sans-solde'));
  });

  it('le solde : acquis au prorata des mois travaillés, moins les congés payés pris ; la maladie et le sans-solde à part', () => {
    const d = donnees(21.5);
    const s1 = compta.leaveBalance(d, 's1', 2026, AUJOURDHUI);
    // Du 16 mars au 20 octobre : 219 jours, sept mois ; 21,5 × 7 / 12 = 12,542 jours acquis ; onze pris.
    expect([s1.months, s1.acquired, s1.taken, s1.remaining]).toEqual([7, 12.542, 11, 1.542]);
    expect([s1.byKind.maladie, s1.byKind['sans-solde']]).toEqual([3, 2]);
    // Sorti le 30 juin : six mois, 10,75 jours acquis ; un congé de douze jours (forcé non payé : il entame quand même le
    // compteur, comme dans l'entreprise) le met à −1,25.
    const s2 = compta.leaveBalance(d, 's2', 2026, AUJOURDHUI);
    expect([s2.months, s2.acquired, s2.taken, s2.remaining]).toEqual([6, 10.75, 12, -1.25]);
    // La liste de l'année, la plus récente d'abord, avec ses jours et son effet.
    expect(compta.leavesOf(d, '', 2026).map((l) => [l.id, l.days, l.paid])).toEqual([['l3', 2, false], ['l2', 3, true], ['l1', 11, true], ['l4', 12, false]]);
  });

  it('deux chemins, un chiffre : le moteur commun et celui de l\'entreprise ; le droit gardé en texte par la fiche du Cabinet', () => {
    for (const s of ['s1', 's2']) {
      expect(compta.leaveBalance(donnees(21.5), s, 2026, AUJOURDHUI)).toEqual(core.leaveBalance(donnees(21.5), s, 2026, AUJOURDHUI));
      expect(compta.leaveBalance(donnees('21.5'), s, 2026, AUJOURDHUI)).toEqual(compta.leaveBalance(donnees(21.5), s, 2026, AUJOURDHUI));
    }
    expect(compta.leavesOf(donnees(21.5), 's1', 2026)).toEqual(core.leavesOf(donnees(21.5), 's1', 2026));
  });
});
