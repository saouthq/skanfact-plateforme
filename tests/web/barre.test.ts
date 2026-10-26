// La barre de la maquette « Barre v3 », à la souris et au clavier (appliquée le 26/10/2026 ; drawNav dans v10/app.js,
// web/public/plateforme/barre.js et barre.css ; docs/maquettes-appliquees.md) :
//   - « Au quotidien » : l'accueil, puis les pages du métier (une entreprise de services : factures, devis, clients,
//     relances) ; chaque page n'a qu'UN lien ; elles se rangent en glissant, et l'ordre se garde ;
//   - « Tout le reste » : une famille ouvre son volet À CÔTÉ de la barre, sans rien pousser ; Échap le ferme et rend le
//     curseur à sa ligne ; une page s'y épingle (elle passe dans « Au quotidien », et y reste au rechargement) ;
//   - « Créer » s'ouvre à la touche N (jamais dans un champ) ; sa lettre choisit (F : une facture) ;
//   - la tête porte les initiales de l'entreprise et la cloche ; le pied la personne connectée, son rôle, son menu ;
//   - la barre se replie (touche [, gardé) ; « ? » montre les raccourcis ; G puis F mène aux factures ;
//   - au téléphone, les onglets du bas : l'accueil, deux pages du métier, « + » (la feuille Créer), « Plus » (une page
//     de listes), et « Mes onglets » qui les choisit ; à la tablette, un rail ; en sombre, la barre est sombre.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { problemes } from '../instrument-rendu.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la barre des maquettes, à la souris et au clavier', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-barre-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const QUOTIDIEN = '#nav .nav-quotidien > a[data-route]:not([hidden])';
  const routes = (p: Page, s: string) => p.locator(s).evaluateAll((as) => as.map((a) => (a as HTMLElement).dataset.route ?? ''));

  let jeton = '';
  let ent = '';
  beforeAll(async () => {
    const email = `nadia-barre-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia Gharbi', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
  }, 60_000);

  const erreurs: string[] = [];
  const ouvrir = async (largeur: number, hauteur: number, hash = '#/factures', options: { isMobile?: boolean; hasTouch?: boolean } = {}) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', ...options });
    await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    return p;
  };

  const barreDroite = (p: Page) => p.locator('#barre').evaluate((b) => Math.round(b.getBoundingClientRect().right));

  it('au bureau : les deux groupes, un lien par page, le volet à côté, l\'épingle, ranger, « Créer », la cloche, le pied', async () => {
    const p = await ouvrir(1440, 900);
    // « Au quotidien » : l'accueil, puis les pages du métier (sans métier choisi : celles des services).
    await expect.poll(() => routes(p, QUOTIDIEN), { timeout: 15_000 }).toContain('factures');
    const jour = await routes(p, QUOTIDIEN);
    expect(jour[0]).toBe('dashboard');
    const toutes = await routes(p, '#nav a[data-route]');
    expect(jour.slice(1)).toEqual(['factures', 'devis', 'clients', 'relances'].filter((x) => toutes.includes(x)));
    // Une page, un lien : l'accueil d'un rôle et les lecteurs d'écran lisent la liste des liens.
    expect(new Set(toutes).size).toBe(toutes.length);
    // Sans cabinet, la propriétaire est invitée à inviter son comptable, au bout des pages du jour.
    expect(await p.locator('#nav .nav-quotidien #b-inviter-comptable').innerText()).toBe('Inviter mon comptable');
    // « Tout le reste » : une ligne par famille ; « Ajouter un module » au bout.
    expect(await p.locator('#nav .nav-reste .nav-volet').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.famille))).toEqual(['Vendre', 'Acheter', 'Piloter']);
    expect(await p.locator('#nav .nav-reste > a[data-route="modules"]').count()).toBe(1);
    // La tête et le pied.
    await expect.poll(() => p.locator('#barre .brand-mark').innerText(), { timeout: 10_000 }).toBe('BE');
    await expect.poll(() => p.locator('#b-moi').innerText().then(net).catch(() => ''), { timeout: 15_000 }).toBe('NG Nadia Gharbi Propriétaire');
    expect(await p.locator('#barre .pied-liens a').evaluateAll((as) => as.map((a) => a.getAttribute('aria-label')))).toEqual(['Paramètres', 'Me guider', 'Aide']);
    expect(await barreDroite(p)).toBe(266);
    await p.screenshot({ path: path.join(PHOTOS, 'barre-bureau.png') });

    // Le volet d'une famille s'ouvre à côté de la barre, par-dessus la page : rien ne bouge dans la barre.
    const piloter = p.locator('#nav .nav-volet[data-famille="Piloter"]');
    const avant = await piloter.boundingBox();
    await p.locator('#nav .nav-volet[data-famille="Acheter"]').click();
    const volet = p.locator('.sb-panneau');
    await expect.poll(() => volet.isVisible(), { timeout: 5_000 }).toBe(true);
    await expect.poll(() => volet.evaluate((v) => Math.round(v.getBoundingClientRect().left)), { timeout: 5_000 }).toBe(266 + 22);
    const boite = await volet.boundingBox();
    expect(boite && boite.x >= 266 + 20 && boite.y >= 0 && boite.y + boite.height <= 900).toBe(true);
    expect(await volet.locator('h3').innerText()).toBe('Acheter');
    expect(await piloter.boundingBox()).toEqual(avant);
    expect(await p.locator('#nav .nav-volet[data-famille="Acheter"]').getAttribute('aria-expanded')).toBe('true');
    await p.screenshot({ path: path.join(PHOTOS, 'barre-volet.png') });
    // Échap le ferme et rend le curseur à sa ligne.
    await p.keyboard.press('Escape');
    await expect.poll(() => volet.count(), { timeout: 5_000 }).toBe(0);
    expect(await p.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.famille)).toBe('Acheter');

    // L'épingle : « Fournisseurs » passe dans « Au quotidien », le volet reste ouvert, la page n'y est plus un lien.
    await p.locator('#nav .nav-volet[data-famille="Acheter"]').click();
    await p.locator('.sb-panneau [data-epingle="fournisseurs"]').click();
    await expect.poll(() => routes(p, QUOTIDIEN), { timeout: 5_000 }).toEqual([...jour, 'fournisseurs']);
    expect(await volet.isVisible()).toBe(true);
    expect(await p.locator('.sb-panneau [data-epingle="fournisseurs"]').getAttribute('aria-pressed')).toBe('true');
    expect(await p.locator('#nav .volet a[data-route="fournisseurs"]').count()).toBe(0);
    // Le bouton de la page épinglée, dans son volet, y mène.
    await p.locator('.sb-panneau [data-aller="fournisseurs"]').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 5_000 }).toBe('#/fournisseurs');
    // Elle y reste au rechargement ; on la retire du même geste.
    await p.reload();
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await expect.poll(() => routes(p, QUOTIDIEN), { timeout: 15_000 }).toEqual([...jour, 'fournisseurs']);
    await p.locator('#nav .nav-volet[data-famille="Acheter"]').click();
    await p.locator('.sb-panneau [data-epingle="fournisseurs"]').click();
    await expect.poll(() => routes(p, QUOTIDIEN), { timeout: 5_000 }).toEqual(jour);
    await p.keyboard.press('Escape');

    // Ranger en glissant : « Relances » posée sur « Factures » passe devant elle, et l'ordre se garde.
    await p.locator('#nav .nav-quotidien [data-nom="relances"]').dragTo(p.locator('#nav .nav-quotidien [data-nom="factures"]'));
    const range = ['dashboard', 'relances', ...jour.slice(1).filter((x) => x !== 'relances')];
    await expect.poll(() => routes(p, QUOTIDIEN), { timeout: 5_000 }).toEqual(range);
    await p.reload();
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await expect.poll(() => routes(p, QUOTIDIEN), { timeout: 15_000 }).toEqual(range);

    // « Créer » : la touche N l'ouvre sous le bouton, la lettre d'une ligne la choisit.
    await p.locator('#view h1').first().click();
    await p.keyboard.press('n');
    const creer = p.locator('.sb-creer');
    await expect.poll(() => creer.isVisible(), { timeout: 5_000 }).toBe(true);
    expect(await creer.locator('b').allInnerTexts()).toEqual(['Facture', 'Devis', 'Dépense', 'Client']);
    await p.screenshot({ path: path.join(PHOTOS, 'barre-creer.png') });
    await p.keyboard.press('f');
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 5_000 }).toBe('#/doc/new/facture');
    expect(await creer.count()).toBe(0);
    // Dans un champ, N s'écrit : « Créer » ne s'ouvre pas.
    await p.evaluate(() => { location.hash = '#/clients'; });
    await p.locator('#view h1').filter({ hasText: 'Clients' }).waitFor({ timeout: 15_000 });
    await p.locator('#nav-search').click();
    await p.locator('#pal-q').waitFor({ timeout: 5_000 });
    await p.keyboard.type('n');
    expect(await p.locator('#pal-q').inputValue()).toBe('n');
    expect(await creer.count()).toBe(0);
    await p.keyboard.press('Escape');
    // Dans un champ d'une page aussi (le nom de l'entreprise, dans les paramètres).
    await p.evaluate(() => { location.hash = '#/parametres'; });
    const champ = p.locator('#view input[type="text"]:visible').first();
    await champ.waitFor({ timeout: 15_000 });
    await champ.click();
    await champ.press('End');
    const avantN = await champ.inputValue();
    await p.keyboard.type('n');
    expect(await champ.inputValue()).toBe(`${avantN}n`);
    expect(await creer.count()).toBe(0);
    await champ.press('Backspace');

    // La cloche : ses nouvelles, posées à côté d'elle ; rien de neuf se dit.
    await p.locator('#b-cloche').click();
    await expect.poll(() => p.locator('.sb-notifs').isVisible(), { timeout: 5_000 }).toBe(true);
    expect(net(await p.locator('.sb-notifs').innerText())).toContain('Nouvelles');
    await p.keyboard.press('Escape');
    // La personne : son menu, avec ses portes et « Se déconnecter ».
    await p.locator('#b-moi').click();
    const moi = p.locator('.sb-moi');
    await expect.poll(() => moi.isVisible(), { timeout: 5_000 }).toBe(true);
    expect(await moi.locator('button .lib').evaluateAll((xs) => xs.map((x) => (x.firstChild?.textContent ?? '').trim())))
      .toEqual(['Mon profil et ma sécurité', 'Mon équipe', 'Ton abonnement', 'Raccourcis clavier', 'Découvrir la barre', 'Se déconnecter']);
    await moi.getByRole('menuitem', { name: /Découvrir la barre/ }).click();
    // La visite de la barre : trois étapes, sur ses trois zones.
    const visite = p.locator('.sb-visite');
    await expect.poll(() => visite.isVisible(), { timeout: 5_000 }).toBe(true);
    expect(await p.locator('#zone-creer').getAttribute('class')).toContain('sb-cible-visite');
    await visite.getByRole('button', { name: /Suivant/ }).click();
    expect(await p.locator('#nav-1').getAttribute('class')).toContain('sb-cible-visite');
    await visite.getByRole('button', { name: /Suivant/ }).click();
    await visite.getByRole('button', { name: /Terminer/ }).click();
    expect(await visite.count()).toBe(0);

    // En sombre, la barre est sombre (son fond suit le thème de la page).
    await p.evaluate(() => document.body.classList.add('dark'));
    const fond = await p.locator('#barre').evaluate((e) => getComputedStyle(e).backgroundColor);
    const [r = 255, g = 255, b = 255] = (fond.match(/[\d.]+/g) ?? []).map(Number);
    expect(r + g + b).toBeLessThan(200);
    await p.screenshot({ path: path.join(PHOTOS, 'barre-sombre.png') });
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 120_000);

  it('repliée et au clavier : [ replie et se garde, la bulle dit le nom, ? les raccourcis, G puis F les factures', async () => {
    const p = await ouvrir(1440, 900, '#/dashboard');
    await p.locator('#view h1').first().click();
    await p.keyboard.press('[');
    await expect.poll(() => barreDroite(p), { timeout: 5_000 }).toBe(68);
    // Au survol, la bulle dit le nom de l'entrée, posée à côté de la barre.
    await p.locator('#nav a[data-route="factures"]').hover();
    const bulle = p.locator('.sb-bulle');
    await expect.poll(() => bulle.isVisible(), { timeout: 5_000 }).toBe(true);
    expect(await bulle.innerText()).toMatch(/^Factures/);
    expect((await bulle.boundingBox())?.x ?? 0).toBeGreaterThan(68);
    await p.screenshot({ path: path.join(PHOTOS, 'barre-repliee.png') });
    await p.reload();
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await expect.poll(() => barreDroite(p), { timeout: 5_000 }).toBe(68);
    await p.locator('#view h1').first().click();
    await p.keyboard.press('[');
    await expect.poll(() => barreDroite(p), { timeout: 5_000 }).toBe(266);
    // « ? » : les raccourcis ; Échap les ferme.
    await p.keyboard.press('?');
    await expect.poll(() => p.locator('.sb-raccourcis').isVisible(), { timeout: 5_000 }).toBe(true);
    await p.keyboard.press('Escape');
    expect(await p.locator('.sb-raccourcis').count()).toBe(0);
    // G puis F : les factures.
    await p.keyboard.press('g');
    await p.keyboard.press('f');
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 5_000 }).toBe('#/factures');
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 120_000);

  it('au téléphone : les onglets du bas, « Plus », la feuille Créer, Mes onglets', async () => {
    const p = await ouvrir(390, 844, '#/dashboard', { isMobile: true, hasTouch: true });
    const bas = p.locator('.sb-onglets');
    await expect.poll(() => bas.isVisible(), { timeout: 10_000 }).toBe(true);
    // L'accueil, deux pages du métier (les services : factures et clients), « + » au milieu, « Plus ».
    expect(await bas.locator('a.sb-onglet').evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual(['#/dashboard', '#/factures', '#/clients']);
    expect(await bas.locator('[data-tel="creer"], [data-tel="plus"]').count()).toBe(2);
    expect(await bas.locator('a.sb-onglet[aria-current="page"]').getAttribute('href')).toBe('#/dashboard');
    // Le bas de l'écran, et rien sous lui : la page garde sa place au-dessus.
    const boite = await bas.boundingBox();
    expect(boite && Math.round(boite.y + boite.height)).toBe(844);
    expect(await p.evaluate(problemes, [true, 390] as [boolean, number])).toEqual([]);
    await p.screenshot({ path: path.join(PHOTOS, 'barre-telephone.png') });
    // Tout en bas de la page, le dernier bloc se lit au-dessus des onglets (ils ne le cachent pas).
    await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const fin = await p.locator('#view').evaluate((v) => (v.lastElementChild as HTMLElement | null)?.getBoundingClientRect().bottom ?? 0);
    expect(boite && fin <= boite.y).toBe(true);
    await p.evaluate(() => window.scrollTo(0, 0));
    // « Plus » : une page de listes, par famille ; une page choisie la referme.
    await bas.locator('[data-tel="plus"]').click();
    const plus = p.locator('.sb-plus');
    await expect.poll(() => plus.isVisible(), { timeout: 5_000 }).toBe(true);
    expect(await plus.locator('.plus-titre').allInnerTexts()).toEqual(expect.arrayContaining(['Vendre', 'Acheter', 'Piloter', 'Mon compte']));
    await p.screenshot({ path: path.join(PHOTOS, 'barre-telephone-plus.png') });
    await plus.locator('a[href="#/fournisseurs"]').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 5_000 }).toBe('#/fournisseurs');
    expect(await plus.count()).toBe(0);
    // « + » : la feuille Créer monte au-dessus des onglets, dans l'écran.
    await bas.locator('[data-tel="creer"]').click();
    const feuille = p.locator('.sb-feuille');
    await expect.poll(() => feuille.isVisible(), { timeout: 5_000 }).toBe(true);
    await feuille.evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
    const f = await feuille.boundingBox();
    expect(f && f.x >= 0 && f.x + f.width <= 390 && Math.round(f.y + f.height) <= 844).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'barre-telephone-creer.png') });
    await feuille.locator('button').filter({ hasText: 'Devis' }).click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 5_000 }).toBe('#/doc/new/devis');
    // « Mes onglets » : « Devis » prend la place de la plus ancienne (« Factures »).
    await bas.locator('[data-tel="plus"]').click();
    await plus.locator('[data-plus="onglets"]').click();
    await plus.locator('[data-onglet="devis"]').click();
    await expect.poll(() => bas.locator('a.sb-onglet').evaluateAll((as) => as.map((a) => a.getAttribute('href'))), { timeout: 5_000 })
      .toEqual(['#/dashboard', '#/clients', '#/devis']);
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 120_000);

  it('à la tablette : un rail d\'icônes avec leur nom ; « Plus » ouvre la barre entière', async () => {
    const p = await ouvrir(1024, 768, '#/dashboard');
    const rail = p.locator('.sb-rail');
    await expect.poll(() => rail.isVisible(), { timeout: 10_000 }).toBe(true);
    expect((await rail.boundingBox())?.width).toBe(84);
    expect(await rail.locator('a.rail-l').first().getAttribute('href')).toBe('#/dashboard');
    expect(await p.locator('#barre').evaluate((b) => b.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    await p.screenshot({ path: path.join(PHOTOS, 'barre-tablette.png') });
    await rail.locator('[data-rail="plus"]').click();
    await expect.poll(() => p.locator('#barre').evaluate((b) => Math.round(b.getBoundingClientRect().left)), { timeout: 5_000 }).toBe(0);
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('#barre').evaluate((b) => b.getBoundingClientRect().right), { timeout: 5_000 }).toBeLessThanOrEqual(0);
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 120_000);
});
