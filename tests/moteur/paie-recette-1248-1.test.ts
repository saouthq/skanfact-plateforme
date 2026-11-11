// 1.248.1 — la suite de la recette à la souris de la paie (02/11/2026) : les règles qu'elle a corrigées.
//   - le même n° CNSS ou le même RIB (virement) que l'un de ses collègues : le second est « à traiter », avec ce qui se
//     passerait ; la liste des salariés le montrait en double, et sa pastille ne le comptait pas ;
//   - octobre payé, novembre établi mais pas payé : le mois de paie est novembre (la page restait sur octobre) ;
//   - l'avenant d'un passage en CDI dit le CDI, à compter du lendemain de l'ancienne fin, pas « à compter d'aujourd'hui ».
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { lireEcran } from '../../commun/assemblage.ts';

type ATraiter = { salarie: string; vue: string; focus: string; titre: string; dit: string; geste: string };
type Core = {
  paieATraiter: (d: unknown, t: string) => ATraiter[];
  controlesDuMois: (d: unknown, y: number, m: number) => { id: string; ok: boolean; dit: string }[];
  moisDePaie: (d: unknown, t: string) => { year: number; month: number };
  paieDuMois: (d: unknown, y: number, m: number) => { etapes: { titre: string; fait: boolean; dit: string }[] };
  payslipInputFor: (d: unknown, e: unknown, y: number, m: number) => Record<string, unknown>;
  computePayslip: (e: unknown, i: unknown, s: unknown) => { net: number; gross: number };
  payrollSettings: (d: unknown) => unknown;
  hrDocumentHtml: (k: string, e: unknown, d: unknown, c: unknown, o: Record<string, unknown>) => string;
};
const charger = (f: string, req: (n: string) => unknown) => {
  const m = { exports: {} as unknown };
  vm.runInNewContext(lireEcran(f), { module: m, exports: m.exports, require: req, console });
  return m.exports;
};
const compta = charger('v10/compta.js', () => { throw new Error('compta.js ne charge rien'); });
const core = charger('v10/core.js', () => compta) as Core;

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

  it('(1.355.0) octobre établi et pas encore payé : la page s\'ouvre sur octobre, même si novembre n\'a pas encore son bulletin', () => {
    const d = donnees([sal('a')]);
    etablir(d, 2026, 10, '');
    expect(core.moisDePaie(d, '2026-11-11')).toEqual({ year: 2026, month: 10 });
    // Payé, octobre ne retient plus la page : le bulletin qui manque est celui de novembre.
    d.payslips.forEach((p) => { p.paidDate = '2026-11-05'; });
    expect(core.moisDePaie(d, '2026-11-11')).toEqual({ year: 2026, month: 11 });
  });

  it('(1.355.4) un seul salaire payé : « payé le », jamais « payés le » ; deux : « payés le »', () => {
    const payer = (d: ReturnType<typeof donnees>) => core.paieDuMois(d, 2026, 10).etapes.find((e) => e.titre === 'Payer')?.dit;
    const un = donnees([sal('a')]);
    etablir(un, 2026, 10, '2026-11-11');
    expect(payer(un)).toBe('payé le 11/11/2026');
    const deux = donnees([sal('a'), sal('b')]);
    etablir(deux, 2026, 10, '2026-11-11');
    expect(payer(deux)).toBe('payés le 11/11/2026');
  });

  it('(1.355.5) un seul salarié sans bulletin : « 0 sur 1 établi » ; deux : « 0 sur 2 établis »', () => {
    const bulletins = (d: ReturnType<typeof donnees>) => core.paieDuMois(d, 2026, 10).etapes.find((e) => e.titre === 'Bulletins')?.dit;
    expect(bulletins(donnees([sal('a')]))).toBe('0 sur 1 établi');
    expect(bulletins(donnees([sal('a'), sal('b')]))).toBe('0 sur 2 établis');
  });

  it('(1.355.0) un pointage validé est un mois pointé, pas « sauté » ; rouvert, il ne l\'est plus', () => {
    const d = donnees([sal('a')]) as ReturnType<typeof donnees> & { pointageVersions?: unknown[]; pointageOuverts?: string[] };
    etablir(d, 2026, 10, '');
    expect(core.paieDuMois(d, 2026, 10).etapes[0]?.dit).toBe('sauté : chacun payé au mois complet');
    d.pointageVersions = [{ ym: '2026-10', version: 1 }];
    expect(core.paieDuMois(d, 2026, 10).etapes[0]?.dit).toBe('le mois est pointé');
    d.pointageOuverts = ['2026-10'];
    expect(core.paieDuMois(d, 2026, 10).etapes[0]?.dit).toBe('sauté : chacun payé au mois complet');
  });

  it('(1.355.2) une entreprise qui emploie sans son n° CNSS employeur : « À ne pas oublier » le réclame, avec le geste vers sa fiche', () => {
    const d = donnees([sal('a', { iban: RIB, cnss: '12345678-12' })]) as ReturnType<typeof donnees> & { company: Record<string, unknown> };
    const soc = () => core.paieATraiter(d, '2026-11-02').filter((x) => (x as unknown as { societe?: string }).societe);
    expect(soc().map((x) => [(x as unknown as { societe: string }).societe, x.vue, x.titre, x.geste])).toEqual([['cnss', 'societe', 'N° CNSS employeur manquant', 'Renseigner']]);
    expect(soc()[0]?.dit).toBe('sur la fiche de l\'entreprise : chaque bulletin et la déclaration du trimestre le portent');
    d.company.cnss = '  ';
    expect(soc()).toHaveLength(1);
    d.company.cnss = '123456-78';
    expect(soc()).toHaveLength(0);
    d.company.cnss = '';
    (d.employees[0] as Record<string, unknown>).endDate = '2026-10-31';
    expect(soc()).toHaveLength(0);
  });

  it('(1.355.2) les contrôles du mois disent le n° CNSS de l\'employeur, comme ils disent celui de chaque salarié', () => {
    const d = donnees([sal('a', { iban: RIB, cnss: '12345678-12' })]) as ReturnType<typeof donnees> & { company: Record<string, unknown> };
    etablir(d, 2026, 10, '');
    const ctl = () => core.controlesDuMois(d, 2026, 10).find((c) => c.id === 'cnss-employeur');
    expect(ctl()).toMatchObject({ ok: false, dit: 'à renseigner sur la fiche de l\'entreprise : chaque bulletin et la déclaration du trimestre le portent' });
    d.company.cnss = '123456-78';
    expect(ctl()).toMatchObject({ ok: true, dit: '' });
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
