// La déclaration annuelle d'employeur au Cabinet (1.73.0 ; docs/paie.md, « La déclaration annuelle d'employeur au Cabinet »).
// L'état des salaires de l'année par salarié vit dans le moteur commun (compta.js) : l'entreprise (core.js, `employerAnnual`)
// et le Cabinet le lisent par la même fonction. Les masses du livre se confrontent aux bulletins ; les retenues sont celles de
// l'exercice — ce que les écritures ont porté au crédit du compte —, plus son solde, que les versements au Trésor vident.
// Les données discriminent : des montants au millime, deux salariés aux mois différents, un bulletin d'une autre année, un
// mois contre-passé puis réécrit, les à-nouveaux de l'an passé, deux versements au Trésor, un brouillard.

import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Objet = Record<string, unknown>;
type Ligne = { employeeId: string; name: string; cin: string; months: number; gross: number; cnss_: number; irpp: number; css: number; net: number; taxable: number };
type Salaires = { year: number; employees: number; rows: Ligne[]; gross: number; cnss: number; irpp: number; css: number; net: number };
type Case = { id: string; montant: number | null; raison?: string };
type Ecart = { id: string; livre: number; bulletins: number; ecart: number; cause: string };
const compta = ecranDeLaPlateforme('compta.js') as {
  salairesDeLAnnee: (d: Objet, annee: number) => Salaires;
  COLONNES_SALAIRES_ANNEE: [string, string, boolean?][];
  employeurAnnuel: (livre: Objet, opts: Objet) => Objet & { cases: Case[] };
  ecartsEmployeur: (employeur: Objet, salaires: Salaires) => Ecart[];
};
const core = ecranDeLaPlateforme('core.js') as { employerAnnual: (d: Objet, annee: number, societe: Objet) => Salaires & { rows: Ligne[] }; COLONNES_SALAIRES_ANNEE: unknown };

const calcul = (gross: number, cnssEmployee: number, irpp: number, css: number, net: number) => ({ gross, cnssEmployee, irpp, css, net, annualTaxable: 12 * (gross - cnssEmployee) });
const un = calcul(1301.25, 119.065, 85.417, 6.506, 1090.262);
const deux = calcul(2345.678, 214.63, 301.234, 11.728, 1818.086);
const bulletin = (employeeId: string, year: number, month: number, computed: Objet) => ({ id: `${employeeId}-${year}-${month}`, employeeId, year, month, computed });
const paie = (): Objet => ({
  employees: [{ id: 's2', name: 'Salarié Numéro Deux', cin: '', position: 'Livreur' }, { id: 's1', name: 'Salariée Numéro Une', cin: '07123456', cnss: '12345678-90', position: 'Comptable' }],
  payslips: [bulletin('s1', 2026, 1, un), bulletin('s1', 2026, 2, un), bulletin('s2', 2026, 2, deux), bulletin('s1', 2026, 3, un), bulletin('s2', 2026, 3, deux),
    // Décembre de l'an passé : une autre déclaration.
    bulletin('s1', 2025, 12, calcul(9999.999, 1, 1, 1, 1))],
  purchases: [], suppliers: [],
});

// Le livre de l'exercice : la paie de chaque mois (le brut au 640, l'IRPP et la contribution sociale au 4321), mars passé
// faux puis contre-passé et réécrit, les à-nouveaux, deux versements au Trésor, une retenue sur fournisseur et son versement,
// un brouillard d'avril.
let n = 0;
const ecriture = (date: string, journal: string, lignes: [string, number, number][], plus: Objet = {}) => ({
  id: plus.id ?? `e${++n}`, numero: n, date, journal, piece: `P${n}`, libelle: journal, statut: 'validee',
  lignes: lignes.map(([compte, debit, credit]) => ({ compte, debit, credit, libelle: '' })), ...plus,
});
const moisDePaie = (date: string, brut: number, retenu: number, plus: Objet = {}) => ecriture(date, 'PAIE', [['640', brut, 0], ['4321', 0, retenu], ['425', 0, brut - retenu]], plus);
function livre(variante: { sansMarsReecrit?: boolean; chargeALaMain?: boolean } = {}): Objet {
  const ecritures = [
    ecriture('2026-01-01', 'AN', [['120', 77.777, 0], ['4321', 0, 77.777]]),
    moisDePaie('2026-01-31', 1301.25, 91.923),
    moisDePaie('2026-02-28', 3646.928, 404.885),
    ecriture('2026-02-15', 'BQ', [['4321', 91.923, 0], ['532', 0, 91.923]]),
    moisDePaie('2026-03-31', 3000, 300, { id: 'mars', statut: 'contrepassee' }),
    moisDePaie('2026-03-31', -3000, -300, { contrepasseDe: 'mars' }),
    ...(variante.sansMarsReecrit ? [] : [moisDePaie('2026-03-31', 3646.928, 404.885)]),
    ecriture('2026-03-15', 'BQ', [['4321', 404.885, 0], ['532', 0, 404.885]]),
    ecriture('2026-02-20', 'BQ', [['401', 1000, 0], ['4322', 0, 15], ['532', 0, 985]]),
    ecriture('2026-03-15', 'BQ', [['4322', 15, 0], ['532', 0, 15]]),
    moisDePaie('2026-04-30', 3646.928, 404.885, { statut: 'brouillard' }),
    ...(variante.chargeALaMain ? [ecriture('2026-03-31', 'OD', [['641', 123.456, 0], ['532', 0, 123.456]])] : []),
  ];
  // Le miroir d'une contre-passation porte les montants en sens inverse : un débit négatif n'existe pas, il se retourne.
  for (const e of ecritures) e.lignes = e.lignes.map((l) => (l.debit < 0 || l.credit < 0 ? { ...l, debit: -l.credit, credit: -l.debit } : l));
  return { exercice: { annee: 2026, du: '2026-01-01', au: '2026-12-31', clos: false }, ecritures, audit: [] };
}

describe('la déclaration annuelle d\'employeur, dans le moteur commun', () => {
  it('les salaires de l\'année par salarié : ses bulletins de l\'année, la somme de chaque colonne', () => {
    const s = compta.salairesDeLAnnee(paie(), 2026);
    expect(s.rows.map((r) => [r.name, r.cin, r.months, r.gross, r.cnss_, r.irpp, r.css, r.net])).toEqual([
      ['Salarié Numéro Deux', '', 2, 4691.356, 429.26, 602.468, 23.456, 3636.172],
      ['Salariée Numéro Une', '07123456', 3, 3903.75, 357.195, 256.251, 19.518, 3270.786],
    ]);
    expect(s.rows[1]?.taxable).toBe(3546.555);
    expect([s.employees, s.gross, s.cnss, s.irpp, s.css, s.net]).toEqual([2, 8595.106, 786.455, 858.719, 42.974, 6906.958]);
    expect(compta.salairesDeLAnnee(paie(), 2025).rows.map((r) => [r.name, r.months, r.gross])).toEqual([['Salariée Numéro Une', 1, 9999.999]]);
    expect(compta.salairesDeLAnnee({}, 2026)).toMatchObject({ employees: 0, rows: [], gross: 0 });
  });

  it('deux chemins, un chiffre : la déclaration de l\'entreprise compte avec la fonction du Cabinet, et exporte ses colonnes', () => {
    const entreprise = core.employerAnnual(paie(), 2026, {});
    const commune = compta.salairesDeLAnnee(paie(), 2026);
    expect(entreprise.rows).toEqual(commune.rows);
    expect([entreprise.gross, entreprise.cnss, entreprise.irpp, entreprise.css, entreprise.net]).toEqual([commune.gross, commune.cnss, commune.irpp, commune.css, commune.net]);
    expect(core.COLONNES_SALAIRES_ANNEE).toEqual(compta.COLONNES_SALAIRES_ANNEE);
    // « Net des bulletins » : la tuile « Net versé » de l'entreprise ne compte que les bulletins payés.
    expect(compta.COLONNES_SALAIRES_ANNEE.map((c) => c[1])).toEqual(['Salarié', 'CIN', 'N° CNSS', 'Mois payés', 'Brut annuel', 'CNSS retenue', 'IRPP retenu', 'Solidarité', 'Net des bulletins']);
  });

  it('les retenues de l\'exercice, pas le solde du compte : hors à-nouveaux et versements au Trésor, une contre-passation retranchée', () => {
    const cases = Object.fromEntries(compta.employeurAnnuel(livre(), {}).cases.map((c) => [c.id, c.montant]));
    // Le brut des trois mois (mars, passé faux, contre-passé puis réécrit) ; les retenues des trois mois ; la retenue sur le
    // fournisseur, versée au Trésor en mars. Le solde du 4321 aurait dit 482,662 (les à-nouveaux et mars, moins rien de
    // versé en mars), celui du 4322 rien.
    expect(cases).toEqual({ salaires: 8595.106, charges: null, irpp: 901.693, rsFournisseurs: 15 });
    expect('raisonNominatif' in compta.employeurAnnuel(livre(), {})).toBe(false);
  });

  it('les masses du livre confrontées aux bulletins : un écart se dit, dans son sens, avec ce qui le fait d\'ordinaire', () => {
    const salaires = compta.salairesDeLAnnee(paie(), 2026);
    expect(compta.ecartsEmployeur(compta.employeurAnnuel(livre(), {}), salaires)).toEqual([]);
    expect(compta.ecartsEmployeur(compta.employeurAnnuel(livre({ sansMarsReecrit: true }), {}), salaires)).toEqual([
      { id: 'salaires', livre: 4948.178, bulletins: 8595.106, ecart: -3646.928, cause: 'Le livre porte moins : une écriture de paie au brouillard ou pas encore passée.' },
      { id: 'irpp', livre: 496.808, bulletins: 901.693, ecart: -404.885, cause: 'Le livre porte moins : une écriture de paie au brouillard ou pas encore passée.' },
    ]);
    expect(compta.ecartsEmployeur(compta.employeurAnnuel(livre({ chargeALaMain: true }), {}), salaires)).toEqual([
      { id: 'salaires', livre: 8718.562, bulletins: 8595.106, ecart: 123.456, cause: 'Le livre porte plus : une charge de personnel saisie à la main au 64.' },
    ]);
  });
});
