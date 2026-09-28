// Les clés de l'API (03 § 8, 14 § 2.5) : une clé se traite comme une personne. Elle ne se montre
// qu'une fois, ne voit que son entreprise, ne fait que ses gestes (jamais ceux qui gouvernent
// l'entreprise, jamais un droit que son créateur n'a pas), laisse sa trace, expire et se révoque.
// Et la documentation de l'API est écrite depuis les routes elles-mêmes.

import { createHash } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { declarerTextes } from '../../textes/index.ts';
import { creerApp, documentation, VERSION, type Route } from '../../serveur/app.ts';
import { creerPool, enTantQue, enTantQueCle } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { declarerGestes } from '../../serveur/porte/gestes.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const poolUnique = new pg.Pool({ connectionString: inject('pgApp'), max: 1 });
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;
let routes: Route<never>[] = [];

type Reponse = { statut: number; corps: Record<string, unknown> & { motif?: string } };
async function appeler(methode: 'GET' | 'POST' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string) {
  const email = `cle-${prenom}${++n}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } });
  const jeton = String(c.corps.jeton);
  return { email, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id) };
}
async function entreprise(proprio: { jeton: string }, nom: string) {
  const ent = String((await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: nom })).corps.id);
  await appeler('POST', '/moi/code', proprio.jeton, { methode: 'application' });
  const client = String((await appeler('POST', `/entreprises/${ent}/clients`, proprio.jeton, { raisonSociale: `Client de ${nom}` })).corps.id);
  return { ent, client };
}
const dansUnAn = (jours = 90) => new Date(Date.now() + jours * 86_400_000).toISOString().slice(0, 10);
const GESTES_VENTE = ['ventes.pieces.voir', 'ventes.brouillon.modifier', 'ventes.client.modifier'];

let proprio: Awaited<ReturnType<typeof personne>>;
let A: Awaited<ReturnType<typeof entreprise>>;
let C: Awaited<ReturnType<typeof entreprise>>;
let B: Awaited<ReturnType<typeof entreprise>>;

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  // Un geste d'essai que seul le propriétaire peut faire (pas l'administrateur).
  declarerTextes({ 'geste.essai.cle.reserve': 'faire le geste réservé d\'essai' });
  declarerGestes([{ code: 'essai.cle.reserve', module: 'essai', ecrit: true, roles: { proprietaire: 'oui' } }]);
  routes = [...routesSocle(ctx), ...routesVentes(ctx)];
  app = creerApp(ctx, routes);
  await app.ready();
  proprio = await personne('proprio');
  A = await entreprise(proprio, 'Menuiserie A');
  // Le même propriétaire a une seconde entreprise : sa clé de A n'y voit rien pour autant.
  C = await entreprise(proprio, 'Menuiserie C');
  B = await entreprise(await personne('voisin'), 'La voisine');
  await admin.query(`insert into socle.serie (entreprise, type, prefixe, legale) values ($1, 'facture', 'FAC', true)`, [A.ent]);
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); await poolUnique.end(); });

async function creerCle(gestes = GESTES_VENTE, jeton = proprio.jeton, ent = A.ent) {
  return appeler('POST', `/entreprises/${ent}/cles-api`, jeton, { nom: 'Boutique en ligne', gestes, expireLe: dansUnAn() });
}

describe('les clés de l\'API', () => {
  it('une clé ne se montre qu\'une fois : la base n\'en garde que l\'empreinte, que le serveur ne peut pas lire', async () => {
    const r = await creerCle();
    expect(r.statut).toBe(201);
    const cle = String(r.corps.cle);
    expect(cle).toMatch(/^skf_[A-Za-z0-9_-]{43}$/);
    const liste = (await appeler('GET', `/entreprises/${A.ent}/cles-api`, proprio.jeton)).corps.cles as Record<string, unknown>[];
    const lue = liste.find((c) => c.id === r.corps.id);
    expect(lue).toMatchObject({ prefixe: cle.slice(0, 10), gestes: [...GESTES_VENTE].sort() });
    expect(JSON.stringify(liste)).not.toContain(cle);
    expect(lue).not.toHaveProperty('empreinte');
    expect((await admin.query('select empreinte from socle.cle_api where id = $1', [r.corps.id])).rows)
      .toEqual([{ empreinte: createHash('sha256').update(cle).digest('hex') }]);
    await expect(pool.query('select empreinte from socle.cle_api')).rejects.toThrow(/permission denied/);
  });

  it('une clé fait ses gestes dans son entreprise, au nom de son créateur, et sa trace porte la clé', async () => {
    const r = await creerCle();
    const cle = String(r.corps.cle);
    const client = await appeler('POST', `/entreprises/${A.ent}/clients`, cle, { raisonSociale: 'Venu par l\'API' });
    expect(client.statut).toBe(201);
    const piece = await appeler('POST', `/entreprises/${A.ent}/ventes`, cle, { type: 'facture', tiers: client.corps.id, datePiece: '2026-10-01', lignes: [{ designation: 'Porte', quantite: '1', prixUnitaire: '100', tauxTva: '19' }] });
    expect(piece.statut).toBe(201);
    expect((await admin.query('select cree_par from ventes.piece where id = $1', [piece.corps.id])).rows).toEqual([{ cree_par: proprio.id }]);
    expect((await admin.query(`select utilisateur, cle_api from socle.audit where objet_id = $1 and geste = 'ventes.client.creer'`, [client.corps.id])).rows)
      .toEqual([{ utilisateur: null, cle_api: r.corps.id }]);
    // Hors de sa liste : refusé, en le disant.
    const emettre = await appeler('POST', `/entreprises/${A.ent}/ventes/${piece.corps.id}/emettre`, cle);
    expect(emettre).toMatchObject({ statut: 403, corps: { motif: 'Cette clé de l\'API ne permet pas d\'émettre une facture.' } });
    // Une clé n'est pas une personne : son compte ne la regarde pas.
    expect(await appeler('GET', '/moi', cle)).toMatchObject({ statut: 403, corps: { motif: 'Une clé de l\'API n\'agit pas pour une personne : ce geste lui est fermé.' } });
    // Ni la voisine, ni l'autre entreprise de son créateur : elles n'existent pas pour elle.
    expect((await appeler('GET', `/entreprises/${B.ent}/clients`, cle)).statut).toBe(404);
    expect((await appeler('GET', `/entreprises/${C.ent}/clients`, cle)).statut).toBe(404);
  });

  it('la clé d\'une entreprise ne lit rien d\'une autre, par aucune table qui porte une entreprise', async () => {
    const id = String((await creerCle()).corps.id);
    const tables = (await admin.query(`select distinct n.nspname || '.' || c.relname t from pg_attribute a
      join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where a.attname = 'entreprise' and c.relkind in ('r', 'p') and not c.relispartition and n.nspname !~ '^pg_' order by 1`)).rows.map((r) => r.t as string);
    let vues = 0;
    for (const t of tables) {
      const [ailleurs, chezSoi] = await enTantQueCle(pool, id, async (tx) => {
        const compter = async (ent: string) => {
          await tx.query('savepoint lecture');
          try {
            return (await tx.query(`select count(*)::int n from ${t} where entreprise = $1`, [ent])).rows[0].n as number;
          } catch (e) {
            if ((e as { code?: string }).code !== '42501') throw e;
            await tx.query('rollback to savepoint lecture');
            return 0;
          }
        };
        return [await compter(B.ent) + await compter(C.ent), await compter(A.ent)];
      });
      expect(ailleurs, t).toBe(0);
      if ((chezSoi ?? 0) > 0) vues++;
    }
    // Sur un univers non vide : la clé voit bien des lignes de SON entreprise.
    expect(vues).toBeGreaterThanOrEqual(2);
  });

  it('révoquée ou expirée, une clé ne sert plus à rien, ni par le serveur ni dans la base', async () => {
    const r = await creerCle();
    const cle = String(r.corps.cle);
    const voit = () => enTantQueCle(pool, String(r.corps.id), async (tx) => (await tx.query('select id from socle.entreprise')).rows.length);
    expect((await appeler('GET', `/entreprises/${A.ent}/clients`, cle)).statut).toBe(200);
    expect(await voit()).toBe(1);
    expect((await appeler('DELETE', `/entreprises/${A.ent}/cles-api/${r.corps.id}`, proprio.jeton)).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${A.ent}/clients`, cle)).statut).toBe(401);
    expect(await voit()).toBe(0);
    expect((await appeler('DELETE', `/entreprises/${A.ent}/cles-api/${r.corps.id}`, proprio.jeton)).corps.motif).toBe('Cette clé est déjà révoquée.');

    const e = await creerCle();
    await admin.query(`update socle.cle_api set cree_le = now() - interval '2 days', expire_le = now() - interval '1 second' where id = $1`, [e.corps.id]);
    expect((await appeler('GET', `/entreprises/${A.ent}/clients`, String(e.corps.cle))).statut).toBe(401);
    expect(await enTantQueCle(pool, String(e.corps.id), async (tx) => (await tx.query('select id from socle.entreprise')).rows.length)).toBe(0);
  });

  it('personne ne donne à une clé un droit qu\'il n\'a pas, ni ce qui gouverne l\'entreprise ; elle expire dans l\'année', async () => {
    const adminA = await personne('admin');
    const invitation = String((await appeler('POST', `/entreprises/${A.ent}/invitations`, proprio.jeton, { email: adminA.email, roles: ['administrateur'] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', adminA.jeton, { jeton: invitation });
    await appeler('POST', '/moi/code', adminA.jeton, { methode: 'application' });
    expect((await creerCle(GESTES_VENTE, adminA.jeton)).statut).toBe(201);
    expect(await creerCle(['essai.cle.reserve'], adminA.jeton)).toMatchObject({ statut: 403, corps: { motif: 'Tu ne peux pas donner à une clé le geste essai.cle.reserve : ton rôle ne le permet pas.' } });
    expect(await creerCle(['socle.equipe.gerer'])).toMatchObject({ statut: 403, corps: { motif: 'Le geste socle.equipe.gerer ne se donne jamais à une clé de l\'API.' } });
    expect(await creerCle(['socle.cles_api.gerer'])).toMatchObject({ statut: 403 });
    const commercial = await personne('commercial');
    const inv2 = String((await appeler('POST', `/entreprises/${A.ent}/invitations`, proprio.jeton, { email: commercial.email, roles: ['commercial'] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', commercial.jeton, { jeton: inv2 });
    expect((await creerCle(GESTES_VENTE, commercial.jeton)).statut).toBe(403);
    // Même en lisant la base directement, un commercial ne voit pas les clés de son entreprise.
    expect(await enTantQue(pool, commercial.id, async (tx) => (await tx.query('select count(*)::int n from socle.cle_api where entreprise = $1', [A.ent])).rows[0].n)).toBe(0);
    expect(await enTantQue(pool, proprio.id, async (tx) => (await tx.query('select count(*)::int n from socle.cle_api where entreprise = $1', [A.ent])).rows[0].n)).toBeGreaterThan(0);
    const tropLoin = await appeler('POST', `/entreprises/${A.ent}/cles-api`, proprio.jeton, { nom: 'X', gestes: GESTES_VENTE, expireLe: dansUnAn(400) });
    expect(tropLoin).toMatchObject({ statut: 403, corps: { motif: 'Une clé expire dans l\'année : entre demain et 366 jours.' } });
  });

  it('une connexion rendue au pool ne garde jamais la clé précédente', async () => {
    const id = String((await creerCle()).corps.id);
    expect(await enTantQueCle(poolUnique, id, async (tx) => (await tx.query('select count(*)::int n from socle.entreprise')).rows[0].n)).toBe(1);
    expect((await poolUnique.query('select count(*)::int n from socle.entreprise')).rows[0].n).toBe(0);
  });
});

describe('la documentation de l\'API', () => {
  it('décrit chaque route depuis le code : son chemin, son geste, ce qu\'il fait, et le corps attendu', async () => {
    const r = await app.inject({ method: 'GET', url: `${VERSION}/documentation` });
    expect(r.statusCode).toBe(200);
    const doc = r.json() as { openapi: string; paths: Record<string, Record<string, { 'x-geste': string; summary: string; requestBody?: unknown }>> };
    expect(doc).toEqual(JSON.parse(JSON.stringify(documentation(routes))));
    expect(doc.openapi).toBe('3.1.0');
    for (const route of routes) {
      const op = doc.paths[VERSION + route.chemin.replace(/:([a-z_]+)/g, '{$1}')]?.[route.methode.toLowerCase()];
      expect(op, `${route.methode} ${route.chemin}`).toBeDefined();
      expect(op?.['x-geste']).toBe(route.geste);
      expect(Boolean(op?.requestBody), `${route.methode} ${route.chemin}`).toBe(Boolean(route.corps));
    }
    expect(doc.paths[`${VERSION}/entreprises/{entreprise}/ventes/{piece}/emettre`]?.post?.summary).toBe('émettre une facture');
    expect(JSON.stringify(doc.paths[`${VERSION}/entreprises/{entreprise}/ventes`]?.post?.requestBody)).toContain('prixUnitaire');
  });
});
