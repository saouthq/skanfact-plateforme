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

// Le champ qu'un refus de la base désigne, quand il tient à un seul (E5) : l'écran le marque, comme un champ que le
// serveur refuse (« un refus montre le champ »). Son nom est celui de l'API. Un matricule déjà celui d'une autre
// entreprise ne se disait qu'en bas de l'écran ; la fiche société, elle, ne pouvait pas savoir qu'il s'agissait de lui.
const CHAMPS_DES_REFUS: Record<string, string> = {
  'base.entreprise.matricule_pris': 'matriculeFiscal',
  'base.cabinet.matricule_pris': 'matriculeFiscal',
};
export function champDuRefus(texte: Texte | string): string | null {
  return texte instanceof Texte ? CHAMPS_DES_REFUS[texte.cle] ?? null : null;
}

// L'objet a changé depuis que la personne l'a ouvert (01 R15) : on ne l'écrase pas.
export class Perimee extends Error {
  readonly code = 'perimee';
  readonly texte: Texte;
  constructor(cle = 'commun.perimee') { const texte = motif(cle); super(rendre(texte, 'fr')); this.texte = texte; }
}

// Une panne laisse sa ligne dans le journal du programme (sa sortie d'erreur, que systemd range ; la veille y renvoie
// quand les pannes dépassent un pour cent, exploitation/veille.ts). Avant la Console 3c, rien : Fastify, sans journal à
// lui, jetait l'erreur d'une réponse 500 et celle d'une tâche de fond. La ligne dit OÙ (la route par son modèle, ou la
// tâche), la sorte de l'erreur, son code et les objets de la base qu'elle nomme (une contrainte, une table, une
// colonne), et les lieux du code d'où elle vient. Jamais son message : il peut citer une valeur (un identifiant mal
// formé, la ligne qui heurte une contrainte), et un journal technique ne porte aucune donnée de client (06 S4).
const NOM_SUR = /^[A-Za-z0-9_.:-]{1,80}$/;
export function lignePanne(ou: string, e: unknown): string {
  const err = (typeof e === 'object' && e !== null ? e : {}) as Record<string, unknown>;
  const nom = typeof err.name === 'string' && NOM_SUR.test(err.name) ? err.name : typeof e;
  const precisions = ['code', 'constraint', 'table', 'column']
    .map((k) => [k, err[k]] as const)
    .filter((x): x is readonly [string, string] => typeof x[1] === 'string' && NOM_SUR.test(x[1]))
    .map(([k, v]) => `${k} ${v}`);
  const lieux = typeof err.stack === 'string'
    ? err.stack.split('\n').filter((l) => /^\s+at /.test(l)).map((l) => l.trim().slice(3)).filter((l) => !l.startsWith('node:')).slice(0, 4)
    : [];
  return [`panne : ${ou}`, [nom, ...precisions].join(', '), ...(lieux.length ? [lieux.join(' ← ')] : [])].join(' — ');
}
export function noterPanne(ou: string, e: unknown): void {
  console.error(lignePanne(ou, e));
}
