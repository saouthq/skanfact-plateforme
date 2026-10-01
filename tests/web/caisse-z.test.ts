// Le Z imprimé et relu, à l'écran (brique 126 ; docs/caisse.md, Z1 à Z3). Sami a déjà fermé vingt caisses ; il vend un
// pain, ferme la caisse : le Z dit qu'il l'a fermée, s'imprime sur la bande (avec les chiffres figés), puis se relit dans
// « Tickets et bilan du jour », parmi les Z passés, 20 par page (« Plus de Z… » lit la suite).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le Z imprimé et relu, à l\'écran', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-z-'));
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
  const net = (t: string) => t.replace(/[\s\u202f]+/g, ' ').trim();
  const plusTard = async (p: Page) => { for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined); };

  it('Sami ferme la caisse : le Z dit qu\'il l\'a fermée, s\'imprime, et se relit parmi les Z passés', async () => {
    const email = `nadia-z-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Bureau de Nadia', type: 'navigateur' } });
    const nadia = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', nadia, { raisonSociale: 'Boulangerie Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nadia);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nadia, { changements: [
      { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: false, statementBalance: '', notes: '' } },
      { collection: 'catalog', cle: 'pain', rang: 0, revision: null, contenu: { id: 'pain', label: 'Pain de mie', unit: 'u', unitPrice: { '~n': '1.2' }, vatRate: 7 } },
    ] })).statut).toBe(200);
    const emailSami = `sami-z-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: emailSami, nom: 'Sami', motDePasse: 'Un-bon-mot-de-passe' });
    const sami = String((await api('POST', '/connexion', undefined, { email: emailSami, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Caisse du comptoir', type: 'navigateur' } })).corps.jeton);
    const inv = String((await api('POST', `/entreprises/${ent}/invitations`, nadia, { email: emailSami, roles: ['caissier'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', sami, { jeton: inv })).statut).toBe(200);
    // Vingt caisses déjà fermées par Sami (le fond dit leur rang).
    for (let i = 1; i <= 20; i++) {
      expect((await api('POST', `/entreprises/${ent}/caisse/ouvrir`, sami, { fond: String(i) })).statut).toBe(200);
      expect((await api('POST', `/entreprises/${ent}/caisse/fermer`, sami, { compte: String(i) })).statut).toBe(200);
    }

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, sami);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/caisse`);
    await expect.poll(() => p.locator('#cs-articles .cs-art').count(), { timeout: 20_000 }).toBe(1);
    await plusTard(p);
    await p.locator('#cs-fond').fill('30');
    await p.locator('#cs-ouvrir').click();
    await expect.poll(async () => net(await p.locator('#cs-ouverte').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Caisse ouverte par Sami/);
    await p.locator('#cs-articles .cs-art', { hasText: 'Pain de mie' }).click();
    await p.locator('#cs-encaisser').click();
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Ticket TIC-\d{4}-001 encaissé/);

    // Le soir : 30 + 1,284 attendus ; il compte 31,284. Le Z dit qu'il l'a fermée.
    await p.locator('#cs-fermer').click();
    await p.locator('#modal-root #cs-compte').fill('31.284');
    await p.locator('#modal-root #cs-z').click();
    await expect.poll(async () => net(await p.locator('#modal-root #cs-z-qui').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/, fermée par Sami le \d{2}\/\d{2} \d{2}:\d{2} ; 1 ticket/);
    // Il s'imprime : la bande lit les chiffres figés. (La bande s'imprime par une fenêtre du navigateur : on la lit.)
    await p.evaluate(() => { const w = window as unknown as { __imprime?: string; open: unknown };
      w.open = () => ({ document: { write: (html: string) => { w.__imprime = html; }, close: () => undefined }, print: () => undefined }); });
    await p.locator('#modal-root #cs-z-imprimer').click();
    await expect.poll(() => p.evaluate(() => (window as unknown as { __imprime?: string }).__imprime ?? ''), { timeout: 5_000 }).toContain('Z de caisse');
    const bande = net((await p.evaluate(() => (window as unknown as { __imprime?: string }).__imprime ?? '')).replace(/<[^>]+>/g, ' '));
    expect(bande).toMatch(/Ouverte le \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} par Sami Fermée le \d{2}\/\d{2}\/\d{4} \d{2}:\d{2} par Sami Poste : /);
    expect(bande).toContain('Ventes TTC 1,284 DT');
    expect(bande).toContain('Fond de caisse 30,000 DT Le tiroir devait contenir 31,284 DT Espèces comptées 31,284 DT Écart 0,000 DT');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'z-1-ferme.png') });
    await p.locator('#modal-root #cs-z-ok').click();

    // Les Z passés : 20 par page, le plus récent d'abord ; « Plus de Z… » lit le dernier.
    await plusTard(p);
    await p.locator('#cs-tabs [data-tab=tickets]').click();
    await expect.poll(() => p.locator('#cs-z-liste tbody tr').count(), { timeout: 10_000 }).toBe(20);
    expect(net(await p.locator('#cs-z-liste tbody tr').first().innerText())).toMatch(/Sami Sami 1 1,284 DT 0,000 DT$/);
    await p.locator('#cs-z-plus').click();
    await expect.poll(() => p.locator('#cs-z-liste tbody tr').count(), { timeout: 10_000 }).toBe(21);
    expect(await p.locator('#cs-z-plus').count()).toBe(0);
    // Un Z passé se rouvre (et se réimprimerait) : celui du jour.
    await p.locator('#cs-z-liste tbody tr').first().click();
    await expect.poll(async () => net(await p.locator('#modal-root #cs-z-table').innerText().catch(() => '')), { timeout: 5_000 }).toContain('Le tiroir devait contenir 31,284 DT');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'z-2-relu.png') });
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);
});
