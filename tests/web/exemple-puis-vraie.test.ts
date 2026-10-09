// L'exemple puis la vraie entreprise, à l'écran, autour du versement de l'exemple (lot onboarding, 09/10/2026 ;
// docs/entree.md ; web/src/ecrans/ExemplePrepare.tsx, web/src/ecrans/EntrepriseNeuve.tsx, web/public/plateforme/pont.js).
// Le versement lui-même (une minute) se joue dans tests/web/exemple.test.ts ; ici, ce qui l'entoure, sans l'attendre :
//   - une entreprise d'essai encore vide ne s'ouvre pas sur un accueil vide : elle repart vers « On prépare l'exemple » ;
//     coupée à chaque fois, la préparation dit quoi faire (« Réessayer »), jamais le texte du relais ; un conflit se
//     redemande ; un refus se lit en entier, et « telle quelle » l'ouvre sans y revenir, sans premiers pas ;
//   - une entreprise d'essai qui a ses propres pièces s'ouvre telle quelle, sans premiers pas ;
//   - une entreprise dont le compte n'est pas de l'équipe : « ne t'est pas ouverte », sans parler d'un retrait ;
//   - « Nouvelle entreprise… » : la page qui la crée, et le lien qui revient ; créée, l'assistant s'y ouvre ; « Le groupe »
//     attend deux vraies sociétés (l'exemple n'en est pas une) ;
//   - l'exemple déjà là s'ouvre aussitôt ; sans vraie entreprise, son bandeau dit « Créer ma vraie entreprise » et mène à
//     la page qui la crée (le lien qui revient à l'exemple) ; une visite à faire pour de vrai (« Confier mon dossier à mon
//     comptable », par le mandat) passe par cette page, et démarre dans l'entreprise créée, après l'assistant.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('l\'exemple puis la vraie entreprise, autour du versement', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-exemple-vraie-'));
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
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  // Une personne inscrite et connectée (ce serveur n'envoie pas d'e-mail : pas de code à recevoir).
  async function personne(nom: string) {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    return String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  }
  // Le service des écrans (sw.js) est bloqué : les demandes imitées ne passent qu'une fois, par la page.
  async function page(jeton: string) {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', serviceWorkers: 'block' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(`${e.message} @ ${p.url()}`));
    return { p, erreurs };
  }
  const accueil = async (p: Page) => { await p.locator('#view h1').filter({ hasText: 'Accueil' }).waitFor({ timeout: 20_000 }); };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  const premiersPas = (p: Page) => p.locator('#view .premiers-pas');

  it('l\'entreprise d\'essai encore vide repart vers sa préparation : coupée, elle dit quoi faire ; un conflit se redemande ; un refus se lit, et « telle quelle » l\'ouvre sans y revenir', async () => {
    const jeton = await personne('salma');
    const essai = String((await api('POST', '/entreprises-essai', jeton)).corps.id);
    const { p, erreurs } = await page(jeton);
    // Le versement, imité : ce qu'on lui fait répondre, dans l'ordre ; sans consigne, un relais qui coupe, tantôt avec
    // son texte, tantôt sans un mot (un 502 vide).
    const reponses: { status: number; body: string }[] = [];
    let demandes = 0;
    await p.route('**/v1/entreprises/*/exemple', async (r) => {
      demandes++;
      const x = reponses.shift() ?? (demandes % 2 ? { status: 504, body: 'upstream request timeout' } : { status: 502, body: '' });
      await r.fulfill({ status: x.status, contentType: x.body.startsWith('{') ? 'application/json' : 'text/plain', body: x.body });
    });

    // Ouverte vide : la page repart vers « On prépare l'exemple », qui dit ce qui se fait.
    await p.goto(`${serveur.adresse}/v10/?e=${essai}#/dashboard`);
    await p.waitForURL((u) => u.pathname === '/' && u.searchParams.get('exemple') === 'exemple', { timeout: 20_000 });
    const ecran = p.locator('.ent-exemple');
    await expect.poll(() => ecran.locator('h1').innerText().catch(() => '')).toBe('On prépare l\'exemple…');
    await expect.poll(() => ecran.innerText().then(net).catch(() => '')).toContain('Compte une minute : laisse cette page ouverte, elle continue toute seule.');

    // Coupée à chaque fois (la demande et ses quatre reprises) : une phrase qui dit quoi faire, et « Réessayer ».
    const alerte = ecran.locator('[role=alert]');
    await expect.poll(() => alerte.innerText().catch(() => ''), { timeout: 30_000 }).toBe('La connexion au serveur a coupé avant la fin : réessaie, ce qui est déjà fait est gardé.');
    expect(demandes).toBe(5);
    expect(await p.locator('body').innerText()).not.toMatch(/upstream/i);
    expect(await ecran.getByRole('button', { name: 'Ouvrir mon entreprise d\'essai telle quelle' }).count()).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'exemple-vraie-1-coupe.png') });

    // « Réessayer » : un enregistrement qui croise le versement (un conflit) se redemande ; puis un refus, lu en entier.
    reponses.push({ status: 409, body: JSON.stringify({ motif: 'Quelqu\'un d\'autre vient de modifier ce dossier : rien n\'a été enregistré.' }) },
      { status: 403, body: JSON.stringify({ motif: 'Ton rôle ne permet pas de remplir cette entreprise : rien n\'a été fait.' }) });
    await ecran.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect.poll(() => alerte.innerText().catch(() => ''), { timeout: 15_000 }).toBe('Ton rôle ne permet pas de remplir cette entreprise : rien n\'a été fait.');
    expect(demandes).toBe(7);

    // « Telle quelle » : elle s'ouvre, vide, sans repartir vers la préparation, et sans premiers pas (ce n'est pas la
    // vraie entreprise).
    await ecran.getByRole('button', { name: 'Ouvrir mon entreprise d\'essai telle quelle' }).click();
    await p.waitForURL(new RegExp(`/v10/\\?e=${essai}`), { timeout: 15_000 });
    await accueil(p);
    await expect.poll(() => premiersPas(p).count(), { timeout: 10_000 }).toBe(0);
    expect(new URL(p.url()).pathname).toBe('/v10/');
    expect(demandes).toBe(7);
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('une entreprise d\'essai qui a ses propres pièces s\'ouvre telle quelle, sans repasser par la préparation, et sans premiers pas', async () => {
    const jeton = await personne('karim');
    const essai = String((await api('POST', '/entreprises-essai', jeton)).corps.id);
    await api('GET', `/entreprises/${essai}/dossier-v10`, jeton);
    const ecrit = await api('POST', `/entreprises/${essai}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Menuiserie El Amel' } },
      { collection: 'documents', cle: 'd1', rang: 0, revision: null, contenu: { id: 'd1', type: 'devis', number: '', status: 'brouillon', date: '2026-10-09', clientId: 'c1',
        lines: [{ label: 'Étagère en pin', qty: 2, unit: 'u', unitPrice: { '~n': '45.5' }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] } },
    ] });
    expect(ecrit.statut, JSON.stringify(ecrit.corps)).toBe(200);
    const { p, erreurs } = await page(jeton);
    let demandes = 0;
    await p.route('**/v1/entreprises/*/exemple', (r) => { demandes++; return r.continue(); });
    await p.goto(`${serveur.adresse}/v10/?e=${essai}#/dashboard`);
    await accueil(p);
    await expect.poll(() => premiersPas(p).count(), { timeout: 10_000 }).toBe(0);
    expect(new URL(p.url()).pathname).toBe('/v10/');
    expect(demandes).toBe(0);
    expect(erreurs).toEqual([]);
  }, 60_000);

  it('une entreprise dont le compte n\'est pas de l\'équipe : « ne t\'est pas ouverte », sans parler d\'un retrait', async () => {
    const jeton = await personne('lina');
    const autre = await personne('omar');
    const sienne = String((await api('POST', '/entreprises', autre, { raisonSociale: 'Librairie Omar' })).corps.id);
    const { p, erreurs } = await page(jeton);
    await p.goto(`${serveur.adresse}/v10/?e=${sienne}#/dashboard`);
    await expect.poll(() => p.locator('#poste-bandeau').innerText().then(net).catch(() => ''), { timeout: 20_000 })
      .toBe('Cette entreprise ne t\'est pas ouverte : ton compte ne fait pas partie de son équipe, ou elle n\'existe pas. Continuer');
    await p.screenshot({ path: path.join(PHOTOS, 'exemple-vraie-2-pas-ouverte.png') });
    expect(erreurs).toEqual([]);
  }, 60_000);

  it('« Nouvelle entreprise… » : la page qui la crée et le lien qui revient ; créée, l\'assistant s\'y ouvre ; « Le groupe » attend deux vraies sociétés', async () => {
    const jeton = await personne('nadia');
    expect((await api('POST', '/entreprises-essai', jeton)).statut).toBe(201);
    const atelier = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Atelier Nadia' })).corps.id);
    const { p, erreurs } = await page(jeton);
    await p.goto(`${serveur.adresse}/v10/?e=${atelier}#/dashboard`);
    await accueil(p);
    await plusTard(p);
    const menu = p.locator('#dos-menu');
    const ouvrirMenu = async () => { await p.locator('#brand-btn').click(); await menu.locator('#dm-new').waitFor({ timeout: 10_000 }); };

    // L'exemple et une seule vraie entreprise : pas de groupe. Et pas de « Gérer les dossiers… », dont le panneau n'existe
    // pas en ligne (un bouton qui ne mène nulle part).
    await ouvrirMenu();
    expect(net(await menu.innerText())).toContain('Entreprise d\'essai de nadia');
    expect(await menu.locator('#dm-groupe').count()).toBe(0);
    expect(await menu.locator('#dm-manage').count()).toBe(0);

    // « Nouvelle entreprise… » : la page qui la crée, et le lien qui revient à celle qu'on quittait.
    await menu.locator('#dm-new').click();
    await p.waitForURL((u) => u.pathname === '/' && u.searchParams.get('entreprise') === 'menu' && u.searchParams.get('retour') === atelier, { timeout: 15_000 });
    await expect.poll(() => p.locator('h1').first().innerText().catch(() => '')).toBe('Une nouvelle entreprise');
    await p.screenshot({ path: path.join(PHOTOS, 'exemple-vraie-3-nouvelle.png') });
    const revenir = p.getByRole('link', { name: 'Revenir à l\'entreprise ouverte' });
    expect(await revenir.getAttribute('href')).toBe(`/v10/?e=${atelier}`);
    await revenir.click();
    await p.waitForURL(new RegExp(`/v10/\\?e=${atelier}`), { timeout: 15_000 });
    await accueil(p);

    // Créée, elle s'ouvre sur l'assistant de démarrage.
    await ouvrirMenu();
    await menu.locator('#dm-new').click();
    await p.locator('label.field').filter({ hasText: 'Raison sociale' }).locator('input').fill('Bois du Sahel');
    await p.getByRole('button', { name: /Créer cette entreprise/ }).click();
    await p.waitForURL((u) => /\/v10\/\?e=[0-9a-f-]{36}/.test(u.href) && !u.href.includes(atelier), { timeout: 15_000 });
    const as = p.locator('#setup.as');
    await as.getByRole('heading', { level: 1 }).filter({ hasText: /^Où te joindre/ }).waitFor({ timeout: 20_000 });
    await as.getByRole('button', { name: 'Je le ferai plus tard', exact: true }).click();
    await as.getByRole('button', { name: 'Plus tard', exact: true }).click();
    await as.getByRole('heading', { level: 1 }).filter({ hasText: /^Factures-tu la TVA/ }).waitFor();
    await as.getByRole('button', { name: 'Continuer', exact: true }).click();
    await as.getByRole('button', { name: 'Ouvrir mon entreprise', exact: true }).click();
    await as.waitFor({ state: 'detached' });

    // Deux vraies sociétés : le groupe.
    await plusTard(p);
    await ouvrirMenu();
    expect(await menu.locator('#dm-groupe').count()).toBe(1);
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('l\'exemple déjà là s\'ouvre aussitôt ; sans vraie entreprise, son bandeau la crée ; « Confier mon dossier à mon comptable » y démarre, après l\'assistant', async () => {
    const jeton = await personne('hela');
    const essai = String((await api('POST', '/entreprises-essai', jeton)).corps.id);
    // L'exemple déjà versé : sa marque, telle que le serveur la pose (serveur/v10/exemple.ts).
    await api('GET', `/entreprises/${essai}/dossier-v10`, jeton);
    expect((await api('POST', `/entreprises/${essai}/dossier-v10`, jeton, { changements: [
      { collection: '_racine', cle: 'demo', rang: null, revision: null, contenu: true },
    ] })).statut).toBe(200);
    const { p, erreurs } = await page(jeton);

    // « Voir un exemple » : déjà là, il s'ouvre aussitôt, sans l'écran qui le prépare.
    await p.goto(`${serveur.adresse}/?exemple=exemple`);
    await p.waitForURL(new RegExp(`/v10/\\?e=${essai}`), { timeout: 15_000 });
    await expect.poll(() => p.locator('#view .demo-banner').isVisible().catch(() => false), { timeout: 20_000 }).toBe(true);
    await plusTard(p);
    // Sans vraie entreprise encore, le bouton du bandeau la crée, et le dit.
    const sortie = p.locator('#demo-out');
    expect(net(await sortie.innerText())).toBe('Créer ma vraie entreprise');
    await p.screenshot({ path: path.join(PHOTOS, 'exemple-vraie-4-bandeau.png') });
    await sortie.click();
    await p.waitForURL((u) => u.pathname === '/' && u.searchParams.get('entreprise') === 'exemple' && u.searchParams.get('retour') === essai && !u.searchParams.has('visite'), { timeout: 15_000 });
    await expect.poll(() => p.locator('h1').first().innerText().catch(() => '')).toBe('Ta vraie entreprise');
    const revenir = p.getByRole('link', { name: 'Revenir à l\'exemple' });
    expect(await revenir.getAttribute('href')).toBe(`/v10/?e=${essai}`);
    await revenir.click();
    await p.waitForURL(new RegExp(`/v10/\\?e=${essai}`), { timeout: 15_000 });
    await expect.poll(() => p.locator('#view .demo-banner').isVisible().catch(() => false), { timeout: 20_000 }).toBe(true);

    // « Me guider » → « Confier mon dossier à mon comptable » : une visite pour de vrai, qui mène d'abord à la création de
    // la vraie entreprise, la visite dans l'adresse.
    await p.evaluate(() => { location.hash = '#/guide'; });
    await p.locator('#view h1').filter({ hasText: 'Me guider' }).waitFor({ timeout: 15_000 });
    await p.locator('[data-visite="relier-comptable"]').first().click();
    await p.waitForURL((u) => u.pathname === '/' && u.searchParams.get('entreprise') === 'exemple' && u.searchParams.get('visite') === 'relier-comptable', { timeout: 15_000 });
    await p.locator('label.field').filter({ hasText: 'Raison sociale' }).locator('input').fill('Hela Couture');
    await p.getByRole('button', { name: /Créer ma vraie entreprise/ }).click();
    await p.waitForURL((u) => /\/v10\/\?e=[0-9a-f-]{36}/.test(u.href) && !u.href.includes(essai), { timeout: 15_000 });
    const as = p.locator('#setup.as');
    await as.getByRole('heading', { level: 1 }).filter({ hasText: /^Où te joindre/ }).waitFor({ timeout: 20_000 });
    await as.getByRole('button', { name: 'Je le ferai plus tard', exact: true }).click();
    await as.getByRole('button', { name: 'Plus tard', exact: true }).click();
    await as.getByRole('heading', { level: 1 }).filter({ hasText: /^Factures-tu la TVA/ }).waitFor();
    await as.getByRole('button', { name: 'Continuer', exact: true }).click();
    await as.getByRole('button', { name: 'Ouvrir mon entreprise', exact: true }).click();
    await as.waitFor({ state: 'detached' });

    // La visite démarre dans la vraie entreprise : le panneau du mandat, puis le code de son cabinet.
    const titreBulle = () => p.locator('#visite-bulle #visite-titre').innerText().then(net).catch(() => '');
    await expect.poll(titreBulle, { timeout: 20_000 }).toBe('Ton cabinet comptable');
    await p.locator('#visite-bulle [data-v=suiv]').first().click();
    await expect.poll(titreBulle, { timeout: 10_000 }).toBe('Le code de son cabinet');
    expect(await p.locator('#mandat-code').isVisible()).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'exemple-vraie-5-mandat.png') });
    expect(erreurs).toEqual([]);
  }, 120_000);
});
