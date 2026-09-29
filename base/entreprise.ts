// Exporter UNE entreprise, et la restaurer à l'identique (vision § 4.2, 01 R14, 06 § 4.4). C'est un
// outil d'exploitation : il travaille avec un compte d'administration, jamais par le serveur web, et
// chaque restauration laisse sa trace dans la piste d'audit de l'entreprise.
//
//   PG_ADMIN=… node base/entreprise.ts exporter <entreprise> <fichier>
//   PG_ADMIN=… node base/entreprise.ts restaurer <fichier>
//
// Le fichier, une ligne par élément :
//   - l'en-tête (le format, l'entreprise, les migrations de la base d'origine) ;
//   - pour chaque table, une ligne qui la nomme, puis ses lignes telles que PostgreSQL les écrit
//     en JSON. Elles vont de la base au fichier et du fichier à la base EN TEXTE : le serveur ne les
//     relit jamais en JavaScript, où un entier de 64 bits perdrait ses derniers chiffres ;
//   - la fin, avec l'empreinte de tout ce qui précède : un fichier coupé ou abîmé est refusé.
//
// Chaque table de la base a sa place dans CLASSEMENT ; l'export refuse une table qui n'en a pas (et
// un test tombe) : on décide, table par table, si elle part avec l'entreprise.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const FORMAT = 'skanfact-entreprise';
export const VERSION = 1;

// Où va chaque table.
//   entreprise : ses lignes sont celles de l'entreprise (`condition`, par défaut `entreprise = $1`) ;
//                `aussiReference` : les lignes d'ailleurs que l'entreprise désigne partent aussi,
//                comme une référence (un collaborateur du cabinet, un membre du groupe) ;
//   reference  : une chose partagée que l'entreprise désigne (une personne, un groupe, un cabinet,
//                un appareil) : seules les lignes désignées partent, avec les seules `colonnes`
//                dites (aucun secret), créées à la restauration si elles manquent, jamais écrasées ;
//   commune    : la même sur toute la plateforme (devises, règles communes) : jamais exportée ;
//   hors       : ne part jamais, avec sa raison.
export type Classe =
  | { classe: 'entreprise'; condition?: string; aussiReference?: true }
  | { classe: 'reference'; colonnes?: string[] }
  | { classe: 'commune' }
  | { classe: 'hors'; raison: string };

export const CLASSEMENT: Record<string, Classe> = {
  'socle.entreprise': { classe: 'entreprise', condition: 'id = $1' },
  'socle.etablissement': { classe: 'entreprise' },
  'socle.membre': { classe: 'entreprise', aussiReference: true },
  'socle.mandat': { classe: 'entreprise' },
  'socle.mandat_affectation': { classe: 'entreprise', condition: 'mandat in (select id from socle.mandat where entreprise = $1)' },
  'socle.invitation': { classe: 'entreprise' },
  'socle.transfert_propriete': { classe: 'entreprise' },
  'socle.audit': { classe: 'entreprise' },
  'socle.regle_entreprise': { classe: 'entreprise' },
  'socle.serie': { classe: 'entreprise' },
  'socle.compteur': { classe: 'entreprise' },
  'socle.chaine': { classe: 'entreprise' },
  'socle.maillon': { classe: 'entreprise' },
  'socle.tiers': { classe: 'entreprise' },
  'ventes.piece': { classe: 'entreprise' },
  'ventes.ligne': { classe: 'entreprise' },
  // Les règlements d'une facture (0012) : ils partent avec elle.
  'ventes.reglement': { classe: 'entreprise' },
  // Les achats (0013) : la pièce du fournisseur, ses lignes, ses règlements.
  'achats.piece': { classe: 'entreprise' },
  'achats.ligne': { classe: 'entreprise' },
  'achats.reglement': { classe: 'entreprise' },
  // La paie (0014) : les salariés et leurs bulletins, chacun avec le barème qui l'a calculé.
  'paie.salarie': { classe: 'entreprise' },
  'paie.bulletin': { classe: 'entreprise' },
  // Les écritures (0015) : le brouillard et ce qui sera validé ; elles partent avec l'entreprise.
  'compta.ecriture': { classe: 'entreprise' },
  'compta.ligne': { classe: 'entreprise' },
  'compta.cloture': { classe: 'entreprise' },
  // La fiche d'un dossier au cabinet appartient au CABINET (ses notes sur son client) : elle ne part
  // pas avec l'entreprise.
  'cabinet.fiche': { classe: 'hors', raison: 'les notes du cabinet sur son client appartiennent au cabinet' },
  'compta.compteur': { classe: 'entreprise' },
  'compta.lettrage': { classe: 'entreprise' },
  'compta.ligne_lettree': { classe: 'entreprise' },
  // Le dossier v10 de l'entreprise (0011) : ce que son interface tient, objet par objet.
  'socle.dossier_v10': { classe: 'entreprise' },
  // Le code d'un cabinet n'est pas repris : unique sur la plateforme, il reste à son cabinet.
  'socle.organisation': { classe: 'reference', colonnes: ['id', 'type', 'nom', 'cree_le'] },
  // Jamais l'empreinte du mot de passe ni le téléphone vérifié : une personne recréée se reconnecte
  // par « mot de passe oublié ».
  'socle.utilisateur': { classe: 'reference', colonnes: ['id', 'email', 'nom', 'langue', 'cree_le'] },
  // Un appareil désigné par la trace, sans sa clé ni sa reconnaissance : recréé, il n'est pas
  // « reconnu » et redemande le code.
  'socle.appareil': { classe: 'reference', colonnes: ['id', 'utilisateur', 'nom', 'type', 'premier_vu', 'revoque_le'] },
  'socle.cle_api': { classe: 'hors', raison: 'une clé d\'accès ne quitte jamais la plateforme : on en recrée une' },
  'socle.abonnement_avis': { classe: 'hors', raison: 'un abonnement porte un secret de signature, qui ne quitte jamais la plateforme : on le recrée' },
  'socle.avis': { classe: 'hors', raison: 'un avis déjà livré ne se renvoie pas ; ceux qui attendaient partent avec leur abonnement' },
  'socle.devise': { classe: 'commune' },
  'socle.regle_fiscale': { classe: 'commune' },
  'socle.migration': { classe: 'hors', raison: 'l\'en-tête du fichier porte la liste des migrations' },
  'socle.session': { classe: 'hors', raison: 'une session ouverte est une clé de connexion' },
  'socle.code_secours': { classe: 'hors', raison: 'un secret de connexion ne quitte jamais la plateforme' },
  'socle.defi_connexion': { classe: 'hors', raison: 'un secret de connexion ne quitte jamais la plateforme' },
  'socle.tentative': { classe: 'hors', raison: 'le journal technique des connexions n\'appartient pas à l\'entreprise' },
  'socle.file_appareil': { classe: 'hors', raison: 'l\'ordre des gestes d\'un appareil appartient à l\'appareil' },
  // À REVOIR avec la file (étape 2) : les gestes « À reprendre » encore ouverts sont comptés dans
  // l'en-tête et annoncés, mais pas restaurés.
  'socle.operation': { classe: 'hors', raison: 'l\'effet d\'un geste accepté est dans les tables de l\'entreprise et sa trace dans l\'audit' },
};

// Les liens que la base ne déclare pas en clé étrangère (la trace, découpée par mois, n'en porte
// pas) mais que l'export doit suivre : la personne et l'appareil qui ont fait chaque geste.
export const LIENS_SANS_CONTRAINTE: Lien[] = [
  { nom: 'audit → utilisateur', de: 'socle.audit', colonnes: ['utilisateur'], vers: 'socle.utilisateur', versColonnes: ['id'] },
  { nom: 'audit → appareil', de: 'socle.audit', colonnes: ['appareil'], vers: 'socle.appareil', versColonnes: ['id'] },
];

type Lien = { nom: string; de: string; colonnes: string[]; vers: string; versColonnes: string[] };
type Colonne = { nom: string; identite: boolean };
type Catalogue = { tables: string[]; colonnes: Map<string, Colonne[]>; cles: Map<string, string[]>; liens: Lien[] };

const q = (ident: string) => '"' + ident.replaceAll('"', '""') + '"';
const qt = (table: string) => table.split('.').map(q).join('.');

async function lireCatalogue(client: pg.ClientBase): Promise<Catalogue> {
  const t = await client.query<{ nom: string }>(`
    select n.nspname || '.' || c.relname as nom from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'public')
      and c.relkind in ('r', 'p') and not c.relispartition order by 1`);
  const c = await client.query<{ tbl: string; nom: string; identite: boolean }>(`
    select n.nspname || '.' || c.relname as tbl, a.attname::text as nom, a.attidentity <> '' as identite
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'public') and c.relkind in ('r', 'p')
      and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' order by 1, a.attnum`);
  const k = await client.query<{ tbl: string; cols: string[] }>(`
    select n.nspname || '.' || c.relname as tbl, array_agg(a.attname::text order by array_position(i.indkey, a.attnum)) as cols
    from pg_index i join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
    where i.indisprimary group by 1`);
  const f = await client.query<{ nom: string; de: string; cols: string[]; vers: string; verscols: string[] }>(`
    select k.conname as nom, sn.nspname || '.' || s.relname as de, tn.nspname || '.' || t.relname as vers,
      (select array_agg(a.attname::text order by x.o) from unnest(k.conkey) with ordinality x(n, o) join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.n) as cols,
      (select array_agg(a.attname::text order by x.o) from unnest(k.confkey) with ordinality x(n, o) join pg_attribute a on a.attrelid = k.confrelid and a.attnum = x.n) as verscols
    from pg_constraint k join pg_class s on s.oid = k.conrelid join pg_namespace sn on sn.oid = s.relnamespace
    join pg_class t on t.oid = k.confrelid join pg_namespace tn on tn.oid = t.relnamespace
    where k.contype = 'f' and not s.relispartition order by 1`);
  const colonnes = new Map<string, Colonne[]>();
  for (const r of c.rows) {
    if (!colonnes.has(r.tbl)) colonnes.set(r.tbl, []);
    colonnes.get(r.tbl)?.push({ nom: r.nom, identite: r.identite });
  }
  return {
    tables: t.rows.map((r) => r.nom),
    colonnes,
    cles: new Map(k.rows.map((r) => [r.tbl, r.cols])),
    liens: [...f.rows.map((r) => ({ nom: r.nom, de: r.de, colonnes: r.cols, vers: r.vers, versColonnes: r.verscols })), ...LIENS_SANS_CONTRAINTE],
  };
}

// Les tables que CLASSEMENT ne range pas (une table nouvelle attend sa décision).
export async function tablesNonClassees(client: pg.ClientBase): Promise<string[]> {
  return (await lireCatalogue(client)).tables.filter((t) => !(t in CLASSEMENT));
}

// Les parties de l'export : pour chaque table, les lignes de l'entreprise et/ou les références.
type Partie = { table: string; role: 'entreprise' | 'reference'; selection: string; colonnes: string[] };

function parties(cat: Catalogue): Partie[] {
  const res: Partie[] = [];
  const entreprise = new Map<string, string>();
  for (const [table, c] of Object.entries(CLASSEMENT)) {
    if (c.classe === 'entreprise') entreprise.set(table, `select * from ${qt(table)} where ${c.condition ?? 'entreprise = $1'}`);
  }
  // Les lignes de référence d'une table : celles que désigne une ligne exportée (entreprise ou
  // référence), et qui ne sont pas déjà parmi les lignes de l'entreprise.
  const references = new Map<string, string>();
  const enCours = new Set<string>();
  const selectionReference = (table: string): string => {
    const deja = references.get(table);
    if (deja) return deja;
    if (enCours.has(table)) throw new Error(`références en boucle autour de ${table}`);
    enCours.add(table);
    const sources: string[] = [];
    for (const l of cat.liens.filter((x) => x.vers === table && x.de !== table)) {
      const c = CLASSEMENT[l.de];
      const selections: string[] = [];
      if (c?.classe === 'entreprise') selections.push(entreprise.get(l.de) ?? '');
      if (c?.classe === 'reference' || (c?.classe === 'entreprise' && c.aussiReference)) selections.push(selectionReference(l.de));
      for (const s of selections) sources.push(`select ${l.colonnes.map(q).join(', ')} from (${s}) s`);
    }
    const cle = cat.cles.get(table) ?? [];
    const c = CLASSEMENT[table];
    let sel = sources.length
      ? `select * from ${qt(table)} where (${cle.map(q).join(', ')}) in (${sources.join(' union ')})`
      : `select * from ${qt(table)} where false`;
    // « is not true » et non « not (…) » : un membre du cabinet a une entreprise vide, et « not
    // (vide = X) » ne vaut ni vrai ni faux.
    if (c?.classe === 'entreprise') sel += ` and (${c.condition ?? 'entreprise = $1'}) is not true`;
    enCours.delete(table);
    references.set(table, sel);
    return sel;
  };
  for (const table of [...Object.keys(CLASSEMENT)].sort()) {
    const c = CLASSEMENT[table];
    const toutes = (cat.colonnes.get(table) ?? []).map((x) => x.nom);
    if (c?.classe === 'entreprise') {
      res.push({ table, role: 'entreprise', selection: entreprise.get(table) ?? '', colonnes: toutes });
      if (c.aussiReference) res.push({ table, role: 'reference', selection: selectionReference(table), colonnes: toutes });
    } else if (c?.classe === 'reference') {
      res.push({ table, role: 'reference', selection: selectionReference(table), colonnes: c.colonnes ?? toutes });
    }
  }
  return res;
}

export type EnTete = {
  format: string; version: number; entreprise: string; raisonSociale: string; exporteLe: string;
  migrations: { numero: number; empreinte: string }[]; aReprendre: number;
};
type LigneTable = { table: string; role: 'entreprise' | 'reference'; lignes: number };
type Fin = { fin: true; empreinte: string };

// L'export, dans une photographie cohérente de la base (une seule transaction en lecture).
export async function exporter(client: pg.ClientBase, entreprise: string): Promise<string[]> {
  await client.query('begin isolation level repeatable read read only');
  try {
    const cat = await lireCatalogue(client);
    const manquantes = cat.tables.filter((t) => !(t in CLASSEMENT));
    if (manquantes.length) throw new Error(`table non classée pour l'export : ${manquantes.join(', ')} (base/entreprise.ts, CLASSEMENT)`);
    const e = (await client.query('select raison_sociale from socle.entreprise where id = $1', [entreprise])).rows[0];
    if (!e) throw new Error(`entreprise introuvable : ${entreprise}`);
    const migrations = (await client.query('select numero, empreinte from socle.migration order by numero')).rows;
    const aReprendre = (await client.query(`select count(*)::int n from socle.operation
      where entreprise = $1 and statut <> 'acceptee' and resolue_le is null`, [entreprise])).rows[0].n as number;
    const enTete: EnTete = {
      format: FORMAT, version: VERSION, entreprise, raisonSociale: e.raison_sociale, exporteLe: new Date().toISOString(), migrations, aReprendre,
    };
    const lignes = [JSON.stringify(enTete)];
    for (const p of parties(cat)) {
      const cle = cat.cles.get(p.table) ?? [];
      const ordre = cle.length ? cle.map((k) => `t.${q(k)}`).join(', ') : 't::text';
      // Toutes les colonnes : la ligne entière ; une référence : ses seules colonnes dites.
      const toutes = (cat.colonnes.get(p.table) ?? []).length === p.colonnes.length;
      const projection = toutes ? 'to_jsonb(t)' : `jsonb_build_object(${p.colonnes.map((k) => `'${k}', t.${q(k)}`).join(', ')})`;
      const texte = `select count(*)::int n, coalesce(jsonb_agg(${projection} order by ${ordre}), '[]')::text lignes from (${p.selection}) t`;
      const r = (await client.query(texte, parametres(texte, entreprise))).rows[0];
      const entete: LigneTable = { table: p.table, role: p.role, lignes: r.n };
      lignes.push(JSON.stringify(entete), r.lignes);
    }
    const fin: Fin = { fin: true, empreinte: empreinte(lignes) };
    lignes.push(JSON.stringify(fin));
    await client.query('commit');
    return lignes;
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

// Une requête reçoit l'entreprise seulement si elle la demande ($1).
const parametres = (texte: string, entreprise: string) => (texte.includes('$1') ? [entreprise] : []);

const empreinte = (lignes: string[]) => createHash('sha256').update(lignes.join('\n'), 'utf8').digest('hex');

export type Bilan = { entreprise: string; tables: { table: string; role: string; lignes: number }[]; aReprendre: number };

// La restauration, dans une base où l'entreprise n'est PAS (la remise en place par-dessus une
// entreprise abîmée viendra avec son propre geste, tracé). Tout ou rien : une seule transaction.
export async function restaurer(client: pg.ClientBase, lignes: string[]): Promise<Bilan> {
  const derniere = lignes.at(-1);
  const fin = derniere ? (JSON.parse(derniere) as Partial<Fin>) : {};
  if (fin.fin !== true || fin.empreinte !== empreinte(lignes.slice(0, -1))) {
    throw new Error('fichier d\'export coupé ou abîmé : son empreinte ne correspond pas');
  }
  const enTete = JSON.parse(lignes[0] ?? '{}') as EnTete;
  if (enTete.format !== FORMAT || enTete.version !== VERSION) throw new Error(`format inconnu : ${enTete.format} ${enTete.version}`);
  await client.query('begin');
  try {
    const ici = (await client.query('select numero, empreinte from socle.migration order by numero')).rows;
    if (JSON.stringify(ici) !== JSON.stringify(enTete.migrations)) {
      throw new Error('la base cible n\'a pas les mêmes migrations que la base d\'origine : mets-la au même niveau avant de restaurer');
    }
    if ((await client.query('select 1 from socle.entreprise where id = $1', [enTete.entreprise])).rowCount) {
      throw new Error('cette entreprise existe déjà dans la base cible : rien n\'est écrasé');
    }
    // Les règles du métier (une facture émise ne se réécrit pas…) et les clés étrangères se taisent
    // le temps de reposer les lignes telles qu'elles étaient ; les clés sont contrôlées ensuite.
    await client.query('set local session_replication_role = replica');
    const cat = await lireCatalogue(client);
    const bilan: Bilan = { entreprise: enTete.entreprise, tables: [], aReprendre: enTete.aReprendre };
    for (let i = 1; i + 1 < lignes.length - 1; i += 2) {
      const t = JSON.parse(lignes[i] ?? '') as LigneTable;
      const c = CLASSEMENT[t.table];
      if (!c || !cat.colonnes.has(t.table)) throw new Error(`table inconnue dans le fichier : ${t.table}`);
      const colonnes = (cat.colonnes.get(t.table) ?? []).filter((x) => t.role === 'entreprise' || c.classe !== 'reference' || !c.colonnes || c.colonnes.includes(x.nom));
      const liste = colonnes.map((x) => q(x.nom)).join(', ');
      const identite = colonnes.some((x) => x.identite) ? ' overriding system value' : '';
      const r = await client.query(`insert into ${qt(t.table)} (${liste})${identite}
        select ${liste} from jsonb_populate_recordset(null::${qt(t.table)}, $1::jsonb)
        ${t.role === 'reference' ? 'on conflict do nothing' : ''}`, [lignes[i + 1]]);
      if (t.role === 'entreprise' && r.rowCount !== t.lignes) throw new Error(`${t.table} : ${t.lignes} lignes attendues, ${r.rowCount} reposées`);
      bilan.tables.push({ table: t.table, role: t.role, lignes: r.rowCount ?? 0 });
    }
    // Chaque lien d'une ligne reposée mène à une ligne qui existe (les clés étrangères, et les liens
    // de la trace).
    for (const l of cat.liens) {
      const c = CLASSEMENT[l.de];
      if (c?.classe !== 'entreprise' && c?.classe !== 'reference') continue;
      const filtre = c.classe === 'entreprise' ? `(${c.condition ?? 'entreprise = $1'})` : 'true';
      const texte = `select count(*)::int n from ${qt(l.de)} s
        where ${filtre} and ${l.colonnes.map((k) => `s.${q(k)} is not null`).join(' and ')}
          and not exists (select 1 from ${qt(l.vers)} v where ${l.colonnes.map((k, j) => `v.${q(l.versColonnes[j] ?? '')} = s.${q(k)}`).join(' and ')})`;
      const pendantes = (await client.query(texte, parametres(texte, enTete.entreprise))).rows[0].n as number;
      if (pendantes) throw new Error(`${pendantes} ligne(s) de ${l.de} désignent une ligne absente (${l.nom}) : restauration annulée`);
    }
    await client.query(`insert into socle.audit (entreprise, geste, objet_type, objet_id, apres)
      values ($1, 'socle.entreprise.restaurer', 'entreprise', $1, $2)`,
    [enTete.entreprise, JSON.stringify({ exporteLe: enTete.exporteLe, empreinte: fin.empreinte, aReprendre: enTete.aReprendre })]);
    await client.query('commit');
    return bilan;
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [geste, a, b] = process.argv.slice(2);
  const adresse = process.env.PG_ADMIN;
  if (!adresse || !((geste === 'exporter' && a && b) || (geste === 'restaurer' && a))) {
    console.error('PG_ADMIN=… node base/entreprise.ts exporter <entreprise> <fichier> | restaurer <fichier>');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: adresse });
  await client.connect();
  try {
    if (geste === 'exporter') {
      fs.writeFileSync(b ?? '', (await exporter(client, a)).join('\n') + '\n');
      console.log(`Exportée : ${b}`);
    } else {
      const bilan = await restaurer(client, fs.readFileSync(a, 'utf8').replace(/\n$/, '').split('\n'));
      for (const t of bilan.tables) console.log(`${t.table} (${t.role}) : ${t.lignes}`);
      if (bilan.aReprendre) console.log(`Attention : ${bilan.aReprendre} geste(s) « À reprendre » ouverts n'ont pas été repris.`);
    }
  } catch (e) {
    console.error(`Refusé : ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
