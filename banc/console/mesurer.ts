// Le banc de la console (audit A09 ; docs/console.md C65) : ce que coûtent la liste des clients, la fiche d'un client et
// l'accueil quand la clientèle est grande, et non plus douze entreprises d'essai. La pagination limite ce qui s'AFFICHE ;
// ce banc mesure ce qui se CALCULE.
//
// Le seuil est écrit d'avance (VISION-ARCHITECTURE.md § 6, « afficher une liste, une fiche ») : 95 % des réponses en
// moins de 300 ms côté serveur, pour chacun des trois écrans, avec 5 000 entreprises, deux millions de pièces émises sur
// l'année et cinq personnes de l'équipe qui travaillent en même temps (le volume : C65, décidé par délégation le
// 19/10/2026). Une mesure qui dépasse change le code, pas le seuil.
//
// Tout se passe dans une base À PART, créée et détruite par le banc (jamais la base des essais à la main, jamais une base
// avec de vraies données) ; tout y est inventé. BANC_GARDER=1 la garde après la mesure, pour chercher où le temps passe.
//
//   PG_ADMIN=postgres://postgres@127.0.0.1:5433/postgres node banc/console/mesurer.ts [entreprises] [pièces par entreprise] [tours]
//
// Sortie : le temps de la préparation, puis, par écran, le nombre de réponses, la médiane, le 95e centile et la plus
// lente ; code 0 si le seuil tient partout, 1 sinon.

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { migrer } from '../../base/migrer.ts';
import { FRAIS_MS } from '../../serveur/console/instantane.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

// Le seuil et le volume, écrits d'avance (C65).
export const SEUIL_MS = 300;
export const VOLUME = { entreprises: 5000, piecesParEntreprise: 400, sessions: 5, tours: 12 };

const BASE = 'skanfact_banc_console';
const COMPTE = 'skanfact_banc_console_serveur';
const MDP = 'Un-bon-mot-de-passe';

export type Mesure = { ecran: string; n: number; mediane: number; p95: number; max: number; refus: number };

const centile = (t: readonly number[], p: number) => {
  const s = [...t].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] ?? 0 : 0;
};

function adresse(modele: string, base: string, compte?: { nom: string; mdp: string }) {
  const u = new URL(modele);
  u.pathname = '/' + base;
  if (compte) { u.username = compte.nom; u.password = compte.mdp; }
  return u.toString();
}

// La base du banc : neuve, migrée, avec le compte du serveur (comme tests/preparer-base.ts).
async function preparerBase(admin: string) {
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
  try { await migrer(adresse(admin, BASE)); } finally { await c.query('select pg_advisory_unlock(20260929)'); await c.end(); }
  const m = new pg.Client({ connectionString: adresse(admin, BASE) });
  await m.connect();
  await m.query(`grant skanfact_app to ${COMPTE}`);
  await m.end();
  return { pgAdmin: adresse(admin, BASE), pgApp: adresse(admin, BASE, { nom: COMPTE, mdp }) };
}

// La clientèle inventée : chaque entreprise naît par la fonction de l'application (sa propriétaire, son siège, son
// abonnement, son numéro de client), dans tous les états d'abonnement ; puis ses pièces émises sur l'année, ses demandes
// au support, et des cabinets.
async function garnir(pgAdmin: string, n: number, pieces: number) {
  const c = new pg.Client({ connectionString: pgAdmin });
  await c.connect();
  const villes = ['Tunis', 'Sfax', 'Sousse', 'Nabeul', 'Bizerte', 'Gabès', 'Monastir', 'Kairouan', 'Ariana', 'Ben Arous'];
  await c.query(`do $$ declare u uuid; e uuid; villes text := '${villes.join(',')}'; begin
      for i in 1..${n} loop
        insert into socle.utilisateur (email, nom) values ('banc-' || i || '@exemple.tn', 'Propriétaire ' || i) returning id into u;
        perform set_config('app.utilisateur', u::text, true);
        e := socle.creer_entreprise('Entreprise du banc ' || i);
        perform socle.poser_ville(e, (string_to_array(villes, ','))[1 + i % 10]);
      end loop;
      for i in 1..${Math.max(1, Math.round(n / 125))} loop
        insert into socle.utilisateur (email, nom) values ('banc-cabinet-' || i || '@exemple.tn', 'Associé ' || i) returning id into u;
        perform set_config('app.utilisateur', u::text, true);
        perform socle.creer_cabinet('Cabinet du banc ' || i);
      end loop;
    end $$`);
  // Les états d'abonnement, mêlés comme une vraie clientèle : des essais en cours et finis, des abonnés à l'année et au
  // mois (certains en retard de quelques jours), des résiliations à venir, des suspendus.
  await c.query(`with x as (select entreprise, row_number() over (order by entreprise) k from plateforme.abonnement)
    update plateforme.abonnement a set
      essai_jusqu_au = case when x.k % 20 < 3 then current_date + (x.k % 25)::int when x.k % 20 = 3 then current_date - (x.k % 40)::int else current_date - 400 end,
      paye_jusqu_au = case when x.k % 20 < 4 then null when x.k % 20 < 12 then current_date + (x.k % 300)::int else current_date + (x.k % 30)::int - 3 end,
      offre = case when x.k % 20 < 4 then null when x.k % 3 = 0 then 'complet' else 'essentiel' end,
      periodicite = case when x.k % 20 < 4 then null when x.k % 20 < 12 then 'annuel' else 'mensuel' end,
      resilie_le = case when x.k % 20 = 18 then current_date + 10 end,
      suspendu_le = case when x.k % 20 = 19 then current_date - 5 end
    from x where x.entreprise = a.entreprise`);
  // Les pièces émises, chargées en bloc (le banc mesure la LECTURE : la chaîne d'empreintes de chaque pièce n'est pas ce
  // qu'il regarde) : un client par entreprise, puis ses factures réparties sur l'année, plus ou moins nombreuses.
  await c.query(`insert into socle.tiers (entreprise, raison_sociale) select id, 'Client de ' || raison_sociale from socle.entreprise`);
  await c.query('set session_replication_role = replica');
  await c.query(`insert into ventes.piece (entreprise, type, statut, tiers, date_piece, cree_par, emise_le, emise_par, numero, numero_texte, copie, empreinte, total_ht, net_ht, total_ttc, net_a_payer)
    select e.id, 'facture', 'emise', t.id, (now() - (g * 365.0 / q.k) * interval '1 day')::date, m.utilisateur, now() - (g * 365.0 / q.k) * interval '1 day', m.utilisateur,
           g, 'F' || g, '{}'::jsonb, md5(e.id::text || g), 100000, 100000, 119000, 119000
      from socle.entreprise e
      join socle.tiers t on t.entreprise = e.id
      join socle.membre m on m.entreprise = e.id
      cross join lateral (select greatest(1, (${pieces} * (0.2 + (abs(hashtext(e.id::text)) % 160) / 100.0))::int) k) q
      cross join lateral generate_series(1, q.k) g
     where not e.essai`);
  await c.query('set session_replication_role = origin');
  // Des demandes au support ouvertes (une entreprise sur quinze), quelques-unes depuis plus d'un jour.
  await c.query(`insert into plateforme.demande_support (entreprise, demandeur, canal, sujet, ouverte_le)
    select m.entreprise, m.utilisateur, 'application', 'Une question sur ma facture', now() - (row_number() over ()) % 72 * interval '1 hour'
      from socle.membre m where abs(hashtext(m.entreprise::text)) % 15 = 0`);
  await c.query('analyze');
  const compte = (await c.query(`select (select count(*) from socle.entreprise)::int e, (select count(*) from ventes.piece)::int p,
    (select count(*) from plateforme.demande_support)::int d`)).rows[0] as { e: number; p: number; d: number };
  await c.end();
  return compte;
}

// Une personne de l'équipe, en session de la console : le mot de passe, puis le code du téléphone (comme l'entrée).
async function sessionConsole(adresseServeur: string, pgAdmin: string, i: number) {
  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${adresseServeur}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const lu = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new Error(`${methode} ${chemin} : ${r.status}`);
    return lu;
  };
  const email = `banc-equipe-${i}@exemple.tn`;
  await api('POST', '/inscription', undefined, { email, nom: `Équipe ${i}`, motDePasse: MDP });
  const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Banc', type: 'navigateur' } })).jeton);
  const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).adresseApplication))?.[1] ?? '';
  const c = new pg.Client({ connectionString: pgAdmin });
  await c.connect();
  await ajouterALEquipe(c, email, 'direction', 'banc de la console');
  await c.end();
  const r = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Banc', type: 'navigateur' } });
  return String((await api('POST', '/console/connexion/code', undefined, { defi: r.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).jeton);
}

export async function mesurer(admin: string, volume = VOLUME): Promise<{ mesures: Mesure[]; tient: boolean; garni: { e: number; p: number; d: number }; preparation: number }> {
  const debut = performance.now();
  const { pgAdmin, pgApp } = await preparerBase(admin);
  const garni = await garnir(pgAdmin, volume.entreprises, volume.piecesParEntreprise);
  const preparation = performance.now() - debut;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'banc-console-'));
  const veille = path.join(dossier, 'veille.json');
  fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
  const serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: pgApp, SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille,
    // Le calcul partagé de la liste, réglé comme en service (un essai l'éteint par défaut).
    SKANFACT_CONSOLE_FRAIS_MS: String(FRAIS_MS) }), port: 0 });
  try {
    const jetons: string[] = [];
    for (let i = 1; i <= volume.sessions; i += 1) jetons.push(await sessionConsole(serveur.adresse, pgAdmin, i));
    const c = new pg.Client({ connectionString: pgAdmin });
    await c.connect();
    const ids = (await c.query('select id from socle.entreprise order by id')).rows.map((r) => String(r.id));
    await c.end();
    // Ce que fait une personne de l'équipe : la liste (en entier, cherchée, filtrée, la page suivante), une fiche, l'accueil.
    const gestes = (k: number): [string, string][] => [
      ['liste', '/console/entreprises'],
      ['liste', `/console/entreprises?q=${encodeURIComponent(`banc ${k % 900}`)}`],
      ['liste', '/console/entreprises?vue=essais'],
      ['liste', '/console/entreprises?debut=50'],
      ['fiche', `/console/entreprises/${ids[(k * 7919) % ids.length] ?? ''}`],
      ['accueil', '/console/accueil'],
    ];
    const temps = new Map<string, number[]>();
    let refus = new Map<string, number>();
    const dits = new Set<string>();
    const appeler = async (jeton: string, ecran: string, chemin: string, garder: boolean) => {
      const t0 = performance.now();
      const r = await fetch(`${serveur.adresse}/v1${chemin}`, { headers: { authorization: `Bearer ${jeton}` } });
      const corps = await r.text();
      const t = performance.now() - t0;
      // Le premier refus de chaque écran se dit : un banc qui ne mesure que des erreurs doit dire lesquelles.
      if (!r.ok && !dits.has(ecran)) { dits.add(ecran); console.error(`${ecran} refusé : ${r.status} ${corps.slice(0, 300)}`); }
      if (!garder) return;
      if (!r.ok) refus.set(ecran, (refus.get(ecran) ?? 0) + 1);
      else temps.set(ecran, [...(temps.get(ecran) ?? []), t]);
    };
    // Un tour pour chauffer (le premier plan d'une requête ne dit rien du service), puis la mesure, tous en même temps.
    for (const [ecran, chemin] of gestes(0)) await appeler(jetons[0] ?? '', ecran, chemin, false);
    refus = new Map();
    await Promise.all(jetons.map(async (jeton, s) => {
      for (let tour = 0; tour < volume.tours; tour += 1) {
        for (const [ecran, chemin] of gestes(s * volume.tours + tour)) await appeler(jeton, ecran, chemin, true);
      }
    }));
    const mesures = ['liste', 'fiche', 'accueil'].map((ecran) => {
      const t = temps.get(ecran) ?? [];
      return { ecran, n: t.length, mediane: centile(t, 0.5), p95: centile(t, 0.95), max: Math.max(0, ...t), refus: refus.get(ecran) ?? 0 };
    });
    // Un écran qui n'a rien mesuré, ou qui a refusé, ne « tient » pas : il n'a rien prouvé.
    return { mesures, garni, preparation, tient: mesures.every((m) => m.n > 0 && m.refus === 0 && m.p95 < SEUIL_MS) };
  } finally {
    await serveur.arreter();
    fs.rmSync(dossier, { recursive: true, force: true });
    // BANC_GARDER=1 : la base reste, pour chercher où le temps passe (psql, explain) ; le banc suivant la refait.
    if (process.env.BANC_GARDER !== '1') {
      const c = new pg.Client({ connectionString: admin });
      await c.connect();
      await c.query(`drop database if exists ${BASE} with (force)`);
      await c.end();
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const admin = process.env.PG_ADMIN;
  if (!admin) { console.error('PG_ADMIN manque : l\'adresse d\'un compte d\'administration PostgreSQL'); process.exit(2); }
  const volume = { ...VOLUME, entreprises: Number(process.argv[2] ?? VOLUME.entreprises), piecesParEntreprise: Number(process.argv[3] ?? VOLUME.piecesParEntreprise),
    tours: Number(process.argv[4] ?? VOLUME.tours) };
  const r = await mesurer(admin, volume);
  const ms = (x: number) => `${Math.round(x)} ms`;
  console.log(`préparé en ${Math.round(r.preparation / 1000)} s : ${r.garni.e} entreprises, ${r.garni.p} pièces, ${r.garni.d} demandes au support ; ${volume.sessions} sessions en même temps`);
  for (const m of r.mesures) {
    console.log(`${m.ecran.padEnd(8)} ${String(m.n).padStart(4)} réponses  médiane ${ms(m.mediane).padStart(8)}  95 % ${ms(m.p95).padStart(8)}  max ${ms(m.max).padStart(8)}${m.refus ? `  ${m.refus} refusées` : ''}${m.p95 < SEUIL_MS && !m.refus ? '' : '  ← AU-DELÀ'}`);
  }
  console.log(r.tient ? `Le seuil tient : 95 % des réponses en moins de ${SEUIL_MS} ms.` : `Le seuil ne tient pas (${SEUIL_MS} ms pour 95 % des réponses).`);
  process.exit(r.tient ? 0 : 1);
}
