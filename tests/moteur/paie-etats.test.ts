// Le journal de paie et les états de la paie (1.61.0 ; docs/paie.md, « Le journal de paie et les états »), contre
// les documents réels que Skander a donnés le 19/10/2026 : le journal de paie de septembre 2026 (douze salariés) et
// l'état récapitulatif des salaires déclarés du 3e trimestre. D'eux, seuls des montants sont gardés (paie-reel.ts).
//
// Ce que ce fichier tient :
//   - le journal du mois a les colonnes du journal réel, au millime du journal (les écarts d'un millime sont ceux
//     que la 1.59.0 a nommés) ; ses totaux sont la somme de ses lignes ; une ligne se tient (brut, cotisable,
//     imposable, net) ; il est rangé dans l'ordre du registre du personnel ;
//   - l'état CNSS calcule les cotisations sur le TOTAL des salaires, au taux du régime : 29 119,268 × 26,75 % =
//     7 789,404 et × 0,50 % = 145,596, comme l'état réel ; un taux qui varie d'un bulletin à l'autre reprend la
//     somme des bulletins ; le total des salaires s'écrit en lettres ;
//   - la déclaration mensuelle reprend les montants du journal du même mois (deux chemins, un chiffre), à
//     l'échéance du calendrier fiscal.

import { describe, expect, it } from 'vitest';
import { COLONNES, ECARTS, ECARTS_DES_TOTAUX, ETAT_CNSS, PRIMES, SALARIES, TOTAUX_DU_JOURNAL, type Colonne } from './paie-reel.ts';
import { ecranDeLaPlateforme } from './v10.ts';

type Reglages = Record<string, unknown>;
type Prime10 = { label: string; amount: number; taxable?: boolean; hs?: number; heures?: number };
type Calcul10 = Record<string, number>;
type Ligne = Record<string, number> & { name: string; n: number; employeeId: string; matriculeCnss: string };
type Journal = { lignes: Ligne[]; totaux: Record<string, number>; nombre: number };
type LigneEtat = { cle: string; libelle: string; taux: number | null; montant: number };
type Etat = { salaires: number; lignes: LigneEtat[]; total: number; bulletins: number; ecart: number; enLettres: string; employeur: string; code: string; salaries: number };
type LigneDm = { cle: string; base: number; taux: number | null; bareme?: boolean; montant: number };
type Dm = { lignes: LigneDm[]; total: number; dueDate: string; salaries: number };
const compta = ecranDeLaPlateforme('compta.js') as {
  computePayslip: (e: Record<string, unknown>, i: Record<string, unknown>, s: Reglages) => Calcul10;
  baremesPaie: (r: Reglages) => Reglages;
};
const core = ecranDeLaPlateforme('core.js') as {
  primesDuMois: (e: unknown, payes: number, total: number) => Prime10[];
  payslipInputFor: (d: unknown, e: unknown, annee: number, mois: number) => Record<string, unknown>;
  payslipHtml: (slip: unknown, d: unknown, societe: unknown, o: unknown) => string;
  joursPayesDuBulletin: (slip: unknown) => number;
  COLONNES_JOURNAL: [string, string, string][];
  journalDePaie: (d: unknown, annee: number, mois: number) => Journal;
  journalDePaieHtml: (d: unknown, societe: unknown, annee: number, mois: number) => string;
  colonnesCsvJournal: () => unknown[];
  toCsv: (lignes: unknown[], colonnes: unknown[]) => string;
  etatRecapitulatifCnss: (d: unknown, societe: unknown, annee: number, trimestre: number) => Etat;
  etatRecapitulatifCnssHtml: (d: unknown, societe: unknown, annee: number, trimestre: number) => string;
  declarationMensuelleSalaires: (d: unknown, annee: number, mois: number) => Dm;
  cnssDeclaration: (d: unknown, annee: number, trimestre: number) => { base: number; total: number };
};

// Le barème du journal : celui que SkanFact livre, et l'accident du travail de l'entreprise (0,5 %).
const REGLAGES = compta.baremesPaie({ accidentRate: 0.5 });
const millimes = (x: unknown) => BigInt(Math.round(Number(x) * 1000));
const texte = (x: bigint) => (Number(x) / 1000).toFixed(3);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const deux = (n: number) => String(n).padStart(2, '0');
// Les clés du journal de SkanFact pour les colonnes du journal réel.
const CLE: Record<Colonne, string> = {
  jours: 'jours', base: 'base', indemnites: 'indemnites', cotisable: 'cotisable', cnss: 'cnss', imposable: 'imposable', irpp: 'irpp',
  css: 'css', net: 'net', tfp: 'tfp', foprolos: 'foprolos', accident: 'accident', cnssEmployeur: 'patronal',
};
// Un montant tel que l'écran l'écrit (les espaces des milliers sont insécables).
const lu = (t: string) => t.replace(/[\u00a0\u202f]/g, ' ');

type Fiche = Record<string, unknown> & { id: string };
type Bulletin = Record<string, unknown> & { computed: Calcul10 };
const bulletin = (e: Fiche, annee: number, mois: number, saisie: Record<string, unknown>, reglages: Reglages = REGLAGES): Bulletin => ({
  id: `b-${e.id}-${annee}-${mois}`, employeeId: e.id, year: annee, month: mois, ...saisie,
  computed: compta.computePayslip(e, saisie, reglages), issuedAt: `${annee}-${deux(mois)}-28`, paidDate: '',
});
// Le dossier de septembre 2026 : les douze salariés du journal réel, entrés dans l'ordre de ses lignes (le registre du
// personnel les range par date d'entrée), avec leurs deux primes au jour.
function septembre() {
  const employees: Fiche[] = SALARIES.map((s, i) => ({
    id: `s${i + 1}`, name: `Salarié ${i + 1}`, grossSalary: s.brut, headOfFamily: s.chef, children: s.enfants, contract: 'cdi', primes: PRIMES,
    hireDate: `2020-01-${deux(i + 1)}`, cnss: '',
  }));
  const payslips = SALARIES.map((s, i) => bulletin(employees[i] as Fiche, 2026, 9, {
    gross: s.brut, workedDays: 26, absentDays: 26 - s.jours, bonuses: core.primesDuMois(employees[i] as Fiche, s.jours, 26), deductions: [],
  }));
  return { employees, payslips, payrollSettings: REGLAGES, leaves: [], advances: [], timesheets: [] as unknown[], fiscalDeadlines: [] as unknown[] };
}

describe('le journal de paie et les états de la paie, contre les documents réels', () => {
  // 1.62.0 (docs/paie.md, « L'absence du mois d'une entrée ») : le brut d'un mois d'entrée est déjà proratisé ; l'absence
  // s'en retirait encore au prorata, et le journal disait 18 jours payés pour une base de 20.
  it('une entrée et une absence le même mois : l\'absence se retire au taux du salaire du contrat ; la base du journal suit ses jours payés', () => {
    // Entré le mardi 8 septembre 2026 pour 612, avec une prime de présence au jour ; deux jours sans solde, les 21 et 22.
    const e: Fiche = { id: 'e1', name: 'Salarié 1', grossSalary: 612, hireDate: '2026-09-08', contract: 'cdi', primes: [PRIMES[0]] };
    const d = { employees: [e], payslips: [] as Bulletin[], advances: [], payrollSettings: REGLAGES,
      leaves: [{ id: 'l1', employeeId: 'e1', kind: 'sans-solde', from: '2026-09-21', to: '2026-09-22' }] };
    const i = core.payslipInputFor(d, e, 2026, 9);
    expect([i.gross, i.absentDays, (i.prorata as { brutFiche: number }).brutFiche]).toEqual([470.769, 2, 612]);
    const b = bulletin(e, 2026, 9, i);
    d.payslips.push(b);
    // 612 × 2 / 26 = 47,077 retenus (et non 470,769 × 2 / 26 = 36,213) : la base est 612 × 18 / 26.
    expect([b.computed.absenceCut, b.computed.brutDuMois]).toEqual([47.077, 612]);
    const [l] = core.journalDePaie(d, 2026, 9).lignes;
    expect([l?.jours, l?.base, l?.indemnites]).toEqual([18, 423.692, 20.769]);
    expect(l?.base).toBe(r3(612 * 18 / 26));
    // Le bulletin imprimé dit sur quel salaire l'absence s'est retirée.
    expect(lu(core.payslipHtml(b, d, { name: 'Essai', currency: 'DT' }, {}))).toMatch(/<td>Absence \(2 jours\)<\/td>\s*<td class="n">612,000<\/td>/);
    // Un brut retouché à la main n'est plus proratisé : l'absence se retire de lui.
    const retouche = bulletin(e, 2026, 9, { ...i, gross: 500 });
    expect([retouche.computed.absenceCut, retouche.computed.brutDuMois]).toEqual([38.462, 500]);
  });

  it('le journal de septembre a les colonnes du journal réel, au millime, sauf les écarts d\'un millime déjà nommés ; ses totaux sont la somme de ses lignes', () => {
    const j = core.journalDePaie(septembre(), 2026, 9);
    expect(j.nombre).toBe(12);
    // L'ordre du registre du personnel (son numéro tient lieu de matricule), celui des lignes du journal réel.
    expect(j.lignes.map((l) => [l.n, l.name])).toEqual(SALARIES.map((_, i) => [i + 1, `Salarié ${i + 1}`]));
    const trouves: Record<string, string> = {};
    j.lignes.forEach((l, i) => {
      const reel = (SALARIES[i]?.journal ?? '').split(' ').map((x) => millimes(x));
      COLONNES.forEach((c, k) => {
        const nous = millimes(l[CLE[c]]);
        if (nous !== reel[k]) trouves[`${i + 1} ${c}`] = texte(nous);
      });
      // Le journal réel n'a ni heures supplémentaires ni retenues ce mois-là : le salaire net est le net à payer.
      expect([l.hs, l.retenues, l.salaireNet]).toEqual([0, 0, l.net]);
    });
    expect(trouves).toEqual(ECARTS);
    // Les totaux : la somme des lignes, colonne par colonne ; ceux du journal réel, à un millime près (nommés).
    const ecarts: Partial<Record<Colonne, string>> = {};
    for (const [k] of core.COLONNES_JOURNAL) expect(millimes(j.totaux[k]), k).toBe(j.lignes.reduce((a, l) => a + millimes(l[k]), 0n));
    for (const [c, t] of Object.entries(TOTAUX_DU_JOURNAL) as [Colonne, string][]) {
      if (millimes(j.totaux[CLE[c]]) !== millimes(t)) ecarts[c] = texte(millimes(j.totaux[CLE[c]]));
    }
    expect(ecarts).toEqual(ECARTS_DES_TOTAUX);
  });

  it('une ligne du journal se tient : les heures supplémentaires à part, une prime non imposable hors cotisations, une retenue entre le salaire net et le net à payer', () => {
    const e: Fiche = { id: 'a', name: 'Salarié A', grossSalary: 1234.567, contract: 'cdi', hireDate: '2021-03-01', cnss: '12345678-01' };
    const saisie = {
      gross: 1234.567, workedDays: 26, absentDays: 1.5, deductions: [{ label: 'Avance', amount: 100.125 }],
      bonuses: [{ label: 'Heures supplémentaires : 6 h à +25 %', amount: 44.517, taxable: true, hs: 25, heures: 6 },
        { label: 'Prime de rendement', amount: 75.25, taxable: true }, { label: 'Panier', amount: 33.333, taxable: false }],
    };
    // Entré en cours de mois, avec une absence : 20 jours sous contrat sur 26, moins 2 jours sans solde.
    const f: Fiche = { id: 'b', name: 'Salarié B', grossSalary: 900, contract: 'cdi', hireDate: '2026-09-08', cnss: '' };
    const sb = { gross: 692.308, workedDays: 26, absentDays: 2, bonuses: [], deductions: [], prorata: { jours: 20, sur: 26, motif: 'entrée le 08/09/2026' } };
    const d = { employees: [f, e], payslips: [bulletin(f, 2026, 9, sb), bulletin(e, 2026, 9, saisie)], payrollSettings: REGLAGES };
    const j = core.journalDePaie(d, 2026, 9);
    // Le registre range par date d'entrée : A (2021) avant B (2026), quel que soit l'ordre des fiches.
    expect(j.lignes.map((l) => [l.n, l.name, l.jours])).toEqual([[1, 'Salarié A', 24.5], [2, 'Salarié B', 18]]);
    const [a] = j.lignes;
    const c = (d.payslips[1] as Bulletin).computed;
    expect(a?.matriculeCnss).toBe('12345678-01');
    expect([a?.hs, a?.indemnites, a?.retenues]).toEqual([44.517, 108.583, 100.125]);
    expect(a?.base).toBe(r3((c.baseGross ?? 0) - (c.absenceCut ?? 0)));
    expect(a?.brut).toBe(c.gross);
    expect(a?.brut).toBe(r3((a?.base ?? 0) + 44.517 + 108.583));
    expect(a?.cotisable).toBe(r3((a?.brut ?? 0) - 33.333));
    expect(a?.imposable).toBe(r3((a?.cotisable ?? 0) - (a?.cnss ?? 0)));
    expect(a?.salaireNet).toBe(r3((a?.imposable ?? 0) + 33.333 - (a?.irpp ?? 0) - (a?.css ?? 0)));
    expect(a?.net).toBe(r3((a?.salaireNet ?? 0) - 100.125));
    expect(a?.net).toBe(c.net);
    // Les jours payés du bulletin et ceux du journal : la même fonction.
    expect(core.joursPayesDuBulletin(d.payslips[0])).toBe(18);
  });

  it('le journal s\'imprime (une page en largeur, les colonnes du journal réel, les totaux, le nombre de salariés) et s\'exporte en CSV', () => {
    const d = septembre();
    const j = core.journalDePaie(d, 2026, 9);
    const html = lu(core.journalDePaieHtml(d, { name: 'Entreprise d\'essai', currency: 'DT', address: 'Une rue', cnss: '1234567-01' }, 2026, 9));
    expect(html).toContain('size: A4 landscape');
    expect(html).toContain('<h1>Journal de paie</h1>');
    expect(html).toContain('septembre 2026');
    expect(html).toContain('N° CNSS : 1234567-01');
    expect([...html.matchAll(/<th title="[^"]*">([^<]*)<\/th>/g)].map((m) => m[1]))
      .toEqual(['J.', 'Base', 'H.S.', 'Indemnités', 'Brut', 'S. cotisable', 'CNSS', 'S. imposable', 'IRPP', 'CSS', 'S. net', 'Retenues', 'Net à payer', 'TFP', 'FOPROLOS', 'AT', 'CNSS pat.']);
    expect(html).toMatch(/<td class="g">0001<\/td><td class="g">Salarié 1<\/td><td class="n">26<\/td><td class="n">1 276,000<\/td>/);
    expect(html).toContain('<td class="n">19,5</td>');
    expect(html).toContain(`<td class="n">${'6 227,447'}</td>`);
    expect(html).toContain('Nombre de salariés : 12');
    const csv = core.toCsv(j.lignes.concat([{ name: 'Total', ...j.totaux, jours: '' } as unknown as Ligne]), core.colonnesCsvJournal()).replace(/^\ufeff/, '').split('\r\n');
    expect(csv[0]).toBe('N°;Salarié;N° CNSS;Jours payés;Salaire de base;Heures supplémentaires;Primes et indemnités;Salaire brut;Salaire cotisable;CNSS salarié;Salaire imposable;Impôt sur le revenu;Contribution sociale de solidarité;Salaire net;Autres retenues;Net à payer;Taxe de formation professionnelle;FOPROLOS;Accident du travail;CNSS patronale');
    expect(csv[4]).toMatch(/^4;Salarié 4;;19,5;459,000;0,000;60,000;519,000;519,000;50,239;468,761;0,783;2,109;465,869;0,000;465,869;10,380;5,190;2,595;88,593$/);
    expect(csv[13]).toMatch(/^;Total;;;6615,205;0,000;656,370;/);
    expect(csv[13]).toContain(';6227,447;');
  });

  it('l\'état récapitulatif du 3e trimestre : les cotisations sur le total des salaires, au taux du régime, comme l\'état réel ; le total en lettres', () => {
    const d = septembre();
    // Juillet et août : deux bulletins dont les salaires complètent ceux de l'état réel du trimestre (21 847,693 de plus
    // que septembre).
    const s1 = d.employees[0] as Fiche;
    for (const [mois, brut] of [[7, 10923.852], [8, 10923.841]] as const) {
      d.payslips.push(bulletin(s1, 2026, mois, { gross: brut, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] }));
    }
    const e = core.etatRecapitulatifCnss(d, { cnss: '1234567-01', cnssCode: '' }, 2026, 3);
    expect(e.salaires).toBe(Number(ETAT_CNSS.salaires));
    expect(e.lignes.map((l) => [l.cle, l.taux, l.montant])).toEqual([
      ['secu', Number(ETAT_CNSS.secu.taux), Number(ETAT_CNSS.secu.montant)],
      ['accident', Number(ETAT_CNSS.accident.taux), Number(ETAT_CNSS.accident.montant)],
    ]);
    expect(e.total).toBe(Number(ETAT_CNSS.total));
    // La somme des bulletins, arrondis un par un, n'est pas l'état : l'écart se dit (et discrimine le calcul sur le total).
    const parBulletins = r3(d.payslips.reduce((a, p) => a + (p.computed.cnssEmployee ?? 0) + (p.computed.cnssEmployer ?? 0) + (p.computed.accident ?? 0), 0));
    expect(e.bulletins).toBe(parBulletins);
    expect(e.bulletins).toBe(core.cnssDeclaration(d, 2026, 3).total);
    expect(e.ecart).toBe(r3(e.total - parBulletins));
    expect(e.ecart).not.toBe(0);
    expect(e.enLettres).toBe('Vingt-neuf mille cent dix-neuf dinars et deux cent soixante-huit millimes');
    expect([e.employeur, e.code, e.salaries]).toEqual(['1234567-01', '00', 12]);

    const html = lu(core.etatRecapitulatifCnssHtml(d, { name: 'Entreprise d\'essai', address: 'Une rue', cnss: '1234567-01', cnssCode: '' }, 2026, 3));
    expect(html).toContain('<h1>État récapitulatif des salaires déclarés</h1>');
    expect(html).toMatch(/Numéro d'employeur<\/span><b>1234567-01<\/b>/);
    expect(html).toMatch(/Code d'exploitation<\/span><b>00<\/b>/);
    expect(html).toMatch(/Trimestre<\/span><b>3<\/b>/);
    expect(html).toContain('<div class="gros">29 119,268</div>');
    expect(html).toContain('<td>Sécurité sociale</td><td class="n">26,75</td><td class="n">7 789,404</td>');
    expect(html).toContain('<td>Accidents du travail et maladies professionnelles</td><td class="n">0,50</td><td class="n">145,596</td>');
    expect(html).toContain('<td colspan="2">Total</td><td class="n">7 935,000</td>');
    expect(html).toContain('arrêtée à la somme de : <b>Vingt-neuf mille cent dix-neuf dinars et deux cent soixante-huit millimes</b>');
    // Les pénalités et le montant à payer restent à remplir à la main.
    expect(html).toContain('<span>Montant à payer</span><span></span>');

    // L'accident du travail aussi se calcule sur le total : trois bulletins de 333,333 en retiennent chacun 1,667
    // (5,001) ; l'état dit 999,999 × 0,5 % = 5,000.
    const trois = [1, 2, 3].map((i) => ({ id: `t${i}`, name: `Salarié T${i}`, grossSalary: 333.333, contract: 'cdi', hireDate: '2020-01-01' }) as Fiche);
    const t = { employees: trois, payslips: trois.map((e) => bulletin(e, 2026, 2, { gross: 333.333, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] })), payrollSettings: REGLAGES };
    expect(t.payslips.map((p) => p.computed.accident)).toEqual([1.667, 1.667, 1.667]);
    expect(core.etatRecapitulatifCnss(t, {}, 2026, 1).lignes.map((l) => [l.cle, l.montant])).toEqual([['secu', 267.5], ['accident', 5]]);
  });

  it('un taux qui n\'est pas le même sur tous les bulletins du trimestre : l\'état reprend la somme des bulletins, sans taux', () => {
    const d = septembre();
    const s1 = d.employees[0] as Fiche;
    d.payslips.push(bulletin(s1, 2026, 8, { gross: 800, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] }, { ...REGLAGES, cnssEmployer: 0, accidentRate: 0 }));
    const e = core.etatRecapitulatifCnss(d, {}, 2026, 3);
    const cn = core.cnssDeclaration(d, 2026, 3) as { employee: number; employer: number; accident: number; base: number; total: number };
    expect(e.lignes.map((l) => [l.cle, l.taux, l.montant])).toEqual([['secu', null, r3(cn.employee + cn.employer)], ['accident', null, cn.accident]]);
    expect([e.total, e.ecart]).toEqual([cn.total, 0]);
    expect(e.code).toBe('00');
    expect(lu(core.etatRecapitulatifCnssHtml(d, {}, 2026, 3))).toContain('<td>Sécurité sociale</td><td class="n">—</td>');
  });

  it('la déclaration mensuelle reprend les montants du journal du même mois (IRPP, CSS, TFP, FOPROLOS) et leurs bases, à l\'échéance du calendrier fiscal', () => {
    const d = septembre();
    const j = core.journalDePaie(d, 2026, 9);
    const dm = core.declarationMensuelleSalaires(d, 2026, 9);
    expect(dm.salaries).toBe(12);
    // Deux chemins, un chiffre : le journal, et les bulletins additionnés ici.
    const somme = (k: string) => r3(d.payslips.reduce((a, p) => a + (p.computed[k] ?? 0), 0));
    expect(dm.lignes.map((l) => [l.cle, l.montant])).toEqual([['irpp', j.totaux.irpp], ['css', j.totaux.css], ['tfp', j.totaux.tfp], ['foprolos', j.totaux.foprolos]]);
    expect(dm.lignes.map((l) => l.montant)).toEqual([somme('irpp'), somme('css'), somme('tfp'), somme('foprolos')]);
    expect(dm.lignes.map((l) => l.montant)).toEqual([311.518, 28.722, 145.432, 72.716]);
    expect(dm.lignes.map((l) => [l.taux, l.bareme ?? false])).toEqual([[null, true], [0.5, false], [2, false], [1, false]]);
    expect(dm.lignes.map((l) => l.base)).toEqual([j.totaux.imposable, r3(d.payslips.reduce((a, p) => a + r3((p.computed.annualTaxable ?? 0) / 12), 0)), 7271.575, 7271.575]);
    expect(dm.total).toBe(558.388);
    // L'échéance : le 28 du mois suivant par défaut ; le jour réglé au calendrier ; en janvier pour décembre ; bornée au mois.
    expect(dm.dueDate).toBe('2026-10-28');
    expect(core.declarationMensuelleSalaires({ ...d, fiscalDeadlines: [{ id: 'tva', day: 15 }] }, 2026, 9).dueDate).toBe('2026-10-15');
    expect(core.declarationMensuelleSalaires(d, 2026, 12).dueDate).toBe('2027-01-28');
    expect(core.declarationMensuelleSalaires({ ...d, fiscalDeadlines: [{ id: 'tva', day: 31 }] }, 2026, 1).dueDate).toBe('2026-02-28');
    // Un mois sans bulletin n'ajoute rien.
    const vide = core.declarationMensuelleSalaires(d, 2026, 8);
    expect([vide.salaries, vide.total]).toEqual([0, 0]);
  });
});
