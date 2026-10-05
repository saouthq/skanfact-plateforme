// Le registre des règles communes (01 § 3, R12) : les règles de droit que SkanFact applique à toutes les entreprises
// (le timbre d'une facture…) s'écrivent ICI, dans base/regles-communes.json, avec leur source, et se posent dans la
// base à chaque installation (exploitation/suivre.ts). Trouvé le 05/10/2026 sur le serveur d'essai : aucune facture
// ne s'émettait (« le timbre fiscal n'est pas renseigné ») ; les tests posent leur propre règle, et rien ne la posait
// sur un vrai serveur.
//
// Une règle ne se réécrit pas (0004) : une loi de finances AJOUTE une ligne au registre et ferme la date de fin de
// celle qu'elle remplace. Une ligne déjà posée avec une autre valeur, une autre source ou une autre fin se refuse, et
// rien du lot ne s'écrit : la pose s'arrête au lieu de deviner. Une règle qu'on ne connaît pas n'entre pas au
// registre : elle vaut « non renseigné ».
//
//   node base/regles-communes.ts      (adresse de la base : PG_ADMIN, un compte d'administration)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export type RegleCommune = { code: string; valeur: unknown; debut: string; fin?: string; source: string };

export function lireRegistre(fichier = path.join(import.meta.dirname, 'regles-communes.json')): RegleCommune[] {
  return JSON.parse(fs.readFileSync(fichier, 'utf8')) as RegleCommune[];
}

export async function poserReglesCommunes(adresse: string, regles: RegleCommune[]): Promise<{ posees: string[]; fermees: string[] }> {
  const client = new pg.Client({ connectionString: adresse });
  await client.connect();
  const posees: string[] = [];
  const fermees: string[] = [];
  try {
    await client.query('begin');
    const nouvelles: RegleCommune[] = [];
    // D'abord ce qui est déjà posé (et les dates de fin à fermer), puis les règles nouvelles : celle qui suit une
    // règle fermée dans le même lot ne la chevauche jamais.
    for (const r of regles) {
      const nom = `${r.code} au ${r.debut}`;
      const deja = (await client.query('select valeur = $3::jsonb as meme_valeur, source, fin::text as fin from socle.regle_fiscale where code = $1 and debut = $2::date',
        [r.code, r.debut, JSON.stringify(r.valeur)])).rows[0] as { meme_valeur: boolean; source: string; fin: string | null } | undefined;
      if (!deja) { nouvelles.push(r); continue; }
      if (!deja.meme_valeur || deja.source !== r.source) throw new Error(`la règle ${nom} est déjà posée autrement : une règle ne se réécrit pas, on ferme sa date de fin et on en écrit une nouvelle`);
      if (r.fin && !deja.fin) {
        await client.query('update socle.regle_fiscale set fin = $3::date where code = $1 and debut = $2::date', [r.code, r.debut, r.fin]);
        fermees.push(nom);
      } else if ((r.fin ?? null) !== deja.fin) {
        throw new Error(`la règle ${nom} a déjà sa date de fin (${deja.fin ?? 'aucune'}) : elle ne change plus`);
      }
    }
    for (const r of nouvelles) {
      await client.query('insert into socle.regle_fiscale (code, valeur, debut, fin, source) values ($1, $2::jsonb, $3::date, $4::date, $5)',
        [r.code, JSON.stringify(r.valeur), r.debut, r.fin ?? null, r.source]);
      posees.push(`${r.code} au ${r.debut}`);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    await client.end();
  }
  return { posees, fermees };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const adresse = process.env.PG_ADMIN;
  if (!adresse) {
    console.error('PG_ADMIN manque : l\'adresse d\'un compte d\'administration de la base.');
    process.exit(1);
  }
  const { posees, fermees } = await poserReglesCommunes(adresse, lireRegistre());
  console.log(`Règles communes : ${posees.length ? `posées ${posees.join(', ')}` : 'rien de nouveau'}${fermees.length ? ` ; fermées ${fermees.join(', ')}` : ''}.`);
}
