// L'équipe de la console, par l'outil de l'exploitation (docs/console.md ; skanfact docs/cadrage/10-console.md § 2.10) :
// poser le PREMIER membre (personne n'est encore là pour l'ajouter depuis la console), voir l'équipe, et rendre la
// direction à quelqu'un si plus personne ne peut se connecter. Avec un compte d'administration, jamais par le serveur
// web. Ensuite, c'est la direction qui gère l'équipe, depuis la console.
//
// La personne a déjà son compte SkanFact (celui de l'application) ; la console lui demandera le code du téléphone (SMS
// ou application), à mettre en place dans Ton compte. Chaque geste demande un MOTIF et laisse sa ligne dans le journal de
// la console (plateforme.geste_console, sans auteur : l'exploitation), qu'on ne modifie ni n'efface.
//
//   PG_ADMIN=… node base/equipe.ts voir
//   PG_ADMIN=… node base/equipe.ts ajouter <adresse> <direction|support|technique> "<motif>"
//   PG_ADMIN=… node base/equipe.ts retirer <adresse> "<motif>"
//
// Sur un serveur : exploitation/equipe.sh, avec les mêmes arguments.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

type Client = pg.Client | pg.PoolClient;
export type Role = 'direction' | 'support' | 'technique';
const ROLES: readonly string[] = ['direction', 'support', 'technique'];

export type Membre = { email: string; nom: string; role: Role; actif: boolean; code: string | null };

export async function voir(client: Client): Promise<Membre[]> {
  return (await client.query(`select u.email, u.nom, e.role, e.actif, case when u.code_methode in ('sms', 'application') then u.code_methode end as code
      from plateforme.equipe e join socle.utilisateur u on u.id = e.utilisateur order by e.actif desc, e.role, u.nom`)).rows as Membre[];
}

async function personne(client: Client, email: string): Promise<string> {
  const r = (await client.query('select id from socle.utilisateur where lower(email) = lower(btrim($1))', [email])).rows[0];
  if (!r) throw new Error('aucun compte SkanFact n\'a cette adresse : la personne crée d\'abord son compte sur l\'application');
  return r.id as string;
}

// Ajouter (ou reprendre) une personne, avec son rôle.
export async function ajouter(client: Client, email: string, role: string, motif: string): Promise<void> {
  if (!ROLES.includes(role)) throw new Error('le rôle est « direction », « support » ou « technique »');
  if (motif.trim().length < 3) throw new Error('un geste sur l\'équipe demande son motif (trois caractères au moins) : il reste dans le journal');
  await client.query('begin');
  try {
    const u = await personne(client, email);
    const avant = (await client.query('select role, actif from plateforme.equipe where utilisateur = $1 for update', [u])).rows[0] as { role: string; actif: boolean } | undefined;
    if (avant?.actif && avant.role === role) throw new Error(`cette personne est déjà dans l'équipe, avec le rôle « ${role} »`);
    await client.query(`insert into plateforme.equipe (utilisateur, role) values ($1, $2)
      on conflict (utilisateur) do update set role = excluded.role, actif = true, ajoute_le = now(), retire_le = null`, [u, role]);
    await client.query(`insert into plateforme.geste_console (geste, membre, motif, avant, apres) values ($1, $2, $3, $4, $5)`,
      [avant?.actif ? 'equipe.role' : 'equipe.ajouter', u, motif.trim(), avant ? JSON.stringify(avant) : null, JSON.stringify({ role, actif: true })]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

// Retirer une personne : ses sessions de la console tombent aussitôt. L'équipe garde toujours quelqu'un à la direction.
export async function retirer(client: Client, email: string, motif: string): Promise<void> {
  if (motif.trim().length < 3) throw new Error('un geste sur l\'équipe demande son motif (trois caractères au moins) : il reste dans le journal');
  await client.query('begin');
  try {
    const u = await personne(client, email);
    const avant = (await client.query('select role from plateforme.equipe where utilisateur = $1 and actif for update', [u])).rows[0] as { role: string } | undefined;
    if (!avant) throw new Error('cette personne n\'est pas dans l\'équipe');
    const directions = Number((await client.query(`select count(*) n from plateforme.equipe where role = 'direction' and actif`)).rows[0].n);
    if (avant.role === 'direction' && directions === 1) throw new Error('l\'équipe garde toujours une personne à la direction : ajoute d\'abord quelqu\'un d\'autre');
    await client.query('update plateforme.equipe set actif = false, retire_le = now() where utilisateur = $1', [u]);
    await client.query('update plateforme.session_console set fermee_le = now() where utilisateur = $1 and fermee_le is null', [u]);
    await client.query(`insert into plateforme.geste_console (geste, membre, motif, avant, apres) values ('equipe.retirer', $1, $2, $3, $4)`,
      [u, motif.trim(), JSON.stringify({ role: avant.role, actif: true }), JSON.stringify({ role: avant.role, actif: false })]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [geste = '', ...reste] = process.argv.slice(2);
  const adresse = process.env.PG_ADMIN;
  const USAGE = 'PG_ADMIN=… node base/equipe.ts voir | ajouter <adresse> <direction|support|technique> "<motif>" | retirer <adresse> "<motif>"';
  const valable = geste === 'voir' ? reste.length === 0 : geste === 'ajouter' ? reste.length === 3 : geste === 'retirer' && reste.length === 2;
  if (!adresse || !valable) { console.error(USAGE); process.exit(1); }
  const client = new pg.Client({ connectionString: adresse });
  await client.connect();
  try {
    if (geste === 'voir') {
      const membres = await voir(client);
      if (!membres.length) console.log('Personne dans l\'équipe : pose le premier membre avec « ajouter ».');
      for (const m of membres) {
        console.log(`  ${m.actif ? '' : '(retiré) '}${m.nom} <${m.email}> : ${m.role}${m.actif && !m.code ? ' — sans code du téléphone : la console le lui demandera (Ton compte, sur l\'application)' : ''}`);
      }
    } else if (geste === 'ajouter') {
      await ajouter(client, reste[0] ?? '', reste[1] ?? '', reste[2] ?? '');
      console.log('Fait. La personne se connecte à la console avec son compte SkanFact et le code de son téléphone.');
    } else {
      await retirer(client, reste[0] ?? '', reste[1] ?? '');
      console.log('Fait. Ses sessions de la console sont fermées.');
    }
  } catch (e) {
    console.error(`Refusé : ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
