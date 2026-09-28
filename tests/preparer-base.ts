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

const BASE = 'skanfact_test';
const COMPTE = 'skanfact_test_serveur';

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
  await c.end();

  const pgAdmin = adresse(admin, BASE);
  await migrer(pgAdmin);
  const m = new pg.Client({ connectionString: pgAdmin });
  await m.connect();
  await m.query(`grant skanfact_app to ${COMPTE}`);
  await m.end();

  projet.provide('pgAdmin', pgAdmin);
  projet.provide('pgApp', adresse(admin, BASE, { nom: COMPTE, mdp }));
}
