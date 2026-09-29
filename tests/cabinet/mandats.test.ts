// Le cabinet côté serveur (brique 36 ; docs/cabinet.md), par l'API. Ce que le serveur garantit :
//   - seul le propriétaire choisit son cabinet, par son code, et en fixe le périmètre (la paie
//     décochée par défaut) ; l'associé accepte ; l'un ou l'autre arrête ;
//   - le cabinet ne voit le dossier qu'une fois le mandat accepté, et plus rien après l'avoir arrêté ;
//   - le périmètre décide, à la porte et dans la base : sans la paie, pas de bulletins ;
//   - un collaborateur ne voit que les dossiers qui lui sont confiés, avec son rôle sur chacun ;
//   - avec un mandat de comptabilité, c'est le cabinet qui valide la période (03 § 2) ;
//   - le dossier tenu : un client pas encore sur SkanFact, tenu par le cabinet ;
//   - le cabinet ne fait jamais chez son client ce qui est au client (03 § 3.3).

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { declarerGestesAchats } from '../../serveur/achats/gestes.ts';
import { routesAchats } from '../../serveur/achats/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { routesCompta } from '../../serveur/compta/routes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { declarerGestesPaie } from '../../serveur/paie/gestes.ts';
import { routesPaie } from '../../serveur/paie/routes.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
async function personne(prefixe: string) {
  const email = `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: prefixe, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  return { email, jeton, utilisateur };
}
type Personne = Awaited<ReturnType<typeof personne>>;

// Un client, son entreprise, et un achat du 3 août dans ses livres.
async function client() {
  const p = await personne('client');
  const ent = String((await appeler('POST', '/entreprises', p.jeton, { raisonSociale: 'Menuiserie Ben Salah' })).corps.id);
  await appeler('GET', `/entreprises/${ent}/dossier-v10`, p.jeton);
  const envoyer = (collection: string, cle: string, contenu: unknown) =>
    appeler('POST', `/entreprises/${ent}/dossier-v10`, p.jeton, { changements: [{ collection, cle, rang: 0, revision: null, contenu }] });
  await envoyer('suppliers', 's1', { id: 's1', name: 'Papeterie du Lac' });
  await envoyer('purchases', 'a1', {
    id: 'a1', kind: 'facture', supplierId: 's1', number: 'FF-1', date: '2026-08-03', currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0,
    tvaRecuperable: true, lines: [{ label: 'Papier', qty: 1, unitPrice: 1000, vatRate: 19, destination: 'charge', deductible: true }], payments: [],
  });
  return { ...p, ent };
}
// Un cabinet, son associé, et des collaborateurs (l'équipe s'invitera à la brique 45 : ici, posée par la base).
async function cabinet() {
  const associe = await personne('associe');
  const c = await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' });
  expect(c.statut, JSON.stringify(c.corps)).toBe(201);
  const id = String(c.corps.id), code = String(c.corps.code);
  const collaborateur = async (role: string) => {
    const p = await personne(role);
    const membre = String((await admin.query(`insert into socle.membre (utilisateur, organisation, roles) values ($1, $2, $3) returning id`, [p.utilisateur, id, [role]])).rows[0].id);
    return { ...p, membre };
  };
  return { associe, id, code, collaborateur };
}
const livres = (ent: string, p: Personne) => appeler('GET', `/entreprises/${ent}/compta/ecritures`, p.jeton);
const portefeuille = async (cab: string, p: Personne) => ((await appeler('GET', `/cabinets/${cab}/portefeuille`, p.jeton)).corps.dossiers ?? []) as
  { mandat: string; entreprise: string; raisonSociale: string; statut: string; perimetre: string[]; tenu: boolean; role: string }[];

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesPaie(); declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesPaie(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('le cabinet et ses mandats', () => {
  it('le propriétaire choisit son cabinet par son code ; l\'associé accepte ; le périmètre décide ; le cabinet valide ; arrêté, il ne voit plus rien', async () => {
    const cl = await client();
    const cab = await cabinet();
    expect(cab.code).toMatch(/^[A-Z0-9]{8}$/i);
    // Seul le propriétaire choisit (un administrateur de l'entreprise, non) ; un code inconnu se refuse.
    const adm = await personne('administrateur');
    const inv = String((await appeler('POST', `/entreprises/${cl.ent}/invitations`, cl.jeton, { email: adm.email, roles: ['administrateur'] })).corps.jeton);
    await appeler('POST', '/invitations/accepter', adm.jeton, { jeton: inv });
    expect((await appeler('POST', `/entreprises/${cl.ent}/mandat`, adm.jeton, { codeCabinet: cab.code })).statut).toBe(403);
    await expect(enTantQue(pool, adm.utilisateur, (tx) => tx.query('select socle.proposer_mandat($1, $2, $3::text[])', [cl.ent, cab.code, ['comptabilite']])))
      .rejects.toThrow(/seul le propriétaire/i);
    expect((await appeler('POST', `/entreprises/${cl.ent}/mandat`, cl.jeton, { codeCabinet: 'ZZZZ9999' })).corps.motif).toMatch(/aucun cabinet/i);
    // Proposé (le code s'écrit en minuscules aussi) : la paie n'y est pas.
    const m = await appeler('POST', `/entreprises/${cl.ent}/mandat`, cl.jeton, { codeCabinet: cab.code.toLowerCase() });
    expect(m.statut, JSON.stringify(m.corps)).toBe(201);
    expect(m.corps.perimetre).toEqual(['comptabilite', 'declarations', 'saisie_achats']);
    expect((await appeler('POST', `/entreprises/${cl.ent}/mandat`, cl.jeton, { codeCabinet: cab.code })).corps.motif).toMatch(/déjà un cabinet/i);
    // L'associé voit la proposition, mais pas encore le dossier.
    expect(await portefeuille(cab.id, cab.associe)).toMatchObject([{ entreprise: cl.ent, raisonSociale: 'Menuiserie Ben Salah', statut: 'propose', tenu: false, role: 'supervision' }]);
    expect((await livres(cl.ent, cab.associe)).statut).toBe(404);
    // Un collaborateur n'accepte pas ; l'associé, si.
    const revision = await cab.collaborateur('revision');
    const mandat = String(m.corps.mandat);
    expect((await appeler('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, revision.jeton)).corps.motif).toMatch(/seul un associé/i);
    expect((await appeler('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, cab.associe.jeton)).statut).toBe(200);
    // Le cabinet lit les mêmes livres que son client.
    const siens = await livres(cl.ent, cl);
    const vus = await livres(cl.ent, cab.associe);
    expect(vus.statut).toBe(200);
    expect((vus.corps.ecritures as unknown[]).length).toBe(1);
    expect(vus.corps.ecritures).toEqual(siens.corps.ecritures);
    // Hors du périmètre : pas de paie, ni à la porte, ni dans la base ; le propriétaire l'ouvre.
    const paie = await appeler('GET', `/entreprises/${cl.ent}/paie/masse?du=2026-01-01&au=2026-12-31`, cab.associe.jeton);
    expect(paie.statut).toBe(403);
    expect(String(paie.corps.motif)).toContain('la paie');
    expect(await enTantQue(pool, cab.associe.utilisateur, async (tx) => (await tx.query('select count(*)::int n from paie.mes_entreprises() e where e = $1', [cl.ent])).rows[0].n)).toBe(0);
    expect((await appeler('PUT', `/entreprises/${cl.ent}/mandat/perimetre`, cab.associe.jeton, { perimetre: ['comptabilite', 'paie'] })).statut).toBe(403);
    await expect(enTantQue(pool, cab.associe.utilisateur, (tx) => tx.query('select socle.changer_perimetre($1, $2::text[])', [mandat, ['comptabilite', 'paie']])))
      .rejects.toThrow(/seul le propriétaire/i);
    // Sans la comptabilité, le cabinet ne lit plus les livres, même dans la base.
    expect((await appeler('PUT', `/entreprises/${cl.ent}/mandat/perimetre`, cl.jeton, { perimetre: ['paie'] })).statut).toBe(200);
    expect((await livres(cl.ent, cab.associe)).statut).toBe(403);
    expect(await enTantQue(pool, cab.associe.utilisateur, async (tx) => (await tx.query('select count(*)::int n from compta.mes_entreprises() e where e = $1', [cl.ent])).rows[0].n)).toBe(0);
    expect((await appeler('PUT', `/entreprises/${cl.ent}/mandat/perimetre`, cl.jeton, { perimetre: ['comptabilite', 'declarations', 'saisie_achats', 'paie'] })).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${cl.ent}/paie/masse?du=2026-01-01&au=2026-12-31`, cab.associe.jeton)).statut).toBe(200);

    // Un collaborateur ne voit que ce qui lui est confié, avec son rôle sur le dossier.
    const saisie = await cab.collaborateur('saisie');
    expect(await portefeuille(cab.id, saisie)).toEqual([]);
    expect((await livres(cl.ent, saisie)).statut).toBe(404);
    expect((await appeler('PUT', `/cabinets/${cab.id}/mandats/${mandat}/affectations/${saisie.membre}`, revision.jeton, { role: 'saisie' })).corps.motif).toMatch(/seul un associé/i);
    expect((await appeler('PUT', `/cabinets/${cab.id}/mandats/${mandat}/affectations/${saisie.membre}`, cab.associe.jeton, { role: 'saisie' })).statut).toBe(200);
    expect((await appeler('PUT', `/cabinets/${cab.id}/mandats/${mandat}/affectations/${revision.membre}`, cab.associe.jeton, { role: 'revision' })).statut).toBe(200);
    expect(await portefeuille(cab.id, saisie)).toMatchObject([{ entreprise: cl.ent, role: 'saisie' }]);
    expect((await livres(cl.ent, saisie)).statut).toBe(200);

    // Avec un mandat de comptabilité, c'est le cabinet qui valide : ni le client, ni l'assistant.
    expect((await appeler('POST', `/entreprises/${cl.ent}/compta/valider`, cl.jeton, { jusqua: '2026-08-31' })).corps.motif).toMatch(/c'est le cabinet qui valide/i);
    const refusSaisie = await appeler('POST', `/entreprises/${cl.ent}/compta/valider`, saisie.jeton, { jusqua: '2026-08-31' });
    expect(refusSaisie.statut).toBe(403);
    expect(String(refusSaisie.corps.motif)).toMatch(/ton rôle \(Assistant de saisie\)/i);
    await expect(enTantQue(pool, saisie.utilisateur, (tx) => tx.query('select compta.valider($1, $2::date)', [cl.ent, '2026-08-31']))).rejects.toThrow(/réservé à l'associé et aux collaborateurs/i);
    const v = await appeler('POST', `/entreprises/${cl.ent}/compta/valider`, revision.jeton, { jusqua: '2026-08-31' });
    expect(v.statut, JSON.stringify(v.corps)).toBe(200);
    expect(v.corps.validees).toBe(1);

    // Chez le client, la trace dit qui a fait quoi.
    const traces = (await admin.query(`select geste from socle.audit where entreprise = $1 and geste like 'cabinet.%' order by instant, id`, [cl.ent])).rows.map((r) => r.geste);
    expect(traces).toEqual(['cabinet.mandat.proposer', 'cabinet.mandat.accepter', 'cabinet.mandat.perimetre', 'cabinet.mandat.perimetre', 'cabinet.dossier.confier', 'cabinet.dossier.confier']);

    // Arrêté par le propriétaire : le cabinet ne voit plus rien.
    expect((await appeler('DELETE', `/entreprises/${cl.ent}/mandat`, cl.jeton)).statut).toBe(200);
    expect((await livres(cl.ent, cab.associe)).statut).toBe(404);
    expect(await portefeuille(cab.id, cab.associe)).toEqual([]);
    expect((await appeler('GET', `/entreprises/${cl.ent}/mandat`, cl.jeton)).corps.mandat).toBeNull();
  });

  it('le dossier tenu : l\'associé le crée, avec tout le périmètre et aucun membre côté client ; un collaborateur, non', async () => {
    const cab = await cabinet();
    const revision = await cab.collaborateur('revision');
    expect((await appeler('POST', `/cabinets/${cab.id}/dossiers`, revision.jeton, { raisonSociale: 'Boulangerie Ennour' })).corps.motif).toMatch(/seul un associé/i);
    expect((await appeler('POST', `/cabinets/${cab.id}/dossiers`, cab.associe.jeton, { raisonSociale: 'Boulangerie Ennour', matriculeFiscal: '1234567A' })).statut).toBe(400);
    const d = await appeler('POST', `/cabinets/${cab.id}/dossiers`, cab.associe.jeton, { raisonSociale: 'Boulangerie Ennour', matriculeFiscal: '1234567A/P/M/000' });
    expect(d.statut, JSON.stringify(d.corps)).toBe(201);
    const ent = String(d.corps.entreprise);
    expect(await portefeuille(cab.id, cab.associe)).toMatchObject([{ entreprise: ent, statut: 'actif', tenu: true, perimetre: ['comptabilite', 'declarations', 'saisie_achats', 'paie'] }]);
    expect((await admin.query('select count(*)::int n from socle.membre where entreprise = $1', [ent])).rows[0].n).toBe(0);
    expect((await livres(ent, cab.associe)).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${ent}/paie/masse?du=2026-01-01&au=2026-12-31`, cab.associe.jeton)).statut).toBe(200);
  });

  it('le cabinet ne fait jamais chez son client ce qui est au client : ni vente, ni équipe ; un autre cabinet ne voit rien', async () => {
    const cl = await client();
    const cab = await cabinet();
    const mandat = String((await appeler('POST', `/entreprises/${cl.ent}/mandat`, cl.jeton, { codeCabinet: cab.code })).corps.mandat);
    await appeler('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, cab.associe.jeton);
    // Il voit les pièces de vente, il n'en prépare pas ; il ne voit pas l'équipe du client.
    expect((await appeler('GET', `/entreprises/${cl.ent}/ventes`, cab.associe.jeton)).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${cl.ent}/ventes/00000000-0000-7000-8000-000000000001/emettre`, cab.associe.jeton)).statut).toBe(403);
    expect((await appeler('GET', `/entreprises/${cl.ent}/equipe`, cab.associe.jeton)).statut).toBe(403);
    // Ni le client ni le dossier d'un autre cabinet.
    const autre = await cabinet();
    expect(await portefeuille(cab.id, autre.associe)).toEqual([]);
    expect((await appeler('POST', `/cabinets/${autre.id}/mandats/${mandat}/accepter`, autre.associe.jeton)).statut).toBe(404);
    expect((await appeler('POST', `/cabinets/${cab.id}/mandats/${mandat}/arreter`, autre.associe.jeton)).statut).toBe(404);
    expect((await livres(cl.ent, autre.associe)).statut).toBe(404);
  });
});

// Brique 37 : ce que les écrans du Cabinet lisent et écrivent au serveur.
describe('les écrans du Cabinet, côté serveur', () => {
  it('« Ton cabinet comptable » : le client lit le nom et le code de son cabinet, rien de plus ; personne d\'autre ne les lit par ce chemin', async () => {
    const cl = await client();
    const cab = await cabinet();
    const mandat = String((await appeler('POST', `/entreprises/${cl.ent}/mandat`, cl.jeton, { codeCabinet: cab.code })).corps.mandat);
    expect((await appeler('GET', `/entreprises/${cl.ent}/mandat`, cl.jeton)).corps.mandat).toMatchObject({ statut: 'propose', cabinet: { nom: 'Cabinet Ennour', code: cab.code } });
    await appeler('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, cab.associe.jeton);
    expect((await appeler('GET', `/entreprises/${cl.ent}/mandat`, cl.jeton)).corps.mandat).toMatchObject({ statut: 'actif', cabinet: { nom: 'Cabinet Ennour', code: cab.code } });
    // La fiche du cabinet reste fermée au client ; la fonction ne répond qu'à qui voit l'entreprise.
    expect(await enTantQue(pool, cl.utilisateur, async (tx) => (await tx.query('select count(*)::int n from socle.organisation where id = $1', [cab.id])).rows[0].n)).toBe(0);
    const inconnu = await personne('inconnu');
    expect(await enTantQue(pool, inconnu.utilisateur, async (tx) => (await tx.query('select * from socle.cabinet_du_mandat($1)', [mandat])).rows)).toEqual([]);
  });

  it('l\'entrée sait ce qui est à la personne et ce qu\'elle voit par son cabinet', async () => {
    const cl = await client();
    const cab = await cabinet();
    const mandat = String((await appeler('POST', `/entreprises/${cl.ent}/mandat`, cl.jeton, { codeCabinet: cab.code })).corps.mandat);
    await appeler('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, cab.associe.jeton);
    const moiAssocie = (await appeler('GET', '/moi', cab.associe.jeton)).corps as { entreprises: { id: string; parCabinet: boolean }[]; cabinets: { id: string; nom: string }[] };
    expect(moiAssocie.entreprises).toMatchObject([{ id: cl.ent, parCabinet: true }]);
    expect(moiAssocie.cabinets).toEqual([{ id: cab.id, nom: 'Cabinet Ennour' }]);
    const moiClient = (await appeler('GET', '/moi', cl.jeton)).corps as { entreprises: { id: string; parCabinet: boolean }[]; cabinets: unknown[] };
    expect(moiClient.entreprises).toMatchObject([{ id: cl.ent, parCabinet: false }]);
    expect(moiClient.cabinets).toEqual([]);
  });

  it('la fiche d\'un dossier : au cabinet seul, champs comptés, jamais écrasée par un poste qui ne l\'a pas relue', async () => {
    const cl = await client();
    const cab = await cabinet();
    const mandat = String((await appeler('POST', `/entreprises/${cl.ent}/mandat`, cl.jeton, { codeCabinet: cab.code })).corps.mandat);
    const poser = (p: Personne, contenu: unknown, revision: number | null) => appeler('PUT', `/cabinets/${cab.id}/fiches/${cl.ent}`, p.jeton, { contenu, revision });
    // Avant l'accord, le dossier n'est pas au portefeuille : pas de fiche.
    expect((await poser(cab.associe, { note: 'x' }, null)).statut).toBe(404);
    await appeler('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, cab.associe.jeton);
    // Les champs sont comptés : un champ inconnu, des honoraires à virgule se refusent.
    expect((await poser(cab.associe, { note: 'x', motDePasseImpots: 'secret' }, null)).statut).toBe(400);
    expect((await poser(cab.associe, { fees: 150.5 }, null)).statut).toBe(400);
    expect((await poser(cab.associe, { email: 'menuiserie@exemple.tn', fees: 150500 }, null)).corps).toEqual({ revision: 1 });
    // Un autre poste qui n'a pas relu (révision ancienne, ou « première » alors qu'elle existe) : refusé, rien d'écrasé.
    const perime = await poser(cab.associe, { note: 'autre poste' }, null);
    expect(perime.statut).toBe(409);
    expect(String(perime.corps.motif)).toMatch(/changée par quelqu'un d'autre/i);
    expect((await poser(cab.associe, { email: 'menuiserie@exemple.tn', fees: 150500, note: 'relue' }, 1)).corps).toEqual({ revision: 2 });
    expect((await poser(cab.associe, { note: 'écrase' }, 1)).statut).toBe(409);
    // Deux postes au même instant, sur la même révision : un seul passe, l'autre est refusé (jamais une erreur).
    const [a, b] = await Promise.all([poser(cab.associe, { note: 'A' }, 2), poser(cab.associe, { note: 'B' }, 2)]);
    expect([a.statut, b.statut].sort()).toEqual([200, 409]);
    const fiches = (await appeler('GET', `/cabinets/${cab.id}/fiches`, cab.associe.jeton)).corps.fiches as { entreprise: string; contenu: Record<string, unknown>; revision: number }[];
    expect(fiches).toEqual([{ entreprise: cl.ent, contenu: { note: a.statut === 200 ? 'A' : 'B' }, revision: 3 }]);
    // Au cabinet seul : ni le client, ni un collaborateur à qui le dossier n'est pas confié, ni un autre cabinet.
    expect(await enTantQue(pool, cl.utilisateur, async (tx) => (await tx.query('select count(*)::int n from cabinet.fiche where entreprise = $1', [cl.ent])).rows[0].n)).toBe(0);
    const saisie = await cab.collaborateur('saisie');
    expect((await appeler('GET', `/cabinets/${cab.id}/fiches`, saisie.jeton)).corps.fiches).toEqual([]);
    expect((await poser(saisie, { note: 'x' }, 3)).statut).toBe(404);
    const autre = await cabinet();
    expect((await appeler('GET', `/cabinets/${cab.id}/fiches`, autre.associe.jeton)).corps.fiches).toEqual([]);
    // Le mandat arrêté, la fiche ne se lit plus.
    await appeler('DELETE', `/entreprises/${cl.ent}/mandat`, cl.jeton);
    expect((await appeler('GET', `/cabinets/${cab.id}/fiches`, cab.associe.jeton)).corps.fiches).toEqual([]);
  });
});
