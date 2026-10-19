// Le métier de la paie de 2026, contre un vrai logiciel (1.59.0 ; docs/paie.md, « Le métier de la paie,
// premier lot »). Skander a donné trois documents réels le 19/10/2026 : le journal de paie de septembre
// 2026 d'une entreprise tunisienne (douze salariés), le bulletin de juin de l'un d'eux, et l'état
// récapitulatif CNSS du 3e trimestre. Ils ne sont JAMAIS gardés dans le dépôt ; d'eux, ce fichier ne
// garde que des montants, sans un nom, un matricule ni un numéro (« salarié 1 » à « salarié 12 »).
//
// Ce que les documents disent, et que ce fichier tient :
//   - les taux livrés par SkanFact sont ceux de 2026 : CNSS 9,68 % et 17,07 %, solidarité 0,5 % de la
//     base imposable (l'accident du travail est celui de l'entreprise : 0,5 % ici) ;
//   - les primes de présence (30) et de transport (50) suivent les jours payés : 19,5 jours sur 26 en
//     donnent les 19,5 vingt-sixièmes ;
//   - chaque colonne du journal tombe au millime du moteur du serveur ET de l'écran (deux chemins, un
//     chiffre), sauf des écarts d'UN millime, tous nommés ici : le logiciel du journal garde les fractions
//     de millime jusqu'à l'affichage (30 × 10,5 / 26 + 50 × 10,5 / 26 = 32,3077, imprimé 32,308), SkanFact
//     arrondit chaque prime au millime (12,115 + 20,192 = 32,307). Ses totaux ne sont d'ailleurs pas la
//     somme de ses lignes ; ceux de SkanFact le sont.

import { describe, expect, it } from 'vitest';
import { calculerBulletin, type BaremePaie, type Bulletin } from '../../moteur/paie.ts';
import { ecranDeLaPlateforme } from './v10.ts';

type Prime10 = { label: string; amount: number; taxable?: boolean; parJour?: boolean; mensuel?: number; jours?: number; sur?: number };
type Calcul10 = Record<string, number> & { bonuses: Prime10[] };
type Reglages = Record<string, unknown>;
const compta = ecranDeLaPlateforme('compta.js') as {
  computePayslip: (e: Record<string, unknown>, i: Record<string, unknown>, s: Reglages) => Calcul10;
  baremesPaie: (r: Reglages) => Reglages & { brackets: { upTo: number | null; rate: number }[] };
  DEFAULT_PAYROLL: { cnssEmployee: number; cnssEmployer: number; solidarity: number };
};
const core = ecranDeLaPlateforme('core.js') as {
  primesDuMois: (e: { primes?: unknown[] }, payes: number, total: number) => Prime10[];
  saisieDeLaFiche: (e: { primes?: unknown[] }, s: Reglages) => { bonuses: Prime10[] };
  payslipInputFor: (d: unknown, e: unknown, annee: number, mois: number) => { gross: number; workedDays: number; absentDays: number; bonuses: Prime10[]; prorata: unknown };
  payslipHtml: (slip: unknown, d: unknown, societe: unknown, o: unknown) => string;
  tauxAvant2026: (d: unknown) => { cle: string; garde: number; livre: number }[];
};

// Le barème du journal : celui que SkanFact livre, et l'accident du travail de l'entreprise.
const REGLAGES = compta.baremesPaie({ accidentRate: 0.5 });
const taux = (x: unknown) => BigInt(Math.round(Number(x) * 10_000));
const millimes = (x: unknown) => BigInt(Math.round(Number(x) * 1000));
const BAREME: BaremePaie = {
  cnssSalarie: taux(REGLAGES.cnssEmployee), cnssEmployeur: taux(REGLAGES.cnssEmployer), accidentTravail: taux(REGLAGES.accidentRate),
  tfp: taux(REGLAGES.tfpRate), foprolos: taux(REGLAGES.foprolosRate), solidarite: taux(REGLAGES.solidarity), fraisPro: taux(REGLAGES.proRate),
  plafondFraisPro: millimes(REGLAGES.proCap), chefDeFamille: millimes(REGLAGES.headOfFamily), parEnfant: millimes(REGLAGES.perChild),
  enfantsMax: Number(REGLAGES.maxChildren), tranches: REGLAGES.brackets.map((b) => ({ jusqua: b.upTo === null ? null : millimes(b.upTo), taux: taux(b.rate) })),
};

// Les colonnes du journal (J., H.S.Base + CP, Indemnités, S.Cotis, CNSS, S.Imposable, Impôts, CSS, Net à payer,
// TFP, Foprolos, AT, CP), en millimes ; J. en millièmes de jour.
const COLONNES = ['jours', 'base', 'indemnites', 'cotisable', 'cnss', 'imposable', 'irpp', 'css', 'net', 'tfp', 'foprolos', 'accident', 'cnssEmployeur'] as const;
type Colonne = typeof COLONNES[number];
// Chaque salarié : son brut de base mensuel, ses jours payés, sa famille (déduite de son impôt), puis sa ligne du journal.
const SALARIES: { brut: number; jours: number; chef: boolean; enfants: number; journal: string }[] = [
  { brut: 1276, jours: 26, chef: true, enfants: 2, journal: '26 1276 80 1356 131.261 1224.739 119.316 5.303 1100.120 27.120 13.560 6.780 231.469' },
  { brut: 1130, jours: 26, chef: true, enfants: 3, journal: '26 1130 80 1210 117.128 1092.872 87.563 4.668 1000.641 24.200 12.100 6.050 206.547' },
  { brut: 1136, jours: 26, chef: true, enfants: 1, journal: '26 1136 80 1216 117.709 1098.291 92.949 4.776 1000.567 24.320 12.160 6.080 207.571' },
  { brut: 612, jours: 19.5, chef: false, enfants: 0, journal: '19.5 459 60 519 50.239 468.761 0.783 2.109 465.869 10.380 5.190 2.595 88.593' },
  { brut: 612, jours: 10.5, chef: false, enfants: 0, journal: '10.5 247.154 32.308 279.462 27.052 252.410 0 1.136 251.274 5.589 2.795 1.397 47.704' },
  { brut: 540, jours: 4, chef: true, enfants: 2, journal: '4 83.077 12.308 95.385 9.233 86.151 0 0.179 85.972 1.908 0.954 0.477 16.282' },
  { brut: 548, jours: 11, chef: false, enfants: 0, journal: '11 231.846 33.846 265.692 25.719 239.973 0 1.080 238.893 5.314 2.657 1.328 45.354' },
  { brut: 548, jours: 16.02, chef: false, enfants: 0, journal: '16.02 337.652 49.292 386.945 37.456 349.488 0 1.573 347.916 7.739 3.869 1.935 66.051' },
  { brut: 677, jours: 20, chef: false, enfants: 0, journal: '20 520.769 61.538 582.308 56.367 525.940 8.502 2.367 515.072 11.646 5.823 2.912 99.400' },
  { brut: 612, jours: 20, chef: false, enfants: 0, journal: '20 470.769 61.538 532.308 51.527 480.780 2.405 2.164 476.211 10.646 5.323 2.662 90.865' },
  { brut: 548, jours: 14.3, chef: false, enfants: 0, journal: '14.3 301.400 44 345.400 33.435 311.965 0 1.404 310.561 6.908 3.454 1.727 58.960' },
  { brut: 548, jours: 20, chef: false, enfants: 0, journal: '20 421.538 61.538 483.077 46.762 436.315 0 1.963 434.352 9.662 4.831 2.415 82.461' },
];
// Les totaux imprimés au pied du journal (Nombre 12).
const TOTAUX_DU_JOURNAL: Partial<Record<Colonne, string>> = {
  base: '6615.206', indemnites: '656.369', cotisable: '7271.575', cnss: '703.888', imposable: '6567.687', irpp: '311.518', css: '28.721',
  net: '6227.448', tfp: '145.432', foprolos: '72.716', accident: '36.358', cnssEmployeur: '1241.258',
};
// Les écarts, tranchés : chacun vaut UN millime, et vient des fractions que le logiciel du journal garde.
// « 5 indemnites » : le salarié 5, sa colonne, ce que SkanFact écrit.
const ECARTS: Record<string, string> = {
  '3 net': '1000.566',            // 1 216 − 117,709 − 92,949 − 4,776 ; le journal part de 117,7088, 92,9488 et 4,7757
  '5 indemnites': '32.307',       // 12,115 + 20,192 (30 et 50 × 10,5 / 26, chacune au millime) ; le journal : 32,3077
  '5 cotisable': '279.461', '5 imposable': '252.409', '5 net': '251.273',
  '6 indemnites': '12.307', '6 cotisable': '95.384',
  '8 indemnites': '49.293',       // 18,485 + 30,808 ; le journal : 80 × 16,02 / 26 = 49,2923
  '8 imposable': '349.489', '8 cnssEmployeur': '66.052',
  '9 indemnites': '61.539', '9 imposable': '525.941',
  '10 indemnites': '61.539', '10 imposable': '480.781', '10 net': '476.212',
  '12 indemnites': '61.539',
};
const ECARTS_DES_TOTAUX: Partial<Record<Colonne, string>> = { base: '6615.205', indemnites: '656.370', css: '28.722', net: '6227.447' };

// Les deux primes de la fiche, au jour, comme sur le bulletin de juin.
const PRIMES = [{ label: 'Prime de présence', amount: 30, taxable: true, parJour: true }, { label: 'Prime de transport', amount: 50, taxable: true, parJour: true }];
const lire = (t: string) => t.split(' ').map((x) => millimes(x));
const colonnesDe = (jours: number, b: Bulletin): Record<Colonne, bigint> => ({
  jours: millimes(jours), base: b.brutDeBase - b.retenueAbsence, indemnites: b.primesImposables + b.primesNonImposables, cotisable: b.assietteCnss,
  cnss: b.cnssSalarie, imposable: b.apresCnss, irpp: b.irpp, css: b.css, net: b.net, tfp: b.tfp, foprolos: b.foprolos, accident: b.accidentTravail, cnssEmployeur: b.cnssEmployeur,
});
const texte = (x: bigint) => (Number(x) / 1000).toFixed(3);

// Le bulletin de chaque salarié, par l'écran (les primes de la fiche, au jour, puis `computePayslip`), et
// par le moteur du serveur sur la saisie que l'écran a faite.
function bulletins() {
  return SALARIES.map((s) => {
    const fiche = { grossSalary: s.brut, headOfFamily: s.chef, children: s.enfants, contract: 'cdi', primes: PRIMES };
    const saisie = { gross: s.brut, workedDays: 26, absentDays: 26 - s.jours, bonuses: core.primesDuMois(fiche, s.jours, 26), deductions: [] };
    const ecran = compta.computePayslip(fiche, saisie, REGLAGES);
    const moteur = calculerBulletin({ chefDeFamille: s.chef, enfants: s.enfants }, {
      brut: millimes(s.brut), joursOuvrables: 26_000n, joursAbsence: millimes(saisie.absentDays),
      primes: saisie.bonuses.map((p) => ({ montant: millimes(p.amount), imposable: p.taxable !== false })),
    }, BAREME);
    return { s, saisie, ecran, moteur };
  });
}

describe('la paie de 2026 contre un vrai logiciel : le journal de paie de septembre, au millime', () => {
  it('les taux livrés sont ceux des documents de 2026 : CNSS 9,68 % et 17,07 %, solidarité 0,5 %', () => {
    expect([compta.DEFAULT_PAYROLL.cnssEmployee, compta.DEFAULT_PAYROLL.cnssEmployer, compta.DEFAULT_PAYROLL.solidarity]).toEqual([9.68, 17.07, 0.5]);
    // L'état CNSS du trimestre : 26,75 % de sécurité sociale, la somme des deux parts.
    expect(Math.round((compta.DEFAULT_PAYROLL.cnssEmployee + compta.DEFAULT_PAYROLL.cnssEmployer) * 100)).toBe(2675);
  });

  it('chaque ligne du journal tombe au millime, par l\'écran comme par le serveur, sauf les écarts d\'un millime nommés', () => {
    const faux: string[] = [];
    const trouves: Record<string, string> = {};
    const totaux = Object.fromEntries(COLONNES.map((c) => [c, 0n])) as Record<Colonne, bigint>;
    for (const [i, { s, saisie, ecran, moteur }] of bulletins().entries()) {
      // Deux chemins, un chiffre : l'écran et le serveur, montant par montant.
      for (const [n, a] of [['brut', 'gross'], ['assietteCnss', 'cnssBase'], ['cnssSalarie', 'cnssEmployee'], ['irpp', 'irpp'], ['css', 'css'], ['net', 'net'], ['cnssEmployeur', 'cnssEmployer'], ['coutEmployeur', 'employerCost']] as const) {
        if (millimes(ecran[a]) !== moteur[n]) faux.push(`salarié ${i + 1} ${n} : écran ${ecran[a]}, serveur ${texte(moteur[n])}`);
      }
      const nous = colonnesDe(s.jours, moteur);
      const journal = lire(s.journal);
      COLONNES.forEach((c, k) => {
        totaux[c] += nous[c];
        if (nous[c] === journal[k]) return;
        trouves[`${i + 1} ${c}`] = texte(nous[c]);
        const d = nous[c] - (journal[k] ?? 0n);
        if (d !== 1n && d !== -1n) faux.push(`salarié ${i + 1} ${c} : ${texte(nous[c])}, le journal ${texte(journal[k] ?? 0n)}`);
      });
      expect(saisie.bonuses.map((p) => p.parJour)).toEqual([true, true]);
    }
    expect(faux).toEqual([]);
    expect(trouves).toEqual(ECARTS);
    // Les totaux de SkanFact sont la somme de ses lignes ; ceux du journal, à un millime près sur quatre colonnes.
    const ecartsTotaux: Partial<Record<Colonne, string>> = {};
    for (const [c, t] of Object.entries(TOTAUX_DU_JOURNAL) as [Colonne, string][]) {
      if (totaux[c] !== millimes(t)) ecartsTotaux[c] = texte(totaux[c]);
      expect(totaux[c] - millimes(t) <= 1n && millimes(t) - totaux[c] <= 1n, c).toBe(true);
    }
    expect(ecartsTotaux).toEqual(ECARTS_DES_TOTAUX);
  });

  it('les totaux imprimés du journal ne sont pas la somme de ses lignes : il additionne des fractions de millime', () => {
    // Ce que le commentaire en tête affirme, vérifié sur les chiffres du journal lui-même.
    const somme = (c: Colonne) => SALARIES.reduce((a, s) => a + (lire(s.journal)[COLONNES.indexOf(c)] ?? 0n), 0n);
    expect([texte(somme('cotisable')), TOTAUX_DU_JOURNAL.cotisable]).toEqual(['7271.577', '7271.575']);
    expect([texte(somme('css')), TOTAUX_DU_JOURNAL.css]).toEqual(['28.722', '28.721']);
  });

  it('une prime au jour suit les jours payés, arrondie au millime ; une prime fixe passe entière ; une prime vide ne compte pas', () => {
    const fiche = { primes: [...PRIMES, { label: 'Rendement', amount: 100, taxable: false }, { label: 'Vide', amount: 0, parJour: true }, { label: '  ', amount: 12.5 }] };
    expect(core.primesDuMois(fiche, 19.5, 26)).toEqual([
      { label: 'Prime de présence', amount: 22.5, taxable: true, parJour: true, mensuel: 30, jours: 19.5, sur: 26 },
      { label: 'Prime de transport', amount: 37.5, taxable: true, parJour: true, mensuel: 50, jours: 19.5, sur: 26 },
      { label: 'Rendement', amount: 100, taxable: false },
      { label: 'Prime', amount: 12.5, taxable: true },
    ]);
    // 16,02 jours : 30 × 16,02 / 26 = 18,4846… → 18,485.
    expect(core.primesDuMois(fiche, 16.02, 26).slice(0, 2).map((p) => p.amount)).toEqual([18.485, 30.808]);
    // Plus de jours payés que le mois n'en compte, ou des jours négatifs : bornés.
    expect(core.primesDuMois(fiche, 40, 26)[0]?.amount).toBe(30);
    expect(core.primesDuMois(fiche, -3, 26)[0]?.amount).toBe(0);
    // Une fiche estimée sur un mois plein compte ses primes entières.
    expect(core.saisieDeLaFiche(fiche, REGLAGES).bonuses.map((p) => p.amount)).toEqual([30, 50, 100, 12.5]);
  });

  it('le bulletin du mois reprend les primes de la fiche : au prorata d\'une absence non payée, et d\'une entrée en cours de mois', () => {
    const fiche = { id: 'e1', name: 'Salarié 1', grossSalary: 612, hireDate: '2025-01-06', endDate: '', contract: 'cdi', primes: [...PRIMES, { label: 'Rendement', amount: 100, taxable: true }] };
    // Deux jours sans solde, le lundi 21 et le mardi 22 septembre 2026 : 24 jours payés sur 26.
    const absence = { employees: [fiche], payslips: [], advances: [], payrollSettings: {}, leaves: [{ id: 'l1', employeeId: 'e1', kind: 'sans-solde', from: '2026-09-21', to: '2026-09-22' }] };
    const a = core.payslipInputFor(absence, fiche, 2026, 9);
    expect([a.absentDays, a.bonuses.map((p) => p.amount)]).toEqual([2, [27.692, 46.154, 100]]);
    // Entré le mardi 8 septembre : six jours ouvrables hors du contrat (du 1er au 7, sans le dimanche), 20 payés.
    const entre = { ...fiche, hireDate: '2026-09-08' };
    const b = core.payslipInputFor({ ...absence, employees: [entre], leaves: [] }, entre, 2026, 9);
    expect([b.gross, b.absentDays, b.bonuses.map((p) => [p.amount, p.jours])]).toEqual([470.769, 0, [[23.077, 20], [38.462, 20], [100, undefined]]]);
  });

  it('le bulletin imprimé dit les jours payés et les jours de chaque prime au jour', () => {
    const fiche = { id: 'e1', name: 'Salarié 4', grossSalary: 612, contract: 'cdi', primes: PRIMES };
    const saisie = { gross: 612, workedDays: 26, absentDays: 6.5, bonuses: core.primesDuMois(fiche, 19.5, 26), deductions: [] };
    const slip = { id: 'b1', employeeId: 'e1', year: 2026, month: 9, ...saisie, computed: compta.computePayslip(fiche, saisie, REGLAGES), issuedAt: '2026-09-30' };
    const html = core.payslipHtml(slip, { employees: [fiche], payslips: [slip], payrollSettings: {} }, { name: 'Essai', currency: 'DT', accentColor: '#0f9d8f' }, {});
    expect(html).toMatch(/Jours payés<\/span><span>19,5</);
    expect(html).toContain('Prime de présence (19,5 j sur 26)');
    expect(html).toContain('Prime de transport (19,5 j sur 26)');
  });

  it('des barèmes enregistrés avec les taux d\'avant 2026 se reconnaissent ; un taux choisi autrement ne se signale pas', () => {
    expect(core.tauxAvant2026({ payrollSettings: { cnssEmployee: 9.18, cnssEmployer: 16.57, solidarity: 1, accidentRate: 0.4 } }).map((x) => [x.cle, x.garde, x.livre]))
      .toEqual([['cnssEmployee', 9.18, 9.68], ['cnssEmployer', 16.57, 17.07], ['solidarity', 1, 0.5]]);
    expect(core.tauxAvant2026({ payrollSettings: { cnssEmployee: 8.5, solidarity: 0.5 } })).toEqual([]);
    expect(core.tauxAvant2026({ payrollSettings: {} })).toEqual([]);
  });
});
