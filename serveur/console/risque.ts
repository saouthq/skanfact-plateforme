// Le risque de départ d'un client (1.40.0 ; base 0132 ; docs/console.md C56 ; la liste des fonctions qui manquent, 7 :
// « suivi de la satisfaction et du risque de départ : retours, insatisfaction et baisse d'utilisation »), pur. Version
// légère : des SIGNES lus dans ce que la console sait déjà, jamais une note inventée. Seul un client qui paie peut partir
// (abonné, ou une échéance passée sans paiement après un abonnement) ; un essai qui ne choisit pas d'offre n'est pas un
// départ, il est « à appeler ».
//   - resiliation : il a demandé à partir à son échéance ;
//   - retard : son paiement est en retard ;
//   - contestation : il conteste une de nos factures (0129), pas encore réglée ;
//   - demandes : plusieurs demandes au support restent ouvertes (« ses retours ») ;
//   - usage_en_baisse : il émet au moins deux fois moins de pièces ces trente jours que les trente d'avant (0132) ;
//   - silencieux : personne n'a ouvert son entreprise depuis dix jours (la règle de la vue « Silencieux »).
// La satisfaction elle-même ne se mesure pas encore (aucune question n'est posée aux clients) : l'écran le dit.

import type { Entreprise } from './decider.ts';
import { silencieuse } from './clients.ts';

export const SIGNES_RISQUE = ['resiliation', 'retard', 'contestation', 'demandes', 'usage_en_baisse', 'silencieux'] as const;
export type SigneRisque = typeof SIGNES_RISQUE[number];
// À DÉCIDER : les seuils. Une baisse se compte sur au moins quatre pièces les trente jours d'avant (en dessous, un
// mois calme n'est pas une baisse) ; « plusieurs » demandes ouvertes, c'est deux.
export const USAGE_AVANT_MIN = 4;
export const DEMANDES_OUVERTES_MIN = 2;

export type Usage = { trente: number; avant: number };
export type Risque = { signes: SigneRisque[]; usage: Usage | null };

// Ce que la base rend (plateforme.console_usage_trente), lu prudemment : un nombre illisible vaut « rien ».
export function lireUsages(brut: unknown): Map<string, Usage> {
  const b = brut && typeof brut === 'object' && !Array.isArray(brut) ? brut as Record<string, unknown> : {};
  const n = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : null);
  const m = new Map<string, Usage>();
  for (const [id, v] of Object.entries(b)) {
    const r = v && typeof v === 'object' ? v as Record<string, unknown> : {};
    const trente = n(r.trente), avant = n(r.avant);
    if (trente !== null && avant !== null) m.set(id, { trente, avant });
  }
  return m;
}

export const payant = (e: Pick<Entreprise, 'etat'>): boolean =>
  e.etat.etat === 'actif' || (e.etat.etat === 'en_retard' && !e.etat.apresEssai);
export const usageEnBaisse = (u: Usage | null): boolean => !!u && u.avant >= USAGE_AVANT_MIN && u.trente * 2 <= u.avant;

// Ses signes, dans l'ordre de SIGNES_RISQUE ; `contestees` : les entreprises qui ont une contestation ouverte ; `demandes` :
// le nombre de demandes ouvertes au support, par entreprise.
export function risqueDe(e: Entreprise, jour: string, usage: Usage | null, contestees: ReadonlySet<string>, demandes: ReadonlyMap<string, number>): Risque {
  if (!payant(e)) return { signes: [], usage };
  const s = e.etat;
  const vrais: Record<SigneRisque, boolean> = {
    resiliation: s.etat === 'actif' && s.resilie,
    retard: s.etat === 'en_retard',
    contestation: contestees.has(e.id),
    demandes: (demandes.get(e.id) ?? 0) >= DEMANDES_OUVERTES_MIN,
    usage_en_baisse: usageEnBaisse(usage),
    silencieux: silencieuse(e, jour),
  };
  return { signes: SIGNES_RISQUE.filter((k) => vrais[k]), usage };
}

export const aRisque = (e: Pick<Entreprise, 'risque'>): boolean => (e.risque?.signes.length ?? 0) > 0;

// Posé sur la liste, comme ce qu'elle dit en plus (avecEnPlus) : chaque entreprise porte son risque.
export function avecRisque<E extends Entreprise>(liste: readonly E[], jour: string, usages: ReadonlyMap<string, Usage>,
  contestees: ReadonlySet<string>, demandes: ReadonlyMap<string, number>): E[] {
  return liste.map((e) => ({ ...e, risque: risqueDe(e, jour, usages.get(e.id) ?? null, contestees, demandes) }));
}
