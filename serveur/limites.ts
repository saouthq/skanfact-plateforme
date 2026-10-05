// Les limites d'appels par clé de l'API (14 § 2.5 ; vision § 6) : une intégration mal écrite ne
// ralentit pas les autres. Chaque clé a un SEAU de jetons : il contient au plus `capacite` jetons et
// se remplit de `parSeconde` jetons chaque seconde ; un appel en prend un. Un seau vide répond « trop
// d'appels » (429), avec le nombre de secondes à attendre. Une rafale courte passe (la capacité),
// un débit soutenu au-delà de la recharge ne passe pas.
//
// Les chiffres par défaut, décidés le 28/09/2026 par délégation (journal du cadrage) : 600 appels par
// minute et par clé (10 par seconde), des rafales de 60. Les personnes connectées à l'écran ne sont
// pas limitées ici : leurs écrans ne font pas de boucles.
//
// Le seau vit dans la mémoire du programme serveur : un seul programme aujourd'hui (vision § 5).
// Plusieurs programmes côte à côte partageront leurs seaux (la base ou un cache) le jour où il y en
// aura plusieurs ; d'ici là, chacun compterait à part, et une clé aurait autant de seaux.

export type ReglageLimites = { capacite: number; parSeconde: number; maintenant?: () => number };
export const LIMITES_PAR_DEFAUT: ReglageLimites = { capacite: 60, parSeconde: 10 };
// Les routes sans session (connexion, inscription, l'espace client, le paiement en ligne…), par ADRESSE de l'appelant
// (brique 142 ; décidé le 05/10/2026 par délégation) : 60 appels d'un coup, puis un par seconde. Assez pour une
// équipe entière qui se connecte le matin derrière la même box ; trop peu pour essayer des mots de passe ou des liens
// à la chaîne. Les avis de Konnect et les appels d'un partenaire y passent aussi : ils sont rares (un par paiement,
// un par connexion), et l'avis de Konnect n'est pas signé (n'importe qui peut l'appeler).
export const LIMITES_PAR_ADRESSE: ReglageLimites = { capacite: 60, parSeconde: 1 };

export type Verdict = { permis: true; restants: number } | { permis: false; restants: 0; attendreSecondes: number };

export class Limiteur {
  private seaux = new Map<string, { jetons: number; vu: number }>();
  private readonly capacite: number;
  private readonly parSeconde: number;
  private readonly maintenant: () => number;

  constructor(r: ReglageLimites = LIMITES_PAR_DEFAUT) {
    if (!(r.capacite >= 1) || !(r.parSeconde > 0)) throw new Error('une limite d\'appels a une capacité d\'au moins 1 et une recharge positive');
    this.capacite = r.capacite;
    this.parSeconde = r.parSeconde;
    this.maintenant = r.maintenant ?? Date.now;
  }

  get limite(): number { return this.capacite; }

  // Un appel de la clé `qui` : permis (et un jeton en moins), ou refusé avec l'attente.
  appel(qui: string): Verdict {
    const t = this.maintenant();
    const s = this.seaux.get(qui) ?? { jetons: this.capacite, vu: t };
    // Le seau s'est rempli depuis le dernier appel, sans dépasser sa capacité. Une horloge qui
    // recule (réglage du serveur) ne vide jamais un seau.
    s.jetons = Math.min(this.capacite, s.jetons + (Math.max(0, t - s.vu) / 1000) * this.parSeconde);
    s.vu = t;
    this.seaux.set(qui, s);
    if (this.seaux.size > 50_000) this.oublier(t);
    if (s.jetons >= 1) {
      s.jetons -= 1;
      return { permis: true, restants: Math.floor(s.jetons) };
    }
    return { permis: false, restants: 0, attendreSecondes: Math.max(1, Math.ceil((1 - s.jetons) / this.parSeconde)) };
  }

  // Un seau plein n'apprend rien : on oublie ceux qui le sont redevenus, pour que la mémoire ne
  // grandisse pas avec le nombre de clés qui ont appelé un jour.
  private oublier(t: number) {
    for (const [k, s] of this.seaux) {
      if (s.jetons + ((t - s.vu) / 1000) * this.parSeconde >= this.capacite) this.seaux.delete(k);
    }
  }
}
