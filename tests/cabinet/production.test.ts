// La production du portefeuille (brique 48 ; docs/cabinet.md, C38), par l'API et dans la base. Ce
// que le serveur compte, pour tous les dossiers en une fois :
//   - par mois, les écritures (hors à-nouveaux), validées et au brouillard, qui y a fait le dernier geste
//     et quand ;
//   - les déclarations (déposée ou non), les révisions d'un mois (arrêtée ou non), les exercices ;
//   - rien d'un dossier hors du portefeuille, rien d'avant la date demandée.


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

async function personneA(email: string, nom: string) {
  await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  await appeler('POST', '/moi/code', jeton, { methode: 'application' });
  const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  return { email, jeton, utilisateur };
}
type Production = {
  mois: { entreprise: string; mois: string; ecritures: number; validees: number; brouillards: number; qui: string; depuis: string }[];
  declarations: { entreprise: string; periode: string; deposee: boolean }[];
  revisions: { entreprise: string; periode: string; faite: boolean }[];
  exercices: { entreprise: string; annee: number; du: string; au: string; clos: boolean }[];
};
const saisir = async (ent: string, p: { jeton: string }, date: string, piece: string) => String((await appeler('POST', `/entreprises/${ent}/compta/ecritures`, p.jeton, {
  date, journal: 'OD', piece, libelle: 'Honoraires à payer', lignes: [{ compte: '6226', debit: '300,125' }, { compte: '4286', credit: '300,125' }] })).corps.id);
const REVISION = { faite: true, faiteLe: 1759140000000, faitePar: 'associe', comptes: [], notes: [], questionnaire: [] };

describe('la production du portefeuille', () => {
  it('compte chaque mois de chaque dossier : écritures, validées, brouillards, dernier geste ; déclarations, révisions, exercices ; rien d\'autre', async () => {
    const associe = await personneA(`associe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`, 'Karim Associé');
    const cabinet = String((await appeler('POST', '/cabinets', associe.jeton, { nom: 'Cabinet Ennour' })).corps.id);
    const garage = String((await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: 'Garage du Port' })).corps.entreprise);
    const cafe = String((await appeler('POST', `/cabinets/${cabinet}/dossiers`, associe.jeton, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    // L'exercice 2026 ouvert avec sa balance (une écriture AN au 1er janvier, qui ne compte pas).
    const ouvert = await appeler('POST', `/entreprises/${garage}/compta/exercices`, associe.jeton, { annee: 2026, ouverture: [
      { compte: '532', libelle: 'Banque', debit: '12500,250' }, { compte: '101', libelle: 'Capital', credit: '12500,250' }] });
    expect(ouvert.statut, JSON.stringify(ouvert.corps)).toBe(201);
    // Février : une écriture au brouillard. Mars : trois, dont deux validées. Un mois de 2020, avant la date demandée.
    await saisir(garage, associe, '2026-02-12', 'OD-1');
    const m1 = await saisir(garage, associe, '2026-03-05', 'OD-2');
    const m2 = await saisir(garage, associe, '2026-03-18', 'OD-3');
    await saisir(garage, associe, '2026-03-25', 'OD-4');
    expect((await appeler('POST', `/entreprises/${garage}/compta/ecritures/valider`, associe.jeton, { ids: [m1, m2] })).statut).toBe(200);
    await saisir(garage, associe, '2020-06-10', 'OD-0');
    // Mars déclaré et déposé, février préparé sans dépôt ; mars révisé (arrêté), février ouvert.
    expect((await appeler('PUT', `/entreprises/${garage}/compta/declarations/2026-03`, associe.jeton, { cases: { tvaCollectee: '190,125' } })).statut).toBe(200);
    expect((await appeler('POST', `/entreprises/${garage}/compta/declarations/2026-03/pointer`, associe.jeton, { quoi: 'deposee', le: '2026-04-20' })).statut).toBe(200);
    expect((await appeler('PUT', `/entreprises/${garage}/compta/declarations/2026-02`, associe.jeton, { cases: { tvaCollectee: '12,500' } })).statut).toBe(200);
    const rev = `/cabinets/${cabinet}/revisions/${garage}`;
    expect((await appeler('PUT', `${rev}/2026-03`, associe.jeton, { contenu: REVISION, revision: null })).statut).toBe(200);
    expect((await appeler('PUT', `${rev}/2026-02`, associe.jeton, { contenu: { ...REVISION, faite: false, faiteLe: null, faitePar: '' }, revision: null })).statut).toBe(200);
    expect((await appeler('PUT', `${rev}/2026`, associe.jeton, { contenu: REVISION, revision: null })).statut).toBe(200);
    // Un dossier d'un autre cabinet : rien de lui ne se lit ici.
    const autre = await personne('autre');
    const cabAutre = String((await appeler('POST', '/cabinets', autre.jeton, { nom: 'Cabinet Voisin' })).corps.id);
    const voisin = String((await appeler('POST', `/cabinets/${cabAutre}/dossiers`, autre.jeton, { raisonSociale: 'Voisin SARL' })).corps.entreprise);
    await saisir(voisin, autre, '2026-03-05', 'OD-9');

    const r = await appeler('GET', `/cabinets/${cabinet}/production?depuis=2021-09-01`, associe.jeton);
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    const p = r.corps as Production;
    expect(p.mois.map((x) => [x.entreprise, x.mois, x.ecritures, x.validees, x.brouillards, x.qui])).toEqual([
      [garage, '2026-02', 1, 0, 1, 'Karim Associé'], [garage, '2026-03', 3, 2, 1, 'Karim Associé']]);
    // Quand : le dernier geste du mois (ici, la validation de deux écritures, après la dernière saisie).
    const derniers = (await admin.query(`select max(greatest(cree_le, validee_le)) d from compta.ecriture where entreprise = $1 and to_char(date_ecriture, 'YYYY-MM') = '2026-03'`, [garage])).rows[0].d as Date;
    expect(p.mois[1]?.depuis).toBe(derniers.toISOString());
    expect(p.declarations).toEqual([{ entreprise: garage, periode: '2026-02', deposee: false }, { entreprise: garage, periode: '2026-03', deposee: true }]);
    expect(p.revisions).toEqual([{ entreprise: garage, periode: '2026-02', faite: false }, { entreprise: garage, periode: '2026-03', faite: true }]);
    expect(p.exercices).toEqual([{ entreprise: garage, annee: 2026, du: '2026-01-01', au: '2026-12-31', clos: false }]);
    expect(JSON.stringify(p)).not.toContain(voisin);
    expect(JSON.stringify(p)).not.toContain(cafe);
    // L'autre cabinet ne lit pas celui-ci ; une date qui n'est pas le premier d'un mois est refusée.
    expect((await appeler('GET', `/cabinets/${cabinet}/production?depuis=2021-09-01`, autre.jeton)).corps).toEqual({ mois: [], declarations: [], revisions: [], exercices: [] });
    expect((await appeler('GET', `/cabinets/${cabinet}/production?depuis=2021-09-15`, associe.jeton)).statut).toBe(400);
  });
});
