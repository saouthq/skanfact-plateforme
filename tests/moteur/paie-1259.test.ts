// 1.259.0 — la refonte du pointage (docs/maquettes/pointage.html) : les heures sup notées sur UNE journée (« La journée »)
// s'ajoutent à celles du mois de la même majoration — c'est le total du mois que le bulletin paie —, se relisent jour par
// jour, se remplacent et se retirent sans jamais faire descendre le mois sous zéro ni toucher une autre majoration.
import { describe, expect, it } from 'vitest';
import { ecranDeLaPlateforme } from './v10.ts';

type Obj = Record<string, unknown>;
const C = ecranDeLaPlateforme('compta.js') as {
  heuresSupDuJour: (d: Obj, e: Obj, y: number, m: number, j: number) => { majoration: number; heures: number } | null;
  poserHeuresSupDuJour: (d: Obj, e: Obj, y: number, m: number, j: number, maj: number, h: number) => boolean;
  poserHeuresSup: (d: Obj, e: Obj, y: number, m: number, maj: number, h: number) => boolean;
  heuresSupDuMois: (d: Obj, e: Obj, y: number, m: number) => { hs: number; heures: number; amount: number }[];
  pointageDuMois: (d: Obj, e: Obj, y: number, m: number) => { hs: Record<string, number> };
};
const core = ecranDeLaPlateforme('core.js') as { payslipInputFor: (d: Obj, e: Obj, y: number, m: number) => Obj & { bonuses: { amount: number; hs?: number }[] } };

const donnees = (): Obj => ({
  payrollSettings: { hsMaj1: 25, hsMaj2: 50, heuresMois: 208 },
  employees: [{ id: 'mt', name: 'Mourad Trabelsi', hireDate: '2019-04-01', endDate: '2026-11-20', grossSalary: 1450.375, contract: 'cdi', active: true }],
  timesheets: [], leaves: [], payslips: [], advances: [],
});
const emp = (d: Obj) => (d.employees as Obj[])[0] as Obj;

describe('la paie 1.259.0 : les heures sup d\'une journée', () => {
  it('s\'ajoutent au mois, se relisent, se remplacent et se retirent', () => {
    const d = donnees(), e = emp(d);
    // 3,5 h déjà notées pour le mois (à la main, la grille) : le jour s'y ajoute.
    C.poserHeuresSup(d, e, 2026, 10, 25, 3.5);
    expect(C.poserHeuresSupDuJour(d, e, 2026, 10, 27, 25, 2)).toBe(true);
    expect(C.heuresSupDuJour(d, e, 2026, 10, 27)).toEqual({ majoration: 25, heures: 2 });
    expect(C.pointageDuMois(d, e, 2026, 10).hs).toEqual({ 25: 5.5 });
    // Le bulletin paie le total du mois : 5,5 h à +25 % de 1 450,375 / 208 h = 47,939.
    expect(C.heuresSupDuMois(d, e, 2026, 10).map(b => [b.hs, b.heures, b.amount])).toEqual([[25, 5.5, 47.939]]);
    expect(core.payslipInputFor(d, e, 2026, 10).bonuses.filter(b => b.hs).map(b => b.amount)).toEqual([47.939]);
    // Un autre jour s'ajoute aussi ; changer la majoration du 27 la déplace, sans toucher le 28.
    C.poserHeuresSupDuJour(d, e, 2026, 10, 28, 25, 1.25);
    C.poserHeuresSupDuJour(d, e, 2026, 10, 27, 50, 2);
    expect(C.pointageDuMois(d, e, 2026, 10).hs).toEqual({ 25: 4.75, 50: 2 });
    // Retirer le jour le retire du mois, et seulement lui.
    C.poserHeuresSupDuJour(d, e, 2026, 10, 27, 50, 0);
    expect(C.heuresSupDuJour(d, e, 2026, 10, 27)).toBe(null);
    expect(C.pointageDuMois(d, e, 2026, 10).hs).toEqual({ 25: 4.75 });
  });

  it('ne descend jamais sous zéro, refuse sans majoration et hors contrat', () => {
    const d = donnees(), e = emp(d);
    C.poserHeuresSupDuJour(d, e, 2026, 10, 5, 25, 3);
    // Le mois retouché plus bas à la main (1 h) : retirer les 3 h du jour le laisse à zéro, pas à − 2.
    C.poserHeuresSup(d, e, 2026, 10, 25, 1);
    C.poserHeuresSupDuJour(d, e, 2026, 10, 5, 25, 0);
    expect(C.pointageDuMois(d, e, 2026, 10).hs).toEqual({});
    expect(C.poserHeuresSupDuJour(d, e, 2026, 10, 6, 0, 2)).toBe(false);
    // Après sa sortie (le 20/11), rien ne se pointe.
    expect(C.poserHeuresSupDuJour(d, e, 2026, 11, 25, 25, 2)).toBe(false);
    // Un retrait sur un mois jamais pointé n'écrit rien.
    expect(C.poserHeuresSupDuJour(d, e, 2026, 9, 3, 25, 0)).toBe(true);
    expect((d.timesheets as Obj[]).some(t => t.month === 9)).toBe(false);
  });
});
