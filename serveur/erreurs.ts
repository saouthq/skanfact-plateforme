// Les refus du métier, levés par le serveur (les refus de la base arrivent, eux, avec le code 42501
// de socle.refus). Un refus dit ce qui est refusé, pourquoi, et le bouton qui débloque (règle du
// projet) ; le serveur web les rend tels quels (serveur/app.ts).

export class Refus extends Error {
  readonly code = '42501';
  readonly bouton: string | null;
  constructor(message: string, bouton: string | null = null) { super(message); this.bouton = bouton; }
}

// Ce qu'on cherche n'existe pas, ou n'est pas à portée (03 D3 : on ne dit pas lequel des deux).
export class Introuvable extends Error {
  readonly code = 'introuvable';
  constructor() { super('Introuvable.'); }
}

// L'objet a changé depuis que la personne l'a ouvert (01 R15) : on ne l'écrase pas.
export class Perimee extends Error {
  readonly code = 'perimee';
  constructor(message = 'cette pièce a changé depuis que tu l\'as ouverte : recharge-la avant de la modifier') { super(message); }
}
