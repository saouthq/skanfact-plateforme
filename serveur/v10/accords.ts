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
     where a.entreprise = $1 and a.piece_v10 = $2 and a.statut <> 'en_attente'
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
