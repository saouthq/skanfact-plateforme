// La sauvegarde de toute la base, et l'exercice de restauration (06 § 4.2 et § 4.3 ; vision R8).
// Un outil d'exploitation : il travaille avec un compte d'administration, jamais par le serveur web.
//
//   PG_ADMIN=… node base/sauvegarde.ts sauvegarder <fichier>
//   PG_ADMIN=… node base/sauvegarde.ts exercice <fichier>
//
// La sauvegarde : `pg_dump`, et à côté un MANIFESTE pris dans le même instantané que la sauvegarde
// (les migrations, le nombre de lignes de chaque table, le bout de chaque chaîne d'empreintes) et
// l'empreinte du fichier.
//
// L'exercice (06 § 4.3), sans aide : restaure la sauvegarde dans une base VIDE, puis vérifie
//   - que le fichier est celui du manifeste (empreinte) et que les migrations sont les mêmes ;
//   - le nombre de lignes de chaque table ;
//   - chaque chaîne d'empreintes (01 R9), maillon par maillon, par un chemin écrit ici, à côté de
//     celui de la base (`socle.controler_chaine`, qui exige une personne connectée) ;
//   - un invariant « deux chemins, un chiffre » : chaque série a scellé autant de maillons qu'elle
//     compte de pièces émises ;
// et mesure le temps de bout en bout. Le rapport dit tout ce qui ne va pas, pas seulement le premier.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const FORMAT_MANIFESTE = 'skanfact-sauvegarde';

export type Manifeste = {
  format: typeof FORMAT_MANIFESTE; version: 1; faiteLe: string; empreinte: string;
  migrations: { numero: number; empreinte: string }[];
  tables: Record<string, number>;
  chaines: { entreprise: string; cle: string; rang: string; derniere: string }[];
};
export type Rapport = { ok: boolean; dureeMs: number; base: string; tables: number; lignes: number; chaines: number; erreurs: string[] };

const avecBase = (adresse: string, base: string) => { const u = new URL(adresse); u.pathname = '/' + base; return u.toString(); };
const sha256Fichier = (f: string) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// Les outils de PostgreSQL : ceux du PATH, sinon ceux de la version installée. Absents, l'outil le
// dit : une sauvegarde qui ne se fait pas n'est jamais silencieuse.
function outil(nom: 'pg_dump' | 'pg_restore'): string {
  if (spawnSync(nom, ['--version']).status === 0) return nom;
  for (const v of ['17', '16']) {
    const p = `/usr/lib/postgresql/${v}/bin/${nom}`;
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`${nom} introuvable : installe le client PostgreSQL`);
}
function lancer(commande: string, args: string[]): Promise<void> {
  return new Promise((ok, ko) => {
    const p = spawn(commande, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    p.on('close', (code) => (code === 0 ? ok() : ko(new Error(`${path.basename(commande)} a échoué (${code}) : ${err.trim()}`))));
  });
}

async function tablesDe(c: pg.Client): Promise<string[]> {
  return (await c.query(`select schemaname || '.' || tablename t from pg_tables
    where schemaname not in ('pg_catalog', 'information_schema') order by 1`)).rows.map((r) => r.t as string);
}
async function compter(c: pg.Client): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of await tablesDe(c)) out[t] = Number((await c.query(`select count(*) n from ${t.split('.').map((x) => `"${x}"`).join('.')}`)).rows[0].n);
  return out;
}

export async function sauvegarder(adresseAdmin: string, fichier: string): Promise<Manifeste> {
  const c = new pg.Client({ connectionString: adresseAdmin });
  await c.connect();
  try {
    // Le manifeste et la sauvegarde voient la MÊME base : un instantané partagé avec pg_dump.
    await c.query('begin isolation level repeatable read read only');
    const instantane = (await c.query('select pg_export_snapshot() s')).rows[0].s as string;
    const migrations = (await c.query('select numero, empreinte from socle.migration order by numero')).rows as { numero: number; empreinte: string }[];
    const tables = await compter(c);
    const chaines = (await c.query(`select entreprise::text, cle, rang::text, derniere from socle.chaine order by entreprise, cle`)).rows as Manifeste['chaines'];
    await lancer(outil('pg_dump'), ['--format=custom', `--snapshot=${instantane}`, `--file=${fichier}`, `--dbname=${adresseAdmin}`]);
    await c.query('commit');
    const manifeste: Manifeste = { format: FORMAT_MANIFESTE, version: 1, faiteLe: new Date().toISOString(), empreinte: sha256Fichier(fichier), migrations, tables, chaines };
    fs.writeFileSync(`${fichier}.manifeste.json`, JSON.stringify(manifeste, null, 1));
    return manifeste;
  } finally {
    await c.end();
  }
}

export async function exerciceDeRestauration(fichier: string, adresseAdmin: string, opts: { garder?: boolean } = {}): Promise<Rapport> {
  const debut = Date.now();
  const erreurs: string[] = [];
  const base = `skanfact_exercice_${new Date().toISOString().slice(0, 19).replace(/\D/g, '')}_${process.pid}`;
  const rapport = (tables = 0, lignes = 0, chaines = 0): Rapport => ({ ok: erreurs.length === 0, dureeMs: Date.now() - debut, base, tables, lignes, chaines, erreurs });

  const cheminManifeste = `${fichier}.manifeste.json`;
  if (!fs.existsSync(fichier) || !fs.existsSync(cheminManifeste)) { erreurs.push('la sauvegarde ou son manifeste manque'); return rapport(); }
  const m = JSON.parse(fs.readFileSync(cheminManifeste, 'utf8')) as Manifeste;
  if (m.format !== FORMAT_MANIFESTE || m.version !== 1) { erreurs.push('ce manifeste n\'est pas celui d\'une sauvegarde SkanFact'); return rapport(); }
  if (sha256Fichier(fichier) !== m.empreinte) { erreurs.push('le fichier de sauvegarde n\'est pas celui du manifeste (abîmé ou remplacé)'); return rapport(); }

  // Une base VIDE, créée pour l'exercice. Les rôles valent pour tout le serveur : celui du serveur
  // web doit exister pour que les droits se restaurent.
  const serveur = new pg.Client({ connectionString: avecBase(adresseAdmin, 'postgres') });
  await serveur.connect();
  try {
    await serveur.query(`create database ${base}`);
    await serveur.query(`do $$ begin if not exists (select from pg_roles where rolname = 'skanfact_app') then create role skanfact_app nologin; end if; end $$`);
  } finally {
    await serveur.end();
  }
  const adresse = avecBase(adresseAdmin, base);
  const c = new pg.Client({ connectionString: adresse });
  let tables = 0, lignes = 0, chaines = 0;
  try {
    await lancer(outil('pg_restore'), ['--exit-on-error', '--no-owner', `--dbname=${adresse}`, fichier]);
    await c.connect();

    const migrations = (await c.query('select numero, empreinte from socle.migration order by numero')).rows;
    if (JSON.stringify(migrations) !== JSON.stringify(m.migrations)) erreurs.push('les migrations restaurées ne sont pas celles de la sauvegarde');

    const comptes = await compter(c);
    tables = Object.keys(comptes).length;
    lignes = Object.values(comptes).reduce((a, b) => a + b, 0);
    for (const t of new Set([...Object.keys(m.tables), ...Object.keys(comptes)])) {
      if (m.tables[t] !== comptes[t]) erreurs.push(`${t} : ${m.tables[t] ?? 'absente'} lignes sauvegardées, ${comptes[t] ?? 'absente'} restaurées`);
    }

    // Chaque chaîne, maillon par maillon : le rang suit, chaque maillon suit le précédent, chaque
    // empreinte se recalcule, et le bout de la chaîne est le dernier maillon.
    const casses = (await c.query(`
      with m as (
        select ml.entreprise, ml.cle, ml.rang, ml.precedente, ml.empreinte, ml.contenu,
               row_number() over w as attendu,
               coalesce(lag(ml.empreinte) over w, repeat('0', 64)) as avant
          from socle.maillon ml window w as (partition by ml.entreprise, ml.cle order by ml.rang)
      ),
      faux as (
        select entreprise, cle, min(rang) rang from m
         where rang <> attendu or precedente <> avant or empreinte <> socle.empreinte_maillon(precedente, contenu)
         group by entreprise, cle
      ),
      bouts as (
        select ch.entreprise, ch.cle, ch.rang, ch.derniere,
               (select count(*) from socle.maillon x where x.entreprise = ch.entreprise and x.cle = ch.cle) n,
               (select x.empreinte from socle.maillon x where x.entreprise = ch.entreprise and x.cle = ch.cle order by x.rang desc limit 1) fin
          from socle.chaine ch
      )
      select b.entreprise::text, b.cle, f.rang::text faux,
             (b.rang <> b.n or coalesce(b.fin, repeat('0', 64)) <> b.derniere) bout_faux
        from bouts b left join faux f on f.entreprise = b.entreprise and f.cle = b.cle
       where f.rang is not null or b.rang <> b.n or coalesce(b.fin, repeat('0', 64)) <> b.derniere`)).rows as { entreprise: string; cle: string; faux: string | null; bout_faux: boolean }[];
    for (const x of casses) erreurs.push(`chaîne ${x.cle} de ${x.entreprise} : ${x.faux ? `le maillon ${x.faux} ne va pas` : 'la fin de la chaîne manque'}`);
    const restaurees = (await c.query(`select entreprise::text, cle, rang::text, derniere from socle.chaine order by entreprise, cle`)).rows;
    chaines = restaurees.length;
    if (JSON.stringify(restaurees) !== JSON.stringify(m.chaines)) erreurs.push('le bout d\'une chaîne n\'est pas celui de la sauvegarde');

    // Deux chemins, un chiffre : chaque série a scellé autant de maillons qu'elle compte de pièces émises.
    const series = (await c.query(`
      select s.id::text serie, count(p.id) emises, coalesce(ch.rang, 0)::int scelles
        from socle.serie s
        left join ventes.piece p on p.serie = s.id and p.statut = 'emise'
        left join socle.chaine ch on ch.entreprise = s.entreprise and ch.cle = 'serie:' || s.id
       group by s.id, ch.rang
      having count(p.id) <> coalesce(ch.rang, 0)`)).rows as { serie: string; emises: string; scelles: number }[];
    for (const s of series) erreurs.push(`la série ${s.serie} compte ${s.emises} pièces émises et ${s.scelles} maillons`);
  } catch (e) {
    erreurs.push(e instanceof Error ? e.message : String(e));
  } finally {
    await c.end().catch(() => undefined);
    if (!opts.garder) {
      const s = new pg.Client({ connectionString: avecBase(adresseAdmin, 'postgres') });
      await s.connect();
      await s.query(`drop database if exists ${base} with (force)`);
      await s.end();
    }
  }
  return rapport(tables, lignes, chaines);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [geste, fichier] = process.argv.slice(2);
  const admin = process.env.PG_ADMIN;
  if (!admin || !fichier || (geste !== 'sauvegarder' && geste !== 'exercice')) {
    console.error('usage : PG_ADMIN=… node base/sauvegarde.ts sauvegarder|exercice <fichier>');
    process.exit(2);
  }
  if (geste === 'sauvegarder') {
    const m = await sauvegarder(admin, fichier);
    console.log(`sauvegarde faite : ${Object.keys(m.tables).length} tables, ${m.chaines.length} chaînes, empreinte ${m.empreinte}`);
  } else {
    const r = await exerciceDeRestauration(fichier, admin);
    console.log(JSON.stringify(r, null, 1));
    process.exit(r.ok ? 0 : 1);
  }
}
