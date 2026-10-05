// Le premier article, créé depuis une caisse vide (vu sur le serveur d'essai le 05/10/2026 : « + Nouvel article » ouvrait
// une fiche « Nouvelle prestation », à un commerçant qui vend des marchandises). Hichem le crée au clavier, son prix tapé
// avec la virgule, dans un navigateur réglé en anglais : la fiche dit « Nouvel article », et l'article arrive dans la
// caisse à son prix toutes taxes comprises.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('le premier article de la caisse', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-premier-article-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch({ args: ['--lang=en-US'] });
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

  it('« + Nouvel article » ouvre « Nouvel article » ; tapé « 12,500 » HT, il arrive dans la caisse à 14,875 DT', async () => {
    const email = `hichem-article-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Hichem', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Caisse du comptoir', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Quincaillerie El Amen' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/caisse`);
    const nouvel = p.locator('#cs-new-art');
    await nouvel.waitFor({ timeout: 20_000 });
    for (const b of await p.getByRole('button', { name: 'Plus tard', exact: true }).all()) await b.click().catch(() => undefined);
    await nouvel.click();
    await expect.poll(() => p.locator('#modal-root h2').first().innerText().then(net)).toBe('Nouvel article');
    await p.locator('#modal-root [name=label]').fill('Piles AA (lot de 4)');
    await p.locator('#modal-root [name=unitPrice]').click();
    await p.keyboard.press('Control+A');
    await p.keyboard.type('12,500');
    await p.locator('#modal-root').getByRole('button', { name: 'Enregistrer', exact: true }).click();
    const tuile = p.locator('#cs-articles .cs-art', { hasText: 'Piles AA (lot de 4)' });
    await expect.poll(() => tuile.locator('.cs-art-prix').innerText().then(net), { timeout: 10_000 }).toBe('14,875 DT');
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 120_000);
});
