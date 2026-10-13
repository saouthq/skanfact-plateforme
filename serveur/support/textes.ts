// Les textes du support, côté entreprise (Support S1 ; docs/support.md ; 0095).

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'geste.support.ecrire': 'écrire au support de SkanFact',
  'geste.support.voir': 'lire tes demandes au support',
  'support.champ.sujet_court': 'le sujet dit en quelques mots ce qui se passe : trois caractères au moins',
  'support.champ.sujet_long': 'le sujet tient sur une ligne : cent quarante caractères au plus',
  'support.champ.sans_balise': 'le sujet s\'écrit sans les signes < ni >',
  'support.champ.texte_court': 'dis ce qui se passe : trois caractères au moins',
  'support.champ.message_vide': 'écris ton message avant de l\'envoyer',
  // L'alerte par e-mail d'une réponse : ni la réponse, ni son auteur, ni le nom de l'entreprise (décidé avec la
  // messagerie le 09/10/2026 : « une alerte e-mail sans contenu »).
  'support.alerte.objet': 'Le support de SkanFact t\'a répondu',
  'support.alerte.bouton': 'Lire la réponse dans SkanFact',
  'support.alerte.texte': 'Bonjour,\n\nL\'équipe de SkanFact a répondu à ta demande. La réponse t\'attend dans SkanFact, et nulle part ailleurs :\n\n{lien}\n\nTu la retrouves dans l\'Aide, « Tes demandes au support ».',
});
