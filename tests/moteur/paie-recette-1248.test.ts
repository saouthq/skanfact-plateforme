// 1.248.0 — la recette à la souris de la paie de l'entreprise (02/11/2026) : les règles du mois qu'elle a corrigées.
//   - un salarié sorti en cours de mois (un CDD qui finit le 20) a son bulletin du mois, au prorata ; la règle lisait le
//     dernier jour du mois et l'oubliait ;
//   - deux salariés payés par virement sur le même RIB, ou déclarés sous le même n° CNSS : le contrôle du mois le dit ;
//   - la sortie du mois se proratise, et l'écart avec le mois d'avant dit « sortie le … », pas « brut changé » ;
//   - sans bulletin le mois d'avant, il n'y a pas de contrôle « Écarts » (rien à comparer).
import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Controle = { id: string; ok: boolean; titre: string; dit: string };
type Core = {
  missingPayslips: (d: unknown, y: number, m: number) => { id: string }[];
  controlesDuMois: (d: unknown, y: number, m: number) => Controle[];
  payslipInputFor: (d: unknown, e: unknown, y: number, m: number) => Record<string, unknown>;
  computePayslip: (e: unknown, i: unknown, s: unknown) => { net: number; gross: number };
  payrollSettings: (d: unknown) => unknown;
};
const charger = (f: string, req: (n: string) => unknown) => {
  const m = { exports: {} as unknown };
  vm.runInNewContext(fs.readFileSync(f, 'utf8'), { module: m, exports: m.exports, require: req, console });
  return m.exports;
};
const compta = charger('web/public/v10/compta.js', () => { throw new Error('compta.js ne charge rien'); });
const core = charger('web/public/v10/core.js', () => compta) as Core;

const RIB = '08100123456789012359';
const sal = (id: string, x: Record<string, unknown> = {}) => ({ id, name: `Salarié ${id}`, grossSalary: 1100.125, hireDate: '2023-03-10', contract: 'cdi',
  headOfFamily: false, children: 0, active: true, method: 'virement', iban: '', cnss: '', position: 'Boulanger', ...x });
const donnees = (employees: Record<string, unknown>[]) => ({ company: { currency: 'TND' }, settings: {}, employees, payslips: [] as Record<string, unknown>[], timesheets: [], leaves: [], advances: [] });
const etablir = (d: ReturnType<typeof donnees>, y: number, m: number) => core.missingPayslips(d, y, m).forEach((e) => {
  const i = core.payslipInputFor(d, e, y, m);
  d.payslips.push({ id: `${e.id}-${m}`, employeeId: e.id, year: y, month: m, ...i, computed: core.computePayslip(e, i, core.payrollSettings(d)), paidDate: '' });
});

describe('la paie du mois après la recette du 02/11/2026', () => {
  it('un CDD qui finit le 20 a son bulletin du mois, au prorata ; un salarié sorti avant le mois n\'en a pas', () => {
    const d = donnees([sal('a'), sal('k', { contract: 'cdd', endDate: '2026-11-20' }), sal('p', { endDate: '2026-10-31' }), sal('n', { hireDate: '2026-12-01' })]);
    expect(core.missingPayslips(d, 2026, 11).map((e) => e.id).sort()).toEqual(['a', 'k']);
    etablir(d, 2026, 11);
    const k = d.payslips.find((p) => p.employeeId === 'k') as { gross: number; prorata: unknown };
    expect(k.prorata).toBeTruthy();
    expect(k.gross).toBeGreaterThan(0);
    expect(k.gross).toBeLessThan(1100.125);
    const c = core.controlesDuMois(d, 2026, 11);
    expect(c.find((x) => x.id === 'prorata-sortie')).toMatchObject({ ok: true, titre: 'La sortie de Salarié au prorata' });
    expect(c.find((x) => x.id === 'bulletins')).toMatchObject({ ok: true });
    // Aucun bulletin en octobre : rien à comparer, pas de contrôle « Écarts sur octobre ».
    expect(c.find((x) => x.id === 'ecarts')).toBeUndefined();
  });

  it('deux salariés sur le même RIB (virement) ou le même n° CNSS : le contrôle le dit ; les espèces ne comptent pas', () => {
    const d = donnees([sal('a', { iban: RIB, cnss: '12345678-12' }), sal('b', { iban: RIB, cnss: '1234567812' }), sal('c', { iban: RIB, method: 'especes', cnss: '87654321-00' })]);
    etablir(d, 2026, 11);
    const c = core.controlesDuMois(d, 2026, 11);
    const rib = c.find((x) => x.id === 'rib-double') as Controle;
    expect(rib).toMatchObject({ ok: false, titre: 'Pas deux salariés sur le même RIB' });
    expect(rib.dit).toContain('Salarié a, Salarié b : le même RIB');
    expect(rib.dit).not.toContain('Salarié c');
    // Le même numéro écrit avec ou sans tiret.
    expect(c.find((x) => x.id === 'cnss-double')).toMatchObject({ ok: false, titre: 'Pas deux salariés sur le même n° CNSS' });
    // Ceux qui demandent un geste passent en tête.
    expect(c.slice(0, 2).every((x) => !x.ok)).toBe(true);
  });

  it('des RIB et des n° CNSS tous différents : ni l\'un ni l\'autre des doublons ne se signale', () => {
    const d = donnees([sal('a', { iban: RIB, cnss: '11111111-11' }), sal('b', { iban: '08100123456789012456', cnss: '22222222-22' })]);
    etablir(d, 2026, 11);
    const c = core.controlesDuMois(d, 2026, 11);
    expect(c.find((x) => x.id === 'rib-double')).toMatchObject({ ok: true });
    expect(c.find((x) => x.id === 'cnss-double')).toBeUndefined();
  });

  it('l\'écart avec le mois d\'avant d\'une sortie se dit « sortie le … »', () => {
    const d = donnees([sal('k', { contract: 'cdd', endDate: '2026-11-20' })]);
    etablir(d, 2026, 10);
    etablir(d, 2026, 11);
    const e = core.controlesDuMois(d, 2026, 11).find((x) => x.id === 'ecarts') as Controle;
    expect(e.dit).toContain('sortie le 20/11/2026');
    expect(e.dit).not.toContain('brut changé');
  });
});
