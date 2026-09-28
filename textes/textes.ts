// Le catalogue des textes (14 § 5) : chaque phrase qu'une personne peut lire vient d'ici, par sa
// clé, jamais écrite en dur dans le code (un test fait tomber la construction). Chaque module
// DÉCLARE ses textes (02 M1), comme ses gestes.
//
// Une langue factice sert aux essais : 40 % plus longue et accentuée, elle montre ce qui déborde et
// ce qui a échappé au catalogue (une phrase écrite en dur y reste en français ordinaire).

export type Langue = 'fr' | 'factice';
export type Valeur = string | number | bigint | Texte | Valeur[];
export type Valeurs = Record<string, Valeur>;

const CATALOGUE = new Map<string, string>();

// Un module déclare ses textes : clé → phrase française. Une clé déclarée deux fois avec deux
// phrases différentes arrête le démarrage.
export function declarerTextes(textes: Record<string, string>): void {
  for (const [cle, fr] of Object.entries(textes)) {
    const deja = CATALOGUE.get(cle);
    if (deja !== undefined && deja !== fr) throw new Error(`texte déclaré deux fois, différemment : ${cle}`);
    CATALOGUE.set(cle, fr);
  }
}

export const texteConnu = (cle: string) => CATALOGUE.has(cle);
export const clesDuCatalogue = () => [...CATALOGUE.keys()];
export const texteFrancais = (cle: string) => CATALOGUE.get(cle);

// Un texte à dire : sa clé et ses valeurs. Il se rend dans la langue de celui qui le lit, au dernier
// moment (la réponse du serveur). `phrase` : une phrase entière (majuscule, point final).
export class Texte {
  readonly cle: string;
  readonly valeurs: Valeurs;
  readonly phrase: boolean;
  constructor(cle: string, valeurs: Valeurs = {}, phrase = false) {
    if (!CATALOGUE.has(cle)) throw new Error(`texte inconnu du catalogue : ${cle}`);
    this.cle = cle;
    this.valeurs = valeurs;
    this.phrase = phrase;
  }
  // Rendu par défaut (en français) si un texte arrive jusqu'au JSON sans avoir été rendu.
  toJSON(): string { return rendre(this, 'fr'); }
  toString(): string { return rendre(this, 'fr'); }
}

// Un morceau de texte, à placer dans un autre ; `motif` : une phrase entière.
export const t = (cle: string, valeurs: Valeurs = {}) => new Texte(cle, valeurs);
export const motif = (cle: string, valeurs: Valeurs = {}) => new Texte(cle, valeurs, true);

function valeurEnTexte(v: Valeur, langue: Langue): string {
  if (v instanceof Texte) return rendre(v, langue);
  if (Array.isArray(v)) return v.map((x) => valeurEnTexte(x, langue)).join(', ');
  return String(v);
}

// « {de:nom} » : « de » devant la valeur, élidé en « d' » devant une voyelle ou un h (« ne permet
// pas d'émettre une facture », « de poser un réglage »).
const ELISION = /^[aeiouyhàâäéèêëîïôöùûü]/i;

export function rendre(x: Texte, langue: Langue): string {
  const fr = CATALOGUE.get(x.cle) ?? x.cle;
  const modele = langue === 'factice' ? factice(fr) : fr;
  const texte = modele.replace(/\{(de:)?([a-zA-Z_]+)\}/g, (tout, de: string | undefined, nom: string) => {
    const v = x.valeurs[nom];
    if (v === undefined) return tout;
    const valeur = valeurEnTexte(v, langue);
    return de ? (ELISION.test(valeur) ? `d'${valeur}` : `de ${valeur}`) : valeur;
  });
  return x.phrase ? enPhrase(texte) : texte;
}

// Majuscule à la première lettre, point final s'il n'y a pas déjà une ponctuation.
function enPhrase(texte: string): string {
  const i = texte.search(/\p{L}/u);
  const debut = i < 0 ? texte : texte.slice(0, i) + texte.charAt(i).toUpperCase() + texte.slice(i + 1);
  return /[.!?…]$/.test(debut) ? debut : `${debut}.`;
}

// La langue factice : chaque lettre accentuée, et 40 % de longueur en plus (l'anglais et les noms
// longs débordent comme elle). Les valeurs ({nom}) restent intactes.
const ACCENTS: Record<string, string> = {
  a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', c: 'ç', n: 'ñ', s: 'ś', z: 'ź', y: 'ý',
  A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', C: 'Ç', N: 'Ñ', S: 'Ś', Z: 'Ź', Y: 'Ý',
};
export function factice(fr: string): string {
  const morceaux = fr.split(/(\{(?:de:)?[a-zA-Z_]+\})/);
  const accentue = morceaux.map((m) => (m.startsWith('{') ? m : [...m].map((c) => ACCENTS[c] ?? c).join(''))).join('');
  const longueur = [...fr].length;
  const manque = Math.ceil(longueur * 0.4) + 2;
  return `⟦${accentue} ${'·'.repeat(Math.max(1, manque - 3))}⟧`;
}

// La langue d'une requête : l'en-tête `x-langue: factice` pour les essais ; sinon le français (la
// langue de chaque personne viendra avec l'anglais, vague 4).
export const langueDe = (entetes: Record<string, string | string[] | undefined>): Langue =>
  (entetes['x-langue'] === 'factice' ? 'factice' : 'fr');

// Rendre tous les textes d'un corps de réponse, dans la langue du lecteur.
export function rendreTout(v: unknown, langue: Langue): unknown {
  if (v instanceof Texte) return rendre(v, langue);
  if (Array.isArray(v)) return v.map((x) => rendreTout(x, langue));
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rendreTout(x, langue)]));
  }
  return v;
}
