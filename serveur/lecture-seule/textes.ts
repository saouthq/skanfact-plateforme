// Les textes de la lecture seule générale (serveur/lecture-seule.ts ; base 0230) : la réponse de l'API à un geste qui
// écrit, et le bandeau de l'application.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'lecture_seule.motif': 'SkanFact est en lecture seule jusqu\'à {fin} : tu peux tout consulter, mais rien ne s\'enregistre pour l\'instant. Réessaie après {fin}.',
  'lecture_seule.motif_message': 'SkanFact est en lecture seule jusqu\'à {fin} : tu peux tout consulter, mais rien ne s\'enregistre pour l\'instant. Réessaie après {fin}. {message}',
  'lecture_seule.bandeau': 'Jusqu\'à {fin} : tu peux tout consulter, mais rien ne s\'enregistre pour l\'instant.',
  'lecture_seule.bandeau_prevu': 'De {debut} à {fin} : pendant ce temps, tu pourras tout consulter, mais rien ne s\'enregistrera.',
});
