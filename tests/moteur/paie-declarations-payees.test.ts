// La CNSS et les retenues sur salaires PAYÉES (1.228.0 ; docs/revue-paie.md, M1 ; docs/paie.md, « Revue R1 »).
// Avant : « Marquer déposée » ne gardait qu'une date. La trésorerie ne voyait jamais partir la CNSS ni la retenue, et le
// grand livre gardait pour toujours les dettes que chaque bulletin crée (4531 CNSS, 4321 IRPP, 4335 TFP et FOPROLOS).
// Ce que ce fichier tient (deux chemins, un chiffre) :
//   - une déclaration payée est une sortie de trésorerie, du montant de la déclaration ;
//   - le trimestre CNSS payé et les trois mois de retenues payés ramènent ces trois dettes à zéro, au millime ;
//   - la banque du grand livre bouge exactement comme la trésorerie de la banque ;
//   - une déclaration déposée sans paiement (l'ancien format) ne fait rien sortir.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Ligne = { account: string; debit: number; credit: number; source?: string };
type Mouvement = { id: string; amount: number; accountId: string; source: string; socialId?: string };
type Social = { montant: number; parts: Record<string, number> };
const compta = ecranDeLaPlateforme('compta.js') as {
  computePayslip: (e: unknown, i: unknown, s: unknown) => Record<string, number>; baremesPaie: (r: unknown) => unknown;
};
const core = ecranDeLaPlateforme('core.js') as {
  journalEntries: (d: unknown, c: unknown, p: object, o: object) => Ligne[];
  cashMovements: (d: unknown, c: unknown, p: object, a: string | null) => Mouvement[];
  montantSocial: (d: unknown, id: string) => Social | null;
  DEFAULT_ACCOUNTS: Record<string, string>;
};
const A = core.DEFAULT_ACCOUNTS;
const millimes = (n: number) => Math.round(n * 1000);
const solde = (L: Ligne[], compte: string) => L.filter((l) => l.account === compte).reduce((s, l) => s + millimes(l.credit) - millimes(l.debit), 0);

function dossier() {
  const company = { currency: 'TND', stampFee: 1, name: 'Boulangerie' };
  // Des salaires qui ne tombent pas rond : un arrondi faux se verrait.
  const employees = [
    { id: 'e1', name: 'Mourad', grossSalary: 1453.27, hireDate: '2024-01-02', contract: 'cdi', headOfFamily: true, children: 2, active: true, method: 'virement', iban: '08100123456789012359', cnss: '1' },
    { id: 'e2', name: 'Nadia', grossSalary: 887.61, hireDate: '2024-01-02', contract: 'cdi', headOfFamily: false, children: 0, active: true, method: 'virement', iban: '08100123456789012359', cnss: '2' },
  ];
  const payslips = [7, 8, 9].flatMap((m) => employees.map((e) => {
    const saisie = { gross: e.grossSalary, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
    return { id: `p-${e.id}-${m}`, employeeId: e.id, year: 2026, month: m, ...saisie, computed: compta.computePayslip(e, saisie, compta.baremesPaie({})),
      paidDate: `2026-${String(m).padStart(2, '0')}-28`, accountId: 'b', method: 'virement' };
  }));
  const data = { company, accounts: [{ id: 'b', name: 'Banque', kind: 'banque', isDefault: true }], employees, payslips, socialFilings: [] as Record<string, unknown>[],
    documents: [], purchases: [], movements: [], advances: [], payrollSettings: {} };
  return data;
}
const payer = (data: ReturnType<typeof dossier>, id: string, jour: string) => {
  const m = core.montantSocial(data, id);
  if (!m) throw new Error(`pas de montant pour ${id}`);
  data.socialFilings.push({ id, filedAt: jour, label: id, paidDate: jour, amount: m.montant, parts: m.parts, accountId: 'b', method: 'virement' });
  return m.montant;
};

describe('la CNSS et les retenues sur salaires payées', () => {
  it('sortent de la trésorerie et soldent leurs dettes, au millime, comme la banque du grand livre', () => {
    const data = dossier();
    const avant = core.journalEntries(data, data.company, {}, { sections: ['paie'] });
    expect(solde(avant, A.cnss ?? '')).toBeGreaterThan(0);
    expect(solde(avant, A.irpp ?? '')).toBeGreaterThan(0);
    expect(solde(avant, A.tfpFoprolos ?? '')).toBeGreaterThan(0);

    const montants = [payer(data, 'cnss-2026-T3', '2026-10-14'), payer(data, 'dm-2026-07', '2026-08-27'), payer(data, 'dm-2026-08', '2026-09-26'), payer(data, 'dm-2026-09', '2026-10-27')];
    const tres = core.cashMovements(data, data.company, {}, null).filter((m) => m.source === 'social');
    expect(tres.map((m) => [m.socialId, millimes(m.amount)])).toEqual(expect.arrayContaining(
      ['cnss-2026-T3', 'dm-2026-07', 'dm-2026-08', 'dm-2026-09'].map((id, i) => [id, -millimes(montants[i] ?? 0)])));
    expect(tres).toHaveLength(4);

    const L = core.journalEntries(data, data.company, {}, { sections: ['paie'] });
    expect(solde(L, A.cnss ?? '')).toBe(0);
    expect(solde(L, A.irpp ?? '')).toBe(0);
    expect(solde(L, A.tfpFoprolos ?? '')).toBe(0);
    // La banque : ce que le grand livre crédite est ce que la trésorerie fait sortir (salaires et déclarations).
    const sorties = core.cashMovements(data, data.company, {}, 'b').reduce((s, m) => s + millimes(m.amount), 0);
    expect(-solde(L, A.banque ?? '')).toBe(sorties);
  });

  it('une déclaration déposée sans paiement (l\'ancien format) ne fait rien sortir', () => {
    const data = dossier();
    data.socialFilings.push({ id: 'cnss-2026-T3', filedAt: '2026-10-14', label: 'CNSS' });
    expect(core.cashMovements(data, data.company, {}, null).filter((m) => m.source === 'social')).toHaveLength(0);
    expect(solde(core.journalEntries(data, data.company, {}, { sections: ['paie'] }), A.cnss ?? '')).toBeGreaterThan(0);
  });
});
