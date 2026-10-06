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

  it('sous un mandat de comptabilité, un refus de valider nomme le cabinet, jamais le propriétaire ; sans ce mandat, il nomme le propriétaire', async () => {
    const cab = await cabinet();
    const vendeur = async (ent: string) => {
      const p = await personne('vendeur');
      await admin.query(`insert into socle.membre (utilisateur, entreprise, roles) values ($1, $2, '{commercial}')`, [p.utilisateur, ent]);
      return p;
    };
    const valider = (ent: string, p: Personne) => appeler('POST', `/entreprises/${ent}/compta/valider`, p.jeton, { jusqua: '2026-08-31' });
    // Un mandat de comptabilité : le refus nomme le cabinet, et personne de l'entreprise.
    const cl = await client();
    const mandat = String((await appeler('POST', `/entreprises/${cl.ent}/mandat`, cl.jeton, { codeCabinet: cab.code })).corps.mandat);
    await appeler('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, cab.associe.jeton);
    const r = await valider(cl.ent, await vendeur(cl.ent));
    expect([r.statut, r.corps.qui, r.corps.bouton]).toEqual([403, [], null]);
    expect(String(r.corps.motif)).toMatch(/Avec le mandat de comptabilité, c'est ton cabinet, Cabinet Ennour, qui le fait/);
    expect(String(r.corps.motif)).not.toMatch(/Peuvent le faire/);
    // Un mandat de paie seulement : la validation reste à l'entreprise, le refus nomme le propriétaire.
    const autre = await client();
    const m2 = String((await appeler('POST', `/entreprises/${autre.ent}/mandat`, autre.jeton, { codeCabinet: cab.code, perimetre: ['paie'] })).corps.mandat);
    await appeler('POST', `/cabinets/${cab.id}/mandats/${m2}/accepter`, cab.associe.jeton);
    const r2 = await valider(autre.ent, await vendeur(autre.ent));
    expect([r2.statut, (r2.corps.qui as { utilisateur: string }[]).map((q) => q.utilisateur)]).toEqual([403, [autre.utilisateur]]);
    expect(String(r2.corps.motif)).toMatch(/Peuvent le faire : client/);
    // Un mandat proposé, pas encore accepté : l'entreprise valide encore elle-même.
    const trois = await client();
    await appeler('POST', `/entreprises/${trois.ent}/mandat`, trois.jeton, { codeCabinet: cab.code });
    expect(String((await valider(trois.ent, await vendeur(trois.ent))).corps.motif)).toMatch(/Peuvent le faire : client/);
  });

  it('le nom et le matricule d\'un dossier tenu : un associé les corrige, tracés ; un collaborateur, non ; ceux d\'un client sur SkanFact, jamais ; un matricule déjà pris, refusé en le disant', async () => {
    const cab = await cabinet();
    const revision = await cab.collaborateur('revision');
    const matricule = () => `${1_000_000 + Math.floor(Math.random() * 8_999_999)}A/P/M/000`;
    const tenu = String((await appeler('POST', `/cabinets/${cab.id}/dossiers`, cab.associe.jeton, { raisonSociale: 'Boulangerie' })).corps.entreprise);
    const renommer = (ent: string, p: Personne, corps: unknown) => appeler('PUT', `/cabinets/${cab.id}/dossiers/${ent}`, p.jeton, corps);
    const m1 = matricule();
    expect(String((await renommer(tenu, revision, { raisonSociale: 'Boulangerie Ennour', matriculeFiscal: m1 })).corps.motif)).toMatch(/seul un associé du cabinet/i);
    const r = await renommer(tenu, cab.associe, { raisonSociale: '  Boulangerie Ennour  ', matriculeFiscal: m1.toLowerCase() });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    const lu = async () => (await portefeuille(cab.id, cab.associe)).find((d) => d.entreprise === tenu) as unknown as { raisonSociale: string; matriculeFiscal: string | null };
    expect([(await lu()).raisonSociale, (await lu()).matriculeFiscal]).toEqual(['Boulangerie Ennour', m1]);
    const trace = (await admin.query(`select avant, apres from socle.audit where entreprise = $1 and geste = 'cabinet.dossier_tenu.renommer'`, [tenu])).rows;
    expect(trace).toEqual([{ avant: { raisonSociale: 'Boulangerie', matriculeFiscal: null }, apres: { raisonSociale: 'Boulangerie Ennour', matriculeFiscal: m1 } }]);
    expect((await admin.query('select o.nom from socle.organisation o join socle.entreprise e on e.organisation = o.id where e.id = $1', [tenu])).rows[0].nom).toBe('Boulangerie Ennour');
    // Son propre matricule n'est pas « déjà pris ».
    expect((await renommer(tenu, cab.associe, { raisonSociale: 'Boulangerie Ennour', matriculeFiscal: m1 })).statut).toBe(200);
    // Une forme fausse, un nom vide : refusés ; un matricule vide le retire.
    expect((await renommer(tenu, cab.associe, { raisonSociale: 'Boulangerie Ennour', matriculeFiscal: '1234567A' })).statut).toBe(400);
    expect((await renommer(tenu, cab.associe, { raisonSociale: '  ', matriculeFiscal: '' })).statut).toBe(400);
    expect((await renommer(tenu, cab.associe, { raisonSociale: 'Boulangerie Ennour', matriculeFiscal: '' })).statut).toBe(200);
    expect((await lu()).matriculeFiscal).toBeNull();
    // Un matricule déjà porté par une autre entreprise : refusé en le disant, ici comme à la création.
    const m2 = matricule();
    expect((await appeler('POST', `/cabinets/${cab.id}/dossiers`, cab.associe.jeton, { raisonSociale: 'Café des Arts', matriculeFiscal: m2 })).statut).toBe(201);
    const pris = await renommer(tenu, cab.associe, { raisonSociale: 'Boulangerie Ennour', matriculeFiscal: m2 });
    expect([pris.statut, String(pris.corps.motif)]).toEqual([403, expect.stringMatching(/ce matricule fiscal est déjà celui d'une entreprise sur SkanFact/i)]);
    const double = await appeler('POST', `/cabinets/${cab.id}/dossiers`, cab.associe.jeton, { raisonSociale: 'Autre café', matriculeFiscal: m2 });
    expect([double.statut, String(double.corps.motif)]).toEqual([403, expect.stringMatching(/ce matricule fiscal est déjà celui/i)]);
    // Sous une autre écriture, le même matricule (E4 : il se gardait tel qu'écrit, et passait une seconde fois sans barres).
    const autreEcriture = await appeler('POST', `/cabinets/${cab.id}/dossiers`, cab.associe.jeton, { raisonSociale: 'Autre café', matriculeFiscal: m2.replace(/\//g, '').toLowerCase() });
    expect([autreEcriture.statut, String(autreEcriture.corps.motif)]).toEqual([403, expect.stringMatching(/ce matricule fiscal est déjà celui/i)]);
    // Écrit comme on le recopie, il se garde sous sa forme lisible ; la lettre-clé n'est jamais I, O ni U (la règle du
    // fichier El Fatoora), et le refus dit pourquoi, sans nommer de champ technique.
    const m3 = matricule();
    const recopie = await appeler('POST', `/cabinets/${cab.id}/dossiers`, cab.associe.jeton, { raisonSociale: 'Librairie El Manar', matriculeFiscal: ` ${m3.replace(/\//g, ' ').toLowerCase()} ` });
    expect(recopie.statut, JSON.stringify(recopie.corps)).toBe(201);
    expect(((await portefeuille(cab.id, cab.associe)).find((d) => d.entreprise === recopie.corps.entreprise) as unknown as { matriculeFiscal: string | null }).matriculeFiscal).toBe(m3);
    const cleO = `${m3.slice(0, 7)}O/P/M/000`;
    const o = await renommer(tenu, cab.associe, { raisonSociale: 'Boulangerie Ennour', matriculeFiscal: cleO });
    expect([o.statut, o.corps.champ, o.corps.motif]).toEqual([400, 'matriculeFiscal', `Le matricule fiscal « ${cleO} » n'a pas la bonne forme : sept chiffres, une lettre autre que I, O ou U, puis code TVA, catégorie et établissement (1234567A/A/M/000), tels qu'ils figurent sur la carte d'identification fiscale.`]);
    // Un client sur SkanFact : son nom est le sien.
    const cl = await client();
    const mandat = String((await appeler('POST', `/entreprises/${cl.ent}/mandat`, cl.jeton, { codeCabinet: cab.code })).corps.mandat);
    await appeler('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, cab.associe.jeton);
    expect(String((await renommer(cl.ent, cab.associe, { raisonSociale: 'Autre nom', matriculeFiscal: '' })).corps.motif)).toMatch(/ce client est sur SkanFact : son nom et son matricule sont les siens/i);
    // Un dossier hors du portefeuille : il n'existe pas pour ce cabinet.
    const autre = await cabinet();
    expect(String((await appeler('PUT', `/cabinets/${autre.id}/dossiers/${tenu}`, autre.associe.jeton, { raisonSociale: 'X', matriculeFiscal: '' })).corps.motif)).toMatch(/pas au portefeuille/i);
  });

  it('retirer un dossier : un dossier tenu sans écriture sort du portefeuille ; avec une écriture, refusé ; un client sur SkanFact garde ses livres', async () => {
    const cab = await cabinet();
    const cree = async (nom: string) => String((await appeler('POST', `/cabinets/${cab.id}/dossiers`, cab.associe.jeton, { raisonSociale: nom })).corps.entreprise);
    const vide = await cree('Créé par erreur'), tenu = await cree('Boulangerie Ennour');
    const e = await appeler('POST', `/entreprises/${tenu}/compta/ecritures`, cab.associe.jeton, {
      date: '2026-03-20', journal: 'OD', piece: 'OD-1', libelle: 'Loyer', lignes: [{ compte: '6132', debit: '850,500' }, { compte: '401', credit: '850,500' }] });
    expect(e.statut, JSON.stringify(e.corps)).toBe(201);
    const mandatDe = async (ent: string) => (await portefeuille(cab.id, cab.associe)).find((d) => d.entreprise === ent)?.mandat ?? '';
    // Le dossier tenu qui a des écritures : refusé, et le refus dit d'archiver ; rien ne bouge.
    const refus = await appeler('POST', `/cabinets/${cab.id}/mandats/${await mandatDe(tenu)}/arreter`, cab.associe.jeton);
    expect(refus.statut, JSON.stringify(refus.corps)).toBe(403);
    expect(String(refus.corps.motif)).toMatch(/a 1 écriture dans ses livres.*Archive-le/);
    expect((await livres(tenu, cab.associe)).statut).toBe(200);
    // Le dossier tenu sans écriture : il sort du portefeuille.
    expect((await appeler('POST', `/cabinets/${cab.id}/mandats/${await mandatDe(vide)}/arreter`, cab.associe.jeton)).statut).toBe(200);
    expect((await portefeuille(cab.id, cab.associe)).map((d) => d.entreprise)).toEqual([tenu]);
    // Un client sur SkanFact : son mandat s'arrête ; il garde ses livres, le cabinet ne les voit plus.
    const cl = await client();
    const mandat = String((await appeler('POST', `/entreprises/${cl.ent}/mandat`, cl.jeton, { codeCabinet: cab.code })).corps.mandat);
    await appeler('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, cab.associe.jeton);
    expect((await appeler('POST', `/entreprises/${cl.ent}/compta/ecritures`, cab.associe.jeton, {
      date: '2026-03-20', journal: 'OD', piece: 'OD-1', libelle: 'Loyer', lignes: [{ compte: '6132', debit: '850,500' }, { compte: '401', credit: '850,500' }] })).statut).toBe(201);
    expect((await appeler('POST', `/cabinets/${cab.id}/mandats/${mandat}/arreter`, cab.associe.jeton)).statut).toBe(200);
    expect((await livres(cl.ent, cab.associe)).statut).toBe(404);
    const siens = (await livres(cl.ent, cl)).corps.ecritures as { piece: string }[];
    expect(siens.map((x) => x.piece)).toContain('OD-1');
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
    // « Au même instant » pour de vrai : deux personnes du cabinet (deux sessions : deux requêtes d'une
    // même session passent l'une après l'autre), et la fiche retenue jusqu'à ce que les deux aient lu
    // la même révision et attendent d'écrire — sans quoi la seconde arrive souvent après la première,
    // et le test ne prouve plus rien.
    const second = await cab.collaborateur('supervision');
    await admin.query('begin');
    await admin.query('select 1 from cabinet.fiche where entreprise = $1 for update', [cl.ent]);
    const paire = Promise.all([poser(cab.associe, { note: 'A' }, 2), poser(second, { note: 'B' }, 2)]);
    // Qui attend d'écrire, vu d'une autre connexion (dans une transaction, l'activité lue ne bouge plus).
    const guet = new pg.Client({ connectionString: inject('pgAdmin') });
    await guet.connect();
    const enAttente = async () => Number((await guet.query(`select count(*)::int n from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'update "cabinet"."fiche"%'`)).rows[0].n);
    for (let i = 0; i < 200 && await enAttente() < 2; i++) await new Promise((r) => setTimeout(r, 25));
    expect(await enAttente()).toBe(2);
    await guet.end();
    await admin.query('commit');
    const [a, b] = await paire;
    expect([a.statut, b.statut].sort()).toEqual([200, 409]);
    const fiches = (await appeler('GET', `/cabinets/${cab.id}/fiches`, cab.associe.jeton)).corps.fiches as { entreprise: string; contenu: Record<string, unknown>; revision: number }[];
    expect(fiches).toEqual([{ entreprise: cl.ent, contenu: { note: a.statut === 200 ? 'A' : 'B' }, revision: 3 }]);
    // Les relances notées (C15) : le jour, le moyen, les mois réclamés, une note — rien d'autre, et
    // jamais plus de cinquante.
    const relance = { at: Date.UTC(2026, 8, 29, 9), via: 'email', months: ['2026-07', '2026-08'], note: '' };
    expect((await poser(cab.associe, { relances: [relance], note: 'x' }, 2)).statut).toBe(409);
    expect((await poser(cab.associe, { relances: [{ ...relance, via: 'pigeon' }] }, 3)).statut).toBe(400);
    expect((await poser(cab.associe, { relances: [{ ...relance, months: ['2026-13'] }] }, 3)).statut).toBe(400);
    expect((await poser(cab.associe, { relances: [{ ...relance, montant: 1 }] }, 3)).statut).toBe(400);
    expect((await poser(cab.associe, { relances: Array.from({ length: 51 }, () => relance) }, 3)).statut).toBe(400);
    expect((await poser(cab.associe, { relances: [relance] }, 3)).corps).toEqual({ revision: 4 });
    expect(((await appeler('GET', `/cabinets/${cab.id}/fiches`, cab.associe.jeton)).corps.fiches as { contenu: unknown }[])[0]?.contenu).toEqual({ relances: [relance] });
    // Au cabinet seul : ni le client, ni un collaborateur à qui le dossier n'est pas confié, ni un autre cabinet.
    expect(await enTantQue(pool, cl.utilisateur, async (tx) => (await tx.query('select count(*)::int n from cabinet.fiche where entreprise = $1', [cl.ent])).rows[0].n)).toBe(0);
    const saisie = await cab.collaborateur('saisie');
    expect((await appeler('GET', `/cabinets/${cab.id}/fiches`, saisie.jeton)).corps.fiches).toEqual([]);
    expect((await poser(saisie, { note: 'x' }, 4)).statut).toBe(404);
    const autre = await cabinet();
    expect((await appeler('GET', `/cabinets/${cab.id}/fiches`, autre.associe.jeton)).corps.fiches).toEqual([]);
    // Le mandat arrêté, la fiche ne se lit plus.
    await appeler('DELETE', `/entreprises/${cl.ent}/mandat`, cl.jeton);
    expect((await appeler('GET', `/cabinets/${cab.id}/fiches`, cab.associe.jeton)).corps.fiches).toEqual([]);
  });
});
