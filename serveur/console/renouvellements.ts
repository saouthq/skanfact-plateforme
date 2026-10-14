// Le renouvellement de chaque entreprise (0113 ; l'audit du 14/10/2026) : ce que sa prochaine facture dira, par la MÊME
// règle que la facture (serveur/abonnement/factures.ts, htDeLaPeriode) — l'offre au prix du premier jour de la période,
// ce qui s'y ajoute (un module acheté seul, ce qui dépasse l'offre, le rattrapage d'un module ouvert en cours), la remise
// de la période. La liste des clients, les échéances, la fiche et « Ce qui revient chaque année » le lisent d'ici :
// aucun écran ne recompte un prix de son côté.

import type { Offre, Periodicite } from '../abonnement/etat.ts';
import { htDeLaPeriode, lireLignesEnPlus, periodeDeLaFacture } from '../abonnement/factures.ts';
import { lireRemise, type Remise } from '../abonnement/remise.ts';
import type { Transaction } from '../base.ts';
import type { Entreprise } from './decider.ts';

// `periodeHt` : la prochaine facture, rattrapage compris ; `parAnHt` : ce qui revient chaque année (sans le rattrapage,
// douze fois un mois). `attendu` : une offre choisie qui attend son paiement (la grâce, une période non renouvelée).
export type Renouvellement = { offre: Offre; periodicite: Periodicite; debut: string; periodeHt: bigint; parAnHt: bigint; remise: Remise | null; attendu: boolean };
// Une entreprise absente ne se renouvelle pas ; `null` : elle se renouvelle, mais un prix manque — rien ne s'invente.
export type Renouvellements = ReadonlyMap<string, Renouvellement | null>;
export type ARenouveler = { entreprise: string; offre: Offre; periodicite: Periodicite; debut: string; attendu: boolean };

// Ce qui se renouvelle, et avec quelle offre : un abonnement payé qui court, sans résiliation ; ou une offre choisie qui
// attend son paiement (en grâce, après un essai ou une période payée ; une période non renouvelée). Rien sans offre
// choisie (un essai), pour une résiliation, une suspension (une décision de SkanFact), ce qui n'a pas d'échéance. L'offre : celle choisie pour la
// prochaine échéance (0111) quand elle vaut au premier jour de la période, sinon l'offre payée. La période : celle de
// la facture (periodeDeLaFacture).
export function aRenouveler(e: Entreprise, jour: string): ARenouveler | null {
  const s = e.etat, f = e.faits;
  const attendu = s.etat === 'actif' ? (s.resilie ? null : false)
    : s.etat === 'en_retard' || (s.etat === 'lecture_seule' && s.raison === 'non_renouvele') ? true : null;
  if (attendu === null || !f.offre || !f.periodicite) return null;
  const { debut } = periodeDeLaFacture(f, f.periodicite, jour);
  const s2 = f.offreSuivante && debut >= f.offreSuivante.aPartirDu ? f.offreSuivante : null;
  return { entreprise: e.id, offre: s2?.offre ?? f.offre, periodicite: s2?.periodicite ?? f.periodicite, debut, attendu };
}

// Ce que la base rend pour chaque demande (plateforme.console_renouvellements), compté par la règle de la facture.
export function lireRenouvellements(demandes: readonly ARenouveler[], brut: unknown): Map<string, Renouvellement | null> {
  const b = brut && typeof brut === 'object' && !Array.isArray(brut) ? brut as Record<string, unknown> : {};
  return new Map(demandes.map((d) => {
    const v = b[d.entreprise];
    const r = v && typeof v === 'object' ? v as Record<string, unknown> : {};
    if (typeof r.prixHt !== 'string' || !/^\d+$/.test(r.prixHt)) return [d.entreprise, null];
    const prixHt = BigInt(r.prixHt), enPlus = lireLignesEnPlus(r.enPlus), remise = lireRemise(r.remise);
    const unePeriode = htDeLaPeriode(prixHt, enPlus, remise, true);
    return [d.entreprise, { offre: d.offre, periodicite: d.periodicite, debut: d.debut, attendu: d.attendu, remise,
      periodeHt: htDeLaPeriode(prixHt, enPlus, remise), parAnHt: d.periodicite === 'mensuel' ? unePeriode * 12n : unePeriode }];
  }));
}

// Toute la liste, en un passage.
export async function renouvellementsDe(x: Transaction, liste: readonly Entreprise[], jour: string): Promise<Renouvellements> {
  const demandes = liste.flatMap((e) => aRenouveler(e, jour) ?? []);
  if (!demandes.length) return new Map();
  const r = await x.query('select plateforme.console_renouvellements($1::jsonb, $2::date) v',
    [JSON.stringify(demandes.map(({ entreprise, offre, periodicite, debut }) => ({ entreprise, offre, periodicite, debut }))), jour]);
  return lireRenouvellements(demandes, r.rows[0]?.v);
}
