// Nos factures (14b, première partie ; docs/abonnement.md B1–B4 ; skanfact docs/cadrage/10-console.md § 2.5, 01 § 18).
// SkanFact est une entreprise de sa propre plateforme : la facture d'un abonnement naît dans SON dossier, comme la v10 y
// écrit une facture (la fiche du client, puis la pièce en brouillon), et s'émet dans son application, par le même
// moteur que toutes les autres. Ce module ne refait ni le calcul ni l'émission : il fabrique la pièce telle que l'écran
// la fabriquerait, montre ce qu'elle dira (le calcul de la v10), et l'écrit au nom de la personne, qui est
// propriétaire de l'entreprise SkanFact (la base le revérifie).

import { randomUUID } from 'node:crypto';
import { versTexte } from '../../moteur/argent.ts';
import { soldeFacture, statutFacture, type StatutFacture } from '../../moteur/reglements.ts';
import { rendre, t } from '../../textes/index.ts';
import type { Transaction } from '../base.ts';
import { Refus } from '../erreurs.ts';
import { appliquer, dossierPret } from '../v10/dossier.ts';
import { enNombreV10, type Json } from '../v10/lecture.ts';
import { codeDeLEcran, commeLaV10 } from '../v10/teif.ts';
import { jourEnFrancais, plusJours, prochainePeriode, type Faits, type Offre, type Periodicite } from './etat.ts';
import { montantRemise, type Remise } from './remise.ts';
import './textes.ts';

type Core = {
  migrateData: (brut: Json) => Json;
  defaultVat: (company: Json) => number;
  computeTotals: (doc: Json, company: Json) => { netHT: number; totalVAT: number; stamp: number; totalTTC: number; withholding: number; netToPay: number };
};
const C = () => codeDeLEcran<Core>('core.js');
// La fiche de l'entreprise telle que l'écran la tient : ses valeurs par défaut posées (le timbre, le régime), comme
// l'application les pose en ouvrant le dossier (`migrateData`) — sinon l'aperçu dirait un autre chiffre qu'elle.
const commeLEcran = (societe: Json): Json => (C().migrateData({ company: commeLaV10(societe) }).company ?? {}) as Json;

// Ce que la pièce écrit, du catalogue (14 § 5), en français : la facture est en français (`lang`).
const enFrancais = (cle: string, valeurs?: Record<string, string>) => rendre(t(cle, valeurs), 'fr');

// La période que la facture paie : la MÊME règle que « Noter un paiement » (prochainePeriode) — la suite de l'échéance,
// ou aujourd'hui si la lecture seule a commencé. Elle se règle avant son premier jour : son échéance est la veille, ou
// aujourd'hui quand elle commence aujourd'hui.
export function periodeDeLaFacture(faits: Faits, periodicite: Periodicite, jour: string): { debut: string; fin: string; echeance: string } {
  const p = prochainePeriode(faits, periodicite, jour);
  return { ...p, echeance: p.debut > jour ? plusJours(p.debut, -1) : jour };
}

// La clé de la pièce dans le dossier de l'entreprise SkanFact : l'abonné et le premier jour de la période. Deux clics,
// deux postes, deux membres de l'équipe n'en font jamais deux.
export const clePiece = (abonne: string, debut: string) => `abonnement-${abonne}-${debut}`;

// Ce qui s'ajoute à l'offre sur la facture (14c ; 0099, plateforme.lignes_en_plus) : un module acheté seul, ou ce qui
// dépasse l'offre (les utilisateurs, les salariés, les caisses, les établissements), compté par la base le jour de la
// préparation, au prix du jour de sa ligne.
export type LigneEnPlus = { option: string; quantite: number; compte: number; inclus: number; prixHt: bigint };
export function lireLignesEnPlus(brut: unknown): LigneEnPlus[] {
  const entier = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
  return (Array.isArray(brut) ? brut : []).flatMap((x) => {
    const l = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const prix = typeof l.prixHt === 'string' && /^\d+$/.test(l.prixHt) ? BigInt(l.prixHt) : null;
    const option = typeof l.option === 'string' ? l.option : '';
    return option && prix !== null && entier(l.quantite) > 0
      ? [{ option, quantite: entier(l.quantite), compte: entier(l.compte), inclus: entier(l.inclus), prixHt: prix }] : [];
  });
}
// Le total hors taxes : l'offre, et chaque ligne en plus (sa quantité à son prix), en millimes ; puis la remise de la
// période (0106), sur ce total, au millime le plus proche.
export const totalHt = (prixHt: bigint, enPlus: readonly LigneEnPlus[]) => enPlus.reduce((s, l) => s + BigInt(l.quantite) * l.prixHt, prixHt);
export const netHt = (brut: bigint, remise: Remise | null) => brut - (remise ? montantRemise(brut, remise.taux) : 0n);

// La pièce, telle que la v10 l'écrit (le formulaire d'une facture) : la ligne de l'offre au prix hors taxes du jour, puis
// une ligne par module acheté ou par ce qui dépasse l'offre ; la TVA de l'entreprise SkanFact (son régime et son taux,
// `defaultVat` : aucun taux écrit ici), le timbre selon la fiche du client, comme pour toute facture. Le dinar : la
// grille des prix est en dinars. La remise de la période (0106) : la remise globale de la pièce, sur tout le hors taxes,
// et une note qui dit laquelle et pourquoi.
export function pieceDAbonnement(o: {
  cle: string; client: Json; offre: Offre; periodicite: Periodicite; debut: string; fin: string; echeance: string; jour: string;
  prixHt: bigint; societe: Json; enPlus?: readonly LigneEnPlus[]; remise?: Remise | null;
}): Json {
  const tva = C().defaultVat(commeLEcran(o.societe));
  const periode = enFrancais('abonnement.facture.periode', { du: jourEnFrancais(o.debut), au: jourEnFrancais(o.fin) });
  const enPlus = (o.enPlus ?? []).map((l) => ({
    label: enFrancais(`abonnement.facture.option.${l.option}`),
    description: l.option.startsWith('module_') ? periode
      : enFrancais('abonnement.facture.au_dela', { compte: String(l.compte), inclus: String(l.inclus), du: jourEnFrancais(o.debut), au: jourEnFrancais(o.fin) }),
    unit: '', qty: l.quantite, unitPrice: enNombreV10(versTexte(l.prixHt, 3)), vatRate: tva,
  }));
  return {
    id: o.cle, type: 'facture', number: '', status: 'brouillon', date: o.jour, dueDate: o.echeance,
    clientId: o.client.id, subject: enFrancais('abonnement.facture.objet', { du: jourEnFrancais(o.debut), au: jourEnFrancais(o.fin) }), reference: '',
    lines: [{
      label: enFrancais('abonnement.facture.ligne', { offre: enFrancais(`abonnement.facture.offre.${o.offre}`), periodicite: enFrancais(`abonnement.facture.periodicite.${o.periodicite}`) }),
      description: periode, unit: '', qty: 1, unitPrice: enNombreV10(versTexte(o.prixHt, 3)), vatRate: tva,
    }, ...enPlus],
    discountRate: o.remise?.taux ?? 0, withholdingRate: 0, applyStamp: !(o.client.stampExempt === true), notes: o.remise ? noteDeRemise(o.remise) : '', payments: [],
    lang: 'fr', currency: 'DT', exchangeRate: '', createdAt: Date.now(),
  };
}

// La note d'une facture remisée : laquelle, de combien, pourquoi.
const noteDeRemise = (r: Remise) => (r.nature === 'groupe'
  ? enFrancais('abonnement.facture.remise.groupe', { taux: String(r.taux), groupe: r.groupe ?? '' })
  : enFrancais('abonnement.facture.remise.cabinet', { taux: String(r.taux), cabinet: r.cabinet ?? '' }));

// Ce que la facture dira, par le calcul de la v10 (celui que l'écran montrera, et que le serveur scellera à
// l'émission : « deux chemins, un chiffre »). En millimes, en texte.
export function ceQueDiraLaFacture(piece: Json, societe: Json) {
  const t = C().computeTotals(commeLaV10(piece) as Json, commeLEcran(societe));
  const m = (n: number) => versTexte(BigInt(Math.round(n * 1000)), 3);
  return { ht: m(t.netHT), tva: m(t.totalVAT), timbre: m(t.stamp), ttc: m(t.totalTTC), net: m(t.netToPay) };
}

const lire = async (tx: Transaction, entreprise: string, collection: string, cle: string) =>
  (await tx.query('select contenu, revision, rang from socle.dossier_v10 where entreprise = $1 and collection = $2 and cle = $3 for update',
    [entreprise, collection, cle])).rows[0] as { contenu: Json; revision: string; rang: number | null } | undefined;

export type Abonne = { id: string; raisonSociale: string; matricule: string | null; email: string | null };
export type FacturePreparee = { cle: string; editeur: string; offre: Offre; periodicite: Periodicite; debut: string; fin: string; echeance: string;
  montantHt: string; ceQueDira: ReturnType<typeof ceQueDiraLaFacture>; client: string;
  // L'offre au prix du jour, et ce qui s'ajoute (14c), pour que l'aperçu dise chaque ligne avant le geste ; le total avant
  // la remise, et la remise (0106).
  prixOffreHt: string; enPlus: { option: string; quantite: number; compte: number; inclus: number; prixHt: string; totalHt: string }[];
  brutHt: string; remise: (Remise & { montantHt: string }) | null };

// Préparer (ou, `apercu`, seulement montrer) la facture d'une période. Au nom de la personne, dans la transaction de la
// console : la base vérifie qu'elle est propriétaire de l'entreprise SkanFact.
export async function preparerFacture(tx: Transaction, utilisateur: string, abonne: Abonne, faits: Faits,
  voulue: { offre: Offre; periodicite: Periodicite }, prix: bigint | null, jour: string, o: { apercu: boolean; motif: string },
  enPlus: readonly LigneEnPlus[] = [], remise: Remise | null = null): Promise<FacturePreparee> {
  const editeur = String((await tx.query('select plateforme.editeur_de_mes_factures() v')).rows[0]?.v);
  if (editeur === abonne.id) throw new Refus('abonnement.facture.editeur_lui_meme');
  if (prix === null) throw new Refus('abonnement.facture.sans_prix');
  const { debut, fin, echeance } = periodeDeLaFacture(faits, voulue.periodicite, jour);
  const cle = clePiece(abonne.id, debut);
  await dossierPret(tx, editeur, utilisateur);
  const societe = (await lire(tx, editeur, '_racine', 'company'))?.contenu ?? {};
  // La pièce de cette période existe déjà : émise, elle ne se refait pas ; en brouillon, elle attend dans SkanFact.
  const deja = await lire(tx, editeur, 'documents', cle);
  if (deja) {
    const numero = typeof deja.contenu.number === 'string' ? deja.contenu.number : '';
    throw numero ? new Refus('abonnement.facture.deja_emise', { valeurs: { numero } }) : new Refus('abonnement.facture.deja_preparee');
  }
  // La fiche du client : celle des factures d'avant si elle est encore au dossier (ce que SkanFact y a complété reste),
  // sinon une fiche neuve, avec ce que la plateforme sait de l'abonné.
  const factures = (await tx.query('select plateforme.console_factures_abonnement($1) v', [abonne.id])).rows[0]?.v as { client?: string; editeur?: string }[] | null;
  const avant = (factures ?? []).find((f) => f.editeur === editeur && typeof f.client === 'string')?.client ?? null;
  const fiche = avant ? await lire(tx, editeur, 'clients', avant) : undefined;
  const client: Json = fiche?.contenu ?? {
    id: randomUUID(), name: abonne.raisonSociale, matricule: abonne.matricule ?? '', address: '', email: abonne.email ?? '', phone: '', currency: '',
  };
  const piece = pieceDAbonnement({ cle, client, offre: voulue.offre, periodicite: voulue.periodicite, debut, fin, echeance, jour, prixHt: prix, societe, enPlus, remise });
  const brut = totalHt(prix, enPlus);
  const total = netHt(brut, remise);
  const resultat: FacturePreparee = { cle, editeur, offre: voulue.offre, periodicite: voulue.periodicite, debut, fin, echeance,
    montantHt: versTexte(total, 3), ceQueDira: ceQueDiraLaFacture(piece, societe), client: String(client.id),
    prixOffreHt: versTexte(prix, 3), enPlus: enPlus.map((l) => ({ ...l, prixHt: versTexte(l.prixHt, 3), totalHt: versTexte(BigInt(l.quantite) * l.prixHt, 3) })),
    brutHt: versTexte(brut, 3), remise: remise ? { ...remise, montantHt: versTexte(brut - total, 3) } : null };
  if (o.apercu) return resultat;
  if (!fiche) {
    const { n } = (await tx.query("select count(*)::int n from socle.dossier_v10 where entreprise = $1 and collection = 'clients'", [editeur])).rows[0] as { n: number };
    await appliquer(tx, editeur, utilisateur, [{ collection: 'clients', cle: String(client.id), rang: n, revision: null, contenu: client }], { serveur: true });
  }
  await appliquer(tx, editeur, utilisateur, [{ collection: 'documents', cle, rang: null, revision: null, contenu: piece }], { serveur: true });
  await tx.query('select plateforme.console_noter_facture($1, $2, $3, $4, $5, $6::date, $7::date, $8::bigint, $9, $10::date)',
    [abonne.id, cle, String(client.id), voulue.offre, voulue.periodicite, debut, fin, total.toString(), o.motif, jour]);
  return resultat;
}


// ── Ce que la console montre d'une facture d'abonnement ─────────────────────────────────────────────────────────────
// Lue prudemment (ce que la base rend) ; l'état se DÉDUIT de la pièce, par les fonctions de toutes les factures
// (moteur/reglements.ts) : à émettre (un brouillon dans le dossier de SkanFact), brouillon supprimé, à payer, en retard,
// payée en partie, payée, annulée par ses avoirs. Le reste en entiers, en texte.
export type EtatFacture = 'a_emettre' | 'supprimee' | StatutFacture;
export type LigneFacture = {
  id: string; editeur: string; piece: string; offre: Offre; periodicite: Periodicite; debut: string; fin: string; montantHt: string;
  prepareLe: string; preparePar: string | null; payeeLe: string | null; etat: EtatFacture; numero: string | null; echeance: string | null;
  net: string | null; reste: string | null; devise: string | null; decimales: number | null; ecran: string;
};
export function lireFacturesAbonnement(brut: unknown, jour: string): LigneFacture[] {
  const lignes: LigneFacture[] = [];
  for (const x of Array.isArray(brut) ? brut as Record<string, unknown>[] : []) {
    const texte = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
    const entier = (v: unknown) => (typeof v === 'string' && /^-?\d+$/.test(v) ? BigInt(v) : null);
    const offre = x.offre === 'essentiel' || x.offre === 'complet' ? x.offre : null;
    const periodicite = x.periodicite === 'annuel' || x.periodicite === 'mensuel' ? x.periodicite : null;
    const id = texte(x.id), editeur = texte(x.editeur), piece = texte(x.piece), debut = texte(x.debut), fin = texte(x.fin), ht = entier(x.montantHt);
    if (!id || !editeur || !piece || !offre || !periodicite || !debut || !fin || ht === null) continue;
    const decimales = typeof x.decimales === 'number' && Number.isInteger(x.decimales) ? x.decimales : null;
    const net = entier(x.net);
    let etat: EtatFacture, reste: bigint | null = null;
    const echeance = texte(x.echeance)?.slice(0, 10) ?? null;
    if (x.emise === true && net !== null && decimales !== null) {
      const avoirs = (Array.isArray(x.avoirs) ? x.avoirs : []).map(entier).filter((v): v is bigint => v !== null);
      const reglements = (Array.isArray(x.reglements) ? x.reglements : []).map(entier).filter((v): v is bigint => v !== null);
      const solde = soldeFacture(net, avoirs, reglements);
      reste = solde.reste;
      etat = statutFacture(net, solde, echeance ?? undefined, jour);
    } else {
      etat = x.dansLeDossier === true ? 'a_emettre' : 'supprimee';
    }
    lignes.push({
      id, editeur, piece, offre, periodicite, debut, fin, montantHt: versTexte(ht, 3), prepareLe: String(x.prepareLe ?? ''), preparePar: texte(x.preparePar),
      payeeLe: texte(x.payeeLe), etat, numero: texte(x.numero), echeance, net: net !== null && decimales !== null ? versTexte(net, decimales) : null,
      reste: reste !== null && decimales !== null ? versTexte(reste < 0n ? 0n : reste, decimales) : null, devise: texte(x.devise), decimales,
      ecran: `/v10/?e=${editeur}#/doc/${encodeURIComponent(piece)}`,
    });
  }
  return lignes;
}
