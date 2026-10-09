// Écrit `base/types.ts` : la forme de chaque table, lue dans une base où toutes les migrations sont
// passées, pour que Kysely vérifie chaque requête avec les types (12 § 3). On l'écrit nous-mêmes
// plutôt qu'avec un générateur tout fait : un entier de 64 bits se lit en `bigint` (l'argent, 01 R3),
// une date de pièce reste un jour écrit (R5), et un type que ce fichier ne connaît pas l'arrête au
// lieu de devenir `unknown` sans qu'on le voie.
//
//   PG_ADMIN=postgres://… node base/generer-types.ts
//
// Un test (tests/socle/types-base.test.ts) tombe si le fichier ne suit plus les migrations.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrer } from './migrer.ts';

export const FICHIER = path.join(import.meta.dirname, 'types.ts');

// Chaque type de PostgreSQL employé par les migrations, et ce qu'il devient en TypeScript. Un type
// absent de cette liste arrête la génération : on décide comment il se lit avant de s'en servir.
const TYPES: Record<string, string> = {
  uuid: 'string',
  text: 'string',
  character: 'string',
  'character varying': 'string',
  inet: 'string',
  // Un numéro de transaction (brique 119, la marque d'une relecture) : lu et rendu en texte.
  xid8: 'string',
  smallint: 'number',
  integer: 'number',
  bigint: 'bigint',
  boolean: 'boolean',
  date: 'string',
  interval: 'string',
  'timestamp with time zone': 'Date',
  jsonb: 'Json',
  // Le contenu d'un fichier joint à un message (lot messagerie, 0078) : lu en octets, tel quel.
  bytea: 'Buffer',
};

type Colonne = { schema: string; table: string; colonne: string; type: string; tableau: boolean; requis: boolean; defaut: boolean; generee: boolean; vue: boolean };

export async function decrireBase(client: pg.Client): Promise<string> {
  const r = await client.query<Colonne>(`
    select n.nspname as schema, c.relname as table, a.attname as colonne,
           format_type(coalesce(nullif(t.typelem, 0), a.atttypid), null) as type,
           t.typcategory = 'A' as tableau,
           a.attnotnull as requis,
           (a.atthasdef or a.attidentity <> '') as defaut,
           a.attgenerated <> '' as generee,
           c.relkind = 'v' as vue
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_type t on t.oid = a.atttypid
    where n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'public')
      and c.relkind in ('r', 'p', 'v') and not c.relispartition
      and a.attnum > 0 and not a.attisdropped
    order by n.nspname, c.relname, a.attnum`);
  const tables = new Map<string, string[]>();
  for (const c of r.rows) {
    const ts = TYPES[c.type];
    if (!ts) throw new Error(`type inconnu : ${c.schema}.${c.table}.${c.colonne} (${c.type}) : ajoute-le dans base/generer-types.ts`);
    let t = c.tableau ? `${ts}[]` : ts;
    // Une vue ne dit pas ce qui peut être vide : tout y est permis vide.
    if (!c.requis || c.vue) t += ' | null';
    const ecrit = c.requis && !c.vue ? 'string' : 'string | null';
    if (ts === 'Json') {
      // Un jsonb s'écrit en texte JSON. S'il a une valeur par défaut, il peut manquer à l'insertion :
      // c'est dit dans le même ColumnType (Kysely ne sait pas écrire un Generated<ColumnType<…>>).
      t = `ColumnType<${t}, ${ecrit}${c.defaut && !c.generee ? ' | undefined' : ''}, ${ecrit}>`;
      if (c.generee) t = `GeneratedAlways<${t}>`;
    } else if (c.generee) t = `GeneratedAlways<${t}>`;
    else if (c.defaut) t = `Generated<${t}>`;
    const cle = `${c.schema}.${c.table}`;
    if (!tables.has(cle)) tables.set(cle, []);
    tables.get(cle)?.push(`    ${c.colonne}: ${t};`);
  }
  const corps = [...tables.entries()].map(([cle, colonnes]) => `  '${cle}': {\n${colonnes.join('\n')}\n  };`).join('\n');
  // N'importer que ce qui sert (le lint refuse un import inutile).
  const emplois = ['ColumnType', 'Generated', 'GeneratedAlways'].filter((n) => corps.includes(`${n}<`));
  return `// ÉCRIT par base/generer-types.ts à partir des migrations : ne pas le modifier à la main.
// (Un test tombe si ce fichier ne suit plus la base.)

import type { ${emplois.join(', ')} } from 'kysely';

// Un jsonb se lit tel quel ; il s'écrit en texte JSON (JSON.stringify), jamais en objet qui
// porterait un bigint.
export type Json = unknown;

export interface BaseDeDonnees {
${corps}
}
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const admin = process.env.PG_ADMIN;
  if (!admin) {
    console.error('PG_ADMIN manque : l\'adresse d\'un compte d\'administration de la base.');
    process.exit(1);
  }
  // Une base jetable, toutes les migrations, la description, puis la base est effacée.
  const BASE = 'skanfact_types';
  const c = new pg.Client({ connectionString: admin });
  await c.connect();
  await c.query(`drop database if exists ${BASE} with (force)`);
  await c.query(`create database ${BASE}`);
  const u = new URL(admin);
  u.pathname = '/' + BASE;
  try {
    await migrer(u.toString());
    const d = new pg.Client({ connectionString: u.toString() });
    await d.connect();
    try { fs.writeFileSync(FICHIER, await decrireBase(d)); } finally { await d.end(); }
    console.log(`Écrit : ${path.relative(process.cwd(), FICHIER)}`);
  } finally {
    await c.query(`drop database if exists ${BASE} with (force)`);
    await c.end();
  }
}
