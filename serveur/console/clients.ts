// La liste des clients, recalée sur sa maquette (Clients ; docs/console.md C17), pur : les vues du métier au-dessus de la
// liste — tout le portefeuille, ceux à appeler, l'argent attendu, les silencieux, les dossiers qu'un cabinet tient sans
// abonnement, ceux venus par un cabinet —, l'échéance de chaque ligne et ce qu'elle rapporte par an. Deux règles :
//   - C3 : chaque carte compte la liste qu'elle ouvre, par la même fonction (`dansLaVue`) ;
//   - un montant qu'on ne sait pas dire ne s'invente pas : sans offre choisie ou sans prix du jour, rien (« — »).
// Les montants sont hors taxes, au prix du jour, en texte exact ; un mensuel compte douze mois (comme « Ce qui revient
// chaque année », serveur/console/echeances.ts).

import { versTexte } from '../../moteur/argent.ts';
import { joursEntre, type Offre, type Periodicite } from '../abonnement/etat.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import type { Entreprise } from './decider.ts';
import { dateDe, type Prix, type Remises } from './echeances.ts';
import { montantRemise } from '../abonnement/remise.ts';

export type VueClients = 'tout' | 'a_appeler' | 'argent' | 'silencieux' | 'tenus' | 'cabinet';
export const VUES_CLIENTS: readonly VueClients[] = ['tout', 'a_appeler', 'argent', 'silencieux', 'tenus', 'cabinet'];
// Un essai « qui finit » : dans la semaine. Un client « silencieux » : personne ne l'a ouvert depuis dix jours.
export const ESSAI_QUI_FINIT_JOURS = 7;
export const SILENCE_JOURS = 10;

export function dansLaVue(e: Entreprise, v: VueClients, jour: string): boolean {
  const s = e.etat;
  switch (v) {
    case 'tout': return true;
    // Un essai qui finit dans la semaine sans une pièce émise, ou une grâce d'après l'essai sans offre choisie : quelqu'un
    // qui n'a pas encore vu ce que l'application lui apporte. C'est un appel, pas une relance.
    case 'a_appeler': return (s.etat === 'essai' && s.jours <= ESSAI_QUI_FINIT_JOURS && e.pieces === 0) || (s.etat === 'en_retard' && s.apresEssai && e.faits.offre === null);
    // Une offre choisie, l'échéance passée, rien encore de payé : l'argent qu'on attend.
    case 'argent': return s.etat === 'en_retard' && e.faits.offre !== null;
    // En essai ou abonné, et personne ne l'a ouvert depuis dix jours — ou jamais.
    case 'silencieux': return (s.etat === 'essai' || s.etat === 'actif')
      && (e.derniereActivite === null || joursEntre(aujourdhuiATunis(new Date(e.derniereActivite)), jour) >= SILENCE_JOURS);
    // Un dossier qu'un cabinet tient pour son client, sans abonnement à lui : à convertir.
    case 'tenus': return s.etat === 'hors' && s.raison === 'tenu_par_cabinet';
    // Venue par un cabinet (0107) : un mandat avant son premier paiement, la remise de sa première année (0106). Un
    // dossier que le cabinet tient sans abonnement n'en est pas : il est « à convertir ».
    case 'cabinet': return !!e.venuePar && !(s.etat === 'hors' && s.raison === 'tenu_par_cabinet');
  }
}

// Les entreprises venues par un cabinet (plateforme.console_venues_par_cabinet), et la remise de la prochaine période de
// chacune (plateforme.console_remises_echeances, lue comme les échéances), posées sur la liste ; une ligne illisible
// n'en fait pas une.
export function avecVenues<E extends Entreprise>(liste: readonly E[], brut: unknown, remises: Remises = new Map()): E[] {
  const b = brut && typeof brut === 'object' && !Array.isArray(brut) ? brut as Record<string, unknown> : {};
  return liste.map((e) => {
    const v = b[e.id];
    const r = v && typeof v === 'object' ? v as Record<string, unknown> : null;
    const venuePar = r && typeof r.cabinet === 'string' && r.cabinet && typeof r.depuis === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.depuis)
      ? { cabinet: r.cabinet, depuis: r.depuis } : null;
    const r2 = remises.get(e.id);
    return { ...e, venuePar, remise: r2 ? { nature: r2.nature, taux: r2.taux } : null };
  });
}

export function comptesDesVues(liste: readonly Entreprise[], jour: string): Record<VueClients, number> {
  return Object.fromEntries(VUES_CLIENTS.map((v) => [v, liste.filter((e) => dansLaVue(e, v, jour)).length])) as Record<VueClients, number>;
}

// Ce qu'une ligne rapporte par an, hors taxes, au prix du jour : un abonnement qui se renouvelle ; ou, `attendu`, ce que
// rapportera une offre choisie quand elle sera payée (la grâce, une période non renouvelée). Rien pour un essai sans offre,
// une résiliation, une suspension ou ce qui n'a pas d'échéance. La remise de sa prochaine période (0106) se déduit de
// chaque période, comme dans « Ce qui revient chaque année » (serveur/console/echeances.ts) : les deux écrans disent le
// même chiffre.
export type ParAn = { montantHt: string; attendu: boolean; remise: { nature: 'groupe' | 'cabinet'; taux: number } | null };
function enMillimes(e: Entreprise, prix: Prix): { m: bigint; attendu: boolean } | null {
  const s = e.etat;
  const surUnAn = (offre: Offre, periodicite: Periodicite) => {
    const brut = prix.get(`${offre}/${periodicite}`);
    if (brut === undefined) return null;
    const p = e.remise ? brut - montantRemise(brut, e.remise.taux) : brut;
    return periodicite === 'mensuel' ? p * 12n : p;
  };
  if (s.etat === 'actif') {
    const m = s.resilie ? null : surUnAn(s.offre, s.periodicite);
    return m === null ? null : { m, attendu: false };
  }
  const attendue = s.etat === 'en_retard' || (s.etat === 'lecture_seule' && s.raison === 'non_renouvele');
  if (!attendue || !e.faits.offre || !e.faits.periodicite) return null;
  const m = surUnAn(e.faits.offre, e.faits.periodicite);
  return m === null ? null : { m, attendu: true };
}
export function parAn(e: Entreprise, prix: Prix): ParAn | null {
  const p = enMillimes(e, prix);
  return p ? { montantHt: versTexte(p.m, 3), attendu: p.attendu, remise: e.remise ?? null } : null;
}

// L'échéance d'une ligne : le prochain jour où quelque chose change pour elle — la fin de l'essai, la fin de la période
// payée, le passage en lecture seule d'une grâce (le jour qui la range dans « Abonnements », par la même fonction).
// Une entreprise déjà en lecture seule n'en a plus : ce jour est passé, et la colonne « État » dit depuis quand.
export const echeanceDe = (e: Entreprise): string | null => (e.etat.etat === 'lecture_seule' ? null : dateDe(e.etat));

// Une ligne de la liste : l'entreprise telle qu'elle est lue, son échéance et ce qu'elle rapporte par an.
export const ligneClient = (e: Entreprise, prix: Prix) => ({ ...e, echeance: echeanceDe(e), parAn: parAn(e, prix) });

// L'ordre de la liste. Par défaut le plus urgent d'abord (rangerParUrgence, serveur/console/decider.ts) ; les autres
// ordres trient CETTE liste d'un tri stable : à égalité, l'urgence départage. Ce qui n'a pas de valeur (pas d'échéance,
// rien par an, jamais ouvert) va toujours en bas, dans les deux sens de lecture.
export type TriClients = 'urgence' | 'echeance' | 'par_an' | 'nom' | 'vu';
export const TRIS_CLIENTS: readonly TriClients[] = ['urgence', 'echeance', 'par_an', 'nom', 'vu'];
const NOMS = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
export function trier(liste: readonly Entreprise[], tri: TriClients, prix: Prix): Entreprise[] {
  if (tri === 'urgence') return [...liste];
  const cle = (e: Entreprise): string | bigint | null => {
    switch (tri) {
      case 'echeance': return echeanceDe(e);
      case 'par_an': return enMillimes(e, prix)?.m ?? null;
      case 'nom': return e.raisonSociale;
      case 'vu': return e.derniereActivite === null ? null : new Date(e.derniereActivite).toISOString();
    }
  };
  // L'échéance et le nom se lisent du plus proche au plus loin ; ce qui rapporte et ce qui a servi, du plus au moins.
  const sens = tri === 'echeance' || tri === 'nom' ? 1 : -1;
  return liste.map((e, i) => ({ e, i, k: cle(e) })).sort((a, b) => {
    if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1;
    const c = typeof a.k === 'bigint' && typeof b.k === 'bigint' ? (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)
      : tri === 'nom' ? NOMS.compare(String(a.k), String(b.k)) : String(a.k) < String(b.k) ? -1 : String(a.k) > String(b.k) ? 1 : 0;
    return c * sens || a.i - b.i;
  }).map((x) => x.e);
}

// Ce que rapportent par an les abonnements actifs de la sélection (pas ce qui est attendu : il n'est pas encore payé).
export function parAnDeLaSelection(liste: readonly Entreprise[], prix: Prix): { montantHt: string; abonnements: number } {
  let total = 0n, abonnements = 0;
  for (const e of liste) {
    const p = enMillimes(e, prix);
    if (!p || p.attendu) continue;
    total += p.m;
    abonnements++;
  }
  return { montantHt: versTexte(total, 3), abonnements };
}
