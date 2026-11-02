// 1.258.0 — les réglages du pointage qui restaient « à venir » (docs/paie-ecarts-maquette.md, lot 1.258.0) :
//   - « Le mois se valide quand chaque journée l'est » : éteint par défaut (la journée validée est un geste de l'écran) ;
//   - la retenue des retards : éteinte par défaut ; allumée, les minutes du mois au taux horaire de la fiche, en une ligne
//     imposable négative du bulletin (le brut baisse, la CNSS et l'impôt suivent), jamais deux fois ;
//   - les heures de nuit : sans plage réglée, rien ; une plage qui passe minuit, lue sur les badges ou, sans badge, sur
//     l'horaire de l'équipe ; la majoration en fait une prime imposable, sans majoration elles se comptent seulement.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, unknown>;
type Ligne = { label: string; amount: number; taxable: boolean; retard?: boolean; nuit?: boolean; minutes?: number; heures?: number };
type Pointage = { jours: { jour: number; code: string; repos: boolean; retard?: number }[]; retards: number };
const C = ecranDeLaPlateforme('compta.js') as {
  pointageDuMois: (d: Obj, e: Obj, y: number, m: number) => Pointage;
  poserRetard: (d: Obj, e: Obj, y: number, m: number, j: number, mn: number) => boolean;
  poserPointage: (d: Obj, e: Obj, y: number, m: number, j: number, c: string) => boolean;
  lireBadges: (t: string) => { passages: { badge: string; iso: string; heure: string }[] };
  importerBadges: (d: Obj, p: unknown[], ecrire: boolean) => unknown;
  retardsDuMois: (d: Obj, e: Obj, y: number, m: number, p?: Pointage) => Ligne[];
  reprisePointage: (i: Obj, p: Pointage, hs: Ligne[], rt: Ligne[]) => { bonuses: Ligne[] };
  heuresDeNuitDuMois: (d: Obj, e: Obj, y: number, m: number, p?: Pointage) => { minutes: number; reglee: boolean; lignes: Ligne[] };
  computePayslip: (e: Obj, i: Obj, s: Obj) => Record<string, number>;
  baremesPaie: (r: unknown) => Obj;
  round3: (n: number) => number;
};
const core = ecranDeLaPlateforme('core.js') as { payslipInputFor: (d: Obj, e: Obj, y: number, m: number) => Obj & { bonuses: Ligne[] } };

const fournil = { id: 'q1', nom: 'Le fournil, la nuit', debut: '03:00', fin: '11:00', jours: [1, 2, 3, 4, 5, 6], pointe: 'pointeuse' };
const donnees = (ps: Obj = {}): Obj => ({
  payrollSettings: { equipes: [fournil], ...ps },
  employees: [
    { id: 'mt', name: 'Mourad Trabelsi', hireDate: '2019-04-01', equipeId: 'q1', badge: '1001', grossSalary: 1450.375, contract: 'cdi', active: true },
    { id: 'sa', name: 'Salma Ayari', hireDate: '2021-01-04', grossSalary: 700.75, contract: 'cdi', active: true },
  ],
  timesheets: [], leaves: [], payslips: [], advances: [],
});
const emp = (d: Obj, id: string) => (d.employees as Obj[]).find((e) => e.id === id) as Obj;

describe('la paie 1.258.0 : la journée validée, les retards retenus, les heures de nuit', () => {
  it('par défaut, rien ne change : le mois se valide d\'un coup, aucun retard retenu, aucune heure de nuit comptée', () => {
    const d = donnees(), e = emp(d, 'mt');
    const st = C.baremesPaie(d.payrollSettings);
    expect([st.joursAValider, st.retenirRetards, st.nuitDebut, st.nuitFin, st.nuitMajoration]).toEqual([false, false, '', '', 0]);
    C.poserRetard(d, e, 2026, 10, 20, 35);
    expect(C.retardsDuMois(d, e, 2026, 10)).toEqual([]);
    expect(C.heuresDeNuitDuMois(d, e, 2026, 10)).toEqual({ minutes: 0, lignes: [], reglee: false });
    expect(core.payslipInputFor(d, e, 2026, 10).bonuses.filter((b) => b.retard || b.nuit)).toEqual([]);
  });

  it('les retards retenus : au taux horaire de la fiche, une ligne imposable qui baisse le brut, jamais deux fois', () => {
    const d = donnees({ retenirRetards: true }), e = emp(d, 'mt');
    C.poserRetard(d, e, 2026, 10, 20, 35);
    C.poserRetard(d, e, 2026, 10, 22, 12);
    const L = C.retardsDuMois(d, e, 2026, 10);
    // 47 minutes au prix d'une heure de 1 450,375 / 208 h : 5,462.
    expect(L).toEqual([{ label: 'Retenue pour retards : 47 min', amount: -5.462, taxable: true, retard: true, minutes: 47 }]);
    const i = core.payslipInputFor(d, e, 2026, 10);
    expect(i.bonuses.filter((b) => b.retard).map((b) => b.amount)).toEqual([-5.462]);
    const sans = C.computePayslip(e, { ...i, bonuses: i.bonuses.filter((b) => !b.retard) }, C.baremesPaie(d.payrollSettings));
    const avec = C.computePayslip(e, i, C.baremesPaie(d.payrollSettings));
    expect(C.round3((sans.gross ?? 0) - (avec.gross ?? 0))).toBe(5.462);
    expect(avec.cnssEmployee).toBeLessThan(sans.cnssEmployee ?? 0);
    // La reprise d'une saisie qui porte déjà la ligne (un bulletin refait) ne la double pas.
    const p = C.pointageDuMois(d, e, 2026, 10);
    expect(C.reprisePointage(i, p, [], C.retardsDuMois(d, e, 2026, 10, p)).bonuses.filter((b) => b.retard)).toHaveLength(1);
  });

  it('les heures de nuit : la plage qui passe minuit, les badges d\'abord, l\'horaire de l\'équipe sinon, la majoration', () => {
    const d = donnees({ nuitDebut: '21:00', nuitFin: '05:00' }), e = emp(d, 'mt');
    // Octobre 2026 : 27 jours du lundi au samedi ; le 19, Mourad badge à 02:30 (2 h 30 de nuit), le 20 il est en congé.
    C.importerBadges(d, C.lireBadges('1001;19/10/2026;02:30\n1001;19/10/2026;11:00').passages, true);
    C.poserPointage(d, e, 2026, 10, 20, 'C');
    const n = C.heuresDeNuitDuMois(d, e, 2026, 10);
    expect([n.reglee, n.minutes, n.lignes]).toEqual([true, 25 * 120 + 150, []]); // sans majoration : comptées, rien sur le bulletin
    // Sans équipe ni badge : aucun horaire à lire, rien ne se compte.
    expect(C.heuresDeNuitDuMois(d, emp(d, 'sa'), 2026, 10).minutes).toBe(0);
    const m = donnees({ nuitDebut: '21:00', nuitFin: '05:00', nuitMajoration: 25 }), em = emp(m, 'mt');
    C.importerBadges(m, C.lireBadges('1001;19/10/2026;02:30\n1001;19/10/2026;11:00').passages, true);
    C.poserPointage(m, em, 2026, 10, 20, 'C');
    // 52,5 h à +25 % du prix d'une heure (1 450,375 / 208) : 91,520.
    expect(C.heuresDeNuitDuMois(m, em, 2026, 10).lignes).toEqual([{ label: 'Heures de nuit : 52,5 h à +25 %', amount: 91.52, taxable: true, nuit: true, heures: 52.5 }]);
    expect(core.payslipInputFor(m, em, 2026, 10).bonuses.filter((b) => b.nuit).map((b) => b.amount)).toEqual([91.52]);
    // Une plage de jour (06:00–09:00) ne mord sur le fournil que de 06:00 à 09:00 : 3 h par jour.
    const j = donnees({ nuitDebut: '06:00', nuitFin: '09:00' });
    expect(C.heuresDeNuitDuMois(j, emp(j, 'mt'), 2026, 10).minutes).toBe(27 * 180);
  });
});
