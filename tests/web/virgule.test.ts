// La virgule est la décimale, quelle que soit la langue du navigateur (web/public/plateforme/virgule.js ; docs/pont-v10.md,
// « La virgule des champs de nombre ») : trouvé le 05/10/2026 sur le serveur d'essai, où « 38,475 » tapé dans un prix
// devenait 38 475. Hichem, dont le navigateur est réglé en anglais, tape au clavier « 2,5 » sacs à « 12,250 », puis
// colle « 1 250,500 » copié d'un tableur et « 2.075,250 » copié d'un relevé : la facture compte 2,5 × 12,250, 1 250,500
// et 2 075,250, et le serveur garde ces nombres-là. Le navigateur est lancé en anglais : c'est là que la virgule se
// perdait.

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

describe('la virgule d\'un prix tapé dans un navigateur réglé en anglais', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-virgule-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch({ args: ['--lang=en-US'] });
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

  it('« 2,5 » sacs à « 12,250 » tapés, « 1 250,500 » et « 2.075,250 » collés : la facture et le serveur les comptent tels quels', async () => {
    const email = `hichem-virgule-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Hichem', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Quincaillerie El Amen' })).corps.id);
    const aujourdhui = new Date().toISOString().slice(0, 10);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const ligne = (label: string) => ({ label, description: '', qty: 1, unit: '', unitPrice: 0, vatRate: 19 });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Chantier Sakiet Ezzit' } },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: 'c1', createdAt: Date.now(),
        lines: [ligne('Ciment gris 50 kg'), ligne('Pompe à eau'), ligne('Chauffe-eau 80 L')], discountRate: 0, withholdingRate: 0, payments: [] } },
    ] })).statut).toBe(200);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
    await cn.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: serveur.adresse });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
    await expect.poll(() => titre(p), { timeout: 20_000 }).toMatch(/^Facture/);
    await plusTard(p);

    // 1. Au clavier, comme on l'écrit en Tunisie : la virgule est la décimale.
    const taper = async (champ: string, texte: string) => {
      await p.locator(champ).click();
      await p.keyboard.press('Control+A');
      await p.keyboard.type(texte);
      await p.keyboard.press('Tab');
    };
    await taper('#lines tr[data-i="0"] input[data-k=qty]', '2,5');
    await taper('#lines tr[data-i="0"] input[data-k=unitPrice]', '12,250');
    await expect.poll(() => p.locator('#lines [data-total="0"]').innerText().then(net)).toBe('30,625');

    // 2. Collé d'un tableur (l'espace insécable des milliers, la virgule), puis d'un relevé (le point des milliers).
    const coller = async (champ: string, texte: string) => {
      await p.locator(champ).click();
      await p.keyboard.press('Control+A');
      await p.evaluate((t) => navigator.clipboard.writeText(t), texte);
      await p.keyboard.press('Control+V');
      await p.keyboard.press('Tab');
    };
    await coller('#lines tr[data-i="1"] input[data-k=unitPrice]', '1\u00a0250,500');
    await expect.poll(() => p.locator('#lines [data-total="1"]').innerText().then(net)).toBe('1 250,500');
    await coller('#lines tr[data-i="2"] input[data-k=unitPrice]', '2.075,250');
    await expect.poll(() => p.locator('#lines [data-total="2"]').innerText().then(net)).toBe('2 075,250');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'virgule-1-facture.png') });

    // 3. Le brouillon enregistré : le serveur garde ces nombres-là, pas 25 × 12 250.
    await p.locator('#save').click();
    const lignes = async () => (((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { cle: string; contenu: { lines?: unknown[] } }[])
      .find((o) => o.cle === 'f1')?.contenu.lines ?? []) as { qty: unknown; unitPrice: unknown }[];
    await expect.poll(async () => (await lignes()).map((l) => [l.qty, l.unitPrice]), { timeout: 10_000 })
      .toEqual([[{ '~n': '2.5' }, { '~n': '12.25' }], [1, { '~n': '1250.5' }], [1, { '~n': '2075.25' }]]);
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 120_000);
});
