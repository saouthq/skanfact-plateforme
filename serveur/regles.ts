// Les règles de droit, lues à la date de la pièce (01 R11) : celle de l'entreprise, sinon la
// commune, sinon `null` (« non renseigné », R12). Aucun taux n'est écrit dans le code.
//
// La pièce émise garde l'identifiant de la règle appliquée (R7) : relue en 2028, une facture de
// 2026 garde les règles de 2026.

import type { Transaction } from './base.ts';

export type RegleLue = { valeur: unknown; origine: 'entreprise' | 'commune'; regle: string; source: string };

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

// `date` est un jour du calendrier (« 2026-10-01 »), jamais un instant (01 R5).
export async function regle(tx: Transaction, entreprise: string, code: string, date: string): Promise<RegleLue | null> {
  if (!JOUR.test(date)) throw new Error(`une règle se lit à un jour du calendrier (AAAA-MM-JJ), pas « ${date} »`);
  const r = (await tx.query('select * from socle.regle($1, $2, $3::date)', [entreprise, code, date])).rows[0];
  return r ? { valeur: r.valeur, origine: r.origine, regle: r.regle, source: r.source } : null;
}
