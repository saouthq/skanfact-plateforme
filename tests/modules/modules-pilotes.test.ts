// 1.388.69 — Les modules pilotés depuis la console (0226 ; Skander, 25/11/2026). Ce que le serveur garantit :
//   - l'ordre de décision : l'exception d'une entreprise, puis l'état posé pour tous, puis la variable du serveur ;
//   - la direction seule pose un état, avec son motif, au journal ; le support lit ; « serveur » efface ;
//   - `/moi` rend à chacun ses listes (générales et par entreprise), sans motif ni auteur ;
//   - un module à venir ou fermé se refuse aussi côté serveur (le paiement en ligne, la lecture par l'IA).
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe, titulaire as designerTitulaire } from '../../base/equipe.ts';
import { declarerGestesAchats } from '../../serveur/achats/gestes.ts';
import { routesAchats } from '../../serveur/achats/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { etatModule, listesModules, moduleUtilisable, MODULES_PILOTES } from '../../serveur/modules-pilotes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'modules-')), 'veille.json');
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function inscrire(qui: string) {
  const email = `modules-${qui}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
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
// La lecture par l'IA est « disponible » ici (une clé simulée) : seul l'état du module décide.
ctx.lecteurIA = { disponible: true, lire: async () => { throw new Error('la lecture ne doit pas partir dans ces essais'); } };
const poser = (corps: Corps, jeton = amira.console) => appeler('POST', '/console/modules', jeton, corps);
const nettoyer = (ent: string) => admin.query('delete from plateforme.module_etat where entreprise = $1', [ent]);
const entreprises: string[] = [];

beforeAll(async () => {
  await admin.connect();
  declarerGestesVentes();
  declarerGestesAchats();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesAchats(ctx), ...routesV10(ctx), ...routesConsole(ctx, { veille })]);
  await app.ready();
  amira = await membre('amira', 'direction');
  karim = await membre('karim', 'support');
  // Amira pilote les modules : c'est le titulaire (0226) ; une autre personne de la direction ne le peut pas.
  if (!(await admin.query('select titulaire from plateforme.equipe e join socle.utilisateur u on u.id = e.utilisateur where u.email = $1', [amira.email])).rows[0]?.titulaire) {
    await designerTitulaire(admin, amira.email, 'mise en place des essais');
  }
});
afterAll(async () => {
  for (const e of entreprises) await nettoyer(e);
  await app.close(); await admin.end(); await pool.end();
});

describe('l\'ordre de décision (pur)', () => {
  const env = { SKANFACT_A_VENIR: 'caisse', SKANFACT_BETA: 'paie' };
  it('l\'exception de l\'entreprise, puis le général, puis la variable du serveur', () => {
    expect(etatModule([], 'caisse', null, env)).toBe('a_venir');
    expect(etatModule([], 'paie', null, env)).toBe('beta');
    expect(etatModule([], 'stock', null, env)).toBe('ouvert');
    const lignes = [{ module: 'caisse', entreprise: null, etat: 'ouvert' as const }, { module: 'caisse', entreprise: 'E1', etat: 'ferme' as const }];
    expect(etatModule(lignes, 'caisse', null, env)).toBe('ouvert');
    expect(etatModule(lignes, 'caisse', 'E2', env)).toBe('ouvert');
    expect(etatModule(lignes, 'caisse', 'E1', env)).toBe('ferme');
  });
  it('les listes rendent les identifiants des pages, et un module à plusieurs pages les rend toutes', () => {
    const l = listesModules([{ module: 'pilotage', entreprise: null, etat: 'ferme' }, { module: 'achats', entreprise: null, etat: 'beta' }], null, { SKANFACT_A_VENIR: '', SKANFACT_BETA: '' });
    expect(l.ferme).toEqual(['tresorerie', 'marges', 'stats']);
    expect(l.beta).toEqual(['achats', 'fournisseurs']);
    expect(l.aVenir).toEqual([]);
    expect(moduleUtilisable('beta')).toBe(true);
    expect(moduleUtilisable('a_venir')).toBe(false);
    expect(moduleUtilisable('ferme')).toBe(false);
    expect(new Set(MODULES_PILOTES.map((m) => m.id)).size).toBe(MODULES_PILOTES.length);
  });
});

describe('la console pose l\'état d\'un module', () => {
  it('la direction seule, avec son motif ; le support lit ; le journal garde avant et après ; « serveur » efface', async () => {
    const { jeton } = await inscrire('nadia');
    const ent = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: 'Boulangerie des essais modules' })).corps.id);
    entreprises.push(ent);
    expect((await poser({ module: 'caisse', entreprise: ent, etat: 'ouvert', motif: 'Pilote' }, karim.console)).statut).toBe(403);
    expect((await poser({ module: 'caisse', entreprise: ent, etat: 'ouvert', motif: 'ok' })).statut).toBeGreaterThanOrEqual(400);
    expect((await poser({ module: 'inconnu', entreprise: ent, etat: 'ouvert', motif: 'Pilote' })).statut).toBe(404);
    expect((await poser({ module: 'caisse', entreprise: ent, etat: 'ouvert', motif: 'La boulangerie pilote' })).statut).toBe(200);
    const lu = await appeler('GET', `/console/modules?entreprise=${ent}`, karim.console);
    expect(lu.statut).toBe(200);
    expect((lu.corps.entreprise as Corps).nom).toBe('Boulangerie des essais modules');
    expect((lu.corps.poses as Corps[]).find((p) => p.entreprise === ent)).toMatchObject({ module: 'caisse', etat: 'ouvert', motif: 'La boulangerie pilote', par: amira.nom });
    const geste = (await admin.query(`select avant, apres from plateforme.geste_console where geste = 'modules.etat' and entreprise = $1 order by le desc, id desc limit 1`, [ent])).rows[0];
    expect(geste).toEqual({ avant: { module: 'caisse', etat: 'serveur' }, apres: { module: 'caisse', etat: 'ouvert', message: null } });
    // /moi : l'entreprise porte ses propres listes, sans motif ni auteur.
    const moi = (await appeler('GET', '/moi', jeton)).corps as { entreprises: { id: string; modules: { aVenir: string[] } }[] };
    expect(moi.entreprises.find((e) => e.id === ent)?.modules.aVenir).not.toContain('caisse');
    expect(JSON.stringify(moi)).not.toContain('La boulangerie pilote');
    expect((await poser({ module: 'caisse', entreprise: ent, etat: 'serveur', motif: 'Fin du pilote' })).statut).toBe(200);
    expect((await admin.query('select count(*)::int n from plateforme.module_etat where entreprise = $1', [ent])).rows[0].n).toBe(0);
  });
});

describe('un module à venir ou fermé se refuse aussi côté serveur', () => {
  it('la lecture par l\'IA : ni proposée, ni servie', async () => {
    const { jeton } = await inscrire('ines');
    const ent = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: 'Atelier des essais IA' })).corps.id);
    entreprises.push(ent);
    expect((await appeler('GET', `/entreprises/${ent}/achats/lecture`, jeton)).corps).toMatchObject({ disponible: true });
    expect((await poser({ module: 'ia', entreprise: ent, etat: 'a_venir', motif: 'Pas encore pour lui' })).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${ent}/achats/lecture`, jeton)).corps).toMatchObject({ disponible: false, ia: false });
    expect((await appeler('POST', `/entreprises/${ent}/achats/lecture`, jeton, { nom: 'f.png', contenu: 'AAAA', ia: true })).statut).toBe(503);
    const moi = (await appeler('GET', '/moi', jeton)).corps as { entreprises: { id: string; modules: { aVenir: string[] } }[] };
    expect(moi.entreprises.find((e) => e.id === ent)?.modules.aVenir).toContain('ia');
  });
  it('le paiement en ligne : l\'état posé se lit par socle.etat_module, l\'exception passe avant', async () => {
    const { jeton } = await inscrire('sami');
    const ent = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: 'Épicerie des essais paiement' })).corps.id);
    entreprises.push(ent);
    const etat = async () => (await admin.query('select socle.etat_module($1, $2) v', ['paiement', ent])).rows[0].v as string | null;
    expect(await etat()).toBe(null);
    await poser({ module: 'paiement', entreprise: ent, etat: 'ferme', motif: 'Konnect jamais essayé' });
    expect(await etat()).toBe('ferme');
  });
});

describe('le titulaire de la console (« pour moi, pas pour les collaborateurs »)', () => {
  it('une autre personne de la direction lit, et se voit refuser le geste', async () => {
    const leila = await membre('leila', 'direction');
    const lu = await appeler('GET', '/console/modules', leila.console);
    expect(lu.statut).toBe(200);
    expect(lu.corps.titulaire).toBe(false);
    expect(lu.corps.nomTitulaire).toBe(amira.nom);
    expect((await appeler('GET', '/console/modules', amira.console)).corps.titulaire).toBe(true);
    const r = await poser({ module: 'stock', entreprise: null, etat: 'beta', motif: 'Essai du titulaire' }, leila.console);
    expect(r.statut).toBe(403);
    expect(JSON.stringify(r.corps)).toContain('titulaire');
  });
  it('il n\'y a jamais deux titulaires, et la console suit celui qui est désigné', async () => {
    await expect(admin.query(`update plateforme.equipe set titulaire = true where role = 'direction' and actif and not titulaire`)).rejects.toThrow();
    expect(Number((await admin.query('select count(*) n from plateforme.equipe where titulaire')).rows[0].n)).toBe(1);
    const en = (await admin.query('select u.email from socle.utilisateur u where u.id = plateforme.titulaire_console()')).rows[0]?.email;
    expect(en).toBe(amira.email);
  });
});
describe('en pause plutôt que caché (Skander : « les gens qui ont du stock, si on désactive ils ne verront plus rien »)', () => {
  it('pur : fermé ou à venir avec des données → pause (pages et module) ; sans données → caché', () => {
    const env = { SKANFACT_A_VENIR: '', SKANFACT_BETA: '' };
    const lignes = [{ module: 'stock', entreprise: null, etat: 'ferme' as const }, { module: 'paie', entreprise: null, etat: 'a_venir' as const }, { module: 'achats', entreprise: null, etat: 'ferme' as const }];
    const l = listesModules(lignes, 'E1', env, ['stock', 'paie']);
    expect(l.pause).toEqual(expect.arrayContaining(['stock', 'garanties', 'paie']));
    expect(l.ferme).not.toContain('stock');
    expect(l.aVenir).not.toContain('paie');
    expect(l.ferme).toEqual(['achats', 'fournisseurs']);
    // Un module ouvert ne passe jamais en pause, même plein.
    expect(listesModules([], 'E1', env, ['stock']).pause).toEqual([]);
  });
  it('/moi : une entreprise qui a du stock garde Stock en pause ; une autre ne le voit plus ; la console compte qui s\'en sert', async () => {
    const { jeton } = await inscrire('stock');
    const avec = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: 'Quincaillerie avec stock' })).corps.id);
    const sans = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: 'Atelier sans stock' })).corps.id);
    entreprises.push(avec, sans);
    await admin.query(`insert into socle.dossier_v10 (entreprise, collection, cle, contenu) values ($1, 'stockAdjustments', 'adj-1', '{"id":"adj-1"}')`, [avec]);
    expect((await poser({ module: 'stock', entreprise: avec, etat: 'ferme', motif: 'Défaut du stock' })).statut).toBe(200);
    expect((await poser({ module: 'stock', entreprise: sans, etat: 'ferme', motif: 'Défaut du stock' })).statut).toBe(200);
    const moi = (await appeler('GET', '/moi', jeton)).corps as { entreprises: { id: string; modules: { ferme: string[]; pause: string[] } }[] };
    const mA = moi.entreprises.find((e) => e.id === avec)?.modules;
    const mS = moi.entreprises.find((e) => e.id === sans)?.modules;
    expect(mA?.pause).toContain('stock');
    expect(mA?.ferme).not.toContain('stock');
    expect(mS?.ferme).toContain('stock');
    expect(mS?.pause).not.toContain('stock');
    const lu = (await appeler('GET', '/console/modules', amira.console)).corps as { modules: { id: string; avecDonnees: number | null }[] };
    expect(lu.modules.find((m) => m.id === 'stock')?.avecDonnees).toBeGreaterThanOrEqual(1);
    expect(lu.modules.find((m) => m.id === 'efacture')?.avecDonnees).toBeNull();
    await admin.query(`delete from socle.dossier_v10 where entreprise = $1`, [avec]);
  });
});

describe('le message aux clients d\'un module (la maintenance annoncée)', () => {
  it('se pose avec l\'état, arrive dans /moi sous chaque page du module, sans le motif ; « serveur » ne le prend pas', async () => {
    const { jeton } = await inscrire('message');
    const ent = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: 'Librairie du message' })).corps.id);
    entreprises.push(ent);
    expect((await poser({ module: 'pilotage', entreprise: ent, etat: 'ouvert', motif: 'Maintenance du soir', message: 'ok' })).statut).toBeGreaterThanOrEqual(400);
    expect((await poser({ module: 'pilotage', entreprise: ent, etat: 'serveur', motif: 'Retour', message: 'Un message qui ne va nulle part' })).statut).toBeGreaterThanOrEqual(400);
    expect((await poser({ module: 'pilotage', entreprise: ent, etat: 'ouvert', motif: 'Maintenance du soir', message: 'Les statistiques se recalculent ce soir entre 22 h et 23 h.' })).statut).toBe(200);
    const moi = (await appeler('GET', '/moi', jeton)).corps as { entreprises: { id: string; modules: { messages: Record<string, string> } }[] };
    const msg = moi.entreprises.find((e) => e.id === ent)?.modules.messages ?? {};
    expect(msg.stats).toBe('Les statistiques se recalculent ce soir entre 22 h et 23 h.');
    expect(msg.tresorerie).toBe(msg.stats);
    expect(JSON.stringify(moi)).not.toContain('Maintenance du soir');
    const geste = (await admin.query(`select apres from plateforme.geste_console where geste = 'modules.etat' and entreprise = $1 order by le desc, id desc limit 1`, [ent])).rows[0];
    expect(geste.apres.message).toBe('Les statistiques se recalculent ce soir entre 22 h et 23 h.');
  });
});
