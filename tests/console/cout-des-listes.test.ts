// Le coût des listes de la console (l'audit 1.42.0 A09 ; base 0141 ; docs/console.md C65 ; banc/console/mesurer.ts) :
//   - le compte des pièces d'une entreprise se tient à jour à chaque pièce qui naît ou s'en va, et dit toujours ce que son
//     recompte dit (deux chemins, un chiffre) ;
//   - « émise ce mois », « sur trente jours » se cherchent par des instants : le jour reste celui du fuseau de l'entreprise,
//     au bord de minuit comme ailleurs (le même compte que la règle d'avant, écrite par des jours) ;
//   - la liste se calcule une fois pour l'équipe : elle sert une minute, dit de quand elle date, se refait sur « Actualiser »
//     et après un geste de la console ; la fiche, elle, se lit toujours à l'instant ; la technique ne lit jamais la liste.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
let horloge = new Date();
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => horloge };
// Deux serveurs sur la même base : l'un partage la liste une minute (comme en service), l'autre jamais (comme un essai).
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string) {
  const email = `cout-${prenom}${++n}-${Date.now()}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: MDP });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  return { email, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id) };
}
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const p = await personne(prenom);
  const qui = await quiEst(ctx, p.jeton);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, p.email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email: p.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const c = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), horloge.getTime()) });
  expect(c.corps.etat, JSON.stringify(c.corps)).toBe('connecte');
  return { ...p, console: String(c.corps.jeton) };
}
async function entreprise(nom: string) {
  const p = await personne('proprio');
  const cree = await appeler('POST', '/entreprises', p.jeton, { raisonSociale: nom });
  expect(cree.statut, JSON.stringify(cree.corps)).toBe(201);
  return { ent: String(cree.corps.id), proprio: p };
}

let direction: Awaited<ReturnType<typeof membre>>;
let support: Awaited<ReturnType<typeof membre>>;
let technique: Awaited<ReturnType<typeof membre>>;

beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille: null, consoleFraisMs: 60_000 })]);
  await app.ready();
  direction = await membre('direction', 'direction');
  support = await membre('support', 'support');
  technique = await membre('technique', 'technique');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

const compte = async (ent: string) => (await admin.query('select coalesce((select n from socle.compte_pieces where entreprise = $1), 0)::int n, plateforme.pieces_creees($1)::int recompte', [ent])).rows[0] as { n: number; recompte: number };

describe('le compte des pièces se tient à jour (0141)', () => {
  it('une pièce qui naît ou s\'en va le change ; une reprise de la v10, un objet du dossier qui n\'est pas une pièce, non ; il dit toujours son recompte', async () => {
    const a = await entreprise('Compte Tenu A'), b = await entreprise('Compte Tenu B');
    const tiers = async (ent: string) => String((await admin.query(`insert into socle.tiers (entreprise, raison_sociale) values ($1, 'Client') returning id`, [ent])).rows[0].id);
    const ta = await tiers(a.ent), tb = await tiers(b.ent);
    expect(await compte(a.ent)).toEqual({ n: 0, recompte: 0 });
    // Une instruction, deux entreprises : chacune son compte. Une pièce reprise de la v10 (ref_v10) est déjà comptée dans son dossier.
    await admin.query(`insert into ventes.piece (entreprise, type, tiers, date_piece, cree_par, ref_v10) values
      ($1, 'facture', $2, current_date, $3, null), ($1, 'devis', $2, current_date, $3, null), ($1, 'facture', $2, current_date, $3, 'v10-1'),
      ($4, 'facture', $5, current_date, $6, null)`, [a.ent, ta, a.proprio.id, b.ent, tb, b.proprio.id]);
    await admin.query(`insert into socle.dossier_v10 (entreprise, collection, cle, contenu) values ($1, 'documents', 'd1', '{}'), ($1, 'purchases', 'p1', '{}'),
      ($1, 'clients', 'c1', '{}')`, [a.ent]);
    await admin.query(`insert into achats.piece (entreprise, nature, date_piece, tva_recuperable, total_ht, total_tva, tva_deductible, total_ttc, retenue, net_a_payer, cree_par)
      values ($1, 'facture', current_date, true, 1000, 190, 190, 1190, 0, 1190, $2)`, [a.ent, a.proprio.id]);
    expect(await compte(a.ent)).toEqual({ n: 5, recompte: 5 });
    expect(await compte(b.ent)).toEqual({ n: 1, recompte: 1 });
    // Elles s'en vont : le compte suit.
    await admin.query(`delete from ventes.piece where entreprise = $1 and type = 'devis'`, [a.ent]);
    await admin.query(`delete from socle.dossier_v10 where entreprise = $1 and collection in ('documents', 'clients')`, [a.ent]);
    expect(await compte(a.ent)).toEqual({ n: 3, recompte: 3 });
    // Une pièce du serveur qui devient une reprise de la v10 (et l'inverse) : son entreprise se recompte.
    await admin.query(`update ventes.piece set ref_v10 = 'v10-2' where entreprise = $1 and type = 'facture' and ref_v10 is null`, [a.ent]);
    expect(await compte(a.ent)).toEqual({ n: 2, recompte: 2 });
    // La liste et la fiche disent le même nombre, par deux chemins.
    const liste = (await appeler('GET', `/console/entreprises?q=${encodeURIComponent('Compte Tenu A')}&frais=1`, direction.console)).corps.lignes as { societes: { id: string; pieces: number }[] }[];
    expect(liste.flatMap((o) => o.societes).find((s) => s.id === a.ent)?.pieces).toBe(2);
    expect(((await appeler('GET', `/console/entreprises/${a.ent}`, direction.console)).corps.comptes as { piecesCreees: number }).piecesCreees).toBe(2);
  });
});

describe('le mois et les trente jours, dans le fuseau de l\'entreprise (0141)', () => {
  it('cherchés par des instants, ils comptent ce que la règle d\'avant comptait par des jours, au bord de minuit comme ailleurs', async () => {
    const { ent, proprio } = await entreprise('Bord De Minuit');
    const t = String((await admin.query(`insert into socle.tiers (entreprise, raison_sociale) values ($1, 'Client') returning id`, [ent])).rows[0].id);
    // Le jour J (Tunis, UTC+1) : le 19 octobre 2026. Des pièces émises de part et d'autre de chaque bord.
    // (Deux au lendemain contre une la veille du premier jour : une borne prise en UTC ne se compense jamais par l'autre.)
    const instants = ['2026-10-18T23:30:00Z', '2026-10-19T22:59:00Z', '2026-10-19T23:01:00Z', '2026-10-19T23:30:00Z', // J à 00:30 ; J à 23:59 ; J+1 à 00:01 et 00:30
      '2026-09-30T23:05:00Z', '2026-09-30T22:55:00Z', // le 1er octobre à 00:05 ; le 30 septembre à 23:55
      '2026-09-19T23:10:00Z', '2026-09-19T22:50:00Z', // J-29 à 00:10 ; J-30 à 23:50
      '2026-08-20T23:10:00Z', '2026-08-20T22:50:00Z']; // J-59 à 00:10 ; J-60 à 23:50
    await admin.query('begin');
    await admin.query('set local session_replication_role = replica');
    for (const [i, instant] of instants.entries()) {
      await admin.query(`insert into ventes.piece (entreprise, type, statut, tiers, date_piece, cree_par, emise_le, emise_par, numero, numero_texte, copie, empreinte, net_a_payer)
        values ($1, 'facture', 'emise', $2, ($3::timestamptz at time zone 'Africa/Tunis')::date, $4, $3, $4, $5, $6, '{}', $7, 1000)`, [ent, t, instant, proprio.id, i + 1, `F${i + 1}`, `empreinte-${i + 1}`]);
    }
    await admin.query('commit');
    const session = String((await admin.query('select id from plateforme.session_console where utilisateur = $1 and fermee_le is null order by ouverte_le desc limit 1', [direction.id])).rows[0].id);
    const lu = await enTantQue(pool, direction.id, async (tx) => {
      await tx.query('select set_config(\'app.session_console\', $1, true)', [session]);
      const u = (await tx.query('select plateforme.console_usage_trente($1::date, $2) v', ['2026-10-19', ent])).rows[0].v[ent];
      const p = (await tx.query('select plateforme.console_clients_en_plus($1::date, $2) v', ['2026-10-19', ent])).rows[0].v[ent];
      return { trente: u.trente, avant: u.avant, piecesMois: p.piecesMois };
    });
    // La règle d'avant (0132, 0137), écrite par des jours du fuseau de l'entreprise.
    const avant = (await admin.query(`select
        count(*) filter (where (p.emise_le at time zone e.fuseau)::date between $2::date - 29 and $2::date)::int trente,
        count(*) filter (where (p.emise_le at time zone e.fuseau)::date between $2::date - 59 and $2::date - 30)::int avant,
        count(*) filter (where (p.emise_le at time zone e.fuseau)::date between date_trunc('month', $2::date)::date and $2::date)::int "piecesMois"
      from ventes.piece p join socle.entreprise e on e.id = p.entreprise where p.entreprise = $1 and p.statut = 'emise'`, [ent, '2026-10-19'])).rows[0];
    expect(lu).toEqual(avant);
    // Et ce qu'elle compte, compté à la main : J et J à 23:59, le 1er octobre, J-29 (trente : 2 + 1 + 1 + 1) ; J-30 et J-59 (avant).
    expect(lu).toEqual({ trente: 5, avant: 2, piecesMois: 3 });
  });
});

describe('la liste, calculée une fois pour l\'équipe (C65)', () => {
  const nomDans = async (jeton: string, ent: string, q: string, frais = false) => {
    const r = await appeler('GET', `/console/entreprises?q=${encodeURIComponent(q)}${frais ? '&frais=1' : ''}`, jeton);
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    const s = (r.corps.lignes as { societes: { id: string; raisonSociale: string }[] }[]).flatMap((o) => o.societes).find((x) => x.id === ent);
    return { nom: s?.raisonSociale ?? null, calculeLe: String(r.corps.calculeLe) };
  };
  const renommer = (ent: string, nom: string) => admin.query('update socle.entreprise set raison_sociale = $2 where id = $1', [ent, nom]);

  it('elle sert une minute à toute l\'équipe et dit de quand elle date ; « Actualiser » et un geste de la console la refont ; la fiche se lit à l\'instant', async () => {
    const { ent } = await entreprise('Partagee Avant');
    const premier = await nomDans(direction.console, ent, 'Partagee', true);
    expect(premier).toEqual({ nom: 'Partagee Avant', calculeLe: horloge.toISOString() });
    // Changée hors de la console (un client qui se renomme) : la liste de la minute la dit encore comme avant, pour le
    // support aussi ; la fiche, elle, la lit déjà.
    await renommer(ent, 'Partagee Pendant');
    expect(await nomDans(support.console, ent, 'Partagee')).toEqual(premier);
    expect((await appeler('GET', `/console/entreprises/${ent}`, support.console)).corps.raisonSociale).toBe('Partagee Pendant');
    // « Actualiser » : la liste se refait.
    horloge = new Date(horloge.getTime() + 5_000);
    expect(await nomDans(support.console, ent, 'Partagee', true)).toEqual({ nom: 'Partagee Pendant', calculeLe: horloge.toISOString() });
    // Un geste de la console (une note d'appel) : la liste se refait à la lecture suivante.
    await renommer(ent, 'Partagee Apres Geste');
    expect((await nomDans(direction.console, ent, 'Partagee')).nom).toBe('Partagee Pendant');
    const note = await appeler('POST', `/console/entreprises/${ent}/appels`, support.console, { resultat: 'parle', resume: 'Elle a changé le nom de sa société.' });
    expect(note.statut, JSON.stringify(note.corps)).toBe(201);
    expect((await nomDans(direction.console, ent, 'Partagee')).nom).toBe('Partagee Apres Geste');
  });

  it('passée la minute, elle sert encore une fois et se refait à côté ; la technique ne la lit jamais, même toute prête', async () => {
    const { ent } = await entreprise('Minute Passee Avant');
    await nomDans(direction.console, ent, 'Minute Passee', true);
    await renommer(ent, 'Minute Passee Apres');
    horloge = new Date(horloge.getTime() + 61_000);
    // La réponse n'attend pas : elle rend la liste d'avant, et la nouvelle se calcule à côté, puis sert.
    expect((await nomDans(direction.console, ent, 'Minute Passee')).nom).toBe('Minute Passee Avant');
    await expect.poll(async () => (await nomDans(direction.console, ent, 'Minute Passee')).nom, { timeout: 10_000 }).toBe('Minute Passee Apres');
    // La technique : ni la liste, ni ses chiffres à l'accueil.
    expect((await appeler('GET', '/console/entreprises', technique.console)).statut).toBe(403);
    const accueil = await appeler('GET', '/console/accueil', technique.console);
    expect(accueil.statut).toBe(200);
    expect(accueil.corps.calculeLe).toBeNull();
    expect((await appeler('GET', '/console/accueil', direction.console)).corps.calculeLe).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
