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
});
