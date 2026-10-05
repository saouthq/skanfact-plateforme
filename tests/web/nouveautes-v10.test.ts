// Les nouveautés de la v10 décrivent l'application de bureau (10.x) : la plateforme ne les montre pas (vu sur le serveur
// d'essai le 05/10/2026 : « Nouveau dans SkanFact 10.15.0 » s'ouvrait dans un navigateur qui avait retenu la version
// « dev », celle que le pied du menu disait avant). La version du code, elle, s'écrit au pied du menu.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
// La version que le serveur des tests annonce (donnée, pas lue dans git : les preuves tournent dans une copie sans lui).
const VERSION = '2026.10.05 · 0a1b2c3';

describe('les nouveautés de l\'application de bureau, sur la plateforme', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-nouveautes-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VERSION: VERSION }), port: 0, web: dossier, livreurMs: 60_000 });
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

  it('un navigateur qui avait retenu « vdev » voit la version du code, et aucune nouveauté de la v10', async () => {
    const email = `amel-nouveautes-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Amel', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Librairie Amel' })).corps.id);
    // Une pièce : l'entreprise n'est plus une « installation neuve », à qui la v10 ne montre jamais rien.
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'École Ennour' } },
    ] })).statut).toBe(200);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => {
      if (!location.protocol.startsWith('http')) return;
      sessionStorage.setItem('skanfact.jeton', j);
      // Ce que retenait un navigateur qui avait ouvert SkanFact quand le pied du menu disait « vdev ».
      if (!localStorage.getItem('skanfact-nouveautes-vue-entreprise')) localStorage.setItem('skanfact-nouveautes-vue-entreprise', 'dev');
    }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await expect.poll(() => p.locator('#app-version').innerText(), { timeout: 20_000 }).toBe(`v${VERSION}`);
    // La carte attendrait un écran libre (une visite proposée la retarde d'une seconde et demie à la fois) : on laisse
    // passer ce temps, puis on regarde.
    for (const b of await p.getByRole('button', { name: 'Plus tard', exact: true }).all()) await b.click().catch(() => undefined);
    await p.waitForTimeout(4_000);
    expect(await p.locator('#nouveautes').count()).toBe(0);
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 120_000);
});
