// Le texte de l'aide part à part (04/11/2026, 1.273.0 ; docs/leger.md, L9).
//
// `v10/guide.js` porte deux choses : ce que chaque écran lit en se dessinant (le titre de chaque bulle « i », le titre et
// le sous-titre de chaque article, les thèmes, les gestes) et ce qu'on ne lit qu'en ouvrant une bulle ou un article
// (l'explication de la bulle, `d`, et le corps de l'article, `body`) : 61 Ko et 38 Ko compressés, à la première ouverture,
// pour un texte que personne n'a encore demandé. À la construction, la seconde part quitte `guide.js` pour
// `guide-textes.js`, que la page charge au premier geste qui la lit (modules/socle/ecrans/entreprise/app-1.js,
// `chargerTextes`) et que `SkanGuide.poserTextes` remet à sa place.
//
// Le fichier du dépôt reste UN (modules/socle/aide/guide.js) : on écrit une bulle à un seul endroit, son titre à côté de
// son texte. Node et le développement le lisent entier. La coupe se fait sur l'arbre du script (l'analyseur que Vite
// embarque, comme pour les commentaires, alleger.ts), jamais sur son texte : une valeur coupée est une chaîne ou un
// gabarit sans expression, copié octet pour octet ; autre chose arrête la construction. Chaque ligne reste à sa place
// (un corps d'article sur trente lignes en laisse trente vides), pour qu'une erreur signalée pointe la ligne du dépôt.

import fs from 'node:fs';
import path from 'node:path';
import { parseSync } from 'rolldown/utils';

type Noeud = { type: string; start: number; end: number; [cle: string]: unknown };

const estNoeud = (x: unknown): x is Noeud => !!x && typeof x === 'object' && typeof (x as Noeud).type === 'string';

// La déclaration « const NOM = … » du script, où qu'elle soit.
function declaration(racine: Noeud, nom: string): Noeud | null {
  const pile: unknown[] = [racine];
  while (pile.length) {
    const n = pile.pop();
    if (Array.isArray(n)) { pile.push(...n); continue; }
    if (!estNoeud(n)) continue;
    if (n.type === 'VariableDeclarator' && estNoeud(n.id) && n.id.name === nom && estNoeud(n.init)) return n.init;
    for (const [cle, v] of Object.entries(n)) if (cle !== 'type' && v && typeof v === 'object') pile.push(v);
  }
  return null;
}

const nomDe = (p: Noeud): string | null => {
  const k = p.key;
  if (!estNoeud(k)) return null;
  if (k.type === 'Identifier') return String(k.name);
  if (k.type === 'Literal' && typeof k.value === 'string') return k.value;
  return null;
};

// Une valeur qu'on peut déplacer telle quelle : une chaîne, ou un gabarit sans « ${ } ».
function texteDeplacable(code: string, v: unknown, ou: string): string {
  if (estNoeud(v) && v.type === 'Literal' && typeof v.value === 'string') return code.slice(v.start, v.end);
  if (estNoeud(v) && v.type === 'TemplateLiteral' && Array.isArray(v.expressions) && v.expressions.length === 0) return code.slice(v.start, v.end);
  throw new Error(`guide.js : ${ou} n'est ni une chaîne ni un gabarit sans expression ; la construction s'arrête plutôt que de couper à moitié.`);
}

type Coupe = { debut: number; fin: number };

// Un saut de ligne (« \r\n » en compte un seul), écrit en échappements : les deux derniers coupent une ligne de code.
const FIN_DE_LIGNE = /\r\n|[\n\r\u2028\u2029]/g;

// La propriété `cle` d'un objet littéral, retirée avec la virgule qui la sépare de sa voisine : ce qui est coupé, et sa valeur.
function couperPropriete(code: string, objet: Noeud, cle: string, ou: string): { coupe: Coupe; valeur: string } | null {
  const props = (objet.properties as Noeud[]).filter(estNoeud);
  const i = props.findIndex((p) => p.type === 'Property' && nomDe(p) === cle);
  if (i < 0) return null;
  const p = props[i] as Noeud;
  const valeur = texteDeplacable(code, p.value, ou);
  const avant = props[i - 1];
  const apres = props[i + 1];
  // Avec sa virgule : celle d'avant s'il y a une voisine avant, sinon celle d'après.
  const coupe = avant ? { debut: avant.end, fin: p.end } : apres ? { debut: p.start, fin: apres.start } : { debut: p.start, fin: p.end };
  return { coupe, valeur };
}

// Le texte sans ses coupes ; chaque coupe laisse autant de sauts de ligne qu'elle en couvrait.
function sansCoupes(code: string, coupes: Coupe[]): string {
  const triees = [...coupes].sort((a, b) => a.debut - b.debut);
  const morceaux: string[] = [];
  let pos = 0;
  for (const c of triees) {
    if (c.debut < pos) throw new Error('guide.js : deux coupes se chevauchent.');
    morceaux.push(code.slice(pos, c.debut), '\n'.repeat((code.slice(c.debut, c.fin).match(FIN_DE_LIGNE) ?? []).length));
    pos = c.fin;
  }
  morceaux.push(code.slice(pos));
  return morceaux.join('');
}

// `guide.js` coupé en deux : ce que les écrans lisent en se dessinant, et le texte qu'on ne lit qu'en ouvrant.
export function decouperLeGuide(code: string, nom = 'guide.js'): { leger: string; textes: string } {
  const lu = parseSync(nom, code);
  if (lu.errors.length) throw new Error(`${nom} : ${lu.errors[0]?.message ?? 'illisible'}`);
  const programme = lu.program as unknown as Noeud;
  const info = declaration(programme, 'INFO');
  const articles = declaration(programme, 'ARTICLES');
  if (!info || info.type !== 'ObjectExpression') throw new Error(`${nom} : INFO introuvable.`);
  if (!articles || articles.type !== 'ArrayExpression') throw new Error(`${nom} : ARTICLES introuvable.`);
  const coupes: Coupe[] = [];
  const bulles: string[] = [];
  for (const p of (info.properties as Noeud[]).filter(estNoeud)) {
    const cle = nomDe(p);
    if (p.type !== 'Property' || cle === null || !estNoeud(p.value) || p.value.type !== 'ObjectExpression') throw new Error(`${nom} : une bulle d'INFO n'est pas « 'clé': { … } ».`);
    const c = couperPropriete(code, p.value, 'd', `l'explication de la bulle « ${cle} »`);
    if (!c) continue;
    coupes.push(c.coupe);
    bulles.push(`${JSON.stringify(cle)}: ${c.valeur}`);
  }
  const corps: string[] = [];
  for (const a of (articles.elements as unknown[]).filter(estNoeud)) {
    if (a.type !== 'ObjectExpression') throw new Error(`${nom} : un article n'est pas un objet.`);
    const idProp = (a.properties as Noeud[]).find((p) => estNoeud(p) && nomDe(p) === 'id');
    const id = idProp && estNoeud(idProp.value) && idProp.value.type === 'Literal' ? idProp.value.value : null;
    if (typeof id !== 'string') throw new Error(`${nom} : un article sans identifiant écrit en toutes lettres.`);
    const c = couperPropriete(code, a, 'body', `le corps de l'article « ${id} »`);
    if (!c) throw new Error(`${nom} : l'article « ${id} » n'a pas de corps.`);
    coupes.push(c.coupe);
    corps.push(`${JSON.stringify(id)}: ${c.valeur}`);
  }
  const textes = [
    '// Le texte des bulles « i » et des articles d\'Aide, coupé de guide.js à la construction (web/decouper-guide.ts).',
    '(function (G) {',
    '  if (!G || typeof G.poserTextes !== \'function\') return;',
    `  G.poserTextes({ info: {\n${bulles.map((b) => `    ${b},`).join('\n')}\n  }, corps: {\n${corps.map((b) => `    ${b},`).join('\n')}\n  } });`,
    '})(typeof self !== \'undefined\' ? self.SkanGuide : null);',
    '',
  ].join('\n');
  return { leger: sansCoupes(code, coupes), textes };
}

// Dans les écrans construits, sur place : `v10/guide.js` allégé, `v10/guide-textes.js` à côté de lui.
export function decouperLeGuideConstruit(racine: string): { avant: number; apres: number; textes: number } {
  const fichier = path.join(racine, 'v10', 'guide.js');
  const code = fs.readFileSync(fichier, 'utf8');
  const { leger, textes } = decouperLeGuide(code, fichier);
  fs.writeFileSync(fichier, leger);
  fs.writeFileSync(path.join(racine, 'v10', 'guide-textes.js'), textes);
  return { avant: Buffer.byteLength(code), apres: Buffer.byteLength(leger), textes: Buffer.byteLength(textes) };
}
