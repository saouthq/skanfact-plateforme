// 16 § 10.1, urgence 2 (nuit du 03/11/2026) : le pointage se fusionne case par case. Il n'était pas dans la fusion
// (`mergeData`) : dès qu'un enregistrement était refusé pour un conflit — même sur un client changé par un collègue —, le
// poste reprenait le pointage du serveur et perdait le sien sans un mot ; et deux postes qui ouvraient le même mois en
// créaient chacun un objet, dont un seul se lisait. L'ancêtre (ce que le poste avait eu du serveur) distingue une case
// effacée d'une case jamais posée.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Fiche = Record<string, unknown>;
type Pointage = { id: string; employeeId: string; year: number; month: number; jours: Record<string, string>; hs: Record<string, number>; badges?: Record<string, { h: string[] }> };
type Jour = { iso: string; le: string; rouvertLe?: string };
type Dossier = { employees: Fiche[]; clients: { id: string; name: string }[]; payrollSettings: Fiche; timesheets: Pointage[]; leaves: Fiche[];
  joursValides: Jour[]; pointageVersions: Fiche[]; pointageOuverts: string[]; badgeImports: Fiche[]; conflictArchive?: { record: unknown }[]; syncWrittenAt?: number };
type Fusion = { data: Dossier; conflicts: { kind: string; label: string }[]; counts: { conflicts: number } };
const C = ecranDeLaPlateforme('core.js') as {
  mergeData: (mine: Fiche, theirs: Fiche, anc?: Fiche) => Fusion;
  poserPointage: (d: Fiche, e: Fiche, y: number, m: number, j: number, code: string) => boolean;
  poserHeuresSup: (d: Fiche, e: Fiche, y: number, m: number, maj: number, h: number) => boolean;
  poserHeuresSupDuJour: (d: Fiche, e: Fiche, y: number, m: number, j: number, maj: number, h: number) => boolean;
  pointageDuMois: (d: Fiche, e: Fiche, y: number, m: number) => { absences: number };
  heuresSupDuMois: (d: Fiche, e: Fiche, y: number, m: number) => { amount: number }[];
};
const copie = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const premier = <T>(l: T[]): T => { const x = l[0]; if (x === undefined) throw new Error('liste vide'); return x; };
const ali: Fiche = { id: 'ali', name: 'Ali Ben Salah', hireDate: '2020-01-01', grossSalary: 1450.375, contract: 'cdi', active: true };
const dossier = (): Dossier => ({ employees: [ali], clients: [{ id: 'c1', name: 'Chantier Ennasr' }], payrollSettings: { hsMaj1: 25, hsMaj2: 50, heuresMois: 208 },
  timesheets: [], leaves: [], joursValides: [], pointageVersions: [], pointageOuverts: [], badgeImports: [] });
// Le serveur gagne toujours sur la plateforme (pont.js : `syncWrittenAt` de la relecture).
const serveur = (d: Dossier): Dossier => Object.assign(d, { syncWrittenAt: Date.now() });

describe('la fusion du pointage (16 § 10.1, urgence 2)', () => {
  it('un poste note pendant qu\'un autre change un client : la journée, les heures sup et la journée validée restent ; seul le client est en conflit', () => {
    const anc = dossier(); C.poserPointage(anc, ali, 2026, 11, 2, 'M');
    const ici = copie(anc); C.poserPointage(ici, ali, 2026, 11, 5, 'A'); C.poserHeuresSupDuJour(ici, ali, 2026, 11, 6, 25, 2.5);
    premier(ici.clients).name = 'Chantier Ennasr (ici)'; ici.joursValides = [{ iso: '2026-11-04', le: '2026-11-04T18:00:00Z' }];
    const srv = serveur(copie(anc)); premier(srv.clients).name = 'Chantier Ennasr — lot B';
    const m = C.mergeData(ici, srv, anc);
    expect(m.data.timesheets.map((t) => [t.jours, t.hs])).toEqual([[{ 2: 'M', 5: 'A' }, { 25: 2.5 }]]);
    expect(C.pointageDuMois(m.data, ali, 2026, 11).absences).toBe(1);
    expect(m.data.joursValides.map((x) => x.iso)).toEqual(['2026-11-04']);
    expect(m.conflicts.map((c) => c.kind)).toEqual(['clients']);
  });

  it('deux postes notent le même mois : chaque journée reste, les heures sup du mois s\'additionnent (6,75 h, 58,834 DT)', () => {
    const anc = dossier(); C.poserPointage(anc, ali, 2026, 11, 2, 'M'); C.poserHeuresSup(anc, ali, 2026, 11, 25, 3.5);
    const a = copie(anc); C.poserPointage(a, ali, 2026, 11, 5, 'A'); C.poserHeuresSupDuJour(a, ali, 2026, 11, 27, 25, 2);
    const b = serveur(copie(anc)); C.poserPointage(b, ali, 2026, 11, 9, 'D'); C.poserHeuresSupDuJour(b, ali, 2026, 11, 28, 25, 1.25);
    const m = C.mergeData(a, b, anc);
    expect(m.data.timesheets.map((t) => [t.jours, t.hs])).toEqual([[{ 2: 'M', 5: 'A', 9: 'D' }, { 25: 6.75 }]]);
    expect(C.pointageDuMois(m.data, ali, 2026, 11).absences).toBe(1.5);
    // 6,75 h à +25 % de 1 450,375 / 208 h : aucune des deux journées oubliée (4,75 h ou 5,5 h sinon).
    expect(C.heuresSupDuMois(m.data, ali, 2026, 11).map((x) => x.amount)).toEqual([58.834]);
    expect(m.counts.conflicts).toBe(0);
  });

  it('une case effacée d\'un côté reste effacée ; sans ancêtre, ce qui est posé l\'emporte', () => {
    const anc = dossier(); C.poserPointage(anc, ali, 2026, 11, 2, 'A'); C.poserPointage(anc, ali, 2026, 11, 3, 'C');
    const a = copie(anc); C.poserPointage(a, ali, 2026, 11, 2, 'P');
    const b = serveur(copie(anc)); C.poserPointage(b, ali, 2026, 11, 10, 'M');
    expect(premier(C.mergeData(a, b, anc).data.timesheets).jours).toEqual({ 3: 'C', 10: 'M' });
    expect(premier(C.mergeData(a, b).data.timesheets).jours).toEqual({ 2: 'A', 3: 'C', 10: 'M' });
  });

  it('la même case changée des deux côtés : la version du serveur reste, l\'autre est mise de côté et dite ; les passages de la pointeuse restent tous', () => {
    const anc = dossier(); C.poserPointage(anc, ali, 2026, 11, 2, 'M');
    const a = copie(anc); C.poserPointage(a, ali, 2026, 11, 5, 'A'); premier(a.timesheets).badges = { 12: { h: ['07:58', '17:02'] } };
    const b = serveur(copie(anc)); C.poserPointage(b, ali, 2026, 11, 5, 'C'); premier(b.timesheets).badges = { 12: { h: ['07:58', '12:30'] } };
    const m = C.mergeData(a, b, anc);
    expect(premier(m.data.timesheets).jours).toEqual({ 2: 'M', 5: 'C' });
    expect(premier(m.data.timesheets).badges).toEqual({ 12: { h: ['07:58', '12:30', '17:02'] } });
    expect(m.conflicts.map((c) => [c.kind, c.label])).toEqual([['pointage', 'Ali Ben Salah, le 05/11/2026']]);
    expect(m.data.conflictArchive?.slice(-1)[0]?.record).toEqual({ champ: 'jours', jour: '5', valeur: 'A' });
  });

  it('deux postes ouvrent le même mois : un seul objet ; deux anciens objets du même mois se replient', () => {
    const a = dossier(); C.poserPointage(a, ali, 2026, 12, 3, 'A');
    const b = serveur(dossier()); C.poserPointage(b, ali, 2026, 12, 7, 'C');
    expect(premier(a.timesheets).id).toBe(premier(b.timesheets).id);
    expect(C.mergeData(a, b, dossier()).data.timesheets.map((t) => t.jours)).toEqual([{ 3: 'A', 7: 'C' }]);
    const a2 = dossier(); a2.timesheets = [{ id: 'x1', employeeId: 'ali', year: 2026, month: 12, jours: { 3: 'A' }, hs: {} }];
    const b2 = serveur(dossier()); b2.timesheets = [{ id: 'y1', employeeId: 'ali', year: 2026, month: 12, jours: { 7: 'C' }, hs: {} }];
    expect(C.mergeData(a2, b2, dossier()).data.timesheets.map((t) => [t.id, t.jours])).toEqual([['y1', { 3: 'A', 7: 'C' }]]);
  });

  it('les versions, les imports, les mois rouverts et les journées validées se fusionnent sans rien ressusciter', () => {
    const anc = dossier(); anc.pointageVersions = [{ id: 'v1', ym: '2026-10', le: '2026-11-01T08:00:00Z' }]; anc.pointageOuverts = []; anc.badgeImports = [];
    anc.joursValides = [{ iso: '2026-11-04', le: '2026-11-04T18:00:00Z' }, { iso: '2026-11-05', le: '2026-11-05T18:00:00Z' }];
    const a = copie(anc); a.pointageOuverts = ['2026-10']; a.badgeImports = [{ id: 'i1', le: '2026-11-06T09:00:00Z' }];
    a.joursValides[0] = { ...premier(a.joursValides), rouvertLe: '2026-11-06T10:00:00Z' };
    const b = serveur(copie(anc)); b.pointageVersions.push({ id: 'v2', ym: '2026-09', le: '2026-11-06T11:00:00Z' });
    b.joursValides = b.joursValides.filter((x) => x.iso !== '2026-11-05');
    const m = C.mergeData(a, b, anc);
    expect(m.data.pointageVersions.map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(m.data.badgeImports.map((v) => v.id)).toEqual(['i1']);
    expect(m.data.pointageOuverts).toEqual(['2026-10']);
    expect(m.data.joursValides).toEqual([{ iso: '2026-11-04', le: '2026-11-04T18:00:00Z', rouvertLe: '2026-11-06T10:00:00Z' }]);
  });

  it('un rôle qui ne voit pas le pointage : la fusion n\'invente aucune partie', () => {
    const m = C.mergeData({ clients: [{ id: 'c1', name: 'x' }] }, { clients: [{ id: 'c1', name: 'y' }], syncWrittenAt: Date.now() }, {});
    expect(['timesheets', 'joursValides', 'pointageVersions', 'pointageOuverts', 'badgeImports'].filter((k) => k in m.data)).toEqual([]);
  });
});
