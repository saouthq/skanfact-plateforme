// La facture électronique (brique 80 ; docs/facture-electronique.md ; 05 § 3.1) : le fichier TEIF d'une
// facture ou d'un avoir émis. Il est écrit par le code de la v10 (web/public/v10/teif.js, le format
// TEIF 1.8.8 lu dans le schéma de la TTN et validé contre lui sur les 278 pièces de l'exemple), sur la
// pièce du dossier : UN calcul pour l'impression et pour le fichier (ses montants viennent de
// `computeTotals`, comme le PDF). Le serveur ne le croit pas sur parole : il compare les montants du
// fichier à ceux qu'il a scellés en entiers (deux chemins, un chiffre).
//
// Le code de l'écran est chargé ici une fois, comme les bancs de test le chargent (tests/moteur/v10.ts) :
// le paquet est en modules ES, et ces fichiers attendent l'objet `module` de CommonJS.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

type Json = Record<string, unknown>;
export type Manque = { cible: string; message: string };
type Controle = { ok: boolean; bloquants: Manque[]; remarques: Manque[] };
type Fichier = Controle & { xml: string; nom: string };
type Teif = {
  VERSION: string;
  controleTeif: (doc: Json, client: Json | null, societe: Json) => Controle;
  teifXml: (doc: Json, client: Json | null, societe: Json, opts?: { facture?: Json | null }) => Fichier;
};

const ECRAN = path.join(import.meta.dirname, '../../web/public/v10');
const charges = new Map<string, unknown>();
function charger(fichier: string): unknown {
  const deja = charges.get(fichier);
  if (deja) return deja;
  const module = { exports: {} as unknown };
  const source = fs.readFileSync(path.join(ECRAN, fichier), 'utf8');
  (vm.runInThisContext(`(function (module, exports, require) {${source}\n})`, { filename: fichier }) as (m: unknown, e: unknown, r: unknown) => void)(
    module, module.exports, (nom: string) => charger(`${nom.replace(/^\.\//, '')}.js`));
  charges.set(fichier, module.exports);
  return module.exports;
}
let teif: Teif | null = null;
const T = () => (teif ??= charger('teif.js') as Teif);

// Un objet du dossier tel que l'écran le tient : un nombre non entier y est gardé en texte exact
// ({ "~n": "450.5" }) et l'écran le relit en nombre (le point de contact fait de même).
export function commeLaV10(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(commeLaV10);
  if (v && typeof v === 'object') {
    const cles = Object.keys(v);
    if (cles.length === 1 && cles[0] === '~n') return Number((v as { '~n': string })['~n']);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, commeLaV10(x)]));
  }
  return v;
}

// Ce qui empêcherait le fichier (le numéro n'est pas encore pris : on le suppose, pour ne juger que
// les identités, les lignes et la devise).
export function manquesAvantNumero(doc: Json, client: Json | null, societe: Json): Manque[] {
  return T().controleTeif({ ...doc, number: doc.number || 'A-EMETTRE', status: 'envoyée' }, client, societe).bloquants;
}

export function fichierTeif(doc: Json, client: Json | null, societe: Json, facture: Json | null) {
  return { ...T().teifXml(doc, client, societe, { facture }), version: T().VERSION };
}

// Un montant du fichier, par son code (« I-180 » : le TTC) ; null s'il n'y est pas.
export function montantDuFichier(xml: string, code: string): string | null {
  const m = new RegExp(`amountTypeCode="${code}">\\s*<Amount\\s+currencyIdentifier="[A-Z]{3}">(-?[0-9.]+)</Amount>`).exec(xml);
  return m?.[1] ?? null;
}

// Deux chemins, un chiffre : le fichier dit-il les montants que le serveur a scellés (le TTC, la TVA, le
// hors taxes net) ? Le premier écart, ou null.
export function ecartAvecLeServeur(xml: string, scelles: { ttc: string; tva: string; ht: string }) {
  for (const [code, serveur] of [['I-180', scelles.ttc], ['I-181', scelles.tva], ['I-176', scelles.ht]] as const) {
    const fichier = montantDuFichier(xml, code);
    if (fichier !== serveur) return { code, fichier: fichier ?? '—', serveur };
  }
  return null;
}
