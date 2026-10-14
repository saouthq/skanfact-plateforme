// Nos factures, pour la console (skanfact docs/cadrage/10-console.md § 2.5 ; docs/console.md C31 ; 0109), pur. Ce que
// la base rend (plateforme.console_nos_factures), lu prudemment, puis :
//   - où en est chaque pièce hors du dossier : pas de fichier de facture électronique, à signer, à envoyer, déposée,
//     acceptée, refusée (et pourquoi) — l'ordre d'une facture : le fichier, sa signature, son envoi ;
//   - son paiement, par la règle de toutes les factures (moteur/reglements.ts) ; un avoir ne se paie pas, il corrige ;
//   - le résumé du mois (combien, le montant émis, la TTN) et les filtres, chacun compté par la fonction qui filtre la
//     liste qu'il ouvre (C3).

import { soldeFacture, statutFacture, type StatutFacture } from '../../moteur/reglements.ts';
import { versTexte } from '../../moteur/argent.ts';
import { ecranDeLaPiece, type Editeur } from './paiements.ts';

type Qui = { id: string; nom: string };
export type EtatTtn = 'sans_fichier' | 'a_signer' | 'a_envoyer' | 'deposee' | 'acceptee' | 'refusee';
export const ETATS_TTN: readonly EtatTtn[] = ['sans_fichier', 'a_signer', 'a_envoyer', 'deposee', 'acceptee', 'refusee'];
export type Motif = { cle: string; valeurs: Record<string, unknown> };
export type PieceLue = {
  type: 'facture' | 'avoir'; numero: string; date: string; echeance: string | null; piece: string; ecran: string;
  devise: string; decimales: number; net: bigint; entreprise: Qui; offre: 'essentiel' | 'complet' | null; periodicite: 'annuel' | 'mensuel' | null;
  debut: string | null; fin: string | null; corrige: { numero: string | null; ecran: string } | null; avoirs: bigint[]; reglements: bigint[];
  efacture: boolean; signee: boolean;
  ttn: { statut: 'a_envoyer' | 'deposee' | 'acceptee' | 'refusee'; motif: Motif | null; deposeLe: string | null; accepteLe: string | null; reference: string | null } | null;
};
// L'entreprise SkanFact, et si sa fiche la dit soumise à la facture électronique.
export type EditeurNf = Editeur & { soumise: boolean };
export type NosFactures = { mois: string; editeur: EditeurNf | null; pieces: PieceLue[] };

const texte = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
const entier = (v: unknown) => (typeof v === 'string' && /^-?\d+$/.test(v) ? BigInt(v) : null);
const jour = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const decimalesDe = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6 ? v : null);
const entiers = (v: unknown) => (Array.isArray(v) ? v.map(entier).filter((x): x is bigint => x !== null) : []);
const objet = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

export function lireNosFactures(brut: unknown): NosFactures {
  const x = objet(brut) ?? {};
  const ed = objet(x.editeur);
  const editeur = ed && typeof ed.entreprise === 'string' && typeof ed.devise === 'string' && decimalesDe(ed.decimales) !== null
    ? { entreprise: ed.entreprise, raisonSociale: String(ed.raisonSociale ?? ''), devise: ed.devise, decimales: decimalesDe(ed.decimales) as number, soumise: ed.soumise === true } : null;
  const pieces: PieceLue[] = [];
  for (const p of Array.isArray(x.pieces) ? x.pieces as Record<string, unknown>[] : []) {
    const type = p.type === 'facture' || p.type === 'avoir' ? p.type : null;
    const numero = texte(p.numero), date = jour(p.date), piece = texte(p.piece), ed2 = texte(p.editeur), devise = texte(p.devise);
    const decimales = decimalesDe(p.decimales), net = entier(p.net), e = objet(p.entreprise);
    if (!type || !numero || !date || !piece || !ed2 || !devise || decimales === null || net === null || !e || typeof e.id !== 'string' || typeof e.nom !== 'string') continue;
    const c = objet(p.corrige), t = objet(p.ttn), m = t ? objet(t.motif) : null;
    const statut = t && (t.statut === 'a_envoyer' || t.statut === 'deposee' || t.statut === 'acceptee' || t.statut === 'refusee') ? t.statut : null;
    pieces.push({
      type, numero, date, echeance: jour(p.echeance), piece, ecran: ecranDeLaPiece(ed2, piece), devise, decimales, net, entreprise: { id: e.id, nom: e.nom },
      offre: p.offre === 'essentiel' || p.offre === 'complet' ? p.offre : null, periodicite: p.periodicite === 'annuel' || p.periodicite === 'mensuel' ? p.periodicite : null,
      debut: jour(p.debut), fin: jour(p.fin),
      corrige: type === 'avoir' && c && texte(c.piece) ? { numero: texte(c.numero), ecran: ecranDeLaPiece(ed2, texte(c.piece) ?? '') } : null,
      avoirs: entiers(p.avoirs), reglements: entiers(p.reglements), efacture: p.efacture === true, signee: p.signee === true,
      ttn: statut && t ? { statut, motif: m && typeof m.cle === 'string' ? { cle: m.cle, valeurs: objet(m.valeurs) ?? {} } : null,
        deposeLe: texte(t.deposeLe), accepteLe: texte(t.accepteLe), reference: texte(t.reference) } : null,
    });
  }
  return { mois: typeof x.mois === 'string' ? x.mois : '', editeur, pieces };
}

// Où en est une pièce hors du dossier : le dernier pas franchi. Le dépôt dit le sien ; sans dépôt, la signature, puis le
// fichier.
export function etatTtn(p: PieceLue): EtatTtn {
  if (p.ttn) return p.ttn.statut;
  if (p.signee) return 'a_envoyer';
  return p.efacture ? 'a_signer' : 'sans_fichier';
}

// Le paiement d'une facture, par la règle de toutes les factures ; un avoir n'en a pas : il corrige sa facture. « En
// partie » se dit d'un règlement reçu : une facture qu'un avoir corrige, sans rien de reçu, reste à payer (ou en retard),
// et dit l'avoir déduit — comme les paiements (C30).
export type EtatPaiement = StatutFacture | 'avoir';
export function etatPaiement(p: PieceLue, aujourdhui: string): { etat: EtatPaiement; reste: bigint; credite: bigint } {
  if (p.type === 'avoir') return { etat: 'avoir', reste: 0n, credite: 0n };
  const solde = soldeFacture(p.net, p.avoirs, p.reglements);
  const statut = statutFacture(p.net, solde, p.echeance ?? undefined, aujourdhui);
  const etat = statut === 'partielle' && solde.paye <= 0n ? (p.echeance && p.echeance < aujourdhui ? 'en_retard' : 'a_payer') : statut;
  return { etat, reste: solde.reste > 0n ? solde.reste : 0n, credite: solde.credite };
}

// Les filtres de la liste : toutes ; refusées par la TTN ; pas encore acceptées (le fichier, la signature, l'envoi, le
// dépôt en attente) ; pas encore payées. Chacun compte ce qu'il ouvre, par cette fonction.
export const FILTRES = ['toutes', 'refusees', 'en_chemin', 'non_payees'] as const;
export type Filtre = (typeof FILTRES)[number];
export function dansLeFiltre(p: PieceLue, f: Filtre, aujourdhui: string): boolean {
  switch (f) {
    case 'toutes': return true;
    case 'refusees': return etatTtn(p) === 'refusee';
    case 'en_chemin': { const e = etatTtn(p); return e !== 'acceptee' && e !== 'refusee'; }
    default: { const e = etatPaiement(p, aujourdhui).etat; return e === 'a_payer' || e === 'en_retard' || e === 'partielle'; }
  }
}

// Le résumé du mois : les factures émises et leur montant (dans la devise de l'entreprise SkanFact ; une autre devise à
// part, jamais additionnée), les avoirs et le leur, ce qui reste à encaisser de ces factures (le reste de chacune, par
// la règle de toutes les factures ; null quand rien ne reste) et la TTN, pièce par pièce (factures et avoirs : tous se déposent).
export type Resume = {
  factures: number; montant: string | null; avoirs: number; montantAvoirs: string | null; autresDevises: number;
  reste: string | null; ttn: Record<EtatTtn, number>;
};
export function resume(n: NosFactures, aujourdhui: string): Resume {
  const ttn = Object.fromEntries(ETATS_TTN.map((e) => [e, 0])) as Record<EtatTtn, number>;
  let montant = 0n, montantAvoirs = 0n, reste = 0n, factures = 0, avoirs = 0, autres = 0;
  for (const p of n.pieces) {
    ttn[etatTtn(p)] += 1;
    if (p.type === 'facture') factures += 1; else avoirs += 1;
    if (!n.editeur || p.devise !== n.editeur.devise) { autres += 1; continue; }
    if (p.type === 'facture') { montant += p.net; reste += etatPaiement(p, aujourdhui).reste; } else montantAvoirs += p.net;
  }
  const d = n.editeur?.decimales ?? 3;
  const enTexte = (v: bigint) => (n.editeur ? versTexte(v, d) : null);
  return { factures, montant: enTexte(montant), avoirs, montantAvoirs: enTexte(montantAvoirs), autresDevises: autres, reste: reste > 0n ? enTexte(reste) : null, ttn };
}

// Une ligne de la liste, telle que l'écran la dit : la pièce, le client, ce qu'elle paie, le montant, la TTN (et le
// motif d'un refus, en mots), le paiement.
export function ligne(p: PieceLue, aujourdhui: string, motifEnMots: (m: Motif) => string | null) {
  const paiement = etatPaiement(p, aujourdhui);
  // Le refus de la TTN : ses accusés tels quels (l'écran dit déjà « La TTN répond : ») ; un autre motif, en mots.
  const m = p.ttn?.motif ?? null;
  const motif = !m ? null : m.cle === 'ttn.refusee' && typeof m.valeurs.accuses === 'string' && m.valeurs.accuses !== '' ? m.valeurs.accuses : motifEnMots(m);
  return {
    type: p.type, numero: p.numero, date: p.date, echeance: p.echeance, ecran: p.ecran, entreprise: p.entreprise,
    offre: p.offre, periodicite: p.periodicite, debut: p.debut, fin: p.fin, corrige: p.corrige, devise: p.devise,
    net: versTexte(p.net, p.decimales), ttn: etatTtn(p), motif, motifCle: m?.cle ?? null,
    deposeLe: p.ttn?.deposeLe ?? null, accepteLe: p.ttn?.accepteLe ?? null, reference: p.ttn?.reference ?? null,
    paiement: paiement.etat, reste: versTexte(paiement.reste, p.decimales), avoirDeduit: paiement.credite > 0n && paiement.reste > 0n,
  };
}
