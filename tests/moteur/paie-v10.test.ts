// Le banc de la paie (cadrage 08 § 1.2) : la v10 (`computePayslip`) et le nouveau moteur
// (`calculerBulletin`) calculent les mêmes bulletins, au millime, ligne par ligne. Le barème est
// celui de la v10 converti en entiers, fusionné avec le régime du contrat comme la v10 le fait.

import { describe, expect, it } from 'vitest';
import { mouvement } from '../../moteur/declarations.ts';
import { calculerBulletin, cnssDuTrimestre, ecritureDeBulletin, ecritureDePaiementSalaire, type BaremePaie, type Bulletin, type ComptesPaie } from '../../moteur/paie.ts';
import { demo, entier, exiger, hasard, v10, type Societe } from './v10.ts';

type ReglagesV10 = Record<string, unknown> & { brackets?: { upTo: number | null; rate: number }[]; regimesContrat?: Record<string, Record<string, unknown>> };
type SalarieV10 = { id?: string; contract?: string; grossSalary?: number; headOfFamily?: boolean; children?: number };
type SaisieV10 = { gross?: number; workedDays?: number; absentDays?: number; bonuses?: { amount: number; taxable?: boolean }[]; deductions?: { amount: number }[] };
type BulletinV10 = Record<string, number>;
const compta = exiger('../../banc/v10/compta.js') as {
  computePayslip: (e: SalarieV10, i: SaisieV10, s: ReglagesV10) => BulletinV10;
  regimeDuContrat: (s: ReglagesV10, contrat: string) => Record<string, number | boolean>;
  baremesPaie: (r: ReglagesV10) => ReglagesV10;
  DEFAULT_PAYROLL: ReglagesV10;
};
type LigneV10 = { docId: string; journal: string; account: string; debit: number; credit: number };
const core = exiger('../../banc/v10/core.js') as {
  payrollSettings: (d: unknown) => ReglagesV10;
  journalEntries: (data: unknown, societe: Societe, periode: object, options: object) => LigneV10[];
  cnssDeclaration: (data: unknown, annee: number, trimestre: number) => { slips: number; base: number; employee: number; employer: number; accident: number; total: number;
    rows: { employeeId: string; months: number; days: number; base: number; employee: number; employer: number; accident: number; total: number }[] };
  DEFAULT_ACCOUNTS: Record<string, string>;
};
const A = core.DEFAULT_ACCOUNTS;
const COMPTES: ComptesPaie = {
  salairesBruts: A.salairesBruts ?? '', chargesPatronales: A.chargesPatronales ?? '', taxesSalaires: A.taxesSalaires ?? '',
  tfpFoprolos: A.tfpFoprolos ?? '', cnss: A.cnss ?? '', irpp: A.irpp ?? '', personnel: A.personnel ?? '',
};

const exact = (x: unknown, d: number, nom: string): bigint => {
  const v = entier(Number(x) || 0, d);
  if (v === null) throw new Error(`${nom} non représentable : ${String(x)}`);
  return v;
};
// Le barème de la v10, fusionné avec le régime du contrat, en entiers.
function bareme(reglages: ReglagesV10, contrat: string): BaremePaie {
  const s = { ...reglages, ...compta.regimeDuContrat(reglages, contrat) } as Record<string, unknown>;
  const taux = (k: string) => exact(s[k], 4, k);
  return {
    cnssSalarie: taux('cnssEmployee'), cnssEmployeur: taux('cnssEmployer'), accidentTravail: taux('accidentRate'),
    tfp: taux('tfpRate'), foprolos: taux('foprolosRate'), solidarite: taux('solidarity'), fraisPro: taux('proRate'),
    plafondFraisPro: exact(s.proCap, 3, 'proCap'), chefDeFamille: exact(s.headOfFamily, 3, 'headOfFamily'), parEnfant: exact(s.perChild, 3, 'perChild'),
    enfantsMax: Number(s.maxChildren) || 0,
    tranches: (reglages.brackets ?? []).map((t) => ({ jusqua: t.upTo === null ? null : exact(t.upTo, 3, 'upTo'), taux: exact(t.rate, 4, 'rate') })),
    ...(s.sansIrpp === true ? { sansIrpp: true } : {}),
  };
}

const CHAMPS: [keyof Bulletin, string][] = [
  ['brutDeBase', 'baseGross'], ['retenueAbsence', 'absenceCut'], ['primesImposables', 'taxableBonus'], ['primesNonImposables', 'freeBonus'],
  ['brut', 'gross'], ['assietteCnss', 'cnssBase'], ['cnssSalarie', 'cnssEmployee'], ['apresCnss', 'afterCnss'], ['fraisPro', 'pro'],
  ['deductionsFamille', 'family'], ['imposableAnnuel', 'annualTaxable'], ['irppAnnuel', 'irppYear'], ['irpp', 'irpp'], ['css', 'css'],
  ['autresRetenues', 'otherDeductions'], ['net', 'net'], ['cnssEmployeur', 'cnssEmployer'], ['accidentTravail', 'accident'],
  ['tfp', 'tfp'], ['foprolos', 'foprolos'], ['chargesPatronales', 'employerCharges'], ['coutEmployeur', 'employerCost'],
];

// Les différences entre les deux calculs d'un bulletin (vide : les mêmes).
function comparer(e: SalarieV10, i: SaisieV10, reglages: ReglagesV10): string[] {
  const ancien = compta.computePayslip(e, i, reglages);
  const nouveau = calculerBulletin(
    { chefDeFamille: !!e.headOfFamily, enfants: Number(e.children) || 0 },
    {
      brut: exact(i.gross ?? e.grossSalary, 3, 'brut'), joursOuvrables: exact(i.workedDays || 26, 3, 'jours'), joursAbsence: exact(i.absentDays ?? 0, 3, 'absence'),
      primes: (i.bonuses ?? []).map((b) => ({ montant: exact(b.amount, 3, 'prime'), imposable: b.taxable !== false })),
      retenues: (i.deductions ?? []).map((d) => exact(d.amount, 3, 'retenue')),
    },
    bareme(reglages, String(e.contract || 'cdi')),
  );
  const faux: string[] = [];
  for (const [n, a] of CHAMPS) if (exact(ancien[a], 3, a) !== nouveau[n]) faux.push(`${n} : v10 ${ancien[a]}, nouveau ${nouveau[n]}`);
  return faux;
}

type Fiche = SaisieV10 & { id: string; employeeId: string; year: number; month: number; paidDate?: string; method?: string; computed: BulletinV10 };
// Le bulletin figé de la v10, dans le nouveau format.
const figer = (c: BulletinV10): Bulletin => {
  const b = Object.fromEntries(CHAMPS.map(([n, a]) => [n, exact(c[a], 3, a)])) as unknown as Bulletin;
  return { ...b, enfants: Number(c.children) || 0, imposableAnnuelAvantDeductions: 0n };
};

describe('le banc de la paie, contre la v10', () => {
  it('chaque bulletin de l\'exemple de cinq ans se calcule au même millime', () => {
    const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY } as Societe, '2026-09-28') as unknown as {
      employees: (SalarieV10 & { id: string })[]; payslips: (SaisieV10 & { employeeId: string })[];
    };
    const reglages = core.payrollSettings(donnees);
    expect(donnees.payslips.length).toBeGreaterThan(70);
    const faux: string[] = [];
    for (const b of donnees.payslips) {
      const e = donnees.employees.find((x) => x.id === b.employeeId) as SalarieV10;
      faux.push(...comparer(e, b, reglages).map((x) => `${b.employeeId} : ${x}`));
    }
    expect(faux).toEqual([]);
  });

  it('20 000 bulletins tirés au hasard (barèmes, régimes de contrat, absences, primes, retenues, familles) : les mêmes', () => {
    const h = hasard(20261004);
    const faux: string[] = [];
    for (let k = 0; k < 20_000 && faux.length < 5; k++) {
      const reglages = compta.baremesPaie({
        cnssEmployee: h.parmi([9.18, 9.18, 8.5, 0]), cnssEmployer: h.parmi([16.57, 16.57, 12.5]), accidentRate: h.parmi([0.4, 0.5, 1.2, 4]),
        tfpRate: h.parmi([2, 1, 0]), foprolosRate: h.parmi([1, 0]), solidarity: h.parmi([1, 0.5, 0]),
        proRate: h.parmi([10, 10, 5]), proCap: h.parmi([2000, 2000, 1500]), headOfFamily: h.parmi([300, 150]), perChild: h.parmi([100, 90]),
        maxChildren: h.parmi([4, 3]),
        ...(h.suivant() < 0.3 ? { brackets: [{ upTo: 5000, rate: 0 }, { upTo: 20000, rate: 26 }, { upTo: 30000, rate: 28 }, { upTo: 50000, rate: 32 }, { upTo: null, rate: 35 }] } : {}),
        regimesContrat: { civp: { cnssEmployee: 0, cnssEmployer: 0, sansIrpp: true }, cdd: { cnssEmployer: 12.5 }, saisonnier: { solidarity: 0.5 } },
      });
      const e: SalarieV10 = {
        contract: h.parmi(['cdi', 'cdi', 'cdd', 'civp', 'saisonnier']), headOfFamily: h.suivant() < 0.5, children: h.entre(0, 6),
        grossSalary: h.parmi([450, 1200.5, 2345.678, h.decimal(9000, 3), h.entre(400, 20000)]),
      };
      const i: SaisieV10 = {
        workedDays: h.parmi([26, 26, 22, 30, 25.5]),
        absentDays: h.parmi([0, 0, 0, 1, 2, 0.5, 3.5, 26]),
        bonuses: Array.from({ length: h.parmi([0, 0, 1, 2]) }, () => ({ amount: h.parmi([400, 55.555, h.decimal(1000, 3)]), taxable: h.suivant() < 0.7 })),
        deductions: Array.from({ length: h.parmi([0, 0, 1]) }, () => ({ amount: h.parmi([200, 33.333]) })),
      };
      faux.push(...comparer(e, i, reglages).map((x) => `${k} : ${x}`));
    }
    expect(faux).toEqual([]);
  });

  it('chaque bulletin, et chaque salaire versé, s\'écrit au même millime que la v10 (l\'exemple et 3 000 mois tirés au hasard)', () => {
    const verifier = (donnees: { employees: SalarieV10[]; payslips: Fiche[] }, societe: Societe) => {
      const lignes = core.journalEntries(donnees, societe, {}, { sections: ['paie'] });
      const texte = (l: LigneV10) => `${l.account} ${Math.round(l.debit * 1000)} ${Math.round(l.credit * 1000)}`;
      const faux: string[] = [];
      let ecrits = 0, verses = 0;
      for (const f of donnees.payslips) {
        const b = figer(f.computed);
        if (b.brut <= 0n || b.net < 0n) continue;
        const nouvelle = ecritureDeBulletin(b, COMPTES).lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`);
        const ancienne = lignes.filter((l) => l.docId === f.id && l.journal === 'PAIE').map(texte);
        if (JSON.stringify(nouvelle) !== JSON.stringify(ancienne)) faux.push(`${f.id} : v10 [${ancienne.join(' | ')}] ; nouveau [${nouvelle.join(' | ')}]`);
        ecrits++;
        const verse = ecritureDePaiementSalaire(f.paidDate ? b.net : 0n, { personnel: COMPTES.personnel, tresorerie: A.banque ?? '' }).lignes.map((l) => `${l.compte} ${l.debit} ${l.credit}`);
        const verse10 = lignes.filter((l) => l.docId === f.id && l.journal !== 'PAIE').map(texte);
        if (JSON.stringify(verse) !== JSON.stringify(verse10)) faux.push(`${f.id} versé : v10 [${verse10.join(' | ')}] ; nouveau [${verse.join(' | ')}]`);
        if (verse.length) verses++;
      }
      return { faux, ecrits, verses };
    };
    const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY } as Societe, '2026-09-28') as unknown as { employees: SalarieV10[]; payslips: Fiche[] };
    const exemple = verifier(donnees, { ...v10.DEFAULT_COMPANY } as Societe);
    expect(exemple.faux).toEqual([]);
    expect(exemple.ecrits).toBeGreaterThan(70);
    expect(exemple.verses).toBeGreaterThan(60);

    const h = hasard(20261005);
    const employees: (SalarieV10 & { id: string; name: string })[] = [];
    const payslips: Fiche[] = [];
    const reglages = compta.baremesPaie({});
    for (let k = 0; k < 3000; k++) {
      const e = { id: `e${k}`, name: `Salarié ${k}`, headOfFamily: h.suivant() < 0.5, children: h.entre(0, 5), grossSalary: h.parmi([450, 1234.567, h.decimal(9000, 3)]) };
      const i: SaisieV10 = { gross: e.grossSalary, workedDays: 26, absentDays: h.parmi([0, 0, 1, 0.5]),
        bonuses: h.suivant() < 0.3 ? [{ amount: h.decimal(500, 3), taxable: h.suivant() < 0.7 }] : [], deductions: h.suivant() < 0.2 ? [{ amount: 100 }] : [] };
      employees.push(e);
      payslips.push({ ...i, id: `b${k}`, employeeId: e.id, year: 2026, month: h.entre(1, 12), method: 'virement',
        ...(h.suivant() < 0.7 ? { paidDate: '2026-12-31' } : {}), computed: compta.computePayslip(e, i, reglages) });
    }
    const tire = verifier({ employees, payslips }, { ...v10.DEFAULT_COMPANY } as Societe);
    expect(tire.faux.slice(0, 5)).toEqual([]);
    expect(tire.ecrits).toBeGreaterThan(2900);
    expect(tire.verses).toBeGreaterThan(1800);
  });

  it('chaque trimestre de l\'exemple : même déclaration CNSS, et son total est ce que le compte CNSS a reçu dans le trimestre', () => {
    const donnees = demo.buildDemoData({ ...v10.DEFAULT_COMPANY } as Societe, '2026-09-28') as unknown as { payslips: Fiche[] };
    const fin = (a: number, m: number) => `${a}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const bulletins = donnees.payslips.map((f) => ({
      salarie: f.employeeId, annee: Number(f.year), mois: Number(f.month), bulletin: figer(f.computed),
      joursOuvrables: exact(f.computed.workedDays, 3, 'jours'), joursAbsence: exact(f.computed.absentDays, 3, 'absence'),
    }));
    // Le journal de la paie, écrit par le nouveau moteur, chaque bulletin au dernier jour de son mois.
    const journal = bulletins.map((b) => ({ date: fin(b.annee, b.mois), lignes: ecritureDeBulletin(b.bulletin, COMPTES).lignes }));
    const faux: string[] = [];
    let trimestres = 0;
    for (const annee of [...new Set(bulletins.map((b) => b.annee))]) {
      for (const t of [1, 2, 3, 4]) {
        const n = cnssDuTrimestre(bulletins, annee, t);
        const v = core.cnssDeclaration(donnees, annee, t);
        if (!n.bulletins && !v.slips) continue;
        trimestres++;
        const paires: [string, number, bigint][] = [['assiette', v.base, n.assiette], ['salarié', v.employee, n.partSalarie], ['employeur', v.employer, n.partEmployeur], ['accident', v.accident, n.accident], ['total', v.total, n.total]];
        for (const [nom, x, y] of paires) if (exact(x, 3, nom) !== y) faux.push(`${annee} T${t} ${nom} : v10 ${x}, nouveau ${y}`);
        if (v.slips !== n.bulletins || v.rows.length !== n.lignes.length) faux.push(`${annee} T${t} : ${v.slips}/${v.rows.length} bulletins/salariés chez la v10, ${n.bulletins}/${n.lignes.length}`);
        for (const r of v.rows) {
          const l = n.lignes.find((x) => x.salarie === r.employeeId);
          if (!l || l.mois !== r.months || l.jours !== exact(r.days, 3, 'jours') || l.assiette !== exact(r.base, 3, 'base') || l.total !== exact(r.total, 3, 'total')) {
            faux.push(`${annee} T${t} ${r.employeeId} : v10 ${JSON.stringify(r)}`);
          }
        }
        // Deux chemins, un chiffre : ce que le compte CNSS a reçu des écritures du trimestre.
        const recu = -mouvement(journal, COMPTES.cnss, `${annee}-${String((t - 1) * 3 + 1).padStart(2, '0')}-01`, fin(annee, t * 3));
        if (recu !== n.total) faux.push(`${annee} T${t} : le compte CNSS a reçu ${recu}, la déclaration dit ${n.total}`);
      }
    }
    expect(faux).toEqual([]);
    expect(trimestres).toBeGreaterThan(15);
  });
});

