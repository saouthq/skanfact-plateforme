// La sortie de caisse de la paie (16 § 3.8 et § 10.1, urgence 5 ; docs/caisse.md) : la porte que la Caisse offre au
// Personnel (02 § 2 : le Personnel appelle la Caisse, jamais l'inverse). Un salaire ou une avance payés en espèces depuis le
// tiroir, la caisse ouverte, se notent dans sa session ; le Z les retire de ce que le tiroir devait contenir. L'argent est
// déjà dans les livres par la paie : la sortie n'écrit rien d'autre. Un fait n'est jamais refusé (04 § 5.1) : sans session
// ouverte, pour un jour hors de la session ou un autre compte, rien n'est noté, et le paiement passe.

import type { Transaction } from '../base.ts';
import { aujourdhuiATunis } from '../reglements.ts';

// Le compte du tiroir : le premier compte de caisse du dossier, celui où le Z écrit son écart et où la caisse de la v10 met
// les espèces (`comptesDeCaisse`, core.js).
export async function compteDuTiroir(tx: Transaction, ent: string): Promise<string | undefined> {
  return (await tx.query(`select cle from socle.dossier_v10 where entreprise = $1 and collection = 'accounts'
    and contenu->>'kind' = 'caisse' and coalesce(contenu->>'archived', '') not in ('true') order by rang, cle limit 1`, [ent])).rows[0]?.cle as string | undefined;
}

// Ce que la paie a payé (montant nul : plus rien), le compte de trésorerie que ses livres créditent, et le jour.
export type PaiementDeLaPaie = { nature: 'salaire' | 'avance'; origine: string; montant: bigint; jour: string | null; compte: string | undefined };

// Noter la sortie d'un paiement de la paie, ou la retirer (le paiement annulé, changé de compte ou de jour) : seulement
// dans une session ouverte, pour un jour de la session (de son ouverture à aujourd'hui), depuis le compte du tiroir.
export async function noterSortieDeCaisse(tx: Transaction, ent: string, p: PaiementDeLaPaie): Promise<void> {
  // La session verrouillée : une fermeture en même temps attend, et son Z compte la sortie, ou elle est déjà fermée.
  const s = (await tx.query(`select id, (ouverte_le at time zone 'Africa/Tunis')::date::text jour from caisse.session
    where entreprise = $1 and fermee_le is null order by ouverte_le limit 1 for update`, [ent])).rows[0] as { id: string; jour: string } | undefined;
  if (!s) return;
  await tx.query('delete from caisse.sortie where session = $1 and origine = $2', [s.id, p.origine]);
  if (p.montant <= 0n || !p.jour || p.jour < s.jour || p.jour > aujourdhuiATunis() || !p.compte || p.compte !== await compteDuTiroir(tx, ent)) return;
  await tx.query(`insert into caisse.sortie (entreprise, session, nature, origine, montant, cree_par) values ($1, $2, $3, $4, $5, socle.moi())`,
    [ent, s.id, p.nature, p.origine, p.montant.toString()]);
}

// Ce que la paie a pris au tiroir pendant une session, pour son Z.
export async function sortiesDeLaSession(tx: Transaction, session: string): Promise<bigint> {
  return BigInt((await tx.query('select coalesce(sum(montant), 0)::text s from caisse.sortie where session = $1', [session])).rows[0].s);
}
