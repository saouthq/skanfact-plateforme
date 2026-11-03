// L'assemblage des écrans (docs/cadrage/17-rangement.md § 3.1 et § 4.1 ; lot R0a, 03/11/2026).
//
// Chaque module rangera ses écrans, son moteur, son aide et ses visites dans son dossier (modules/<module>/), mais le
// navigateur reçoit toujours les mêmes fichiers, aux mêmes adresses (/v10/app.js, /v10/core.js…) : chacun est la SUITE,
// octet pour octet, de ses morceaux, dans l'ordre que donne modules/assemblage.json. Aucun fichier assemblé n'est gardé
// dans le dépôt (un changement apparaîtrait deux fois, et une preuve viserait le fichier qu'on ne doit pas toucher).
//
// Un seul chemin pour tous ceux qui lisent un écran : la construction (web/vite.config.ts, avant l'allègement), le
// serveur de développement (le même plugin, à la volée), et Node (le serveur lit core.js pour le TEIF, guide.js pour le
// support ; les tests lisent le moteur) par `lireEcran`. Au lot R0a, chaque fichier n'a qu'un morceau, lui-même : rien ne
// change d'un octet ; les lots A le coupent.

import fs from 'node:fs';
import path from 'node:path';

export const RACINE_DU_DEPOT = path.join(import.meta.dirname, '..');
// Là où vivent les écrans qui ne sont pas (encore) assemblés, et d'où Vite copie tout tel quel.
export const PUBLIC = 'web/public';
const TABLE = 'modules/assemblage.json';

export type Table = Record<string, string[]>;

// Un refus de l'assemblage : ce qui ne va pas, et ce qui débloque.
export class AssemblageRefuse extends Error {}

const relatifSur = (p: string) => !path.isAbsolute(p) && !p.split(/[\\/]/).includes('..') && !p.includes('\\');

// La table, vérifiée : une adresse servie est un script ou une feuille de style ; un morceau vit sous web/public/ ou
// sous modules/, existe, n'appartient qu'à UN fichier servi ; et un fichier assemblé n'a pas de copie gardée à son
// adresse sous web/public/ (sauf s'il en est lui-même l'unique morceau, comme au lot R0a).
export function lireTable(racine = RACINE_DU_DEPOT): Table {
  const fichier = path.join(racine, TABLE);
  if (!fs.existsSync(fichier)) return {};
  const lu = JSON.parse(fs.readFileSync(fichier, 'utf8')) as { fichiers?: unknown };
  if (!lu.fichiers || typeof lu.fichiers !== 'object' || Array.isArray(lu.fichiers)) throw new AssemblageRefuse(`${TABLE} : « fichiers » doit être un objet (adresse servie → liste de morceaux).`);
  const table: Table = {};
  const vus = new Map<string, string>();
  for (const [servi, morceaux] of Object.entries(lu.fichiers as Record<string, unknown>)) {
    if (!relatifSur(servi) || !/\.(js|css)$/.test(servi)) throw new AssemblageRefuse(`${TABLE} : l'adresse servie « ${servi} » doit être un chemin relatif vers un .js ou un .css.`);
    if (!Array.isArray(morceaux) || !morceaux.length || !morceaux.every((m) => typeof m === 'string')) throw new AssemblageRefuse(`${TABLE} : « ${servi} » n'a pas sa liste de morceaux (au moins un chemin).`);
    for (const m of morceaux as string[]) {
      if (!relatifSur(m) || !(m.startsWith(`${PUBLIC}/`) || m.startsWith('modules/'))) throw new AssemblageRefuse(`${TABLE} : le morceau « ${m} » de « ${servi} » doit vivre sous ${PUBLIC}/ ou sous modules/.`);
      const deja = vus.get(m);
      if (deja) throw new AssemblageRefuse(`${TABLE} : le morceau « ${m} » est déclaré deux fois (dans « ${deja} » et « ${servi} ») : un morceau n'appartient qu'à un fichier servi.`);
      vus.set(m, servi);
      if (!fs.existsSync(path.join(racine, m))) throw new AssemblageRefuse(`${TABLE} : le morceau « ${m} » de « ${servi} » est introuvable. Rends-le, ou retire-le de la liste.`);
    }
    const copie = `${PUBLIC}/${servi}`;
    if (fs.existsSync(path.join(racine, copie)) && !(morceaux as string[]).includes(copie)) {
      throw new AssemblageRefuse(`« ${copie} » est encore gardé dans le dépôt alors que « ${servi} » s'assemble d'autres morceaux : c'est une copie morte (une preuve resterait verte sur elle). Retire-le.`);
    }
    table[servi] = morceaux as string[];
  }
  return table;
}

// Les morceaux d'un fichier servi, dans l'ordre ; un écran qui ne s'assemble pas est son propre et unique morceau.
export function morceaux(servi: string, racine = RACINE_DU_DEPOT): string[] {
  return lireTable(racine)[servi] ?? [`${PUBLIC}/${servi}`];
}

// Le fichier servi, octet pour octet. Chaque morceau, sauf le dernier, finit par un saut de ligne : on ne coupe jamais
// au milieu d'une ligne (une ligne coupée en deux ferait mentir les numéros de ligne d'une erreur signalée).
export function assemblerOctets(servi: string, racine = RACINE_DU_DEPOT): Buffer {
  const liste = morceaux(servi, racine);
  const lus = liste.map((m) => {
    const chemin = path.join(racine, m);
    if (!fs.existsSync(chemin)) throw new AssemblageRefuse(`L'écran « ${servi} » est introuvable (${m}).`);
    return fs.readFileSync(chemin);
  });
  lus.forEach((b, i) => {
    if (!b.length) throw new AssemblageRefuse(`Le morceau « ${liste[i]} » de « ${servi} » est vide : retire-le de ${TABLE}.`);
    if (i < lus.length - 1 && b[b.length - 1] !== 0x0a) throw new AssemblageRefuse(`Le morceau « ${liste[i]} » de « ${servi} » ne finit pas par un saut de ligne : une coupe tombe au milieu d'une ligne.`);
  });
  return Buffer.concat(lus);
}

// Le texte d'un écran, pour Node : le seul chargeur (17 § 4.1), à la place des lectures recopiées de web/public.
export function lireEcran(servi: string, racine = RACINE_DU_DEPOT): string {
  return assemblerOctets(servi, racine).toString('utf8');
}

// Les fichiers assemblés, écrits dans les écrans construits (avant l'allègement) : ce que Vite a copié de web/public
// est remplacé par la suite de ses morceaux ; un fichier dont les morceaux ont quitté web/public y est écrit.
export function ecrireLesAssembles(sortie: string, racine = RACINE_DU_DEPOT): string[] {
  const ecrits: string[] = [];
  for (const servi of Object.keys(lireTable(racine))) {
    const cible = path.join(sortie, servi);
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.writeFileSync(cible, assemblerOctets(servi, racine));
    ecrits.push(servi);
  }
  return ecrits;
}

// D'où vient la ligne `ligne` (à partir de 1) d'un fichier servi : son morceau, et la ligne dans ce morceau. Pour la
// console du support, qui reçoit l'erreur d'un poste avec son numéro de ligne dans le fichier servi.
export function origine(servi: string, ligne: number, racine = RACINE_DU_DEPOT): { morceau: string; ligne: number } | null {
  if (!Number.isInteger(ligne) || ligne < 1) return null;
  let avant = 0;
  for (const m of morceaux(servi, racine)) {
    const chemin = path.join(racine, m);
    if (!fs.existsSync(chemin)) return null;
    const texte = fs.readFileSync(chemin, 'utf8');
    const lignes = texte.split('\n').length - (texte.endsWith('\n') ? 1 : 0);
    if (ligne <= avant + lignes) return { morceau: m, ligne: ligne - avant };
    avant += lignes;
  }
  return null;
}

// Le module d'un morceau : le dossier qui le range (modules/<module>/…) ; tout ce qui vit encore sous web/public est au
// socle, jusqu'à son déménagement.
export const moduleDuMorceau = (m: string) => (m.startsWith('modules/') ? m.split('/')[1] ?? 'socle' : 'socle');

// Les morceaux d'un module, fichier servi par fichier servi.
export function morceauxDuModule(module: string, racine = RACINE_DU_DEPOT): { servi: string; morceau: string }[] {
  return Object.entries(lireTable(racine)).flatMap(([servi, liste]) => liste.filter((m) => moduleDuMorceau(m) === module).map((morceau) => ({ servi, morceau })));
}
