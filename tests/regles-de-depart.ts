// Les règles de l'abonnement de la mise en place (0104 ; skanfact docs/cadrage/07-offres-et-prix.md) : sept jours de
// grâce, les relances à quinze jours, sept jours et la veille. Les tests qui construisent des faits à la main les
// portent, comme la base les ajoute à ceux qu'elle rend.

import type { Regles } from '../serveur/abonnement/etat.ts';

export const REGLES_DE_DEPART: Regles = {
  grace: [{ aPartirDu: '2000-01-01', jours: [7] }],
  relances: [{ aPartirDu: '2000-01-01', jours: [15, 7, 1] }],
};
