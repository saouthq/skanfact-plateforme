// Relire le dossier par différence, à la souris (brique 119 ; docs/leger.md, S4). Sur « mon ordinateur », Nadia ouvre
// l'entreprise d'essai ; d'un autre poste, un client est ajouté et un autre retiré ; elle rouvre : seul ce qui a changé
// repart du serveur, et l'écran montre le nouveau client, plus l'ancien.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('relire le dossier par différence, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-relecture-'));
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
  type Objet = { collection: string; cle: string; rang: number | null; contenu: Record<string, unknown>; revision: number };

  it('rouvrir ne fait repartir que ce qui a changé, et l\'écran le montre', async () => {
    const email = `relecture-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Bureau', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).corps.id);

    // « Mon ordinateur » : la session gardée dans le navigateur, et le navigateur qui promet de garder.
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript(() => { if (navigator.storage) Object.assign(navigator.storage, { persist: async () => true, persisted: async () => true }); });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http') || localStorage.getItem('test.pose')) return;
      localStorage.setItem('test.pose', '1');
      localStorage.setItem('skanfact.jeton', j);
    }, jeton);
    // L'entreprise d'essai sert ici d'entreprise de travail (ses tiers d'essai, sans l'exemple de cinq ans) : elle s'ouvre
    // telle quelle, comme après « Ouvrir telle quelle » ; vide de pièces, elle partirait vers « On prépare l'exemple ».
    await cx.addInitScript(() => { const e = new URLSearchParams(location.search).get('e'); if (e) sessionStorage.setItem('skanfact.essai_tel_quel', e); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    // Chaque lecture du dossier : son adresse et ce qu'elle a rendu.
    const lectures: { url: string; corps: { partiel?: boolean; objets: Objet[]; retires?: unknown[] }; octets: number }[] = [];
    p.on('response', async (rep) => {
      if (rep.request().method() !== 'GET' || !/\/dossier-v10(\?|$)/.test(rep.url())) return;
      const texte = await rep.text().catch(() => '');
      if (texte) lectures.push({ url: rep.url(), corps: JSON.parse(texte), octets: Buffer.byteLength(texte) });
    });
    const ouvrir = async (encore = false) => {
      if (encore) await p.reload(); else await p.goto(`${serveur.adresse}/v10/?e=${ent}#/clients`);
      await p.locator('#view h1').first().waitFor({ timeout: 30_000 });
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
    };
    const laCopie = () => p.evaluate(async (id) => {
      const db = await new Promise<IDBDatabase>((ok, ko) => { const q = indexedDB.open('skanfact-poste'); q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error); });
      if (!db.objectStoreNames.contains('copies')) { db.close(); return 0; }
      const c = await new Promise<{ le: number } | undefined>((ok, ko) => { const q = db.transaction('copies').objectStore('copies').get(id); q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error); });
      db.close();
      return c ? c.le : 0;
    }, ent);

    // La première ouverture : tout le dossier ; la copie se garde.
    await ouvrir();
    await expect.poll(laCopie, { timeout: 20_000 }).toBeGreaterThan(0);
    const entiere = lectures.at(-1);
    expect(entiere?.url).not.toMatch(/depuis=/);
    const clients = (entiere?.corps.objets ?? []).filter((o) => o.collection === 'clients');
    const parti = clients[0] as Objet;
    expect(parti).toBeDefined();
    const nomParti = String(parti.contenu.name);
    // À sa première ouverture, la page enregistre ce qu'elle met en place (sa version, ses réglages…) : la lecture
    // suivante le rend (une écriture postérieure à la marque repart toujours, même la sienne).
    const premiere = await laCopie();
    await ouvrir(true);
    await expect.poll(laCopie, { timeout: 20_000 }).toBeGreaterThan(premiere);
    expect(lectures.at(-1)?.corps.partiel).toBe(true);
    await p.waitForTimeout(1_000);

    // D'un autre poste : un client ajouté, un autre retiré.
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c-dar-said', rang: clients.length + 1, revision: null, contenu: { id: 'c-dar-said', name: 'Hôtel Dar Said', city: 'Sidi Bou Saïd' } },
      { collection: 'clients', cle: parti.cle, rang: null, revision: parti.revision, contenu: null },
    ] })).statut).toBe(200);

    // Rouvrir : seule la différence repart, et l'écran la montre.
    const avant = await laCopie();
    await ouvrir(true);
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 20_000 }).toContain('Hôtel Dar Said');
    expect(await p.locator('#view').innerText()).not.toContain(nomParti);
    const difference = lectures.at(-1);
    expect(difference?.url).toMatch(/depuis=\d+&profil=/);
    expect(difference?.corps.partiel).toBe(true);
    expect(difference?.corps.objets.map((o) => o.cle)).toEqual(['c-dar-said']);
    expect(difference?.corps.retires).toEqual([{ collection: 'clients', cle: parti.cle }]);
    // La copie suit : elle se réécrit avec la nouvelle marque.
    await expect.poll(laCopie, { timeout: 20_000 }).toBeGreaterThan(avant);
    fs.mkdirSync(path.join(RACINE, 'dist/mesures'), { recursive: true });
    fs.writeFileSync(path.join(RACINE, 'dist/mesures/relecture.txt'),
      `Entreprise d'essai : lecture entière ${entiere?.octets} octets (${entiere?.corps.objets.length} objets) ; différence ${difference?.octets} octets\n`);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'relecture-1-client-arrive.png') });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
