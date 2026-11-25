// Les textes de la version minimale imposée (serveur/version-minimale.ts ; base 0231) : la réponse de l'API à un écran
// trop ancien qui enregistre, et le bandeau de l'application.

import { declarerTextes } from '../../textes/index.ts';

declarerTextes({
  'version_minimale.motif': 'Une correction importante de SkanFact vient d\'être mise en ligne : recharge la page pour continuer. Rien n\'a été enregistré ; ce qui est à l\'écran reste là tant que tu ne recharges pas.',
  'version_minimale.motif_message': 'Une correction importante de SkanFact vient d\'être mise en ligne : recharge la page pour continuer. Rien n\'a été enregistré ; ce qui est à l\'écran reste là tant que tu ne recharges pas. {message}',
  'version_minimale.bandeau': 'Une correction importante est en ligne : recharge la page pour continuer d\'enregistrer.',
  'version_minimale.sans_numero': 'La version en ligne n\'a pas de numéro : il n\'y a rien à imposer.',
});
