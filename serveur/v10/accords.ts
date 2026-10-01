// L'accord d'un responsable au-delà de l'encours d'un client (brique 98 ; 03 D11 ; 14 § 3.2 ; docs/accords.md).
//
// Quand l'entreprise le demande (`encoursAccord` sur sa fiche), une facture qui ferait dépasser l'encours autorisé
// de son client (`creditLimit`) ne s'émet, par qui n'est ni propriétaire ni administrateur, qu'avec l'accord de
// l'un d'eux. Le serveur ne croit pas l'écran sur parole : il calcule le dépassement lui-même, avec LE MÊME code
// que l'écran (`depassementEncours` de core.js), sur le dossier qu'il lit en base — la fiche du client, ses
// factures, ses bons ; seule la pièce à émettre vient de la demande (et son net à payer est ensuite vérifié à
// l'émission). Deux chemins, une règle.

import { Refus } from '../erreurs.ts';
import type { Transaction } from '../base.ts';
import { commeLaV10, codeDeLEcran } from './teif.ts';
import './textes.ts';

type Json = Record<string, unknown>;
type Depassement = { plafond: number; encours: number; piece: number; apres: number; depasse: number };
type Core = {
  migrateData: (d: Json) => Json;
  depassementEncours: (data: Json, doc: Json, company: Json) => Depassement | null;
  decimalsFor: (devise: string) => number;
  computeTotals: (doc: Json, company: Json) => { discount: number; discountRate: number };
};
const C = () => codeDeLEcran<Core>('core.js');

// Ce que la personne connectée peut faire sans accord : vendre au-delà (propriétaire, administrateur).
export async function estResponsable(tx: Transaction, entreprise: string): Promise<boolean> {
  return Boolean((await tx.query(`select socle.mes_roles($1) && array['proprietaire', 'administrateur'] r`, [entreprise])).rows[0]?.r);
}

// Le dépassement que ferait cette pièce, en unités entières de la devise de l'entreprise (millimes pour le
// dinar) ; null si l'entreprise ne demande pas d'accord, si le client n'a pas de plafond, ou s'il reste dessous.
export async function depassementDuServeur(tx: Transaction, entreprise: string, doc: Json) {
  const lignes = (await tx.query(`select collection, cle, contenu from socle.dossier_v10
    where entreprise = $1 and (collection in ('clients', 'documents') or (collection = '_racine' and cle = 'company'))
    order by collection, rang, cle`, [entreprise])).rows as { collection: string; cle: string; contenu: unknown }[];
  const brut: Json = { clients: [], documents: [] };
  for (const l of lignes) {
    const c = commeLaV10(l.contenu);
    if (l.collection === '_racine') brut[l.cle] = c;
    else (brut[l.collection] as unknown[]).push(c);
  }
  const data = C().migrateData(brut);
  const societe = (data.company ?? {}) as Json;
  if (societe.encoursAccord !== true) return null;
  const d = C().depassementEncours(data, commeLaV10(doc) as Json, societe);
  if (!d) return null;
  const facteur = 10 ** C().decimalsFor(String(societe.currency ?? 'DT'));
  const entier = (x: number) => Math.round(x * facteur);
  const client = ((data.clients as Json[]) ?? []).find((c) => c.id === doc.clientId) ?? {};
  return { plafond: entier(d.plafond), encours: entier(d.encours), piece: entier(d.piece), depasse: entier(d.depasse),
    decimales: Math.round(Math.log10(facteur)), devise: String(societe.currency ?? 'DT'), client: String(client.name ?? '') };
}

// Un montant entier écrit pour une personne : « 1 157,680 DT ».
export function montantLisible(n: number, decimales: number, devise: string): string {
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(n / 10 ** decimales)} ${devise}`;
}

// L'accord qui couvre cette pièce : la dernière décision prise sur elle, si c'est un accord pour au moins ce montant.
export async function accordDeLaPiece(tx: Transaction, entreprise: string, piece: string, montant: number) {
  const r = (await tx.query(`select a.statut, a.montant, a.decide_le, d.nom demandeur, x.nom decideur
      from ventes.accord a join socle.utilisateur d on d.id = a.demande_par left join socle.utilisateur x on x.id = a.decide_par
     where a.entreprise = $1 and a.piece_v10 = $2 and a.statut <> 'en_attente' and a.geste = 'encours'
     order by a.decide_le desc limit 1`, [entreprise, piece])).rows[0] as
    { statut: string; montant: string; decide_le: Date; demandeur: string; decideur: string } | undefined;
  if (!r || r.statut !== 'accorde' || Number(r.montant) < montant) return null;
  return { demandePar: r.demandeur, accordePar: r.decideur, le: r.decide_le.toISOString() };
}

// À l'émission d'une facture : sans accord, le dépassement se refuse en disant ses chiffres et le geste qui débloque.
export async function controlerEncours(tx: Transaction, entreprise: string, cle: string, doc: Json) {
  if (await estResponsable(tx, entreprise)) return null;
  const d = await depassementDuServeur(tx, entreprise, doc);
  if (!d) return null;
  const accord = await accordDeLaPiece(tx, entreprise, cle, d.piece);
  if (accord) return accord;
  const m = (n: number) => montantLisible(n, d.decimales, d.devise);
  throw new Refus('ventes.encours_accord', {
    valeurs: { client: d.client || '—', depasse: m(d.depasse), encours: m(d.encours), piece: m(d.piece), plafond: m(d.plafond) },
    bouton: 'ventes.accord.demander',
  });
}

// ── La remise au-delà d'un seuil (brique 103 ; 03 D11 : « une remise ») ─────────────────────────────────────────
// L'entreprise règle la remise permise sans accord (`remiseAccordAuDela`, en %, sur sa fiche ; vide : pas de seuil,
// la valeur qui ne change rien). Une facture dont la remise globale la dépasse ne s'émet, par qui n'est ni
// propriétaire ni administrateur, qu'avec l'accord de l'un d'eux. Le seuil est lu en base, jamais sur l'écran.
const pourcent = (n: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n / 100)} %`;

// La remise de cette pièce au-delà du seuil : taux et seuil en centièmes de pour cent, montant de la remise en
// unités entières de sa devise ; null sans seuil, ou en dessous.
export async function remiseDuServeur(tx: Transaction, entreprise: string, doc: Json) {
  const brut = (await tx.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = '_racine' and cle = 'company'`,
    [entreprise])).rows[0]?.contenu;
  const societe = (commeLaV10(brut ?? {}) ?? {}) as Json;
  const seuil = Math.round(Number(societe.remiseAccordAuDela) * 100);
  if (!(seuil > 0)) return null;
  const piece = commeLaV10(doc) as Json;
  const taux = Math.round(Number(piece.discountRate) * 100);
  if (!(taux > seuil)) return null;
  const devise = String(piece.currency || societe.currency || 'DT');
  const facteur = 10 ** C().decimalsFor(devise);
  const clients = (await tx.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'clients' and cle = $2`,
    [entreprise, String(doc.clientId ?? '')])).rows[0]?.contenu;
  return { taux, seuil, montant: Math.round(C().computeTotals(piece, societe).discount * facteur),
    client: String(((commeLaV10(clients ?? {}) ?? {}) as Json).name ?? '') };
}

// L'accord qui couvre cette remise : la dernière décision prise sur la remise de la pièce, si c'est un accord pour
// au moins ce taux.
export async function accordRemiseDeLaPiece(tx: Transaction, entreprise: string, piece: string, taux: number) {
  const r = (await tx.query(`select a.statut, a.taux, a.decide_le, d.nom demandeur, x.nom decideur
      from ventes.accord a join socle.utilisateur d on d.id = a.demande_par left join socle.utilisateur x on x.id = a.decide_par
     where a.entreprise = $1 and a.piece_v10 = $2 and a.statut <> 'en_attente' and a.geste = 'remise'
     order by a.decide_le desc limit 1`, [entreprise, piece])).rows[0] as
    { statut: string; taux: number; decide_le: Date; demandeur: string; decideur: string } | undefined;
  if (!r || r.statut !== 'accorde' || Number(r.taux) < taux) return null;
  return { demandePar: r.demandeur, accordePar: r.decideur, le: r.decide_le.toISOString(), taux: Number(r.taux) / 100 };
}

// À l'émission d'une facture : sans accord, la remise au-delà du seuil se refuse en disant ses chiffres.
export async function controlerRemise(tx: Transaction, entreprise: string, cle: string, doc: Json) {
  // Le propriétaire et l'administrateur remisent sans accord.
  const responsable = await estResponsable(tx, entreprise);
  if (responsable) return null;
  const r = await remiseDuServeur(tx, entreprise, doc);
  if (!r) return null;
  const accord = await accordRemiseDeLaPiece(tx, entreprise, cle, r.taux);
  if (accord) return accord;
  throw new Refus('ventes.remise_accord', {
    valeurs: { client: r.client || '—', taux: pourcent(r.taux), seuil: pourcent(r.seuil) },
    bouton: 'ventes.accord.demander',
  });
}
