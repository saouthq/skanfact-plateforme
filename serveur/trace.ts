// La trace d'un geste (0003) : `socle.tracer` écrit l'entreprise, la personne, l'instant, le geste,
// l'objet, et ce qu'il était avant et après, dans la MÊME transaction que le geste (01 R6). Avant et
// après s'écrivent en texte JSON ; un bigint (l'argent) y entre en texte, jamais en nombre à virgule.

import { sql } from 'kysely';
import { requetes, type Transaction } from './base.ts';

const json = (v: unknown) => (v === null ? null : JSON.stringify(v, (_cle, x: unknown) => (typeof x === 'bigint' ? x.toString() : x)));

export async function tracer(
  tx: Transaction, entreprise: string, geste: string, objet: { type: string; id: string }, avant: unknown, apres: unknown,
): Promise<void> {
  await sql`select socle.tracer(${entreprise}, ${geste}, ${objet.type}, ${objet.id}, ${json(avant)}::jsonb, ${json(apres)}::jsonb)`.execute(requetes(tx));
}
