// Les textes de la console, avec la typographie française : une espace fine insécable devant « : ; ? ! » et à
// l'intérieur des guillemets. Sans elle, le navigateur coupe la ligne juste avant le signe (« en place » en fin de
// ligne, « : dans l'application » au début de la suivante). Le catalogue (textes/) garde des espaces ordinaires :
// la typographie se pose au moment d'afficher, ici, et sur ce que le serveur répond (contexte.ts).
import { dire as direBrut, LANGUE, phrase as phraseBrute, titre as titreBrut } from '../../src/langue.ts';
import type { Valeurs } from '../../../textes/index.ts';

const FINE = '\u202f';
// Un nombre qui suit un deux-points reste avec lui (« Complet : 1 », jamais « Complet : » puis « 1 » à la ligne) ; un
// nombre reste avec ce qu'il compte ou son unité (« 4 processeurs », « 300 ms », « 1 % » : jamais « 300 » en fin de
// ligne et « ms » au début de la suivante).
export const typo = (s: string) => s.replace(/ ([:;?!»])/g, `${FINE}$1`).replace(/« /g, `«${FINE}`).replace(/: (\d)/g, ':\u00a0$1')
  .replace(/(\d) (?=[\p{L}%])/gu, '$1\u00a0');

export { LANGUE };
export const dire = (cle: string, valeurs: Valeurs = {}) => typo(direBrut(cle, valeurs));
export const phrase = (cle: string, valeurs: Valeurs = {}) => typo(phraseBrute(cle, valeurs));
export const titre = (cle: string, valeurs: Valeurs = {}) => typo(titreBrut(cle, valeurs));
// Un compte nul, au singulier ou au pluriel : les clés `<cle>_0`, `<cle>_1` et `<cle>_n` (« aucun dossier », « un
// dossier », « 4 dossiers »), `{n}` posé dans les trois.
export const selon = (n: number, cle: string, valeurs: Valeurs = {}) => dire(`${cle}_${n === 0 ? '0' : n === 1 ? '1' : 'n'}`, { n, ...valeurs });
