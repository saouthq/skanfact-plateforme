// Avant les tests : une base neuve, les migrations appliquées, et un compte de connexion pour le
// serveur, rattaché au rôle `skanfact_app`, avec un mot de passe tiré au hasard à chaque fois
// (aucun secret dans le dépôt). Les tests se connectent comme le serveur le fera.

import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrer } from '../base/migrer.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdmin: string;
    pgApp: string;
  }
}

// Un groupe de preuves qui tourne à côté d'un autre (tests/preuves-paralleles.sh) a sa propre base et
// son propre compte : SKANFACT_TEST_GROUPE (des chiffres), sinon la base de toujours.
const GROUPE = /^[0-9]{1,2}$/.test(process.env.SKANFACT_TEST_GROUPE ?? '') ? `_g${process.env.SKANFACT_TEST_GROUPE}` : '';
const BASE = `skanfact_test${GROUPE}`;
const COMPTE = `skanfact_test_serveur${GROUPE}`;

function adresse(modele: string, base: string, compte?: { nom: string; mdp: string }): string {
  const u = new URL(modele);
  u.pathname = '/' + base;
  if (compte) { u.username = compte.nom; u.password = compte.mdp; }
  return u.toString();
}

export default async function preparer(projet: TestProject) {
  const admin = process.env.PG_ADMIN;
  if (!admin) throw new Error('PG_ADMIN manque : l\'adresse d\'un compte d\'administration PostgreSQL (voir le README)');
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(`drop database if exists ${BASE} with (force)`);
  await c.query(`create database ${BASE}`);
  const mdp = randomBytes(18).toString('base64url');
  await c.query(`do $$ begin
      if exists (select from pg_roles where rolname = '${COMPTE}') then execute 'drop owned by ${COMPTE}'; execute 'drop role ${COMPTE}'; end if;
    end $$`);
  await c.query(`create role ${COMPTE} login nobypassrls password '${mdp}'`);

  // Les migrations touchent aussi le rôle `skanfact_app`, commun à tout le serveur : deux groupes de
  // preuves qui migrent au même instant se heurteraient (« tuple concurrently updated »). Un verrou,
  // pris dans la base `postgres` que tous partagent, les fait passer l'un après l'autre.
  const pgAdmin = adresse(admin, BASE);
  await c.query('select pg_advisory_lock(20260929)');
  try { await migrer(pgAdmin); } finally { await c.query('select pg_advisory_unlock(20260929)'); await c.end(); }
  const m = new pg.Client({ connectionString: pgAdmin });
  await m.connect();
  await m.query(`grant skanfact_app to ${COMPTE}`);
  await m.end();

  projet.provide('pgAdmin', pgAdmin);
  projet.provide('pgApp', adresse(admin, BASE, { nom: COMPTE, mdp }));
}
