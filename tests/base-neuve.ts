// Une base neuve à côté de la base des tests, toutes les migrations passées : pour y restaurer une
// entreprise. Le compte du serveur des tests y entre aussi (les rôles valent pour tout le serveur).

import pg from 'pg';
import { inject } from 'vitest';
import { migrer } from '../base/migrer.ts';

const avecBase = (adresse: string, base: string) => { const u = new URL(adresse); u.pathname = '/' + base; return u.toString(); };

export async function baseNeuve(nomDemande: string): Promise<{ admin: string; app: string; jeter: () => Promise<void> }> {
  // Un groupe de preuves (tests/preuves-paralleles.sh) a ses propres bases : jamais celle d'un voisin.
  const groupe = /^[0-9]{1,2}$/.test(process.env.SKANFACT_TEST_GROUPE ?? '') ? `_g${process.env.SKANFACT_TEST_GROUPE}` : '';
  const nom = `${nomDemande}${groupe}`;
  const serveur = new pg.Client({ connectionString: avecBase(inject('pgAdmin'), 'postgres') });
  await serveur.connect();
  await serveur.query(`drop database if exists ${nom} with (force)`);
  await serveur.query(`create database ${nom}`);
  const admin = avecBase(inject('pgAdmin'), nom);
  // Le même verrou que tests/preparer-base.ts : une migration à la fois sur tout le serveur.
  await serveur.query('select pg_advisory_lock(20260929)');
  try { await migrer(admin); } finally { await serveur.query('select pg_advisory_unlock(20260929)'); await serveur.end(); }
  return {
    admin,
    app: avecBase(inject('pgApp'), nom),
    jeter: async () => {
      const s = new pg.Client({ connectionString: avecBase(inject('pgAdmin'), 'postgres') });
      await s.connect();
      await s.query(`drop database if exists ${nom} with (force)`);
      await s.end();
    },
  };
}
