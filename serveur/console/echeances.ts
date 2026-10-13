// Les échéances des abonnements, pour la console (skanfact docs/cadrage/10-console.md § 2.4 ; docs/console.md ; 0084),
// pur. Sur la MÊME liste que les clients et l'accueil (`lireEntreprises`, `categorie`) : chaque carte compte la liste
// qu'elle ouvre, par la même fonction (C3). Ce qui vient (la fin d'un essai, le renouvellement d'une période payée), ce
// qui presse (la grâce, et le jour de sa lecture seule), ce qui est fermé (la lecture seule), et ce qui n'a pas
// d'échéance. Les relances sont celles qui sont parties pour l'échéance d'AUJOURD'HUI, jamais pour une échéance passée.
//
// Les montants sont HORS TAXES, au prix du jour (plateforme.prix_du_jour), en texte exact : la TVA et le timbre de nos
// factures se décident avec le comptable (14b), et un montant qu'on ne sait pas encore dire ne s'invente pas (C2). Aucune
// remise n'existe encore (le prix gardé des fondateurs vient avec nos factures) : le prix du jour est celui qu'on paie.

import { versTexte } from '../../moteur/argent.ts';
import { echeanceDe, joursEntre, plusJours, type Etat, type Faits, type Offre, type Periodicite, type Rang } from '../abonnement/etat.ts';
import { categorie, CATEGORIES, LECTURE_SEULE_DE_LA_SEMAINE, type Categorie, type Entreprise } from './decider.ts';

// « Les échéances des 30 prochains jours » ; une semaine, pour les sous-titres des cartes (la lecture seule « de la
// semaine » est celle d'« À décider », par la même règle).
export const AVENIR_JOURS = 30;
export const SEMAINE = 7;

// ── Ce que la base ajoute (plateforme.console_echeances, plateforme.prix_du_jour), lu prudemment ─────────────────────
export type Auteur = { nom: string; role: string } | null;
export type Evenement = { le: string; motif: string | null; jours: number | null; qui: Auteur };
// La dernière échéance relancée d'une entreprise, et l'instant de chaque relance partie pour elle.
export type Parties = { echeance: string; rangs: Partial<Record<Rang, string>> };
export type Extras = {
  relances: Map<string, Parties>;
  prolongation: Map<string, Evenement>;
  offert: Map<string, Evenement>;
  suspension: Map<string, Evenement>;
};
const RANGS: readonly Rang[] = ['j15', 'j7', 'j1', 'lecture_seule'];
const NATURES = { essai_prolonge: 'prolongation', offert: 'offert', suspendu: 'suspension' } as const;

export function lireExtras(brut: unknown): Extras {
  const x = (brut ?? {}) as { relances?: unknown; evenements?: unknown };
  const e: Extras = { relances: new Map(), prolongation: new Map(), offert: new Map(), suspension: new Map() };
  for (const r of Array.isArray(x.relances) ? x.relances as Record<string, unknown>[] : []) {
    if (typeof r.entreprise !== 'string' || typeof r.echeance !== 'string') continue;
    const rangs: Partial<Record<Rang, string>> = {};
    const lus = (r.rangs ?? {}) as Record<string, unknown>;
    for (const rang of RANGS) if (typeof lus[rang] === 'string') rangs[rang] = lus[rang];
    e.relances.set(r.entreprise, { echeance: r.echeance, rangs });
  }
  for (const v of Array.isArray(x.evenements) ? x.evenements as Record<string, unknown>[] : []) {
    const sorte = NATURES[v.nature as keyof typeof NATURES];
    if (!sorte || typeof v.entreprise !== 'string' || typeof v.le !== 'string') continue;
    const q = v.qui as Record<string, unknown> | null;
    e[sorte].set(v.entreprise, {
      le: v.le, motif: typeof v.motif === 'string' ? v.motif : null, jours: typeof v.jours === 'number' ? v.jours : null,
      qui: q && typeof q.nom === 'string' ? { nom: q.nom, role: String(q.role ?? '') } : null,
    });
  }
  return e;
}

// Les prix du jour, hors taxes, en millimes : « essentiel/annuel » → 390000n.
export type Prix = Map<string, bigint>;
export function lirePrix(brut: unknown): Prix {
  const p: Prix = new Map();
  for (const l of Array.isArray(brut) ? brut as Record<string, unknown>[] : []) {
    if (typeof l.offre === 'string' && typeof l.periodicite === 'string' && /^\d+$/.test(String(l.montantHt))) p.set(`${l.offre}/${l.periodicite}`, BigInt(String(l.montantHt)));
  }
  return p;
}
const prixDe = (p: Prix, offre: Offre, periodicite: Periodicite) => p.get(`${offre}/${periodicite}`) ?? null;

// ── Une ligne par entreprise ─────────────────────────────────────────────────────────────────────────────────────────
// Une relance : le jour où elle part (ou est partie), l'instant de son départ s'il a eu lieu, et ce qu'elle est
// aujourd'hui, par la règle des envois (serveur/abonnement/etat.ts, `relanceDue`, à chaque passage horaire) : partie ;
// prévue (son jour n'est pas venu) ; à partir (son jour est là : elle part au prochain passage) ; sautée (une relance
// plus proche de l'échéance part à sa place : un essai prolongé de sept jours n'envoie pas celle des quinze jours) ;
// manquée (l'échéance est passée sans elle : elle ne partira plus). L'écran le dit, il ne le recalcule pas.
export type EtatRelance = 'partie' | 'prevue' | 'a_partir' | 'sautee' | 'manquee';
export type Relance = { rang: Rang; prevueLe: string; partieLe: string | null; etat: EtatRelance };
export type LigneEcheance = {
  entreprise: { id: string; nom: string }; organisation: Entreprise['organisation']; tenuePar: string | null;
  etat: Etat; faits: Faits; date: string | null; creeLe: string; pieces: number; derniereActivite: string | null;
  montantHt: string | null; relances: Relance[];
  prolongation: Evenement | null; offert: Evenement | null; suspension: Evenement | null;
};

// Le jour qui range une ligne : la fin de l'essai ou de la période payée, le jour de la lecture seule, celui depuis
// lequel elle dure ; rien pour ce qui n'a pas d'échéance.
export function dateDe(e: Etat): string | null {
  switch (e.etat) {
    case 'essai': case 'actif': return e.jusquAu;
    case 'en_retard': return e.lectureSeuleLe;
    case 'lecture_seule': return e.depuis;
    default: return null;
  }
}

// Ce qu'un paiement coûterait, hors taxes : le renouvellement d'une période payée, ou ce qui rouvrirait une entreprise
// qui n'a pas renouvelé. Rien pour un essai (aucune offre n'est encore choisie), une résiliation (elle ne se renouvelle
// pas), une suspension (c'est une décision de SkanFact) ou ce qui n'a pas d'échéance.
export function montantDe(e: Etat, f: Faits, prix: Prix): bigint | null {
  if (e.etat === 'actif') return e.resilie ? null : prixDe(prix, e.offre, e.periodicite);
  const offreConnue = f.offre && f.periodicite ? prixDe(prix, f.offre, f.periodicite) : null;
  if (e.etat === 'en_retard') return e.apresEssai ? null : offreConnue;
  if (e.etat === 'lecture_seule') return e.raison === 'non_renouvele' ? offreConnue : null;
  return null;
}

// Les relances qui concernent la ligne (serveur/abonnement/etat.ts, `relanceDue`) : quinze jours, sept jours et la veille
// de l'échéance, puis le jour de la lecture seule. Ni pour une résiliation (elle l'a décidé), ni pour une suspension
// (elle se dit par la console), ni pour ce qui n'a pas d'échéance. Une relance n'est « partie » que pour l'échéance
// d'aujourd'hui : celles d'une échéance passée (avant une prolongation, un paiement) ne comptent plus.
export function relancesDe(e: Etat, f: Faits, partie: Parties | undefined, jour: string, active = true): Relance[] {
  const echeance = echeanceDe(f);
  if (echeance === null) return [];
  const rangs = partie && partie.echeance === echeance ? partie.rangs : {};
  // Une entreprise désactivée n'est plus examinée (plateforme.relances_a_examiner) : ce qui n'est pas parti ne partira plus.
  const nonPartie = (etat: EtatRelance): EtatRelance => (active ? etat : 'manquee');
  // Avant l'échéance, de la moins pressante à la plus pressante : `relanceDue` n'envoie que la plus pressante dont le
  // jour est venu, et rien de moins pressant qu'une relance déjà partie.
  const avant = ([['j15', 15], ['j7', 7], ['j1', 1]] as const).map(([rang, jours]) => ({ rang, prevueLe: plusJours(echeance, -jours), partieLe: rangs[rang] ?? null }));
  const avantEcheance = (): Relance[] => avant.map((r, i) => {
    const plusPressantes = avant.slice(i + 1);
    const etat: EtatRelance = r.partieLe ? 'partie'
      : jour > echeance ? 'manquee'
        : plusPressantes.some((p) => p.partieLe !== null || p.prevueLe <= jour) ? 'sautee'
          : nonPartie(r.prevueLe <= jour ? 'a_partir' : 'prevue');
    return { ...r, etat };
  });
  // Celle de la lecture seule part le jour où la lecture seule tombe, et ce jour-là seulement : le lendemain, l'échéance
  // sort de ce que le serveur examine (huit jours après elle, plateforme.relances_a_examiner).
  const lectureSeule = (prevueLe: string): Relance => {
    const partieLe = rangs.lecture_seule ?? null;
    return { rang: 'lecture_seule', prevueLe, partieLe, etat: partieLe ? 'partie' : jour > prevueLe ? 'manquee' : nonPartie(prevueLe === jour ? 'a_partir' : 'prevue') };
  };
  switch (e.etat) {
    case 'essai': return avantEcheance();
    case 'actif': return e.resilie ? [] : avantEcheance();
    case 'en_retard': return [...avantEcheance(), lectureSeule(e.lectureSeuleLe)];
    case 'lecture_seule': return e.raison === 'essai_termine' || e.raison === 'non_renouvele' ? [lectureSeule(e.depuis)] : [];
    default: return [];
  }
}

export function lignesEcheances(liste: Entreprise[], extras: Extras, prix: Prix, jour: string): LigneEcheance[] {
  return liste.map((e) => {
    const m = montantDe(e.etat, e.faits, prix);
    return {
      entreprise: { id: e.id, nom: e.raisonSociale }, organisation: e.organisation, tenuePar: e.tenuePar,
      etat: e.etat, faits: e.faits, date: dateDe(e.etat), creeLe: e.creeLe, pieces: e.pieces, derniereActivite: e.derniereActivite,
      montantHt: m === null ? null : versTexte(m, 3), relances: relancesDe(e.etat, e.faits, extras.relances.get(e.id), jour, e.active),
      // Une prolongation ne se raconte que pendant l'essai qu'elle prolonge ; un « offert », tant qu'il l'est ; une
      // suspension, tant qu'elle dure.
      prolongation: e.etat.etat === 'essai' ? extras.prolongation.get(e.id) ?? null : null,
      offert: e.faits.offert ? extras.offert.get(e.id) ?? null : null,
      suspension: e.etat.etat === 'lecture_seule' && e.etat.raison === 'suspendu' ? extras.suspension.get(e.id) ?? null : null,
    };
  });
}

// ── Les vues : ce qui vient, puis une par état ───────────────────────────────────────────────────────────────────────
export type Vue = 'avenir' | Categorie;
export const VUES: readonly Vue[] = ['avenir', ...CATEGORIES];

// Ce qui vient dans les trente prochains jours, aujourd'hui compris : la fin d'un essai, la fin d'une période payée.
export const dansLesTrenteJours = (l: LigneEcheance, jour: string) =>
  (l.etat.etat === 'essai' || l.etat.etat === 'actif') && joursEntre(jour, l.etat.jusquAu) <= AVENIR_JOURS;

const ORDRE_HORS = ['offert', 'tenu_par_cabinet', 'inconnu', 'bac_a_sable'];
const comparerNoms = (a: LigneEcheance, b: LigneEcheance) => a.entreprise.nom.localeCompare(b.entreprise.nom, 'fr', { sensitivity: 'base' }) || a.entreprise.id.localeCompare(b.entreprise.id);
export function vue(lignes: LigneEcheance[], v: Vue, jour: string): LigneEcheance[] {
  const gardees = v === 'avenir' ? lignes.filter((l) => dansLesTrenteJours(l, jour)) : lignes.filter((l) => categorie(l) === v);
  return gardees.sort((a, b) => {
    if (v === 'hors') {
      const ra = ORDRE_HORS.indexOf(a.etat.etat === 'hors' ? a.etat.raison : ''), rb = ORDRE_HORS.indexOf(b.etat.etat === 'hors' ? b.etat.raison : '');
      return ra - rb || comparerNoms(a, b);
    }
    // La lecture seule la plus récente d'abord : c'est elle qui demande encore un appel. Partout ailleurs, la plus proche.
    const da = a.date ?? '', db = b.date ?? '';
    return (v === 'lecture_seule' ? db.localeCompare(da) : da.localeCompare(db)) || comparerNoms(a, b);
  });
}

// ── Les cartes : chacune compte la liste qu'elle ouvre (C3), par `vue` elle-même ───────────────────────────────────────
export type Cartes = {
  avenir: { n: number; essais: number };
  essai: { n: number; semaine: number };
  actif: { n: number; essentiel: number; complet: number; resilies: number };
  en_retard: { n: number; du: string | null; au: string | null };
  lecture_seule: { n: number; semaine: number };
  hors: { n: number; offert: number; tenu_par_cabinet: number; inconnu: number };
};
export function cartes(lignes: LigneEcheance[], jour: string): Cartes {
  const de = (v: Vue) => vue(lignes, v, jour);
  const avenir = de('avenir'), essai = de('essai'), actif = de('actif'), retard = de('en_retard'), lecture = de('lecture_seule'), hors = de('hors');
  const raisons = (r: string) => hors.filter((l) => l.etat.etat === 'hors' && l.etat.raison === r).length;
  return {
    avenir: { n: avenir.length, essais: avenir.filter((l) => l.etat.etat === 'essai').length },
    essai: { n: essai.length, semaine: essai.filter((l) => l.etat.etat === 'essai' && l.etat.jours < SEMAINE).length },
    actif: {
      n: actif.length, essentiel: actif.filter((l) => l.etat.etat === 'actif' && l.etat.offre === 'essentiel').length,
      complet: actif.filter((l) => l.etat.etat === 'actif' && l.etat.offre === 'complet').length,
      resilies: actif.filter((l) => l.etat.etat === 'actif' && l.etat.resilie).length,
    },
    // La grâce de chacune finit à un jour différent : du plus proche au plus lointain.
    en_retard: { n: retard.length, du: retard[0]?.date ?? null, au: retard.at(-1)?.date ?? null },
    lecture_seule: { n: lecture.length, semaine: lecture.filter((l) => l.date !== null && joursEntre(l.date, jour) < LECTURE_SEULE_DE_LA_SEMAINE).length },
    hors: { n: hors.length, offert: raisons('offert'), tenu_par_cabinet: raisons('tenu_par_cabinet'), inconnu: raisons('inconnu') },
  };
}

// ── Ce qui revient chaque année ──────────────────────────────────────────────────────────────────────────────────────
// Les abonnements actifs qui se renouvellent (une résiliation n'y est pas), au prix du jour, hors taxes : un mensuel
// compte douze mois. Une offre sans prix du jour ne s'invente pas : elle se compte à part.
export type Annuel = { montantHt: string; abonnements: number; mensuels: number; resilies: number; sansPrix: number };
export function annuel(lignes: LigneEcheance[], prix: Prix): Annuel {
  let total = 0n, abonnements = 0, mensuels = 0, resilies = 0, sansPrix = 0;
  for (const l of lignes) {
    if (l.etat.etat !== 'actif') continue;
    if (l.etat.resilie) { resilies++; continue; }
    const p = prixDe(prix, l.etat.offre, l.etat.periodicite);
    if (p === null) { sansPrix++; continue; }
    total += l.etat.periodicite === 'mensuel' ? p * 12n : p;
    abonnements++;
    if (l.etat.periodicite === 'mensuel') mensuels++;
  }
  return { montantHt: versTexte(total, 3), abonnements, mensuels, resilies, sansPrix };
}
