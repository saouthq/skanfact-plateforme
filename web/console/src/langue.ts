// Les textes de la console, avec la typographie française : une espace fine insécable devant « : ; ? ! » et à
// l'intérieur des guillemets. Sans elle, le navigateur coupe la ligne juste avant le signe (« en place » en fin de
// ligne, « : dans l'application » au début de la suivante). Le catalogue (textes/) garde des espaces ordinaires :
// la typographie se pose au moment d'afficher, ici, et sur ce que le serveur répond (contexte.ts).
import { dire as direBrut, LANGUE, phrase as phraseBrute, titre as titreBrut } from '../../src/langue.ts';
import type { Valeurs } from '../../../textes/index.ts';

const FINE = '\u202f';
// Un nombre qui suit un deux-points reste avec lui (« Complet : 1 », jamais « Complet : » puis « 1 » à la ligne).
export const typo = (s: string) => s.replace(/ ([:;?!»])/g, `${FINE}$1`).replace(/« /g, `«${FINE}`).replace(/: (\d)/g, ':\u00a0$1');

export { LANGUE };
export const dire = (cle: string, valeurs: Valeurs = {}) => typo(direBrut(cle, valeurs));
export const phrase = (cle: string, valeurs: Valeurs = {}) => typo(phraseBrute(cle, valeurs));
export const titre = (cle: string, valeurs: Valeurs = {}) => typo(titreBrut(cle, valeurs));
