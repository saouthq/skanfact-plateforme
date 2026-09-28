// L'accès du serveur à la base. Une seule façon de lire ou d'écrire : `enTantQue`, qui ouvre une
// transaction et y pose le nom de la personne qui agit (03 D1 et D9 : chaque geste porte le nom de
// celui qui l'a fait, personne n'agit au nom d'un autre). Sans ce nom, la base ne montre rien.
// Dans cette transaction, les requêtes s'écrivent avec Kysely (`requetes`, 12 § 3) ; les appels aux
// fonctions du socle et les états lourds, en SQL écrit à la main.

import { Kysely, PostgresDialect, type PostgresPoolClient } from 'kysely';
import pg from 'pg';
import type { BaseDeDonnees } from '../base/types.ts';

export type Transaction = pg.PoolClient;
export type Requetes = Kysely<BaseDeDonnees>;

// Une date de pièce est un JOUR du calendrier (01 R5) : le pilote la rendrait par défaut comme un
// instant à minuit, heure du serveur — le défaut de la 5.2.3 (une échéance un jour trop tôt). On la
// garde telle qu'elle est écrite : « 2026-10-01 ».
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);
// Un entier de 64 bits (l'argent, les compteurs) se lit en `bigint` : ni texte à convertir, ni
// nombre à virgule qui perdrait les derniers chiffres (01 R3).
pg.types.setTypeParser(pg.types.builtins.INT8, (v: string) => BigInt(v));
// Une durée se lit telle que la base l'écrit (« 12:00:00 »).
pg.types.setTypeParser(pg.types.builtins.INTERVAL, (v: string) => v);

export function creerPool(adresse: string): pg.Pool {
  return new pg.Pool({ connectionString: adresse, max: 10 });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// La transaction en cours sur chaque connexion : un jeton neuf à chaque `enTantQue`.
const enCours = new WeakMap<Transaction, object>();
const parTransaction = new WeakMap<object, Requetes>();

// `cle` : une clé de l'API qui agit (03 § 8), à la place d'une personne (voir enTantQueCle).
export async function enTantQue<T>(pool: pg.Pool, utilisateur: string | null, travail: (tx: Transaction) => Promise<T>, cle: string | null = null): Promise<T> {
  if (utilisateur !== null && !UUID.test(utilisateur)) throw new Error('identifiant de personne invalide');
  if (cle !== null && (!UUID.test(cle) || utilisateur !== null)) throw new Error('une clé agit seule, avec un identifiant valide');
  const tx = await pool.connect();
  try {
    await tx.query('begin');
    // `true` : le nom ne vaut que pour cette transaction. Une connexion rendue au pool ne garde
    // jamais le nom de la personne précédente.
    await tx.query(`select set_config('app.utilisateur', $1, true), set_config('app.cle_api', $2, true)`, [utilisateur ?? '', cle ?? '']);
    enCours.set(tx, {});
    const resultat = await travail(tx);
    await tx.query('commit');
    return resultat;
  } catch (e) {
    await tx.query('rollback').catch(() => {});
    throw e;
  } finally {
    enCours.delete(tx);
    tx.release();
  }
}

// Une transaction au nom d'une clé de l'API : la base ne lui montre que son entreprise, tant
// qu'elle n'est ni révoquée ni expirée (socle.mes_entreprises).
export const enTantQueCle = <T>(pool: pg.Pool, cle: string, travail: (tx: Transaction) => Promise<T>) => enTantQue(pool, null, travail, cle);

// Les requêtes Kysely de CETTE transaction : même connexion, même personne. Gardées au-delà, elles
// refusent de servir : la connexion est alors rendue au pool, peut-être déjà au nom d'un autre.
export function requetes(tx: Transaction): Requetes {
  const jeton = enCours.get(tx);
  if (!jeton) throw new Error('requetes() s\'emploie dans une transaction ouverte par enTantQue');
  let db = parTransaction.get(jeton);
  if (!db) {
    const client = {
      query: (texte: string, valeurs: readonly unknown[]) => {
        if (enCours.get(tx) !== jeton) throw new Error('requête après la fin de sa transaction : refusée');
        return tx.query(texte, [...valeurs]);
      },
      release: () => {},
    } as unknown as PostgresPoolClient;
    db = new Kysely<BaseDeDonnees>({ dialect: new PostgresDialect({ pool: { connect: async () => client, end: async () => {}, options: {} } }) });
    parTransaction.set(jeton, db);
  }
  return db;
}
