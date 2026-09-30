// Les droits geste par geste dans le dossier, à la souris (brique 99 ; 03 § 2.1 ; serveur/v10/droits.ts) :
//   - un commercial ouvre l'application de son entreprise, crée un client et une facture, et l'émet (la première
//     facture de l'entreprise : sa série naît avec elle) ;
//   - il ne voit pas la paie ; modifier un prix du catalogue lui est refusé, en le disant, et rien ne part.

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

describe('les droits dans le dossier, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-droits-'));
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
  const personne = async (prenom: string) => {
    const email = `${prenom.toLowerCase()}-droits-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } })).corps.jeton);
    return { email, jeton };
  };
  it('Karim, commercial, facture son client sans voir la paie ; un prix du catalogue lui est refusé', async () => {
    const email = `nadia-droits-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'catalog', cle: 'ciment', rang: 0, revision: null, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', unitPrice: 21, vatRate: 19 } },
      { collection: 'employees', cle: 'e1', rang: 0, revision: null, contenu: { id: 'e1', name: 'Sami Trabelsi', firstName: 'Sami', lastName: 'Trabelsi' } },
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Chantier Ennasr', address: 'Ennasr 2, Ariana' } },
    ] });
    expect(ecrit.statut).toBe(200);
    const karim = await personne('Karim');
    const invitation = String((await api('POST', `/entreprises/${ent}/invitations`, jeton, { email: karim.email, roles: ['commercial'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', karim.jeton, { jeton: invitation })).statut).toBe(200);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, karim.jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const toast = async () => net(await p.locator('#toast').innerText().catch(() => ''));

    // 1. Une facture pour Chantier Ennasr, depuis le catalogue ; il l'enregistre, puis l'émet.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/new/facture`);
    await expect.poll(() => titre(p), { timeout: 20_000 }).toMatch(/^Nouvelle facture|^Facture/);
    await plusTard(p);
    await p.locator('[data-combo=clientId] .combo-btn').click();
    await p.locator('[data-combo=clientId] .combo-q').fill('Ennasr');
    await p.locator('[data-combo=clientId] .combo-list [role=option]').first().click();
    await p.locator('#lines input[data-k=label], [data-k=label]').first().fill('Ciment gris 50 kg');
    await p.locator('[data-k=qty]').first().fill('10');
    await p.locator('[data-k=unitPrice]').first().fill('21');
    await p.locator('input[name=applyStamp]').uncheck();
    await p.locator('#save').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe('Brouillon enregistré');
    // « Enregistré » est vrai : le brouillon est au serveur.
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; contenu: Record<string, unknown> }[])
      .filter((o) => o.collection === 'documents' && o.contenu.type === 'facture' && o.contenu.status === 'brouillon').length, { timeout: 10_000 }).toBe(1);
    await p.locator('#issue').click();
    await expect.poll(() => p.locator('#modal-root #ok').count(), { timeout: 10_000 }).toBe(1);
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => titre(p), { timeout: 20_000 }).toMatch(/^Facture FAC-\d{4}-001/);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'droits-1-facture-du-commercial.png') });

    // 2. La paie ne lui montre rien.
    await p.evaluate(() => { location.hash = '#/paie'; });
    await p.waitForTimeout(500);
    expect(net(await p.locator('#view').innerText())).not.toContain('Trabelsi');

    // 3. Le prix d'un article : refusé, en le disant, et rien ne part au serveur.
    await p.evaluate(() => { location.hash = '#/catalogue'; });
    await expect.poll(() => p.locator('#view tr', { hasText: 'Ciment gris 50 kg' }).count(), { timeout: 10_000 }).toBeGreaterThan(0);
    await p.locator('#view tr', { hasText: 'Ciment gris 50 kg' }).locator('td').first().click();
    await p.locator('#kf input[name=unitPrice]').fill('1');
    await p.locator('#modal-root #ok').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe('Ton rôle ne permet pas de modifier le catalogue : ses articles et leurs prix se règlent par le propriétaire ou un administrateur. Rien n\'a été enregistré.');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'droits-2-prix-refuse.png') });
    // Les paramètres de l'entreprise : refusés de même.
    await p.locator('#modal-root').getByRole('button', { name: 'Annuler', exact: true }).click();
    await p.locator('#modal-root').getByRole('button', { name: 'Abandonner la saisie', exact: true }).click();
    await expect.poll(() => p.locator('#kf').count()).toBe(0);
    await p.evaluate(() => { location.hash = '#/parametres'; });
    await expect.poll(() => p.locator('#pf input[name=name]').count(), { timeout: 10_000 }).toBe(1);
    await plusTard(p);
    await p.locator('#pf input[name=name]').fill('Autre nom');

    await p.locator('#save-bar #save').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe('Ton rôle ne permet pas de modifier les paramètres de l\'entreprise : ils se règlent par le propriétaire ou un administrateur. Rien n\'a été enregistré.');
    const lu = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { cle: string; contenu: Record<string, unknown> }[];
    expect(lu.find((o) => o.cle === 'ciment')?.contenu.unitPrice).toBe(21);
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 120_000);
});
