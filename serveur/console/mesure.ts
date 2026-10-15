// La mesure (1.23.0 ; docs/console.md C39 ; skanfact docs/cadrage/10-console.md § 2.9 ; la maquette « Mesure »). Pur
// (testé : tests/console/mesure.test.ts) : la liste des entreprises de la console (l'état de chaque abonnement, déduit
// par la fonction de partout), et ce que rend plateforme.console_mesure (0116) : les pièces émises des trente derniers
// jours, la première réponse du support à chaque demande. Tout se dit par offre, jamais par client nommé : rien de ce que
// cette fonction rend ne porte un nom ni un identifiant d'entreprise.
//
// Ce qui ne se mesure pas encore (les écrans ouverts, les parcours, les refus, le motif d'un départ, la satisfaction) n'a
// pas de chiffre ici : l'écran le dit « pas encore mesuré ».

import { plusJours, plusMois } from '../abonnement/etat.ts';
import type { Entreprise } from './decider.ts';
import { compter, lireLigne, SANS_REPONSE_HEURES, SANS_REPONSE_HEURES_URGENTE, type LigneDemande } from './support.ts';

export const PERIODES_MESURE = ['semaine', 'mois', 'trente'] as const;
export type PeriodeMesure = (typeof PERIODES_MESURE)[number];
export const periodeMesure = (v: unknown): PeriodeMesure => (PERIODES_MESURE.includes(v as PeriodeMesure) ? v as PeriodeMesure : 'semaine');
// Un essai « a pris » à dix pièces (le signe qu'une habitude commence ; la maquette). À VÉRIFIER avec les pilotes.
export const PIECES_HABITUDE = 10;

// `ouvertes` (0124, l'audit C12) : les demandes ouvertes aujourd'hui, quel que soit leur âge, lues comme la file du
// Support : l'attente actuelle se compte par la même fonction que la sienne (support.ts, `compter`), au même chiffre.
type Lu = { piecesTrente: Map<string, number>; demandes: Demande[]; urgentes: Demande[]; ouvertes: LigneDemande[] };
type Demande = { ouverteLe: string; priorite: 'normale' | 'urgente'; reponduLe: string | null; closeLe: string | null };

const objet = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const instant = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
export function lireMesure(x: unknown): Lu {
  const o = objet(x);
  const pieces = new Map<string, number>();
  for (const [id, n] of Object.entries(objet(o.piecesTrente))) if (typeof n === 'number' && Number.isInteger(n) && n > 0) pieces.set(id, n);
  const demandes = (v: unknown, priorite?: 'urgente'): Demande[] => (Array.isArray(v) ? v : []).flatMap((d) => {
    const y = objet(d);
    const ouverteLe = instant(y.ouverteLe);
    return ouverteLe ? [{ ouverteLe, priorite: priorite ?? (y.priorite === 'urgente' ? 'urgente' : 'normale'), reponduLe: instant(y.reponduLe), closeLe: instant(y.closeLe) }] : [];
  });
  const ouvertes = (Array.isArray(o.ouvertes) ? o.ouvertes : []).flatMap((l) => { const x = lireLigne(l); return x ? [x] : []; });
  return { piecesTrente: pieces, demandes: demandes(o.demandes), urgentes: demandes(o.urgentes, 'urgente'), ouvertes };
}

// La période des inscriptions et celle d'avant, de même longueur : « cette semaine » (du lundi à aujourd'hui) contre la
// semaine d'avant, entière ; « ce mois-ci » contre le mois d'avant ; les trente derniers jours contre les trente d'avant.
export function bornes(p: PeriodeMesure, jour: string): { du: string; au: string; avantDu: string; avantAu: string } {
  if (p === 'semaine') {
    const lundi = plusJours(jour, -((new Date(`${jour}T00:00:00Z`).getUTCDay() + 6) % 7));
    return { du: lundi, au: jour, avantDu: plusJours(lundi, -7), avantAu: plusJours(lundi, -1) };
  }
  if (p === 'mois') {
    const premier = `${jour.slice(0, 8)}01`;
    return { du: premier, au: jour, avantDu: plusMois(premier, -1), avantAu: plusJours(premier, -1) };
  }
  return { du: plusJours(jour, -29), au: jour, avantDu: plusJours(jour, -59), avantAu: plusJours(jour, -30) };
}

const mediane = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const t = [...xs].sort((a, b) => a - b);
  const m = Math.floor(t.length / 2);
  return t.length % 2 ? t[m] ?? null : Math.round((((t[m - 1] ?? 0) + (t[m] ?? 0)) / 2) * 10) / 10;
};
const part = (n: number, sur: number) => (sur > 0 ? Math.round((100 * n) / sur) : null);

export type Offre = 'essai' | 'essentiel' | 'complet';
export type Mesure = {
  periode: PeriodeMesure;
  // L'entonnoir des trente derniers jours : les essais dont le dernier jour est passé ces trente jours.
  entonnoir: { essais: number; servi: number; pris: number; abonnees: number; parOffre: { essentiel: number; complet: number }; annuel: number; mensuel: number };
  inscriptions: { periode: number; avant: number; du: string; au: string };
  // Les départs depuis l'ouverture (la première inscription) : les résiliations, les abonnements non renouvelés.
  departs: { depuis: string | null; resiliations: number; nonRenouveles: number };
  // `modules` : la part qui a acheté la paie ou la comptabilité complète en plus (Essentiel seulement), en pour cent.
  parOffre: { offre: Offre; n: number; pieces: number | null; membres: number | null; modules: { paie: number | null; compta: number | null } }[];
  // Ce qu'on promet : la réponse du support dans son délai, mois par mois (le mois d'avant et celui-ci) ; les urgentes
  // depuis toujours ; la demande qui attend le plus en ce moment.
  promesses: {
    support: { mois: string; tenues: number; dues: number }[]; heures: number;
    urgentes: { tenues: number; dues: number }; heuresUrgente: number;
    attendLePlus: number | null;
  };
};

// Une demande « due » : sa réponse est venue, ou son délai est passé sans elle. Tenue : la réponse est venue dans le délai.
// Une demande encore dans son délai, sans réponse, ne compte pas encore (elle comptera quand l'un ou l'autre arrive).
// Close sans réponse (0124, l'audit C12 ; par délégation) : avant son délai (un doublon, une question que le client a
// réglée seul), elle ne compte ni tenue ni manquée ; après, elle est manquée — personne ne lui a répondu à temps.
function tenue(d: Demande, heures: number, maintenant: number): 'tenue' | 'manquee' | 'pas_encore' {
  const ouverte = Date.parse(d.ouverteLe), delai = heures * 3_600_000;
  if (d.reponduLe) return Date.parse(d.reponduLe) - ouverte <= delai ? 'tenue' : 'manquee';
  if (d.closeLe) return Date.parse(d.closeLe) - ouverte <= delai ? 'pas_encore' : 'manquee';
  return maintenant - ouverte > delai ? 'manquee' : 'pas_encore';
}

export function mesurer(liste: readonly Entreprise[], lu: Lu, jour: string, periode: PeriodeMesure, maintenant: Date, moisDe: (instant: string) => string): Mesure {
  // Ni un bac à sable, ni un dossier qu'un cabinet tient, ni une entreprise offerte : elles ne sont pas sur le chemin
  // d'un abonnement (l'état « hors », le même que partout).
  const reelles = liste.filter((e) => e.etat.etat !== 'hors');
  // L'entonnoir : les essais dont le dernier jour est tombé ces trente derniers jours (hier compris, aujourd'hui non :
  // un essai qui finit ce soir n'est pas encore fini).
  const finis = reelles.filter((e) => e.faits.essaiJusquAu !== null && e.faits.essaiJusquAu >= plusJours(jour, -30) && e.faits.essaiJusquAu < jour);
  const abonnees = finis.filter((e) => e.faits.payeJusquAu !== null);
  const b = bornes(periode, jour);
  const dans = (e: Entreprise, du: string, au: string) => e.creeLe >= du && e.creeLe <= au;
  const offreDe = (e: Entreprise): Offre | null => (e.etat.etat === 'essai' ? 'essai'
    : (e.etat.etat === 'actif' || e.etat.etat === 'en_retard') && e.faits.offre ? e.faits.offre : null);
  const debut = reelles.map((e) => e.creeLe).filter(Boolean).sort()[0] ?? null;
  const t = maintenant.getTime();
  const parMois = new Map<string, { tenues: number; dues: number }>();
  for (const m of [plusMois(`${jour.slice(0, 8)}01`, -1).slice(0, 7), jour.slice(0, 7)]) parMois.set(m, { tenues: 0, dues: 0 });
  for (const d of lu.demandes) {
    const r = tenue(d, d.priorite === 'urgente' ? SANS_REPONSE_HEURES_URGENTE : SANS_REPONSE_HEURES, t);
    const c = parMois.get(moisDe(d.ouverteLe));
    if (!c || r === 'pas_encore') continue;
    c.dues += 1;
    if (r === 'tenue') c.tenues += 1;
  }
  const urgentes = { tenues: 0, dues: 0 };
  for (const d of lu.urgentes) {
    const r = tenue(d, SANS_REPONSE_HEURES_URGENTE, t);
    if (r === 'pas_encore') continue;
    urgentes.dues += 1;
    if (r === 'tenue') urgentes.tenues += 1;
  }
  // L'attente actuelle : celle de la file du Support, par sa fonction (une demande close n'attend plus ; une ancienne, si).
  const attenteMax = compter(lu.ouvertes, maintenant).attenteMax;
  return {
    periode,
    entonnoir: {
      essais: finis.length, servi: finis.filter((e) => e.pieces > 0).length, pris: finis.filter((e) => e.pieces >= PIECES_HABITUDE).length,
      abonnees: abonnees.length,
      parOffre: { essentiel: abonnees.filter((e) => e.faits.offre === 'essentiel').length, complet: abonnees.filter((e) => e.faits.offre === 'complet').length },
      annuel: abonnees.filter((e) => e.faits.periodicite === 'annuel').length, mensuel: abonnees.filter((e) => e.faits.periodicite === 'mensuel').length,
    },
    inscriptions: { periode: reelles.filter((e) => dans(e, b.du, b.au)).length, avant: reelles.filter((e) => dans(e, b.avantDu, b.avantAu)).length, du: b.du, au: b.au },
    departs: {
      depuis: debut,
      resiliations: reelles.filter((e) => e.faits.resilieLe !== null).length,
      nonRenouveles: reelles.filter((e) => e.etat.etat === 'lecture_seule' && e.etat.raison === 'non_renouvele').length,
    },
    parOffre: (['essai', 'essentiel', 'complet'] as const).map((o) => {
      const g = reelles.filter((e) => offreDe(e) === o);
      // Un module acheté en plus d'Essentiel (la paie, la comptabilité complète) ; Complet les contient, l'essai ouvre tout.
      const pris = (m: 'paie' | 'compta') => (o === 'essentiel' ? part(g.filter((e) => (e.faits.modules ?? []).includes(m)).length, g.length) : null);
      return { offre: o, n: g.length, pieces: mediane(g.map((e) => lu.piecesTrente.get(e.id) ?? 0)), membres: mediane(g.map((e) => e.membres)),
        modules: { paie: pris('paie'), compta: pris('compta') } };
    }),
    promesses: {
      support: [...parMois].map(([mois, c]) => ({ mois, ...c })), heures: SANS_REPONSE_HEURES,
      urgentes, heuresUrgente: SANS_REPONSE_HEURES_URGENTE,
      attendLePlus: attenteMax,
    },
  };
}
