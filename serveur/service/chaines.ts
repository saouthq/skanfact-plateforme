// La relecture des chaînes d'empreintes, par le serveur (0115 ; l'audit F21 ; docs/console.md C38) : un tour par heure,
// un lot à la fois — les chaînes les moins récemment relues d'abord. La base fait le contrôle des liens
// (socle.verifier_chaine) et garde le relevé ; ce tour ne fait que l'appeler, sans identité (le serveur seul relit toutes
// les entreprises). Puis, depuis 0142, le contenu des pièces d'un lot de chaînes, recomparé à leur empreinte
// (./contenus.ts ; docs/console.md C66).

import type pg from 'pg';
import { enTantQue } from '../base.ts';
import { CHAINES_PAR_LOT } from '../console/chaines.ts';
import { relireLesContenus } from './contenus.ts';

export async function relireLesChaines(pool: pg.Pool, maintenant: Date = new Date()): Promise<{ chaines: number; maillons: number; cassees: number; contenus: number; pieces: number; contenusCasses: number }> {
  const liens = await enTantQue(pool, null, async (tx) => (await tx.query('select plateforme.relire_chaines($1, $2) v', [maintenant, CHAINES_PAR_LOT])).rows[0].v) as { chaines: number; maillons: number; cassees: number };
  const contenus = await relireLesContenus(pool, maintenant);
  return { ...liens, contenus: contenus.chaines, pieces: contenus.pieces, contenusCasses: contenus.cassees };
}
