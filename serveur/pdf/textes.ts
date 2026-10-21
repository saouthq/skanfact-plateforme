// Les textes du PDF fait par le serveur (14 § 5) : ce qui se refuse. Déclarés dès que le module est chargé.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'pdf.indisponible': 'ce serveur ne fait pas encore les PDF : la fenêtre d\'impression du navigateur s\'ouvre à la place (choisis « Enregistrer au format PDF »)',
  'pdf.occupe': 'le serveur fait déjà beaucoup de PDF : réessaie dans une minute',
  'pdf.trop_long': 'le PDF de « {nom} » prend trop de temps à faire : rien n\'a été fait. Réessaie dans un instant',
  'pdf.echec': 'le PDF de « {nom} » n\'a pas pu être fait : réessaie, ou imprime-le depuis la fenêtre du navigateur',
  'pdf.trop_lourd': 'la page de « {nom} » fait {taille} Mo : au-delà de {limite} Mo, elle ne s\'imprime pas. Un logo ou un cachet plus léger la fera passer',
});
