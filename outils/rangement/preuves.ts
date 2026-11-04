// Les preuves qui suivent le code (docs/cadrage/17-rangement.md § 6 ; lot R0b, 03/11/2026). Les écrans vont passer de
// leurs gros fichiers à des morceaux rangés sous modules/<module>/, et plus de 2 000 preuves visent ces fichiers. Cet
// outil sert les gestes du § 6 :
//   1. une preuve suit son motif : elle vise le morceau de sa FAMILLE (entreprise, Cabinet, moteur, aide, styles) qui
//      contient son motif, une seule fois ; un motif absent, en double dans la famille, ou à cheval sur une coupe refuse
//      le déplacement (outils/rangement/deplacer.ts), et son fichier est réécrit dans tests/preuves.sh, dans le même envoi ;
//   2. l'équivalence : une preuve déplacée pose, dans chaque fichier servi, exactement le même défaut qu'avant, octet
//      pour octet ;
//   3. le contrôle éclair (tests/verif-preuves.sh) apprend les pièges du rangement : un motif présent dans plusieurs
//      fichiers d'une famille (une copie morte garderait la preuve verte), un morceau que la table ignore (un défaut
//      jamais servi), un défaut qui casse la syntaxe du fichier ASSEMBLÉ, une preuve d'un outil du rangement qui vise un
//      autre test que ceux du rangement (elle tomberait pour une autre raison) ;
//   4. le choix des preuves nouvelles : un fichier servi dont la liste de morceaux change (un morceau nouveau, retiré ou
//      déplacé) choisit toutes ses preuves.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import { lireTable, PUBLIC, RACINE_DU_DEPOT, type Table } from '../../commun/assemblage.ts';

export type Retouche = { fichier: string; avant: string; apres: string };
export type Preuve = { nom: string; fichier: string; retouches: Retouche[]; attendu: string; ligne: number };
export type Faute = { genre: string; nom: string; detail: string };

// Les familles : les fichiers servis dans lesquels un motif doit se trouver une seule fois (17 § 6). Un morceau déplacé
// d'un fichier à l'autre reste dans sa famille.
export const FAMILLES: Record<string, string[]> = {
  entreprise: ['v10/app.js', 'plateforme/pont.js'],
  cabinet: ['v10/cabinet/app.js', 'plateforme/pont-cabinet.js'],
  moteur: ['v10/core.js', 'v10/compta.js'],
  aide: ['v10/guide.js', 'v10/visites.js', 'v10/cabinet/cabguide.js', 'v10/cabinet/cabvisites.js'],
  styles: ['plateforme/paie.css', 'plateforme/paie-maquette.css', 'plateforme/paie-cabinet.css'],
};
// Les outils du rangement : une preuve qui les vise ne vise que les tests du rangement.
export const OUTILS = (f: string) => f === 'commun/assemblage.ts' || f.startsWith('outils/rangement/');
const TESTS_DU_RANGEMENT = 'tests/commun/';

// ——— Lire les preuves ———

function preuvesDe(champs: string[], parPreuve: 5 | 6): Preuve[] {
  const r: Preuve[] = [];
  for (let i = 0; i + parPreuve <= champs.length; i += parPreuve) {
    const [nom = '', fichier = '', avant = '', apres = '', attendu = '', ligne = '0'] = champs.slice(i, i + parPreuve);
    const avants = avant.split('|||'), apress = apres.split('|||');
    let fichiers = fichier.split('|||');
    if (fichiers.length === 1) fichiers = avants.map(() => fichier);
    r.push({ nom, fichier, attendu, ligne: Number(ligne), retouches: fichiers.map((f, k) => ({ fichier: f, avant: avants[k] ?? '', apres: apress[k] ?? '' })) });
  }
  return r;
}
// Les preuves d'un fichier comme tests/preuves.sh, avec la ligne de chaque appel (tests/lister-preuves.sh, LIGNES=1).
export function lirePreuves(racine = RACINE_DU_DEPOT, source = 'tests/preuves.sh'): Preuve[] {
  const brut = execFileSync('bash', [path.join(racine, 'tests/lister-preuves.sh'), path.join(racine, source)],
    { cwd: racine, env: { ...process.env, LIGNES: '1' }, maxBuffer: 1 << 30 }).toString('utf8').split('\0');
  brut.pop();
  return preuvesDe(brut, 6);
}
// Une liste déjà faite (cinq champs par preuve, sans les lignes) : celle du contrôle éclair.
export function lireListe(fichier: string): Preuve[] {
  const brut = fs.readFileSync(fichier).toString('utf8').split('\0');
  brut.pop();
  return preuvesDe(brut, 5);
}

// ——— Les fichiers servis, leurs morceaux et leurs familles ———

// Un état du dépôt : sa table et le texte de chaque fichier lu (relus du disque, ou gardés en mémoire pour comparer).
export type Etat = { table: Table; lire: (f: string) => string | null };
export function etatDuDepot(racine = RACINE_DU_DEPOT): Etat {
  const lus = new Map<string, string | null>();
  return {
    table: lireTable(racine),
    lire: (f) => {
      if (!lus.has(f)) { const p = path.join(racine, f); lus.set(f, fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, 'utf8') : null); }
      return lus.get(f) ?? null;
    },
  };
}
const morceauxDe = (servi: string, e: Etat) => e.table[servi] ?? [`${PUBLIC}/${servi}`];
// Le fichier servi qui contient un fichier visé : un morceau de la table, ou un écran sous web/public.
export function serviDe(fichier: string, e: Etat): string | null {
  for (const [servi, liste] of Object.entries(e.table)) if (liste.includes(fichier)) return servi;
  return fichier.startsWith(`${PUBLIC}/`) ? fichier.slice(PUBLIC.length + 1) : null;
}
export const familleDe = (servi: string | null) => (servi ? Object.keys(FAMILLES).find((f) => FAMILLES[f]?.includes(servi)) ?? null : null);
const fichiersDeLaFamille = (famille: string, e: Etat) => (FAMILLES[famille] ?? []).flatMap((s) => morceauxDe(s, e));
const occurrences = (texte: string, motif: string) => (motif ? texte.split(motif).length - 1 : 0);
// Le fichier servi, assemblé, avec les retouches de la preuve posées dans ses morceaux (dans l'ordre, comme preuves.sh).
export function assembleAvecDefaut(servi: string, retouches: Retouche[], e: Etat): string | null {
  const copies = new Map<string, string>();
  for (const r of retouches) {
    const s = copies.get(r.fichier) ?? e.lire(r.fichier);
    if (s == null || occurrences(s, r.avant) !== 1) return null;
    copies.set(r.fichier, s.replace(r.avant, () => r.apres));
  }
  const parties = morceauxDe(servi, e).map((m) => copies.get(m) ?? e.lire(m));
  return parties.every((p) => p != null) ? parties.join('') : null;
}

// ——— Le contrôle éclair ———

// La syntaxe du fichier assemblé avec le défaut : la plus petite fonction qui contient le défaut, si elle se lit seule
// avant lui (comme le contrôle des écrans de tests/verif-preuves.sh), sinon le fichier entier.
const illisible = (code: string) => { try { new vm.Script(code); return null; } catch (e) { return e instanceof SyntaxError ? e.message : null; } };
type Fonctions = { debut: number; fin: number; entreParentheses: boolean }[];
const fonctionsLues = new Map<string, Fonctions>();
// Ce qui se lit seul avant le défaut, une fois par fichier et par fonction.
const propresLues = new Map<string, Map<string, boolean>>();
function fonctionsDe(texte: string): Fonctions {
  const deja = fonctionsLues.get(texte);
  if (deja) return deja;
  const liste: Fonctions = [];
  try {
    const pile = [acorn.parse(texte, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true }) as unknown as Record<string, unknown>];
    while (pile.length) {
      const n = pile.pop() as Record<string, unknown> & { type?: string; start?: number; end?: number };
      if (n.type === 'FunctionDeclaration') liste.push({ debut: n.start ?? 0, fin: n.end ?? 0, entreParentheses: false });
      else if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') liste.push({ debut: n.start ?? 0, fin: n.end ?? 0, entreParentheses: true });
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) { for (const x of v) if (x && typeof x === 'object') pile.push(x as Record<string, unknown>); } else if (v && typeof v === 'object' && 'type' in v) pile.push(v as Record<string, unknown>);
      }
    }
  } catch { /* un fichier qui ne se lit pas déjà : jugé entier */ }
  liste.sort((a, b) => (a.fin - a.debut) - (b.fin - b.debut));
  liste.push({ debut: 0, fin: texte.length, entreParentheses: false });
  fonctionsLues.set(texte, liste);
  return liste;
}
export function syntaxeCassee(propre: string, abime: string): string | null {
  // Où le défaut commence et finit : le plus long début et la plus longue fin communs aux deux textes.
  let d = 0;
  while (d < propre.length && d < abime.length && propre.charCodeAt(d) === abime.charCodeAt(d)) d++;
  let f = 0;
  while (f < propre.length - d && f < abime.length - d && propre.charCodeAt(propre.length - 1 - f) === abime.charCodeAt(abime.length - 1 - f)) f++;
  const finPropre = propre.length - f, finAbime = abime.length - f;
  if (!propresLues.has(propre)) propresLues.set(propre, new Map());
  const propres = propresLues.get(propre) as Map<string, boolean>;
  for (const fn of fonctionsDe(propre)) {
    if (fn.debut > d || fn.fin < finPropre) continue;
    const juger = (t: string) => illisible(fn.entreParentheses ? `(${t}\n)` : t);
    const cle = `${fn.debut}:${fn.fin}`;
    if (!propres.has(cle)) propres.set(cle, juger(propre.slice(fn.debut, fn.fin)) === null);
    if (!propres.get(cle)) continue;
    return juger(abime.slice(fn.debut, fn.fin - finPropre + finAbime));
  }
  return null;
}

// Les fautes du rangement, pour tests/verif-preuves.sh (qui dit déjà un motif introuvable ou en double dans son fichier).
export function controlerLesPreuves(preuves: Preuve[], racine = RACINE_DU_DEPOT): Faute[] {
  const e = etatDuDepot(racine);
  const fautes: Faute[] = [];
  const declares = new Set(Object.values(e.table).flat());
  // Les tests, pour retrouver le fichier de chacun (par son titre, comme preuves.sh le cherche).
  const tests: [string, string][] = [];
  const parcourir = (d: string) => {
    if (!fs.existsSync(path.join(racine, d))) return;
    for (const x of fs.readdirSync(path.join(racine, d), { withFileTypes: true })) {
      const rel = `${d}/${x.name}`;
      if (x.isDirectory()) parcourir(rel); else if (x.name.endsWith('.test.ts')) tests.push([rel, fs.readFileSync(path.join(racine, rel), 'utf8')]);
    }
  };
  if (preuves.some((p) => p.retouches.some((r) => OUTILS(r.fichier)))) parcourir('tests');
  for (const p of preuves) {
    const servis = new Set<string>();
    for (const r of p.retouches) {
      if (r.fichier.startsWith('modules/') && /\.(js|css)$/.test(r.fichier) && !declares.has(r.fichier)) {
        fautes.push({ genre: 'MORCEAU HORS TABLE', nom: p.nom, detail: `${r.fichier} n'est dans aucun fichier servi (modules/assemblage.json) : le défaut ne serait jamais servi` });
        continue;
      }
      const servi = serviDe(r.fichier, e);
      const famille = familleDe(servi);
      if (servi && famille && occurrences(e.lire(r.fichier) ?? '', r.avant) === 1) {
        const ou = fichiersDeLaFamille(famille, e).filter((f) => occurrences(e.lire(f) ?? '', r.avant) > 0);
        const n = ou.reduce((s, f) => s + occurrences(e.lire(f) ?? '', r.avant), 0);
        if (n > 1) fautes.push({ genre: 'MOTIF DANS LA FAMILLE', nom: p.nom, detail: `« ${court(r.avant)} » ${n} fois dans la famille ${famille} (${ou.join(', ')}) : une copie garderait la preuve verte ; allonge le motif` });
      }
      if (servi && r.fichier.startsWith('modules/') && r.fichier.endsWith('.js')) servis.add(servi);
      if (OUTILS(r.fichier)) {
        const ici = tests.filter(([, t]) => t.includes(p.attendu) || t.includes(p.attendu.replace(/'/g, '\\\'')));
        if (ici.some(([f]) => !f.startsWith(TESTS_DU_RANGEMENT))) {
          fautes.push({ genre: 'OUTIL ET TEST D\'ÉCRAN', nom: p.nom, detail: `${r.fichier} est un outil du rangement : sa preuve ne vise que les tests de ${TESTS_DU_RANGEMENT} (« ${court(p.attendu)} » vit dans ${ici.map(([f]) => f).join(', ')}) ; sinon elle tomberait pour une autre raison` });
        }
      }
    }
    // Un morceau d'écran : la syntaxe se lit dans le fichier ASSEMBLÉ, avec le défaut posé.
    for (const servi of servis) {
      const propre = morceauxDe(servi, e).map((m) => e.lire(m) ?? '').join('');
      const abime = assembleAvecDefaut(servi, p.retouches.filter((r) => serviDe(r.fichier, e) === servi), e);
      if (abime == null) continue;
      const casse = syntaxeCassee(propre, abime);
      if (casse) fautes.push({ genre: 'SYNTAXE CASSÉE', nom: p.nom, detail: `${servi} (assemblé) : ${casse} (le défaut ne prouverait rien : la page entière tombe)` });
    }
  }
  return fautes;
}
const court = (t: string) => { const u = t.split(/\s+/).join(' ').trim(); return u.length <= 90 ? u : `${u.slice(0, 87)}…`; };

// ——— Suivre un déplacement ———

// Où va chaque preuve quand des fichiers servis changent de morceaux : pour chaque retouche dont le fichier appartient à
// un fichier servi déplacé, le morceau de sa famille (après) qui contient son motif, une seule fois.
export type Suivi = { preuve: Preuve; fichier: string };
export function suivre(preuves: Preuve[], avant: Etat, apres: Etat, deplaces: string[]): { suivis: Suivi[]; refus: string[] } {
  const suivis: Suivi[] = [];
  const refus: string[] = [];
  for (const p of preuves) {
    let touchee = false;
    const nouveaux = p.retouches.map((r) => {
      const servi = serviDe(r.fichier, avant);
      if (!servi || !deplaces.includes(servi)) return r.fichier;
      touchee = true;
      const famille = familleDe(servi);
      const candidats = famille ? fichiersDeLaFamille(famille, apres) : morceauxDe(servi, apres);
      const ou = candidats.filter((f) => occurrences(apres.lire(f) ?? '', r.avant) > 0);
      const n = ou.reduce((s, f) => s + occurrences(apres.lire(f) ?? '', r.avant), 0);
      if (n === 1 && ou[0]) return ou[0];
      refus.push(n === 0
        ? `Preuve « ${p.nom} » (ligne ${p.ligne}) : son motif « ${court(r.avant)} » ne se trouve plus dans aucun morceau${famille ? ` de la famille ${famille}` : ''} : une coupe tombe au milieu. Déplace la coupe.`
        : `Preuve « ${p.nom} » (ligne ${p.ligne}) : son motif « ${court(r.avant)} » se trouve ${n} fois dans ${ou.join(', ')} : allonge-le avant de déplacer.`);
      return r.fichier;
    });
    if (!touchee) continue;
    const fichier = nouveaux.length > 1 || p.fichier.includes('|||') ? nouveaux.join('|||') : nouveaux[0] ?? p.fichier;
    suivis.push({ preuve: p, fichier });
  }
  return { suivis, refus };
}
// L'équivalence (17 § 6, point 2) : la preuve suivie pose, dans chaque fichier servi qu'elle touche, le même défaut
// qu'avant, octet pour octet.
export function equivalente(s: Suivi, avant: Etat, apres: Etat): boolean {
  const nouveaux = s.fichier.split('|||');
  const retouchesApres = s.preuve.retouches.map((r, k) => ({ ...r, fichier: nouveaux.length === 1 ? nouveaux[0] ?? r.fichier : nouveaux[k] ?? r.fichier }));
  const servis = new Set(s.preuve.retouches.map((r) => serviDe(r.fichier, avant)).filter((x): x is string => !!x));
  for (const servi of servis) {
    const a = assembleAvecDefaut(servi, s.preuve.retouches.filter((r) => serviDe(r.fichier, avant) === servi), avant);
    const b = assembleAvecDefaut(servi, retouchesApres.filter((r) => serviDe(r.fichier, apres) === servi), apres);
    if (a == null || b == null || a !== b) return false;
  }
  return true;
}

// ——— Réécrire tests/preuves.sh ———

// Le deuxième mot d'un appel « prouver NOM FICHIER … » sur sa ligne : sa place dans la ligne (le nom peut être entre
// guillemets simples, doubles, avec ses échappements).
export function placeDuFichier(ligne: string): { debut: number; fin: number } | null {
  let i = ligne.search(/\bprouver\b/);
  if (i < 0) return null;
  i += 'prouver'.length;
  const mot = (): { debut: number; fin: number } | null => {
    while (i < ligne.length && /[ \t]/.test(ligne[i] ?? '')) i++;
    const debut = i;
    while (i < ligne.length && !/[ \t]/.test(ligne[i] ?? '')) {
      const c = ligne[i];
      if (c === '\'') { const f = ligne.indexOf('\'', i + 1); if (f < 0) return null; i = f + 1; } else if (c === '"') {
        i++;
        while (i < ligne.length && ligne[i] !== '"') i += ligne[i] === '\\' ? 2 : 1;
        if (i >= ligne.length) return null;
        i++;
      } else if (c === '\\') i += 2; else i++;
    }
    return i > debut && ligne.slice(debut, i) !== '\\' ? { debut, fin: i } : null;
  };
  if (!mot()) return null;
  return mot();
}
const enMot = (v: string) => (/^[A-Za-z0-9._/-]+$/.test(v) ? v : `'${v.replace(/'/g, '\'"\'"\'')}'`);
// Réécrit le fichier de chaque preuve suivie, à la ligne de son appel. Les appels d'une boucle partagent leur ligne :
// ils doivent aller au même endroit.
export function reecrire(texte: string, suivis: Suivi[]): { texte: string; refus: string[] } {
  const lignes = texte.split('\n');
  const parLigne = new Map<number, Suivi[]>();
  for (const s of suivis) parLigne.set(s.preuve.ligne, [...(parLigne.get(s.preuve.ligne) ?? []), s]);
  const refus: string[] = [];
  for (const [n, liste] of parLigne) {
    const cibles = [...new Set(liste.map((s) => s.fichier))];
    if (cibles.length > 1) { refus.push(`Ligne ${n} de tests/preuves.sh : les preuves d'une même boucle iraient dans ${cibles.join(' et ')} : sépare-les à la main.`); continue; }
    const l = lignes[n - 1] ?? '';
    const place = placeDuFichier(l);
    if (!place) { refus.push(`Ligne ${n} de tests/preuves.sh : le fichier de « ${liste[0]?.preuve.nom} » n'est pas sur la ligne de son appel : réécris-le à la main.`); continue; }
    lignes[n - 1] = l.slice(0, place.debut) + enMot(cibles[0] ?? '') + l.slice(place.fin);
  }
  return { texte: lignes.join('\n'), refus };
}

// ——— Le choix des preuves nouvelles ———

// Les fichiers servis dont la liste de morceaux a changé (un morceau nouveau, retiré ou déplacé), et toutes leurs preuves.
export function servisReassembles(avant: Table, apres: Table): string[] {
  const tous = new Set([...Object.keys(avant), ...Object.keys(apres)]);
  return [...tous].filter((s) => JSON.stringify(avant[s] ?? [`${PUBLIC}/${s}`]) !== JSON.stringify(apres[s] ?? [`${PUBLIC}/${s}`])).sort();
}
export function preuvesAChoisir(preuves: Preuve[], avant: Table, apres: Table): string[] {
  const servis = servisReassembles(avant, apres);
  const fichiers = new Set(servis.flatMap((s) => [...(avant[s] ?? [`${PUBLIC}/${s}`]), ...(apres[s] ?? [`${PUBLIC}/${s}`])]));
  return preuves.filter((p) => p.retouches.some((r) => fichiers.has(r.fichier))).map((p) => p.nom);
}

// node outils/rangement/preuves.ts --controler LISTE      (une faute par ligne : [genre, nom, détail], en JSON)
// node outils/rangement/preuves.ts --choisir TABLE_AVANT LISTE   (un nom de preuve par ligne)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [geste, a, b] = process.argv.slice(2);
  if (geste === '--controler' && a) {
    for (const f of controlerLesPreuves(lireListe(a))) console.log(JSON.stringify([f.genre, f.nom, f.detail]));
  } else if (geste === '--choisir' && a && b) {
    const avant = fs.existsSync(a) && fs.statSync(a).size ? ((JSON.parse(fs.readFileSync(a, 'utf8')) as { fichiers?: Table }).fichiers ?? {}) : {};
    for (const nom of preuvesAChoisir(lireListe(b), avant, lireTable())) console.log(nom);
  } else {
    console.error('usage : --controler LISTE | --choisir TABLE_AVANT LISTE');
    process.exit(2);
  }
}
