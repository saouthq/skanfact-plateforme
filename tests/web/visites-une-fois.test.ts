// Une proposition de visite par ouverture de l'application, et « Ne plus me proposer de visites » d'un geste (1.129.0 ;
// docs/revue-mois-client.md, point 16 : « Première fois sur cette page ? » trois fois en cinq minutes). Ce que le
// parcours vérifie, à la souris :
//   - la première page neuve propose sa visite ; la suivante, dans la même ouverture, se tait ;
//   - rouverte, l'application propose de nouveau (une page encore neuve) ;
//   - « Ne plus me proposer de visites » éteint les propositions, le dit, et la case de « Me guider » le montre.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('les propositions de visite, une par ouverture', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-visites-'));
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
    return (texte ? JSON.parse(texte) : {}) as Record<string, unknown>;
  };
  // L'assistant de démarrage d'une entreprise neuve (« Où te joindre ? ») : on le passe, sans toucher aux propositions.
  const passerAssistant = async (p: Page) => {
    await p.locator('#view h1, .as-ecran, [class*="assistant"]').first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    const passer = p.getByRole('button', { name: 'Je le ferai plus tard', exact: true });
    if (await passer.count()) await passer.first().click({ timeout: 3_000 }).catch(() => undefined);
  };
  const net = (s: string) => s.replace(/\s+/g, ' ').trim();

  // (1.273.0, L9 ; docs/leger.md) Le texte de l'aide et les visites ne partent plus avec la page (la première ouverture
  // dépassait 1 300 Ko) : ils arrivent au premier geste qui les demande, et ce geste aboutit — la bulle dit son texte,
  // « Guide-moi » ouvre son menu, l'Aide ses articles. Les propositions de visite éteintes, rien ne les charge avant.
  it('L9 : l\'aide et les visites arrivent au premier geste qui les demande, et ce geste aboutit', async () => {
    const email = `ines-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Inès Gharbi', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Librairie El Kitab' })).id);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http')) return;
      sessionStorage.setItem('skanfact.jeton', j);
      localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false }));
    }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const demandes: string[] = [];
    p.on('request', (r) => demandes.push(new URL(r.url()).pathname));
    const demande = (f: string) => demandes.some((d) => d === `/v10/${f}`);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await passerAssistant(p);
    const bulle = p.locator('#view .i[data-info]').first();
    await bulle.waitFor({ timeout: 20_000 });
    await p.waitForTimeout(2_500);
    for (const f of ['visite.js', 'visites.js', 'guide-textes.js']) expect(demande(f), f).toBe(false);
    // Une bulle « i » : son explication arrive, à sa place.
    await bulle.click();
    const corps = p.locator('#info-pop .ip-body');
    await expect.poll(async () => net(await corps.innerText()), { timeout: 10_000 }).not.toMatch(/^Un instant/);
    expect(net(await corps.innerText()).length).toBeGreaterThan(40);
    expect(demande('guide-textes.js')).toBe(true);
    expect(demande('visite.js')).toBe(false);
    await p.locator('#info-pop .ip-close').click();
    // « Guide-moi » : les visites arrivent, et son menu s'ouvre avec la visite de la page et ses gestes.
    await p.locator('#guide-moi').click();
    const menu = p.locator('.guide-menu');
    await menu.waitFor({ timeout: 10_000 });
    expect(demande('visite.js') && demande('visites.js')).toBe(true);
    expect(await menu.locator('button').count()).toBeGreaterThan(1);
    await p.keyboard.press('Escape');
    // L'Aide : ses articles, et l'un d'eux s'ouvre sur son texte.
    await p.evaluate(() => { location.hash = '#/aide'; });
    await p.locator('#view .help-art').first().waitFor({ timeout: 10_000 });
    expect(await p.locator('#view .help-art').count()).toBeGreaterThan(10);
    await p.locator('#view .help-art').first().click();
    await expect.poll(async () => net(await p.locator('#view').innerText()).length, { timeout: 10_000 }).toBeGreaterThan(1_000);
    expect(erreurs).toEqual([]);
    await cx.close();
  });

  it('la première page neuve propose sa visite, la suivante se tait ; rouverte, elle propose ; « Ne plus me proposer » les éteint', async () => {
    const email = `nour-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nour Ayari', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Pâtisserie Les Jasmins' })).id);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const appel = p.locator('#guide-appel');
    const aller = (route: string) => p.evaluate((r) => { location.hash = r; }, route);
    const titre = async (t: string) => { await p.locator('#view h1').filter({ hasText: t }).first().waitFor({ timeout: 20_000 }); };
    // Se tait : rien en 2,5 s, le temps qu'une proposition aurait pris pour se poser.
    const seTait = async () => { await p.waitForTimeout(2_500); return appel.count(); };

    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/factures`);
    await passerAssistant(p);
    await titre('Factures');
    await appel.waitFor({ timeout: 15_000 });
    expect(net(await appel.locator('#ga-t').innerText())).toBe('Première fois sur cette page ?');
    await p.screenshot({ path: path.join(PHOTOS, 'visites-une-fois-proposee.png') });
    // Un geste ailleurs la referme (on s'est mis au travail) ; la page suivante, dans la même ouverture, se tait.
    await p.mouse.click(700, 600);
    await expect.poll(() => appel.count(), { timeout: 5_000 }).toBe(0);
    await aller('#/devis');
    await titre('Devis');
    expect(await seTait()).toBe(0);
    await aller('#/clients');
    await titre('Clients');
    expect(await seTait()).toBe(0);

    // Rouverte, l'application propose de nouveau, sur une page encore neuve ; on éteint les propositions d'un geste.
    await p.reload();
    await titre('Clients');
    await appel.waitFor({ timeout: 15_000 });
    await appel.getByRole('button', { name: 'Ne plus me proposer de visites', exact: true }).click();
    await expect.poll(() => appel.count(), { timeout: 5_000 }).toBe(0);
    expect(net(await p.locator('#toast').innerText())).toBe('Plus de proposition de visite. Les visites restent dans « Guide-moi » ; la case de « Me guider » les rallume.');
    await aller('#/achats');
    await p.reload();
    await titre('Achats');
    expect(await seTait()).toBe(0);
    await aller('#/guide');
    await p.locator('#guide-proposer').waitFor({ timeout: 15_000 });
    expect(await p.locator('#guide-proposer').isChecked()).toBe(false);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);

  // (1.144.0) Le Cabinet suit la même règle : le Tableau de bord (la Production, 1.194.0) propose sa visite, les Échéances se taisent ; rouvert, il
  // propose de nouveau, et « Ne plus me proposer de visites » les éteint.
  it('au Cabinet aussi : une proposition par ouverture, et « Ne plus me proposer de visites » d\'un geste', async () => {
    const email = `hela-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Hela Jaziri', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    const cab = String((await api('POST', '/cabinets', jeton, { nom: 'Cabinet Jaziri' })).id);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const appel = p.locator('#guide-appel');
    const aller = (route: string) => p.evaluate((r) => { location.hash = r; }, route);
    const titre = async (t: string) => { await p.locator('#view h1').filter({ hasText: t }).first().waitFor({ timeout: 20_000 }); };
    const seTait = async () => { await p.waitForTimeout(2_500); return appel.count(); };

    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab}#/production`);
    await titre('Tableau de bord');
    await appel.waitFor({ timeout: 15_000 });
    expect(net(await appel.locator('#ga-t').innerText())).toBe('Première fois sur cet écran ?');
    await p.mouse.click(700, 600);
    await expect.poll(() => appel.count(), { timeout: 5_000 }).toBe(0);
    await aller('#/echeances');
    await titre('Échéances');
    expect(await seTait()).toBe(0);

    await p.reload();
    await titre('Échéances');
    await appel.waitFor({ timeout: 15_000 });
    await appel.getByRole('button', { name: 'Ne plus me proposer de visites', exact: true }).click();
    await expect.poll(() => appel.count(), { timeout: 5_000 }).toBe(0);
    expect(net(await p.locator('#toast').innerText())).toBe('Plus de proposition de visite. Les visites restent dans « Guide-moi » ; la case de « Me guider » les rallume.');
    await aller('#/ecritures');
    await p.reload();
    await titre('Écritures');
    expect(await seTait()).toBe(0);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);
});
