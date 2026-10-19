// Le pointage des salariés (1.60.0 ; docs/paie.md, « Le pointage ») : une case par salarié et par jour, qui donne au
// bulletin ses jours d'absence non payés et ses heures supplémentaires, comme le journal de paie réel de septembre 2026
// compte les jours payés de chacun (« J. » : 26, 19,5…). Tenu ici sur l'écran de la plateforme (la v10 et ses
// adaptations, web/v10/paie-pointage.txt) :
//   - la grille d'un mois se déduit du calendrier, des congés saisis et de ce qu'on a pointé, et seul ce qui diffère se
//     garde ; un jour de repos ne prend que « Repos » ou « Présent », un jour hors contrat rien ;
//   - les jours payés du pointage sont ceux du bulletin (deux chemins, un chiffre) : le mois complet, moins les jours
//     ouvrables hors contrat, moins les absences non payées ;
//   - les heures supplémentaires se paient au taux horaire de la fiche, majoré, sans aucune majoration écrite d'avance ;
//   - un bulletin établi qui ne suit plus le pointage le sait, et la reprise remplace ses heures sans les doubler.
// Les montants discriminent (un brut de 1 234,567, une prime de 80 sur 23,5 jours) : un arrondi faux se voit.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Prime10 = { label: string; amount: number; taxable?: boolean; parJour?: boolean; mensuel?: number; jours?: number; sur?: number; hs?: number; heures?: number };
type Jour = { jour: number; iso: string; wd: number; code: string; source: string; repos: boolean };
type Pointage = { jours: Jour[]; absences: number; payes: number; total: number; hs: Record<string, number>; pointe: boolean };
type Saisie = { gross: number; workedDays: number; absentDays: number; bonuses: Prime10[]; deductions: unknown[]; prorata: { jours: number; sur: number } | null };
type Salarie = { id: string; name: string; grossSalary: number; hireDate?: string; endDate?: string; primes?: unknown[]; [k: string]: unknown };
type Dossier = { employees: Salarie[]; leaves: unknown[]; advances: unknown[]; payslips: Record<string, unknown>[]; timesheets?: { employeeId: string; jours: Record<string, string>; hs: Record<string, number> }[]; payrollSettings: Record<string, unknown> };

const compta = ecranDeLaPlateforme('compta.js') as {
  DEFAULT_PAYROLL: Record<string, unknown>;
  computePayslip: (e: Salarie, i: unknown, s: unknown) => Record<string, number>;
};
const core = ecranDeLaPlateforme('core.js') as {
  payrollSettings: (d: Dossier) => Record<string, unknown>;
  pointageDuMois: (d: Dossier, e: Salarie, annee: number, mois: number) => Pointage;
  poserPointage: (d: Dossier, e: Salarie, annee: number, mois: number, jour: number, code: string) => boolean;
  poserHeuresSup: (d: Dossier, e: Salarie, annee: number, mois: number, majoration: number, heures: number | string) => boolean;
  heuresSupDuMois: (d: Dossier, e: Salarie, annee: number, mois: number) => Prime10[];
  payslipInputFor: (d: Dossier, e: Salarie, annee: number, mois: number) => Saisie;
  pointageSurBulletin: (d: Dossier, slip: Record<string, unknown>) => { absentDays: number; bonuses: Prime10[]; change: boolean; avant: number; absences: boolean; heures: boolean } | null;
  CODES_POINTAGE: [string, string][];
};

// Septembre 2026 commence un mardi : ses dimanches sont les 6, 13, 20 et 27.
const DIMANCHES = [6, 13, 20, 27];
function dossier(reglages: Record<string, unknown> = {}): { d: Dossier; e: Salarie } {
  const e: Salarie = { id: 'sal-1', name: 'Salarié 1', grossSalary: 1234.567, hireDate: '2026-01-05', contract: 'cdi',
    primes: [{ label: 'Prime de présence', amount: 80, taxable: true, parJour: true }, { label: 'Indemnité de transport', amount: 45.5, taxable: false }] };
  const d: Dossier = { employees: [e], leaves: [], advances: [], payslips: [], payrollSettings: { ...compta.DEFAULT_PAYROLL, offDays: [0], workedDays: 26, ...reglages } };
  return { d, e };
}
const code = (p: Pointage, jour: number) => p.jours.find((j) => j.jour === jour)?.code;

describe('le pointage d\'un mois, sur l\'écran de la plateforme', () => {
  it('aucune majoration d\'heures supplémentaires n\'est écrite d\'avance ; un mois complet fait 208 heures', () => {
    expect([compta.DEFAULT_PAYROLL.hsMaj1, compta.DEFAULT_PAYROLL.hsMaj2, compta.DEFAULT_PAYROLL.hsMaj3]).toEqual([0, 0, 0]);
    expect(compta.DEFAULT_PAYROLL.heuresMois).toBe(208);
    expect(core.CODES_POINTAGE.map((c) => c[0])).toEqual(['P', 'D', 'A', 'C', 'M', 'F', 'R']);
  });

  it('sans rien pointer, la grille est le calendrier : le repos de la semaine, les autres jours présents, 26 jours payés', () => {
    const { d, e } = dossier();
    const p = core.pointageDuMois(d, e, 2026, 9);
    expect(p.jours).toHaveLength(30);
    expect(p.jours.filter((j) => j.code === 'R').map((j) => j.jour)).toEqual(DIMANCHES);
    expect(p.jours.filter((j) => j.repos).map((j) => j.jour)).toEqual(DIMANCHES);
    expect(p.jours.every((j) => j.source === 'calendrier' && (j.code === 'P' || j.code === 'R'))).toBe(true);
    expect([p.absences, p.payes, p.pointe]).toEqual([0, 26, false]);
    expect(d.timesheets).toBeUndefined();
  });

  it('les congés et absences saisis s\'y posent : une absence sans solde se retire, une maladie et un congé se paient', () => {
    const { d, e } = dossier();
    d.leaves.push({ id: 'l1', employeeId: e.id, kind: 'sans-solde', from: '2026-09-14', to: '2026-09-15' },
      { id: 'l2', employeeId: e.id, kind: 'maladie', from: '2026-09-21', to: '2026-09-21' },
      { id: 'l3', employeeId: e.id, kind: 'conges', from: '2026-09-19', to: '2026-09-22' },
      // L'absence d'un autre salarié ne le regarde pas.
      { id: 'l4', employeeId: 'sal-2', kind: 'sans-solde', from: '2026-09-01', to: '2026-09-30' });
    const p = core.pointageDuMois(d, e, 2026, 9);
    expect([14, 15, 19, 20, 21, 22].map((j) => code(p, j))).toEqual(['A', 'A', 'C', 'R', 'M', 'C']);
    expect(p.jours.find((j) => j.jour === 14)?.source).toBe('conge');
    // Le 21 est couvert par deux saisies : la première (la maladie) le nomme ; il est payé de toute façon.
    expect([p.absences, p.payes]).toEqual([2, 24]);
    // Deux chemins, un chiffre : le bulletin sans pointage compte la même absence.
    expect(core.payslipInputFor(d, e, 2026, 9).absentDays).toBe(2);
  });

  it('pointer un jour ne garde que ce qui diffère ; une demi-journée retire une moitié ; revenir au calendrier efface', () => {
    const { d, e } = dossier();
    expect(core.poserPointage(d, e, 2026, 9, 8, 'D')).toBe(true);
    expect(d.timesheets).toHaveLength(1);
    expect(d.timesheets?.[0]?.jours).toEqual({ 8: 'D' });
    let p = core.pointageDuMois(d, e, 2026, 9);
    expect([code(p, 8), p.jours[7]?.source, p.absences, p.payes, p.pointe]).toEqual(['D', 'pointe', 0.5, 25.5, true]);
    expect(core.poserPointage(d, e, 2026, 9, 9, 'A')).toBe(true);
    expect(core.poserPointage(d, e, 2026, 9, 10, 'P')).toBe(true);   // déjà présent : rien à garder
    expect(d.timesheets?.[0]?.jours).toEqual({ 8: 'D', 9: 'A' });
    p = core.pointageDuMois(d, e, 2026, 9);
    expect([p.absences, p.payes]).toEqual([1.5, 24.5]);
    expect(core.poserPointage(d, e, 2026, 9, 9, 'P')).toBe(true);
    expect(d.timesheets?.[0]?.jours).toEqual({ 8: 'D' });
    // Un code inconnu se refuse.
    expect(core.poserPointage(d, e, 2026, 9, 11, 'X')).toBe(false);
    expect(d.timesheets?.[0]?.jours).toEqual({ 8: 'D' });
  });

  it('pointé, un congé saisi se corrige à la main ; les jours qu\'on n\'a pas touchés suivent encore les congés', () => {
    const { d, e } = dossier();
    d.leaves.push({ id: 'l1', employeeId: e.id, kind: 'sans-solde', from: '2026-09-14', to: '2026-09-16' });
    expect(core.poserPointage(d, e, 2026, 9, 15, 'P')).toBe(true);   // finalement venu le 15
    expect(d.timesheets?.[0]?.jours).toEqual({ 15: 'P' });
    let p = core.pointageDuMois(d, e, 2026, 9);
    expect([14, 15, 16].map((j) => code(p, j))).toEqual(['A', 'P', 'A']);
    expect(p.absences).toBe(2);
    // Une absence saisie APRÈS le pointage se pose encore sur les jours non pointés.
    d.leaves.push({ id: 'l2', employeeId: e.id, kind: 'abandon', from: '2026-09-29', to: '2026-09-29' });
    p = core.pointageDuMois(d, e, 2026, 9);
    expect([code(p, 29), p.absences, p.payes]).toEqual(['A', 3, 23]);
  });

  it('un jour de repos ne prend que « Repos » ou « Présent », et ne retire jamais un jour payé ; un refus n\'écrit rien', () => {
    const { d, e } = dossier();
    for (const c of ['A', 'D', 'C', 'M', 'F']) expect(core.poserPointage(d, e, 2026, 9, 6, c), c).toBe(false);
    // Rien n'a été écrit : le mois n'est pas devenu « pointé » par un refus.
    expect(d.timesheets ?? []).toEqual([]);
    expect(core.poserPointage(d, e, 2026, 9, 6, 'P')).toBe(true);
    let p = core.pointageDuMois(d, e, 2026, 9);
    expect([code(p, 6), p.absences, p.payes]).toEqual(['P', 0, 26]);
    // Un refus sur un jour déjà pointé le laisse tel quel.
    expect(core.poserPointage(d, e, 2026, 9, 6, 'A')).toBe(false);
    expect(d.timesheets?.[0]?.jours).toEqual({ 6: 'P' });
    // Même un code de repos enregistré par un autre chemin (un vieux poste, une copie) ne se compte pas en absence.
    const t = d.timesheets?.[0];
    if (t) t.jours = { 13: 'A', 20: 'D' };
    p = core.pointageDuMois(d, e, 2026, 9);
    expect([p.absences, p.payes]).toEqual([0, 26]);
  });

  it('hors contrat, un jour ne se pointe pas ; les jours payés du pointage sont ceux du bulletin proratisé', () => {
    const { d, e } = dossier();
    e.hireDate = '2026-09-10';   // embauché un jeudi : du 1er au 9, huit jours ouvrables hors contrat
    let p = core.pointageDuMois(d, e, 2026, 9);
    expect(p.jours.filter((j) => j.code === '-').map((j) => j.jour)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(p.payes).toBe(18);
    expect(core.poserPointage(d, e, 2026, 9, 3, 'P')).toBe(false);
    expect(d.timesheets ?? []).toEqual([]);
    const i = core.payslipInputFor(d, e, 2026, 9);
    expect(i.prorata?.jours).toBe(18);
    // Une absence pointée après l'entrée : le pointage et le bulletin disent les mêmes jours payés.
    expect(core.poserPointage(d, e, 2026, 9, 17, 'A')).toBe(true);
    p = core.pointageDuMois(d, e, 2026, 9);
    const j = core.payslipInputFor(d, e, 2026, 9);
    expect(p.payes).toBe(17);
    expect((j.prorata?.jours ?? 0) - j.absentDays).toBe(p.payes);
    expect(j.bonuses.find((b) => b.parJour)).toMatchObject({ jours: 17, sur: 26, amount: 52.308 });   // 80 × 17 / 26
    // Une sortie : les jours après la sortie non plus.
    e.endDate = '2026-09-25';
    p = core.pointageDuMois(d, e, 2026, 9);
    expect(p.jours.filter((x) => x.code === '-').map((x) => x.jour)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 26, 27, 28, 29, 30]);
    expect(p.payes).toBe(13);   // 26 − 8 − 4 (les 26, 28, 29, 30) − 1
  });

  it('les heures supplémentaires : rien sans majoration réglée ; sinon le taux horaire de la fiche, majoré, au millime', () => {
    const sans = dossier();
    expect(core.poserHeuresSup(sans.d, sans.e, 2026, 9, 25, 6)).toBe(true);
    expect(core.heuresSupDuMois(sans.d, sans.e, 2026, 9)).toEqual([]);
    const { d, e } = dossier({ hsMaj1: 25, hsMaj2: 50 });
    core.poserHeuresSup(d, e, 2026, 9, 25, 6);
    core.poserHeuresSup(d, e, 2026, 9, 50, '2.5');
    core.poserHeuresSup(d, e, 2026, 9, 75, 3);   // une majoration qu'on n'a pas réglée ne se paie pas
    // 1 234,567 × 6 × 1,25 / 208 = 44,5156… ; 1 234,567 × 2,5 × 1,5 / 208 = 22,2578…
    expect(core.heuresSupDuMois(d, e, 2026, 9)).toEqual([
      { label: 'Heures supplémentaires : 6 h à +25 %', amount: 44.516, taxable: true, hs: 25, heures: 6 },
      { label: 'Heures supplémentaires : 2,5 h à +50 %', amount: 22.258, taxable: true, hs: 50, heures: 2.5 },
    ]);
    // Effacer des heures les retire ; sans heures d'un mois complet, rien ne se calcule.
    core.poserHeuresSup(d, e, 2026, 9, 50, '');
    expect(core.heuresSupDuMois(d, e, 2026, 9).map((b) => b.hs)).toEqual([25]);
    d.payrollSettings.heuresMois = 0;
    expect(core.heuresSupDuMois(d, e, 2026, 9)).toEqual([]);
  });

  it('un mois pointé donne au bulletin ses absences, ses primes au jour et ses heures ; le bulletin calcule comme une saisie à la main', () => {
    const { d, e } = dossier({ hsMaj1: 25 });
    const avant = core.payslipInputFor(d, e, 2026, 9);
    expect(avant.bonuses.map((b) => [b.label, b.amount])).toEqual([['Prime de présence', 80], ['Indemnité de transport', 45.5]]);
    core.poserPointage(d, e, 2026, 9, 8, 'D');
    core.poserPointage(d, e, 2026, 9, 9, 'A');
    core.poserPointage(d, e, 2026, 9, 10, 'A');
    core.poserHeuresSup(d, e, 2026, 9, 25, 6);
    const i = core.payslipInputFor(d, e, 2026, 9);
    expect(i.absentDays).toBe(2.5);
    expect(i.bonuses).toEqual([
      { label: 'Prime de présence', amount: 72.308, taxable: true, parJour: true, mensuel: 80, jours: 23.5, sur: 26 },   // 80 × 23,5 / 26
      { label: 'Indemnité de transport', amount: 45.5, taxable: false },
      { label: 'Heures supplémentaires : 6 h à +25 %', amount: 44.516, taxable: true, hs: 25, heures: 6 },
    ]);
    // Le reste de la saisie ne bouge pas (le brut, les jours du mois).
    expect([i.gross, i.workedDays]).toEqual([avant.gross, avant.workedDays]);
    // Deux chemins, un chiffre : le bulletin du pointage et le même bulletin tapé à la main.
    const s = core.payrollSettings(d);
    const aLaMain = { gross: 1234.567, workedDays: 26, absentDays: 2.5, deductions: [],
      bonuses: [{ label: 'Prime de présence', amount: 72.308, taxable: true }, { label: 'Indemnité de transport', amount: 45.5, taxable: false }, { label: 'HS', amount: 44.516, taxable: true }] };
    const a = compta.computePayslip(e, i, s), b = compta.computePayslip(e, aLaMain, s);
    for (const k of ['gross', 'cnssEmployee', 'irpp', 'css', 'net', 'employerCost']) expect(a[k], k).toBe(b[k]);
  });

  it('un bulletin établi avant le pointage le sait ; repris, il le suit, et ses heures se remplacent sans se doubler', () => {
    const { d, e } = dossier({ hsMaj1: 25 });
    d.leaves.push({ id: 'l1', employeeId: e.id, kind: 'sans-solde', from: '2026-09-14', to: '2026-09-15' });
    const slip: Record<string, unknown> = { id: 'b1', employeeId: e.id, year: 2026, month: 9, ...core.payslipInputFor(d, e, 2026, 9) };
    d.payslips.push(slip);
    expect(slip.absentDays).toBe(2);
    expect(core.pointageSurBulletin(d, slip)).toBeNull();   // pas de pointage : rien à dire
    core.poserPointage(d, e, 2026, 9, 15, 'P');
    core.poserHeuresSup(d, e, 2026, 9, 25, 4);
    const r = core.pointageSurBulletin(d, slip);
    // Ce qui diffère se dit : les absences et les heures.
    expect(r).toMatchObject({ change: true, avant: 2, absentDays: 1, absences: true, heures: true });
    expect(r?.bonuses.map((b) => [b.label, b.amount])).toEqual([['Prime de présence', 76.923], ['Indemnité de transport', 45.5],   // 80 × 25 / 26
      ['Heures supplémentaires : 4 h à +25 %', 29.677]]);   // 1 234,567 × 4 × 1,25 / 208
    Object.assign(slip, { absentDays: r?.absentDays, bonuses: r?.bonuses });
    expect(core.pointageSurBulletin(d, slip)?.change).toBe(false);
    // Les heures changent : la reprise remplace la ligne d'heures, elle ne l'ajoute pas à l'ancienne.
    core.poserHeuresSup(d, e, 2026, 9, 25, 8);
    const r2 = core.pointageSurBulletin(d, slip);
    expect(r2).toMatchObject({ change: true, absences: false, heures: true });
    expect(r2?.bonuses.filter((b) => b.hs).map((b) => [b.label, b.amount])).toEqual([['Heures supplémentaires : 8 h à +25 %', 59.354]]);
    expect(r2?.bonuses).toHaveLength(3);
    // Une prime tapée à la main sur le bulletin reste.
    (slip.bonuses as Prime10[]).push({ label: 'Prime exceptionnelle', amount: 33.333, taxable: true });
    expect(core.pointageSurBulletin(d, slip)?.bonuses.map((b) => b.label)).toContain('Prime exceptionnelle');
  });
});
