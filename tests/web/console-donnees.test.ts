// « Données personnelles », à la souris (0144 ; docs/console.md C68 ; web/console/src/ecrans/Donnees.tsx). Ce que le
// parcours vérifie :
//   - la barre de gauche mène à l'écran (la direction et le support) ; vide, « Noter une demande… » est le seul bouton
//     principal ;
//   - noter : un motif trop court se refuse et montre son champ ; notée, la demande prend son numéro et son échéance, et
//     son « Décider… » devient le bouton principal ; « À décider » de l'accueil y mène, la demande montrée ;
//   - décider sans choisir se refuse ; accordée, « Effacer le compte… » prend la main ; l'effacement dit ce qui part et ce
//     qui reste avant le geste ; fait, la demande passe dans les traitées avec sa preuve, et le compte ne se nomme plus ;
//   - le support note, ne décide pas ; « ce que SkanFact garde » dit ce qui est à vérifier ;
//   - en clair et en sombre, à l'ordinateur et au téléphone : l'instrument ne trouve rien ; en langue factice, tout vient
//     du catalogue.

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
const PHOTOS = path.join(RACINE, 'dist/photos');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('les données personnelles, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-donnees-'));
  const erreurs: string[] = [];
  let jD = '', jS = '';
  const suffixe = Date.now().toString(36);
  const cliente = { email: `donnees-cliente-${suffixe}@exemple.tn`, nom: `Zoubeida Essai-${suffixe}` };

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const membre = async (nom: string, role: 'direction' | 'support') => {
    const email = `donnees-${role}-${suffixe}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, role, 'essai des données personnelles à la souris');
    const r = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    const c = await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) });
    return String(c.corps.jeton);
  };
  const ouvrir = async (jeton: string, o: { largeur?: number; hash?: string; theme?: 'clair' | 'sombre'; factice?: boolean } = {}) => {
    const largeur = o.largeur ?? 1440;
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 600 ? 844 : 900 }, locale: 'fr-FR' });
    await cx.addInitScript(([j, t]) => {
      sessionStorage.setItem('skanfact.console.jeton', j);
      if (t) localStorage.setItem('skanfact.console.theme', t);
    }, [jeton, o.theme ?? null] as const);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/${o.factice ? '?langue=factice' : ''}${o.hash ?? '#/donnees'}`);
    if ((o.hash ?? '#/donnees').startsWith('#/donnees')) await p.locator('#ef-garde').waitFor({ timeout: 20_000 });
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  const fenetre = (p: Page) => p.locator('[role="dialog"]');
  const principaux = (p: Page) => p.locator('main .c-btn-principal');
  const ligne = (p: Page) => p.locator('section[aria-labelledby="ef-ouvertes"]').locator('.c-ligne-decision').filter({ hasText: cliente.email });

  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    // Le registre se lit en entier : les demandes laissées par d'autres essais (tests/console/effacement.test.ts) en
    // changeraient l'ordre et le bouton principal. Ce parcours part d'un registre vide.
    await admin.query('delete from plateforme.demande_effacement');
    jD = await membre('Amira Essai', 'direction');
    jS = await membre('Sami Support', 'support');
    await api('POST', '/inscription', undefined, { email: cliente.email, nom: cliente.nom, motDePasse: MDP });
  }, 180_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true });
  });

  it('la barre y mène ; vide, « Noter une demande… » est le seul bouton principal ; un motif court se refuse et montre son champ', async () => {
    const p = await ouvrir(jD, { hash: '#/' });
    await cliquer(p.locator('.c-nav a[href="#/donnees"]'));
    await p.locator('#ef-garde').waitFor({ timeout: 20_000 });
    expect(net(await p.locator('h1').innerText())).toBe('Données personnelles');
    expect(net(await p.locator('section[aria-labelledby="ef-ouvertes"]').innerText())).toMatch(/Aucune demande en cours/);
    expect(await principaux(p).count()).toBe(1);
    expect(net(await principaux(p).innerText())).toMatch(/Noter une demande/);
    // Ce que SkanFact garde : chaque sorte, et ce qui attend une confirmation.
    const garde = p.locator('section[aria-labelledby="ef-garde"]');
    expect(await garde.locator('tbody tr').count()).toBe(7);
    expect(await garde.locator('.c-ef-verifier').count()).toBe(6);

    await cliquer(principaux(p));
    const f = fenetre(p);
    // Le curseur attend dans la case de l'adresse.
    expect(await f.locator('input[type="email"]').evaluate((el) => el === document.activeElement)).toBe(true);
    await f.locator('input[type="email"]').fill(cliente.email);
    await f.getByLabel('Qui fait la demande').fill('La personne elle-même, par e-mail');
    await f.locator('textarea').fill('ok');
    await cliquer(f.getByRole('button', { name: 'Noter la demande' }));
    await expect.poll(() => f.locator('.c-alerte-danger').count()).toBe(1);
    await expect.poll(() => f.locator('textarea').getAttribute('aria-invalid')).toBe('true');
    await f.locator('textarea').fill('Reçue par e-mail, identité vérifiée par téléphone');
    await cliquer(f.getByRole('button', { name: 'Noter la demande' }));
    await expect.poll(() => fenetre(p).count()).toBe(0);
    await expect.poll(() => ligne(p).count()).toBe(1);
    const texte = net(await ligne(p).innerText());
    expect(texte).toMatch(new RegExp(`EFF-${new Date().getUTCFullYear()}-\\d{3}`));
    expect(texte).toContain(cliente.nom);
    expect(texte).toMatch(/Encore 30 jours/);
    expect(texte).toMatch(/Notée par Amira Essai/);
    // Notée, sa décision est l'étape suivante : le seul bouton principal.
    expect(await principaux(p).count()).toBe(1);
    expect(net(await principaux(p).innerText())).toBe('Décider…');
    await p.screenshot({ path: path.join(PHOTOS, 'console-donnees-1.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('« À décider » de l\'accueil y mène ; le support note, ne décide pas', async () => {
    const p = await ouvrir(jD, { hash: '#/' });
    const l = p.locator('.c-ligne-decision').filter({ hasText: /Demande d.effacement EFF-/ });
    await expect.poll(() => l.count(), { timeout: 20_000 }).toBe(1);
    await cliquer(l.getByRole('link', { name: /Ouvrir la demande/ }));
    await p.locator('#ef-garde').waitFor({ timeout: 20_000 });
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/donnees');
    expect(await ligne(p).evaluate((el) => el.classList.contains('c-ef-visee'))).toBe(true);
    await fermer(p);

    const s = await ouvrir(jS);
    expect(await ligne(s).getByRole('button').count()).toBe(0);
    expect(net(await ligne(s).innerText())).toMatch(/La direction décide/);
    expect(net(await principaux(s).innerText())).toMatch(/Noter une demande/);
    await fermer(s);
  }, 60_000);

  it('décider sans choisir se refuse ; accordée, l\'effacement dit ce qui part ; fait, la preuve, et le compte ne se nomme plus', async () => {
    const p = await ouvrir(jD);
    await cliquer(ligne(p).getByRole('button', { name: /Décider de la demande/ }));
    const f = fenetre(p);
    await f.locator('textarea').fill('Aucune obligation ne retient ce compte');
    await cliquer(f.getByRole('button', { name: 'Décider', exact: true }));
    await expect.poll(async () => net(await f.locator('.c-alerte-danger').innerText().catch(() => ''))).toMatch(/Choisis la décision/);
    await cliquer(f.getByRole('radio', { name: 'Accordée' }));
    await p.screenshot({ path: path.join(PHOTOS, 'console-donnees-2.png') });
    await cliquer(f.getByRole('button', { name: 'L\'accorder' }));
    await expect.poll(() => fenetre(p).count()).toBe(0);
    await expect.poll(async () => net(await ligne(p).innerText())).toMatch(/À effacer/);
    expect(net(await principaux(p).innerText())).toBe('Effacer le compte…');

    await cliquer(principaux(p));
    const e = fenetre(p);
    expect(net(await e.innerText())).toMatch(/ne se défait pas/);
    // Le message de la décision est encore là : il ne couvre aucun bouton de la fenêtre (il passe en haut).
    await expect.poll(() => p.locator('#c-toast.c-montre').count()).toBe(1);
    expect(await p.evaluate(() => {
      const t = document.getElementById('c-toast')?.getBoundingClientRect();
      return !t ? null : [...document.querySelectorAll('[role="dialog"] button')].map((b) => b.getBoundingClientRect())
        .some((r) => !(r.right < t.left || r.left > t.right || r.bottom < t.top || r.top > t.bottom));
    })).toBe(false);
    expect(net(await e.innerText())).toMatch(/Personne effacée/);
    // Le motif attend le curseur ; le geste qui détruit porte la couleur du danger.
    expect(await e.locator('textarea').evaluate((el) => el === document.activeElement)).toBe(true);
    expect(await e.locator('.c-btn-danger').count()).toBe(1);
    await e.locator('textarea').fill('Demande accordée, effacée le jour même');
    await p.screenshot({ path: path.join(PHOTOS, 'console-donnees-3.png') });
    await cliquer(e.getByRole('button', { name: 'Effacer le compte', exact: true }));
    await expect.poll(() => fenetre(p).count()).toBe(0);
    await expect.poll(() => ligne(p).count()).toBe(0);
    const traitee = p.locator('section[aria-labelledby="ef-traitees"]').locator('tbody tr').first();
    const t = net(await traitee.innerText());
    expect(t).toMatch(/Compte effacé/);
    expect(t).toMatch(/Accordée le/);
    expect(t).toMatch(/Effacé le .* par Amira Essai/);
    expect(t).toMatch(/Compté : l'identité/);
    expect(t).not.toContain(cliente.nom);
    expect((await admin.query('select count(*)::int n from socle.utilisateur where nom = $1 or email = $2', [cliente.nom, cliente.email])).rows[0].n).toBe(0);
    // Rien ne reste à faire : « Noter une demande… » reprend la main.
    expect(net(await principaux(p).innerText())).toMatch(/Noter une demande/);
    await p.screenshot({ path: path.join(PHOTOS, 'console-donnees-4.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 90_000);

  it('en clair et en sombre, à l\'ordinateur et au téléphone, l\'instrument ne trouve rien ; en langue factice, tout vient du catalogue', async () => {
    // Une demande qui attend sa décision, pour que les lignes, la fenêtre et la table se mesurent toutes.
    const autre = `donnees-autre-${suffixe}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: autre, nom: 'Hédi Essai', motDePasse: MDP });
    expect((await api('POST', '/console/donnees/effacements', jD, { canal: 'courrier', demandeur: 'Son avocat, par lettre', recueLe: new Date(Date.now() - 40 * 86_400_000 + 3_600_000).toISOString().slice(0, 10),
      sorte: 'personne', cible: autre, motif: 'Lettre recommandée reçue' })).statut).toBe(201);
    const ECRANS: EcranConsole[] = [
      { nom: 'donnees', hash: '#/donnees' },
      { nom: 'donnees-noter', hash: '#/donnees', geste: async (p) => { await cliquer(p.locator('.c-entete button')); await fenetre(p).waitFor(); } },
      { nom: 'donnees-decider', hash: '#/donnees', geste: async (p) => { await cliquer(p.locator('.c-ligne-decision button').first()); await fenetre(p).waitFor(); } },
    ];
    const ouvrirEcran = async (e: EcranConsole, o: { largeur: number; theme?: 'clair' | 'sombre'; factice?: boolean }) => {
      const p = await ouvrir(jD, { ...o, hash: e.hash });
      await p.waitForTimeout(300);
      return p;
    };
    const { faux, vus } = await mesurerLaConsole({ ecrans: ECRANS, ouvrir: ouvrirEcran, factice: [], photos: PHOTOS });
    expect(faux).toEqual([]);
    expect(vus).toBe(12);
    expect(erreurs).toEqual([]);
  }, 400_000);
});
