// 1.253.0 — la revue métier et ergonomie de la paie, page par page (02/11/2026) : les règles du moteur qu'elle a corrigées.
//   - le mois en cours ne se dit ni « pointé » ni « sauté » : il se pointe jusqu'à son dernier jour (le 2 novembre, la frise
//     cochait « Pointer : le mois est pointé ») ; un mois fini le dit comme avant ;
//   - un doublon (même n° CNSS, même RIB) dit de qui il est le double : l'écran regroupe les fiches d'un même numéro.
import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Etape = { titre: string; fait: boolean; dit: string; etat: string };
type Core = {
  paieATraiter: (d: unknown, t: string) => { salarie: string; focus: string; double?: { de: string; nom: string; quoi: string } }[];
  paieDuMois: (d: unknown, y: number, m: number) => { etapes: Etape[] };
  payslipInputFor: (d: unknown, e: unknown, y: number, m: number) => Record<string, unknown>;
  computePayslip: (e: unknown, i: unknown, s: unknown) => { net: number };
  payrollSettings: (d: unknown) => unknown;
  today: () => string;
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
const donnees = (employees: Record<string, unknown>[]) => ({ company: { currency: 'TND', name: 'Boulangerie' }, settings: {}, employees,
  payslips: [] as Record<string, unknown>[], timesheets: [] as Record<string, unknown>[], leaves: [], advances: [] });
const etablir = (d: ReturnType<typeof donnees>, y: number, m: number) => (d.employees as { id: string }[]).forEach((e) => {
  const i = core.payslipInputFor(d, e, y, m);
  d.payslips.push({ id: `${e.id}-${y}-${m}`, employeeId: e.id, year: y, month: m, ...i, computed: core.computePayslip(e, i, core.payrollSettings(d)), paidDate: '' });
});

describe('la paie après la revue du 02/11/2026', () => {
  it('le mois en cours se pointe jusqu\'à son dernier jour ; le mois fini, pointé, le dit', () => {
    const t = core.today(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
    const ya = m === 1 ? y - 1 : y, ma = m === 1 ? 12 : m - 1;
    const d = donnees([sal('a', { iban: RIB, cnss: '12345678-12' })]);
    etablir(d, y, m); etablir(d, ya, ma);
    d.timesheets.push({ employeeId: 'a', year: y, month: m, jours: {} }, { employeeId: 'a', year: ya, month: ma, jours: {} });
    const fin = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10).split('-').reverse().join('/');
    const ici = core.paieDuMois(d, y, m).etapes[0];
    expect(ici).toMatchObject({ titre: 'Pointer', fait: false, etat: 'ici', dit: `en cours, jusqu'au ${fin}` });
    expect(core.paieDuMois(d, ya, ma).etapes[0]).toMatchObject({ fait: true, dit: 'le mois est pointé' });
  });

  it('le doublon dit de qui il est le double : trois fiches sur un numéro en donnent deux, nommant la première', () => {
    const d = donnees([sal('a', { iban: RIB, cnss: '12345678-12' }), sal('b', { iban: RIB, cnss: '1234567812' }), sal('c', { iban: '08100123456789012456', cnss: '12345678 12' })]);
    const L = core.paieATraiter(d, '2026-11-02').filter((x) => x.double);
    expect(L.map((x) => [x.salarie, x.focus, x.double])).toEqual([
      ['b', 'cnss', { de: 'Salarié a', nom: 'Salarié b', quoi: 'n° CNSS' }],
      ['b', 'iban', { de: 'Salarié a', nom: 'Salarié b', quoi: 'RIB' }],
      ['c', 'cnss', { de: 'Salarié a', nom: 'Salarié c', quoi: 'n° CNSS' }],
    ]);
  });
});
