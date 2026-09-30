// Le prix par quantité, dans le code de la v10 (web/public/v10/core.js, adapté par web/v10/prix-quantite.txt ;
// brique 92, 14 § 3.2 : « prix par quantité (à partir de 10, de 100…) »). Le moteur seul :
//   - le palier le plus haut que la quantité atteint ; sous le premier, le prix de l'article ;
//   - ce qu'on tape (« 10 : 20,500 ; 100 : 19 ») se lit, se trie, et un palier illisible ou en double se refuse
//     en disant lequel.
// Les données discriminent : des paliers donnés dans le désordre, une quantité à décimales (9,5 sacs).

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Palier = { min: number; prix: number };
type Core = {
  prixCataloguePourQuantite: (item: unknown, qty: number) => number;
  lirePaliers: (texte: string) => { paliers?: Palier[]; erreur?: string };
  paliersEnTexte: (paliers: Palier[]) => string;
};
const module = { exports: {} as unknown };
const source = fs.readFileSync(path.join(import.meta.dirname, '../../web/public/v10/core.js'), 'utf8');
(vm.runInThisContext(`(function (module, exports, require) {${source}\n})`, { filename: 'core.js' }) as (m: unknown, e: unknown, r: unknown) => void)(module, module.exports, () => ({}));
const C = module.exports as Core;

describe('le prix par quantité, dans la v10', () => {
  it('le palier le plus haut que la quantité atteint ; sous le premier, le prix de l\'article', () => {
    const ciment = { id: 'ciment', unitPrice: 21, paliers: [{ min: 100, prix: 19 }, { min: 10, prix: 20.5 }, { min: 50, prix: 0 }] };
    expect([1, 9.5, 10, 99, 100, 250].map((q) => C.prixCataloguePourQuantite(ciment, q))).toEqual([21, 21, 20.5, 20.5, 19, 19]);
    // Un palier sans prix ne compte pas (50 : 0) ; un article sans paliers garde son prix.
    expect(C.prixCataloguePourQuantite(ciment, 60)).toBe(20.5);
    expect(C.prixCataloguePourQuantite({ unitPrice: 21 }, 1000)).toBe(21);
  });

  it('ce qu\'on tape se lit et se trie ; un palier illisible, nul ou en double se refuse en disant lequel', () => {
    expect(C.lirePaliers('100 : 19 ; 10 : 20,500')).toEqual({ paliers: [{ min: 10, prix: 20.5 }, { min: 100, prix: 19 }] });
    expect(C.lirePaliers('1 000 = 18,25\n10:20.5')).toEqual({ paliers: [{ min: 10, prix: 20.5 }, { min: 1000, prix: 18.25 }] });
    expect(C.lirePaliers('')).toEqual({ paliers: [] });
    expect(C.lirePaliers('10 : 20,5 ; 100 dix-neuf').erreur).toBe('« 100 dix-neuf » ne se lit pas : écris la quantité, deux-points, puis le prix (par exemple « 10 : 20,500 »).');
    expect(C.lirePaliers('10 : 0').erreur).toBe('« 10 : 0 » : la quantité et le prix doivent être plus grands que zéro.');
    expect(C.lirePaliers('10 : 20 ; 10 : 19').erreur).toBe('La quantité 10 a deux prix : garde-en un seul.');
    expect(C.paliersEnTexte([{ min: 10, prix: 20.5 }, { min: 100, prix: 19 }])).toBe('10 : 20,5 ; 100 : 19');
  });
});
