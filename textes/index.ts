// Le catalogue des textes : le moteur (textes.ts), les textes du socle, et les phrases de la base.
// Un module déclare les siens en important `declarerTextes`.

import './socle.ts';

export { reconnaitre, MESSAGES_DE_LA_BASE } from './base.ts';
export {
  clesDuCatalogue, declarerTextes, factice, langueDe, motif, rendre, rendreTout, t, Texte, texteConnu, texteFrancais,
  type Langue, type Valeur, type Valeurs,
} from './textes.ts';
