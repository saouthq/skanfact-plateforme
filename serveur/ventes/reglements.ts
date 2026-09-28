// Les règlements d'une facture de vente, tenus par le serveur (0012 ; docs/avoirs-reglements.md) :
//   - `tenirReglements` met la table au même état que ce que l'interface a enregistré, dans la
//     transaction de l'enregistrement : un règlement nouveau s'insère, un modifié se met à jour, un
//     retiré s'efface, et chaque geste laisse sa trace (D2) ;
//   - `etatDeFacture` lit ce que la facture doit encore, son statut et la retenue née de chaque
//     règlement, par le moteur (moteur/reglements.ts, comparé à la v10 depuis l'étape 1).
// Les montants sont des entiers dans l'unité de la devise de la FACTURE (D3).

import { versTexte } from '../../moteur/argent.ts';
import { retenueAuFil, soldeFacture, statutFacture, type PieceLiee, type Reglement } from '../../moteur/reglements.ts';
import { requetes, type Transaction } from '../base.ts';
import { Refus } from '../erreurs.ts';
import { tracer } from '../trace.ts';
import type { PieceLue } from './pieces.ts';
import './textes.ts';

// Un règlement tel que l'interface l'a saisi, déjà lu et vérifié (serveur/v10/dossier.ts).
export type ReglementSaisi = {
  ref: string; rang: number; date: string; montant: bigint; cours: bigint | null;
  mode: string; compte: string | null; reference: string | null; note: string | null;
};

const champs = (r: ReglementSaisi) => ({
  rang: r.rang, date_reglement: r.date, montant: r.montant, cours: r.cours, mode: r.mode, compte: r.compte, reference: r.reference, note: r.note,
});
const pourTrace = (r: { date: string; montant: bigint; mode: string }) => ({ date: r.date, montant: r.montant.toString(), mode: r.mode });

export async function tenirReglements(tx: Transaction, entreprise: string, utilisateur: string, piece: string, voulus: ReglementSaisi[]): Promise<void> {
  const db = requetes(tx);
  const actuels = await db.selectFrom('ventes.reglement').selectAll().where('entreprise', '=', entreprise).where('piece', '=', piece).execute();
  const parRef = new Map(actuels.map((r) => [r.ref_v10 ?? r.id, r]));
  const voulusRefs = new Set(voulus.map((r) => r.ref));
  // Un règlement déjà tenu pour une AUTRE facture ne se déplace pas.
  const ailleurs = voulus.length ? await db.selectFrom('ventes.reglement').select('ref_v10')
    .where('entreprise', '=', entreprise).where('piece', '<>', piece).where('ref_v10', 'in', [...voulusRefs]).executeTakeFirst() : undefined;
  if (ailleurs) throw new Refus('v10.reglement_ailleurs');

  for (const r of voulus) {
    const a = parRef.get(r.ref);
    if (!a) {
      const { id } = await db.insertInto('ventes.reglement').values({ entreprise, piece, ref_v10: r.ref, ...champs(r), cree_par: utilisateur })
        .returning('id').executeTakeFirstOrThrow();
      await tracer(tx, entreprise, 'ventes.reglement.enregistrer', { type: 'reglement', id }, null, pourTrace(r));
      continue;
    }
    const avant = { date: a.date_reglement, montant: a.montant, cours: a.cours, mode: a.mode, compte: a.compte, reference: a.reference, note: a.note, rang: a.rang };
    const change = avant.date !== r.date || avant.montant !== r.montant || avant.cours !== r.cours || avant.mode !== r.mode
      || avant.compte !== r.compte || avant.reference !== r.reference || avant.note !== r.note;
    if (change) {
      await db.updateTable('ventes.reglement').set((eb) => ({ ...champs(r), modifie_par: utilisateur, modifie_le: new Date(), revision: eb('revision', '+', 1n) }))
        .where('id', '=', a.id).execute();
      await tracer(tx, entreprise, 'ventes.reglement.modifier', { type: 'reglement', id: a.id }, pourTrace({ date: a.date_reglement, montant: a.montant, mode: a.mode }), pourTrace(r));
    } else if (avant.rang !== r.rang) {
      // Seule sa place a changé (un autre règlement retiré avant lui) : pas un geste, pas de trace.
      await db.updateTable('ventes.reglement').set({ rang: r.rang }).where('id', '=', a.id).execute();
    }
  }
  for (const [ref, a] of parRef) {
    if (voulusRefs.has(ref)) continue;
    await db.deleteFrom('ventes.reglement').where('id', '=', a.id).execute();
    await tracer(tx, entreprise, 'ventes.reglement.supprimer', { type: 'reglement', id: a.id }, pourTrace({ date: a.date_reglement, montant: a.montant, mode: a.mode }), null);
  }
}

// Le jour du calendrier à Tunis (une échéance se compare à un jour, jamais à un instant).
export function aujourdhuiATunis(maintenant = new Date()): string {
  return maintenant.toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
}

// Ce que la facture doit encore, son statut, et la retenue née de chaque règlement (R8 : cela se
// DÉDUIT, rien ne s'enregistre). Les avoirs sont dans la devise de la facture (0012 le garantit).
export async function etatDeFacture(tx: Transaction, entreprise: string, f: PieceLue, decimales: number, aujourdhui = aujourdhuiATunis()) {
  if (f.type !== 'facture' || f.statut !== 'emise' || !f.totaux) return null;
  const db = requetes(tx);
  const reglements = await db.selectFrom('ventes.reglement').selectAll()
    .where('entreprise', '=', entreprise).where('piece', '=', f.id).orderBy('rang').execute();
  const avoirs = await db.selectFrom('ventes.piece').select(['id', 'numero_texte', 'date_piece', 'net_a_payer', 'retenue'])
    .where('entreprise', '=', entreprise).where('corrige', '=', f.id).where('statut', '=', 'emise').orderBy('date_piece').orderBy('id').execute();
  const net = f.totaux.net_a_payer ?? 0n, retenue = f.totaux.retenue ?? 0n;
  const liees: PieceLiee[] = avoirs.map((a) => ({ cle: a.id, date: a.date_piece, net: a.net_a_payer ?? 0n, brut: (a.net_a_payer ?? 0n) + (a.retenue ?? 0n) }));
  const regles: Reglement[] = reglements.map((r) => ({ cle: r.id, date: r.date_reglement, montant: r.montant, cours: r.cours ?? undefined }));
  const fil = retenueAuFil(net, net + retenue, liees, regles);
  const solde = soldeFacture(net, liees.map((l) => l.net), regles.map((r) => r.montant));
  const m = (v: bigint) => versTexte(v, decimales);
  return {
    reste: m(solde.reste), paye: m(solde.paye), credite: m(solde.credite),
    statut: statutFacture(net, solde, f.echeance ?? undefined, aujourdhui),
    retenueDue: m(fil.due), retenueOperee: m(fil.operee),
    reglements: reglements.map((r) => ({
      id: r.id, date: r.date_reglement, montant: m(r.montant), cours: r.cours === null ? null : versTexte(r.cours, 6),
      mode: r.mode, reference: r.reference, retenue: m(fil.parts.get(r.id) ?? 0n),
    })),
    avoirs: avoirs.map((a) => ({ id: a.id, numero: a.numero_texte, date: a.date_piece, netAPayer: m(a.net_a_payer ?? 0n), regularisation: m(fil.ajustements.get(a.id) ?? 0n) })),
  };
}
