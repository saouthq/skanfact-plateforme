// Ton compte dans la console (1.24.0 ; base 0117 ; serveur/console/routes.ts, /console/moi/… ; docs/console.md C40) :
// chaque membre de l'équipe lit son propre compte, quel que soit son rôle, et y change son mot de passe, son code et ses
// codes de secours, par les mêmes étapes que dans l'application (serveur/compte.ts). Chaque geste entre au journal ; le
// mot de passe ferme ses autres sessions ; un code ne change qu'après le premier code juste du nouveau.

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
const sms: { telephone: string; texte: string }[] = [];
const ctx: Contexte = {
  pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')),
  sms: { envoyer: async (telephone, texte) => { sms.push({ telephone, texte }); } },
};
let app: FastifyInstance;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown) {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() as Record<string, unknown> };
}
const totp = (secret: string) => codeTotp(depuisBase32(secret), Date.now());
const dernierSms = () => /(\d{3}) ?(\d{3})\s*$/.exec(sms.at(-1)?.texte ?? '')?.slice(1).join('') ?? ''; // « Ton code SkanFact : 946 282 »
let k = 0;
async function personne(prenom: string) {
  const email = `compte-${prenom.toLowerCase()}${++k}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} Compte${k}`, motDePasse: MDP });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  return { email, jeton: String(c.corps.jeton) };
}
async function entrer(email: string, motDePasse: string, secret: string) {
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const c = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: totp(secret) });
  return { statut: c.statut, jeton: String(c.corps.jeton) };
}
async function membre(prenom: string, role: 'direction' | 'support' | 'technique') {
  const p = await personne(prenom);
  const qui = await quiEst(ctx, p.jeton);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, p.email, role, 'mise en place des essais');
  const e = await entrer(p.email, MDP, secret ?? '');
  const utilisateur = (await admin.query('select id from socle.utilisateur where email = $1', [p.email])).rows[0].id as string;
  return { ...p, secret: secret ?? '', console: e.jeton, utilisateur };
}
const auJournal = async (utilisateur: string) => (await admin.query(`select geste, motif, apres from plateforme.geste_console where qui = $1 and geste like 'equipe.m%' order by le`, [utilisateur]))
  .rows as { geste: string; motif: string; apres: Record<string, unknown> | null }[];

beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille: null })]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('ton compte, dans la console (0117)', () => {
  it('chacun lit le sien, quel que soit son rôle : son rôle, son code, ses codes de secours, ce que son rôle ouvre — jamais le secret', async () => {
    const support = await membre('Sonia', 'support');
    const technique = await membre('Taha', 'technique');
    const r = await appeler('GET', '/console/moi/compte', support.console);
    expect(r.statut).toBe(200);
    expect(r.corps).toMatchObject({ email: support.email, role: 'support', code: 'application', secours: 10, motDePasseChange: false, telephone: null });
    // Ce que le rôle ouvre vient de la liste des gestes du serveur : le support lit ses demandes, pas la mesure.
    expect(r.corps.droits).toContain('console.support.voir');
    expect(r.corps.droits).not.toContain('console.mesure.voir');
    expect(r.corps.droits).not.toContain('console.session');
    const t = await appeler('GET', '/console/moi/compte', technique.console);
    expect(t.corps).toMatchObject({ email: technique.email, role: 'technique' });
    expect(JSON.stringify(r.corps)).not.toContain(support.secret);
    // Une session de l'application n'ouvre pas la console, ni sa fonction dans la base.
    expect((await appeler('GET', '/console/moi/compte', support.jeton)).statut).toBe(401);
    await expect(enTantQue(pool, support.utilisateur, (tx) => tx.query('select plateforme.console_mon_compte(now())'))).rejects.toThrow();
  });

  it('changer son mot de passe : l\'actuel prouvé, la règle du serveur ; ses autres sessions se ferment (console et application), celle-ci reste ; au journal', async () => {
    const m = await membre('Malek', 'support');
    const autre = await entrer(m.email, MDP, m.secret);
    expect(autre.statut).toBe(200);
    const faux = await appeler('POST', '/console/moi/mot-de-passe', m.console, { actuel: 'pas-le-bon-mot', nouveau: 'Un-autre-bon-mot-de-passe' });
    expect([faux.statut, faux.corps.champ]).toEqual([400, 'actuel']);
    const court = await appeler('POST', '/console/moi/mot-de-passe', m.console, { actuel: MDP, nouveau: 'court' });
    expect([court.statut, court.corps.champ]).toEqual([400, 'nouveau']);
    expect(await auJournal(m.utilisateur)).toEqual([]);
    const r = await appeler('POST', '/console/moi/mot-de-passe', m.console, { actuel: MDP, nouveau: 'Un-autre-bon-mot-de-passe' });
    expect(r.corps).toEqual({ ok: true, sessionsFermees: 1 });
    expect((await appeler('GET', '/console/moi/compte', autre.jeton)).statut).toBe(401);
    expect((await appeler('GET', '/moi', m.jeton)).statut).toBe(401);
    const lu = await appeler('GET', '/console/moi/compte', m.console);
    expect(lu.corps.motDePasseChange).toBe(true);
    expect(await auJournal(m.utilisateur)).toEqual([{ geste: 'equipe.mon_mot_de_passe', motif: 'changé depuis Ton compte', apres: { sessionsFermees: 1 } }]);
    // Le nouveau ouvre la console ; l'ancien, plus.
    expect((await entrer(m.email, 'Un-autre-bon-mot-de-passe', m.secret)).statut).toBe(200);
  });

  it('changer de code pour une application : le code actuel prouvé ; préparé, rien ne change ; un code faux ne l\'active pas ; juste, l\'ancien s\'arrête', async () => {
    const m = await membre('Nour', 'technique');
    const sans = await appeler('POST', '/console/moi/code/preparer', m.console, {});
    expect([sans.statut, sans.corps.champ]).toEqual([400, 'code']);
    const p = await appeler('POST', '/console/moi/code/preparer', m.console, { code: totp(m.secret) });
    expect(p.statut).toBe(200);
    const cle = String(p.corps.cle);
    expect(p.corps.codesDeSecours).toHaveLength(10);
    // Préparé : l'ancien code ouvre toujours la console, et rien n'est au journal.
    expect((await entrer(m.email, MDP, m.secret)).statut).toBe(200);
    const faux = await appeler('POST', '/console/moi/code/activer', m.console, { code: '000000' });
    expect([faux.statut, faux.corps.champ]).toEqual([400, 'code']);
    expect(await auJournal(m.utilisateur)).toEqual([]);
    expect((await appeler('POST', '/console/moi/code/activer', m.console, { code: totp(cle) })).statut).toBe(200);
    expect(await auJournal(m.utilisateur)).toEqual([{ geste: 'equipe.mon_code', motif: 'changé depuis Ton compte', apres: { methode: 'application' } }]);
    expect((await entrer(m.email, MDP, m.secret)).statut).not.toBe(200);
    expect((await entrer(m.email, MDP, cle)).statut).toBe(200);
  });

  it('passer au SMS, puis refaire ses codes de secours avec un code reçu par SMS : le numéro reste masqué, chaque geste au journal', async () => {
    const m = await membre('Rim', 'support');
    const p = await appeler('POST', '/console/moi/code/sms/preparer', m.console, { telephone: '20 123 457', code: totp(m.secret) });
    expect(p.corps).toEqual({ telephone: '+216 •• ••• 457' });
    expect(sms.at(-1)?.telephone).toBe('+21620123457');
    const a = await appeler('POST', '/console/moi/code/sms/activer', m.console, { code: dernierSms() });
    expect(a.corps.codesDeSecours).toHaveLength(10);
    const lu = await appeler('GET', '/console/moi/compte', m.console);
    expect(lu.corps).toMatchObject({ code: 'sms', telephone: '+216 •• ••• 457' });
    expect(JSON.stringify(lu.corps)).not.toContain('20123457');
    // Les codes de secours : un code par SMS d'abord (sans lui, refusé).
    expect((await appeler('POST', '/console/moi/codes-secours', m.console, { code: '123456' })).statut).toBe(400);
    expect((await appeler('POST', '/console/moi/code/preuve-sms', m.console)).corps).toEqual({ telephone: '+216 •• ••• 457' });
    const s = await appeler('POST', '/console/moi/codes-secours', m.console, { code: dernierSms() });
    expect(s.corps.codesDeSecours).toHaveLength(10);
    expect((await auJournal(m.utilisateur)).map((x) => [x.geste, x.apres])).toEqual([['equipe.mon_code', { methode: 'sms' }], ['equipe.mes_codes_secours', null]]);
  });

  it('la base refuse un geste inconnu sur son compte', async () => {
    const m = await membre('Ines', 'support');
    const session = (await admin.query('select id from plateforme.session_console where utilisateur = $1 and fermee_le is null', [m.utilisateur])).rows[0].id as string;
    await expect(enTantQue(pool, m.utilisateur, async (tx) => {
      await tx.query(`select set_config('app.session_console', $1, true)`, [session]);
      await tx.query(`select plateforme.console_mon_compte_change('role', now())`);
    })).rejects.toThrow(/ce geste sur ton compte n'existe pas/);
  });
});
