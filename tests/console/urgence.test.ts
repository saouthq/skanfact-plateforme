// L'accès d'urgence de l'équipe SkanFact (1.43.0 ; base 0135 ; serveur/console/urgence.ts ; docs/console.md C59) : la
// direction l'ouvre pour un autre membre (jamais pour elle-même), la machine pour n'importe qui ; vingt-quatre heures, une
// fois ; le mot de passe reste exigé ; un NOUVEAU code remplace l'ancien et ses codes de secours ; ses sessions tombent ;
// annulé ou passé, rien ne change ; chaque geste au journal ; l'accueil de la direction le dit.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe, urgence as urgenceParLaMachine } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { quiEstConsole } from '../../serveur/console/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { aLAccueil, lireUrgences, quiAttend } from '../../serveur/console/urgence.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown) {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() as Record<string, unknown> };
}
const totp = (secret: string) => codeTotp(depuisBase32(secret), Date.now());
const appareil = { nom: 'Bureau', type: 'navigateur' };
let k = 0;
const adresse = (qui: string) => `urgence-${qui}${++k}-${Date.now() % 100000}@exemple.tn`;
type Personne = { email: string; nom: string; id: string; secret: string; console: string };
async function membre(qui: string, role: 'direction' | 'support' | 'technique'): Promise<Personne> {
  const email = adresse(qui);
  const nom = `Urgence ${qui} ${k}`;
  await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: MDP });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil })).corps.jeton);
  const q = await quiEst(ctx, jeton);
  if (!q) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, q, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  return { email, nom, id: q.utilisateur, secret: secret ?? '', console: await entrer(email, secret ?? '') };
}
async function entrer(email: string, secret: string) {
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil });
  if (r.corps.etat !== 'code') throw new Error(`un défi de code attendu, pas ${String(r.corps.etat)}`);
  return String((await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: totp(secret) })).corps.jeton);
}
const ouvrir = (direction: string, m: Personne, motif = 'téléphone perdu, appelé à son numéro habituel') => appeler('POST', `/console/equipe/${m.id}/urgence`, direction, { motif });
const gestes = async (m: Personne) => (await admin.query(`select g.geste, g.qui, g.role, g.apres from plateforme.geste_console g
   where g.membre = $1 and g.geste like 'equipe.urgence%' order by g.le, g.id`, [m.id])).rows as { geste: string; qui: string | null; role: string | null; apres: Record<string, unknown> | null }[];
const compter = (liste: { geste: string }[]) => liste.reduce<Record<string, number>>((n, g) => ({ ...n, [g.geste]: (n[g.geste] ?? 0) + 1 }), {});

let direction: Personne;
beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille: null })]);
  await app.ready();
  direction = await membre('dir', 'direction');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('l\'accès d\'urgence de l\'équipe (0135)', () => {
  it('la direction seule l\'ouvre, pour un autre ; il ferme ses sessions ; le mot de passe reste exigé ; un nouveau code remplace l\'ancien, une fois', async () => {
    const m = await membre('sup', 'support');
    const secoursAvant = (await admin.query('select count(*)::int n from socle.code_secours where utilisateur = $1 and utilise_le is null', [m.id])).rows[0].n as number;
    expect(secoursAvant).toBe(10);
    // Le support n'ouvre rien ; personne ne s'ouvre un accès à soi-même ; un motif est demandé.
    expect((await ouvrir(m.console, direction)).statut).toBe(403);
    const soi = await ouvrir(direction.console, direction);
    expect(soi.statut).toBe(403);
    expect(String(soi.corps.motif)).toBe('Ton propre accès d\'urgence s\'ouvre par une autre personne de la direction, ou sur la machine du serveur.');
    expect((await ouvrir(direction.console, m, 'x')).statut).toBe(400);
    const ok = await ouvrir(direction.console, m);
    expect(ok.statut).toBe(200);
    const jusqua = Date.parse(String(ok.corps.jusqua));
    expect(jusqua - Date.now()).toBeGreaterThan(23.9 * 3600_000);
    expect(jusqua - Date.now()).toBeLessThan(24.1 * 3600_000);
    // Sa session de la console est tombée : le téléphone perdu peut en tenir une.
    expect(await quiEstConsole(ctx, m.console)).toBeNull();
    // Un mot de passe faux n'ouvre toujours rien.
    expect((await appeler('POST', '/console/connexion', undefined, { email: m.email, motDePasse: 'pas-le-bon-mot', appareil })).statut).toBe(401);
    const r = await appeler('POST', '/console/connexion', undefined, { email: m.email, motDePasse: MDP, appareil });
    expect(r.corps).toMatchObject({ etat: 'pose', urgence: true });
    const cle = String(r.corps.cle);
    expect(cle).not.toBe(m.secret);
    // L'ancien code n'active rien à cette étape : seul le premier code du nouveau.
    expect((await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: totp(m.secret) })).corps.etat).not.toBe('connecte');
    expect((await admin.query('select code_secret from socle.utilisateur where id = $1', [m.id])).rows[0].code_secret).toBe(m.secret);
    const entre = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: totp(cle) });
    expect(entre.corps.etat).toBe('connecte');
    expect((await admin.query('select code_methode, code_secret from socle.utilisateur where id = $1', [m.id])).rows[0]).toEqual({ code_methode: 'application', code_secret: cle });
    // Dix codes de secours neufs, ceux d'avant n'existent plus.
    expect((await admin.query('select count(*)::int n from socle.code_secours where utilisateur = $1', [m.id])).rows[0].n).toBe(10);
    expect((await admin.query('select servi_le is not null s from plateforme.acces_urgence where membre = $1', [m.id])).rows).toEqual([{ s: true }]);
    // Il a servi une fois : la connexion suivante demande le nouveau code, comme avant.
    const ensuite = await appeler('POST', '/console/connexion', undefined, { email: m.email, motDePasse: MDP, appareil });
    expect(ensuite.corps.etat).toBe('code');
    expect((await appeler('POST', '/console/connexion/code', undefined, { defi: ensuite.corps.defi, code: totp(cle) })).corps.etat).toBe('connecte');
    // Au journal : ouvert par la direction, servi par lui ; jamais son premier code.
    const g = await gestes(m);
    expect(compter(g)).toEqual({ 'equipe.urgence_ouverte': 1, 'equipe.urgence_servie': 1 });
    expect(g.find((x) => x.geste === 'equipe.urgence_ouverte')).toMatchObject({ qui: direction.id, role: 'direction', apres: { par: 'direction', role: 'support' } });
    expect(g.find((x) => x.geste === 'equipe.urgence_servie')).toMatchObject({ qui: m.id, role: 'support', apres: { methode: 'application' } });
    expect((await admin.query(`select count(*)::int n from plateforme.geste_console where qui = $1 and geste = 'equipe.premier_code'`, [m.id])).rows[0].n).toBe(0);
  });

  it('annulé, rien ne change pour lui ; annulé pendant qu\'il pose son code, rien ne s\'active ; passé, il n\'ouvre plus rien', async () => {
    const m = await membre('tec', 'technique');
    expect((await ouvrir(direction.console, m)).statut).toBe(200);
    expect((await appeler('POST', `/console/equipe/${m.id}/urgence/annuler`, direction.console, { motif: 'il a retrouvé son téléphone' })).statut).toBe(200);
    const annuler = await appeler('POST', `/console/equipe/${m.id}/urgence/annuler`, direction.console, { motif: 'une seconde fois' });
    expect([annuler.statut, annuler.corps.motif]).toEqual([403, 'Aucun accès d\'urgence n\'attend pour cette personne.']);
    expect((await appeler('POST', '/console/connexion', undefined, { email: m.email, motDePasse: MDP, appareil })).corps.etat).toBe('code');

    // Annulé pendant la pose : le code préparé ne remplace pas l'ancien.
    expect((await ouvrir(direction.console, m)).statut).toBe(200);
    const r = await appeler('POST', '/console/connexion', undefined, { email: m.email, motDePasse: MDP, appareil });
    expect(r.corps.etat).toBe('pose');
    await appeler('POST', `/console/equipe/${m.id}/urgence/annuler`, direction.console, { motif: 'ce n\'était pas lui' });
    const refus = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: totp(String(r.corps.cle)) });
    expect(refus.statut).toBe(401);
    expect(String(refus.corps.motif)).toMatch(/^L'accès d'urgence a été retiré ou a passé ses vingt-quatre heures/);
    expect((await admin.query('select code_secret from socle.utilisateur where id = $1', [m.id])).rows[0].code_secret).toBe(m.secret);

    // Passé ses vingt-quatre heures : la connexion demande l'ancien code.
    expect((await ouvrir(direction.console, m)).statut).toBe(200);
    await admin.query(`update plateforme.acces_urgence set ouvert_le = now() - interval '25 hours', jusqua = now() - interval '1 hour' where membre = $1 and servi_le is null and annule_le is null`, [m.id]);
    expect((await appeler('POST', '/console/connexion', undefined, { email: m.email, motDePasse: MDP, appareil })).corps.etat).toBe('code');
    expect(compter(await gestes(m))).toEqual({ 'equipe.urgence_ouverte': 3, 'equipe.urgence_annulee': 2 });
  });

  it('un nouvel accès remplace celui qui attendait ; retiré de l\'équipe, il n\'ouvre plus rien', async () => {
    const m = await membre('rempl', 'support');
    await ouvrir(direction.console, m);
    await ouvrir(direction.console, m, 'il a rappelé : on recommence');
    expect((await admin.query(`select count(*) filter (where servi_le is null and annule_le is null)::int attend, count(*)::int tous from plateforme.acces_urgence where membre = $1`, [m.id])).rows[0])
      .toEqual({ attend: 1, tous: 2 });
    await appeler('POST', `/console/equipe/${m.id}/retirer`, direction.console, { motif: 'il quitte SkanFact' });
    expect((await appeler('POST', '/console/connexion', undefined, { email: m.email, motDePasse: MDP, appareil })).statut).toBe(401);
  });

  it('la machine l\'ouvre pour n\'importe quel membre, la direction comprise ; l\'équipe et l\'accueil de la direction le disent, jamais au support', async () => {
    const d2 = await membre('dir2', 'direction');
    const support = await membre('lit', 'support');
    const jusqua = await urgenceParLaMachine(admin, d2.email, 'plus personne pour lui rouvrir la console');
    expect(jusqua.getTime() - Date.now()).toBeGreaterThan(23.9 * 3600_000);
    expect((await gestes(d2)).map((g) => [g.geste, g.qui, g.role, g.apres?.par])).toEqual([['equipe.urgence_ouverte', null, null, 'machine']]);
    // Sans motif, la machine refuse aussi.
    await expect(urgenceParLaMachine(admin, d2.email, 'x')).rejects.toThrow(/motif/);

    const equipe = await appeler('GET', '/console/equipe', direction.console);
    const lu = lireUrgences(equipe.corps.urgence);
    expect(quiAttend(lu, d2.id)).toMatchObject({ machine: true, par: null, etat: 'attend' });
    // Le nombre de personnes à la direction : celui de la base.
    expect(lu.directions).toBe((await admin.query(`select count(*)::int n from plateforme.equipe where role = 'direction' and actif`)).rows[0].n);
    const accueil = await appeler('GET', '/console/accueil', direction.console);
    const lignes = (accueil.corps.decider as { sorte: string; nom?: string; machine?: boolean; etat?: string }[]).filter((l) => l.sorte === 'urgence');
    expect(lignes.find((l) => l.nom === d2.nom)).toMatchObject({ machine: true, etat: 'attend' });
    expect((await appeler('GET', '/console/equipe', support.console)).statut).toBe(403);
    expect((accueil.corps.decider as { sorte: string }[]).length).toBeGreaterThan(0);
    const pourLeSupport = await appeler('GET', '/console/accueil', support.console);
    expect((pourLeSupport.corps.decider as { sorte: string }[]).some((l) => l.sorte === 'urgence')).toBe(false);
  });

  it('ce que la base rend se lit prudemment ; l\'accueil garde ce qui attend et ce qui a servi cette semaine', () => {
    const maintenant = new Date('2026-10-16T10:00:00Z');
    const ligne = (x: Record<string, unknown>) => ({ id: 'a', membre: 'm', nom: 'Nadia', ouvertLe: '2026-10-15T09:00:00Z', jusqua: '2026-10-16T09:00:00Z',
      par: 'Skander', machine: false, motif: 'téléphone perdu', serviLe: null, annuleLe: null, etat: 'attend', ...x });
    const lu = lireUrgences({ directions: 2, acces: [
      ligne({}), ligne({ id: 'b', etat: 'servi', serviLe: '2026-10-12T09:00:00Z' }), ligne({ id: 'c', etat: 'servi', serviLe: '2026-10-08T09:00:00Z' }),
      ligne({ id: 'd', etat: 'annule', annuleLe: '2026-10-15T10:00:00Z' }), ligne({ id: 'e', etat: 'passe' }),
      // Illisibles : un état inconnu, servi sans sa date, une date fausse, sans nom.
      ligne({ id: 'x1', etat: 'ouvert' }), ligne({ id: 'x2', etat: 'servi' }), ligne({ id: 'x3', jusqua: 'demain' }), ligne({ id: 'x4', nom: '' }),
      ligne({ id: 'f', machine: true, par: 'Quelqu\'un' }),
    ] });
    expect(lu.acces.map((a) => a.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    // La machine n'a pas de nom, quoi que la ligne dise.
    expect(lu.acces.find((a) => a.id === 'f')?.par).toBeNull();
    expect(aLAccueil(lu, maintenant).map((a) => a.id)).toEqual(['a', 'b', 'f']);
    expect(lireUrgences(null)).toEqual({ directions: 0, acces: [] });
    expect(lireUrgences({ directions: -1, acces: 'rien' })).toEqual({ directions: 0, acces: [] });
  });
});
