// Corriger la paie sans réécrire (1.229.0 à 1.232.0 ; docs/revue-paie.md, lots R2 à R5 ; docs/paie.md, « Revue R2 » et suivantes).
// Ce que ce fichier tient, chaque fois par les DEUX chemins (la saisie d'un bulletin de l'entreprise, `payslipInputFor`, et
// celle du Cabinet, `saisieDuMois`) :
//   - un salaire qui change à une date : le bulletin d'un mois d'avant garde l'ancien brut, celui d'après prend le nouveau ;
//   - une régularisation portée sur un mois entre sur le bulletin de ce mois-là (et de lui seul), imposable ou non ;
//   - une saisie sur salaire se retient chaque mois jusqu'à son total, jamais au-delà ; versée au créancier, elle sort de la
//     trésorerie et le grand livre bouge comme elle (deux chemins, un chiffre) ;
//   - les salariés s'importent d'un tableur : titres reconnus, dates lues jour/mois/année, refus et doublons dits ;
//   - l'accueil annonce ce que la paie attend (correction, bon à payer, demande de congé) ; « À traiter » rappelle le
//     certificat d'un arrêt maladie et ce qu'une saisie doit au créancier.
// Les montants ne tombent pas rond : un arrondi faux se verrait.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Prime = { label: string; amount: number; taxable?: boolean; regulId?: string };
type Retenue = { label: string; amount: number; saisieId?: string; advanceId?: string };
type Saisie = { gross: number; bonuses: Prime[]; deductions: Retenue[] };
type Ligne = { account: string; debit: number; credit: number; source?: string };
type Mouvement = { id: string; amount: number; accountId: string; source: string; saisieId?: string };
type Plan = { nouveaux: number; refus: number; doublons: number; completes: number; colonnes: string[]; lignes: { statut: string; motifs: string[]; avert: string[]; objet: Record<string, unknown> }[] };
type Moteur = {
  saisieDuMois: (d: unknown, e: unknown, y: number, m: number) => Saisie;
  payslipInputFor: (d: unknown, e: unknown, y: number, m: number) => Saisie;
  brutDuMois: (e: unknown, y: number, m: number) => number;
  saisiesOf: (d: unknown, e: unknown) => { id: string; retenu: number; verse: number; reste: number; aVerser: number; done: boolean }[];
  computePayslip: (e: unknown, i: unknown, s: unknown) => { gross: number; net: number; cnssEmployee: number; employerCost: number };
  baremesPaie: (r: unknown) => unknown;
  payrollSettings: (d: unknown) => unknown;
  cashMovements: (d: unknown, c: unknown, p: object, a: string | null) => Mouvement[];
  journalEntries: (d: unknown, c: unknown, p: object, o: object) => Ligne[];
  planImport: (type: string, texte: string, d: unknown, c: unknown, o: object) => Plan;
  appliquerImport: (d: unknown, p: Plan, c: unknown, o: object) => { crees: string[] };
  todoList: (d: unknown, c: unknown, t: string | null, o?: object) => { id: string; count: number; mois?: string }[];
  paieATraiter: (d: unknown, t: string) => { titre: string; conge?: string; demande?: boolean; saisie?: string }[];
  DEFAULT_ACCOUNTS: Record<string, string>;
};
const compta = ecranDeLaPlateforme('compta.js') as Moteur;
const core = ecranDeLaPlateforme('core.js') as Moteur;
const millimes = (n: number) => Math.round(n * 1000);

function salarie(extra: Record<string, unknown> = {}) {
  return { id: 'e1', name: 'Mourad Ben Ali', grossSalary: 1611.437, hireDate: '2024-01-02', contract: 'cdi', headOfFamily: true, children: 1, active: true, method: 'virement', iban: '08100123456789012359', cnss: '1', ...extra };
}
function dossier(e = salarie()) {
  return { company: { currency: 'TND', name: 'Boulangerie' }, accounts: [{ id: 'b', name: 'Banque', kind: 'banque', isDefault: true }], employees: [e],
    payslips: [] as Record<string, unknown>[], leaves: [] as Record<string, unknown>[], advances: [], timesheets: [], socialFilings: [], documents: [], purchases: [], movements: [], payrollSettings: {} };
}
// Les deux chemins disent la même saisie (le brut, les primes, les retenues).
const lesDeux = (d: unknown, e: unknown, y: number, m: number) => {
  const a = core.payslipInputFor(d, e, y, m), b = compta.saisieDuMois(d, e, y, m);
  expect([a.gross, a.bonuses, a.deductions]).toEqual([b.gross, b.bonuses, b.deductions]);
  return a;
};

describe('un salaire qui change à une date', () => {
  it('le mois d\'avant garde l\'ancien brut, le mois d\'après prend le nouveau, par les deux chemins', () => {
    const e = salarie({ grossSalary: 1777.215, salaires: [{ des: '2026-07', brut: 1777.215, avant: 1611.437 }] });
    const d = dossier(e);
    expect(core.brutDuMois(e, 2026, 6)).toBe(1611.437);
    expect(core.brutDuMois(e, 2026, 7)).toBe(1777.215);
    expect(lesDeux(d, e, 2026, 6).gross).toBe(1611.437);
    expect(lesDeux(d, e, 2026, 9).gross).toBe(1777.215);
    // Sans historique : le brut de la fiche, comme avant.
    expect(core.brutDuMois(salarie(), 2020, 1)).toBe(1611.437);
  });
});

describe('une régularisation portée sur un mois', () => {
  it('entre sur le bulletin de son mois, et de lui seul ; imposable, elle entre dans l\'assiette', () => {
    const e = salarie({ regularisations: [
      { id: 'r1', pourMois: '2026-08', label: 'Régularisation juillet 2026', amount: 87.345, taxable: true },
      { id: 'r2', pourMois: '2026-08', label: 'Trop-perçu', amount: -12.5, taxable: false }] });
    const d = dossier(e);
    const aout = lesDeux(d, e, 2026, 8);
    expect(aout.bonuses.filter((b) => b.regulId).map((b) => [b.regulId, b.amount, b.taxable])).toEqual([['r1', 87.345, true], ['r2', -12.5, false]]);
    expect(lesDeux(d, e, 2026, 9).bonuses.some((b) => b.regulId)).toBe(false);
    const st = core.payrollSettings(d);
    const sans = core.computePayslip(e, { ...aout, bonuses: [] }, st), avec = core.computePayslip(e, aout, st);
    expect(millimes(avec.gross - sans.gross)).toBe(millimes(87.345 - 12.5));
    expect(millimes(avec.cnssEmployee)).toBeGreaterThan(millimes(sans.cnssEmployee));
  });
});

describe('une saisie sur salaire', () => {
  it('se retient chaque mois jusqu\'à son total, jamais au-delà, par les deux chemins', () => {
    const e = salarie({ saisies: [{ id: 'z1', creancier: 'Tribunal de Sfax', total: 500.75, monthly: 200.3, debut: '2026-07', versements: [] }] });
    const d = dossier(e);
    expect(lesDeux(d, e, 2026, 6).deductions).toEqual([]);
    const juillet = lesDeux(d, e, 2026, 7).deductions;
    expect(juillet).toEqual([{ label: 'Saisie sur salaire — Tribunal de Sfax', amount: 200.3, saisieId: 'z1' }]);
    d.payslips.push({ id: 'p7', employeeId: 'e1', year: 2026, month: 7, deductions: juillet }, { id: 'p8', employeeId: 'e1', year: 2026, month: 8, deductions: juillet });
    // Ce qui reste (100,15) est la dernière retenue ; ensuite, plus rien.
    expect(lesDeux(d, e, 2026, 9).deductions.map((x) => x.amount)).toEqual([100.15]);
    d.payslips.push({ id: 'p9', employeeId: 'e1', year: 2026, month: 9, deductions: [{ label: 'x', amount: 100.15, saisieId: 'z1' }] });
    expect(lesDeux(d, e, 2026, 10).deductions).toEqual([]);
    const [s] = core.saisiesOf(d, e);
    expect([s?.retenu, s?.reste, s?.aVerser, s?.done]).toEqual([500.75, 0, 500.75, true]);
  });

  it('versée au créancier, elle sort de la trésorerie, et la banque du grand livre bouge comme elle', () => {
    const e = salarie({ saisies: [{ id: 'z1', creancier: 'Tribunal de Sfax', total: 500.75, monthly: 200.3, debut: '2026-07', versements: [] }] });
    const d = dossier(e);
    const st = compta.baremesPaie({});
    for (const m of [7, 8]) {
      const i = core.payslipInputFor(d, e, 2026, m);
      d.payslips.push({ id: `p${m}`, employeeId: 'e1', year: 2026, month: m, ...i, computed: compta.computePayslip(e, i, st), paidDate: `2026-0${m}-28`, accountId: 'b', method: 'virement' });
    }
    ((e as unknown as { saisies: { versements: unknown[] }[] }).saisies[0] as { versements: unknown[] }).versements.push({ id: 'v1', date: '2026-09-05', amount: 400.6, accountId: 'b', method: 'virement' });
    expect(core.saisiesOf(d, e)[0]?.aVerser).toBe(0);
    const t = core.cashMovements(d, d.company, {}, 'b');
    expect(t.filter((m) => m.source === 'saisie').map((m) => [m.id, millimes(m.amount)])).toEqual([['sai-z1-v1', -400600]]);
    const L = core.journalEntries(d, d.company, {}, { sections: ['paie'] });
    const solde = (c: string) => L.filter((l) => l.account === c).reduce((x, l) => x + millimes(l.credit) - millimes(l.debit), 0);
    // Le 425 revient à zéro : le bulletin l'a crédité du net et de la retenue, le salaire payé et le versement l'en retirent.
    expect(solde(core.DEFAULT_ACCOUNTS.personnel ?? '')).toBe(0);
    expect(-solde(core.DEFAULT_ACCOUNTS.banque ?? '')).toBe(t.reduce((x, m) => x + millimes(m.amount), 0));
  });
});

describe('les salariés par tableur', () => {
  const texte = [
    'Nom et prénom\tCIN\tMatricule CNSS\tPoste\tContrat\tDate d\'embauche\tSalaire de base\tRIB\tEnfants\tChef de famille',
    'Mourad Ben Ali\t01234567\t1234567-89\tBoulanger\tCDI\t02/01/2024\t1 453,270\t08100123456789012359\t2\toui',
    'Nadia Trabelsi\t07654321\t\tVendeuse\tCDD\t2025-03-15\t887,61\t\t0\tnon',
    'Sans date\t\t\t\t\t\t900\t\t\t',
    'Mourad B. Ali\t01234567\t\t\t\t02/01/2024\t1000\t\t\t',
    'Date fausse\t\t\t\t\t31/02/2024\t900\t\t\t',
  ].join('\n');

  it('lit les titres, les dates jour/mois/année et les montants ; refuse et dit pourquoi ; ne double pas un CIN', () => {
    const p = core.planImport('salaries', texte, { employees: [] }, {}, {});
    expect(p.colonnes).toEqual(['name', 'cin', 'cnss', 'position', 'contract', 'hireDate', 'grossSalary', 'iban', 'children', 'headOfFamily']);
    expect([p.nouveaux, p.refus, p.doublons]).toEqual([2, 2, 1]);
    const [m, n] = p.lignes;
    expect([m?.objet.hireDate, m?.objet.grossSalary, m?.objet.children, m?.objet.headOfFamily, m?.objet.contract]).toEqual(['2024-01-02', 1453.27, 2, true, 'cdi']);
    expect([n?.objet.hireDate, n?.objet.contract, n?.objet.headOfFamily]).toEqual(['2025-03-15', 'cdd', false]);
    expect(p.lignes[2]?.motifs[0]).toMatch(/date d'embauche manque/);
    expect(p.lignes[4]?.motifs[0]).toMatch(/n'est pas une date/);
    const d = { employees: [] as Record<string, unknown>[] };
    expect(core.appliquerImport(d, p, {}, {}).crees).toHaveLength(2);
    expect(d.employees.map((x) => [x.name, x.grossSalary, x.hireDate])).toEqual([['Mourad Ben Ali', 1453.27, '2024-01-02'], ['Nadia Trabelsi', 887.61, '2025-03-15']]);
    // Collée une seconde fois, la liste ne crée rien : ce qui est déjà là est reconnu.
    expect(core.planImport('salaries', texte, d, {}, {}).nouveaux).toBe(0);
  });
});

describe('ce que la paie attend, à l\'accueil et dans « À traiter »', () => {
  it('une correction proposée, des bulletins à approuver, une demande de congé, un certificat, une saisie à verser', () => {
    const e = salarie({ saisies: [{ id: 'z1', creancier: 'Tribunal de Sfax', total: 300, monthly: 150, versements: [] }] });
    const d = dossier(e);
    d.company = { ...d.company, paieMode: 'tenue' } as typeof d.company;
    d.payslips.push(
      { id: 'p9', employeeId: 'e1', year: 2026, month: 9, deductions: [{ label: 'x', amount: 150, saisieId: 'z1' }], correction: { par: 'Sarra', titre: 'prime oubliée' } },
      { id: 'p10', employeeId: 'e1', year: 2026, month: 10, deductions: [] });
    d.leaves.push({ id: 'l1', employeeId: 'e1', kind: 'conges', from: '2026-12-01', to: '2026-12-05', statut: 'demande' },
      { id: 'l2', employeeId: 'e1', kind: 'maladie', from: '2026-10-20', to: '2026-10-22' });
    const todo = core.todoList(d, d.company, '2026-11-01');
    const vu = (id: string) => todo.find((x) => x.id === id);
    expect([vu('paie-correction')?.count, vu('paie-correction')?.mois]).toEqual([1, '2026-09']);
    // Le bulletin qui attend une correction ne s'approuve pas avant elle : un seul à approuver.
    expect([vu('paie-bon-a-payer')?.count, vu('paie-bon-a-payer')?.mois]).toEqual([1, '2026-10']);
    expect(vu('conges-demandes')?.count).toBe(1);
    const t = core.paieATraiter(d, '2026-11-01');
    // Le certificat de l'arrêt (l2) ; la demande de congé (l1) s'y lit aussi depuis la 1.234.0, à accepter ou refuser.
    expect(t.filter((x) => x.conge && !x.demande).map((x) => x.conge)).toEqual(['l2']);
    expect(t.filter((x) => x.conge && x.demande).map((x) => x.conge)).toEqual(['l1']);
    expect(t.filter((x) => x.saisie).map((x) => x.titre)).toEqual([expect.stringMatching(/150,000.*à verser à Tribunal de Sfax/)]);
    // Le certificat noté, le rappel s'éteint.
    (d.leaves[1] as Record<string, unknown>).certificatLe = '2026-10-21';
    expect(core.paieATraiter(d, '2026-11-01').some((x) => x.conge && !x.demande)).toBe(false);
    // Sans cabinet qui tient la paie, aucun bon à payer n'est attendu.
    d.company = { ...d.company, paieMode: 'sans' } as typeof d.company;
    expect(core.todoList(d, d.company, '2026-11-01').some((x) => x.id === 'paie-bon-a-payer')).toBe(false);
  });
});
