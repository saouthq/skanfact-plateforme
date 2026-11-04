// La photo du moteur (docs/cadrage/17-rangement.md § 6, ligne « Moteur » ; lot R0d, 04/11/2026). Le moteur des écrans
// (`v10/core.js` et `v10/compta.js`, assemblés de leurs morceaux) est chargé tel que le navigateur le reçoit, dans un
// bac à sable où la date est figée et le hasard tiré d'une graine ; chaque fonction qu'il rend publique est jouée sur
// l'exemple de cinq ans (`v10/demo.js`, au même jour), avec des arguments choisis par le NOM de chaque paramètre
// (`data` reçoit le dossier, `year` une année, `employee` un salarié, `livre` un livre tenu des écritures de
// l'exemple…), en trois variantes. De chaque appel, la photo garde une empreinte : ce qu'il rend, et ce qu'il a
// changé dans ce qu'on lui a passé (chaque appel reçoit sa copie). Deux photos se comparent fonction par fonction ;
// un lot qui range le moteur doit laisser chaque empreinte égale.
//
// Un instrument qui n'atteint pas le moteur dirait « rien n'a changé » : la photo compte ses fonctions jouées et
// celles qui ont rendu quelque chose, et la comparaison refuse une photo sous les seuils (SEUILS).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { lireEcran, RACINE_DU_DEPOT } from '../../commun/assemblage.ts';

export const JOUR = '2026-06-15';
export type PhotoMoteur = {
  _: string;
  jour: string;
  mesure: { fonctions: number; appels: number; rendus: number; erreurs: number };
  fonctions: Record<string, string[]>;
};
// Sous ces seuils, la photo n'a pas atteint le moteur (mesuré le 04/11/2026 : 846 fonctions, environ 2 500 appels,
// dont plus de la moitié rendent une valeur).
export const SEUILS = { fonctions: 700, rendus: 1_000 };

type Bac = vm.Context & Record<string, unknown>;
type Obj = Record<string, unknown>;

// Le bac à sable : la date figée au jour de la photo, à 10 h ; le hasard tiré d'une graine fixe.
function bacASable(jour: string): Bac {
  const bac = vm.createContext({ console: { log() {}, warn() {}, error() {}, info() {} } }) as Bac;
  vm.runInContext(`(() => {
    const Vraie = Date, T = Vraie.parse(${JSON.stringify(`${jour}T10:00:00Z`)});
    class Figee extends Vraie { constructor(...a) { if (a.length === 0) super(T); else super(...a); } static now() { return T; } }
    globalThis.Date = Figee;
    let g = 1104; Math.random = () => { g = (g * 16807) % 2147483647; return (g - 1) / 2147483646; };
  })()`, bac);
  return bac;
}

// Un fichier du moteur, assemblé, exécuté dans le bac (comme `tests/moteur/v10.ts`, mais isolé).
function charger(bac: Bac, fichier: string, racine: string, exiger: (nom: string) => unknown): Obj {
  const module = { exports: {} as unknown };
  const f = vm.runInContext(`(function (module, exports, require) {${lireEcran(`v10/${fichier}`, racine)}\n})`, bac, { filename: fichier }) as (m: unknown, e: unknown, r: unknown) => void;
  f(module, module.exports, exiger);
  return module.exports as Obj;
}

// Une valeur en texte stable : les Map et Set dans leur ordre, les nombres non finis, les fonctions et les boucles nommés.
export function enTexte(v: unknown): string {
  const vus = new WeakSet<object>();
  const marcher = (x: unknown): unknown => {
    if (typeof x === 'bigint') return { '~bigint': String(x) };
    if (typeof x === 'number') return Number.isFinite(x) ? (Object.is(x, -0) ? 0 : x) : { '~nombre': String(x) };
    if (typeof x === 'function') return '~ƒ';
    if (x === undefined) return '~undefined';
    if (!x || typeof x !== 'object') return x;
    if (vus.has(x)) return '~boucle';
    vus.add(x);
    const tag = Object.prototype.toString.call(x);
    let r: unknown;
    if (tag === '[object Date]') r = { '~date': Number((x as Date).valueOf()) };
    else if (tag === '[object Map]') r = { '~map': [...(x as Map<unknown, unknown>)].map(([k, w]) => [marcher(k), marcher(w)]) };
    else if (tag === '[object Set]') r = { '~set': [...(x as Set<unknown>)].map(marcher) };
    else if (Array.isArray(x)) r = x.map(marcher);
    else r = Object.fromEntries(Object.entries(x as Obj).map(([k, w]) => [k, marcher(w)]));
    vus.delete(x);
    return r;
  };
  return JSON.stringify(marcher(v));
}
const empreinte = (t: string) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);

// Les paramètres d'une fonction, par leur nom (le texte de la fonction, tel qu'il est écrit).
export function parametres(f: (...a: unknown[]) => unknown): string[] {
  const s = Function.prototype.toString.call(f);
  const m = /^[^(=]*\(([^)]*)\)/.exec(s) ?? /^\s*(\w+)\s*=>/.exec(s);
  return (m?.[1] ?? '').split(',').map((x) => x.trim().replace(/=.*$/s, '').replace(/^\.\.\./, '').trim()).filter((x) => x && !/[{[]/.test(x));
}

export function photographierLeMoteur(racine = RACINE_DU_DEPOT, jour = JOUR): PhotoMoteur {
  const bac = bacASable(jour);
  const compta = charger(bac, 'compta.js', racine, () => ({}));
  const core = charger(bac, 'core.js', racine, (nom) => (nom.includes('compta') ? compta : {}));
  const demo = charger(bac, 'demo.js', racine, (nom) => (nom.includes('core') ? core : {}));
  const data = (demo.buildDemoData as (c: unknown, j: string) => Obj)({ ...((core.DEFAULT_COMPANY ?? {}) as Obj) }, jour);
  const an = Number(jour.slice(0, 4));
  const mois = jour.slice(0, 7);
  const liste = (k: string) => (Array.isArray(data[k]) ? (data[k] as Obj[]) : []);
  const trois = <T>(l: T[]): T[] => (l.length ? [l[0] as T, l[Math.floor(l.length / 2)] as T, l[l.length - 1] as T] : []);
  const ids = (l: Obj[]) => trois(l).map((x) => x.id);
  const docs = liste('documents');
  const factures = docs.filter((d) => d.type === 'facture');
  // Un livre tenu : les écritures que le moteur de l'entreprise tire de l'exemple (le premier trimestre), posées et
  // validées par le moteur du Cabinet (une sur deux). Un moteur qui n'a pas ces fonctions reçoit un livre vide.
  const fn = (o: Obj, n: string) => (typeof o[n] === 'function' ? o[n] as (...a: unknown[]) => unknown : null);
  const livre = (fn(compta, 'livreVide')?.('photo', an) ?? {}) as Obj;
  const lignes = fn(core, 'journalEntries')?.(data, data.company, { from: `${an}-01-01`, to: `${an}-03-31` });
  const parPiece = new Map<string, Obj[]>();
  for (const l of Array.isArray(lignes) ? lignes as Obj[] : []) { const k = `${l.date}|${l.journal}|${l.piece}`; parPiece.set(k, [...(parPiece.get(k) ?? []), l]); }
  let rang = 0;
  const ajouter = fn(compta, 'ajouterEcriture'), valider = fn(compta, 'validerEcriture');
  for (const [, ls] of ajouter ? parPiece : new Map<string, Obj[]>()) {
    const p = ls[0] as Obj;
    const e = ajouter?.(livre, {
      id: `photo-${++rang}`, date: p.date, journal: p.journal, piece: p.piece, libelle: p.label,
      lignes: ls.map((l) => ({ compte: l.account, tiersId: l.tiersId || null, tiers: l.tiers, libelle: l.label, debit: l.debit, credit: l.credit })),
    }, 'photo', Date.parse(`${jour}T09:00:00Z`)) as Obj;
    if (rang % 2) try { valider?.(livre, e.id, 'photo', Date.parse(`${jour}T09:30:00Z`)); } catch { /* une écriture que le moteur refuse reste au brouillard */ }
  }
  const salaries = liste('employees');
  // Pour chaque nom de paramètre, ses valeurs (trois au plus) ; un nom inconnu reçoit `undefined`.
  const POUR: [RegExp, unknown[]][] = [
    [/^(data|donnees|dossier)$/, [data]],
    [/^(company|societe|currentCompany|co)$/, [data.company]],
    [/^(settings|reglages|payrollSettings)$/, [data.payrollSettings, data.company]],
    [/^(livre|l)$/, [livre]],
    [/^(year|annee|an|anneeSuivante|exercice)$/, [an, an - 1, an - 2]],
    [/^(month|mois|ym|periode|period)$/, [mois, `${an}-01`, `${an - 1}-12`]],
    [/^quarter$/, [2, 1, 4]],
    [/^(todayIso|dateIso|iso|jour|day|toIso|asOf|au|date|aujourdhui|today|quand)$/, [jour, `${an}-12-31`, `${an - 1}-06-30`]],
    [/^(fromIso|du|debut|from)$/, [`${an}-01-01`, `${an - 1}-01-01`, mois + '-01']],
    [/^(doc|d|document|piece|invoice|facture|quote|devis)$/, trois(factures.length ? factures : docs)],
    [/^(purchase|achat|bill)$/, trois(liste('purchases'))],
    [/^(employee|emp|salarie|fiche|e)$/, trois(salaries)],
    [/^(employeeId|salarieId|empId)$/, ids(salaries)],
    [/^(client|tiers|customer)$/, trois(liste('clients'))],
    [/^(clientId|customerId|tiersId)$/, ids(liste('clients'))],
    [/^(item|article|produit)$/, trois(liste('catalog'))],
    [/^(itemId|articleId)$/, ids(liste('catalog'))],
    [/^(asset|immo|immobilisation)$/, trois(liste('assets'))],
    [/^(slip|bulletin|payslip)$/, trois(liste('payslips'))],
    [/^(project|projet)$/, trois(liste('projects'))],
    [/^(projectId|projetId)$/, ids(liste('projects'))],
    [/^(supplier|fournisseur)$/, trois(liste('suppliers'))],
    [/^(supplierId|fournisseurId)$/, ids(liste('suppliers'))],
    [/^(qui|auteur|par)$/, ['photo']],
    [/^(opts|options|o)$/, [{}, undefined]],
    [/^(n|nb|count|i)$/, [3, 0, 12]],
    [/^(v|x|montant|amount|valeur)$/, [1234.567, 0, -45.5]],
    [/^(texte|s|t|str|q|libelle|label)$/, ['Ciment gris 50 kg 1 234,500', '', 'FAC-2026-0001']],
    [/^(lang|langue)$/, ['fr']],
    [/^(currency|devise)$/, ['DT', 'EUR']],
    [/^(type|kind)$/, ['facture', 'avoir', 'devis']],
    [/^(liste|rows|lignes|entries|items)$/, [trois(docs), []]],
    [/^(id)$/, ids(docs)],
  ];
  const valeurs = (p: string): unknown[] => POUR.find(([re]) => re.test(p))?.[1] ?? [undefined];
  const photo: PhotoMoteur = { _: 'La photo du moteur (outils/rangement/moteur.ts) : pour chaque fonction publique, l\'empreinte de ses trois appels.', jour, mesure: { fonctions: 0, appels: 0, rendus: 0, erreurs: 0 }, fonctions: {} };
  for (const [nomModule, m] of [['core', core], ['compta', compta]] as const) {
    for (const [nom, f] of Object.entries(m)) {
      if (typeof f !== 'function') continue;
      photo.mesure.fonctions++;
      const ps = parametres(f as (...a: unknown[]) => unknown);
      const res: string[] = [];
      for (let k = 0; k < 3; k++) {
        // Chaque appel reçoit sa copie de ce qu'on lui passe : ce qu'il change se lit après lui.
        const args = ps.map((p) => { const l = valeurs(p); const v = l[k % l.length]; return v && typeof v === 'object' ? structuredClone(v) : v; });
        bac.__f = f; bac.__a = args;
        let t: string;
        try {
          const r = vm.runInContext('__f.apply(null, __a)', bac, { timeout: 5_000 });
          t = r && typeof (r as { then?: unknown }).then === 'function' ? '~promesse' : enTexte(r);
          photo.mesure.rendus++;
        } catch (e) {
          t = `~erreur ${String((e as Error)?.message ?? e).slice(0, 200)}`;
          photo.mesure.erreurs++;
        }
        photo.mesure.appels++;
        res.push(empreinte(`${t}\u0000${enTexte(args)}`));
      }
      photo.fonctions[`${nomModule}.${nom}`] = res;
    }
  }
  return photo;
}

// Deux photos : ce qui diffère. Une photo qui n'a pas atteint le moteur fait refuser la comparaison.
export function comparerLesMoteurs(avant: PhotoMoteur, apres: PhotoMoteur, seuils = SEUILS): string[] {
  const refus: string[] = [];
  for (const [nom, p] of [['avant', avant], ['après', apres]] as const) {
    if (p.mesure.fonctions < seuils.fonctions || p.mesure.rendus < seuils.rendus) refus.push(`La photo d'${nom} n'a pas atteint le moteur : ${p.mesure.fonctions} fonctions, ${p.mesure.rendus} appels rendus (au moins ${seuils.fonctions} et ${seuils.rendus}).`);
  }
  if (avant.jour !== apres.jour) refus.push(`Les deux photos ne sont pas prises au même jour (${avant.jour}, ${apres.jour}).`);
  for (const nom of new Set([...Object.keys(avant.fonctions), ...Object.keys(apres.fonctions)])) {
    const a = avant.fonctions[nom], b = apres.fonctions[nom];
    if (!a) refus.push(`${nom} : nouvelle (le moteur rendu public a changé)`);
    else if (!b) refus.push(`${nom} : disparue`);
    else a.forEach((x, i) => { if (b[i] !== x) refus.push(`${nom} : l'appel ${i + 1} ne rend plus la même chose`); });
  }
  return refus;
}

// node outils/rangement/moteur.ts --photo SORTIE.json [RACINE]   |   --comparer AVANT.json APRES.json
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [geste, a, b] = process.argv.slice(2);
  if (geste === '--photo' && a) {
    const p = photographierLeMoteur(b ? path.resolve(b) : RACINE_DU_DEPOT);
    fs.writeFileSync(a, `${JSON.stringify(p, null, 1)}\n`);
    console.log(`Photo du moteur : ${p.mesure.fonctions} fonctions, ${p.mesure.appels} appels (${p.mesure.rendus} rendus, ${p.mesure.erreurs} refusés).`);
  } else if (geste === '--comparer' && a && b) {
    const r = comparerLesMoteurs(JSON.parse(fs.readFileSync(a, 'utf8')) as PhotoMoteur, JSON.parse(fs.readFileSync(b, 'utf8')) as PhotoMoteur);
    if (r.length) { console.error(`Le moteur a changé :\n- ${r.join('\n- ')}`); process.exit(1); }
    console.log('Le moteur est le même, fonction par fonction.');
  } else { console.error('usage : node outils/rangement/moteur.ts --photo SORTIE.json [RACINE] | --comparer AVANT.json APRES.json'); process.exit(2); }
}
