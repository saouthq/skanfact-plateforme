// Une base à part pour tester à la main (scripts/humain/lancer.sh) : la même préparation que les tests (tests/
// preparer-base.ts), sous un autre nom, pour qu'un test lancé ensuite ne l'efface pas. Écrit l'adresse du compte du
// serveur dans le fichier donné (jamais dans le dépôt : le mot de passe est tiré au hasard à chaque fois).
//   PG_ADMIN=… node scripts/humain/base.ts /tmp/skanfact-humain-plateforme/base.url
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';
import { migrer } from '../../base/migrer.ts';

const admin = process.env.PG_ADMIN;
if (!admin) throw new Error('PG_ADMIN manque : l\'adresse d\'un compte d\'administration PostgreSQL');
const sortie = process.argv[2];
if (!sortie) throw new Error('le fichier où écrire l\'adresse de la base manque');
const BASE = 'skanfact_humain';
const COMPTE = 'skanfact_humain_serveur';
const adresse = (base: string, compte?: { nom: string; mdp: string }) => {
  const u = new URL(admin);
  u.pathname = '/' + base;
  if (compte) { u.username = compte.nom; u.password = compte.mdp; }
  return u.toString();
};
const c = new pg.Client({ connectionString: admin });
await c.connect();
await c.query(`drop database if exists ${BASE} with (force)`);
await c.query(`create database ${BASE} template template0 locale_provider icu icu_locale 'en-US-u-ka-shifted'`);
const mdp = randomBytes(18).toString('base64url');
await c.query(`do $$ begin
    if exists (select from pg_roles where rolname = '${COMPTE}') then execute 'drop owned by ${COMPTE}'; execute 'drop role ${COMPTE}'; end if;
  end $$`);
await c.query(`create role ${COMPTE} login nobypassrls password '${mdp}'`);
await c.query('select pg_advisory_lock(20260929)');
try { await migrer(adresse(BASE)); } finally { await c.query('select pg_advisory_unlock(20260929)'); await c.end(); }
const m = new pg.Client({ connectionString: adresse(BASE) });
await m.connect();
await m.query(`grant skanfact_app to ${COMPTE}`);
await m.end();
fs.writeFileSync(sortie, adresse(BASE, { nom: COMPTE, mdp }), { mode: 0o600 });
console.log(`Base ${BASE} prête.`);
