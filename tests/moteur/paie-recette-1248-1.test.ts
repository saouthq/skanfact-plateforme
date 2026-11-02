// 1.248.1 — la suite de la recette à la souris de la paie (02/11/2026) : les règles qu'elle a corrigées.
//   - le même n° CNSS ou le même RIB (virement) que l'un de ses collègues : le second est « à traiter », avec ce qui se
//     passerait ; la liste des salariés le montrait en double, et sa pastille ne le comptait pas ;
//   - octobre payé, novembre établi mais pas payé : le mois de paie est novembre (la page restait sur octobre) ;
//   - l'avenant d'un passage en CDI dit le CDI, à compter du lendemain de l'ancienne fin, pas « à compter d'aujourd'hui ».
import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type ATraiter = { salarie: string; vue: string; focus: string; titre: string; dit: string; geste: string };
type Core = {
  paieATraiter: (d: unknown, t: string) => ATraiter[];
  moisDePaie: (d: unknown, t: string) => { year: number; month: number };
  payslipInputFor: (d: unknown, e: unknown, y: number, m: number) => Record<string, unknown>;
  computePayslip: (e: unknown, i: unknown, s: unknown) => { net: number; gross: number };
  payrollSettings: (d: unknown) => unknown;
  hrDocumentHtml: (k: string, e: unknown, d: unknown, c: unknown, o: Record<string, unknown>) => string;
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
const donnees = (employees: Record<string, unknown>[]) => ({ company: { currency: 'TND', name: 'Boulangerie' }, settings: {}, employees, payslips: [] as Record<string, unknown>[], timesheets: [], leaves: [], advances: [] });
const etablir = (d: ReturnType<typeof donnees>, y: number, m: number, paye: string) => (d.employees as { id: string }[]).forEach((e) => {
  const i = core.payslipInputFor(d, e, y, m);
  d.payslips.push({ id: `${e.id}-${m}`, employeeId: e.id, year: y, month: m, ...i, computed: core.computePayslip(e, i, core.payrollSettings(d)), paidDate: paye });
});

describe('la paie après la recette du 02/11/2026, suite', () => {
  it('le même n° CNSS (avec ou sans tiret) ou le même RIB qu\'un collègue : le second est à traiter ; les espèces ne comptent pas', () => {
    const d = donnees([sal('a', { iban: RIB, cnss: '12345678-12' }), sal('b', { iban: RIB, cnss: '1234567812' }),
      sal('c', { iban: RIB, method: 'especes', cnss: '87654321-00' }), sal('e', { iban: '08100123456789012456', cnss: '11111111-11' })]);
    const L = core.paieATraiter(d, '2026-11-02').filter((x) => x.vue === 'salaries');
    expect(L.map((x) => [x.salarie, x.focus, x.titre])).toEqual([
      ['b', 'cnss', 'Salarié b : le même n° CNSS que Salarié a'],
      ['b', 'iban', 'Salarié b : le même RIB que Salarié a'],
    ]);
    expect(L[0]).toMatchObject({ geste: 'Corriger', dit: 'la déclaration du trimestre mettrait leurs deux salaires sur un seul assuré' });
  });

  it('octobre payé, novembre établi mais pas payé : le mois de paie est novembre ; tout payé, il reste octobre', () => {
    const d = donnees([sal('a'), sal('b')]);
    etablir(d, 2026, 10, '2026-11-02');
    etablir(d, 2026, 11, '');
    expect(core.moisDePaie(d, '2026-11-05')).toEqual({ year: 2026, month: 11 });
    d.payslips.filter((p) => p.month === 11).forEach((p) => { p.paidDate = '2026-11-30'; });
    expect(core.moisDePaie(d, '2026-11-30')).toEqual({ year: 2026, month: 10 });
  });

  it('l\'avenant d\'un passage en CDI le dit, à compter du lendemain de l\'ancienne fin ; un mois plus tard, il redevient général', () => {
    const e = sal('k', { contract: 'cdi', endDate: '', renouvellements: [{ le: '2026-11-02', ancienneFin: '2027-11-20', cdi: true }] });
    const d = donnees([e]);
    const doc = (date: string) => core.hrDocumentHtml('avenant', e, d, d.company, { date }).replace(/<[^>]+>/g, '');
    expect(doc('2026-11-02')).toContain('À compter du 21/11/2027, Salarié k occupe le poste de Boulanger');
    expect(doc('2026-11-02')).toContain('se poursuit à compter du 21/11/2027 en contrat à durée indéterminée');
    expect(doc('2027-01-15')).toContain('À compter du 15/01/2027');
    expect(doc('2027-01-15')).not.toContain('durée indéterminée');
  });

  it('l\'avenant d\'un CDD prolongé dit l\'ancienne fin et la nouvelle', () => {
    const e = sal('k', { contract: 'cdd', endDate: '2028-11-20', renouvellements: [{ le: '2026-11-02', ancienneFin: '2027-11-20', nouvelleFin: '2028-11-20' }] });
    const d = donnees([e]);
    const t = core.hrDocumentHtml('avenant', e, d, d.company, { date: '2026-11-02' }).replace(/<[^>]+>/g, '');
    expect(t).toContain('Le contrat à durée déterminée, qui prenait fin le 20/11/2027, est prolongé jusqu\'au 20/11/2028.');
    expect(t).toContain('Article 3. Les autres clauses du contrat restent inchangées.');
  });
});
