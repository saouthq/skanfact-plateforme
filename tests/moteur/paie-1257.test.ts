// 1.257.0 — le pointage tel que la maquette (docs/paie-ecarts-maquette.md, lot 1.257.0) :
//   - les équipes : leurs jours de travail font les jours de repos de ceux qui en sont ;
//   - les jours fériés de la liste se posent d'eux-mêmes (payés), jamais sur un jour de repos, et la main gagne ;
//   - la pointeuse : le fichier se lit (formats courants, lignes illisibles comptées), chaque passage va à la fiche qui porte
//     ce n° de badge, un passage déjà importé s'ignore, un badge inconnu se dit ;
//   - la journée lue sur les badges : le retard dès le seuil réglé, ce qui passe la fin du planning (arrondi au pas réglé) ;
//   - les anomalies : une entrée sans sortie, des jours de travail sans badge ni justificatif.
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { lireEcran } from '../../commun/assemblage.ts';

type Obj = Record<string, unknown>;
type Jour = { jour: number; code: string; source: string; repos: boolean; retard?: number; ferie?: string; badge?: boolean };
type Compta = {
  pointageDuMois: (d: Obj, e: Obj, y: number, m: number) => { jours: Jour[]; absences: number; payes: number; retards: number };
  poserPointage: (d: Obj, e: Obj, y: number, m: number, j: number, c: string) => boolean;
  poserRetard: (d: Obj, e: Obj, y: number, m: number, j: number, mn: number) => boolean;
  lireBadges: (t: string) => { passages: { badge: string; iso: string; heure: string }[]; illisibles: number };
  importerBadges: (d: Obj, p: { badge: string; iso: string; heure: string }[], ecrire: boolean) => { lus: number; rattaches: number; deja: number; inconnus: string[]; du: string; au: string };
  journeeBadges: (d: Obj, e: Obj, iso: string) => { arrivee: string; depart: string; travaille: number; retard: number; auDela: number; sortieMain: boolean } | null;
  anomaliesPointage: (d: Obj, y: number, m: number, jour?: string) => { sorte: string; employeeId: string; jour?: number; jours?: number[]; proposee?: string }[];
  poserSortie: (d: Obj, e: Obj, y: number, m: number, j: number, h: string) => boolean;
};
const m0 = { exports: {} as unknown };
vm.runInNewContext(lireEcran('v10/compta.js'), { module: m0, exports: m0.exports, require: () => { throw new Error('rien'); }, console });
const C = m0.exports as Compta;

const fournil = { id: 'q1', nom: 'Le fournil, la nuit', debut: '03:00', fin: '11:00', jours: [1, 2, 3, 4, 5, 6], pointe: 'pointeuse', minimum: 2 };
const boutique = { id: 'q2', nom: 'La boutique', debut: '06:30', fin: '14:30', jours: [2, 3, 4, 5, 6, 0], pointe: 'main' };
const donnees = (ps: Obj = {}): Obj => ({
  payrollSettings: { equipes: [fournil, boutique], ...ps },
  employees: [
    { id: 'mt', name: 'Mourad Trabelsi', hireDate: '2019-04-01', equipeId: 'q1', badge: '1001', grossSalary: 1450.25 },
    { id: 'kz', name: 'Karim Zouari', hireDate: '2021-09-01', equipeId: 'q1', badge: '01002', grossSalary: 1100.125 },
    { id: 'nb', name: 'Nadia Ben Salem', hireDate: '2022-01-10', equipeId: 'q2', grossSalary: 900.5 },
    { id: 'sa', name: 'Salma Ayari', hireDate: '2026-10-12', grossSalary: 700.75 },
  ],
  timesheets: [], leaves: [], payslips: [],
});
const emp = (d: Obj, id: string) => (d.employees as Obj[]).find((e) => e.id === id) as Obj;
const jour = (d: Obj, id: string, y: number, m: number, j: number) => C.pointageDuMois(d, emp(d, id), y, m).jours.find((x) => x.jour === j) as Jour;

describe('la paie 1.257.0 : le pointage tel que la maquette', () => {
  it('l\'équipe fait les jours de repos : le lundi de la boutique, le dimanche du fournil, le dimanche sans équipe', () => {
    const d = donnees();
    // Le 19/10/2026 est un lundi, le 25/10 un dimanche.
    expect([jour(d, 'nb', 2026, 10, 19).repos, jour(d, 'nb', 2026, 10, 25).repos]).toEqual([true, false]);
    expect([jour(d, 'mt', 2026, 10, 19).repos, jour(d, 'mt', 2026, 10, 25).repos]).toEqual([false, true]);
    expect(jour(d, 'sa', 2026, 10, 25).repos).toBe(true); // sans équipe : les horaires de l'entreprise (repos le dimanche)
  });

  it('un férié de la liste se pose de lui-même, payé, jamais sur un jour de repos ; la main gagne', () => {
    const d = donnees({ feries: [{ date: '2026-10-15', nom: 'Fête de l\'Évacuation' }, { date: '2026-10-19', nom: 'un lundi' }] });
    const f = jour(d, 'mt', 2026, 10, 15);
    expect([f.code, f.source, f.ferie]).toEqual(['F', 'ferie', 'Fête de l\'Évacuation']);
    expect(jour(d, 'nb', 2026, 10, 19).code).toBe('R'); // le lundi de la boutique reste son repos
    expect(C.pointageDuMois(d, emp(d, 'mt'), 2026, 10).absences).toBe(0); // un férié est payé
    expect(C.poserPointage(d, emp(d, 'mt'), 2026, 10, 15, 'P')).toBe(true);
    expect(jour(d, 'mt', 2026, 10, 15).code).toBe('P');
    expect(jour(donnees(), 'mt', 2026, 10, 15).code).toBe('P'); // sans liste, rien ne s'invente
  });

  it('le fichier de la pointeuse : les deux formats de date, les zéros du badge, l\'en-tête ignoré, l\'illisible compté', () => {
    const r = C.lireBadges('Badge;Date;Heure\n01001;19/10/2026;03:02\n1002,2026-10-19 02:58:41\nn\'importe quoi\n1001;19/10/2026;25:00\n');
    expect(r.passages).toEqual([{ badge: '1001', iso: '2026-10-19', heure: '03:02' }, { badge: '1002', iso: '2026-10-19', heure: '02:58' }]);
    expect(r.illisibles).toBe(2);
  });

  it('l\'import : chaque passage à la fiche de son badge, un passage déjà lu ignoré, un badge inconnu dit, la main intacte', () => {
    const d = donnees();
    C.poserPointage(d, emp(d, 'mt'), 2026, 10, 20, 'C');
    const p = C.lireBadges('1001;19/10/2026;03:02\n1001;19/10/2026;13:05\n1002;19/10/2026;03:00\n1009;19/10/2026;06:30\n1001;20/10/2026;03:00').passages;
    const essai = C.importerBadges(d, p, false);
    expect([essai.rattaches, essai.deja, essai.inconnus, essai.du, essai.au]).toEqual([4, 0, ['1009'], '2026-10-19', '2026-10-20']);
    expect((d.timesheets as Obj[]).some((t) => t.badges)).toBe(false); // un essai n'écrit rien
    C.importerBadges(d, p, true);
    expect(C.importerBadges(d, p, false).deja).toBe(4);
    expect(jour(d, 'mt', 2026, 10, 20).code).toBe('C'); // le congé posé à la main reste
    expect(jour(d, 'mt', 2026, 10, 19).badge).toBe(true);
  });

  it('la journée lue sur les badges : le retard dès le seuil, la fin du planning dépassée, arrondie au pas réglé', () => {
    const d = donnees({ retardMinimum: 5, hsArrondi: 15 });
    C.importerBadges(d, C.lireBadges('1001;19/10/2026;03:04\n1001;19/10/2026;13:07\n1001;23/10/2026;03:05\n1001;23/10/2026;11:14').passages, true);
    const a = C.journeeBadges(d, emp(d, 'mt'), '2026-10-19');
    expect(a && [a.arrivee, a.depart, a.travaille, a.retard, a.auDela]).toEqual(['03:04', '13:07', 603, 0, 120]); // 4 min : sous le seuil ; 2 h 07 → 2 h
    const b = C.journeeBadges(d, emp(d, 'mt'), '2026-10-23');
    expect(b && [b.retard, b.auDela]).toEqual([5, 0]); // 14 min après la fin : sous le quart d'heure
    expect(jour(d, 'mt', 2026, 10, 23).retard).toBe(5);
    const sans = donnees();
    C.importerBadges(sans, C.lireBadges('1001;23/10/2026;03:01\n1001;23/10/2026;11:14').passages, true);
    const c = C.journeeBadges(sans, emp(sans, 'mt'), '2026-10-23');
    expect(c && [c.retard, c.auDela]).toEqual([1, 14]); // sans réglage : à la minute
    // Le retard noté à la main gagne sur celui de la pointeuse.
    C.poserRetard(d, emp(d, 'mt'), 2026, 10, 23, 12);
    expect(jour(d, 'mt', 2026, 10, 23).retard).toBe(12);
  });

  it('les anomalies : l\'entrée sans sortie (la fin du planning proposée), les jours sans badge ni justificatif', () => {
    const d = donnees();
    // Karim badge le 19 et le 22 ; le 20 seulement l'entrée ; rien le 21. Mourad : tout est là.
    C.importerBadges(d, C.lireBadges([
      '1002;19/10/2026;03:00', '1002;19/10/2026;11:01', '1002;20/10/2026;03:02', '1002;22/10/2026;03:00', '1002;22/10/2026;11:00',
      '1001;19/10/2026;03:00', '1001;19/10/2026;11:00', '1001;20/10/2026;03:00', '1001;20/10/2026;11:00', '1001;21/10/2026;03:00', '1001;21/10/2026;11:00', '1001;22/10/2026;03:00', '1001;22/10/2026;11:00',
    ].join('\n')).passages, true);
    const a = C.anomaliesPointage(d, 2026, 10, '2026-10-26');
    expect(a.map((x) => [x.employeeId, x.sorte, x.jour ?? x.jours, x.proposee ?? ''])).toEqual([['kz', 'sortie', 20, '11:00'], ['kz', 'sansBadge', [21], '']]);
    // La sortie posée à la main règle la première ; un congé posé règle la seconde.
    expect(C.poserSortie(d, emp(d, 'kz'), 2026, 10, 20, '11:00')).toBe(true);
    C.poserPointage(d, emp(d, 'kz'), 2026, 10, 21, 'C');
    expect(C.anomaliesPointage(d, 2026, 10, '2026-10-26')).toEqual([]);
    const j = C.journeeBadges(d, emp(d, 'kz'), '2026-10-20');
    expect(j && [j.depart, j.sortieMain, j.travaille]).toEqual(['11:00', true, 478]);
  });
});
