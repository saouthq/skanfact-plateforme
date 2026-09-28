// Une base neuve à côté de la base des tests, toutes les migrations passées : pour y restaurer une
// entreprise. Le compte du serveur des tests y entre aussi (les rôles valent pour tout le serveur).

import pg from 'pg';
import { inject } from 'vitest';
import { migrer } from '../base/migrer.ts';

const avecBase = (adresse: string, base: string) => { const u = new URL(adresse); u.pathname = '/' + base; return u.toString(); };

export async function baseNeuve(nom: string): Promise<{ admin: string; app: string; jeter: () => Promise<void> }> {
  const serveur = new pg.Client({ connectionString: avecBase(inject('pgAdmin'), 'postgres') });
  await serveur.connect();
  await serveur.query(`drop database if exists ${nom} with (force)`);
  await serveur.query(`create database ${nom}`);
  await serveur.end();
  const admin = avecBase(inject('pgAdmin'), nom);
  await migrer(admin);
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
