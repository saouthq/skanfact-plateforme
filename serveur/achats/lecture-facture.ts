// Ce que dit une facture d'achat, tiré du texte qu'en a lu le moteur (brique 84 ; 14 § 2.3 ; docs/achats.md).
// Pur : du texte en entrée (celui d'un PDF, ou celui que Tesseract a lu sur une photo), une PROPOSITION en
// sortie. Rien ne s'enregistre ici : la personne relit, corrige et valide dans la fenêtre de la v10
// (`ocrReviewForm`), qui reçoit la proposition sous la forme qu'elle attend (`ocrToPurchase`, core.js).
//
// Trois règles du cadrage :
//   - chaque champ proposé dit OÙ il a été lu (`ou` : la ligne de la pièce) ;
//   - deux chemins, un chiffre : le total se RECOMPTE depuis les montants lus (hors taxes, TVA, timbre,
//     FODEC) ; s'il ne tombe pas sur le total lu, une remarque le dit, et rien n'est choisi à la place de
//     la personne ;
//   - aucun taux écrit dans le code : un taux se lit sur la pièce, tel qu'elle l'imprime.
//
// Le texte d'un moteur de lecture est imparfait (« Factu re », « N E T À PAY E R », un « 1 » lu « sh ») :
// les étiquettes se cherchent sur une forme COMPACTE de la ligne (minuscules, sans accents, sans espaces
// ni ponctuation), et les montants se lisent sur la ligne elle-même, après l'étiquette trouvée.
// Les montants sont des entiers en millièmes de l'unité de la pièce (3 décimales ; un montant en euros
// lu « 12,50 » vaut 12 500), les prix unitaires en millionièmes : jamais un nombre à virgule (01 R3).

import { versTexte } from '../../moteur/argent.ts';
import { motif, t, type Texte } from '../../textes/index.ts';
import './textes.ts';

export type LigneLue = { label: string | Texte; qty: string; unitPrice: string; vatRate: string | null };
export type Lecture = {
  supplier: string | null; matricule: string | null; number: string | null; date: string | null; dueDate: string | null;
  subject: string | null; currency: string | null; fees: string | null; totalHT: string | null; totalTTC: string | null;
  lines: LigneLue[];
};
export type Champ = 'supplier' | 'matricule' | 'number' | 'date' | 'dueDate' | 'subject' | 'fees' | 'totalHT' | 'totalTTC';
export type Proposition = {
  lecture: Lecture;
  ou: Partial<Record<Champ, string>>;
  remarques: Texte[];
  // Ce que les deux chemins ont compté (en millièmes) : `recompte` depuis les montants lus, `lu` le total
  // de la pièce ; `juste` : ils tombent ensemble (null : l'un des deux manque).
  controle: { recompte: bigint | null; lu: bigint | null; juste: boolean | null; lignes: 'detail' | 'par_taux' | 'aucune' };
};

// ── Les lignes du texte ──────────────────────────────────────────────────────────────────────────

type Ligne = { texte: string; compact: string; carte: number[] };

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

function preparer(brut: string): Ligne {
  const texte = brut.replace(/[\u00a0\u202f\u2007\t]/g, ' ').replace(/[\u2019\u0060]/g, '\'').replace(/ {2,}/g, ' ').trim();
  let compact = '';
  const carte: number[] = [];
  for (let i = 0; i < texte.length; i++) {
    for (const x of sansAccents(texte.charAt(i)).toLowerCase()) {
      if (/[a-z0-9%]/.test(x)) { compact += x; carte.push(i); }
    }
  }
  return { texte, compact, carte };
}
const compacte = (s: string) => preparer(s).compact;

// Une étiquette cherchée sur la forme compacte ; sa place rendue dans le texte de la ligne.
type Trouve = { debut: number; fin: number; mot: string };
function chercher(l: Ligne, re: RegExp): Trouve[] {
  const sortie: Trouve[] = [];
  for (const m of l.compact.matchAll(new RegExp(re.source, 'g'))) {
    if (!m[0]) continue;
    const debut = l.carte[m.index] ?? 0;
    sortie.push({ debut, fin: (l.carte[m.index + m[0].length - 1] ?? debut) + 1, mot: m[0] });
  }
  return sortie;
}

// ── Les nombres ──────────────────────────────────────────────────────────────────────────────────

type Montant = { valeur: bigint; debut: number; fin: number };

// « 1 234,567 », « 1.234,567 », « 1234.567 », « 332,222 », « 12,50 » : une partie décimale de 1 à 3
// chiffres, des milliers séparés par une espace ou un point (virgule décimale), ou par une espace ou une
// virgule (point décimal). Un nombre sans décimales n'est pas un montant (une quantité, une année).
const MONTANT = /(?<![\d.,])(\d{1,3}(?:[ .]\d{3})+|\d+),(\d{1,3})(?!\d)|(?<![\d.,])(\d{1,3}(?:[ ,]\d{3})+|\d+)\.(\d{1,3})(?!\d)/g;
const enMillemes = (entiers: string, fraction: string) => BigInt(entiers.replace(/[ .,]/g, '') + fraction.padEnd(3, '0').slice(0, 3));

function montantsDans(texte: string, depuis = 0, jusqua = texte.length): Montant[] {
  const sortie: Montant[] = [];
  for (const m of texte.slice(depuis, jusqua).matchAll(MONTANT)) {
    sortie.push({ valeur: enMillemes(m[1] ?? m[3] ?? '', m[2] ?? m[4] ?? ''), debut: depuis + m.index, fin: depuis + m.index + m[0].length });
  }
  return sortie;
}

// Un taux imprimé : « 19% », « 19 % », « 19,00 % », « 1,5% ». En millièmes de point (19 % = 19 000).
const TAUX = /(?<![\d.,])(\d{1,2})(?:[.,](\d{1,3}))?\s?%/g;
function tauxDans(texte: string, depuis = 0, jusqua = texte.length) {
  return [...texte.slice(depuis, jusqua).matchAll(TAUX)].map((m) => ({
    valeur: BigInt((m[1] ?? '0') + (m[2] ?? '').padEnd(3, '0').slice(0, 3)), debut: depuis + m.index, fin: depuis + m.index + m[0].length,
  }));
}
const tauxEnTexte = (v: bigint) => versTexte(v, 3).replace(/\.?0+$/, '');
// Un nombre d'une rangée, en millièmes (« 3 » → 3 000, « 42,350 » → 42 350, « 1 073,190 » → 1 073 190).
function millemes(texte: string): bigint | null {
  const m = /^(\d+)(?:[.,](\d{1,3}))?$/.exec(texte.replace(/ /g, ''));
  return m ? BigInt((m[1] ?? '0') + (m[2] ?? '').padEnd(3, '0')) : null;
}
// Un prix unitaire en millionièmes, écrit sans zéro inutile (« 42.35 », « 33.333333 »).
const prixEnTexte = (micro: bigint) => versTexte(micro, 6).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

// ── Les dates ────────────────────────────────────────────────────────────────────────────────────

const MOIS: [RegExp, number][] = [
  [/^janv/, 1], [/^f[eé]v/, 2], [/^mars/, 3], [/^avr/, 4], [/^mai/, 5], [/^juin/, 6],
  [/^juil/, 7], [/^ao[uû]/, 8], [/^sept/, 9], [/^oct/, 10], [/^nov/, 11], [/^d[eé]c/, 12],
];
type DateLue = { iso: string; debut: number; fin: number };

function jour(a: number, m: number, j: number): string | null {
  if (a < 2000 || a > 2099 || m < 1 || m > 12 || j < 1 || j > 31) return null;
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCMonth() === m - 1 ? d.toISOString().slice(0, 10) : null;
}

function datesDans(texte: string): DateLue[] {
  const sortie: DateLue[] = [];
  const ajouter = (iso: string | null, m: RegExpMatchArray) => { if (iso) sortie.push({ iso, debut: m.index ?? 0, fin: (m.index ?? 0) + m[0].length }); };
  for (const m of texte.matchAll(/(?<!\d)(\d{1,2}) ?[/.-] ?(\d{1,2}) ?[/.-] ?(\d{4}|\d{2})(?!\d)/g)) {
    const a = Number(m[3]);
    ajouter(jour(a < 100 ? 2000 + a : a, Number(m[2]), Number(m[1])), m);
  }
  for (const m of texte.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) ajouter(jour(Number(m[1]), Number(m[2]), Number(m[3])), m);
  for (const m of texte.matchAll(/(?<!\d)(\d{1,2})(?:er)? ([A-Za-zéûÉÛ]{3,9})\.? (\d{4})(?!\d)/g)) {
    const mois = MOIS.find(([re]) => re.test((m[2] ?? '').toLowerCase()))?.[1];
    ajouter(mois ? jour(Number(m[3]), mois, Number(m[1])) : null, m);
  }
  return sortie.sort((x, y) => x.debut - y.debut);
}
const SEMBLE_DATE = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;

// ── Le matricule fiscal ──────────────────────────────────────────────────────────────────────────

// Sept chiffres, la lettre clé, le code de TVA, la catégorie et l'établissement : « 1234567A/B/M/000 »,
// « 1234567 A B M 000 », « 1234567ABM000 ». Comparé sans ses séparateurs.
const MATRICULE = /(?<![\dA-Z])(\d{7}) ?[/.\- ]? ?([A-Z]) ?[/.\- ]? ?([A-Z]) ?[/.\- ]? ?([A-Z]) ?[/.\- ]? ?(\d{3}|[0O]{3})(?![\dA-Z])/g;
export const compacterMatricule = (m: string) => sansAccents(m).toUpperCase().replace(/[^0-9A-Z]/g, '');
type MatriculeLu = { lisible: string; compact: string; ligne: number; debut: number };

// ── Les étiquettes (sur la forme compacte) ───────────────────────────────────────────────────────

const ETIQUETTES = {
  ht: /(?:total|montant|net|soustotal)(?:net|general)?h(?:ors)?t(?:axes?|va)?(?:net|brut)?|nethorstaxes?|totalhorstva/,
  tva: /(?<![a-z])tva|montanttva|totaltva/,
  timbre: /(?:droitde)?timbre(?:fiscal)?/,
  fodec: /fodec/,
  ttc: /(?:total|montant|net)?ttc/,
  net: /(?:net|total|montant|reste)a(?:payer|regler)(?:ttc)?/,
  retenue: /retenue(?:a)?(?:la)?source/,
  remise: /remise|escompte/,
} as const;
type Sorte = keyof typeof ETIQUETTES;
type Etiquette = Trouve & { sorte: Sorte; ligne: number };
type Lu = { e: Etiquette; montants: Montant[]; taux: bigint[]; ligne: number };

// Les montants d'une étiquette : entre elle et l'étiquette suivante de la même ligne ; à défaut, la
// ligne suivante si elle ne porte qu'un montant (l'étiquette au-dessus de sa valeur).
function montantsDe(e: Etiquette, lignes: Ligne[], toutes: Etiquette[]): Lu {
  const l = lignes[e.ligne];
  if (!l) return { e, montants: [], taux: [], ligne: e.ligne };
  const suivante = toutes.filter((x) => x.ligne === e.ligne && x.debut >= e.fin).sort((a, b) => a.debut - b.debut)[0];
  const jusqua = suivante ? suivante.debut : l.texte.length;
  const taux = tauxDans(l.texte, e.fin, jusqua);
  // Un taux n'est pas un montant : « 19,00 % » se retire avant de lire les montants.
  const montants = montantsDans(l.texte, e.fin, jusqua).filter((m) => !taux.some((x) => m.debut >= x.debut && m.fin <= x.fin));
  if (montants.length) return { e, montants, taux: taux.map((x) => x.valeur), ligne: e.ligne };
  const dessous = lignes[e.ligne + 1];
  if (dessous && !toutes.some((x) => x.ligne === e.ligne + 1) && /^[\d\s.,]+(?:DT|TND|€|EUR)?$/i.test(dessous.texte)) {
    return { e, montants: montantsDans(dessous.texte), taux: taux.map((x) => x.valeur), ligne: e.ligne + 1 };
  }
  return { e, montants: [], taux: taux.map((x) => x.valeur), ligne: e.ligne };
}

// ── Les rangées du tableau des articles ──────────────────────────────────────────────────────────

// `prix` en millionièmes : le prix NET (remise de la ligne déduite), qui refait exactement le total de
// la rangée, comme la lecture d'une facture TEIF (un achat de la v10 n'a pas de remise par ligne).
type Rangee = { label: string; quantite: bigint; prix: bigint; total: bigint; taux: bigint | null; verifiee: boolean };

const ENTETE_TABLEAU = /(?:designation|description|libelle|article|produit|intitule|prestation)/;
const ENTETE_COLONNES = /(?:qte|quantite|qt|pu|prix|montant|total)/;
const FIN_TABLEAU = /^(?:total|soustotal|montant|net|arrete|reglement|tva|timbre|remise|base|taux|fodec|report|conditions|modedepaiement)/;
const UNITE = /^(?:u|un|unit[eé]s?|pce|pcs|pi[eè]ces?|kg|g|t|m|ml|m2|m²|m3|m³|l|h|j|jours?|heures?|ens|lot|forfait|bte|boites?|sac|paq)$/i;

// La queue chiffrée d'une rangée : les nombres et les taux au bout de la ligne (une unité entre deux
// nombres s'y saute) ; ce qui précède est le libellé. Chaque nombre garde sa place (le rang de son mot) :
// le libellé se recoupe dans le texte, unités comprises (« Colle à bois 5 kg »).
type Nombre = { texte: string; mot: number };
function queue(texte: string): { mots: string[]; nombres: Nombre[]; taux: bigint[]; debut: number } {
  // Les traits d'un tableau, lus comme des « | », ne sont pas des mots.
  const mots = texte.replace(/[|¦]+/g, ' ').replace(/ {2,}/g, ' ').trim().split(' ');
  const nombres: Nombre[] = [];
  const taux: bigint[] = [];
  let i = mots.length - 1;
  for (; i >= 0; i--) {
    const m = mots[i] ?? '';
    if (/^\d+(?:[.,]\d+)?$/.test(m)) nombres.unshift({ texte: m, mot: i });
    else if (/^\d{1,2}(?:[.,]\d{1,3})?%$/.test(m)) taux.unshift(millemes(m.slice(0, -1)) ?? 0n);
    else if (m === '%' && /^\d{1,2}(?:[.,]\d{1,3})?$/.test(mots[i - 1] ?? '')) { taux.unshift(millemes(mots[i - 1] ?? '') ?? 0n); i--; }
    else if (/^(?:DT|TND|EUR|€|USD)$/i.test(m)) continue;
    else if (UNITE.test(m) && nombres.length && /^\d+(?:[.,]\d+)?$/.test(mots[i - 1] ?? '')) continue;
    else break;
  }
  return { mots, nombres, taux, debut: i + 1 };
}

// Les façons de lire une suite de nombres séparés par des espaces : « 1 073,190 » est 1 073,190 ou bien
// 1 et 73,190. Chaque jonction « nombre de 1 à 3 chiffres, puis trois chiffres » peut se coller.
function groupements(nombres: Nombre[]): Nombre[][] {
  if (nombres.length > 8) return [nombres];
  const sorties: Nombre[][] = [];
  const suivre = (i: number, courant: Nombre[]) => {
    if (i >= nombres.length) { sorties.push(courant); return; }
    const n = nombres[i];
    if (!n) return;
    suivre(i + 1, [...courant, n]);
    const dernier = courant.at(-1);
    if (dernier && dernier.mot + 1 === n.mot && /^\d{1,3}(?: \d{3})*$/.test(dernier.texte) && /^\d{3}(?:[.,]\d{1,3})?$/.test(n.texte)) {
      suivre(i + 1, [...courant.slice(0, -1), { texte: `${dernier.texte} ${n.texte}`, mot: dernier.mot }]);
    }
  };
  suivre(0, []);
  return sorties;
}

// Une rangée : trouver quantité × prix = total (remise de la ligne comprise). Le total est le dernier
// nombre, ou l'avant-dernier (une colonne TTC après lui) ; la quantité précède le prix. Une lecture qui
// laisse des nombres de côté entre la quantité et le total est moins sûre qu'une qui les emploie tous.
export type Colonne = 'remise' | 'tva';
function lireRangee(texte: string, colonnes: Colonne[] = []): Rangee | null {
  const { mots, nombres, taux, debut } = queue(texte);
  if (!nombres.length) return null;
  // Quand l'en-tête nomme ses colonnes en pour-cent (« Remise », « TVA »), chaque taux lu est ce que dit
  // sa colonne : une remise de 0 % n'est pas une TVA à 0 %.
  const parColonne = colonnes.length === taux.length && taux.length > 0;
  const remiseDite = parColonne ? taux[colonnes.indexOf('remise')] ?? null : null;
  const tvaDite = parColonne ? taux[colonnes.indexOf('tva')] ?? null : null;
  // Le libellé : les mots avant le premier nombre employé (ou avant la queue).
  const libelle = (premier: number) => mots.slice(0, Math.max(premier, 0)).join(' ').trim();
  let meilleure: (Rangee & { score: number }) | null = null;
  for (const g of groupements(nombres)) {
    const vals = g.map((x) => millemes(x.texte));
    if (vals.some((x) => x === null)) continue;
    const v = vals as bigint[];
    const n = v.length;
    for (const iTotal of [n - 1, n - 2]) {
      if (iTotal < 0) continue;
      const total = v[iTotal] ?? 0n;
      for (let iPrix = iTotal - 1; iPrix >= 0; iPrix--) {
        const prix = v[iPrix] ?? 0n;
        for (const deduite of [false, true]) {
        const iQte = deduite ? -1 : iPrix - 1;
        // Déduite : la quantité n'est pas lue, et un vrai prix (écrit avec ses décimales, « 68,900 ») divise
        // exactement le total en un nombre entier d'unités. « 1 500,000 » n'est pas 500 fois 1.
        const unPrix = /[.,]/.test(g[iPrix]?.texte ?? '');
        const qte = deduite ? (unPrix && prix > 0n && (total * 1000n) % prix === 0n && ((total * 1000n) / prix) % 1000n === 0n ? (total * 1000n) / prix : 0n)
          : iQte >= 0 ? (v[iQte] ?? 0n) : 1000n;
        if (qte <= 0n || (deduite && qte === 1000n)) continue;
        const brut = (qte * prix + 500n) / 1000n;
        const tolerance = qte / 1000n + 1n;
        const remise = (parColonne ? [remiseDite ?? 0n] : [0n, ...taux]).find((r) => {
          const net = r === 0n ? brut : (brut * (100_000n - r) + 50_000n) / 100_000n;
          return (net > total ? net - total : total - net) <= tolerance;
        });
        if (remise === undefined) continue;
        const premier = iQte >= 0 ? iQte : iPrix;
        const aGauche = g.slice(0, premier);
        const score = 100 - (iTotal - iPrix - 1) * 10 - (n - 1 - iTotal) * 3 - (iQte < 0 ? 1 : 0) - (deduite ? 4 : 0)
          - aGauche.filter((x) => /[.,]/.test(x.texte)).length * 5 - aGauche.length;
        if (meilleure && score <= meilleure.score) continue;
        const tva = parColonne ? tvaDite : taux.filter((x) => remise === 0n || x !== remise).at(-1) ?? null;
        meilleure = {
          label: libelle(g[premier]?.mot ?? debut), quantite: qte,
          prix: remise === 0n ? prix * 1000n : (total * 1_000_000n + qte / 2n) / qte,
          total, taux: tva, verifiee: true, score,
        };
        }
      }
    }
  }
  if (meilleure) return { label: meilleure.label, quantite: meilleure.quantite, prix: meilleure.prix, total: meilleure.total, taux: meilleure.taux, verifiee: true };
  // Rien ne se vérifie : le total est le dernier nombre de la lecture la plus collée (« 1 500,000 » est
  // mille cinq cents), pour une quantité de 1 ; la rangée est à relire.
  const colle = groupements(nombres).reduce((a, b) => (b.length < a.length ? b : a), nombres);
  const dernier = colle.at(-1);
  const total = dernier ? millemes(dernier.texte) : null;
  if (total === null || !dernier) return null;
  return { label: libelle(dernier.mot), quantite: 1000n, prix: total * 1000n, total, taux: parColonne ? tvaDite : taux.at(-1) ?? null, verifiee: false };
}

// Le taux des rangées dont la pièce n'imprime pas le taux (ou que le moteur n'a pas lu), quand la pièce
// annonce ses bases taux par taux : la répartition des rangées qui refait EXACTEMENT chaque base. Une
// seule répartition possible : elle est proposée ; plusieurs, ou aucune : les taux restent à vérifier.
function repartir(rangees: Rangee[], bases: { taux: bigint; base: bigint }[]) {
  const sans = rangees.filter((r) => r.taux === null);
  if (!sans.length || bases.length ** sans.length > 50_000) return;
  const reste = new Map(bases.map((b) => [b.taux, b.base - somme(rangees.filter((r) => r.taux === b.taux).map((r) => r.total))]));
  const choix: bigint[] = [];
  const trouvees: bigint[][] = [];
  const essayer = (i: number) => {
    if (trouvees.length > 1) return;
    if (i === sans.length) {
      if ([...reste.values()].every((x) => x >= -2n && x <= 2n)) trouvees.push([...choix]);
      return;
    }
    for (const b of bases) {
      const r = reste.get(b.taux) ?? 0n;
      const t = sans[i]?.total ?? 0n;
      if (r - t < -2n) continue;
      reste.set(b.taux, r - t);
      choix.push(b.taux);
      essayer(i + 1);
      choix.pop();
      reste.set(b.taux, r);
    }
  };
  essayer(0);
  const seule = trouvees.length === 1 ? trouvees[0] : undefined;
  if (seule) sans.forEach((r, i) => { r.taux = seule[i] ?? null; });
}

// ── La lecture ───────────────────────────────────────────────────────────────────────────────────

const LONGUEUR_OU = 120;
const court = (s: string | undefined) => { const x = s ?? ''; return x.length > LONGUEUR_OU ? `${x.slice(0, LONGUEUR_OU - 1)}…` : x; };
const ecart = (a: bigint, b: bigint) => (a > b ? a - b : b - a);
const somme = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

// Un montant écrit comme à l'écran : « 1 234,567 DT » (espaces insécables, comme `money` de la v10).
function enClair(v: bigint, devise: string | null): string {
  const [e = '0', f = '000'] = versTexte(v < 0n ? -v : v, 3).split('.');
  // Un euro ou un dollar a deux décimales : le millième lu vaut toujours 0 (« 12,50 » se lit 12 500).
  const decimales = devise && devise !== 'TND' && f.endsWith('0') ? f.slice(0, 2) : f;
  return `${v < 0n ? '−\u00a0' : ''}${e.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')},${decimales}\u00a0${devise && devise !== 'TND' ? devise : 'DT'}`;
}

export type Options = {
  // Le matricule de l'entreprise qui lit (l'acheteur) : il n'est jamais pris pour celui du fournisseur.
  notreMatricule?: string | null;
};

type Place = { valeur: string; ligne: number; dessus?: number };

export function lireFacture(texteLu: string, options: Options = {}): Proposition {
  const lignes = texteLu.split(/\r?\n/).map(preparer).filter((l) => l.texte.length > 0);
  const ou: Partial<Record<Champ, string>> = {};
  const remarques: Texte[] = [];
  const nous = options.notreMatricule ? compacterMatricule(options.notreMatricule) : '';
  const noter = (champ: Champ, p: { ligne: number; dessus?: number | undefined }) => {
    ou[champ] = court([p.dessus !== undefined ? lignes[p.dessus]?.texte : undefined, lignes[p.ligne]?.texte].filter(Boolean).join(' · '));
  };

  // La devise : celle que la pièce nomme le plus (le dinar, sauf mention contraire).
  const tout = lignes.map((l) => l.texte).join('\n');
  const compter = (re: RegExp) => [...tout.matchAll(re)].length;
  const devises: [string, number][] = [
    ['TND', compter(/(?<![A-Za-z])(?:TND|DT)(?![A-Za-z])|dinars?/gi)], ['EUR', compter(/(?<![A-Za-z])EUR(?![A-Za-z])|€|euros?/gi)], ['USD', compter(/(?<![A-Za-z])USD(?![A-Za-z])|dollars?/gi)],
  ];
  const plus = devises.sort((a, b) => b[1] - a[1]);
  const devise = (plus[0]?.[1] ?? 0) > (plus[1]?.[1] ?? 0) ? (plus[0]?.[0] ?? null) : null;

  // Les matricules, dans l'ordre de la pièce : le premier qui n'est pas le nôtre est celui du fournisseur.
  const matricules: MatriculeLu[] = [];
  lignes.forEach((l, i) => {
    for (const m of sansAccents(l.texte).toUpperCase().matchAll(MATRICULE)) {
      const etab = (m[5] ?? '').replace(/O/g, '0');
      matricules.push({ lisible: `${m[1]}${m[2]}/${m[3]}/${m[4]}/${etab}`, compact: `${m[1]}${m[2]}${m[3]}${m[4]}${etab}`, ligne: i, debut: m.index });
    }
  });
  const duFournisseur = matricules.find((m) => m.compact !== nous) ?? null;
  if (duFournisseur) noter('matricule', duFournisseur);
  // Un autre matricule que le nôtre, et le nôtre absent : la pièce est peut-être adressée à quelqu'un d'autre.
  const autres = [...new Set(matricules.filter((m) => m.compact !== nous && m.compact !== duFournisseur?.compact).map((m) => m.lisible))];
  if (nous && !matricules.some((m) => m.compact === nous) && autres[0]) remarques.push(motif('achats.lecture.autre_acheteur', { matricule: autres[0] }));

  // Le fournisseur : le nom écrit devant son matricule (« Société X — Matricule fiscal … »), sinon la
  // première ligne de la pièce qui n'est ni un titre, ni une adresse, ni un contact.
  const nettoyer = (s: string) => s.replace(/(?:matricule(?: fiscal)?|m\.? ?f\.?|code tva|identifiant(?: unique)?)\s*[:.]?\s*$/i, '')
    .replace(/[\s:—–|,-]+$/, '').replace(/^[\s:—–|,-]+/, '').trim();
  let fournisseur: Place | null = null;
  for (const m of matricules.filter((x) => x.compact === duFournisseur?.compact)) {
    const avant = nettoyer((lignes[m.ligne]?.texte ?? '').slice(0, m.debut));
    if (/\p{L}{3,}/u.test(avant) && !/^(?:mf|matricule|code|client)/i.test(avant)) { fournisseur = { valeur: avant, ligne: m.ligne }; break; }
  }
  for (let i = 0; !fournisseur && i < Math.min(lignes.length, 8); i++) {
    const nom = nettoyer((lignes[i]?.texte ?? '').replace(/(?:f\s?a\s?c\s?t\s?u\s?r\s?e|devis|original|duplicata|page \d).*$/i, ''));
    if (!/\p{L}{3,}/u.test(nom)) continue;
    if (/^(?:t[eé]l|fax|e-?mail|adresse|www|rue|avenue|av\.|route|cit[eé]|bp|mf|matricule|rc|code)/i.test(nom) || /@|\d{2} ?\d{3} ?\d{3}/.test(nom)) continue;
    fournisseur = { valeur: nom, ligne: i };
  }
  if (fournisseur) noter('supplier', fournisseur);

  // Le numéro : « Facture N° X », « N° de facture X », sinon un numéro de pièce près du titre.
  const valeurDe = (m: RegExpExecArray | null) => {
    const v = (m?.[1] ?? '').replace(/[.,;:]+$/, '');
    return v && /\d/.test(v) && !SEMBLE_DATE.test(v) && !matricules.some((x) => compacterMatricule(v).includes(x.compact)) ? v : null;
  };
  let numero: Place | null = null;
  for (const [i, l] of lignes.entries()) {
    const v = valeurDe(/fact\s?u\s?r\s?e\s*(?:d.avoir\s*)?(?:(?:n\s?[°º]|no\.?|num(?:[eé]ro)?\.?)\s*)?[:#-]?\s*([A-Za-z0-9][\w/.-]*)/i.exec(l.texte))
      ?? valeurDe(/(?:n\s?[°º]|num[eé]ro|r[eé]f(?:[eé]rence)?\.?)\s*(?:de\s*(?:la\s*)?)?fact\w*\s*[:#-]?\s*([A-Za-z0-9][\w/.-]*)/i.exec(l.texte));
    if (v) { numero = { valeur: v, ligne: i }; break; }
  }
  for (let i = 0; !numero && i < Math.min(lignes.length, 15); i++) {
    const v = valeurDe(/^(?:n\s?[°º]|no\.?)\s*[:#-]?\s*([A-Za-z0-9][\w/.-]*)/i.exec(lignes[i]?.texte ?? ''));
    if (v) numero = { valeur: v, ligne: i };
  }
  for (let i = 0; !numero && i < Math.min(lignes.length, 15); i++) {
    const sans = sansAccents(lignes[i]?.texte ?? '').toUpperCase().replace(MATRICULE, ' ');
    for (const m of sans.matchAll(/(?<![\w/-])((?:[A-Z]{1,4}[-/ ]?)?\d{2,4}[-/]\d{1,6}(?:[-/]\d{1,6})?)(?![\w/-])/g)) {
      if (m[1] && !SEMBLE_DATE.test(m[1])) { numero = { valeur: m[1], ligne: i }; break; }
    }
  }
  if (numero) noter('number', numero);

  // Les dates : celle de la pièce et l'échéance, par l'étiquette qui les précède sur la ligne, ou par
  // celle du dessus quand étiquettes et valeurs sont en colonnes (la k-ième date sous la k-ième étiquette).
  const ECHEANCE = /(?:echeance|avantle|limite|aregler|apayer|payable|reglement)/;
  const AUTRE = /(?:livraison|commande|devis|periode|validite|naissance)/;
  const PIECE = /(?:date|emise|facture|le|du)$/;
  let date: Place | null = null;
  let echeance: Place | null = null;
  for (const [i, l] of lignes.entries()) {
    const dates = datesDans(l.texte);
    for (const [k, d] of dates.entries()) {
      const segment = compacte(l.texte.slice(k > 0 ? (dates[k - 1]?.fin ?? 0) : 0, d.debut)).replace(/^[\d%]+/, '');
      let sorte: 'piece' | 'echeance' | 'autre' | null = null;
      let dessus: number | undefined;
      if (/[a-z]/.test(segment)) {
        const fin = segment.slice(-20);
        sorte = ECHEANCE.test(fin) ? 'echeance' : AUTRE.test(fin) ? 'autre' : PIECE.test(fin) || /date/.test(fin) ? 'piece' : null;
      } else if (lignes[i - 1] && !datesDans(lignes[i - 1]?.texte ?? '').length) {
        const e = [...(lignes[i - 1]?.compact ?? '').matchAll(/emisele|datedefacture|datefacture|date(?!decheance|limite)|echeance|avantle|limite|livraison|commande/g)][k]?.[0];
        if (e) { sorte = /echeance|avantle|limite/.test(e) ? 'echeance' : /livraison|commande/.test(e) ? 'autre' : 'piece'; dessus = i - 1; }
      }
      if (sorte === 'echeance' && !echeance) echeance = { valeur: d.iso, ligne: i, ...(dessus !== undefined ? { dessus } : {}) };
      if (sorte === 'piece' && !date) date = { valeur: d.iso, ligne: i, ...(dessus !== undefined ? { dessus } : {}) };
    }
  }
  // Sans étiquette : la première date de la pièce qui n'est pas l'échéance.
  for (const [i, l] of lignes.entries()) {
    if (date) break;
    const d = datesDans(l.texte).find((x) => x.iso !== echeance?.valeur);
    if (d) date = { valeur: d.iso, ligne: i };
  }
  if (date) noter('date', date);
  if (echeance) noter('dueDate', echeance);

  // L'objet : « Objet : … » sur sa ligne.
  let objet: string | null = null;
  for (const [i, l] of lignes.entries()) {
    const m = /^objet\s*:?\s*(.+)$/i.exec(l.texte);
    if (m?.[1] && /\p{L}{3,}/u.test(m[1])) { objet = m[1].trim(); noter('subject', { ligne: i }); break; }
  }

  // Les étiquettes des totaux. Une place n'en porte qu'une, la plus longue (« totalhtva » est un
  // hors-taxes, pas une TVA ; « netapayerttc » est un net à payer).
  const toutes: Etiquette[] = [];
  lignes.forEach((l, i) => {
    for (const sorte of Object.keys(ETIQUETTES) as Sorte[]) for (const tr of chercher(l, ETIQUETTES[sorte])) toutes.push({ sorte, ligne: i, ...tr });
  });
  const etiquettes = toutes.filter((e) => !toutes.some((x) => x !== e && x.ligne === e.ligne && x.debut <= e.debut && x.fin >= e.fin && x.mot.length > e.mot.length));

  // Le tableau des articles : de sa ligne d'en-tête à la première ligne de totaux.
  const iTitre = lignes.findIndex((l, i) => ENTETE_TABLEAU.test(l.compact) && (ENTETE_COLONNES.test(l.compact) || ENTETE_COLONNES.test(lignes[i + 1]?.compact ?? '')));
  const iEntete = iTitre >= 0 && !ENTETE_COLONNES.test(lignes[iTitre]?.compact ?? '') ? iTitre + 1 : iTitre;
  let iFin = iEntete;
  if (iEntete >= 0) {
    iFin = lignes.length;
    for (let i = iEntete + 1; i < lignes.length; i++) {
      if (FIN_TABLEAU.test(lignes[i]?.compact ?? '') || etiquettes.some((e) => e.ligne === i && e.sorte !== 'remise' && e.sorte !== 'tva')) { iFin = i; break; }
    }
  }
  const horsTableau = (e: Etiquette) => !(iEntete >= 0 && e.ligne >= iTitre && e.ligne < iFin);
  const de = (s: Sorte): Lu[] => etiquettes.filter((e) => e.sorte === s && horsTableau(e)).map((e) => montantsDe(e, lignes, etiquettes));
  const dernier = (x: Lu | null | undefined) => x?.montants.at(-1)?.valeur ?? null;

  const ht = de('ht').filter((x) => x.montants.length);
  const htChoisi = ht.find((x) => /net/.test(x.e.mot) && !/brut/.test(x.e.mot)) ?? ht.filter((x) => !/brut/.test(x.e.mot)).at(-1) ?? ht.at(-1) ?? null;
  const totalHT = dernier(htChoisi);
  if (htChoisi) noter('totalHT', htChoisi);

  // La TVA, taux par taux : « TVA 19 % sur 264,850 : 50,322 », ou un tableau « Taux Base Montant ».
  const parTaux = new Map<string, { taux: bigint; base: bigint | null; montant: bigint }>();
  let totalTvaLu: bigint | null = null;
  for (const x of de('tva')) {
    const taux = x.taux[0];
    if (taux === undefined) { if (x.montants.length) totalTvaLu ??= dernier(x); continue; }
    const [a, b] = x.montants;
    if (!a) continue;
    const cle = tauxEnTexte(taux);
    if (!parTaux.has(cle)) parTaux.set(cle, { taux, base: b ? a.valeur : null, montant: (b ?? a).valeur });
  }
  const iRecap = lignes.findIndex((l) => /taux/.test(l.compact) && /base/.test(l.compact));
  for (let i = iRecap + 1; iRecap >= 0 && i < Math.min(lignes.length, iRecap + 8); i++) {
    const l = lignes[i];
    const m = l ? /^(\d{1,2}(?:[.,]\d{1,3})?) ?%? /.exec(l.texte) : null;
    const taux = m ? millemes(m[1] ?? '') : null;
    const montants = l && m ? montantsDans(l.texte, m[0].length) : [];
    if (taux === null || !montants[1]) continue;
    const cle = tauxEnTexte(taux);
    if (!parTaux.has(cle)) parTaux.set(cle, { taux, base: montants[0]?.valeur ?? null, montant: montants[1].valeur });
  }
  const sommeTva = parTaux.size ? somme([...parTaux.values()].map((x) => x.montant)) : null;
  if (sommeTva !== null && totalTvaLu !== null && sommeTva !== totalTvaLu) {
    remarques.push(motif('achats.lecture.tva_total_ecart', { somme: enClair(sommeTva, devise), total: enClair(totalTvaLu, devise) }));
  }
  const tvaLue = sommeTva ?? totalTvaLu;
  for (const x of parTaux.values()) {
    if (x.base === null) continue;
    const attendu = (x.base * x.taux + 50_000n) / 100_000n;
    if (ecart(attendu, x.montant) > 2n) {
      remarques.push(motif('achats.lecture.tva_ecart', { taux: tauxEnTexte(x.taux), lu: enClair(x.montant, devise), base: enClair(x.base, devise), calcule: enClair(attendu, devise) }));
    }
  }

  const timbre = de('timbre').find((x) => x.montants.length);
  const fees = dernier(timbre);
  if (timbre) noter('fees', timbre);
  const fodec = dernier(de('fodec').find((x) => x.montants.length));
  const retenue = dernier(de('retenue').find((x) => x.montants.length));
  const ttc = de('ttc').filter((x) => x.montants.length).at(-1) ?? null;
  const net = de('net').filter((x) => x.montants.length).at(-1) ?? null;
  const netLu = dernier(net);
  // Le total de la pièce : son TTC ; à défaut son net à payer, retenue de la pièce rajoutée.
  const totalLu = dernier(ttc) ?? (netLu !== null && retenue !== null ? netLu + retenue : netLu);
  const ligneTotal = ttc ?? net;
  if (ligneTotal) noter('totalTTC', ligneTotal);

  // Les lignes des articles, et ce que l'en-tête dit de ses colonnes en pour-cent, dans leur ordre.
  const entete = iTitre >= 0 ? lignes.slice(iTitre, iEntete + 1).map((l) => l.compact).join('') : '';
  const colonnes = [...entete.matchAll(/remise|rem|escompte|tva|taux/g)].map((m): Colonne => (/^(?:tva|taux)$/.test(m[0]) ? 'tva' : 'remise'))
    .filter((c, i, a) => i === 0 || c !== a[i - 1]);
  const rangees: Rangee[] = [];
  let enAttente = '';
  for (let i = iEntete + 1; iEntete >= 0 && i < iFin; i++) {
    const texte = lignes[i]?.texte ?? '';
    const r = lireRangee(texte, colonnes);
    if (r && r.total > 0n) {
      rangees.push({ ...r, label: [enAttente, r.label].filter(Boolean).join(' ') });
      enAttente = '';
    } else if (/\p{L}{2,}/u.test(texte)) {
      // Un libellé sur deux lignes : la suite de la rangée d'avant, sinon le début de la suivante.
      const precedente = rangees.at(-1);
      if (precedente) precedente.label = `${precedente.label} ${texte}`;
      else enAttente = `${enAttente} ${texte}`.trim();
    }
  }
  const bases = [...parTaux.values()].filter((x): x is { taux: bigint; base: bigint; montant: bigint } => x.base !== null);
  const sommeBases = bases.length ? somme(bases.map((x) => x.base)) : null;
  const sommeRangees = somme(rangees.map((r) => r.total));
  const rangeesJustes = rangees.length > 0 && (totalHT !== null ? ecart(sommeRangees, totalHT) <= BigInt(rangees.length) : rangees.every((r) => r.verifiee));
  const unSeulTaux = parTaux.size === 1 ? ([...parTaux.values()][0]?.taux ?? null) : null;
  if (rangeesJustes && bases.length > 1) repartir(rangees, bases);

  type Proposee = LigneLue & { ht: bigint };
  let proposees: Proposee[] = [];
  let sorteLignes: 'detail' | 'par_taux' | 'aucune' = 'aucune';
  const deRangee = (r: Rangee): Proposee => ({
    label: r.label, qty: versTexte(r.quantite, 3).replace(/\.?0+$/, ''), unitPrice: prixEnTexte(r.prix),
    vatRate: r.taux !== null ? tauxEnTexte(r.taux) : unSeulTaux !== null ? tauxEnTexte(unSeulTaux) : null, ht: r.total,
  });
  const parTauxLu = (taux: bigint, ht: bigint): Proposee => ({ label: t('achats.lecture.ligne_taux', { taux: tauxEnTexte(taux) }), qty: '1', unitPrice: prixEnTexte(ht * 1000n), vatRate: tauxEnTexte(taux), ht });
  if (rangeesJustes) {
    proposees = rangees.map(deRangee);
    sorteLignes = 'detail';
  } else if (bases.length && (totalHT === null || sommeBases === null || ecart(sommeBases, totalHT) <= 2n)) {
    // Le détail ne se lit pas avec assez de sûreté : une ligne par taux, depuis les bases lues.
    proposees = bases.map((x) => parTauxLu(x.taux, x.base));
    sorteLignes = 'par_taux';
    remarques.push(motif(rangees.length ? 'achats.lecture.lignes_par_taux' : 'achats.lecture.lignes_absentes_par_taux'));
  } else if (rangees.length) {
    proposees = rangees.map(deRangee);
    sorteLignes = 'detail';
  } else if (totalHT !== null && totalHT > 0n && tvaLue !== null) {
    // Un seul hors-taxes, sans taux lisible : le taux se déduit de la TVA lue, s'il tombe juste sur un
    // nombre entier de pour-cent (aucun taux n'est supposé).
    const taux = (tvaLue * 100n + totalHT / 2n) / totalHT;
    if (ecart((totalHT * taux + 50n) / 100n, tvaLue) <= 2n) {
      proposees = [parTauxLu(taux * 1000n, totalHT)];
      sorteLignes = 'par_taux';
      remarques.push(motif('achats.lecture.taux_deduit', { tva: enClair(tvaLue, devise), ht: enClair(totalHT, devise), taux: taux.toString() }));
    }
  }

  // Un taux que la pièce n'imprime pas ne se suppose pas : la personne le vérifie.
  const sansTaux = proposees.filter((l) => l.vatRate === null).length;
  if (sansTaux) {
    const annonce = bases.map((x) => t('achats.lecture.base_au_taux', { montant: enClair(x.base, devise), taux: tauxEnTexte(x.taux) }));
    const cle = `achats.lecture.taux_absent${annonce.length ? '_bases' : ''}${sansTaux === 1 ? '_un' : ''}`;
    remarques.push(motif(cle, { n: sansTaux, bases: annonce }));
  }

  // Deux chemins, un chiffre : le total recompté depuis les montants lus, face au total de la pièce.
  // Sans TVA lue, une pièce dont hors-taxes et timbre font déjà le total est une pièce sans TVA.
  const htCompte = totalHT ?? (proposees.length ? somme(proposees.map((l) => l.ht)) : null);
  const tvaCompte = tvaLue ?? (htCompte !== null && totalLu !== null && htCompte + (fees ?? 0n) + (fodec ?? 0n) === totalLu ? 0n : null);
  const recompte = htCompte !== null && tvaCompte !== null ? htCompte + tvaCompte + (fees ?? 0n) + (fodec ?? 0n) : null;
  const juste = recompte !== null && totalLu !== null ? recompte === totalLu : null;
  if (juste === true) remarques.unshift(motif('achats.lecture.total_juste', { total: enClair(totalLu ?? 0n, devise) }));
  else if (juste === false) {
    const parts = [t('achats.lecture.part_ht', { montant: enClair(htCompte ?? 0n, devise) }), t('achats.lecture.part_tva', { montant: enClair(tvaCompte ?? 0n, devise) })];
    if (fees) parts.push(t('achats.lecture.part_timbre', { montant: enClair(fees, devise) }));
    if (fodec) parts.push(t('achats.lecture.part_fodec', { montant: enClair(fodec, devise) }));
    remarques.unshift(motif('achats.lecture.total_ecart', { detail: parts, calcule: enClair(recompte ?? 0n, devise), lu: enClair(totalLu ?? 0n, devise) }));
  } else if (recompte !== null) remarques.unshift(motif('achats.lecture.total_absent', { calcule: enClair(recompte, devise) }));
  else if (totalLu !== null) remarques.unshift(motif('achats.lecture.total_seul', { lu: enClair(totalLu, devise) }));
  if (fodec) remarques.push(motif('achats.lecture.fodec', { montant: enClair(fodec, devise) }));
  if (retenue) remarques.push(motif('achats.lecture.retenue', { montant: enClair(retenue, devise) }));
  if (devise && devise !== 'TND') remarques.push(motif('achats.lecture.devise', { devise }));
  if (!duFournisseur && totalLu === null && totalHT === null && !date) remarques.push(motif('achats.lecture.presque_rien'));

  return {
    lecture: {
      supplier: fournisseur?.valeur ?? null,
      matricule: duFournisseur?.lisible ?? null,
      number: numero?.valeur ?? null,
      date: date?.valeur ?? null,
      dueDate: echeance?.valeur ?? null,
      subject: objet,
      currency: devise,
      // Le timbre, et le FODEC avec lui, dans « Timbre et frais » (comme la lecture d'une facture TEIF).
      fees: fees !== null || fodec !== null ? versTexte((fees ?? 0n) + (fodec ?? 0n), 3) : null,
      totalHT: totalHT !== null ? versTexte(totalHT, 3) : null,
      totalTTC: totalLu !== null ? versTexte(totalLu, 3) : null,
      lines: proposees.map(({ label, qty, unitPrice, vatRate }) => ({ label, qty, unitPrice, vatRate })),
    },
    ou, remarques,
    controle: { recompte, lu: totalLu, juste, lignes: sorteLignes },
  };
}
