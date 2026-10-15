// Inviter quelqu'un dans l'équipe SkanFact (1.25.0 ; base 0118 ; serveur/console/invitations.ts ; docs/console.md C41) :
// le lien, montré une fois, qui ne dit rien quand il ne vaut plus ; rejoindre avec son compte ou en le créant, toujours à
// l'adresse invitée ; le premier code posé à la première connexion, sept jours au plus ; chaque geste au journal.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { quiEstConsole } from '../../serveur/console/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
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
const adresse = (qui: string) => `invit-${qui}${++k}-${Date.now() % 100000}@exemple.tn`;
async function compte(email: string) {
  await appeler('POST', '/inscription', undefined, { email, nom: `Compte ${k}`, motDePasse: MDP });
  return String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil })).corps.jeton);
}
async function membre(qui: string, role: 'direction' | 'support' | 'technique') {
  const email = adresse(qui);
  const jeton = await compte(email);
  const q = await quiEst(ctx, jeton);
  if (!q) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, q, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil });
  const c = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: totp(secret ?? '') });
  return { email, console: String(c.corps.jeton) };
}
const gestes = async (email: string) => (await admin.query(`select g.geste, g.apres from plateforme.geste_console g
   where g.geste like 'equipe.invit%' and g.apres ->> 'email' = $1 order by g.le`, [email])).rows as { geste: string; apres: Record<string, unknown> }[];
const lien = async (direction: string, email: string, role = 'support') =>
  (await appeler('POST', '/console/equipe/invitations', direction, { email, role, motif: 'renfort pour les pilotes' })).corps as { id: string; jeton: string; expire: string };

let direction = '';
beforeAll(async () => {
  await admin.connect();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesConsole(ctx, { veille: null })]);
  await app.ready();
  direction = (await membre('dir', 'direction')).console;
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('inviter quelqu\'un dans l\'équipe (0118)', () => {
  it('la direction seule invite ; le lien se rend une fois, la liste n\'en garde rien ; une nouvelle invitation remplace l\'ancienne', async () => {
    const support = await membre('sup', 'support');
    const email = adresse('nouvelle');
    expect((await appeler('POST', '/console/equipe/invitations', support.console, { email, role: 'support', motif: 'renfort pour les pilotes' })).statut).toBe(403);
    const premier = await lien(direction, email.toUpperCase());
    expect(premier.jeton.length).toBeGreaterThan(20);
    expect(Date.parse(premier.expire) - Date.now()).toBeGreaterThan(6.9 * 24 * 3600_000);
    const liste = await appeler('GET', '/console/equipe', direction);
    const vue = (liste.corps.invitations as { email: string; role: string; expiree: boolean }[]).find((i) => i.email === email);
    expect(vue).toMatchObject({ email, role: 'support', expiree: false });
    expect(JSON.stringify(liste.corps)).not.toContain(premier.jeton);
    const second = await lien(direction, email, 'technique');
    expect((await appeler('POST', '/console/invitation/apercu', undefined, { jeton: premier.jeton })).corps).toEqual({ valable: false });
    expect((await appeler('POST', '/console/invitation/apercu', undefined, { jeton: second.jeton })).corps).toMatchObject({ valable: true, email, role: 'technique', compte: false });
    expect((await gestes(email)).map((g) => g.geste)).toEqual(['equipe.inviter', 'equipe.invitation_renvoyee']);
    // Déjà dans l'équipe : on change son rôle dans la liste, on ne l'invite pas.
    const refus = await appeler('POST', '/console/equipe/invitations', direction, { email: support.email, role: 'technique', motif: 'changer son rôle' });
    expect(refus.statut).toBe(403);
  });

  it('renvoyer donne un lien neuf (l\'ancien ne vaut plus) ; annuler éteint le lien ; un lien passé ou inventé ne dit rien', async () => {
    const email = adresse('renvoi');
    const l = await lien(direction, email);
    const r = await appeler('POST', `/console/equipe/invitations/${l.id}/renvoyer`, direction, { motif: 'elle ne l\'a pas reçu' });
    const neuf = r.corps as { id: string; jeton: string };
    expect((await appeler('POST', '/console/invitation/apercu', undefined, { jeton: l.jeton })).corps.valable).toBe(false);
    expect((await appeler('POST', '/console/invitation/apercu', undefined, { jeton: neuf.jeton })).corps.valable).toBe(true);
    expect((await appeler('POST', `/console/equipe/invitations/${neuf.id}/annuler`, direction, { motif: 'adresse fausse' })).statut).toBe(200);
    expect((await appeler('POST', '/console/invitation/apercu', undefined, { jeton: neuf.jeton })).corps.valable).toBe(false);
    expect((await appeler('POST', `/console/equipe/invitations/${neuf.id}/annuler`, direction, { motif: 'deux fois' })).statut).toBe(403);
    expect((await gestes(email)).map((g) => g.geste)).toEqual(['equipe.inviter', 'equipe.invitation_renvoyee']);
    expect((await admin.query(`select count(*)::int n from plateforme.geste_console where geste = 'equipe.invitation_annulee' and avant ->> 'email' = $1`, [email])).rows[0].n).toBe(1);
    // Passé : la même absence qu'un lien inventé.
    const passe = await lien(direction, adresse('passe'));
    await admin.query(`update plateforme.invitation_console set expire_le = now() - interval '1 minute' where id = $1`, [passe.id]);
    expect((await appeler('POST', '/console/invitation/apercu', undefined, { jeton: passe.jeton })).corps).toEqual({ valable: false });
    expect((await appeler('POST', '/console/invitation/apercu', undefined, { jeton: 'pas-un-vrai-jeton-du-tout' })).corps).toEqual({ valable: false });
    expect((await appeler('POST', '/console/invitation/accepter', undefined, { jeton: passe.jeton, motDePasse: MDP, nom: 'Trop Tard' })).statut).toBe(410);
  });

  it('rejoindre en créant son compte : le nom et la règle des mots de passe ; le lien ne sert qu\'une fois ; au journal', async () => {
    const email = adresse('neuve');
    const l = await lien(direction, email);
    const sansNom = await appeler('POST', '/console/invitation/accepter', undefined, { jeton: l.jeton, motDePasse: MDP });
    expect([sansNom.statut, sansNom.corps.champ]).toEqual([400, 'nom']);
    const court = await appeler('POST', '/console/invitation/accepter', undefined, { jeton: l.jeton, motDePasse: 'court', nom: 'Nour Neuve' });
    expect([court.statut, court.corps.champ]).toEqual([400, 'motDePasse']);
    const ok = await appeler('POST', '/console/invitation/accepter', undefined, { jeton: l.jeton, motDePasse: MDP, nom: 'Nour Neuve' });
    expect(ok.corps).toEqual({ role: 'support', code: false });
    expect((await admin.query(`select e.role from plateforme.equipe e join socle.utilisateur u on u.id = e.utilisateur where u.email = $1 and e.actif`, [email])).rows).toEqual([{ role: 'support' }]);
    expect((await admin.query(`select count(*)::int n from plateforme.geste_console g join socle.utilisateur u on u.id = g.qui where u.email = $1 and g.geste = 'equipe.invitation_acceptee'`, [email])).rows[0].n).toBe(1);
    expect((await appeler('POST', '/console/invitation/accepter', undefined, { jeton: l.jeton, motDePasse: MDP, nom: 'Nour Neuve' })).statut).toBe(410);
  });

  it('rejoindre avec son compte : son mot de passe le prouve (une erreur se compte), son code déjà en place ouvre la console', async () => {
    const email = adresse('ancienne');
    const jeton = await compte(email);
    const q = await quiEst(ctx, jeton);
    if (!q) throw new Error('session attendue');
    const { secret } = await mettreEnPlaceCode(ctx, q, 'application');
    const l = await lien(direction, email, 'technique');
    expect((await appeler('POST', '/console/invitation/apercu', undefined, { jeton: l.jeton })).corps.compte).toBe(true);
    const faux = await appeler('POST', '/console/invitation/accepter', undefined, { jeton: l.jeton, motDePasse: 'pas-le-bon-mot' });
    expect([faux.statut, faux.corps.champ]).toEqual([400, 'motDePasse']);
    expect((await admin.query('select erreurs from socle.tentative where cle = $1', [email])).rows[0]?.erreurs).toBeGreaterThan(0);
    expect((await appeler('POST', '/console/invitation/accepter', undefined, { jeton: l.jeton, motDePasse: MDP })).corps).toEqual({ role: 'technique', code: true });
    const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil });
    expect(r.corps.etat).toBe('code');
    expect((await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: totp(secret ?? '') })).corps.etat).toBe('connecte');
  });

  it('le premier code, à la première connexion : préparé, il n\'active rien ; le premier code juste l\'active et ouvre la session ; passé sept jours, refusé', async () => {
    const email = adresse('premiere');
    const l = await lien(direction, email);
    await appeler('POST', '/console/invitation/accepter', undefined, { jeton: l.jeton, motDePasse: MDP, nom: 'Rim Premiere' });
    const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil });
    expect(r.corps.etat).toBe('pose');
    const cle = String(r.corps.cle);
    expect(r.corps.codesDeSecours).toHaveLength(10);
    expect(String(r.corps.adresseApplication)).toContain(`secret=${cle}`);
    const faux = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: '000000' });
    expect(faux.corps.etat).not.toBe('connecte');
    // Un code de secours n'ouvre pas un code qui n'est pas encore en place.
    const secours = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: String((r.corps.codesDeSecours as string[])[0]) });
    expect(secours.corps.etat).not.toBe('connecte');
    expect((await admin.query('select code_methode from socle.utilisateur where email = $1', [email])).rows[0].code_methode).not.toBe('application');
    const ok = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: totp(cle) });
    expect(ok.corps.etat).toBe('connecte');
    expect((await admin.query('select code_methode from socle.utilisateur where email = $1', [email])).rows[0].code_methode).toBe('application');
    expect((await admin.query(`select g.apres from plateforme.geste_console g join socle.utilisateur u on u.id = g.qui where u.email = $1 and g.geste = 'equipe.premier_code'`, [email])).rows)
      .toEqual([{ apres: { methode: 'application' } }]);
    // Ensuite, la connexion ordinaire : le code de l'application.
    expect((await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil })).corps.etat).toBe('code');
    // Arrivé il y a plus de sept jours sans code : la console le refuse, comme avant.
    const tard = adresse('tard');
    const l2 = await lien(direction, tard);
    await appeler('POST', '/console/invitation/accepter', undefined, { jeton: l2.jeton, motDePasse: MDP, nom: 'Sami Tard' });
    await admin.query(`update plateforme.equipe set ajoute_le = now() - interval '8 days' where utilisateur = (select id from socle.utilisateur where email = $1)`, [tard]);
    const refuse = await appeler('POST', '/console/connexion', undefined, { email: tard, motDePasse: MDP, appareil });
    expect([refuse.statut, refuse.corps.etat]).toEqual([401, 'refuse']);
  });
});

// Deux gestes sur l'équipe en même temps (0123 ; l'audit de la console 1.26.0, C05 et C06). Le premier fait son geste
// dans une transaction qui reste ouverte ; le second agit pendant ce temps ; puis le premier valide. Sans verrou commun,
// le second ne voit pas le premier et passe à côté de ce que celui-ci change.
async function enConsole(jeton: string, sql: string, valeurs: unknown[], porte?: Promise<void>, fait?: () => void) {
  const qc = await quiEstConsole(ctx, jeton);
  if (!qc) throw new Error('session de la console attendue');
  return enTantQue(pool, qc.utilisateur, async (tx) => {
    await tx.query('select set_config(\'app.session_console\', $1, true)', [qc.session]);
    await tx.query(sql, valeurs);
    fait?.();
    await porte;
  });
}
function enDeuxTemps() {
  let lacher = () => {};
  let fait = () => {};
  const porte = new Promise<void>((r) => { lacher = r; });
  const premierFait = new Promise<void>((r) => { fait = r; });
  return { porte, lacher: () => lacher(), fait: () => fait(), premierFait };
}
const idDe = async (email: string) => String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0]?.id);
const pause = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

describe('l\'équipe tient en concurrence (0123)', () => {
  it('l\'audit C05 : deux directions qui se rétrogradent l\'une l\'autre au même moment — une seule y arrive, l\'équipe garde sa direction', async () => {
    const a = await membre('dira', 'direction');
    const b = await membre('dirb', 'direction');
    const [ida, idb] = [await idDe(a.email), await idDe(b.email)];
    // Elles deux seules à la direction le temps de l'essai (les autres repassent au support, puis reviennent).
    const autres = (await admin.query(`update plateforme.equipe set role = 'support' where role = 'direction' and actif and utilisateur <> all($1::uuid[])
      returning utilisateur`, [[ida, idb]])).rows.map((r) => String(r.utilisateur));
    try {
      const t = enDeuxTemps();
      const premier = enConsole(a.console, 'select plateforme.console_changer_role($1, $2, $3)', [idb, 'support', 'B passe au support'], t.porte, t.fait);
      await t.premierFait;
      const second = enConsole(b.console, 'select plateforme.console_changer_role($1, $2, $3)', [ida, 'support', 'A passe au support'])
        .then(() => 'passé', (e: Error) => e.message);
      await pause(300);
      t.lacher();
      await premier;
      // B n'est plus à la direction quand son geste passe enfin : refusé.
      expect(await second).not.toBe('passé');
      expect((await admin.query(`select count(*)::int n from plateforme.equipe where role = 'direction' and actif`)).rows[0]?.n).toBe(1);
      expect((await admin.query('select role from plateforme.equipe where utilisateur = $1', [ida])).rows[0]?.role).toBe('direction');
    } finally {
      await admin.query(`update plateforme.equipe set role = 'direction' where utilisateur = any($1::uuid[])`, [autres]);
    }
  });

  it('un geste qui a attendu le verrou se refait avec le rôle d\'après : rétrogradé pendant l\'attente, il est refusé', async () => {
    const a = await membre('dird', 'direction');
    const b = await membre('dire', 'direction');
    const c = await membre('dirf', 'direction');
    const [idb, idc] = [await idDe(b.email), await idDe(c.email)];
    const t = enDeuxTemps();
    // A rétrograde B ; pendant ce temps, B rétrograde C. Trois directions : la dernière n'est jamais en jeu.
    const premier = enConsole(a.console, 'select plateforme.console_changer_role($1, $2, $3)', [idb, 'support', 'B passe au support'], t.porte, t.fait);
    await t.premierFait;
    const second = enConsole(b.console, 'select plateforme.console_changer_role($1, $2, $3)', [idc, 'technique', 'C passe à la technique'])
      .then(() => 'passé', (e: Error) => e.message);
    await pause(300);
    t.lacher();
    await premier;
    expect(await second).not.toBe('passé');
    expect((await admin.query('select role from plateforme.equipe where utilisateur = $1', [idc])).rows[0]?.role).toBe('direction');
  });

  it('l\'outil de l\'exploitation ne rétrograde pas la dernière personne à la direction (0123)', async () => {
    const seule = await membre('dirg', 'direction');
    const id = await idDe(seule.email);
    const autres = (await admin.query(`update plateforme.equipe set role = 'support' where role = 'direction' and actif and utilisateur <> $1
      returning utilisateur`, [id])).rows.map((r) => String(r.utilisateur));
    try {
      await expect(ajouterALEquipe(admin, seule.email, 'support', 'changer son rôle par l\'outil')).rejects.toThrow(/toujours une personne à la direction/);
      expect((await admin.query('select role from plateforme.equipe where utilisateur = $1', [id])).rows[0]?.role).toBe('direction');
    } finally {
      await admin.query(`update plateforme.equipe set role = 'direction' where utilisateur = any($1::uuid[])`, [autres]);
    }
  });

  it('l\'audit C06 : deux invitations à la même adresse au même moment — un seul lien vaut, celui de la seconde', async () => {
    const autre = await membre('dirc', 'direction');
    const email = adresse('double');
    const t = enDeuxTemps();
    const premier = enConsole(direction, 'select plateforme.console_inviter($1, $2, $3, $4, now(), now() + interval \'7 days\')',
      [email, 'support', 'renfort au support', `essai-c06-un-${Date.now()}`], t.porte, t.fait);
    await t.premierFait;
    const second = enConsole(autre.console, 'select plateforme.console_inviter($1, $2, $3, $4, now(), now() + interval \'7 days\')',
      [email, 'technique', 'renfort à la technique', `essai-c06-deux-${Date.now()}`]).then(() => 'passé', (e: Error) => e.message);
    await pause(300);
    t.lacher();
    await premier;
    expect(await second).toBe('passé');
    const enAttente = (await admin.query('select role from plateforme.invitation_console where email = $1 and acceptee_le is null and annulee_le is null', [email])).rows;
    expect(enAttente).toEqual([{ role: 'technique' }]);
    expect((await gestes(email)).map((g) => g.geste)).toEqual(['equipe.inviter', 'equipe.invitation_renvoyee']);
  });
});
