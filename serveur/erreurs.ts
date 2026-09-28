// Les refus du métier, levés par le serveur (les refus de la base arrivent, eux, avec le code 42501
// de socle.refus, et leur phrase est reconnue par le catalogue : textes/base.ts). Un refus dit ce
// qui est refusé, pourquoi, et le bouton qui débloque (règle du projet) ; ses mots viennent du
// catalogue des textes, et se rendent dans la langue de celui qui lit (serveur/app.ts).

import { motif, reconnaitre, rendre, Texte, type Valeurs } from '../textes/index.ts';

export class Refus extends Error {
  readonly code = '42501';
  readonly texte: Texte;
  readonly bouton: string | null;
  constructor(cle: string, options: { valeurs?: Valeurs; bouton?: string } = {}) {
    const texte = motif(cle, options.valeurs);
    super(rendre(texte, 'fr'));
    this.texte = texte;
    this.bouton = options.bouton ?? null;
  }
}

// Ce qu'on cherche n'existe pas, ou n'est pas à portée (03 D3 : on ne dit pas lequel des deux).
export class Introuvable extends Error {
  readonly code = 'introuvable';
  constructor() { super('introuvable'); }
}

// Le texte d'un refus : celui du serveur (Refus, Perimee, MiseDeCote), ou la phrase de la base
// reconnue par le catalogue. Une phrase de la base inconnue du catalogue (un test l'empêche) passe
// telle quelle.
export function texteDuRefus(e: { message?: string; texte?: unknown }): Texte | string {
  if (e.texte instanceof Texte) return e.texte;
  const reconnu = reconnaitre(e.message ?? '');
  return reconnu ? motif(reconnu.cle, reconnu.valeurs) : (e.message ?? '');
}

// L'objet a changé depuis que la personne l'a ouvert (01 R15) : on ne l'écrase pas.
export class Perimee extends Error {
  readonly code = 'perimee';
  readonly texte: Texte;
  constructor(cle = 'commun.perimee') { const texte = motif(cle); super(rendre(texte, 'fr')); this.texte = texte; }
}
