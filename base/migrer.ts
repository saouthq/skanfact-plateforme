// Applique les migrations de base/migrations, dans l'ordre de leur numéro, chacune dans sa
// transaction. Une migration déjà appliquée ne se modifie plus : si son fichier a changé, on
// refuse (12 § 3 : on ajoute une migration, on ne réécrit jamais l'histoire).
//
//   node base/migrer.ts            (adresse de la base : PG_ADMIN, un compte d'administration)

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DOSSIER = path.join(import.meta.dirname, 'migrations');

export type Migration = { numero: number; nom: string; sql: string; empreinte: string };

export function lireMigrations(dossier = DOSSIER): Migration[] {
  const fichiers = fs.readdirSync(dossier).filter((f) => f.endsWith('.sql')).sort();
  const vus = new Set<number>();
  return fichiers.map((fichier) => {
    const m = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(fichier);
    if (!m) throw new Error(`nom de migration invalide : ${fichier} (attendu : 0001_nom.sql)`);
    const numero = Number(m[1]);
    if (vus.has(numero)) throw new Error(`deux migrations portent le numéro ${numero}`);
    vus.add(numero);
    const sql = fs.readFileSync(path.join(dossier, fichier), 'utf8');
    return { numero, nom: m[2] as string, sql, empreinte: createHash('sha256').update(sql).digest('hex') };
  });
}

export async function migrer(adresse: string, dossier = DOSSIER): Promise<number[]> {
  const client = new pg.Client({ connectionString: adresse });
  await client.connect();
  try {
    const existe = await client.query(`select to_regclass('socle.migration') is not null as oui`);
    const faites = new Map<number, string>();
    if (existe.rows[0].oui) {
      for (const r of (await client.query('select numero, empreinte from socle.migration')).rows) faites.set(r.numero, r.empreinte);
    }
    const appliquees: number[] = [];
    for (const m of lireMigrations(dossier)) {
      const deja = faites.get(m.numero);
      if (deja !== undefined) {
        if (deja !== m.empreinte) throw new Error(`la migration ${m.numero} (${m.nom}) a été modifiée après avoir été appliquée : écris-en une nouvelle`);
        continue;
      }
      await client.query('begin');
      try {
        await client.query(m.sql);
        await client.query('insert into socle.migration (numero, nom, empreinte) values ($1, $2, $3)', [m.numero, m.nom, m.empreinte]);
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw new Error(`migration ${m.numero} (${m.nom}) : ${(e as Error).message}`, { cause: e });
      }
      appliquees.push(m.numero);
    }
    return appliquees;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const adresse = process.env.PG_ADMIN;
  if (!adresse) {
    console.error('PG_ADMIN manque : l\'adresse d\'un compte d\'administration de la base.');
    process.exit(1);
  }
  const faites = await migrer(adresse);
  console.log(faites.length ? `Migrations appliquées : ${faites.join(', ')}` : 'La base est à jour.');
}
