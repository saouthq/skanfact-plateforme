// 1.388.76 — La version minimale imposée (pilotage depuis la console, point 6 ; base 0231). Ce que le serveur garantit :
//   - le titulaire de la console seul impose la version EN LIGNE (jamais une autre), avec son motif, et la retire ;
//   - un écran qui se dit plus ancien voit le bandeau « recharge la page », et chaque enregistrement lui est refusé (426) ;
//   - un écran à jour, une intégration qui ne dit pas sa version, un serveur sans numéro : jamais refusés.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe, titulaire as designerTitulaire } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { numeroDe, plusAncien, routesVersionMinimale } from '../../serveur/version-minimale.ts';
import { routesMessageClients } from '../../serveur/console/message-clients.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'version-minimale-')), 'veille.json');
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, version: '2.0.0 · essai' };
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function inscrire(qui: string) {
  const email = `version-${qui}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${qui} ${n}`, motDePasse: MDP });
  return { email, jeton: String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
}
async function membre(prenom: string, role: 'direction' | 'support') {
  const { email, jeton: appli } = await inscrire(prenom);
  const qui = await quiEst(ctx, appli);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) });
  return { appli, console: String(k.corps.jeton), nom: `${prenom} ${n}`, email };
}
let amira: Awaited<ReturnType<typeof membre>>;
let karim: Awaited<ReturnType<typeof membre>>;
const nettoyer = () => admin.query("delete from plateforme.version_minimale where motif like 'Essai version%'");

beforeAll(async () => {
  await admin.connect();
  await nettoyer();
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesV10(ctx), ...routesConsole(ctx, { veille }), ...routesMessageClients(), ...routesVersionMinimale(ctx)]);
  await app.ready();
  amira = await membre('amira', 'direction');
  karim = await membre('karim', 'support');
  // Amira pilote les modules : c'est le titulaire (0226) ; une autre personne de la direction ne le peut pas.
  if (!(await admin.query('select titulaire from plateforme.equipe e join socle.utilisateur u on u.id = e.utilisateur where u.email = $1', [amira.email])).rows[0]?.titulaire) {
    await designerTitulaire(admin, amira.email, 'mise en place des essais');
  }
});
afterAll(async () => {
  await nettoyer();
  await app.close(); await admin.end(); await pool.end();
});
// Un appel qui dit la version de son écran (l'en-tête que pose le pont).
async function depuisEcran(methode: 'GET' | 'POST' | 'PUT', url: string, jeton: string, code: string | null, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: { authorization: `Bearer ${jeton}`, ...(code === null ? {} : { 'x-skanfact-code': code }) }, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}

describe('les versions (pur)', () => {
  it('le numéro se lit dans la marque de la page, sinon rien', () => {
    expect(numeroDe('1.388.76 · abc1234')).toEqual([1, 388, 76]);
    expect(numeroDe('1.388.76')).toEqual([1, 388, 76]);
    expect(numeroDe('dev')).toBeNull();
    expect(numeroDe('')).toBeNull();
    expect(numeroDe(undefined)).toBeNull();
  });
  it('plus ancien se compare nombre par nombre (1.9.10 vient après 1.9.9) ; une version illisible ne l\'est jamais', () => {
    expect(plusAncien('1.9.9', '1.9.10')).toBe(true);
    expect(plusAncien('1.10.0', '1.9.10')).toBe(false);
    expect(plusAncien('1.388.75', '1.388.76')).toBe(true);
    expect(plusAncien('1.388.76', '1.388.76')).toBe(false);
    expect(plusAncien('2.0.0', '1.388.76')).toBe(false);
    expect(plusAncien('dev', '1.388.76')).toBe(false);
    expect(plusAncien(undefined, '1.388.76')).toBe(false);
  });
});

describe('la version minimale (base et serveur)', () => {
  it('imposer la version en ligne, refuser un écran plus ancien, laisser passer les autres, retirer', async () => {
    const { jeton } = await inscrire('ecran');
    const ent = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: 'Atelier version' })).corps.id);
    const ecrire = (code: string | null) => depuisEcran('PUT', `/entreprises/${ent}/volontaire-beta`, jeton, code, { volontaire: true });
    const bandeau = async (code: string | null) => (await depuisEcran('GET', `/entreprises/${ent}/message`, jeton, code)).corps.message as Corps | null;

    // Rien d'imposé : l'écran le plus ancien enregistre.
    expect((await ecrire('1.0.0')).statut).toBe(200);
    expect(await bandeau('1.0.0')).toBeNull();

    // Le support lit (la version en ligne comprise), n'impose pas ; un motif trop court est refusé.
    const lu0 = (await appeler('GET', '/console/version-minimale', karim.console)).corps;
    expect(lu0).toMatchObject({ enLigne: '2.0.0', titulaire: false });
    expect((await appeler('POST', '/console/version-minimale', karim.console, { motif: 'Essai version support' })).statut).toBe(403);
    expect((await appeler('POST', '/console/version-minimale', amira.console, { motif: 'ok' })).statut).toBeGreaterThanOrEqual(400);
    // Retirer quand rien n'est imposé : la base le dit.
    const rien = await appeler('POST', '/console/version-minimale', amira.console, { motif: 'Essai version rien', retirer: true });
    expect(rien.statut).toBeGreaterThanOrEqual(400);
    expect(String(rien.corps.motif)).toMatch(/aucune version minimale n'est imposée/i);

    // Imposer : la version en ligne, jamais une autre (le corps n'en porte pas).
    const posee = await appeler('POST', '/console/version-minimale', amira.console, { motif: 'Essai version imposée', message: 'Elle corrige la retenue.' });
    expect(posee.statut).toBe(200);
    expect(posee.corps).toMatchObject({ version: '2.0.0' });

    // Un écran plus ancien : refusé (426, jamais 409 que l'application lit comme un conflit), avec la phrase et le message ; le bandeau passe devant tout.
    const refus = await ecrire('1.388.76');
    expect(refus.statut).toBe(426);
    expect(String(refus.corps.motif)).toMatch(/^Une correction importante de SkanFact vient d'être mise en ligne : recharge la page pour continuer\..* Elle corrige la retenue\.$/);
    expect(refus.corps.versionTropAncienne).toEqual({ minimale: '2.0.0', message: 'Elle corrige la retenue.' });
    expect(await bandeau('1.388.76 · abc1234')).toMatchObject({ sorte: 'version', texte: 'Une correction importante est en ligne : recharge la page pour continuer d\'enregistrer. Elle corrige la retenue.' });
    // L'écran lit toujours ce qu'il a.
    expect((await depuisEcran('GET', `/entreprises/${ent}/message`, jeton, '1.388.76')).statut).toBe(200);
    // Un écran à jour, une intégration sans en-tête, un écran « dev » : rien ne change pour eux.
    expect((await ecrire('2.0.0')).statut).toBe(200);
    expect((await ecrire('2.0.1')).statut).toBe(200);
    expect((await ecrire(null)).statut).toBe(200);
    expect((await ecrire('dev')).statut).toBe(200);
    expect(await bandeau('2.0.0')).toBeNull();
    expect(await bandeau(null)).toBeNull();

    // La même deux fois : refusé ; la console la montre, avec qui l'a imposée.
    const deux = await appeler('POST', '/console/version-minimale', amira.console, { motif: 'Essai version deux fois', message: 'Elle corrige la retenue.' });
    expect(String(deux.corps.motif)).toMatch(/déjà imposée/i);
    const lu = (await appeler('GET', '/console/version-minimale', karim.console)).corps as { lignes: { version: string | null; motif: string; par: string | null }[] };
    expect(lu.lignes[0]).toMatchObject({ version: '2.0.0', motif: 'Essai version imposée', par: amira.nom });

    // Retirer : l'écran ancien enregistre de nouveau, le bandeau disparaît, le journal garde les deux gestes.
    expect((await appeler('POST', '/console/version-minimale', karim.console, { motif: 'Essai version support', retirer: true })).statut).toBe(403);
    expect((await appeler('POST', '/console/version-minimale', amira.console, { motif: 'Essai version retirée', retirer: true })).statut).toBe(200);
    expect((await ecrire('1.388.76')).statut).toBe(200);
    expect(await bandeau('1.388.76')).toBeNull();
    const journal = (await admin.query("select geste from plateforme.geste_console where geste like 'service.version_minimale%' and motif like 'Essai version%' order by le")).rows.map((r) => r.geste);
    expect(journal).toEqual(['service.version_minimale', 'service.version_minimale_retiree']);
  });

  it('un serveur sans numéro (un essai) n\'a rien à imposer', async () => {
    const avant = ctx.version;
    ctx.version = 'dev';
    try {
      const r = await appeler('POST', '/console/version-minimale', amira.console, { motif: 'Essai version sans numéro' });
      expect(r.statut).toBe(409);
      expect(String(r.corps.motif)).toMatch(/pas de numéro/i);
      expect((await appeler('GET', '/console/version-minimale', amira.console)).corps).toMatchObject({ enLigne: null });
    } finally { if (avant === undefined) delete ctx.version; else ctx.version = avant; }
  });
});
