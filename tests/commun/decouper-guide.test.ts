// Le texte de l'aide part à part (1.273.0, L9 ; web/decouper-guide.ts, docs/leger.md). Ce que la coupe garantit, sur le
// vrai guide.js du dépôt :
//   - la part qui part avec la page ne porte plus l'explication d'aucune bulle ni le corps d'aucun article ;
//   - les deux parts, recollées par `SkanGuide.poserTextes`, redonnent l'aide entière, bulle pour bulle ;
//   - chaque ligne reste à sa place (une erreur signalée pointe la ligne du dépôt) ;
//   - une valeur qu'on ne sait pas déplacer telle quelle (un gabarit avec une expression) arrête la construction.

import { isDeepStrictEqual } from 'node:util';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { lireEcran } from '../../commun/assemblage.ts';
import { scriptSansCommentaires } from '../../web/alleger.ts';
import { decouperLeGuide } from '../../web/decouper-guide.ts';

type Guide = { INFO: Record<string, { t?: string; d?: string }>; ARTICLES: { id: string; body?: string }[]; textesPrets: () => boolean };
const charger = (...codes: string[]): Guide => {
  const bac: Record<string, unknown> = {};
  bac.self = bac;
  vm.createContext(bac);
  for (const c of codes) vm.runInContext(c, bac);
  return bac.SkanGuide as Guide;
};
const lu = (g: Guide) => JSON.parse(JSON.stringify({ INFO: g.INFO, ARTICLES: g.ARTICLES })) as unknown;

describe('le texte de l\'aide, coupé à la construction', () => {
  const code = scriptSansCommentaires('v10/guide.js', lireEcran('v10/guide.js'));
  const { leger, textes } = decouperLeGuide(code);

  it('la page ne porte plus le texte des bulles ni des articles ; recollé, c\'est l\'aide entière, ligne pour ligne', () => {
    const entier = charger(code);
    const seul = charger(leger);
    expect(Object.keys(entier.INFO).length).toBeGreaterThan(300);
    expect(Object.values(seul.INFO).filter((x) => x.d !== undefined)).toEqual([]);
    expect(seul.ARTICLES.filter((a) => a.body !== undefined)).toEqual([]);
    // Les titres restent : une bulle se pose et se nomme avant que son texte arrive.
    expect(Object.values(seul.INFO).every((x) => typeof x.t === 'string')).toBe(true);
    expect(seul.textesPrets()).toBe(false);
    expect(leger.length).toBeLessThan(code.length / 4);
    expect(leger.split('\n').length).toBe(code.split('\n').length);
    const recolle = charger(leger, textes);
    expect(recolle.textesPrets()).toBe(true);
    expect(isDeepStrictEqual(lu(recolle), lu(entier))).toBe(true);
  });

  it('un gabarit avec une expression ne se coupe pas : la construction s\'arrête', () => {
    const avecExpression = code.replace(/body: `/, 'body: `${1}');
    expect(() => decouperLeGuide(avecExpression)).toThrow(/gabarit sans expression/);
  });
});
