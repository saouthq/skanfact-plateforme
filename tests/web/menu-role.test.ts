// Le menu selon le rôle, à la souris (brique 101 ; 03 § 2.1 ; web/v10/menu-role.txt) :
//   - Karim, commercial, ne voit dans son menu ni la Paie, ni les Achats, ni la Trésorerie, ni la Comptabilité ;
//     l'adresse de la Paie ouverte quand même dit que son rôle ne la lui montre pas, et le ramène à l'accueil ;
//   - Leila, qui fait la paie, voit la Paie (et Sami Trabelsi), pas les Factures ni les Clients.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le menu selon le rôle, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-menu-role-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

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
  const titre = (p: Page) => p.locator('#view h1').first().innerText().then(net);
  // Une personne connectée ; avec son code du téléphone quand son rôle le demande.
  const personne = async (prenom: string, code = false) => {
    const email = `${prenom.toLowerCase()}-menu-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    if (!code) return { email, jeton: premier };
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    return { email, jeton };
  };

  it('chacun ne voit dans son menu que les pages de son rôle ; une adresse cachée dit pourquoi', async () => {
    const nadia = await personne('Nadia', true);
    const ent = String((await api('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nadia.jeton, { changements: [
      { collection: 'employees', cle: 'e1', rang: 0, revision: null, contenu: { id: 'e1', name: 'Sami Trabelsi', firstName: 'Sami', lastName: 'Trabelsi' } },
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Chantier Ennasr', address: 'Ennasr 2, Ariana' } },
    ] })).statut).toBe(200);
    const inviter = async (email: string, jeton: string, role: string) => {
      const inv = String((await api('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email, roles: [role] })).corps.jeton);
      expect((await api('POST', '/invitations/accepter', jeton, { jeton: inv })).statut).toBe(200);
    };
    const karim = await personne('Karim');
    await inviter(karim.email, karim.jeton, 'commercial');
    const leila = await personne('Leila', true);
    await inviter(leila.email, leila.jeton, 'paie');

    const erreurs: string[] = [];
    // `jour` : l'heure du navigateur part de ce jour (et s'écoule) ; ce que l'écran calcule d'après la date ne dépend
    // plus du jour où le test tourne.
    const ouvrir = async (jeton: string, hash: string, jour?: string) => {
      const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
      if (jour) await cx.clock.install({ time: new Date(jour) });
      await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, jeton);
      const p = await cx.newPage();
      p.on('pageerror', (e) => erreurs.push(e.message));
      await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
      await expect.poll(() => titre(p), { timeout: 20_000 }).not.toBe('');
      await plusTard(p);
      return p;
    };
    // Les pages que le menu propose (celles d'une famille repliée comprises : elles y sont, cachées par le pli).
    const menu = (p: Page) => p.locator('#nav a[data-route]').evaluateAll((as) => as.map((a) => (a as HTMLElement).dataset.route ?? ''));

    // 1. Karim, commercial.
    const k = await ouvrir(karim.jeton, '#/dashboard');
    await expect.poll(() => menu(k), { timeout: 10_000 }).toEqual(expect.arrayContaining(['devis', 'factures', 'clients', 'catalogue']));
    const siens = await menu(k);
    for (const x of ['paie', 'achats', 'fournisseurs', 'commandesf', 'tresorerie', 'marges', 'compta']) expect(siens).not.toContain(x);
    await k.evaluate(() => { location.hash = '#/paie'; });
    await expect.poll(() => k.locator('#page-interdite').count(), { timeout: 10_000 }).toBe(1);
    expect(await titre(k)).toBe('Paie');
    expect(net(await k.locator('#page-interdite').innerText())).toContain('Ton rôle ne te montre pas cette page');
    expect(net(await k.locator('#view').innerText())).not.toContain('Trabelsi');
    // Et elle ne propose pas la visite d'une page qu'il ne voit pas.
    await k.waitForTimeout(1500);
    expect(await k.getByText('Première fois sur cette page ?').count()).toBe(0);
    // (1.134.0) Depuis la 1.129.0 la visite ne se propose qu'une fois par ouverture : l'accueil l'a déjà prise ici, et la
    // règle ne se mesure qu'avec la page cachée ouverte la PREMIÈRE (sans « Plus tard », qui fermerait la proposition).
    const cxCachee = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cxCachee.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, karim.jeton);
    const kc = await cxCachee.newPage();
    kc.on('pageerror', (e) => erreurs.push(e.message));
    await kc.goto(`${serveur.adresse}/v10/?e=${ent}#/paie`);
    await expect.poll(() => kc.locator('#page-interdite').count(), { timeout: 20_000 }).toBe(1);
    await kc.waitForTimeout(1500);
    expect(await kc.getByText('Première fois sur cette page ?').count()).toBe(0);
    await cxCachee.close();
    await k.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'menu-role-1-commercial.png') });
    await k.locator('#pi-accueil').click();
    await expect.poll(() => titre(k), { timeout: 10_000 }).toBe('Accueil');
    // Son accueil (brique 111) : ses pièces, oui ; la mise en place de l'entreprise (le travail du propriétaire), non ;
    // ses pages, d'un clic. Le vert reste à « + Nouvelle facture » (un seul bouton principal).
    await expect.poll(() => k.locator('#accueil-role').count(), { timeout: 10_000 }).toBe(1);
    expect(await k.locator('#new-facture').count()).toBe(1);
    expect(net(await k.locator('#view').innerText())).not.toMatch(/Prends ta gestion en main|Tes premiers pas/);
    expect(await k.locator('#accueil-role a[href="#/factures"]').count()).toBe(1);
    expect(await k.locator('#accueil-role a.btn-primary').count()).toBe(0);

    // 2. Leila, la paie. Son navigateur vit le 10/10/2026 : la CNSS du 15/10 tombe sous quinze jours, la TVA du 28/10
    // non (le 14/10, il y en avait deux ; du 29 au 13, souvent aucune : le test changeait d'avis avec le calendrier).
    const l = await ouvrir(leila.jeton, '#/paie', '2026-10-10T09:00:00');
    await l.locator('#view [data-tab=salaries]').click();
    await expect.poll(async () => net(await l.locator('#view').innerText().catch(() => '')), { timeout: 20_000 }).toContain('Trabelsi');
    const siensL = await menu(l);
    expect(siensL).toContain('paie');
    for (const x of ['devis', 'factures', 'clients', 'achats']) expect(siensL).not.toContain(x);
    await l.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'menu-role-2-paie.png') });
    await l.evaluate(() => { location.hash = '#/factures'; });
    await expect.poll(() => l.locator('#page-interdite').count(), { timeout: 10_000 }).toBe(1);
    expect(net(await l.locator('#view').innerText())).not.toContain('Chantier Ennasr');
    // Son accueil (brique 111) : ni devis ni facture à créer, ni mise en place de l'entreprise ; la Paie, d'un clic.
    await l.evaluate(() => { location.hash = '#/dashboard'; });
    await expect.poll(() => l.locator('#accueil-role').count(), { timeout: 10_000 }).toBe(1);
    expect(await l.locator('#new-devis, #new-facture').count()).toBe(0);
    expect(net(await l.locator('#view').innerText())).not.toMatch(/Prends ta gestion en main|Tes premiers pas/);
    // « À faire » lui dit l'échéance de la CNSS ; mais pas de bouton vers le calendrier de la Comptabilité, page que
    // son rôle ne lui montre pas (brique 111).
    const aFaire = net(await l.locator('#todo-list').innerText());
    expect(aFaire).toContain('1 échéance fiscale sous 15 jours');
    expect(aFaire).toContain('Déclaration CNSS trimestrielle le 15/10/2026');
    expect(await l.getByRole('button', { name: 'Voir le calendrier', exact: true }).count()).toBe(0);
    expect(await l.getByRole('button', { name: 'Voir les bulletins', exact: true }).count()).toBe(1);
    await l.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'menu-role-3-accueil-paie.png') });
    await l.locator('#accueil-role a.btn-primary', { hasText: 'Paie' }).click();
    await expect.poll(() => titre(l), { timeout: 10_000 }).toBe('Paie');

    expect(erreurs).toEqual([]);
    await k.context().close(); await l.context().close();
  }, 120_000);
});
