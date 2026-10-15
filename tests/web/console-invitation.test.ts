// Inviter quelqu'un, à la souris (1.25.0 ; docs/console.md C41 ; web/console/src/ecrans/Equipe.tsx, Invitation.tsx,
// Entree.tsx ; base 0118). Ce que le parcours vérifie :
//   - la direction invite : le lien se montre une fois, avec ses trois façons de le transmettre ; l'invitation attend
//     dans la liste et dans « À régler » ; « Renvoyer » donne un lien neuf (l'ancien ne vaut plus), « Annuler » l'éteint ;
//   - l'invité ouvre le lien sans session : qui l'invite, son rôle, son adresse ; il crée son compte (son nom manque :
//     le champ le dit) ; puis entre, l'adresse déjà remplie, et pose son code : sans « Je les ai mis de côté », rien ;
//     avec, le premier code juste ouvre la console ;
//   - un lien qui ne vaut plus le dit, et mène à la connexion ;
//   - en clair et en sombre, à l'ordinateur et au téléphone, l'instrument ne trouve rien (l'équipe, la page de
//     l'invitation, la pose du code) ; en langue factice, tout vient du catalogue.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';
import { mesurerLaConsole, type EcranConsole } from './instrument-console.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();
const totp = (secret: string) => codeTotp(depuisBase32(secret), Date.now());

describe('inviter quelqu\'un, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-invitation-'));
  const erreurs: string[] = [];
  let direction = '';
  let n = 0;
  const adresse = (qui: string) => `console-invitation-${qui}-${Date.now()}-${++n}@exemple.tn`;

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const ouvrirAvec = async (jeton: string | null, o: { largeur?: number; theme?: 'clair' | 'sombre'; factice?: boolean; hash?: string } = {}) => {
    const largeur = o.largeur ?? 1440;
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 600 ? 844 : 900 }, locale: 'fr-FR' });
    await cx.addInitScript(([j, t]) => {
      if (j) sessionStorage.setItem('skanfact.console.jeton', j);
      if (t) localStorage.setItem('skanfact.console.theme', t);
    }, [jeton, o.theme ?? null] as const);
    await cx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: serveur.adresse });
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/${o.factice ? '?langue=factice' : ''}${o.hash ?? '#/equipe'}`);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  const inviterParApi = async (email: string) => (await api('POST', '/console/equipe/invitations', direction, { email, role: 'support', motif: 'essai de la page de l\'invité' })).corps as { id: string; jeton: string };

  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    const email = adresse('direction');
    await api('POST', '/inscription', undefined, { email, nom: 'Hela Invitante', motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, 'direction', 'essai des invitations à la souris');
    const r = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    direction = String((await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: totp(secret) })).corps.jeton);
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true });
  });

  it('la direction invite : le lien une fois, puis l\'invitation attend ; renvoyer donne un lien neuf, annuler l\'éteint', async () => {
    const email = adresse('yosra');
    const p = await ouvrirAvec(direction);
    await p.locator('h1', { hasText: 'L\'équipe' }).waitFor({ timeout: 20_000 });
    await cliquer(p.getByRole('button', { name: 'Inviter quelqu\'un' }));
    const f = p.getByRole('dialog');
    await f.getByLabel('Son adresse e-mail').fill(email);
    await f.getByLabel('Rôle').selectOption('support');
    await f.getByLabel('Motif', { exact: true }).fill('Renfort du support pour les pilotes');
    await cliquer(f.getByRole('button', { name: 'Inviter', exact: true }));
    const adresseLien = net(await p.locator('.c-inv-adresse').innerText());
    const jeton = /#\/invitation\/([A-Za-z0-9_-]+)$/.exec(adresseLien)?.[1] ?? '';
    expect(jeton.length).toBeGreaterThan(20);
    expect(await p.getByRole('link', { name: 'Envoyer par WhatsApp' }).getAttribute('href')).toContain(encodeURIComponent(adresseLien));
    expect(await p.getByRole('link', { name: 'Envoyer par e-mail' }).getAttribute('href')).toMatch(new RegExp(`^mailto:${email.replace(/[.+]/g, '\\$&')}\\?`));
    await cliquer(p.getByRole('button', { name: 'Copier le lien' }));
    expect(await p.evaluate(() => navigator.clipboard.readText())).toBe(adresseLien);
    await cliquer(p.getByRole('button', { name: 'C\'est transmis' }));
    // Elle attend : une ligne de la liste, et « À régler ».
    const ligne = p.locator('tr.c-eq-invitation', { hasText: email });
    await ligne.waitFor({ timeout: 20_000 });
    expect(net(await p.locator('.c-eq-regler').innerText())).toContain(`${email} n'a pas encore ouvert son invitation`);
    // Renvoyer, depuis le menu de la ligne : un lien neuf ; l'ancien ne vaut plus.
    await cliquer(ligne.getByRole('button', { name: new RegExp(`invitation de ${email.replace(/[.+]/g, '\\$&')}`) }));
    await cliquer(p.locator('.c-menu-liste button', { hasText: 'Renvoyer l\'invitation' }));
    await p.getByRole('dialog').getByLabel('Motif', { exact: true }).fill('Elle ne l\'a pas reçue');
    await cliquer(p.getByRole('dialog').getByRole('button', { name: 'Donner un nouveau lien' }));
    const neuf = /#\/invitation\/([A-Za-z0-9_-]+)$/.exec(net(await p.locator('.c-inv-adresse').innerText()))?.[1] ?? '';
    expect(neuf).not.toBe(jeton);
    expect((await api('POST', '/console/invitation/apercu', undefined, { jeton })).corps.valable).toBe(false);
    await cliquer(p.getByRole('button', { name: 'C\'est transmis' }));
    // Annuler : la ligne s'en va, le lien ne vaut plus.
    await cliquer(ligne.getByRole('button', { name: new RegExp(`invitation de ${email.replace(/[.+]/g, '\\$&')}`) }));
    await cliquer(p.locator('.c-menu-liste button', { hasText: 'Annuler l\'invitation' }));
    await p.getByRole('dialog').getByLabel('Motif', { exact: true }).fill('Adresse fausse');
    await cliquer(p.getByRole('dialog').getByRole('button', { name: 'Annuler l\'invitation' }));
    await expect.poll(() => ligne.count()).toBe(0);
    expect((await api('POST', '/console/invitation/apercu', undefined, { jeton: neuf })).corps.valable).toBe(false);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('l\'invité : qui l\'invite et à quel rôle ; son compte créé ; puis il entre et pose son code, ses codes de secours mis de côté', async () => {
    const email = adresse('nour');
    const { jeton } = await inviterParApi(email);
    const p = await ouvrirAvec(null, { hash: `#/invitation/${jeton}` });
    await p.locator('h1', { hasText: 'Rejoindre l\'équipe SkanFact' }).waitFor({ timeout: 20_000 });
    expect(net(await p.locator('.c-forme-sous').first().innerText())).toMatch(/^Hela Invitante t'invite dans l'équipe, au rôle support\./);
    expect(net(await p.locator('.c-inv-faits').innerText())).toContain(email);
    await p.getByLabel('Choisis ton mot de passe').fill(MDP);
    await cliquer(p.getByRole('button', { name: 'Créer mon compte et rejoindre l\'équipe' }));
    await expect.poll(() => p.getByLabel('Ton nom').getAttribute('aria-invalid')).toBe('true');
    await p.getByLabel('Ton nom').fill('Nour Invitée');
    await cliquer(p.getByRole('button', { name: 'Créer mon compte et rejoindre l\'équipe' }));
    await p.locator('h1', { hasText: 'Tu fais partie de l\'équipe' }).waitFor({ timeout: 20_000 });
    await cliquer(p.getByRole('button', { name: 'Entrer dans la console' }));
    // L'adresse est déjà là ; le mot de passe, puis la pose du code.
    expect(await p.getByLabel('Ton adresse e-mail').inputValue()).toBe(email);
    await p.getByLabel('Ton mot de passe', { exact: true }).fill(MDP);
    await cliquer(p.getByRole('button', { name: 'Continuer' }));
    await p.locator('h1', { hasText: 'Pose ton code' }).waitFor({ timeout: 20_000 });
    expect(await p.locator('.c-cp-secours li').count()).toBe(10);
    const cle = (await p.locator('.c-cp-cle').innerText()).replace(/\s/g, '');
    await p.getByLabel('Le code que donne l\'application').fill(totp(cle));
    await cliquer(p.getByRole('button', { name: 'Activer le code et entrer' }));
    expect(net(await p.locator('.c-alerte').innerText())).toMatch(/Je les ai mis de côté/);
    expect((await admin.query('select code_methode from socle.utilisateur where email = $1', [email])).rows[0].code_methode).not.toBe('application');
    await p.getByRole('checkbox', { name: 'Je les ai mis de côté' }).check();
    await p.getByLabel('Le code que donne l\'application').fill(totp(cle));
    await cliquer(p.getByRole('button', { name: 'Activer le code et entrer' }));
    await p.locator('.c-nav').first().waitFor({ timeout: 20_000 });
    expect(net(await p.locator('h1').first().innerText())).toBe('Bonjour Nour');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('un lien qui ne vaut plus le dit, et mène à la connexion', async () => {
    const p = await ouvrirAvec(null, { hash: '#/invitation/pas-un-vrai-lien-du-tout' });
    await p.locator('h1', { hasText: 'Ce lien ne vaut plus' }).waitFor({ timeout: 20_000 });
    await cliquer(p.getByRole('button', { name: 'Aller à la connexion' }));
    await p.getByLabel('Ton adresse e-mail').waitFor({ timeout: 20_000 });
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('en clair et en sombre, à l\'ordinateur et au téléphone, l\'instrument ne trouve rien ; en langue factice, tout vient du catalogue', async () => {
    // La pose du code : un membre arrivé par son invitation, qui n'a pas encore de code (rejouable : le secret attend).
    const email = adresse('pose');
    const { jeton: jPose } = await inviterParApi(email);
    await api('POST', '/console/invitation/accepter', undefined, { jeton: jPose, motDePasse: MDP, nom: 'Rim Pose' });
    const { jeton } = await inviterParApi(adresse('apercu'));
    const ECRANS: EcranConsole[] = [
      { nom: 'equipe-invitations', hash: '#/equipe' },
      { nom: 'invitation', hash: `#/invitation/${jeton}`, sansSession: true },
      { nom: 'pose', hash: '#/', sansSession: true, geste: async (p) => {
        await p.locator('input[type=email]').fill(email);
        await p.locator('input[type=password]').fill(MDP);
        await cliquer(p.locator('button[type=submit]'));
        await p.locator('.c-cp-secours').waitFor({ timeout: 20_000 });
      } },
    ];
    const ouvrirEcran = async (e: EcranConsole, o: { largeur: number; theme?: 'clair' | 'sombre'; factice?: boolean }) => {
      const p = await ouvrirAvec(e.sansSession ? null : direction, { ...o, hash: e.hash });
      await p.locator(e.sansSession ? '.c-forme' : '.c-eq-cartes').waitFor({ timeout: 20_000 });
      await p.waitForTimeout(400);
      return p;
    };
    const { faux, vus } = await mesurerLaConsole({ ecrans: ECRANS, ouvrir: ouvrirEcran, factice: [], photos: path.join(RACINE, 'dist/photos') });
    expect(faux).toEqual([]);
    expect(vus).toBeGreaterThanOrEqual(12);
    expect(erreurs).toEqual([]);
  }, 400_000);
});
