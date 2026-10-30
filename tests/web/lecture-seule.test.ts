// Les pages en lecture seule, à la souris (brique 102 ; 03 § 2.1 ; web/v10/lecture-seule.txt) :
//   - Samia, comptabilité interne, lit les factures : la page le dit (« Lecture seule ») ; enregistrer un paiement
//     sur une facture lui est refusé en le disant, et rien n'arrive au serveur ;
//   - Omar, en lecture, lit les clients et les achats : créer, supprimer ou importer un client, ou enregistrer un
//     achat, lui est refusé de même.

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

describe('les pages en lecture seule, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-lecture-'));
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
    const email = `${prenom.toLowerCase()}-lecture-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    if (!code) return { email, jeton: premier };
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    return { email, jeton };
  };

  it('Samia lit les factures sans les modifier ; Omar lit les clients sans en créer', async () => {
    const nadia = await personne('Nadia', true);
    const ent = String((await api('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nadia.jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Chantier Ennasr', address: 'Ennasr 2, Ariana' } },
    ] })).statut).toBe(200);
    const lire = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown> }[];
    const c1 = (await lire()).find((o) => o.cle === 'c1')?.contenu;
    const aujourdhui = new Date().toISOString().slice(0, 10);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, nadia.jeton, { document: { id: 'f0', type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: 'c1', createdAt: 1,
      lines: [{ label: 'Ciment gris 50 kg', description: '', qty: 1, unit: 'sac', unitPrice: 25, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] },
    client: c1, revision: null, rang: 0, netAPayer: '29.750' })).statut).toBe(200);
    const inviter = async (email: string, jeton: string, role: string) => {
      const inv = String((await api('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email, roles: [role] })).corps.jeton);
      expect((await api('POST', '/invitations/accepter', jeton, { jeton: inv })).statut).toBe(200);
    };
    const samia = await personne('Samia', true);
    await inviter(samia.email, samia.jeton, 'comptabilite_interne');
    const omar = await personne('Omar', true);
    await inviter(omar.email, omar.jeton, 'lecture');

    const erreurs: string[] = [];
    const ouvrir = async (jeton: string, hash: string) => {
      const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
      await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, jeton);
      const p = await cx.newPage();
      p.on('pageerror', (e) => erreurs.push(e.message));
      await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
      await expect.poll(() => titre(p), { timeout: 20_000 }).not.toBe('');
      await plusTard(p);
      return p;
    };
    const toast = async (p: Page) => net(await p.locator('#toast').innerText().catch(() => ''));
    const bandeau = async (p: Page) => net(await p.locator('#bandeau-lecture').innerText().catch(() => ''));

    // 1. Samia : la liste des factures le dit ; le paiement lui est refusé, en le disant.
    const s = await ouvrir(samia.jeton, '#/factures');
    await expect.poll(() => bandeau(s), { timeout: 10_000 }).toBe('Lecture seule. Ton rôle te laisse lire les pièces de vente, pas les modifier : un geste qui les changerait sera refusé, en le disant.');
    await s.evaluate(() => { location.hash = '#/doc/f0'; });
    await expect.poll(() => titre(s), { timeout: 10_000 }).toMatch(/^FAC-\d{4}-001/);
    await plusTard(s);
    expect(await bandeau(s)).toMatch(/^Lecture seule\./);
    await s.locator('#pay').click();
    await expect.poll(() => s.locator('#modal-root [name=amount]').count(), { timeout: 10_000 }).toBe(1);
    await s.locator('#modal-root [name=amount]').fill('29.750');
    await s.locator('#modal-root #ok').click();
    await expect.poll(() => toast(s), { timeout: 10_000 }).toBe('Ton rôle te laisse lire les pièces de vente, pas les modifier : rien n\'a été enregistré. Le propriétaire ou un administrateur peut te donner le rôle qui le permet.');
    await s.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'lecture-1-paiement-refuse.png') });
    await s.waitForTimeout(1000);
    expect((await lire()).find((o) => o.cle === 'f0')?.contenu.payments).toEqual([]);

    // Un brouillon de facture non plus : « Enregistrer le brouillon » le refuse, au lieu de dire « Brouillon enregistré ».
    await s.locator('#modal-root').getByRole('button', { name: 'Annuler', exact: true }).click();
    const abandonner = s.locator('#modal-root').getByRole('button', { name: 'Abandonner la saisie', exact: true });
    if (await abandonner.count()) await abandonner.click();
    await expect.poll(() => s.locator('#modal-root [name=amount]').count(), { timeout: 5_000 }).toBe(0);
    await s.evaluate(() => { location.hash = '#/doc/new/facture'; });
    await expect.poll(() => titre(s), { timeout: 10_000 }).toMatch(/^Nouvelle facture|^Facture/);
    await plusTard(s);
    // (1.155.0) Une pièce neuve n'a pas de ligne : Entrée dans la barre d'ajout en pose une, libre.
    if (!(await s.locator('[data-k=label]').count()) && await s.locator('#ed-ajout').count()) await s.locator('#ed-ajout').press('Enter');
    await s.locator('[data-k=label]').first().fill('Ciment gris 50 kg');
    await s.locator('#save').click();
    await expect.poll(() => toast(s), { timeout: 10_000 }).toBe('Ton rôle te laisse lire les pièces de vente, pas les modifier : rien n\'a été enregistré. Le propriétaire ou un administrateur peut te donner le rôle qui le permet.');
    await s.waitForTimeout(1000);
    expect((await lire()).filter((x) => x.collection === 'documents').map((x) => x.cle)).toEqual(['f0']);

    // 2. Omar : la page des clients le dit ; créer un client lui est refusé.
    const o = await ouvrir(omar.jeton, '#/clients');
    await expect.poll(() => bandeau(o), { timeout: 10_000 }).toMatch(/^Lecture seule\. Ton rôle te laisse lire les fiches clients/);
    // (1.199.0, maquette Clients « Rôle qui lit seulement ») La liste ne propose ni « Importer… » ni « Nouveau client »,
    // et le dit en haut.
    await expect.poll(async () => (await o.locator('#view .lc-bandeau').innerText().catch(() => '')).replace(/\s+/g, ' ').trim(), { timeout: 15_000 })
      .toBe('Lecture seule : ton rôle te laisse lire les fiches clients, pas les modifier Un geste qui les changerait est refusé, en le disant. Le propriétaire ou un administrateur peut te donner le rôle qui le permet.');
    expect(await o.locator('#imp-clients, #view .lc-tete #new').count()).toBe(0);
    // Sa fiche (1.200.0, maquette Clients « Fiche, rôle qui lit seulement ») : le bandeau le dit, le geste principal est son
    // relevé, et aucun geste qui changerait la fiche n'est proposé (ni « Modifier », ni « Archiver », ni « Supprimer »).
    await o.evaluate(() => { location.hash = '#/client/c1'; });
    await expect.poll(async () => (await o.locator('#view .cf-bandeaux .banner.info').innerText().catch(() => '')).replace(/\s+/g, ' ').trim(), { timeout: 15_000 })
      .toBe('Lecture seule : ton rôle te laisse lire les fiches clients, pas les modifier — un geste qui les changerait est refusé, en le disant. Le propriétaire ou un administrateur peut te donner le rôle qui le permet.');
    expect(await o.locator('#view .btn-primary').evaluateAll((l) => l.map((b) => (b as HTMLElement).innerText.trim()))).toEqual(['Relevé de compte']);
    expect(await o.locator('#view [data-modifier]').count()).toBe(0);
    expect(await o.locator('#cl-notes').getAttribute('readonly')).not.toBeNull();
    await o.locator('[data-rowmenu="CL:c1"]').first().click();
    const gestes = await o.getByRole('menuitem').allInnerTexts();
    expect(gestes.join(' | ')).not.toMatch(/Modifier|Archiver|Supprimer/);
    await o.keyboard.press('Escape');
    await o.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'lecture-2-client-refuse.png') });
    expect((await lire()).filter((x) => x.collection === 'clients').map((x) => x.contenu.name)).toEqual(['Chantier Ennasr']);
    await o.evaluate(() => { location.hash = '#/achat/new'; });
    // (1.155.12) Une facture d'achat neuve ne montre que « Comment arrive cette pièce ? » : on choisit de la saisir à la main.
    await o.locator('#ac-main').click();
    await expect.poll(() => o.locator('#save').count(), { timeout: 10_000 }).toBe(1);
    await plusTard(o);
    expect(await bandeau(o)).toMatch(/^Lecture seule\. Ton rôle te laisse lire les achats/);
    await o.locator('#save').click();
    await expect.poll(() => toast(o), { timeout: 10_000 }).toBe('Ton rôle te laisse lire les achats, pas les modifier : rien n\'a été enregistré. Le propriétaire ou un administrateur peut te donner le rôle qui le permet.');

    expect(erreurs).toEqual([]);
    await s.context().close(); await o.context().close();
  }, 120_000);
});
