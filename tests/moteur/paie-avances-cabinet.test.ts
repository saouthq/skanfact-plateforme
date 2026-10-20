// Les avances au Cabinet (1.71.0 ; docs/paie.md, « Les avances au Cabinet »). Le moteur des avances de l'entreprise (5.1.0)
// vit dans le moteur commun (compta.js), que le Cabinet charge : ce qui reste d'une avance, et l'échéance qu'un bulletin
// nouveau en retient, sont ceux de l'entreprise. Deux chemins, un chiffre : compta.js et core.js (qui le reprend) disent le
// même reste ; et la saisie d'un bulletin nouveau du Cabinet (`saisieDuMois`) porte les retenues de celle de l'entreprise
// (`payslipInputFor`). Les données discriminent : 1 000,750 avancés à 300,125 par mois (la quatrième échéance ne prend que
// 100,375), une avance versée en novembre et retenue jusqu'en février de l'année suivante, une autre sans retenue convenue.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Retenue = { label: string; amount: number; advanceId?: string };
type Avance = { id: string; employeeId: string; date: string; amount: number; monthly: number };
type Bulletin = { id: string; employeeId: string; year: number; month: number; deductions: Retenue[] };
type Donnees = { employees: Record<string, unknown>[]; advances: Avance[]; payslips: Bulletin[]; leaves: unknown[]; timesheets: unknown[]; payrollSettings: Record<string, unknown> };
type AvanceLue = Avance & { repaid: number; remaining: number; done: boolean };
type Saisie = { gross: number; deductions: Retenue[] };
type Moteur = {
  advancesOf: (d: Donnees, salarie: string) => AvanceLue[];
  advanceBalance: (d: Donnees, salarie: string) => number;
  echeancesDuMois: (d: Donnees, salarie: string, annee: number, mois: number) => Retenue[];
  saisieDuMois: (d: Donnees, salarie: Record<string, unknown>, annee: number, mois: number) => Saisie;
  payslipInputFor: (d: Donnees, salarie: Record<string, unknown>, annee: number, mois: number) => Saisie;
  avancesDeLAnnee: (d: Donnees, annee: number) => AvanceLue[];
  ajouterBulletin: (livre: Record<string, unknown>, b: Record<string, unknown>, baremes: Record<string, unknown>, qui: string, quand: number) =>
    { ok: boolean; motif?: string; bulletin: { id: string; retenues: Retenue[]; calcul: { otherDeductions: number } } };
};
const compta = ecranDeLaPlateforme('compta.js') as Moteur;
const core = ecranDeLaPlateforme('core.js') as Moteur;

const retenue = (id: string, date: string, montant: number): Retenue => ({ label: `Remboursement d'avance du ${date}`, amount: montant, advanceId: id });
function donnees(): Donnees {
  const s1 = { id: 's1', name: 'salarié 1', grossSalary: 1234.567, hireDate: '2025-01-01', contract: 'cdi' };
  const s2 = { id: 's2', name: 'salarié 2', grossSalary: 980, hireDate: '2024-02-01', contract: 'cdi' };
  return {
    employees: [s1, s2],
    advances: [
      { id: 'a1', employeeId: 's1', date: '2025-11-20', amount: 1000.75, monthly: 300.125 },
      { id: 'a2', employeeId: 's1', date: '2026-02-10', amount: 150, monthly: 0 },
    ],
    // Trois échéances de a1 retenues, de novembre à janvier ; et, sur un bulletin d'un AUTRE salarié, une retenue marquée
    // du même numéro (une avance qui aurait changé de salarié) : elle ne rembourse pas a1.
    payslips: [
      { id: 'b11', employeeId: 's1', year: 2025, month: 11, deductions: [retenue('a1', '20/11/2025', 300.125)] },
      { id: 'b12', employeeId: 's1', year: 2025, month: 12, deductions: [retenue('a1', '20/11/2025', 300.125)] },
      { id: 'b01', employeeId: 's1', year: 2026, month: 1, deductions: [retenue('a1', '20/11/2025', 300.125), { label: 'Cantine', amount: 12.5 }] },
      { id: 'b2', employeeId: 's2', year: 2026, month: 1, deductions: [retenue('a1', '20/11/2025', 500)] },
    ],
    leaves: [], timesheets: [], payrollSettings: {},
  };
}

describe('les avances au Cabinet : le moteur de l\'entreprise, dans le moteur commun', () => {
  it('ce qui reste d\'une avance se lit sur les bulletins de SON salarié, de toutes les années', () => {
    const d = donnees();
    const lues = compta.advancesOf(d, 's1');
    // La plus récente d'abord ; a1 : trois échéances retenues (900,375), 100,375 restent ; a2 : rien de retenu.
    expect(lues.map((a) => [a.id, a.repaid, a.remaining, a.done])).toEqual([['a2', 0, 150, false], ['a1', 900.375, 100.375, false]]);
    expect(compta.advanceBalance(d, 's1')).toBe(250.375);
    // Deux chemins, un chiffre : l'entreprise dit la même chose.
    expect(core.advancesOf(d, 's1')).toEqual(lues);
    expect(core.advanceBalance(d, 's1')).toBe(250.375);
    // La retenue posée sur le bulletin d'un autre salarié ne rembourse rien : c'est pourquoi une avance déjà retenue ne
    // change plus de salarié (elle se lirait non remboursée chez l'autre).
    expect(compta.advancesOf({ ...d, advances: [{ ...d.advances[0] as Avance, employeeId: 's2' }] }, 's2').map((a) => [a.repaid, a.remaining])).toEqual([[500, 500.75]]);
  });

  it('l\'échéance d\'un mois : la retenue convenue, jamais plus que ce qui reste ; rien avant le versement', () => {
    const d = donnees();
    // Octobre 2025 : a1 n'est pas encore versée.
    expect(compta.echeancesDuMois(d, 's1', 2025, 10)).toEqual([]);
    // Janvier 2026 (un bulletin nouveau, à côté de celui qui existe) : la dernière échéance de a1, 100,375 ; a2, versée le
    // 10 février, n'en a pas encore.
    expect(compta.echeancesDuMois(d, 's1', 2026, 1)).toEqual([retenue('a1', '20/11/2025', 100.375)]);
    // Février : a2 sans retenue convenue se retient en entier ; a1 finit.
    expect(compta.echeancesDuMois(d, 's1', 2026, 2)).toEqual([retenue('a2', '10/02/2026', 150), retenue('a1', '20/11/2025', 100.375)]);
    // Remboursées toutes deux : plus rien en mars.
    const solde = { ...d, payslips: [...d.payslips, { id: 'b02', employeeId: 's1', year: 2026, month: 2, deductions: compta.echeancesDuMois(d, 's1', 2026, 2) }] };
    expect(compta.echeancesDuMois(solde, 's1', 2026, 3)).toEqual([]);
    expect(compta.advancesOf(solde, 's1').map((a) => a.done)).toEqual([true, true]);
    expect(compta.advanceBalance(solde, 's1')).toBe(0);
  });

  it('deux chemins, un chiffre : le bulletin nouveau du Cabinet retient ce que celui de l\'entreprise retient', () => {
    const d = donnees();
    const s1 = d.employees[0] as Record<string, unknown>;
    for (const [annee, mois] of [[2025, 10], [2025, 11], [2026, 1], [2026, 2]] as const) {
      const entreprise = core.payslipInputFor(d, s1, annee, mois);
      const cabinet = compta.saisieDuMois(d, s1, annee, mois);
      expect({ annee, mois, retenues: cabinet.deductions }).toEqual({ annee, mois, retenues: entreprise.deductions });
      expect({ annee, mois, brut: cabinet.gross }).toEqual({ annee, mois, brut: entreprise.gross });
    }
    expect(compta.saisieDuMois(d, s1, 2026, 2).deductions).toEqual([retenue('a2', '10/02/2026', 150), retenue('a1', '20/11/2025', 100.375)]);
  });

  it('les avances d\'une année : versées dans l\'année, ou avant et pas soldées à son début ; ni soldées avant, ni versées après', () => {
    const d = donnees();
    // a3 : versée en mai 2024, soldée en juin 2024. a4 : versée le 15 décembre 2025, soldée sur le bulletin de janvier 2026.
    const avecSoldees: Donnees = { ...d,
      advances: [...d.advances, { id: 'a3', employeeId: 's2', date: '2024-05-01', amount: 100, monthly: 100 }, { id: 'a4', employeeId: 's2', date: '2025-12-15', amount: 50, monthly: 50 }],
      payslips: [...d.payslips,
        { id: 'b3', employeeId: 's2', year: 2024, month: 6, deductions: [retenue('a3', '01/05/2024', 100)] },
        { id: 'b4', employeeId: 's2', year: 2026, month: 1, deductions: [retenue('a4', '15/12/2025', 50)] }] };
    const ids = (annee: number) => compta.avancesDeLAnnee(avecSoldees, annee).map((a) => a.id);
    expect(ids(2024)).toEqual(['a3']);
    // 2025 : a1 et a4, versées dans l'année ; a3, soldée en 2024, n'en est plus ; a2, versée en 2026, pas encore.
    expect(ids(2025)).toEqual(['a4', 'a1']);
    // 2026 : a2, versée dans l'année ; a1, d'avant et pas soldée ; a4, d'avant mais soldée en janvier : retenue dans l'année.
    expect(ids(2026)).toEqual(['a2', 'a4', 'a1']);
    expect(ids(2027)).toEqual(['a2', 'a1']);
  });

  it('un bulletin enregistré au Cabinet, établi puis modifié, garde le numéro de l\'avance que chaque retenue rembourse', () => {
    const livre = { exercice: { annee: 2026, clos: false }, ecritures: [], audit: [], bulletins: [] as unknown[],
      salaries: [{ id: 's1', nom: 'salarié 1', brut: 1234.567, actif: true, embauche: '2025-01-01', contrat: 'cdi', chefDeFamille: false, enfants: 0 }] };
    const saisie = { salarieId: 's1', annee: 2026, mois: 2, brut: 1234.567, joursTravailles: 26, joursAbsence: 0, primes: [],
      retenues: [retenue('a1', '20/11/2025', 100.375), { label: 'Cantine', amount: 12.5 }] };
    const etabli = compta.ajouterBulletin(livre, { id: 'b02', ...saisie }, {}, '', 1);
    expect(etabli.ok, etabli.motif).toBe(true);
    expect(etabli.bulletin.retenues).toEqual([retenue('a1', '20/11/2025', 100.375), { label: 'Cantine', amount: 12.5 }]);
    expect(etabli.bulletin.calcul.otherDeductions).toBe(112.875);
    // Modifié (la retenue de l'avance ramenée à 50) : le numéro reste, l'avance se lit remboursée de 50.
    const modifie = compta.ajouterBulletin(livre, { id: 'b02', ...saisie, retenues: [retenue('a1', '20/11/2025', 50)] }, {}, '', 2);
    expect(modifie.bulletin.retenues).toEqual([retenue('a1', '20/11/2025', 50)]);
  });

  it('l\'aide du montant d\'une avance dit où se lit son versement, comme celle de son mode (10.14.0 l\'y fait sortir le jour même)', () => {
    const { INFO } = ecranDeLaPlateforme('guide.js') as { INFO: Record<string, { d: string } | undefined> };
    expect(INFO['hr.advanceAmount']?.d).not.toMatch(/n'apparaît ni dans ta Trésorerie ni dans les écritures/);
    expect(INFO['hr.advanceAmount']?.d).toMatch(/Le versement se lit le jour même : il sort de ta Trésorerie/);
    expect(INFO['hr.advanceMethod']?.d).toMatch(/la Trésorerie voit partir le montant ce jour-là/);
  });
});
