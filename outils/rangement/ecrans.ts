// La comparaison des écrans (docs/cadrage/17-rangement.md § 6, ligne « B » ; lot R0d, 04/11/2026). Un lot qui range un
// module ne doit rien changer à ce qu'on voit : cet outil le mesure. Il construit les écrans de deux versions (celle
// d'un commit de référence, tirée dans une copie de travail git, et celle du dépôt), les sert côte à côte sur DEUX
// COPIES de la même base (le même compte, la même entreprise remplie de l'exemple de cinq ans, le même cabinet et ses
// dossiers ; `create database … template`), l'horloge du navigateur figée au même instant, et compare page par page,
// au bureau (1 440) et au téléphone (390), dans l'entreprise et au Cabinet :
//   - le texte de la page (ce qu'une personne lit), et sa structure (chaque élément, sa classe, son rôle, son état) ;
//   - les pixels (la capture de toute la hauteur de la page, octet pour octet) ;
//   - l'ordre des registres : la barre (ses entrées, leurs chiffres), la palette (Ctrl+K), « Créer », les onglets du
//     téléphone (la barre du bas) ; et chaque onglet de la page, ouvert l'un après l'autre.
// Chaque côté a sa copie de la base : ce qu'un écran écrit en s'ouvrant (un réglage, un onglet retenu) ne passe pas de
// l'un à l'autre, et les deux voient la même chose dans le même ordre.
//
// Une page se photographie quand elle ne bouge plus (deux lectures de suite identiques) ; celle qui bouge encore au bout
// de neuf secondes est dite. Le texte, la structure et les registres de chaque photo s'écrivent à côté d'elle (.json),
// pour lire un écart.
//
// Un instrument qui n'atteint pas les écrans dirait « rien n'a changé » : chaque page prouve d'abord qu'elle est
// celle qu'on croit (son adresse et sa vue remplie), le compte des pages mesurées est exigé, et un témoin (une copie
// des écrans d'après où un seul mot change) doit faire tomber la comparaison.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { build } from 'vite';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { RACINE_DU_DEPOT } from '../../commun/assemblage.ts';
import { lirePng, pixelsDifferents, SEUIL_PIXELS } from './pixels.ts';

export type Capture = { texte: string; structure: string; pixels: string; registres: string; stable?: boolean; png?: string };
export type Mesure = { page: string; largeur: number; avant: Capture | null; apres: Capture | null; atteinte: boolean; essais?: number };
type Serveur = Awaited<ReturnType<typeof demarrer>>;

// Le même instant pour les deux côtés : le jour de la photo du moteur, à 10 h à Tunis.
export const INSTANT = '2026-06-15T09:00:00Z';

// Les pages de l'entreprise (les routes de `PAGE_LABELS`, et une fiche de chaque sorte, prise dans l'exemple) et du
// Cabinet (ses routes, et un dossier relié ouvert dans chacune de ses parties).
export function pagesEntreprise(ids: Record<string, string>): string[] {
  const fiche = (route: string, cle: string) => (ids[cle] ? [`#/${route}/${ids[cle]}`] : []);
  return [
    '#/dashboard', '#/factures', '#/devis', '#/relances', '#/contrats', '#/autres', '#/autres/proforma', '#/autres/livraison',
    '#/autres/commande', '#/autres/contrat', '#/clients', '#/catalogue', '#/listesprix', '#/tresorerie', '#/stats', '#/compta',
    '#/parametres', '#/aide', '#/comptable', '#/support', '#/achats', '#/fournisseurs', '#/commandesf', '#/commandesf/commandes',
    '#/commandesf/receptions', '#/marges', '#/immos', '#/accords', '#/stock', '#/caisse', '#/garanties', '#/paie', '#/modules',
    '#/licences', '#/groupe',
    '#/doc/new/facture', '#/doc/new/devis', '#/achat/new', '#/commandef/new',
    ...fiche('doc', 'facture'), ...fiche('doc', 'devis'), ...fiche('client', 'client'), ...fiche('fournisseur', 'fournisseur'),
    ...fiche('achat', 'achat'), ...fiche('affaire', 'affaire'), ...fiche('immo', 'immo'), ...fiche('article', 'article'),
    ...fiche('salarie', 'salarie'), ...fiche('contrat', 'contrat'),
  ];
}
// Les routes de l'entreprise que la comparaison n'ouvre pas, et pourquoi (une route neuve doit entrer dans la liste,
// ou ici, avec sa raison : tests/commun/comparer.test.ts).
export const ROUTES_NON_OUVERTES: Record<string, string> = {
  listeprix: 'la fiche d\'une liste de prix : l\'exemple n\'en a pas ; la liste des listes est comparée (#/listesprix)',
  reception: 'la fiche d\'une réception : la liste des réceptions est comparée (#/commandesf/receptions)',
  commandef: 'une commande neuve est comparée (#/commandef/new) ; l\'exemple n\'en garde pas',
};
export function pagesCabinet(dossier: string): string[] {
  return ['#/dossiers', '#/production', '#/pieces', '#/echeances', '#/relances', '#/ecritures', '#/reglages', '#/messages', '#/aide',
    '#/guide', `#/dossier/${dossier}`, `#/dossier/${dossier}/classeur`, `#/pieces/${dossier}`, `#/messages/${dossier}`,
    `#/dossier/${dossier}/comptabilite/banque`, `#/dossier/${dossier}/comptabilite/saisie`, `#/dossier/${dossier}/comptabilite/paie`];
}
// Les routes du Cabinet que la comparaison n'ouvre pas, et pourquoi.
export const ROUTES_CABINET_NON_OUVERTES: Record<string, string> = {
  priorites: 'l\'ancien lien des Priorités renvoie au Tableau de bord (#/production), comparé',
};

const hash = (t: string | Buffer) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 20);

// Ce qu'une page montre, lu dans la page : son texte, sa structure, ses registres.
function lire(): { texte: string; structure: string; registres: string } {
  const visible = (e: Element) => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden'; };
  const marcher = (e: Element, p: string[]): void => {
    if (!visible(e) || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(e.tagName)) return;
    const a = (n: string) => e.getAttribute(n);
    p.push(`${e.tagName}${e.id ? `#${e.id}` : ''}${e.className && typeof e.className === 'string' ? `.${e.className.trim().split(/\s+/).sort().join('.')}` : ''}`
      + `${a('role') ? `[${a('role')}]` : ''}${a('aria-label') ? `{${a('aria-label')}}` : ''}${(e as HTMLInputElement).disabled ? '!' : ''}`
      + `${a('aria-current') ? '*' : ''}${a('aria-selected') === 'true' ? '+' : ''}(`);
    for (const c of e.children) marcher(c, p);
    p.push(')');
  };
  const s: string[] = [];
  marcher(document.body, s);
  const txt = (sel: string) => [...document.querySelectorAll(sel)].filter(visible).map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim());
  return {
    texte: document.body.innerText.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim(),
    structure: s.join(''),
    registres: JSON.stringify({ adresse: location.hash, barre: txt('#nav a, #nav button'), bas: txt('#barre .pied-bas a, #barre .pied-bas button, [data-tel]'), onglets: txt('#view [role="tab"], #view .tabs > *') }),
  };
}

// La hauteur de toute la page : les écrans défilent dans une zone (pas dans le corps de la page) ; la photo agrandit la
// fenêtre d'autant, pour prendre tout ce que la page montre, et pas seulement ce qui tient à l'écran.
function hauteur(): number {
  let plus = Math.max(0, document.documentElement.scrollHeight - innerHeight);
  for (const e of document.querySelectorAll('body *')) {
    if (/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1) plus = Math.max(plus, e.scrollHeight - e.clientHeight);
  }
  return innerHeight + plus;
}

// Une page se photographie quand elle ne bouge plus : deux lectures de suite identiques (le texte, la structure, les
// registres et les pixels), à PAUSE d'écart, au plus ESSAIS fois. Sinon elle est dite « instable » : un aperçu qui se
// charge encore, un compteur qui tourne. Sans cela, deux photos des mêmes écrans diffèrent par le moment où on les prend.
const PAUSE = 250, ESSAIS = 36;
type Prise = { l: ReturnType<typeof lire>; png: Buffer };
async function prendre(page: Page): Promise<Prise> {
  return { l: await page.evaluate(lire), png: await page.screenshot({ animations: 'disabled', caret: 'hide' }) };
}
async function poser(page: Page): Promise<Prise & { stable: boolean }> {
  let a = await prendre(page);
  for (let i = 0; i < ESSAIS; i++) {
    await page.waitForTimeout(PAUSE);
    const b = await prendre(page);
    if (b.l.texte === a.l.texte && b.l.structure === a.l.structure && b.l.registres === a.l.registres && b.png.equals(a.png)) return { ...b, stable: true };
    a = b;
  }
  return { ...a, stable: false };
}

export async function capturer(page: Page, dossier: string, nom: string): Promise<Capture> {
  await page.evaluate(() => document.fonts?.ready);
  const vue = page.viewportSize() ?? { width: 1440, height: 900 };
  let h = vue.height;
  let p = await poser(page);
  for (let k = 0; k < 3; k++) {
    const voulu = Math.max(vue.height, Math.min(await page.evaluate(hauteur), 12_000));
    if (voulu === h) break;
    h = voulu;
    await page.setViewportSize({ width: vue.width, height: h });
    p = await poser(page);
  }
  if (h !== vue.height) await page.setViewportSize(vue);
  const png = path.join(dossier, `${nom}.png`);
  fs.writeFileSync(png, p.png);
  fs.writeFileSync(path.join(dossier, `${nom}.json`), JSON.stringify({ stable: p.stable, hauteur: h, ...p.l }));
  return { texte: hash(p.l.texte), structure: hash(p.l.structure), pixels: hash(p.png), registres: hash(p.l.registres), stable: p.stable, png };
}

// Ce qui diffère entre deux captures de la même page.
export function ecarts(m: Mesure): string[] {
  if (!m.atteinte || !m.avant || !m.apres) return [`${m.page} (${m.largeur}) : la page n'a pas été atteinte des deux côtés`];
  const instable = m.avant.stable === false || m.apres.stable === false ? [`${m.page} (${m.largeur}) : la page ne se pose pas (elle change encore au bout de ${(PAUSE * ESSAIS) / 1000} s)`] : [];
  // Deux photos qui ne diffèrent que par le lissage de quelques pixels (au plus SEUIL_PIXELS, pixels.ts) sont les mêmes.
  const memes = (k: 'texte' | 'structure' | 'pixels' | 'registres', a: Capture, b: Capture) => a[k] === b[k]
    || (k === 'pixels' && !!a.png && !!b.png && pixelsDifferents(lirePng(fs.readFileSync(a.png)), lirePng(fs.readFileSync(b.png))) <= SEUIL_PIXELS);
  const { avant, apres } = m;
  return [...instable, ...(['texte', 'structure', 'pixels', 'registres'] as const).filter((k) => !memes(k, avant, apres)).map((k) => `${m.page} (${m.largeur}) : ${{ texte: 'le texte', structure: 'la structure', pixels: 'les pixels', registres: 'l\'ordre des registres' }[k]} change`)];
}

// Les écrans d'une version : ceux du dépôt, ou ceux d'un commit tiré dans une copie de travail git.
export async function construire(ref: string | null, sortie: string): Promise<void> {
  let racine = RACINE_DU_DEPOT;
  let copie: string | null = null;
  if (ref) {
    copie = fs.mkdtempSync(path.join(os.tmpdir(), 'ecrans-ref-'));
    execFileSync('git', ['-C', RACINE_DU_DEPOT, 'worktree', 'add', '-q', '--detach', copie, ref]);
    fs.symlinkSync(path.join(RACINE_DU_DEPOT, 'node_modules'), path.join(copie, 'node_modules'));
    racine = copie;
  }
  try {
    await build({ configFile: path.join(racine, 'web/vite.config.ts'), root: path.join(racine, 'web'), logLevel: 'silent', build: { outDir: sortie, emptyOutDir: true } });
  } finally {
    if (copie) execFileSync('git', ['-C', RACINE_DU_DEPOT, 'worktree', 'remove', '--force', copie]);
  }
}

// Une copie de la base (tout son contenu, au même instant), et l'adresse du serveur pour elle.
export async function copierLaBase(pgAdmin: string, pgApp: string, nom: string): Promise<string> {
  const admin = new URL(pgAdmin);
  const modele = admin.pathname.slice(1);
  const c = new pg.Client({ connectionString: Object.assign(new URL(pgAdmin), { pathname: '/postgres' }).toString() });
  await c.connect();
  try {
    await c.query(`drop database if exists ${nom} with (force)`);
    await c.query(`create database ${nom} template ${modele}`);
  } finally { await c.end(); }
  const u = new URL(pgApp);
  u.pathname = `/${nom}`;
  return u.toString();
}

export async function servir(base: string, web: string): Promise<Serveur> {
  return demarrer({ ...lireConfiguration({ SKANFACT_BASE: base, SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web, livreurMs: 600_000 });
}

export async function contexte(navigateur: Browser, largeur: number, jeton: string): Promise<BrowserContext> {
  const doigt = largeur < 760;
  const c = await navigateur.newContext({ viewport: { width: largeur, height: 900 }, deviceScaleFactor: 1, locale: 'fr-FR', timezoneId: 'Africa/Tunis', isMobile: doigt, hasTouch: doigt, reducedMotion: 'reduce' });
  // L'invitation « Première fois sur cette page ? » se place à l'instant où elle s'ouvre, parfois avant que l'en-tête
  // de la page soit posé : sa place dépend du moment, pas du code. Les deux côtés l'éteignent (le choix « Ne plus me
  // proposer de visites », gardé sur le poste) ; les visites elles-mêmes restent dans « Guide-moi ».
  await c.addInitScript((j) => {
    try {
      sessionStorage.setItem('skanfact.jeton', j);
      localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false }));
      localStorage.setItem('cab.visites', JSON.stringify({ proposer: false }));
    } catch { /* la page vide d'entre deux pages n'a pas de stockage */ }
  }, jeton);
  return c;
}
