// Tenir les règlements d'une pièce au même état que ce que l'interface a enregistré (0012 pour les
// ventes, 0013 pour les achats), dans la transaction de l'enregistrement : un règlement nouveau
// s'insère, un modifié se met à jour, un retiré s'efface, et chaque geste laisse sa trace.
// Les montants sont des entiers dans l'unité de la devise de la PIÈCE.

import { requetes, type Transaction } from './base.ts';
import { Refus } from './erreurs.ts';
import { tracer } from './trace.ts';
import './v10/textes.ts';

// Un règlement tel que l'interface l'a saisi, déjà lu et vérifié (serveur/v10/lecture.ts).
export type ReglementSaisi = {
  ref: string; rang: number; date: string; montant: bigint; cours: bigint | null;
  mode: string; compte: string | null; reference: string | null; note: string | null;
};

// Chaque côté a sa table et ses gestes (la trace dit lequel).
export type CoteReglements = { table: 'ventes.reglement' | 'achats.reglement'; trace: string; ailleurs: string };
export const REGLEMENTS_VENTES: CoteReglements = { table: 'ventes.reglement', trace: 'ventes.reglement', ailleurs: 'v10.reglement_ailleurs' };
export const REGLEMENTS_ACHATS: CoteReglements = { table: 'achats.reglement', trace: 'achats.reglement', ailleurs: 'v10.achat_reglement_ailleurs' };

const champs = (r: ReglementSaisi) => ({
  rang: r.rang, date_reglement: r.date, montant: r.montant, cours: r.cours, mode: r.mode, compte: r.compte, reference: r.reference, note: r.note,
});
const pourTrace = (r: { date: string; montant: bigint; mode: string }) => ({ date: r.date, montant: r.montant.toString(), mode: r.mode });

// Rend les règlements NOUVEAUX (ceux qui n'existaient pas), pour qui doit les annoncer.
export async function tenirReglements(tx: Transaction, cote: CoteReglements, entreprise: string, utilisateur: string, piece: string, voulus: ReglementSaisi[]) {
  const nouveaux: { id: string; saisi: ReglementSaisi }[] = [];
  const db = requetes(tx);
  const table = cote.table as 'ventes.reglement';   // les deux tables ont les mêmes colonnes
  const actuels = await db.selectFrom(table).selectAll().where('entreprise', '=', entreprise).where('piece', '=', piece).execute();
  const parRef = new Map(actuels.map((r) => [r.ref_v10 ?? r.id, r]));
  const voulusRefs = new Set(voulus.map((r) => r.ref));
  // Un règlement déjà tenu pour une AUTRE pièce ne se déplace pas.
  const ailleurs = voulus.length ? await db.selectFrom(table).select('ref_v10')
    .where('entreprise', '=', entreprise).where('piece', '<>', piece).where('ref_v10', 'in', [...voulusRefs]).executeTakeFirst() : undefined;
  if (ailleurs) throw new Refus(cote.ailleurs);

  for (const r of voulus) {
    const a = parRef.get(r.ref);
    if (!a) {
      const { id } = await db.insertInto(table).values({ entreprise, piece, ref_v10: r.ref, ...champs(r), cree_par: utilisateur })
        .returning('id').executeTakeFirstOrThrow();
      await tracer(tx, entreprise, `${cote.trace}.enregistrer`, { type: 'reglement', id }, null, pourTrace(r));
      nouveaux.push({ id, saisi: r });
      continue;
    }
    const avant = { date: a.date_reglement, montant: a.montant, cours: a.cours, mode: a.mode, compte: a.compte, reference: a.reference, note: a.note, rang: a.rang };
    const change = avant.date !== r.date || avant.montant !== r.montant || avant.cours !== r.cours || avant.mode !== r.mode
      || avant.compte !== r.compte || avant.reference !== r.reference || avant.note !== r.note;
    if (change) {
      await db.updateTable(table).set((eb) => ({ ...champs(r), modifie_par: utilisateur, modifie_le: new Date(), revision: eb('revision', '+', 1n) }))
        .where('id', '=', a.id).execute();
      await tracer(tx, entreprise, `${cote.trace}.modifier`, { type: 'reglement', id: a.id }, pourTrace({ date: a.date_reglement, montant: a.montant, mode: a.mode }), pourTrace(r));
    } else if (avant.rang !== r.rang) {
      // Seule sa place a changé (un autre règlement retiré avant lui) : pas un geste, pas de trace.
      await db.updateTable(table).set({ rang: r.rang }).where('id', '=', a.id).execute();
    }
  }
  for (const [ref, a] of parRef) {
    if (voulusRefs.has(ref)) continue;
    await db.deleteFrom(table).where('id', '=', a.id).execute();
    await tracer(tx, entreprise, `${cote.trace}.supprimer`, { type: 'reglement', id: a.id }, pourTrace({ date: a.date_reglement, montant: a.montant, mode: a.mode }), null);
  }
  return nouveaux;
}

// Le jour du calendrier à Tunis (une échéance se compare à un jour, jamais à un instant).
export function aujourdhuiATunis(maintenant = new Date()): string {
  return maintenant.toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
}
