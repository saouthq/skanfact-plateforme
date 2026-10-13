// La langue de l'écran : le français, ou la langue factice (?langue=factice) qui montre ce qui
// déborde et ce qui a échappé au catalogue. Les réponses du serveur arrivent dans la même langue.
import { majuscule, motif, rendre, t, type Langue, type Valeurs } from '../../textes/index.ts';
import './textes.ts';

export const LANGUE: Langue = new URLSearchParams(location.search).get('langue') === 'factice' ? 'factice' : 'fr';

// Un morceau de texte (un libellé), tel quel.
export const dire = (cle: string, valeurs: Valeurs = {}) => rendre(t(cle, valeurs), LANGUE);
// Une phrase entière (majuscule, point final).
export const phrase = (cle: string, valeurs: Valeurs = {}) => rendre(motif(cle, valeurs), LANGUE);
// Un libellé avec sa majuscule, sans point (un titre, un bouton). Un libellé qui commence par un nombre n'en prend pas
// (« 95 % des requêtes », « 24 h »).
export const titre = (cle: string, valeurs: Valeurs = {}) => majuscule(dire(cle, valeurs));
