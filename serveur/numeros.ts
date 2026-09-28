// La numérotation (01 § 6). Un numéro légal se prend dans la transaction qui émet, APRÈS tous les
// contrôles : si l'émission échoue, la transaction est annulée et le numéro n'a jamais été pris.

import type { Transaction } from './base.ts';

export type Numero = { numero: number; texte: string };

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

function lu(r: { numero: string | number; texte: string } | undefined): Numero {
  if (!r) throw new Error('série introuvable');
  const numero = Number(r.numero);
  if (!Number.isSafeInteger(numero)) throw new Error(`numéro hors limites : ${r.numero}`);
  return { numero, texte: r.texte };
}

export async function prendreNumero(tx: Transaction, serie: string, datePiece: string): Promise<Numero> {
  if (!JOUR.test(datePiece)) throw new Error('la date de la pièce est un jour du calendrier (AAAA-MM-JJ)');
  return lu((await tx.query('select * from socle.prendre_numero($1, $2::date)', [serie, datePiece])).rows[0]);
}

// Le prochain numéro, pour l'aperçu : il se lit, il ne se réserve pas.
export async function prochainNumero(tx: Transaction, serie: string, datePiece: string): Promise<Numero> {
  if (!JOUR.test(datePiece)) throw new Error('la date de la pièce est un jour du calendrier (AAAA-MM-JJ)');
  return lu((await tx.query('select * from socle.prochain_numero($1, $2::date)', [serie, datePiece])).rows[0]);
}
