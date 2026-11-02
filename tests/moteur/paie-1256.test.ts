// 1.256.0 — les manques métier de la paie (docs/etudes/paie-concurrents.md, accord de Skander du 02/11/2026) :
//   - partir du NET voulu : le plus petit brut dont le net l'atteint, au millime, par le calcul même des bulletins ;
//   - l'ancienneté en années pleines (un jour de calendrier) et la prime d'ancienneté par tranches (vide = rien) ;
//   - les primes et retenues du mois (« variables ») : une prime entre au brut, une retenue sort du net, le mois seul ;
//   - l'indemnité de licenciement : rien sans barème réglé, sinon jours × années × salaire d'un jour ;
//   - le reçu d'un salaire payé en espèces, à faire signer.
import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Emp = Record<string, unknown>;
type Compta = {
  computePayslip: (e: Emp, i: Record<string, unknown>, s: unknown) => { net: number; gross: number };
  brutPourNet: (e: Emp, net: number, s: unknown, i?: Record<string, unknown>) => { gross: number; net: number } | null;
  anneesAnciennete: (e: Emp, jour: string) => number;
  trancheAnciennete: (s: unknown, ans: number) => { ans: number; taux: number } | null;
  primeAncienneteDuMois: (e: Emp, s: unknown, y: number, m: number, payes: number, total: number) => { label: string; amount: number; mensuel: number; taxable: boolean }[];
  variablesDuMois: (e: Emp, y: number, m: number) => { bonuses: { label: string; amount: number; taxable: boolean }[]; deductions: { label: string; amount: number }[] };
  indemniteLicenciement: (d: unknown, id: string, jour: string) => { jpa: number; annees: number; journalier: number; montant: number; label: string } | null;
  round3: (n: number) => number;
};
type Core = { payrollSettings: (d: unknown) => unknown; recuSalaireEspecesHtml: (co: unknown, o: unknown) => string };
const charger = (f: string, req: (n: string) => unknown) => {
  const m = { exports: {} as unknown };
  vm.runInNewContext(fs.readFileSync(f, 'utf8'), { module: m, exports: m.exports, require: req, console });
  return m.exports;
};
const C = charger('web/public/v10/compta.js', () => { throw new Error('compta.js ne charge rien'); }) as Compta;
const core = charger('web/public/v10/core.js', () => C) as Core;
const st = core.payrollSettings({ company: { currency: 'TND' }, settings: {}, employees: [] });
const sal = (x: Emp = {}): Emp => ({ id: 'a', name: 'Karim Zouari', grossSalary: 1100.125, hireDate: '2023-03-10', contract: 'cdi', headOfFamily: true, children: 2, ...x });

describe('la paie 1.256.0 : ce que le métier demandait', () => {
  it('un net voulu donne le plus petit brut qui l\'atteint, au millime', () => {
    const e = sal();
    const r = C.brutPourNet(e, 1000, st);
    if (!r) throw new Error('aucun brut trouvé');
    expect(r.net).toBeGreaterThanOrEqual(1000);
    expect(r.net).toBe(C.computePayslip({ ...e, grossSalary: r.gross }, { gross: r.gross }, st).net);
    // Un millime de moins et le net n'y est plus : c'est bien le plus petit.
    const moins = C.round3(r.gross - 0.001);
    expect(C.computePayslip({ ...e, grossSalary: moins }, { gross: moins }, st).net).toBeLessThan(1000);
    expect(C.brutPourNet(e, 0, st)).toBeNull();
  });

  it('l\'ancienneté se compte en années pleines, au jour près ; la tranche atteinte est la plus haute', () => {
    expect(C.anneesAnciennete(sal(), '2026-03-09')).toBe(2);
    expect(C.anneesAnciennete(sal(), '2026-03-10')).toBe(3);
    expect(C.anneesAnciennete(sal({ hireDate: '' }), '2026-03-10')).toBe(0);
    const reg = { anciennete: [{ ans: 5, taux: 5 }, { ans: 2, taux: 3 }, { ans: 10, taux: 0 }] };
    expect(C.trancheAnciennete(reg, 4)).toEqual({ ans: 2, taux: 3 });
    expect(C.trancheAnciennete(reg, 12)).toEqual({ ans: 5, taux: 5 }); // une tranche sans taux ne compte pas
    expect(C.trancheAnciennete(reg, 1)).toBeNull();
    expect(C.trancheAnciennete({}, 30)).toBeNull(); // rien de réglé : rien
  });

  it('la prime d\'ancienneté du mois suit le salaire de base et les jours payés ; sans réglage, aucune ligne', () => {
    const reg = { ...(st as object), anciennete: [{ ans: 2, taux: 3 }] };
    const e = sal();
    const [plein] = C.primeAncienneteDuMois(e, reg, 2026, 10, 26, 26);
    expect(plein.mensuel).toBe(C.round3(1100.125 * 3 / 100));
    expect(plein.amount).toBe(plein.mensuel);
    expect(plein.label).toBe('Prime d\'ancienneté (3 ans, 3 %)');
    expect(plein.taxable).toBe(true);
    const [moitie] = C.primeAncienneteDuMois(e, reg, 2026, 10, 13, 26);
    expect(moitie.amount).toBe(C.round3(plein.mensuel * 13 / 26));
    expect(C.primeAncienneteDuMois(e, st, 2026, 10, 26, 26)).toEqual([]);
    expect(C.primeAncienneteDuMois(sal({ hireDate: '2025-06-01' }), reg, 2026, 10, 26, 26)).toEqual([]); // 1 an : sous la tranche
  });

  it('les primes et retenues du mois : celles du mois seul, une prime au brut, une retenue hors du net', () => {
    const e = sal({ variables: [
      { id: 'v1', mois: '2026-10', sorte: 'prime', label: 'Panier', amount: 45.5, taxable: false },
      { id: 'v2', mois: '2026-10', sorte: 'retenue', label: 'Casse', amount: 12.25 },
      { id: 'v3', mois: '2026-11', sorte: 'prime', label: 'Commission', amount: 80 },
      { id: 'v4', mois: '2026-10', sorte: 'prime', label: 'Vide', amount: 0 }] });
    const v = C.variablesDuMois(e, 2026, 10);
    expect(v.bonuses.map((b) => [b.label, b.amount, b.taxable])).toEqual([['Panier', 45.5, false]]);
    expect(v.deductions.map((d) => [d.label, d.amount])).toEqual([['Casse', 12.25]]);
    const sans = C.computePayslip(e, { gross: 1100.125 }, st), avec = C.computePayslip(e, { gross: 1100.125, bonuses: v.bonuses, deductions: v.deductions }, st);
    expect(avec.gross).toBe(C.round3(sans.gross + 45.5));
    expect(C.variablesDuMois(e, 2026, 9)).toEqual({ bonuses: [], deductions: [] });
  });

  it('l\'indemnité de licenciement : rien hors licenciement, rien sans barème, sinon jours × années × un jour', () => {
    const d = (jpa: number, motif: string) => ({ company: { currency: 'TND' }, settings: {}, payrollSettings: { indemniteJoursParAn: jpa },
      employees: [sal({ sortieMotif: motif, endDate: '2026-10-20' })], payslips: [], leaves: [], timesheets: [] });
    expect(C.indemniteLicenciement(d(2, 'demission'), 'a', '2026-10-20')).toBeNull();
    const vide = C.indemniteLicenciement(d(0, 'licenciement'), 'a', '2026-10-20');
    expect(vide && [vide.montant, vide.label]).toEqual([0, 'Indemnité de licenciement (barème à régler dans les réglages de la paie)']);
    const r = C.indemniteLicenciement(d(2, 'licenciement'), 'a', '2026-10-20');
    if (!r) throw new Error('pas d\'indemnité');
    expect(r.annees).toBe(3.58); // du 10/03/2023 au 20/10/2026 : 3 ans et 7 mois
    expect(r.montant).toBe(C.round3(r.journalier * 2 * 3.58));
    expect(r.label).toBe('Indemnité de licenciement (2 j × 3,58 ans)');
  });

  it('le reçu d\'un salaire en espèces dit qui, combien (en chiffres et en lettres), pour quel mois', () => {
    const html = core.recuSalaireEspecesHtml({ name: 'Boulangerie El Amal', currency: 'TND', managerName: 'Sarra Ayed' },
      { year: 2026, month: 10, date: '2026-10-31', lignes: [{ name: 'Salma Ayari', cin: '09876543', poste: 'Vendeuse', net: 414.985 }] });
    expect(html).toContain('Reçu de salaire payé en espèces');
    expect(html).toContain('Salma Ayari');
    expect(html).toContain('CIN n° 09876543');
    expect(html).toMatch(/414,985/);
    expect(html).toMatch(/octobre 2026/);
    expect(html).toContain('31/10/2026');
  });
});
