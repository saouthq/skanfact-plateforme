// La pause d'un partenaire (0145 ; docs/console.md C69) : ce que le serveur envoie seul — le dépôt à la TTN, les relances
// d'échéance — s'arrête le temps que la console a dit (une heure, quatre heures, un jour au plus). Chaque tour la
// demande à la base avant d'envoyer quoi que ce soit : pendant la pause, rien ne part et aucun essai ne se compte.

import type pg from 'pg';
import { enTantQue } from '../base.ts';

export type PartenaireEnPause = 'ttn' | 'relances';

// En pause en ce moment : jusqu'à quand ; sinon null.
export async function enPause(pool: pg.Pool, partenaire: PartenaireEnPause, maintenant: Date): Promise<Date | null> {
  const v = await enTantQue(pool, null, async (tx) => (await tx.query('select plateforme.partenaire_en_pause($1, $2) v', [partenaire, maintenant])).rows[0]?.v as Date | null);
  return v ? new Date(v) : null;
}
