// Le point de contact assemble le dossier sans dépendre de l'ordre reçu (01/10/2026 ; web/public/plateforme/pont.js,
// `assembler`). Le défaut, vu dans le jalon J2 chez GitHub : une liste vide restée à la racine (`_racine/accounts` =
// []) arrivait APRÈS le compte Konnect de la liste (une base qui range « _racine » après « accounts ») ; elle le
// recouvrait, la page ne le voyait pas, et son enregistrement suivant le supprimait. Ici, la réponse du serveur est
// remise exprès dans le pire ordre : la page voit le compte et l'article, et son enregistrement ne supprime rien.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('le dossier assemblé quel que soit l\'ordre reçu', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-ordre-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
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

  it('une liste vide restée à la racine, reçue après ses objets, ne les efface pas', async () => {
    const email = `nadia-ordre-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    // Les listes vides, comme un écran les écrit ; puis un objet dans chacune (le compte Konnect, un article).
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: '_racine', cle: 'accounts', rang: null, revision: null, contenu: [] },
      { collection: '_racine', cle: 'catalog', rang: null, revision: null, contenu: [] },
    ] })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'accounts', cle: 'k1', rang: 0, revision: null, contenu: { id: 'k1', name: 'Konnect', kind: 'autre', bank: 'Konnect', rib: '', opening: 0, openingDate: '2026-10-01', isDefault: false, statementBalance: '', notes: '' } },
      { collection: 'catalog', cle: 'ciment', rang: 0, revision: null, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', unitPrice: 25, vatRate: 19 } },
    ] })).statut).toBe(200);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    // Le pire ordre : les objets des listes d'abord, la racine ensuite.
    await cx.route(/\/v1\/entreprises\/[^/]+\/dossier-v10$/, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const r = await route.fetch();
      const corps = await r.json() as { objets: { collection: string }[] };
      corps.objets = [...corps.objets.filter((o) => o.collection !== '_racine'), ...corps.objets.filter((o) => o.collection === '_racine')];
      return route.fulfill({ response: r, json: corps });
    });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/tresorerie`);
    await expect.poll(() => p.evaluate(() => { const d = (window as unknown as { __data?: { accounts?: unknown[]; catalog?: unknown[] } }).__data; return d ? [d.accounts?.length, d.catalog?.length] : null; }), { timeout: 20_000 })
      .toEqual([1, 1]);
    // Un enregistrement (un client ajouté) : rien d'autre ne part, et surtout aucune suppression.
    await p.evaluate(() => {
      const w = window as unknown as { __data: { clients: unknown[] }; __enregistrerMaintenant: () => void };
      w.__data.clients.push({ id: 'c9', name: 'Café El Walima' });
      w.__enregistrerMaintenant();
    });
    const objets = async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string }[]).map((o) => `${o.collection}/${o.cle}`);
    await expect.poll(objets, { timeout: 10_000 }).toContain('clients/c9');
    expect(await objets()).toEqual(expect.arrayContaining(['accounts/k1', 'catalog/ciment']));
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 120_000);
});
