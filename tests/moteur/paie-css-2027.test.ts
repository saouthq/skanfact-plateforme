// 1.266.3 — les barèmes de la paie n'étaient pas datés (cadrage 16 § 10.1, point 1 ; § 3.7) : la contribution sociale de
// solidarité de 0,5 % ne vaut que pour 2026 (loi de finances 2026 art. 87 ; Rapporté, À VÉRIFIER avec un comptable), et
// un bulletin de janvier 2027 la retenait encore. Sa règle porte maintenant sa date de fin : après elle, sans règle
// suivante posée, le bulletin n'en retient aucune et le dit ; le contrôle du mois dit « Barèmes de 2027 pas encore relus ».
// Le serveur lit la même règle (tests/v10/paie.test.ts).
//
// Les montants discriminent : Sonia, 1 234,567 de brut, chef de famille, deux enfants, une prime imposable de 150,555
// (le bulletin calculé à la main dans tests/v10/paie.test.ts) : CSS 5,421 et net 1 120,386 en décembre 2026 ; en
// janvier 2027, CSS 0 et net 1 125,807, l'impôt (125,235) et le coût (1 668,655) inchangés.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, unknown>;
type Calcul = Record<string, number> & { cssFinie?: string; rates: Record<string, number>; bareme: Record<string, number> };
const compta = ecranDeLaPlateforme('compta.js') as {
  computePayslip: (e: Obj, i: Obj, s: Obj) => Calcul;
  baremesPaie: (r: Obj) => Obj;
  cssPoseePour: (a: unknown, m: unknown) => boolean;
  baremesNonRelus: (a: unknown, m: unknown) => { annee: number; relusJusquAu: string } | null;
  livreVide: (dossier: string, annee: number) => Obj & { salaries: Obj[]; bulletins: Obj[] };
  ajouterBulletin: (livre: unknown, b: unknown, baremes: Obj, qui: string, quand: number) => { ok: boolean; motif?: string; bulletin: { calcul: Calcul } };
};
const core = ecranDeLaPlateforme('core.js') as {
  payslipHtml: (slip: Obj, data: Obj, company: Obj) => string;
  payslipInputFor: (d: Obj, e: Obj, y: number, m: number) => Obj;
  controlesDuMois: (d: Obj, y: number, m: number) => { id: string; ok: boolean; titre?: string; dit?: string }[];
  DEFAULT_COMPANY: Obj;
};

const SONIA = { id: 's1', name: 'Sonia Trabelsi', grossSalary: 1234.567, headOfFamily: true, children: 2, contract: 'cdi', hireDate: '2025-03-01', active: true, cnss: '223344-55', method: 'virement' };
const SAISIE = { gross: 1234.567, workedDays: 26, absentDays: 0, bonuses: [{ label: 'Rendement', amount: 150.555, taxable: true }], deductions: [] };
const texte = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&nbsp;|[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ');

describe('la CSS s\'arrête avec sa règle', () => {
  it('la CSS de 2026 s\'arrête le 31/12/2026 : décembre la retient, janvier 2027 n\'en retient aucune, quel que soit son taux', () => {
    const decembre = compta.computePayslip(SONIA, { ...SAISIE, year: 2026, month: 12 }, compta.baremesPaie({}));
    expect([decembre.css, decembre.net, decembre.bareme.solidarity, decembre.cssFinie]).toEqual([5.421, 1120.386, 0.5, undefined]);
    const janvier = compta.computePayslip(SONIA, { ...SAISIE, year: 2027, month: 1 }, compta.baremesPaie({}));
    expect([janvier.css, janvier.net, janvier.irpp, janvier.employerCost]).toEqual([0, 1125.807, 125.235, 1668.655]);
    // Le barème figé et les taux du bulletin disent 0 : le serveur recalcule avec eux le même net.
    expect([janvier.bareme.solidarity, janvier.rates.solidarity, janvier.cssFinie]).toEqual([0, 0, '2026-12-31']);
    // Un taux réglé par l'entreprise, ou celui d'un régime de contrat : la règle s'arrête quand même.
    expect(compta.computePayslip(SONIA, { ...SAISIE, year: 2027, month: 3 }, compta.baremesPaie({ solidarity: 1 })).css).toBe(0);
    const saisonnier = compta.baremesPaie({ regimesContrat: { saisonnier: { solidarity: 0.5 } } });
    expect(compta.computePayslip({ ...SONIA, contract: 'saisonnier' }, { ...SAISIE, year: 2026, month: 6 }, saisonnier).css).toBe(5.421);
    expect(compta.computePayslip({ ...SONIA, contract: 'saisonnier' }, { ...SAISIE, year: 2027, month: 6 }, saisonnier).css).toBe(0);
    // Sans mois (une estimation de la fiche), rien ne se coupe ; un mois lu en texte se lit comme un nombre.
    expect(compta.computePayslip(SONIA, SAISIE, compta.baremesPaie({})).css).toBe(5.421);
    expect([compta.cssPoseePour('2027', '1'), compta.cssPoseePour(2026, 12), compta.cssPoseePour(null, null)]).toEqual([false, true, true]);
  });

  it('le bulletin imprimé dit pourquoi janvier 2027 n\'a pas de CSS ; décembre 2026 garde sa ligne à 5,421', () => {
    const data = { employees: [SONIA], payslips: [], payrollSettings: {} };
    const slip = (y: number, m: number) => ({ id: `b-${y}-${m}`, employeeId: 's1', year: y, month: m, ...SAISIE, computed: compta.computePayslip(SONIA, { ...SAISIE, year: y, month: m }, compta.baremesPaie({})), issuedAt: `${y}-${String(m).padStart(2, '0')}-28` });
    const janvier = texte(core.payslipHtml(slip(2027, 1), data, core.DEFAULT_COMPANY));
    expect(janvier).toContain('Contribution sociale de solidarité : non retenue, sa règle s\'arrête le 31/12/2026');
    const decembre = texte(core.payslipHtml(slip(2026, 12), data, core.DEFAULT_COMPANY));
    expect(decembre).toMatch(/Contribution sociale de solidarité [^:]*5,421/);
    expect(decembre).not.toContain('non retenue');
  });

  it('le contrôle du mois dit « Barèmes de 2027 pas encore relus », pas en décembre 2026', () => {
    expect(compta.baremesNonRelus(2026, 12)).toBeNull();
    expect(compta.baremesNonRelus(2027, 1)).toEqual({ annee: 2027, relusJusquAu: '2026-12-31' });
    const avec = (y: number, m: number) => {
      const d: Obj = { employees: [SONIA], payslips: [], payrollSettings: {}, timesheets: [], leaves: [], advances: [] };
      const input = { ...core.payslipInputFor(d, SONIA, y, m), year: y, month: m };
      (d.payslips as Obj[]).push({ id: `b-${y}-${m}`, employeeId: 's1', ...input, computed: compta.computePayslip(SONIA, input, compta.baremesPaie({})), paidDate: '' });
      return core.controlesDuMois(d, y, m).find((c) => c.id === 'taux');
    };
    const janvier = avec(2027, 1);
    expect(janvier?.ok).toBe(false);
    expect(JSON.stringify(janvier)).toContain('Barèmes de 2027 pas encore relus : aucune contribution sociale de solidarité retenue');
    expect(avec(2026, 12)?.ok).toBe(true);
  });

  it('au Cabinet, le bulletin de janvier 2027 d\'un dossier tenu n\'a pas de CSS ; celui de décembre 2026 la garde', () => {
    const calcul = (annee: number, mois: number) => {
      const l = compta.livreVide('cafe', annee);
      l.salaries = [{ id: 's1', nom: 'Sonia Trabelsi', brut: 1234.567, chefDeFamille: true, enfants: 2, contrat: 'cdi', embauche: '2025-03-01', actif: true }];
      l.bulletins = [];
      const r = compta.ajouterBulletin(l, { id: 'b1', salarieId: 's1', annee, mois, brut: 1234.567, joursTravailles: 26, joursAbsence: 0,
        primes: [{ label: 'Rendement', amount: 150.555, taxable: true }], retenues: [], prorata: null }, {}, 'cabinet', 1);
      expect(r.ok, r.motif).toBe(true);
      return r.bulletin.calcul;
    };
    expect([calcul(2027, 1).css, calcul(2027, 1).net]).toEqual([0, 1125.807]);
    expect([calcul(2026, 12).css, calcul(2026, 12).net]).toEqual([5.421, 1120.386]);
  });

  it('l\'exemple construit en 2027 : ses bulletins de 2027 sans CSS, ceux de 2026 avec', () => {
    const demo = ecranDeLaPlateforme('demo.js') as { buildDemoData: (c: Obj, jour: string) => { payslips: { year: number; computed: Calcul }[] } };
    const d = demo.buildDemoData({ ...core.DEFAULT_COMPANY }, '2027-03-28');
    const de = (y: number) => d.payslips.filter((p) => p.year === y);
    expect(de(2027).length).toBeGreaterThan(0);
    expect(de(2026).length).toBeGreaterThan(0);
    expect(de(2027).filter((p) => p.computed.css !== 0)).toEqual([]);
    expect(de(2026).filter((p) => Number(p.computed.annualTaxable) > 0).every((p) => Number(p.computed.css) > 0)).toBe(true);
  });
});
