// La dernière activité d'une personne dans une entreprise (0114, socle.activite ; docs/console.md C37) : ce que la console
// lit pour dire qu'un client « n'a pas été vu depuis dix jours ». Le serveur la note après une requête acceptée sur une
// route de l'entreprise, au plus une fois toutes les cinq minutes par personne et par entreprise (le reste du temps, rien
// n'est écrit), dans sa propre transaction : une note manquée ne fait jamais échouer la requête.
// Ce qui est noté : la personne, l'entreprise, l'instant. Ni la page, ni le geste, ni l'adresse.

import { enTantQue } from './base.ts';
import type { Contexte } from './connexion.ts';

export const ACTIVITE_PAS_MS = 5 * 60_000;
const notees = new Map<string, number>();

export function noterActivite(ctx: Contexte, utilisateur: string, entreprise: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(entreprise)) return;
  const maintenant = (ctx.maintenant ?? (() => new Date()))();
  const cle = `${utilisateur}:${entreprise}`;
  const avant = notees.get(cle);
  if (avant !== undefined && maintenant.getTime() - avant < ACTIVITE_PAS_MS) return;
  notees.set(cle, maintenant.getTime());
  // La mémoire ne grandit pas sans fin : au-delà de cent mille couples, elle repart de zéro (une note de plus, pas une de moins).
  if (notees.size > 100_000) notees.clear();
  void enTantQue(ctx.pool, utilisateur, async (tx) => { await tx.query('select socle.noter_activite($1, $2)', [entreprise, maintenant]); })
    .catch(() => { notees.delete(cle); });
}
