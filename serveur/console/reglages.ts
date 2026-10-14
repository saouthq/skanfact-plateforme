// Les réglages de la plateforme (Console ; skanfact docs/cadrage/10-console.md § 2.9 ; docs/console.md C28) : ce qui vaut
// pour tous les clients, lu au même endroit — la grille des prix (base 0082, datée), le registre des règles communes
// (base 0004, posé depuis base/regles-communes.json) avec ses relectures, et le message affiché en haut de l'application
// des clients (base 0093). Pur (testé : tests/console/reglages.test.ts) : la route lit la base ; ces fonctions rangent.
// Rien n'est inventé : un prix qui n'est pas posé n'a pas de case, une règle que personne n'a relue le dit.

import { versTexte } from '../../moteur/argent.ts';
import type { Offre, Periodicite } from '../abonnement/etat.ts';
import type { Entreprise } from './decider.ts';

export type PrixLu = { offre: Offre; periodicite: Periodicite; aPartirDu: string; montantHt: bigint };
export type Relecture = { reluePar: string; avis: 'juste' | 'a_corriger'; dit: string | null; motif: string; par: string; le: string };
export type RegleLue = { id: string; code: string; valeur: unknown; debut: string; fin: string | null; source: string; poseeLe: string; relectures: Relecture[] };
export type MessageLu = {
  id: string; sorte: 'nouveaute' | 'maintenance'; texte: string; du: string; au: string; motif: string; par: string; le: string;
  enCours: boolean; retireLe: string | null; retirePar: string | null; retireMotif: string | null; remplace: boolean;
};
export type ReglagesLus = { prix: PrixLu[]; regles: RegleLue[]; messages: MessageLu[] };

const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const jour = (x: unknown) => (typeof x === 'string' && JOUR.test(x.slice(0, 10)) ? x.slice(0, 10) : null);
const date = (x: unknown) => (typeof x === 'string' && Number.isFinite(Date.parse(x)) ? x : null);
const texte = (x: unknown) => (typeof x === 'string' && x.length > 0 ? x : null);
const tableau = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter((y) => y && typeof y === 'object') : []);
const objet = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {});
const millimes = (x: unknown) => (typeof x === 'string' && /^\d+$/.test(x) ? BigInt(x) : null);

// Ce que la base rend (plateforme.console_reglages), lu prudemment : une ligne illisible ne s'affiche pas, plutôt que de
// s'afficher fausse.
export function lireReglages(brut: unknown): ReglagesLus {
  const b = objet(brut);
  return {
    prix: tableau(b.prix).flatMap((p): PrixLu[] => {
      const offre = p.offre === 'essentiel' || p.offre === 'complet' ? p.offre : null;
      const periodicite = p.periodicite === 'annuel' || p.periodicite === 'mensuel' ? p.periodicite : null;
      const aPartirDu = jour(p.aPartirDu), montantHt = millimes(p.montantHt);
      return offre && periodicite && aPartirDu && montantHt !== null ? [{ offre, periodicite, aPartirDu, montantHt }] : [];
    }),
    regles: tableau(b.regles).flatMap((r): RegleLue[] => {
      const id = texte(r.id), code = texte(r.code), debut = jour(r.debut), source = texte(r.source), poseeLe = date(r.poseeLe);
      if (!id || !code || !debut || !source || !poseeLe) return [];
      const relectures = tableau(r.relectures).flatMap((l): Relecture[] => {
        const reluePar = texte(l.reluePar), motif = texte(l.motif), par = texte(l.par), le = date(l.le);
        const avis = l.avis === 'juste' || l.avis === 'a_corriger' ? l.avis : null;
        return reluePar && motif && par && le && avis ? [{ reluePar, avis, dit: texte(l.dit), motif, par, le }] : [];
      });
      return [{ id, code, valeur: r.valeur ?? null, debut, fin: jour(r.fin), source, poseeLe, relectures }];
    }),
    messages: tableau(b.messages).flatMap((m): MessageLu[] => {
      const id = texte(m.id), t = texte(m.texte), du = jour(m.du), au = jour(m.au), motif = texte(m.motif), par = texte(m.par), le = date(m.le);
      const sorte = m.sorte === 'nouveaute' || m.sorte === 'maintenance' ? m.sorte : null;
      if (!id || !t || !du || !au || !motif || !par || !le || !sorte) return [];
      return [{ id, sorte, texte: t, du, au, motif, par, le, enCours: m.enCours === true, retireLe: date(m.retireLe), retirePar: texte(m.retirePar),
        retireMotif: texte(m.retireMotif), remplace: m.remplace === true }];
    }),
  };
}

// ── La grille du jour ───────────────────────────────────────────────────────────────────────────────────────────────
// Pour chaque offre et chaque périodicité : le prix en vigueur (le dernier posé à cette date, comme plateforme.prix_du_jour
// le lit pour les clients) et depuis quand ; ceux qui sont datés après aujourd'hui ; et les entreprises abonnées — celles
// dont une période payée court aujourd'hui, d'après l'état que la console déduit de leurs faits (le même que la liste des
// clients). Hors taxes, en texte décimal : l'argent ne sort jamais en millimes bruts.
export type Case = { ht: string; depuis: string } | null;
export type AVenir = { periodicite: Periodicite; ht: string; aPartirDu: string };
export type LigneGrille = { offre: Offre; annuel: Case; mensuel: Case; aVenir: AVenir[]; abonnes: { annuel: number; mensuel: number } };
export const OFFRES: readonly Offre[] = ['essentiel', 'complet'];

// Le prix en vigueur d'une liste de prix datés (ceux d'une offre ou d'un ajout, à une périodicité) : le dernier posé à
// cette date, et depuis quand — la même règle pour les offres et pour les ajouts.
function enVigueurParmi(dates: readonly { aPartirDu: string; montantHt: bigint }[], aujourdhui: string): Case {
  const p = dates.filter((x) => x.aPartirDu <= aujourdhui).sort((a, b) => (a.aPartirDu < b.aPartirDu ? 1 : -1))[0];
  return p ? { ht: versTexte(p.montantHt, 3), depuis: p.aPartirDu } : null;
}

export function grille(prix: PrixLu[], entreprises: Entreprise[], aujourdhui: string): LigneGrille[] {
  const enVigueur = (offre: Offre, periodicite: Periodicite) =>
    enVigueurParmi(prix.filter((x) => x.offre === offre && x.periodicite === periodicite), aujourdhui);
  const abonnes = (offre: Offre, periodicite: Periodicite) =>
    entreprises.filter((e) => e.etat.etat === 'actif' && e.etat.offre === offre && e.etat.periodicite === periodicite).length;
  return OFFRES.map((offre) => ({
    offre,
    annuel: enVigueur(offre, 'annuel'),
    mensuel: enVigueur(offre, 'mensuel'),
    aVenir: prix.filter((x) => x.offre === offre && x.aPartirDu > aujourdhui)
      .sort((a, b) => (a.aPartirDu === b.aPartirDu ? (a.periodicite < b.periodicite ? -1 : 1) : a.aPartirDu < b.aPartirDu ? -1 : 1))
      .map((x) => ({ periodicite: x.periodicite, ht: versTexte(x.montantHt, 3), aPartirDu: x.aPartirDu })),
    abonnes: { annuel: abonnes(offre, 'annuel'), mensuel: abonnes(offre, 'mensuel') },
  }));
}

// ── Ce qui s'ajoute à l'offre (14c ; 0099, 0101) ──────────────────────────────────────────────────────────────────────
// Ses prix datés, rangés comme ceux des offres : en vigueur à chaque périodicité, et à venir. Pour un module acheté seul,
// les abonnés d'aujourd'hui qui l'ont acheté — Essentiel, d'après le même état que la liste des clients (Complet le
// contient : il ne s'y achète pas). Une option que la base ne connaît pas ne s'affiche pas.
export const AJOUTS = ['utilisateur', 'caisse', 'etablissement', 'salarie', 'module_paie', 'module_compta'] as const;
export type Ajout = typeof AJOUTS[number];
export type OptionLue = { option: Ajout; periodicite: Periodicite; aPartirDu: string; montantHt: bigint };
export type AjoutsLus = { options: OptionLue[]; modules: { entreprise: string; modules: string[] }[] };
export function lireAjouts(brut: unknown): AjoutsLus {
  const b = objet(brut);
  return {
    options: tableau(b.options).flatMap((p): OptionLue[] => {
      const option = (AJOUTS as readonly unknown[]).includes(p.option) ? p.option as Ajout : null;
      const periodicite = p.periodicite === 'annuel' || p.periodicite === 'mensuel' ? p.periodicite : null;
      const aPartirDu = jour(p.aPartirDu), montantHt = millimes(p.montantHt);
      return option && periodicite && aPartirDu && montantHt !== null ? [{ option, periodicite, aPartirDu, montantHt }] : [];
    }),
    modules: tableau(b.modules).flatMap((m) => {
      const entreprise = texte(m.entreprise);
      const modules = Array.isArray(m.modules) ? m.modules.filter((x): x is string => typeof x === 'string') : [];
      return entreprise ? [{ entreprise, modules }] : [];
    }),
  };
}
export type LigneAjout = { option: Ajout; annuel: Case; mensuel: Case; aVenir: AVenir[]; achetes: number | null };
export function grilleAjouts(a: AjoutsLus, entreprises: Entreprise[], aujourdhui: string): LigneAjout[] {
  const enVigueur = (option: Ajout, periodicite: Periodicite) =>
    enVigueurParmi(a.options.filter((x) => x.option === option && x.periodicite === periodicite), aujourdhui);
  const abonnes = new Set(entreprises.filter((e) => e.etat.etat === 'actif' && e.etat.offre === 'essentiel').map((e) => e.id));
  const achetes = (module: string) => a.modules.filter((m) => abonnes.has(m.entreprise) && m.modules.includes(module)).length;
  return AJOUTS.map((option) => ({
    option,
    annuel: enVigueur(option, 'annuel'),
    mensuel: enVigueur(option, 'mensuel'),
    aVenir: a.options.filter((x) => x.option === option && x.aPartirDu > aujourdhui)
      .sort((x, y) => (x.aPartirDu === y.aPartirDu ? (x.periodicite < y.periodicite ? -1 : 1) : x.aPartirDu < y.aPartirDu ? -1 : 1))
      .map((x) => ({ periodicite: x.periodicite, ht: versTexte(x.montantHt, 3), aPartirDu: x.aPartirDu })),
    achetes: option === 'module_paie' ? achetes('paie') : option === 'module_compta' ? achetes('compta') : null,
  }));
}

// Les essais en cours aujourd'hui, toutes entreprises (le même état que la liste des clients).
export const essaisEnCours = (entreprises: Entreprise[]) => entreprises.filter((e) => e.etat.etat === 'essai').length;

// ── Le registre ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Une règle, telle qu'on la lit : son nom et sa valeur dans son unité, quand on la connaît. Une règle d'un code qu'on ne
// connaît pas se montre par son code et sa valeur brute, jamais avec une unité devinée.
type Connue = { unite: 'millimes' };
export const REGLES_CONNUES: Readonly<Record<string, Connue>> = {
  // Le timbre d'une facture : des millimes de dinar (serveur/ventes/pieces.ts le lit tel quel dans le total).
  'timbre.facture': { unite: 'millimes' },
};
export function valeurDeRegle(code: string, valeur: unknown): { connue: boolean; texte: string } {
  const c = REGLES_CONNUES[code];
  if (c?.unite === 'millimes' && (typeof valeur === 'number' || typeof valeur === 'string') && /^\d+$/.test(String(valeur))) {
    return { connue: true, texte: versTexte(BigInt(valeur), 3) };
  }
  return { connue: false, texte: JSON.stringify(valeur) };
}
// En vigueur un jour donné : commencée, et pas finie (la fin est le dernier jour où elle vaut).
export const regleEnVigueur = (r: { debut: string; fin: string | null }, aujourdhui: string) => r.debut <= aujourdhui && (r.fin === null || r.fin >= aujourdhui);

export type LigneRegistre = RegleLue & { enVigueur: boolean; valeurLue: { connue: boolean; texte: string }; aRelire: boolean };
// La dernière relecture dit si la règle est à relire : jamais relue, ou relue « à corriger » (la correction est une
// nouvelle règle, écrite dans le dépôt avec sa source ; tant qu'elle n'y est pas, celle-ci reste à reprendre).
export function registre(regles: RegleLue[], aujourdhui: string): LigneRegistre[] {
  return regles.map((r) => ({
    ...r, enVigueur: regleEnVigueur(r, aujourdhui), valeurLue: valeurDeRegle(r.code, r.valeur),
    aRelire: regleEnVigueur(r, aujourdhui) && (r.relectures[0]?.avis ?? 'a_corriger') === 'a_corriger',
  }));
}

// ── Au journal ───────────────────────────────────────────────────────────────────────────────────────────────────────
// Un geste des réglages dit sur quoi il porte : la règle relue (son code) et l'avis, ou le message écrit ou retiré (ses
// deux jours). Lu dans ce que la base a gardé du geste (plateforme.geste_console : avant, après), jamais recalculé.
export type SujetDesReglages = { regle: string | null; reluePar: string | null; avis: 'juste' | 'a_corriger' | null; du: string | null; au: string | null };
export function sujetDesReglages(geste: string, avant: Record<string, unknown> | null, apres: Record<string, unknown> | null): SujetDesReglages | null {
  if (!geste.startsWith('reglages.')) return null;
  const s = geste === 'reglages.message_retire' ? avant : apres;
  return {
    regle: texte(apres?.regle), reluePar: texte(apres?.reluePar),
    avis: apres?.avis === 'juste' || apres?.avis === 'a_corriger' ? apres.avis : null,
    du: jour(s?.du), au: jour(s?.au),
  };
}
