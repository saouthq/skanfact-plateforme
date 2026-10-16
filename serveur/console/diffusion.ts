// La communication ciblée et le suivi de sa diffusion (1.47.0 ; base 0139 ; docs/console.md C63 ; la liste des fonctions
// qui manquent, 37), pur : le public d'une entreprise (lu dans l'état de son abonnement, par la même fonction que la liste
// des clients), si un message la vise, et ce que la base dit de la diffusion, lu prudemment.

import type { Etat } from '../abonnement/etat.ts';

export const PUBLICS = ['essai', 'essentiel', 'complet', 'en_retard', 'lecture_seule'] as const;
export type Public = typeof PUBLICS[number];
export type Diffusion = { id: string; cible: Public[]; vus: number; caches: number };

// Les publics d'une entreprise : chacun de ceux qui la décrivent (un abonné Complet en retard est des deux). Une entreprise
// hors service (désactivée, inconnue) n'est d'aucun : seul un message à tous l'atteint.
export function publicsDe(etat: Etat | null, offre: string | null): Public[] {
  if (!etat) return [];
  const p: Public[] = [];
  if (etat.etat === 'essai') p.push('essai');
  if ((etat.etat === 'actif' || etat.etat === 'en_retard') && (offre === 'essentiel' || offre === 'complet')) p.push(offre);
  if (etat.etat === 'en_retard') p.push('en_retard');
  if (etat.etat === 'lecture_seule') p.push('lecture_seule');
  return p;
}

// Un message vise-t-il ces publics ? Sans public posé, il vise tout le monde.
export const vise = (cible: readonly Public[], publics: readonly Public[]): boolean => cible.length === 0 || cible.some((c) => publics.includes(c));

const entier = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
export const lireCible = (v: unknown): Public[] => (Array.isArray(v) ? PUBLICS.filter((p) => v.includes(p)) : []);

// Ce que la base rend (plateforme.console_diffusion_messages) : une ligne illisible n'existe pas.
export function lireDiffusions(brut: unknown): Diffusion[] {
  if (!Array.isArray(brut)) return [];
  return brut.flatMap((x): Diffusion[] => {
    if (!x || typeof x !== 'object') return [];
    const o = x as Record<string, unknown>;
    const vus = entier(o.vus), caches = entier(o.caches);
    if (typeof o.id !== 'string' || !Array.isArray(o.cible) || vus === null || caches === null || caches > vus) return [];
    return [{ id: o.id, cible: lireCible(o.cible), vus, caches }];
  });
}

// Combien d'entreprises chaque public atteint aujourd'hui, dans la liste des clients et par la même fonction que la route
// de l'application : la fenêtre « Écrire un message » le dit avant le geste. « Tous » : chaque entreprise, sauf celles
// d'exemple (qui ne comptent pas non plus dans la diffusion).
export type Portee = Record<Public | 'tous', number>;
export function portee(liste: readonly { etat: Etat; faits: { offre: string | null } }[]): Portee {
  const n: Portee = { tous: 0, essai: 0, essentiel: 0, complet: 0, en_retard: 0, lecture_seule: 0 };
  for (const e of liste) {
    if (e.etat.etat === 'hors' && e.etat.raison === 'bac_a_sable') continue;
    n.tous += 1;
    for (const p of publicsDe(e.etat, e.faits.offre)) n[p] += 1;
  }
  return n;
}
