// Les repères sous un graphique de la console (web/console/src/axe.ts), sur des largeurs données. Le parcours à la
// souris (tests/web/console-service.test.ts) vérifie l'écran avec les étiquettes du jour ; ici, des étiquettes de largeurs
// inégales, comme « 9 h » à côté de « 12 h », départagent à coup sûr un axe régulier d'un axe éclairci au plus pressé.

import { describe, expect, it } from 'vitest';
import { reperesGardes, type Boite } from '../../web/console/src/axe.ts';

// Un repère tous les 40 pixels, centré sur sa place, de la largeur donnée.
const boites = (largeurs: number[]): Boite[] => largeurs.map((w, j) => ({ left: 40 * j - w / 2, right: 40 * j + w / 2 }));
const pas = (g: number[]) => new Set(g.slice(1).map((j, m) => j - (g[m] ?? 0)));

describe('les repères d\'un axe', () => {
  it('des étiquettes de largeurs inégales : un repère sur deux, régulier, en partant du plus récent ; jamais deux qui se touchent', () => {
    const b = boites([30, 30, 44, 30, 30, 44, 30, 30, 44, 30]);
    const g = reperesGardes(b, b.map(() => false), 8);
    expect(g).toEqual([1, 3, 5, 7, 9]);
    expect(pas(g)).toEqual(new Set([2]));
    expect(g.slice(1).every((j, m) => (b[g[m] ?? 0]?.right ?? 0) + 8 <= (b[j]?.left ?? 0))).toBe(true);
    // Assez de place : tous restent ; un seul repère reste seul.
    expect(reperesGardes(boites([20, 20, 20]), [false, false, false], 8)).toEqual([0, 1, 2]);
    expect(reperesGardes(boites([20]), [false], 8)).toEqual([0]);
  });

  it('un repère calé sur un bord ne compte pas dans le pas : s\'il touche son voisin gardé, lui seul se tait', () => {
    // Le premier, calé sur le bord gauche, déborde sur son voisin : le pas reste celui des autres, et lui se tait.
    const b = boites([20, 20, 20, 20, 20]);
    b[0] = { left: 0, right: 70 };
    expect(reperesGardes(b, [true, false, false, false, false], 8)).toEqual([1, 2, 3, 4]);
  });
});
