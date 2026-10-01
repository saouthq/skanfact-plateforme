// Le Cabinet au téléphone (brique 110 ; 14 § 2.6). L'instrument de rendu de l'entreprise (tests/instrument-rendu.ts)
// passe les pages du Cabinet, sur un vrai téléphone (390 points, au doigt) et sur un ordinateur : aucune ne défile de
// côté, rien ne sort de l'écran, et au doigt tout se touche. Les écrans pensés pour un ordinateur (un dossier, les
// écritures, la production) le disent sous leur titre au téléphone, et seulement là.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { problemes } from '../instrument-rendu.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le Cabinet au téléphone', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cabtel-'));
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
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };

  it('les pages du Cabinet, sur un téléphone et un ordinateur : rien ne déborde, au doigt tout se touche, et les écrans d\'ordinateur le disent', async () => {
    // Un client au nom long (il doit tenir), un achat dans ses livres, validé ; son cabinet, qui a son mandat ; un dossier tenu.
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Société Méditerranéenne de Matériaux de Construction' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, client);
    const envoyer = (collection: string, cle: string, contenu: unknown) =>
      api('POST', `/entreprises/${ent}/dossier-v10`, client, { changements: [{ collection, cle, rang: 0, revision: null, contenu }] });
    await envoyer('suppliers', 's1', { id: 's1', name: 'Papeterie du Lac' });
    expect((await envoyer('purchases', 'a1', {
      id: 'a1', kind: 'facture', supplierId: 's1', number: 'FF-1', date: '2026-08-03', currency: 'DT', exchangeRate: 1, fees: 0, withholdingRate: 0,
      tvaRecuperable: true, lines: [{ label: 'Papier', qty: 1, unitPrice: 1000, vatRate: 19, destination: 'charge', deductible: true }], payments: [],
    })).statut).toBe(200);
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    expect((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Boulangerie Ennour' })).statut).toBe(201);
    expect((await api('POST', `/entreprises/${ent}/compta/valider`, associe, { jusqua: '2026-08-31' })).corps.validees).toBe(1);

    // `ordinateur` : un écran pensé pour un grand écran (14 § 2.6), qui le dit au téléphone.
    const PAGES: { nom: string; hash: string; ordinateur?: true }[] = [
      { nom: 'dossiers', hash: '#/dossiers' },
      { nom: 'relances', hash: '#/relances' },
      { nom: 'echeances', hash: '#/echeances' },
      { nom: 'reglages', hash: '#/reglages' },
      { nom: 'ecritures', hash: '#/ecritures', ordinateur: true },
      { nom: 'production', hash: '#/production', ordinateur: true },
      { nom: 'dossier', hash: `#/dossier/${ent}`, ordinateur: true },
      { nom: 'balance', hash: `#/dossier/${ent}/comptabilite/balance/2026`, ordinateur: true },
    ];
    const faux: string[] = [];
    let vus = 0;
    for (const largeur of [390, 1440]) {
      const doigt = largeur < 760;
      const contexte = await navigateur.newContext({ viewport: { width: largeur, height: 844 }, deviceScaleFactor: 1, locale: 'fr-FR', isMobile: doigt, hasTouch: doigt });
      await contexte.addInitScript((j) => sessionStorage.setItem('skanfact.jeton', j), associe);
      const page = await contexte.newPage();
      const erreurs: string[] = [];
      page.on('pageerror', (x) => erreurs.push(x.message));
      await page.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}`);
      await page.locator('#view h1').first().waitFor({ timeout: 15_000 });
      for (const pg2 of PAGES) {
        await page.evaluate((h) => { location.hash = h; }, pg2.hash);
        const nom = `cabinet-${pg2.nom}-${largeur}`;
        await page.locator('#view h1').first().waitFor({ timeout: 10_000 });
        // Les pages du Cabinet se dessinent souvent en deux temps (le serveur répond) : on attend que la page tienne.
        await page.waitForTimeout(1200);
        for (let i = 0; i < 3 && await page.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await page.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
        await page.waitForTimeout(300);
        faux.push(...(await page.evaluate(problemes, [doigt, largeur] as [boolean, number])).map((x) => `${nom} : ${x}`));
        const avis = await page.locator('#bandeau-ordinateur').count();
        if (avis !== (pg2.ordinateur && doigt ? 1 : 0)) faux.push(`${nom} : ${avis ? 'dit « pensé pour un ordinateur » sans l\'être' : 'ne dit pas qu\'il est pensé pour un ordinateur'}`);
        await page.screenshot({ path: path.join(PHOTOS, `${nom}.png`), fullPage: true });
        vus++;
      }
      faux.push(...erreurs.map((x) => `${largeur} : erreur de la page : ${x}`));
      await contexte.close();
    }
    expect(faux).toEqual([]);
    expect(vus).toBe(PAGES.length * 2);
  }, 400_000);
});
