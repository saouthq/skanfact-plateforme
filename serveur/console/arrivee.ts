// L'arrivée d'un nouveau client (1.34.0 ; la liste des fonctions qui manquent, 6 ; docs/console.md C50), pur : de son
// inscription à sa première utilisation réelle, cinq marches, chacune lue dans ce que la console sait déjà.
//   - inscrite : l'entreprise existe ;
//   - ouverte : quelqu'un y a travaillé (socle.activite, 0114) ;
//   - première pièce : une pièce créée, brouillon compris (plateforme.pieces_creees) ;
//   - première facture : une facture ÉMISE — la première utilisation réelle, celle qui a un numéro ;
//   - abonnée : son abonnement est payé (l'état « actif » de serveur/abonnement/etat.ts).
// Une marche se franchit dans un délai compté depuis l'inscription ; passé ce délai sans elle, l'arrivée est « bloquée »
// à cette marche : c'est un appel, pas une relance. Trente jours après l'inscription (la durée de l'essai), l'arrivée
// est finie, franchie ou non : le client est alors dans les autres vues.

import { joursEntre, plusJours } from '../abonnement/etat.ts';
import type { Entreprise } from './decider.ts';

export const ARRIVEE_JOURS = 30;
export const MARCHES = ['inscrite', 'ouverte', 'premiere_piece', 'premiere_facture', 'abonnee'] as const;
export type Marche = typeof MARCHES[number];
// Le délai de chaque marche, en jours depuis l'inscription (À DÉCIDER avec Skander : écrits par délégation, 15/10/2026).
export const DELAIS: Readonly<Record<Exclude<Marche, 'inscrite'>, number>> = { ouverte: 2, premiere_piece: 5, premiere_facture: 14, abonnee: ARRIVEE_JOURS };

export type Arrivee = {
  // Depuis combien de jours elle est inscrite : 0 le jour même (l'écran dit « jour 1 sur 30 »).
  jours: number;
  // Chaque marche : franchie ou non, le jour où elle l'a été quand on le sait, et le jour avant lequel on l'attend.
  marches: { id: Marche; faite: boolean; le: string | null; avant: string | null }[];
  // Combien de marches sont franchies (l'inscription comprise), et la première qui ne l'est pas.
  franchies: number;
  suivante: Marche | null;
  // Bloquée : la marche suivante a passé son délai ; depuis combien de jours.
  bloquee: { marche: Marche; depuis: number } | null;
};
type DeQuoi = Pick<Entreprise, 'creeLe' | 'derniereActivite' | 'pieces' | 'etat'> & { enPlus?: { premiereFactureLe?: string | null } };

// Ses trente premiers jours, celui de l'inscription compris.
export function enArrivee(e: Pick<Entreprise, 'creeLe'>, jour: string): boolean {
  return joursEntre(e.creeLe.slice(0, 10), jour) < ARRIVEE_JOURS;
}

export function arrivee(e: DeQuoi, jour: string): Arrivee {
  const inscrite = e.creeLe.slice(0, 10);
  const jours = Math.max(0, joursEntre(inscrite, jour));
  const premiereFacture = e.enPlus?.premiereFactureLe ?? null;
  const faites: Record<Marche, { faite: boolean; le: string | null }> = {
    inscrite: { faite: true, le: inscrite },
    ouverte: { faite: e.derniereActivite !== null, le: null },
    premiere_piece: { faite: e.pieces > 0, le: null },
    premiere_facture: { faite: premiereFacture !== null, le: premiereFacture },
    abonnee: { faite: e.etat.etat === 'actif', le: null },
  };
  const marches = MARCHES.map((id) => ({ id, ...faites[id], avant: id === 'inscrite' ? null : plusJours(inscrite, DELAIS[id]) }));
  const suivante = marches.find((m) => !m.faite)?.id ?? null;
  const delai = suivante && suivante !== 'inscrite' ? DELAIS[suivante] : null;
  return {
    jours, marches, franchies: marches.filter((m) => m.faite).length, suivante,
    bloquee: suivante && delai !== null && jours > delai ? { marche: suivante, depuis: jours - delai } : null,
  };
}
