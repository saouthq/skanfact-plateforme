// Le contrôle des frontières (docs/cadrage/17-rangement.md § 4.2 ; lot R0c, 03/11/2026). Un outil maison : les outils du
// marché ne lisent que des `import`, alors que tout le code des écrans vit dans des fermetures. Il lit chaque page (ses
// scripts dans l'ordre où elle les charge, chacun assemblé de ses morceaux), analyse les portées (acorn, eslint-scope),
// rend chaque nom au morceau qui le définit, donc à son module (commun/assemblage.ts, modules/<m>/module.json), et dit
// chaque écart ; puis le cliquet (modules/frontieres-connues.json) : les écarts d'aujourd'hui sont listés, un écart neuf
// fait tomber le contrôle, un écart disparu mais encore listé aussi. La liste ne peut que baisser.
//
// Ce qu'il mesure, au lot R0c (les autres codes du § 4.2 viennent avec les lots qui les rendent mesurables : F5 et F6
// avec les portes du moteur et des données, F10 et F11 avec les registres du lot B0) :
//   F0  une coupe entre deux morceaux au milieu d'une instruction ; un morceau rangé sous modules/ que la table ignore ;
//   F1  un nom introuvable (ni dans la page, ni dans le navigateur) ;
//   F2  un nom d'un autre module lu hors de sa porte ;           F3  une lecture vers un module placé après (02 § 2) ou non déclaré ;
//   F4  le socle qui nomme un module ;                             F7  écrire dans une variable (ou une table) d'un autre module ;
//   F8  un nom défini deux fois sur la page ;                      F9  un nom lu au chargement avant sa définition ;
//   F12 un gros fichier qui grandit (ses lignes hors de modules/, au plus) ;
//   F13 au serveur, un dossier qui importe le fichier interne d'un autre module au lieu de sa porte.
//
// Où il tourne : `npm test` (tests/commun/frontieres.test.ts), `npm run frontieres`, et toute construction qui pose
// SKANFACT_CONTROLE=1 (le suiveur, exploitation/suivre.ts). JAMAIS dans les constructions des tests de navigateur : une
// preuve dont le défaut déclencherait ce refus tomberait pour une autre raison, et compterait « prouvée » à vide.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { analyze, type Reference, type Scope, type Variable } from 'eslint-scope';
import globals from 'globals';
import type { Plugin } from 'vite';
import { lireEcran, lireTable, moduleDuMorceau, morceaux, PUBLIC, RACINE_DU_DEPOT } from '../../commun/assemblage.ts';

export const CONNUS = 'modules/frontieres-connues.json';
// Les deux pages de la v10 : leurs scripts, dans l'ordre où elles les chargent.
export const PAGES: Record<string, string> = { entreprise: 'v10/index.html', cabinet: 'v10/cabinet/index.html' };
// Les gros fichiers (la règle « Le code : un dossier par module » du CLAUDE.md) : leurs lignes hors de modules/ ne
// peuvent que baisser (F12) ; après le lot A1, elles sont à zéro.
// Les fichiers de l'aide et des visites : une liste d'entrées ; une coupe tombe entre deux entrées.
const AIDE = ['v10/guide.js', 'v10/visites.js', 'v10/cabinet/cabguide.js', 'v10/cabinet/cabvisites.js'];
export const GROS = ['v10/app.js', 'v10/core.js', 'v10/compta.js', 'v10/guide.js', 'v10/visites.js', 'v10/cabinet/app.js',
  'v10/cabinet/cabguide.js', 'v10/cabinet/cabvisites.js', 'plateforme/pont.js', 'plateforme/pont-cabinet.js'];

// Ce que chaque code refuse, pourquoi, et ce qui débloque (un refus dit les trois).
export const CODES: Record<string, { quoi: string; pourquoi: string; debloque: string }> = {
  F0: { quoi: 'une coupe entre deux morceaux tombe au milieu d\'une instruction, ou un morceau rangé sous modules/ n\'est dans aucun fichier servi',
    pourquoi: 'un morceau doit se lire seul : une instruction coupée en deux appartiendrait à deux modules', debloque: 'déplace la coupe entre deux instructions (ou entre deux entrées de l\'aide), ou déclare le morceau dans modules/assemblage.json' },
  F1: { quoi: 'un nom introuvable : ni défini sur la page, ni connu du navigateur', pourquoi: 'à l\'ouverture ou au premier clic, l\'écran s\'arrête sur une erreur', debloque: 'définis le nom, corrige la faute de frappe, ou garde la lecture derrière un `typeof`' },
  F2: { quoi: 'un module lit un nom d\'un autre module hors de sa porte', pourquoi: 'le jour où l\'autre module change ou s\'éteint, celui-ci casse sans le savoir (17 § 2)', debloque: 'passe par la porte de l\'autre module (sa fiche, « porte »), ou range le nom au socle s\'il est à tout le monde' },
  F3: { quoi: 'une lecture vers un module placé après dans l\'ordre du 02 § 2, ou que la fiche ne déclare pas', pourquoi: 'les dépendances ne vont que vers le haut : sinon un module ne peut plus s\'éteindre seul', debloque: 'déclare la dépendance dans la fiche (si elle va vers le haut), ou retourne-la par un point ou un événement du socle' },
  F4: { quoi: 'le socle nomme un module', pourquoi: 'le socle est à tout le monde : s\'il nomme un module, il ne marche plus sans lui', debloque: 'le module se pose dans un emplacement, remplit un point ou écoute un événement du socle (17 § 2)' },
  F7: { quoi: 'un module écrit dans une variable (ou une table) d\'un autre', pourquoi: 'personne ne sait plus qui change quoi : seul le propriétaire écrit chez lui', debloque: 'demande au propriétaire par sa porte, ou par un registre du socle' },
  F8: { quoi: 'un nom défini deux fois sur la même page', pourquoi: 'le second écrase le premier en silence (ou la page s\'arrête, pour un `let` ou un `const`)', debloque: 'renomme l\'un des deux, ou garde une seule définition' },
  F9: { quoi: 'un nom lu à l\'ouverture de la page avant sa définition (directement, ou par une fonction appelée au chargement)', pourquoi: 'l\'ordre des morceaux change ce qui s\'exécute : l\'écran s\'arrêterait à l\'ouverture', debloque: 'définis le nom plus haut, ou fais l\'appel après sa définition' },
  F12: { quoi: 'un gros fichier grandit hors de modules/', pourquoi: 'pendant le rangement, le code neuf va dans le dossier de son module, pas dans le vieux fichier', debloque: 'écris le code neuf dans modules/<module>/ ; s\'il doit vraiment grandir, relève « auPlus » dans la liste avec la raison, dans le même envoi' },
  F13: { quoi: 'au serveur, un dossier importe le fichier interne d\'un autre module au lieu de sa porte', pourquoi: 'le module qu\'on importe ne peut plus se réorganiser sans casser les autres', debloque: 'passe par la `porte.ts` de ce module (ou range le fichier au socle)' },
};

type Noeud = { type: string; start: number; end: number; [cle: string]: unknown };
type Fiche = { code: string; dependances: string[]; porte: unknown[]; serveur?: string[]; collections?: string[]; racine?: string[] };
// Le dossier ouvert, dans les écrans de la v10 : ses collections ont chacune leur module (les fiches).
const DONNEES = 'data';
// Une mesure : chaque écart (« F2 v10/app.js personnel→ventes nom ») et son nombre (les lectures distinctes), un exemple
// de lieu pour le dire, et les lignes des gros fichiers hors de modules/.
// `atteint` dit ce que la mesure a lu, page par page (un instrument qui n'atteint rien annoncerait « tout va bien »).
export type Mesure = { comptes: Record<string, number>; exemples: Record<string, string>; lignes: Record<string, number>;
  atteint: Record<string, { scripts: number; lectures: number; auChargement: number }> };
export type Connus = { _?: string; empreinte?: string; lignes: Record<string, { auPlus: number; pourquoi: string }>; ecarts: Record<string, number> };

export class FrontiereRefusee extends Error {}

const estNoeud = (x: unknown): x is Noeud => !!x && typeof (x as Noeud).type === 'string' && typeof (x as Noeud).start === 'number';
function enfants(n: Noeud): Noeud[] {
  const r: Noeud[] = [];
  for (const k of Object.keys(n)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'range') continue;
    const v = n[k];
    if (Array.isArray(v)) { for (const x of v) if (estNoeud(x)) r.push(x); } else if (estNoeud(v)) r.push(v);
  }
  return r;
}
const estFonction = (n: Noeud | undefined): boolean => !!n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');
const debutDe = (n: unknown) => (n as Noeud).start;

// Les noms du navigateur et du langage : lus sans être définis sur la page, ils ne sont pas introuvables.
const NAVIGATEUR = new Set<string>([...Object.keys(globals.browser), ...Object.keys(globals.builtin)]);
// Les méthodes qui appellent leur fonction tout de suite (au chargement, la fonction passée s'exécute aussi).
const SYNCHRONES = new Set(['forEach', 'map', 'filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'reduce', 'reduceRight', 'flatMap', 'sort', 'from']);
const FENETRE = new Set(['window', 'self', 'globalThis']);
// Un script universel (le même fichier pour Node et le navigateur) lit ces noms derrière un test sur l'un d'eux
// (`if (typeof module === 'object' && module.exports) module.exports = factory(require('./compta'))`).
const UNIVERSEL = ['module', 'exports', 'require', 'define'];

// ——— Un fichier servi, lu et analysé une fois ———

type Bornes = { debut: number; fin: number; morceau: string; module: string }[];
type Fn = Noeud; // une fonction, ou le programme
// Ce qu'un appel vise : une fonction du fichier (avec son nom, s'il en a un), ou un nom du haut d'un script de la page.
type Vers = { fn: Fn; nom?: string } | { nom: string };
type Analyse = {
  servi: string; texte: string; debutsDeLigne: number[]; bornes: Bornes; ast: Noeud; illisible?: string;
  references: Reference[];
  // Les définitions du haut du fichier (visibles de toute la page) : nom → positions ; les fonctions du haut, pour suivre un appel.
  haut: Map<string, { pos: number; tdz: boolean }[]>; fonctionsDuHaut: Map<string, Fn>;
  fenetre: Map<string, number[]>; // window.X = … : X défini à cette position
  // Les noms lus derrière un `typeof` quelque part dans le fichier (un « module » d'un script universel, gardé par
  // `typeof module !== 'undefined'`) ; les objets dont on écrit une propriété (X.y = …).
  typeofs: Set<string>; sousTypeof: Set<Noeud>; ecrituresParPropriete: Set<Noeud>;
  // Pour chacune de ces écritures, la première clé sous l'objet (`data.payslips[i] = …` : « payslips »), si elle s'écrit.
  premiereCle: Map<Noeud, string | null>;
  // Pour F9 : la fonction qui contient chaque référence, les appels de chaque fonction, les fonctions appelées sur-le-champ.
  fonctionDe: Map<Reference, Fn>; appels: Map<Fn, { pos: number; vers: Vers }[]>; cadres: Fn[];
};

function lignesDe(texte: string): number[] {
  const d = [0];
  for (let i = 0; i < texte.length; i++) if (texte.charCodeAt(i) === 10) d.push(i + 1);
  return d;
}
function ligneDe(a: Analyse, pos: number): number {
  let bas = 0, haut = a.debutsDeLigne.length - 1;
  while (bas < haut) { const m = (bas + haut + 1) >> 1; if ((a.debutsDeLigne[m] ?? 0) <= pos) bas = m; else haut = m - 1; }
  return bas + 1;
}
function moduleA(a: Analyse, pos: number): string {
  for (const b of a.bornes) if (pos >= b.debut && pos < b.fin) return b.module;
  return a.bornes[a.bornes.length - 1]?.module ?? 'socle';
}
const ou = (a: Analyse, pos: number) => `${a.servi}:${ligneDe(a, pos)}`;

function bornesDe(servi: string, racine: string): Bornes {
  const r: Bornes = [];
  let debut = 0;
  for (const m of morceaux(servi, racine)) {
    const n = fs.readFileSync(path.join(racine, m), 'utf8').length;
    r.push({ debut, fin: debut + n, morceau: m, module: moduleDuMorceau(m) });
    debut += n;
  }
  return r;
}

function analyser(servi: string, racine: string): Analyse {
  const texte = lireEcran(servi, racine);
  const base = { servi, texte, debutsDeLigne: lignesDe(texte), bornes: bornesDe(servi, racine), references: [], haut: new Map(), fonctionsDuHaut: new Map(),
    fenetre: new Map(), typeofs: new Set<string>(), sousTypeof: new Set<Noeud>(), ecrituresParPropriete: new Set<Noeud>(), premiereCle: new Map(), fonctionDe: new Map(), appels: new Map(), cadres: [] };
  let ast: Noeud;
  try {
    ast = acorn.parse(texte, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, ranges: true }) as unknown as Noeud;
  } catch (e) {
    return { ...base, ast: { type: 'Program', start: 0, end: 0 }, illisible: (e as Error).message };
  }
  const a: Analyse = { ...base, ast };
  const portees = analyze(ast as unknown as Parameters<typeof analyze>[0], { ecmaVersion: 2022, sourceType: 'script' });
  const refDeIdent = new Map<Noeud, Reference>();
  const fnDePortee = (s: Scope): Fn => s.variableScope.block as unknown as Fn;
  for (const s of portees.scopes) for (const r of s.references) {
    a.references.push(r);
    refDeIdent.set(r.identifier as unknown as Noeud, r);
    a.fonctionDe.set(r, fnDePortee(s));
  }
  // Le haut du fichier : ce que la portée globale déclare (var, let, const, function, class).
  const globale = portees.globalScope;
  for (const v of globale?.variables ?? []) {
    for (const d of v.defs) {
      const tdz = d.type === 'ClassName' || (d.type === 'Variable' && (d.parent as unknown as { kind: string }).kind !== 'var');
      a.haut.set(v.name, [...(a.haut.get(v.name) ?? []), { pos: debutDe(d.name), tdz }]);
      const fn = fonctionDeDefinition(d);
      if (fn) a.fonctionsDuHaut.set(v.name, fn);
    }
  }
  // Un parcours : les `typeof`, les écritures par propriété (X.y = …), window.X = …, les appels de chaque fonction.
  const pile: { n: Noeud; fn: Fn }[] = [{ n: ast, fn: ast }];
  const cadres = new Set<Fn>([ast]);
  // Les autres noms de la fenêtre : le paramètre d'une fonction appelée sur-le-champ avec `window` (ou `self`,
  // `globalThis`, `this`, ou le choix entre eux) — `(function (global) { global.RowMenu = … })(window)`.
  const alias = new Set<Variable>();
  const estFenetre = (x: Noeud | undefined): boolean => !!x && ((x.type === 'Identifier' && FENETRE.has((x as unknown as { name: string }).name)) || x.type === 'ThisExpression'
    || (x.type === 'ConditionalExpression' && estFenetre(x.consequent as Noeud) && estFenetre(x.alternate as Noeud)));
  const noterAlias = (f: Noeud, args: Noeud[]) => {
    const portee = portees.acquire(f as unknown as Parameters<typeof portees.acquire>[0]);
    (f.params as Noeud[]).forEach((p, i) => {
      if (p.type !== 'Identifier' || !estFenetre(args[i])) return;
      const v = portee?.set.get((p as unknown as { name: string }).name);
      if (v) alias.add(v);
    });
  };
  // Ou une constante qui la nomme, une fois pour toutes : `const w = window` (les registres du socle, lot B0 ; lue au lot
  // P1b, quand les écrans s'en servent). Relevée avant le parcours, qui ne lit pas le texte dans l'ordre.
  for (const s of portees.scopes) for (const v of s.variables) {
    const d = v.defs[0];
    if (v.defs.length === 1 && d?.type === 'Variable' && (d.parent as unknown as { kind: string }).kind === 'const'
      && estFenetre((d.node as unknown as { init?: Noeud }).init ?? undefined)) alias.add(v);
  }
  const estAlias = (ident: Noeud) => {
    const v = refDeIdent.get(ident)?.resolved;
    return !!v && alias.has(v);
  };
  const ajouterAppel = (fn: Fn, pos: number, vers: Vers) => {
    a.appels.set(fn, [...(a.appels.get(fn) ?? []), { pos, vers }]);
  };
  const versFonction = (ident: Noeud): Vers | null => {
    const r = refDeIdent.get(ident);
    if (!r) return null;
    if (r.resolved && r.resolved.scope.type !== 'global') {
      const fn = r.resolved.defs[0] ? fonctionDeDefinition(r.resolved.defs[0]) : null;
      return fn ? { fn, nom: (ident as unknown as { name: string }).name } : null;
    }
    return { nom: (ident as unknown as { name: string }).name };
  };
  while (pile.length) {
    const { n, fn } = pile.pop() as { n: Noeud; fn: Fn };
    if (n.type === 'UnaryExpression' && n.operator === 'typeof' && estNoeud(n.argument) && n.argument.type === 'Identifier') {
      a.typeofs.add((n.argument as unknown as { name: string }).name);
      a.sousTypeof.add(n.argument);
    }
    if ((n.type === 'AssignmentExpression' && estNoeud(n.left) && n.left.type === 'MemberExpression') || (n.type === 'UpdateExpression' && estNoeud(n.argument) && n.argument.type === 'MemberExpression')
      || (n.type === 'UnaryExpression' && n.operator === 'delete' && estNoeud(n.argument) && n.argument.type === 'MemberExpression')) {
      const cible = (n.type === 'AssignmentExpression' ? n.left : n.argument) as Noeud;
      let racineObjet: Noeud = cible;
      while (racineObjet.type === 'MemberExpression') racineObjet = racineObjet.object as Noeud;
      if (racineObjet.type === 'Identifier') {
        const nomRacine = (racineObjet as unknown as { name: string }).name;
        const direct = cible.object as Noeud;
        const fenetre = (FENETRE.has(nomRacine) && !refDeIdent.get(racineObjet)?.resolved) || estAlias(racineObjet);
        if (fenetre && direct === racineObjet && n.type === 'AssignmentExpression') {
          const p = cible.property as Noeud & { name?: string; value?: unknown };
          const nom = cible.computed ? (typeof p.value === 'string' ? p.value : null) : p.name ?? null;
          if (nom) a.fenetre.set(nom, [...(a.fenetre.get(nom) ?? []), n.start]);
        } else if (!fenetre) {
          a.ecrituresParPropriete.add(racineObjet);
          let m = cible;
          while ((m.object as Noeud).type === 'MemberExpression') m = m.object as Noeud;
          const q = m.property as Noeud & { name?: string; value?: unknown };
          a.premiereCle.set(racineObjet, m.computed ? (typeof q.value === 'string' ? q.value : null) : q.name ?? null);
        }
      }
    }
    if (n.type === 'CallExpression' || n.type === 'NewExpression') {
      const appele = n.callee as Noeud;
      if (estFonction(appele)) { ajouterAppel(fn, n.start, { fn: appele }); noterAlias(appele, n.arguments as Noeud[]); if (cadres.has(fn)) cadres.add(appele); }
      else if (appele.type === 'MemberExpression' && estFonction(appele.object as Noeud) && !appele.computed && ['call', 'apply'].includes((appele.property as unknown as { name: string }).name)) {
        ajouterAppel(fn, n.start, { fn: appele.object as Noeud });
        if ((appele.property as unknown as { name: string }).name === 'call') noterAlias(appele.object as Noeud, (n.arguments as Noeud[]).slice(1));
        if (cadres.has(fn)) cadres.add(appele.object as Noeud);
      } else if (appele.type === 'Identifier') {
        const vers = versFonction(appele);
        if (vers) ajouterAppel(fn, n.start, vers);
      } else if (appele.type === 'MemberExpression' && !appele.computed && SYNCHRONES.has((appele.property as unknown as { name: string }).name)) {
        for (const arg of (n.arguments as Noeud[]) ?? []) {
          if (estFonction(arg)) ajouterAppel(fn, n.start, { fn: arg });
          else if (arg.type === 'Identifier') { const vers = versFonction(arg); if (vers) ajouterAppel(fn, n.start, vers); }
        }
      }
    }
    for (const e of enfants(n)) pile.push({ n: e, fn: estFonction(n) ? n : fn });
  }
  a.cadres = [...cadres];
  return a;
}

function fonctionDeDefinition(d: Variable['defs'][number]): Fn | null {
  if (d.type === 'FunctionName') return d.node as unknown as Fn;
  if (d.type === 'Variable') {
    const init = (d.node as unknown as { init?: Noeud }).init;
    return init && estFonction(init) ? init : null;
  }
  return null;
}

// ——— La mesure ———

// Noter un écart : son code, sa clé, la lecture qui le fait (une lecture vue sur deux pages compte une fois), et un lieu
// lisible (fichier:ligne) pour le dire.
type Noter = (code: string, cle: string, ici: string, lieu?: string) => void;
type Contexte = { racine: string; ordre: string[]; fiches: Map<string, Fiche>; analyses: Map<string, Analyse> };

function lireJson<T>(racine: string, f: string): T {
  return JSON.parse(fs.readFileSync(path.join(racine, f), 'utf8')) as T;
}

export function scriptsDeLaPage(page: string, racine = RACINE_DU_DEPOT): string[] {
  const html = fs.readFileSync(path.join(racine, PUBLIC, page), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const dossier = path.posix.dirname(page);
  return [...html.matchAll(/<script\b[^>]*\bsrc="([^"?#]+)[^"]*"[^>]*>/g)].map((m) => path.posix.normalize(path.posix.join(dossier, m[1] ?? '')));
}

// Ce qu'un nom lu devient : un nom du même fichier (résolu dans une fermeture), un nom du haut d'un script de la page,
// un nom du navigateur, ou un nom introuvable.
type Proprietaire = { a: Analyse; pos: number; tdz: boolean; script: number } | 'navigateur' | null;

function proprietaireSurLaPage(nom: string, page: { scripts: Analyse[] }): Proprietaire {
  for (let i = 0; i < page.scripts.length; i++) {
    const a = page.scripts[i] as Analyse;
    const h = a.haut.get(nom)?.[0];
    if (h) return { a, pos: h.pos, tdz: h.tdz, script: i };
    const f = a.fenetre.get(nom)?.[0];
    if (f !== undefined) return { a, pos: f, tdz: false, script: i };
  }
  return NAVIGATEUR.has(nom) ? 'navigateur' : null;
}

export function mesurer(racine = RACINE_DU_DEPOT): Mesure {
  const ordre = lireJson<{ ordre: string[] }>(racine, 'modules/ordre.json').ordre;
  const fiches = new Map<string, Fiche>();
  for (const m of ordre) if (fs.existsSync(path.join(racine, `modules/${m}/module.json`))) fiches.set(m, lireJson<Fiche>(racine, `modules/${m}/module.json`));
  const ctx: Contexte = { racine, ordre, fiches, analyses: new Map() };
  const vus = new Map<string, Set<string>>(); // clé → positions (une lecture vue sur deux pages compte une fois)
  const exemples = new Map<string, string>();
  const noter: Noter = (code, cle, ici, lieu = ici) => {
    const k = `${code} ${cle}`;
    if (!vus.has(k)) vus.set(k, new Set());
    (vus.get(k) as Set<string>).add(ici);
    if (!exemples.has(k)) exemples.set(k, lieu);
  };
  const analyse = (servi: string) => {
    if (!ctx.analyses.has(servi)) ctx.analyses.set(servi, analyser(servi, racine));
    return ctx.analyses.get(servi) as Analyse;
  };

  // F0 : les coupes, et les morceaux que la table ignore.
  const table = lireTable(racine);
  const declares = new Set(Object.values(table).flat());
  const parcourirModules = (d: string) => {
    if (!fs.existsSync(path.join(racine, d))) return;
    for (const e of fs.readdirSync(path.join(racine, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) parcourirModules(rel);
      else if (/\.(js|css)$/.test(e.name) && !declares.has(rel)) noter('F0', `morceau non déclaré ${rel}`, rel);
    }
  };
  parcourirModules('modules');
  for (const servi of Object.keys(table)) {
    const bornes = bornesDe(servi, racine);
    if (bornes.length < 2) continue;
    if (servi.endsWith('.css')) {
      const texte = lireEcran(servi, racine);
      for (const b of bornes.slice(1)) if (profondeurCss(texte, b.debut) !== 0) noter('F0', `${servi} coupe au milieu d'une règle avant ${b.morceau}`, `${servi}`);
      continue;
    }
    const a = analyse(servi);
    for (const b of bornes.slice(1)) {
      const conteneur = plusProfondContenant(a.ast, b.debut);
      const permis = ['Program', 'BlockStatement', 'StaticBlock', 'ClassBody', ...(AIDE.includes(servi) ? ['ObjectExpression', 'ArrayExpression'] : [])];
      if (!permis.includes(conteneur.type)) noter('F0', `${servi} coupe au milieu d'une instruction avant ${b.morceau}`, ou(a, b.debut));
    }
  }

  // Les pages.
  const atteint: Mesure['atteint'] = {};
  for (const [nomPage, html] of Object.entries(PAGES)) {
    if (!fs.existsSync(path.join(racine, PUBLIC, html))) continue;
    const servis = scriptsDeLaPage(html, racine).filter((s) => fs.existsSync(path.join(racine, PUBLIC, s)) || s in table);
    const page = { scripts: servis.map(analyse) };
    page.scripts.forEach((a, i) => {
      if (a.illisible) { noter('F0', `${a.servi} ne se lit pas`, a.servi); return; }
      lireLesReferences(ctx, nomPage, page, a, i, noter);
    });
    // F8 : un nom défini deux fois sur la page (deux scripts, ou deux fois dans le même).
    const definitions = new Map<string, string[]>();
    for (const a of page.scripts) for (const [nom, defs] of a.haut) for (const d of defs) definitions.set(nom, [...(definitions.get(nom) ?? []), ou(a, d.pos)]);
    for (const [nom, lieux] of definitions) if (lieux.length > 1) for (const l of lieux) noter('F8', `${nomPage} ${nom}`, l);
    // F9 : au chargement.
    const executees = auChargement(page, nomPage, noter);
    atteint[nomPage] = { scripts: page.scripts.length, lectures: page.scripts.reduce((s, a) => s + a.references.length, 0), auChargement: executees };
  }

  // F13 : le serveur.
  importsDuServeur(ctx, noter);

  // F12 : les lignes des gros fichiers hors de modules/.
  const lignes: Record<string, number> = {};
  for (const servi of GROS) {
    let n = 0;
    for (const m of morceaux(servi, racine)) {
      if (m.startsWith('modules/') || !fs.existsSync(path.join(racine, m))) continue;
      const t = fs.readFileSync(path.join(racine, m), 'utf8');
      n += t.split('\n').length - (t.endsWith('\n') ? 1 : 0);
    }
    lignes[servi] = n;
  }

  const cles = [...vus.keys()].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  return { comptes: Object.fromEntries(cles.map((k) => [k, vus.get(k)?.size ?? 0])), exemples: Object.fromEntries(cles.map((k) => [k, exemples.get(k) ?? ''])), lignes, atteint };
}

function profondeurCss(texte: string, jusqua: number): number {
  let p = 0;
  for (let i = 0; i < jusqua; i++) {
    const c = texte[i];
    if (c === '/' && texte[i + 1] === '*') { const f = texte.indexOf('*/', i + 2); i = f < 0 ? jusqua : f + 1; continue; }
    if (c === '"' || c === '\'') { const f = texte.indexOf(c, i + 1); i = f < 0 ? jusqua : f; continue; }
    if (c === '{') p++;
    else if (c === '}') p--;
  }
  return p;
}

function plusProfondContenant(n: Noeud, pos: number): Noeud {
  let courant = n;
  for (;;) {
    const suivant = enfants(courant).find((e) => e.start < pos && pos < e.end);
    if (!suivant) return courant;
    courant = suivant;
  }
}

function lireLesReferences(ctx: Contexte, nomPage: string, page: { scripts: Analyse[] }, a: Analyse, rang: number,
  noter: Noter) {
  for (const r of a.references) {
    const ident = r.identifier as unknown as Noeud & { name: string };
    const nom = ident.name;
    const pos = ident.start;
    let vers: { a: Analyse; pos: number };
    if (r.resolved && r.resolved.scope.type !== 'global') {
      const d = r.resolved.defs[0];
      if (!d) continue;
      vers = { a, pos: debutDe(d.name) };
    } else {
      const p = proprietaireSurLaPage(nom, page);
      if (p === 'navigateur') continue;
      if (p === null) {
        if (a.typeofs.has(nom) || (UNIVERSEL.includes(nom) && UNIVERSEL.some((u) => a.typeofs.has(u)))) continue;
        // Écrire un nom introuvable le crée (hors du mode strict) : ce n'est pas une lecture d'un nom absent.
        if (r.isWrite() && !r.isRead()) continue;
        noter('F1', `${nomPage} ${a.servi} ${nom}`, `${a.servi}:${pos}`, ou(a, pos));
        continue;
      }
      vers = { a: p.a, pos: p.pos };
    }
    const de = moduleA(a, pos);
    const chez = moduleA(vers.a, vers.pos);
    if (de === chez) continue;
    const ecrit = r.isWrite() || a.ecrituresParPropriete.has(ident);
    const ici = `${a.servi}:${pos}`;
    const lieu = ou(a, pos);
    // Le dossier (`data`) est au socle, mais chacune de ses collections a son module, que sa fiche déclare (17 § 3.3) :
    // un module qui écrit la sienne écrit chez lui (lot P1b). Le socle qui l'écrit, ou un module celle d'un autre, viendra
    // avec la porte des données (F6).
    const cle = nom === DONNEES && chez === 'socle' && !r.isWrite() ? a.premiereCle.get(ident) : null;
    const chezSoi = !!cle && ctx.fiches.get(de)?.collections?.concat(ctx.fiches.get(de)?.racine ?? []).includes(cle);
    if (ecrit && !(r.init) && !chezSoi) noter('F7', `${a.servi} ${de}→${chez} ${nom}`, ici, lieu);
    // Écrire seulement (sans lire) : c'est F7, pas une lecture.
    if (chez === 'socle' || (r.isWrite() && !r.isRead())) continue;
    if (de === 'socle') { noter('F4', `${a.servi} socle→${chez} ${nom}`, ici, lieu); continue; }
    const fiche = ctx.fiches.get(chez);
    const porte = (fiche?.porte ?? []).map((x) => (typeof x === 'string' ? x : (x as { nom?: string }).nom));
    if (!porte.includes(nom)) noter('F2', `${a.servi} ${de}→${chez} ${nom}`, ici, lieu);
    const lecteur = ctx.fiches.get(de);
    if (!lecteur?.dependances.includes(chez) || ctx.ordre.indexOf(chez) > ctx.ordre.indexOf(de)) noter('F3', `${a.servi} ${de}→${chez} ${nom}`, ici, lieu);
  }
}

// F9 : ce qui s'exécute à l'ouverture de la page. Chaque script s'exécute à son tour ; dans un script, le haut du
// fichier et les fonctions appelées sur-le-champ (les « cadres »), dans l'ordre du texte ; une fonction appelée depuis
// un cadre s'exécute à la position de l'appel, avec tout ce qu'elle appelle à son tour (et ce qu'elle passe à forEach…).
// Un nom `let`, `const` ou `class` d'un cadre en cours, lu avant sa déclaration, arrête la page ; un nom d'un script
// chargé plus loin aussi. (Les variables propres à la fonction appelée naissent avec elle : elles ne comptent pas.)
function auChargement(page: { scripts: Analyse[] }, nomPage: string, noter: Noter): number {
  // Sur toute la page : les lectures que chaque fonction fait dans son propre code (pas dans les fonctions qu'elle
  // définit sans les appeler), et ses appels.
  const lectures = new Map<Fn, { r: Reference; a: Analyse }[]>();
  const appels = new Map<Fn, { pos: number; vers: Vers }[]>();
  for (const a of page.scripts) {
    for (const r of a.references) {
      const fn = a.fonctionDe.get(r);
      if (fn) lectures.set(fn, [...(lectures.get(fn) ?? []), { r, a }]);
    }
    for (const [fn, liste] of a.appels) appels.set(fn, liste);
  }
  const appelee = (x: Vers): Fn | null => {
    if ('fn' in x) return x.fn;
    for (const a of page.scripts) { const f = a.fonctionsDuHaut.get(x.nom); if (f) return f; }
    return null;
  };
  // Le verdict d'une lecture faite au chargement, à la position `quand` du script de rang `rang`, pendant le cadre `cadre`.
  const juger = (a: Analyse, r: Reference, rang: number, cadres: Fn[], quand: number, ici: string, lieu: string, par: string) => {
    if (r.init) return;
    const nom = (r.identifier as unknown as { name: string }).name;
    if (r.resolved && r.resolved.scope.type !== 'global') {
      const d = r.resolved.defs[0];
      if (!d) return;
      const tdz = d.type === 'ClassName' || (d.type === 'Variable' && (d.parent as unknown as { kind: string }).kind !== 'var');
      const chez = r.resolved.scope.variableScope.block as unknown as Fn;
      // Une variable d'un cadre de ce script qui s'exécute (il contient l'appel), déclarée plus loin.
      if (tdz && debutDe(d.name) > quand && cadres.includes(chez) && chez.start <= quand && quand < chez.end) noter('F9', `${nomPage} ${a.servi} ${nom}${par}`, ici, lieu);
      return;
    }
    const p = proprietaireSurLaPage(nom, page);
    if (!p || p === 'navigateur') return;
    // `typeof` d'un nom pas encore défini rend « undefined » sans arrêter la page (sauf un `let` en attente).
    if (p.script > rang && a.sousTypeof.has(r.identifier as unknown as Noeud)) return;
    if (p.script > rang || (p.script === rang && p.tdz && p.pos > quand)) noter('F9', `${nomPage} ${a.servi} ${nom}${par}`, ici, lieu);
  };
  const executees = new Set<Fn>();
  page.scripts.forEach((a, rang) => {
    if (a.illisible) return;
    for (const cadre of a.cadres) {
      executees.add(cadre);
      // Les lectures directes du cadre : à leur propre position.
      for (const { r } of lectures.get(cadre) ?? []) {
        const pos = debutDe(r.identifier);
        juger(a, r, rang, a.cadres, pos, `${a.servi}:${pos}`, ou(a, pos), '');
      }
      // Les appels du cadre : tout ce que la fonction appelée lit (et ce qu'elle appelle), à la position de l'appel.
      for (const appel of appels.get(cadre) ?? []) {
        const premiere = appelee(appel.vers);
        if (!premiere || a.cadres.includes(premiere)) continue;
        const vues = new Set<Fn>([premiere]);
        const file = [premiere];
        const par = ` (par ${appel.vers.nom ?? 'une fonction'})`;
        while (file.length) {
          const fn = file.pop() as Fn;
          executees.add(fn);
          for (const { r, a: ar } of lectures.get(fn) ?? []) juger(ar, r, rang, a.cadres, appel.pos, `${ar.servi}:${debutDe(r.identifier)}`, ou(a, appel.pos), par);
          for (const suite of appels.get(fn) ?? []) {
            const g = appelee(suite.vers);
            if (g && !vues.has(g)) { vues.add(g); file.push(g); }
          }
        }
      }
    }
  });
  return executees.size;
}

// F13 : au serveur, un import vers le dossier d'un autre module qui n'est pas sa porte.
function importsDuServeur(ctx: Contexte, noter: Noter) {
  const dossierDe = new Map<string, string>();
  for (const f of ctx.fiches.values()) for (const d of f.serveur ?? []) dossierDe.set(d.replace(/\/+$/, ''), f.code);
  const moduleDuFichier = (rel: string) => {
    for (const [d, m] of dossierDe) if (rel === d || rel.startsWith(`${d}/`)) return { module: m, dossier: d };
    return { module: 'socle', dossier: '' };
  };
  const parcourir = (d: string) => {
    if (!fs.existsSync(path.join(ctx.racine, d))) return;
    for (const e of fs.readdirSync(path.join(ctx.racine, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`;
      if (e.isDirectory()) { parcourir(rel); continue; }
      if (!/\.ts$/.test(e.name)) continue;
      const de = moduleDuFichier(rel);
      const texte = fs.readFileSync(path.join(ctx.racine, rel), 'utf8');
      for (const m of texte.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"](\.[^'"]+)['"]|\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
        const cible = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1] ?? m[2] ?? ''));
        const vers = moduleDuFichier(cible);
        if (vers.module === de.module || vers.module === 'socle') continue;
        if (cible === `${vers.dossier}/porte.ts`) continue;
        noter('F13', `${rel} → ${cible}`, rel);
      }
    }
  };
  parcourir('serveur');
}

// ——— Le cliquet ———

export function empreinteDesEcrans(racine = RACINE_DU_DEPOT): string {
  const h = crypto.createHash('sha256');
  const servis = new Set<string>(Object.keys(lireTable(racine)));
  for (const html of Object.values(PAGES)) if (fs.existsSync(path.join(racine, PUBLIC, html))) for (const s of scriptsDeLaPage(html, racine)) servis.add(s);
  for (const s of [...servis].sort()) {
    if (!(s in lireTable(racine)) && !fs.existsSync(path.join(racine, PUBLIC, s))) continue;
    h.update(`${s}\0`).update(lireEcran(s, racine)).update('\0');
  }
  return h.digest('hex');
}

export function lireConnus(racine = RACINE_DU_DEPOT): Connus | null {
  const f = path.join(racine, CONNUS);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as Connus) : null;
}

const conseil = (code: string) => {
  const c = CODES[code];
  return c ? ` Refusé parce que ${c.pourquoi}. Ce qui débloque : ${c.debloque}.` : '';
};

// Les refus du cliquet : un écart neuf (ou plus nombreux), un écart disparu mais encore listé, un gros fichier qui
// grandit. Chaque refus dit ce qui est refusé, pourquoi, et ce qui débloque.
export function comparer(m: Mesure, connus: Connus | null): string[] {
  if (!connus) return [`${CONNUS} est introuvable : la liste des écarts connus n'est pas écrite. Ce qui débloque : \`npm run frontieres -- --ecrire\`.`];
  const refus: string[] = [];
  for (const [cle, n] of Object.entries(m.comptes)) {
    const avant = connus.ecarts[cle] ?? 0;
    if (n > avant) {
      const code = cle.split(' ')[0] ?? '';
      refus.push(`Écart nouveau (${code}, ${CODES[code]?.quoi ?? ''}) : « ${cle} », ${n} au lieu de ${avant} (par exemple ${m.exemples[cle] ?? ''}).${conseil(code)}`);
    }
  }
  for (const [cle, avant] of Object.entries(connus.ecarts)) {
    const n = m.comptes[cle] ?? 0;
    if (n < avant) refus.push(`Écart disparu mais encore listé : « ${cle} », ${avant} listés, ${n} mesurés. Bravo : baisse la liste avec \`npm run frontieres -- --ecrire\` (elle ne peut que baisser).`);
  }
  for (const servi of GROS) {
    const plafond = connus.lignes[servi];
    const n = m.lignes[servi] ?? 0;
    if (!plafond || !plafond.pourquoi) { refus.push(`« ${servi} » n'a pas son plafond de lignes (F12) dans ${CONNUS}, avec sa raison. Ce qui débloque : \`npm run frontieres -- --ecrire\`.`); continue; }
    if (n > plafond.auPlus) refus.push(`Écart nouveau (F12, ${CODES.F12?.quoi}) : « ${servi} » a ${n} lignes hors de modules/, au plus ${plafond.auPlus}.${conseil('F12')}`);
  }
  return refus;
}

// Écrire la liste : elle ne peut que baisser. Un déplacement à l'identique (un lot A) révèle des écarts qui existaient
// déjà : il les inscrit avec `deplacement`, et seulement si les écrans servis sont, à l'octet, ceux de la dernière
// écriture (l'empreinte) : le code n'a pas changé, il a seulement changé de dossier.
export function ecrireConnus(racine = RACINE_DU_DEPOT, options: { deplacement?: boolean } = {}): { connus: Connus; refus: string[] } {
  const m = mesurer(racine);
  const avant = lireConnus(racine);
  const mesures = m.comptes;
  const empreinte = empreinteDesEcrans(racine);
  const refus: string[] = [];
  if (avant) {
    const hausses = Object.entries(mesures).filter(([cle, n]) => n > (avant.ecarts[cle] ?? 0));
    // Un déplacement révèle des lectures d'un module à l'autre ; jamais une coupe au milieu d'une instruction, un nom
    // introuvable, défini deux fois ou lu trop tôt : ceux-là restent refusés (17 § 6, lot B : « F1, F8 et F9 à zéro »).
    const jamais = hausses.filter(([cle]) => /^F(0|1|8|9) /.test(cle));
    if (jamais.length && options.deplacement) refus.push(...jamais.map(([cle, n]) => `Un déplacement n'inscrit jamais « ${cle} » (${n}) : ${CODES[cle.split(' ')[0] ?? '']?.quoi ?? ''}.${conseil(cle.split(' ')[0] ?? '')}`));
    if (hausses.length && !options.deplacement) {
      refus.push(...hausses.map(([cle, n]) => `La liste ne peut que baisser : « ${cle} » passerait de ${avant.ecarts[cle] ?? 0} à ${n}.${conseil(cle.split(' ')[0] ?? '')}`));
    } else if (hausses.length && avant.empreinte !== empreinte) {
      refus.push(`Un déplacement n'inscrit ses écarts que si les écrans servis n'ont pas changé d'un octet depuis la dernière écriture de la liste : ils ont changé. Ce qui débloque : écris la liste AVANT de déplacer (\`npm run frontieres -- --ecrire\`), puis déplace, puis \`npm run frontieres -- --ecrire --deplacement\`.`);
    }
  }
  const lignes: Connus['lignes'] = {};
  for (const servi of GROS) {
    const n = m.lignes[servi] ?? 0;
    const p = avant?.lignes[servi];
    const premier = servi.startsWith('plateforme/pont') ? 'à zéro quand les deux ponts sont découpés (lots de fin, 17 § 5)' : 'à zéro après le lot A1 (17 § 5)';
    lignes[servi] = p && p.pourquoi ? { auPlus: Math.min(p.auPlus, n), pourquoi: p.pourquoi } : { auPlus: n, pourquoi: `mesuré au lot R0c (03/11/2026) : ne fait que baisser, ${premier}` };
    if (p && n > p.auPlus) refus.push(`« ${servi} » a ${n} lignes hors de modules/, au plus ${p.auPlus} (F12).${conseil('F12')}`);
  }
  const connus: Connus = {
    _: 'Le cliquet du contrôle des frontières (docs/cadrage/17-rangement.md § 4.2 ; outils/rangement/frontieres.ts). « ecarts » : les écarts d\'aujourd\'hui, comptés ; un écart neuf fait tomber le contrôle, un écart disparu mais encore listé aussi ; la liste ne peut que baisser (`npm run frontieres -- --ecrire`). « lignes » : les lignes de chaque gros fichier hors de modules/, au plus (F12). « empreinte » : les écrans servis à la dernière écriture (un déplacement à l\'identique, et lui seul, peut inscrire les écarts qu\'il révèle).',
    empreinte,
    lignes,
    ecarts: mesures,
  };
  if (!refus.length) fs.writeFileSync(path.join(racine, CONNUS), `${JSON.stringify(connus, null, 2)}\n`);
  return { connus, refus };
}

// Le contrôle : la mesure comparée à la liste. Lève FrontiereRefusee avec chaque refus.
export function controler(racine = RACINE_DU_DEPOT): Mesure {
  const m = mesurer(racine);
  const refus = comparer(m, lireConnus(racine));
  if (refus.length) throw new FrontiereRefusee(`Le contrôle des frontières refuse (${refus.length}) :\n- ${refus.join('\n- ')}`);
  return m;
}

export function resume(m: Mesure): string {
  const parCode = new Map<string, number>();
  for (const [cle, n] of Object.entries(m.comptes)) { const c = cle.split(' ')[0] ?? ''; parCode.set(c, (parCode.get(c) ?? 0) + n); }
  return [...Object.keys(CODES)].map((c) => (c === 'F12' ? `F12 ${GROS.map((g) => `${g} ${m.lignes[g] ?? 0}`).join(', ')}` : `${c} ${parCode.get(c) ?? 0}`)).join(' · ');
}

// La garde de la construction : seulement quand SKANFACT_CONTROLE=1 (le suiveur la pose) ; avant de construire.
export const CONTROLE = 'SKANFACT_CONTROLE';
export function controleDesFrontieres(racine = RACINE_DU_DEPOT): Plugin {
  return {
    name: 'skanfact-controle-des-frontieres',
    apply: 'build',
    buildStart() {
      if (process.env[CONTROLE] !== '1') return;
      controler(racine);
    },
  };
}

// npm run frontieres [-- --ecrire [--deplacement]]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--ecrire')) {
      const { connus, refus } = ecrireConnus(RACINE_DU_DEPOT, { deplacement: args.includes('--deplacement') });
      if (refus.length) { console.error(`Liste non écrite :\n- ${refus.join('\n- ')}`); process.exit(1); }
      console.log(`${CONNUS} écrit : ${Object.values(connus.ecarts).reduce((s, n) => s + n, 0)} écarts.`);
    } else {
      const m = controler();
      console.log(`Frontières tenues. ${resume(m)}`);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
