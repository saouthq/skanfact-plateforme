// Les requêtes écrites avec Kysely (12 § 3) : les types qu'il vérifie suivent les migrations, un
// entier de 64 bits se lit en bigint, et une requête ne sert que dans SA transaction (celle qui porte
// le nom de la personne).

import fs from 'node:fs';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { decrireBase, FICHIER } from '../../base/generer-types.ts';
import { creerPool, enTantQue, requetes, type Transaction } from '../../serveur/base.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
beforeAll(async () => { await admin.connect(); });
afterAll(async () => { await admin.end(); await pool.end(); });

describe('les requêtes écrites avec Kysely', () => {
  it('base/types.ts suit les migrations (sinon : npm run types:base)', async () => {
    expect(fs.readFileSync(FICHIER, 'utf8')).toBe(await decrireBase(admin));
  });

  it('un type de colonne que le générateur ne connaît pas l\'arrête, au lieu de devenir « unknown »', async () => {
    await admin.query('create schema essai_types; create table essai_types.t (x point)');
    try {
      await expect(decrireBase(admin)).rejects.toThrow(/type inconnu : essai_types\.t\.x/);
    } finally {
      await admin.query('drop schema essai_types cascade');
    }
  });

  it('un entier de 64 bits se lit en bigint, jamais en nombre à virgule', async () => {
    const v = await enTantQue(pool, null, async (tx) =>
      (await sql<{ v: bigint }>`select 9007199254740993::bigint as v`.execute(requetes(tx))).rows[0]?.v);
    expect(v).toBe(9007199254740993n);
  });

  it('des requêtes gardées après leur transaction refusent de servir', async () => {
    const db = await enTantQue(pool, null, async (tx) => requetes(tx));
    await expect(db.selectFrom('socle.devise').select('code').execute()).rejects.toThrow(/après la fin de sa transaction/);
  });

  it('hors d\'une transaction ouverte par enTantQue, pas de requêtes', async () => {
    const client = await pool.connect();
    try {
      expect(() => requetes(client as Transaction)).toThrow(/enTantQue/);
    } finally {
      client.release();
    }
  });
});
