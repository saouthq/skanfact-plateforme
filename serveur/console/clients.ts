// La liste des clients, recalée sur sa maquette (Clients ; docs/console.md C17), pur : les vues du métier au-dessus de la
// liste — tout le portefeuille, ceux à appeler, l'argent attendu, les silencieux, les dossiers qu'un cabinet tient sans
// abonnement, ceux venus par un cabinet —, l'échéance de chaque ligne et ce qu'elle rapporte par an. Deux règles :
//   - C3 : chaque carte compte la liste qu'elle ouvre, par la même fonction (`dansLaVue`) ;
//   - un montant qu'on ne sait pas dire ne s'invente pas : sans offre choisie ou sans prix, rien (« — »).
// Les montants sont hors taxes, par la règle de la facture (serveur/console/renouvellements.ts : le prix du premier jour
// de la période, ce qui s'y ajoute, la remise), en texte exact ; un mensuel compte douze mois (comme « Ce qui revient
// chaque année », serveur/console/echeances.ts).

import { versTexte } from '../../moteur/argent.ts';
import { joursEntre } from '../abonnement/etat.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { enArrivee } from './arrivee.ts';
import { aServi, type EnPlus, type Entreprise, type FactureQuiAttend } from './decider.ts';
import { dateDe, type Remises } from './echeances.ts';
import { lireFacturesAbonnement } from '../abonnement/factures.ts';
import type { Renouvellements } from './renouvellements.ts';

export type VueClients = 'tout' | 'arrivees' | 'a_appeler' | 'argent' | 'silencieux' | 'a_risque' | 'tenus' | 'cabinet';
export const VUES_CLIENTS: readonly VueClients[] = ['tout', 'arrivees', 'a_appeler', 'argent', 'silencieux', 'a_risque', 'tenus', 'cabinet'];
// Un essai « qui finit » : dans la semaine. Un client « silencieux » : personne ne l'a ouvert depuis dix jours.
export const ESSAI_QUI_FINIT_JOURS = 7;
export const SILENCE_JOURS = 10;
// Personne n'y a travaillé depuis dix jours (0114 : dans CETTE entreprise) ; jamais ouverte, les dix jours se comptent
// depuis son inscription (une entreprise née ce matin n'est pas encore silencieuse). La vue « Silencieux » et le risque de
// départ (serveur/console/risque.ts) la lisent par cette fonction.
export const silencieuse = (e: Pick<Entreprise, 'derniereActivite' | 'creeLe'>, jour: string): boolean =>
  joursEntre(e.derniereActivite === null ? e.creeLe.slice(0, 10) : aujourdhuiATunis(new Date(e.derniereActivite)), jour) >= SILENCE_JOURS;

export function dansLaVue(e: Entreprise, v: VueClients, jour: string): boolean {
  const s = e.etat;
  switch (v) {
    case 'tout': return true;
    // 0127 (la liste des fonctions qui manquent, 6) : inscrite depuis trente jours au plus — son arrivée, marche par
    // marche, jusqu'à sa première facture émise (serveur/console/arrivee.ts). Un dossier qu'un cabinet tient n'arrive pas.
    case 'arrivees': return enArrivee(e, jour) && !(s.etat === 'hors' && s.raison === 'tenu_par_cabinet');
    // Un essai qui finit dans la semaine sans une pièce émise, ou une grâce d'après l'essai sans offre choisie : quelqu'un
    // qui n'a pas encore vu ce que l'application lui apporte. C'est un appel, pas une relance.
    // Un essai qui a déjà choisi son offre (sa facture attend) n'est pas à appeler : il est dans « l'argent attendu ».
    case 'a_appeler': return (s.etat === 'essai' && s.jours <= ESSAI_QUI_FINIT_JOURS && !aServi(e) && !e.enPlus?.attend)
      || (s.etat === 'en_retard' && s.apresEssai && e.faits.offre === null && !e.enPlus?.attend);
    // Une offre choisie, pas encore payée : sa facture attend (pendant l'essai ou après l'échéance), ou l'échéance d'une
    // offre est passée sans paiement. L'argent qu'on attend.
    case 'argent': return (s.etat === 'en_retard' && e.faits.offre !== null) || ((s.etat === 'essai' || s.etat === 'en_retard') && !!e.enPlus?.attend);
    // En essai ou abonné, et personne n'y a travaillé depuis dix jours.
    case 'silencieux': return (s.etat === 'essai' || s.etat === 'actif') && silencieuse(e, jour);
    // Un client qui paie et montre au moins un signe de départ (1.40.0 ; serveur/console/risque.ts, posé par avecRisque).
    case 'a_risque': return (e.risque?.signes.length ?? 0) > 0;
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

// Ce que la liste dit en plus de chaque ligne (plateforme.console_clients_en_plus, 0110), lu prudemment et posé sur la
// liste. La facture qui attend : la plus ancienne des factures d'abonnement préparées et pas encore réglées, son état
// déduit par la fonction de la fiche (lireFacturesAbonnement) — une facture payée, annulée par ses avoirs ou dont le
// brouillon est supprimé n'attend plus rien.
const ATTEND = new Set(['a_emettre', 'a_payer', 'en_retard', 'partielle']);
export function lireEnPlus(brut: unknown, jour: string): Map<string, EnPlus> {
  const b = brut && typeof brut === 'object' && !Array.isArray(brut) ? brut as Record<string, unknown> : {};
  const m = new Map<string, EnPlus>();
  for (const [id, v] of Object.entries(b)) {
    const r = v && typeof v === 'object' ? v as Record<string, unknown> : {};
    const n = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : 0);
    const f = lireFacturesAbonnement(r.factures, jour).filter((x) => x.payeeLe === null && ATTEND.has(x.etat))
      .sort((a, c) => (a.debut < c.debut ? -1 : a.debut > c.debut ? 1 : 0))[0];
    const attend: FactureQuiAttend | null = f ? { offre: f.offre, periodicite: f.periodicite, etat: f.etat, reste: f.reste, devise: f.devise, echeance: f.echeance } : null;
    m.set(id, { piecesMois: n(r.piecesMois), essaiJours: n(r.essaiJours) || null, prolonge: n(r.prolonge), prolongeUneFois: r.prolongeUneFois === true,
      moisOffertRecent: r.moisOffertRecent === true, attend,
      premiereFactureLe: typeof r.premiereFactureLe === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.premiereFactureLe) ? r.premiereFactureLe : null });
  }
  return m;
}
export const avecEnPlus = <E extends Entreprise>(liste: readonly E[], enPlus: Map<string, EnPlus>): E[] =>
  liste.map((e) => ({ ...e, enPlus: enPlus.get(e.id) ?? { piecesMois: 0, essaiJours: null, prolonge: 0, prolongeUneFois: false, moisOffertRecent: false, attend: null, premiereFactureLe: null } }));

export function comptesDesVues(liste: readonly Entreprise[], jour: string): Record<VueClients, number> {
  return Object.fromEntries(VUES_CLIENTS.map((v) => [v, liste.filter((e) => dansLaVue(e, v, jour)).length])) as Record<VueClients, number>;
}

// Ce qu'une ligne rapporte par an, hors taxes : un abonnement qui se renouvelle ; ou, `attendu`, ce que rapportera une
// offre choisie quand elle sera payée (la grâce, une période non renouvelée). Rien pour un essai sans offre, une
// résiliation, une suspension ou ce qui n'a pas d'échéance. Le chiffre est celui de son renouvellement (la règle de la
// facture, serveur/console/renouvellements.ts), comme dans « Ce qui revient chaque année » : les écrans disent le même.
export type ParAn = { montantHt: string; attendu: boolean; remise: { nature: 'groupe' | 'cabinet'; taux: number } | null };
function enMillimes(e: Entreprise, r: Renouvellements): { m: bigint; attendu: boolean } | null {
  const x = r.get(e.id);
  return x ? { m: x.parAnHt, attendu: x.attendu } : null;
}
export function parAn(e: Entreprise, r: Renouvellements): ParAn | null {
  const x = r.get(e.id);
  return x ? { montantHt: versTexte(x.parAnHt, 3), attendu: x.attendu, remise: x.remise ? { nature: x.remise.nature, taux: x.remise.taux } : null } : null;
}

// L'échéance d'une ligne : le prochain jour où quelque chose change pour elle — la fin de l'essai, la fin de la période
// payée, le passage en lecture seule d'une grâce (le jour qui la range dans « Abonnements », par la même fonction).
// Une entreprise déjà en lecture seule n'en a plus : ce jour est passé, et la colonne « État » dit depuis quand.
export const echeanceDe = (e: Entreprise): string | null => (e.etat.etat === 'lecture_seule' ? null : dateDe(e.etat));

// Une ligne de la liste : l'entreprise telle qu'elle est lue, son échéance et ce qu'elle rapporte par an.
export const ligneClient = (e: Entreprise, r: Renouvellements) => ({ ...e, echeance: echeanceDe(e), parAn: parAn(e, r) });

// L'ordre de la liste. Par défaut le plus urgent d'abord (rangerParUrgence, serveur/console/decider.ts) ; les autres
// ordres trient CETTE liste d'un tri stable : à égalité, l'urgence départage. Ce qui n'a pas de valeur (pas d'échéance,
// rien par an, jamais ouvert) va toujours en bas, dans les deux sens de lecture.
export type TriClients = 'urgence' | 'echeance' | 'par_an' | 'usage' | 'nom' | 'vu';
export const TRIS_CLIENTS: readonly TriClients[] = ['urgence', 'echeance', 'par_an', 'usage', 'nom', 'vu'];
const NOMS = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
export function trier(liste: readonly Entreprise[], tri: TriClients, r: Renouvellements): Entreprise[] {
  if (tri === 'urgence') return [...liste];
  const cle = (e: Entreprise): string | bigint | null => {
    switch (tri) {
      case 'echeance': return echeanceDe(e);
      case 'par_an': return enMillimes(e, r)?.m ?? null;
      // L'usage : les pièces émises du mois (le même compte que la colonne « Usage »).
      case 'usage': return BigInt(e.enPlus?.piecesMois ?? 0);
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
export function parAnDeLaSelection(liste: readonly Entreprise[], r: Renouvellements): { montantHt: string; abonnements: number } {
  let total = 0n, abonnements = 0;
  for (const e of liste) {
    const p = enMillimes(e, r);
    if (!p || p.attendu) continue;
    total += p.m;
    abonnements++;
  }
  return { montantHt: versTexte(total, 3), abonnements };
}

// Les filtres de la ligne d'outils (la maquette Clients) : le type d'organisation, l'offre choisie, le cabinet qui la suit.
// Chaque option dit son compte, compté sur la liste que filtrent les deux autres, par la fonction qui filtre (C3).
export type TypeClient = 'seules' | 'groupes' | 'tenues';
export const TYPES_CLIENTS: readonly TypeClient[] = ['seules', 'groupes', 'tenues'];
export type OffreClient = 'essentiel' | 'complet' | 'aucune';
export const OFFRES_CLIENTS: readonly OffreClient[] = ['essentiel', 'complet', 'aucune'];
export type Filtres = { type: TypeClient | null; offre: OffreClient | null; cabinet: string | null };
// Un dossier qu'un cabinet tient : son mandat, ou une organisation de cabinet.
const tenue = (e: Entreprise) => e.tenuePar !== null || e.organisation.type === 'cabinet';
export function duType(e: Entreprise, t: TypeClient): boolean {
  if (t === 'groupes') return e.organisation.type === 'groupe';
  if (t === 'tenues') return tenue(e);
  return e.organisation.type !== 'groupe' && !tenue(e);
}
export const deLOffre = (e: Entreprise, o: OffreClient) => (o === 'aucune' ? e.faits.offre === null : e.faits.offre === o);
// Le cabinet qui suit une entreprise : celui qui tient son dossier, sinon celui par qui elle est venue.
export const cabinetDe = (e: Entreprise): string | null => e.tenuePar ?? e.venuePar?.cabinet ?? null;
export const dansLesFiltres = (e: Entreprise, f: Filtres) =>
  (!f.type || duType(e, f.type)) && (!f.offre || deLOffre(e, f.offre)) && (!f.cabinet || cabinetDe(e) === f.cabinet);
export function lireFiltres(q: Record<string, unknown>): Filtres {
  const type = TYPES_CLIENTS.includes(q.type as TypeClient) ? q.type as TypeClient : null;
  const offre = OFFRES_CLIENTS.includes(q.offre as OffreClient) ? q.offre as OffreClient : null;
  const cabinet = typeof q.cabinet === 'string' && q.cabinet.trim() !== '' ? q.cabinet.trim().slice(0, 200) : null;
  return { type, offre, cabinet };
}
export function optionsDesFiltres(liste: readonly Entreprise[], f: Filtres) {
  const sans = (k: keyof Filtres) => liste.filter((e) => dansLesFiltres(e, { ...f, [k]: null }));
  const lt = sans('type'), lo = sans('offre'), lc = sans('cabinet');
  const noms = [...new Set(lc.map(cabinetDe).filter((c): c is string => c !== null))].sort(NOMS.compare);
  return {
    type: Object.fromEntries(TYPES_CLIENTS.map((t) => [t, lt.filter((e) => duType(e, t)).length])) as Record<TypeClient, number>,
    offre: Object.fromEntries(OFFRES_CLIENTS.map((o) => [o, lo.filter((e) => deLOffre(e, o)).length])) as Record<OffreClient, number>,
    cabinet: noms.map((nom) => ({ nom, n: lc.filter((e) => cabinetDe(e) === nom).length })),
  };
}

// Une ligne de l'export (Exporter la sélection) : ce que la liste montre, en colonnes, sans rien de plus — pas le contenu
// d'un dossier ; le propriétaire et son adresse, pour le joindre. Les montants hors taxes, en texte exact.
export function ligneExport(e: Entreprise, r: Renouvellements) {
  const p = parAn(e, r);
  return {
    entreprise: e.raisonSociale, matricule: e.matricule, organisation: e.organisation.type === 'groupe' || e.organisation.type === 'cabinet' ? e.organisation.nom : null,
    typeOrganisation: e.organisation.type, cabinet: cabinetDe(e), offre: e.faits.offre, periodicite: e.faits.periodicite, etat: e.etat.etat,
    echeance: echeanceDe(e), parAnHt: p && !p.attendu ? p.montantHt : null, attenduHt: p && p.attendu ? p.montantHt : null,
    pieces: e.enPlus?.piecesMois ?? 0, membres: e.membres, proprietaire: e.proprietaire?.nom ?? null, email: e.proprietaire?.email ?? null,
    inscriteLe: e.creeLe.slice(0, 10), derniereActivite: e.derniereActivite,
  };
}
