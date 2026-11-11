// (1.330.0) La frise de la paie dit « la déclaration d'octobre », jamais « de octobre » (avril et août aussi) ; mars garde son « de ».
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { lireEcran } from '../../commun/assemblage.ts';

type Etape = { titre: string; dit: string; fait: boolean };
type Core = {
  paieDuMois: (d: unknown, y: number, m: number, o?: unknown) => { etapes: Etape[]; etatDit?: string };
  computePayslip: (e: unknown, i: unknown, s: unknown) => Record<string, unknown>;
  payrollSettings: (d: unknown) => unknown;
};
const charger = (f: string, req: (n: string) => unknown) => {
  const m = { exports: {} as unknown };
  vm.runInNewContext(lireEcran(f), { module: m, exports: m.exports, require: req, console });
  return m.exports;
};
const compta = charger('v10/compta.js', () => { throw new Error('compta.js ne charge rien'); });
const core = charger('v10/core.js', () => compta) as Core;

describe('(1.330.0) la déclaration du mois, élidée devant une voyelle', () => {
  it('« d’octobre », « d’avril », « d’août », mais « de mars »', () => {
    const d = { company: { currency: 'TND', name: 'Boulangerie' }, settings: {}, employees: [{ id: 'e1', name: 'Hédi Trabelsi', grossSalary: 1250, hireDate: '2023-03-01',
      contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'especes', iban: '', cnss: '', position: 'Boulanger' }],
    payslips: [], timesheets: [], leaves: [], advances: [] };
    const declarer = (m: number) => String(core.paieDuMois(d, 2099, m).etapes.find((e) => e.titre === 'Déclarer')?.dit);
    expect(declarer(10)).toBe('la retenue avec la déclaration d’octobre · la CNSS au trimestre');
    expect(declarer(4)).toContain('déclaration d’avril');
    expect(declarer(8)).toContain('déclaration d’août');
    expect(declarer(3)).toContain('déclaration de mars');
  });
});

describe('(1.355.6) la déclaration du mois faite se dit sur l’étape « Déclarer »', () => {
  it('déposée, puis payée : l’étape le dit ; celle d’un autre mois ne compte pas', () => {
    const d = { company: { currency: 'TND', name: 'Boulangerie' }, settings: {}, employees: [{ id: 'e1', name: 'Hédi Trabelsi', grossSalary: 1250, hireDate: '2023-03-01',
      contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'especes', iban: '', cnss: '', position: 'Boulanger' }],
    payslips: [], timesheets: [], leaves: [], advances: [] };
    const declarer = (socialFilings: unknown[]) => String(core.paieDuMois({ ...d, socialFilings }, 2099, 10).etapes.find((e) => e.titre === 'Déclarer')?.dit);
    expect(declarer([{ id: 'dm-2099-10', filedAt: '2099-11-11', label: 'les retenues' }])).toBe('la retenue déposée le 11/11/2099 · la CNSS au trimestre');
    expect(declarer([{ id: 'dm-2099-10', filedAt: '2099-11-11', paidDate: '2099-11-12', amount: 93.496 }])).toBe('la retenue payée le 12/11/2099 · la CNSS au trimestre');
    expect(declarer([{ id: 'dm-2099-09', filedAt: '2099-10-20', paidDate: '2099-10-20', amount: 80 }])).toBe('la retenue avec la déclaration d’octobre · la CNSS au trimestre');
  });
});

describe('(1.355.7) l’étape « Déclarer » est faite quand ce qui se déclare à ce jour l’est', () => {
  const e = { id: 'e1', name: 'Hédi Trabelsi', grossSalary: 1250, hireDate: '2019-03-01', contract: 'cdi', headOfFamily: false, children: 0, active: true,
    method: 'especes', iban: '', cnss: '', position: 'Boulanger' };
  // Octobre payé et remis ; ce qui change d'un cas à l'autre : les déclarations notées, le dépôt du cabinet, l'année.
  const declarer = (y: number, socialFilings: unknown[], o: { depot?: unknown; sansImpot?: boolean } = {}) => {
    const d = { company: { currency: 'TND', name: 'Boulangerie' }, settings: {}, employees: [e], payslips: [] as unknown[], socialFilings, timesheets: [], leaves: [], advances: [] };
    const i = { gross: 1250, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
    const calc = core.computePayslip(e, i, core.payrollSettings(d));
    d.payslips.push({ id: 'b10', employeeId: 'e1', year: y, month: 10, ...i, paidDate: `${y}-10-31`, remisLe: `${y}-10-31`,
      computed: o.sansImpot ? { ...calc, irpp: 0, css: 0, tfp: 0, foprolos: 0 } : calc });
    return core.paieDuMois(d, y, 10, { depot: o.depot }).etapes.find((x) => x.titre === 'Déclarer') as Etape;
  };
  const dm = (y: number) => ({ id: `dm-${y}-10`, filedAt: `${y}-11-20`, paidDate: `${y}-11-20`, amount: 90 });

  it('le trimestre court encore : la retenue du mois déclarée suffit, sans elle l’étape attend', () => {
    expect(declarer(2099, [dm(2099)])).toMatchObject({ fait: true, dit: 'la retenue payée le 20/11/2099 · la CNSS au trimestre' });
    expect(declarer(2099, []).fait).toBe(false);
  });

  it('le trimestre fini : la CNSS se dépose avec sa date, et la CNSS déposée seule ne fait pas la retenue du mois', () => {
    expect(declarer(2020, [dm(2020)])).toMatchObject({ fait: false, dit: 'la retenue payée le 20/11/2020 · la CNSS du 4e trimestre avant le 15/01/2021' });
    expect(declarer(2020, [dm(2020), { id: 'cnss-2020-T4', filedAt: '2021-01-10' }])).toMatchObject({ fait: true, dit: 'la retenue payée le 20/11/2020 · CNSS du 4e trimestre déposée' });
    expect(declarer(2020, [{ id: 'cnss-2020-T4', filedAt: '2021-01-10' }]).fait).toBe(false);
  });

  it('déposée par le cabinet, pas encore versée : l’étape le dit et attend ; un mois qui ne retient rien n’a rien à déclarer', () => {
    expect(declarer(2099, [], { depot: { le: '2099-11-20' } })).toMatchObject({ fait: false, dit: 'la retenue déposée le 20/11/2099 par ton cabinet, à verser · la CNSS au trimestre' });
    expect(declarer(2099, [], { sansImpot: true }).fait).toBe(true);
  });
});
