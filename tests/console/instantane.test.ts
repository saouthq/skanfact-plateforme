// Le calcul que l'équipe partage (serveur/console/instantane.ts ; l'audit 1.42.0 A09 ; docs/console.md C65), pur : il
// sert tant qu'il est frais ; passé, il sert et se refait à côté ; périmé, d'un autre jour ou effacé par un geste, la
// demande attend le nouveau ; deux demandes attendent le même ; un calcul commencé avant un geste ne sert pas après lui.

import { describe, expect, it } from 'vitest';
import { instantane } from '../../serveur/console/instantane.ts';

// Un calcul qu'on termine à la main, et qui dit combien de fois il a été lancé.
function calculs() {
  const lances: { valeur: number; finir: () => void }[] = [];
  let n = 0;
  const faire = () => {
    n += 1;
    const valeur = n;
    return new Promise<number>((r) => { lances.push({ valeur, finir: () => r(valeur) }); });
  };
  return { faire, lances, combien: () => n };
}
const attendre = () => new Promise((r) => setImmediate(r));

describe('le calcul partagé de la liste (C65)', () => {
  it('frais, il sert sans rien recalculer ; passé, il sert tel quel et se refait à côté ; périmé, la demande attend', async () => {
    let t = 1_000_000;
    const p = instantane<number>({ fraisMs: 60_000, perimeMs: 600_000, maintenant: () => t });
    const c = calculs();
    const premier = p.lire('2026-10-19', c.faire, c.faire);
    await attendre();
    c.lances[0]?.finir();
    expect(await premier).toEqual({ valeur: 1, calculeLe: 1_000_000 });
    t += 59_000;
    expect((await p.lire('2026-10-19', c.faire, c.faire)).valeur).toBe(1);
    expect(c.combien()).toBe(1);
    // Passé d'une minute : la réponse n'attend pas (elle rend l'ancien), un nouveau se calcule à côté, puis sert.
    t += 2_000;
    expect((await p.lire('2026-10-19', c.faire, c.faire)).valeur).toBe(1);
    expect(c.combien()).toBe(2);
    c.lances[1]?.finir();
    await attendre();
    expect(await p.lire('2026-10-19', c.faire, c.faire)).toEqual({ valeur: 2, calculeLe: 1_061_000 });
    // Sans calcul à côté possible (aucune session pour le faire), un calcul passé se refait pendant la demande.
    t += 61_000;
    const sansACote = p.lire('2026-10-19', c.faire, null);
    await attendre();
    c.lances[2]?.finir();
    expect((await sansACote).valeur).toBe(3);
    // Périmé (dix minutes) : la demande attend le nouveau.
    t += 600_000;
    const perime = p.lire('2026-10-19', c.faire, c.faire);
    await attendre();
    c.lances[3]?.finir();
    expect((await perime).valeur).toBe(4);
  });

  it('un autre jour, « Actualiser » et un geste de la console font attendre un calcul neuf', async () => {
    const t = 5_000_000;
    const p = instantane<number>({ fraisMs: 60_000, perimeMs: 600_000, maintenant: () => t });
    const c = calculs();
    const lire = async (cle: string, frais = false) => {
      const r = p.lire(cle, c.faire, c.faire, frais);
      await attendre();
      c.lances.at(-1)?.finir();
      return (await r).valeur;
    };
    expect(await lire('2026-10-19')).toBe(1);
    expect(await lire('2026-10-20')).toBe(2);
    expect(await lire('2026-10-20', true)).toBe(3);
    p.oublier();
    expect(await lire('2026-10-20')).toBe(4);
    expect(await lire('2026-10-20')).toBe(4);
  });

  it('deux demandes en même temps attendent le même calcul ; un calcul commencé avant un geste sert à qui l\'attendait, jamais après', async () => {
    const p = instantane<number>({ fraisMs: 60_000, perimeMs: 600_000, maintenant: () => 0 });
    const c = calculs();
    const a = p.lire('j', c.faire, c.faire);
    const b = p.lire('j', c.faire, c.faire);
    await attendre();
    expect(c.combien()).toBe(1);
    // Un geste arrive pendant le calcul : celui-ci finit pour ses deux demandes, mais ne se garde pas.
    p.oublier();
    c.lances[0]?.finir();
    expect([(await a).valeur, (await b).valeur]).toEqual([1, 1]);
    const apres = p.lire('j', c.faire, c.faire);
    await attendre();
    expect(c.combien()).toBe(2);
    c.lances[1]?.finir();
    expect((await apres).valeur).toBe(2);
  });

  it('réglé à zéro (un essai qui relit ce qu\'il vient d\'écrire), il recalcule à chaque demande', async () => {
    const p = instantane<number>({ fraisMs: 0, perimeMs: 0, maintenant: () => 0 });
    let n = 0;
    const faire = async () => { n += 1; return n; };
    expect((await p.lire('j', faire, faire)).valeur).toBe(1);
    expect((await p.lire('j', faire, faire)).valeur).toBe(2);
  });

  it('un calcul qui échoue ne se garde pas : la demande suivante le refait', async () => {
    const p = instantane<number>({ fraisMs: 60_000, perimeMs: 600_000, maintenant: () => 0 });
    await expect(p.lire('j', () => Promise.reject(new Error('base absente')))).rejects.toThrow('base absente');
    expect((await p.lire('j', async () => 7)).valeur).toBe(7);
  });
});
