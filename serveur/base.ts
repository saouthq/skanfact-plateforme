// L'accès du serveur à la base. Une seule façon de lire ou d'écrire : `enTantQue`, qui ouvre une
// transaction et y pose le nom de la personne qui agit (03 D1 et D9 : chaque geste porte le nom de
// celui qui l'a fait, personne n'agit au nom d'un autre). Sans ce nom, la base ne montre rien.

import pg from 'pg';

export type Transaction = pg.PoolClient;

// Une date de pièce est un JOUR du calendrier (01 R5) : le pilote la rendrait par défaut comme un
// instant à minuit, heure du serveur — le défaut de la 5.2.3 (une échéance un jour trop tôt). On la
// garde telle qu'elle est écrite : « 2026-10-01 ».
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);

export function creerPool(adresse: string): pg.Pool {
  return new pg.Pool({ connectionString: adresse, max: 10 });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function enTantQue<T>(pool: pg.Pool, utilisateur: string | null, travail: (tx: Transaction) => Promise<T>): Promise<T> {
  if (utilisateur !== null && !UUID.test(utilisateur)) throw new Error('identifiant de personne invalide');
  const tx = await pool.connect();
  try {
    await tx.query('begin');
    // `true` : le nom ne vaut que pour cette transaction. Une connexion rendue au pool ne garde
    // jamais le nom de la personne précédente.
    await tx.query(`select set_config('app.utilisateur', $1, true)`, [utilisateur ?? '']);
    const resultat = await travail(tx);
    await tx.query('commit');
    return resultat;
  } catch (e) {
    await tx.query('rollback').catch(() => {});
    throw e;
  } finally {
    tx.release();
  }
}
