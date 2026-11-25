// Le Cabinet relu (vérification complète, lot Cabinet, 25/11/2026), par l'API et dans la base.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { declarerGestesAchats } from '../../serveur/achats/gestes.ts';
import { routesAchats } from '../../serveur/achats/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { routesCompta } from '../../serveur/compta/routes.ts';
import { declarerGestesPaie } from '../../serveur/paie/gestes.ts';
import { routesPaie } from '../../serveur/paie/routes.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
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

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes(); declarerGestesAchats(); declarerGestesCompta(); declarerGestesPaie();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAchats(ctx), ...routesPaie(ctx), ...routesCompta(ctx), ...routesCabinet(ctx), ...routesV10(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

// (Vérification du Cabinet, 25/11/2026) Ce que la relecture du code a trouvé, tenu par le serveur et la base.
async function cabinetEtClient(nomCabinet: string) {
  const associe = await personne('associe');
  const cab = (await appeler('POST', '/cabinets', associe.jeton, { nom: nomCabinet })).corps;
  return { associe, cabinet: String(cab.id), code: String(cab.code) };
}

describe('le Cabinet relu', () => {
  it('un nouveau client et sa fiche : une fiche refusée ne crée aucun dossier ; acceptée, elle est écrite avec lui', async () => {
    const c = await cabinetEtClient('Cabinet Relu');
    const nom = `Pâtisserie ${Date.now()}`;
    const refus = await appeler('POST', `/cabinets/${c.cabinet}/dossiers`, c.associe.jeton, { raisonSociale: nom, fiche: { phone: '1'.repeat(45) } });
    expect(refus.statut).toBe(400);
    expect(Number((await admin.query('select count(*) n from socle.entreprise where raison_sociale = $1', [nom])).rows[0].n)).toBe(0);
    const ok = await appeler('POST', `/cabinets/${c.cabinet}/dossiers`, c.associe.jeton, { raisonSociale: nom, fiche: { phone: '+216 71 000 000', email: 'contact@patisserie.tn' } });
    expect(ok.statut, JSON.stringify(ok.corps)).toBe(201);
    const ent = String(ok.corps.entreprise);
    expect(Number((await admin.query('select count(*) n from socle.entreprise where raison_sociale = $1', [nom])).rows[0].n)).toBe(1);
    expect((await admin.query('select contenu, revision from cabinet.fiche where cabinet = $1 and entreprise = $2', [c.cabinet, ent])).rows[0])
      .toEqual({ contenu: { phone: '+216 71 000 000', email: 'contact@patisserie.tn' }, revision: 1n });
  });

  it('une entreprise n\'a qu\'un cabinet à la fois, quel que soit le chemin qui écrit le mandat', async () => {
    const a = await cabinetEtClient('Cabinet A'), b = await cabinetEtClient('Cabinet B');
    const client = await personne('client');
    const ent = String((await appeler('POST', '/entreprises', client.jeton, { raisonSociale: 'Garage Relu' })).corps.id);
    expect((await appeler('POST', `/entreprises/${ent}/mandat`, client.jeton, { codeCabinet: a.code })).statut).toBe(201);
    // Un second mandat écrit directement (comme le ferait un chemin qui oublie la règle) : la base le refuse.
    await expect(admin.query(`insert into socle.mandat (cabinet, entreprise, debut, perimetre, statut) values ($1, $2, current_date, array['comptabilite'], 'propose')`, [b.cabinet, ent]))
      .rejects.toThrow('cette entreprise a déjà un cabinet : arrête d\'abord son mandat');
    expect(Number((await admin.query(`select count(*) n from socle.mandat where entreprise = $1 and statut in ('propose', 'actif')`, [ent])).rows[0].n)).toBe(1);
  });

  it('les questions d\'un cabinet d\'avant restent les siennes : le cabinet d\'aujourd\'hui ne les envoie, ne les ferme ni ne les compte', async () => {
    const a = await cabinetEtClient('Cabinet Avant'), b = await cabinetEtClient('Cabinet Après');
    const client = await personne('client');
    const ent = String((await appeler('POST', '/entreprises', client.jeton, { raisonSociale: 'Boulangerie Relue' })).corps.id);
    const perimetre = ['comptabilite', 'declarations', 'saisie_achats'];
    const mandatA = String((await appeler('POST', `/entreprises/${ent}/mandat`, client.jeton, { codeCabinet: a.code, perimetre })).corps.mandat);
    expect((await appeler('POST', `/cabinets/${a.cabinet}/mandats/${mandatA}/accepter`, a.associe.jeton)).statut).toBe(200);
    const q = await appeler('POST', `/entreprises/${ent}/compta/questions`, a.associe.jeton, { periode: '2026', texte: 'Note interne : vérifier le compte 471.' });
    expect(q.statut, JSON.stringify(q.corps)).toBe(201);
    const question = String(q.corps.id);
    // Une seconde, envoyée au client par A : elle reste lisible par le client, et ne compte pas chez B.
    const q2 = String((await appeler('POST', `/entreprises/${ent}/compta/questions`, a.associe.jeton, { periode: '2026', texte: 'D\'où vient le virement du 12 mars ?' })).corps.id);
    expect((await appeler('POST', `/entreprises/${ent}/compta/questions/envoyer`, a.associe.jeton, { ids: [q2] })).statut).toBe(200);
    expect((await appeler('DELETE', `/entreprises/${ent}/mandat`, client.jeton)).statut).toBeLessThan(300);
    const mandatB = String((await appeler('POST', `/entreprises/${ent}/mandat`, client.jeton, { codeCabinet: b.code, perimetre })).corps.mandat);
    expect((await appeler('POST', `/cabinets/${b.cabinet}/mandats/${mandatB}/accepter`, b.associe.jeton)).statut).toBe(200);
    // B n'envoie pas la note de A, ne la ferme pas, ne la réécrit pas, et ne la compte pas.
    const envoi = await appeler('POST', `/entreprises/${ent}/compta/questions/envoyer`, b.associe.jeton, { annee: 2026 });
    expect(envoi.statut).toBe(403);
    expect((await appeler('POST', `/entreprises/${ent}/compta/questions/${question}/fermer`, b.associe.jeton, {})).statut).toBe(403);
    expect((await appeler('POST', `/entreprises/${ent}/compta/questions/${q2}/fermer`, b.associe.jeton, {})).statut).toBe(403);
    expect((await appeler('PUT', `/entreprises/${ent}/compta/questions/${question}`, b.associe.jeton, { texte: 'réécrite' })).statut).toBe(403);
    const compte = (await appeler('GET', `/cabinets/${b.cabinet}/questions`, b.associe.jeton)).corps.dossiers as { entreprise: string }[];
    expect(compte.find((x) => x.entreprise === ent)).toBeUndefined();
    expect((await admin.query('select statut, cardinality(envois) n, texte from compta.question where id = $1', [question])).rows[0])
      .toEqual({ statut: 'ouverte', n: 0, texte: 'Note interne : vérifier le compte 471.' });
  });
});
