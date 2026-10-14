// Les paiements de nos factures, pour la console (skanfact docs/cadrage/10-console.md § 2.2 et § 2.6 ; docs/console.md
// C30 ; 0108), pur. Ce que la base rend (plateforme.console_paiements), lu prudemment, puis :
//   - l'encaissé d'un mois, par moyen (Konnect, virement, chèque, le reste) : la tuile « encaissé ce mois » de l'accueil
//     et l'écran Paiements le comptent par CETTE fonction (C3) ; dans la devise de l'entreprise SkanFact seulement — un
//     règlement dans une autre devise se dit à part, jamais additionné (une somme de devises n'est pas un montant) ;
//   - qui doit encore, et qui a trop payé : le solde de chaque facture par la règle de toutes les factures
//     (moteur/reglements.ts), jamais une seconde fois ;
//   - les coûts du mois, et ce qui reste quand on les retire de l'encaissé (le point mort, 13 § 7).
// La console ne note aucun règlement : il se note dans l'application de SkanFact, sur sa facture (10 § 2.5) ; d'ici, le
// lien qui l'ouvre.

import { soldeFacture, statutFacture } from '../../moteur/reglements.ts';
import { versTexte } from '../../moteur/argent.ts';
import { joursEntre, type Etat } from '../abonnement/etat.ts';
import type { Entreprise } from './decider.ts';

export const MOYENS = ['konnect', 'virement', 'cheque', 'autre'] as const;
export type Moyen = (typeof MOYENS)[number];

type Qui = { id: string; nom: string };
export type Recu = {
  id: string; date: string; montant: bigint; devise: string; decimales: number; mode: string; moyen: Moyen; reference: string | null;
  numero: string | null; entreprise: Qui; noteLe: string; konnect: { prouveLe: string } | null; ecran: string;
};
export type Ouverte = {
  piece: string; numero: string | null; echeance: string | null; debut: string; fin: string; devise: string; decimales: number;
  net: bigint; avoirs: bigint[]; reglements: bigint[]; entreprise: Qui; ecran: string;
};
export type AEmettre = { piece: string; debut: string; fin: string; prepareLe: string; entreprise: Qui; ecran: string };
export type Cout = {
  id: string; libelle: string; montant: bigint; dApres: string; saisiLe: string; saisiPar: string | null;
  retireLe: string | null; retirePar: string | null;
};
export type Editeur = { entreprise: string; raisonSociale: string; devise: string; decimales: number };
export type Paiements = { mois: string; editeur: Editeur | null; recus: Recu[]; ouvertes: Ouverte[]; aEmettre: AEmettre[]; couts: Cout[] };

// L'écran d'une pièce dans l'application de SkanFact (son dossier, la pièce ouverte) : la même adresse que la fiche.
export const ecranDeLaPiece = (editeur: string, piece: string) => `/v10/?e=${editeur}#/doc/${encodeURIComponent(piece)}`;

// Le moyen d'un règlement, lu de son mode (les modes de la v10 : virement, chèque, espèces, traite, carte, autre ; et
// « en ligne », celui que pose le paiement en ligne). Konnect seulement quand la preuve du prestataire est là.
export function moyenDe(mode: string, prouve: boolean): Moyen {
  if (mode === 'en_ligne') return prouve ? 'konnect' : 'autre';
  return mode === 'virement' || mode === 'cheque' ? mode : 'autre';
}

const texte = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
const entier = (v: unknown) => (typeof v === 'string' && /^-?\d+$/.test(v) ? BigInt(v) : null);
const jour = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const decimalesDe = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6 ? v : null);
function quiDe(v: unknown): Qui | null {
  const q = (v ?? {}) as Record<string, unknown>;
  return typeof q.id === 'string' && typeof q.nom === 'string' ? { id: q.id, nom: q.nom } : null;
}
const entiers = (v: unknown) => (Array.isArray(v) ? v.map(entier).filter((x): x is bigint => x !== null) : []);

export function lirePaiements(brut: unknown): Paiements {
  const x = (brut ?? {}) as Record<string, unknown>;
  const ed = (x.editeur ?? null) as Record<string, unknown> | null;
  const editeur = ed && typeof ed.entreprise === 'string' && typeof ed.devise === 'string' && decimalesDe(ed.decimales) !== null
    ? { entreprise: ed.entreprise, raisonSociale: String(ed.raisonSociale ?? ''), devise: ed.devise, decimales: decimalesDe(ed.decimales) as number } : null;
  const recus: Recu[] = [];
  for (const r of Array.isArray(x.recus) ? x.recus as Record<string, unknown>[] : []) {
    const id = texte(r.id), date = jour(r.date), montant = entier(r.montant), devise = texte(r.devise), decimales = decimalesDe(r.decimales);
    const mode = texte(r.mode), entreprise = quiDe(r.entreprise), piece = texte(r.piece), ed2 = texte(r.editeur);
    if (!id || !date || montant === null || !devise || decimales === null || !mode || !entreprise || !piece || !ed2) continue;
    const enLigne = (r.enLigne ?? null) as Record<string, unknown> | null;
    const prouveLe = enLigne && enLigne.prestataire === 'konnect' ? texte(enLigne.prouveLe) : null;
    recus.push({ id, date, montant, devise, decimales, mode, moyen: moyenDe(mode, prouveLe !== null), reference: texte(r.reference),
      numero: texte(r.numero), entreprise, noteLe: String(r.noteLe ?? ''), konnect: prouveLe ? { prouveLe } : null, ecran: ecranDeLaPiece(ed2, piece) });
  }
  const ouvertes: Ouverte[] = [];
  for (const o of Array.isArray(x.ouvertes) ? x.ouvertes as Record<string, unknown>[] : []) {
    const piece = texte(o.piece), ed2 = texte(o.editeur), debut = jour(o.debut), fin = jour(o.fin), devise = texte(o.devise);
    const decimales = decimalesDe(o.decimales), net = entier(o.net), entreprise = quiDe(o.entreprise);
    if (!piece || !ed2 || !debut || !fin || !devise || decimales === null || net === null || !entreprise) continue;
    ouvertes.push({ piece, numero: texte(o.numero), echeance: jour(o.echeance), debut, fin, devise, decimales, net,
      avoirs: entiers(o.avoirs), reglements: entiers(o.reglements), entreprise, ecran: ecranDeLaPiece(ed2, piece) });
  }
  const aEmettre: AEmettre[] = [];
  for (const a of Array.isArray(x.aEmettre) ? x.aEmettre as Record<string, unknown>[] : []) {
    const piece = texte(a.piece), ed2 = texte(a.editeur), debut = jour(a.debut), fin = jour(a.fin), entreprise = quiDe(a.entreprise);
    if (!piece || !ed2 || !debut || !fin || !entreprise) continue;
    aEmettre.push({ piece, debut, fin, prepareLe: String(a.prepareLe ?? ''), entreprise, ecran: ecranDeLaPiece(ed2, piece) });
  }
  const couts: Cout[] = [];
  for (const c of Array.isArray(x.couts) ? x.couts as Record<string, unknown>[] : []) {
    const id = texte(c.id), libelle = texte(c.libelle), montant = entier(c.montant), dApres = texte(c.dApres);
    if (!id || !libelle || montant === null || montant <= 0n || !dApres) continue;
    couts.push({ id, libelle, montant, dApres, saisiLe: String(c.saisiLe ?? ''), saisiPar: texte(c.saisiPar), retireLe: texte(c.retireLe), retirePar: texte(c.retirePar) });
  }
  return { mois: typeof x.mois === 'string' ? x.mois : '', editeur, recus, ouvertes, aEmettre, couts };
}

// ── L'encaissé d'un mois ─────────────────────────────────────────────────────────────────────────────────────────────
// Dans la devise de l'entreprise SkanFact : le total (les remboursements déduits), par moyen, et ce qui a été remboursé.
// Les règlements d'une autre devise, chacun dans la sienne, à part.
export type Encaisse = {
  devise: string; decimales: number; total: bigint; parMoyen: Record<Moyen, bigint>; rembourse: bigint; reglements: number;
  autresDevises: { devise: string; decimales: number; total: bigint }[];
};
export function encaisse(recus: Recu[], editeur: Editeur): Encaisse {
  const parMoyen = Object.fromEntries(MOYENS.map((m) => [m, 0n])) as Record<Moyen, bigint>;
  let total = 0n, rembourse = 0n, reglements = 0;
  const autres = new Map<string, { devise: string; decimales: number; total: bigint }>();
  for (const r of recus) {
    if (r.devise !== editeur.devise) {
      const a = autres.get(r.devise) ?? { devise: r.devise, decimales: r.decimales, total: 0n };
      a.total += r.montant;
      autres.set(r.devise, a);
      continue;
    }
    total += r.montant;
    parMoyen[r.moyen] += r.montant;
    if (r.montant < 0n) rembourse -= r.montant; else reglements += 1;
  }
  return { devise: editeur.devise, decimales: editeur.decimales, total, parMoyen, rembourse, reglements,
    autresDevises: [...autres.values()].sort((a, b) => a.devise.localeCompare(b.devise)) };
}

// La tuile « encaissé ce mois » du tableau du matin (§ 2.2) : la même fonction que l'écran ; sans entreprise SkanFact
// désignée, rien ne s'encaisse par la plateforme, et la tuile le dit (C2), jamais un zéro.
export type MesureEncaisse = { mesure: true; montant: string; devise: string; reglements: number } | { mesure: false; raison: 'editeur_absent' };
export function encaisseDuMois(p: Paiements): MesureEncaisse {
  if (!p.editeur) return { mesure: false, raison: 'editeur_absent' };
  const e = encaisse(p.recus, p.editeur);
  return { mesure: true, montant: versTexte(e.total, e.decimales), devise: e.devise, reglements: e.reglements };
}

// ── Qui doit, qui a trop payé ────────────────────────────────────────────────────────────────────────────────────────
// Le solde par la règle de toutes les factures. Doit : ce qui reste, en retard ou pas, et l'état de son abonnement (la
// grâce et le jour de sa lecture seule : qui appeler d'abord). Trop payé : ce qui dépasse le net moins les avoirs — une
// facture que ses avoirs annulent et qui a été réglée quand même en est (un remboursement à décider, 14b B4).
export type Doit = {
  entreprise: Qui; numero: string | null; piece: string; ecran: string; debut: string; fin: string; echeance: string | null;
  devise: string; reste: string; net: string; statut: 'a_payer' | 'en_retard' | 'partielle'; retard: number | null; abonnement: Etat | null;
  // Ce qui est déjà venu en déduction : les règlements reçus, les avoirs émis (une facture « en partie » dit lequel).
  paye: string; credite: string;
};
export type Trop = { entreprise: Qui; numero: string | null; piece: string; ecran: string; devise: string; trop: string; annulee: boolean };

export function ouvertes(liste: Ouverte[], entreprises: Entreprise[], aujourdhui: string): { doivent: Doit[]; trop: Trop[] } {
  const etats = new Map(entreprises.map((e) => [e.id, e.etat]));
  const doivent: Doit[] = [], trop: Trop[] = [];
  for (const o of liste) {
    const solde = soldeFacture(o.net, o.avoirs, o.reglements);
    const statut = statutFacture(o.net, solde, o.echeance ?? undefined, aujourdhui);
    const base = { entreprise: o.entreprise, numero: o.numero, piece: o.piece, ecran: o.ecran, devise: o.devise };
    if (solde.reste > 0n && (statut === 'a_payer' || statut === 'en_retard' || statut === 'partielle')) {
      doivent.push({ ...base, debut: o.debut, fin: o.fin, echeance: o.echeance, reste: versTexte(solde.reste, o.decimales), net: versTexte(o.net, o.decimales), statut,
        retard: o.echeance && o.echeance < aujourdhui ? joursEntre(o.echeance, aujourdhui) : null, abonnement: etats.get(o.entreprise.id) ?? null,
        paye: versTexte(solde.paye, o.decimales), credite: versTexte(solde.credite, o.decimales) });
    }
    const du = o.net - solde.credite;
    const enTrop = solde.paye - (du > 0n ? du : 0n);
    if (enTrop > 0n) trop.push({ ...base, trop: versTexte(enTrop, o.decimales), annulee: o.net > 0n && solde.credite >= o.net });
  }
  // En retard d'abord, le plus ancien en tête ; puis par échéance.
  doivent.sort((a, b) => (b.retard ?? -1) - (a.retard ?? -1) || (a.echeance ?? '9').localeCompare(b.echeance ?? '9') || a.entreprise.nom.localeCompare(b.entreprise.nom));
  return { doivent, trop };
}

// ── Les coûts du mois, et ce qui reste ───────────────────────────────────────────────────────────────────────────────
// Les coûts sont en millimes de dinar : ce qui reste ne se calcule que si l'encaissé est en dinars aussi, et seulement
// quand le mois a des coûts saisis — sans eux, « ce qui reste » serait l'encaissé, un zéro qui passerait pour une mesure.
export function couts(liste: Cout[], e: Encaisse | null) {
  const gardes = liste.filter((c) => c.retireLe === null);
  const total = gardes.reduce((s, c) => s + c.montant, 0n);
  return {
    lignes: liste.map((c) => ({ ...c, montant: versTexte(c.montant, 3) })),
    total: versTexte(total, 3),
    reste: e && e.devise === 'TND' && e.decimales === 3 && gardes.length ? versTexte(e.total - total, 3) : null,
  };
}

// Un mois demandé (« 2026-10 ») : un vrai mois, jamais après celui d'aujourd'hui ; sinon, le mois d'aujourd'hui.
export function moisDemande(v: unknown, aujourdhui: string): string {
  const courant = aujourdhui.slice(0, 7);
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v) || v < '2020-01') return courant;
  return v > courant ? courant : v;
}
