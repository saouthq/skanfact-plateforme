// L'ouverture d'une page, quand le serveur tarde ou refuse (1.136.0 ; UX 2, docs/hors-ligne.md). À la souris, dans un
// vrai navigateur ; le serveur est ralenti ou mis en erreur par le navigateur lui-même (ses réponses retenues, ou
// remplacées par une erreur 500). Ce que le parcours vérifie, dans l'entreprise ET au Cabinet :
//   - lente, la page dit « Ouverture de ton entreprise… » (ou « de ton cabinet »), au lieu d'un écran blanc ; au-delà de
//     dix secondes, que c'est plus long que d'habitude ; la réponse venue, la page s'ouvre et le message s'en va ;
//   - refusée par le serveur, la page le dit, avec la raison, « Réessayer » et la page d'état ; « Réessayer », le
//     serveur revenu, ouvre la page.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('l\'ouverture d\'une page, le serveur lent ou en erreur', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-ouverture-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
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
  const ouvrir = async (jeton: string) => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    return cx.newPage();
  };
  const couche = (p: Page) => p.locator('#poste-ouverture');
  // Les lectures qui ouvrent la page, retenues jusqu'à ce que le parcours les relâche (ou remplacées par une erreur).
  const retenir = async (p: Page, motif: RegExp) => {
    let relacher = () => {};
    const relache = new Promise<void>((ok) => { relacher = ok; });
    await p.route((u) => motif.test(u.pathname), async (r) => { await relache; await r.continue().catch(() => {}); });
    return () => relacher();
  };
  const refuser = (p: Page, motif: RegExp) => p.route((u) => motif.test(u.pathname), (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ erreur: 'interne' }) }));

  it('l\'entreprise : lente, elle dit qu\'elle s\'ouvre ; refusée, elle le dit, et « Réessayer » l\'ouvre', async () => {
    const jeton = await personne('sarra');
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const p = await ouvrir(jeton);
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const relacher = await retenir(p, /\/dossier-v10$/);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await expect.poll(() => couche(p).innerText().catch(() => ''), { timeout: 5000 }).toContain('Ouverture de ton entreprise…');
    expect(await p.locator('#po-lent').count()).toBe(0);
    await expect.poll(() => p.locator('#po-lent').count(), { timeout: 15_000 }).toBe(1);
    expect(await p.locator('#po-lent').innerText()).toContain('plus long que d\'habitude');
    relacher();
    await expect.poll(() => couche(p).count(), { timeout: 15_000 }).toBe(0);
    await expect.poll(() => p.locator('#view').innerText().catch(() => ''), { timeout: 15_000 }).not.toBe('');

    // Le serveur refuse : la raison, « Réessayer », la page d'état. Rien ne reste blanc, et la page ne plante pas.
    await p.unrouteAll({ behavior: 'ignoreErrors' });
    await refuser(p, /\/dossier-v10$/);
    await p.reload();
    await expect.poll(() => couche(p).innerText().catch(() => ''), { timeout: 10_000 }).toContain('SkanFact n\'a pas pu ouvrir ton entreprise.');
    expect(await couche(p).getAttribute('role')).toBe('alert');
    expect(await p.locator('#po-motif').innerText()).toMatch(/erreur/i);
    expect(await couche(p).getByRole('link', { name: 'Voir la page d\'état' }).getAttribute('href')).toBe('/etat');
    expect(erreurs).toEqual([]);
    await p.unrouteAll({ behavior: 'ignoreErrors' });
    await couche(p).getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect.poll(() => couche(p).count(), { timeout: 15_000 }).toBe(0);
    await expect.poll(() => p.locator('#view').innerText().catch(() => ''), { timeout: 15_000 }).not.toBe('');
    await p.context().close();
  }, 120_000);

  it('le Cabinet : lent, il dit qu\'il s\'ouvre ; refusé, il le dit, et « Réessayer » l\'ouvre', async () => {
    const jeton = await personne('hatem');
    const cabinet = String((await api('POST', '/cabinets', jeton, { nom: 'Cabinet Jlassi Conseil' })).corps.id);
    const p = await ouvrir(jeton);
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const relacher = await retenir(p, /\/portefeuille$/);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossiers`);
    await expect.poll(() => couche(p).innerText().catch(() => ''), { timeout: 5000 }).toContain('Ouverture de ton cabinet…');
    relacher();
    await expect.poll(() => couche(p).count(), { timeout: 15_000 }).toBe(0);
    await expect.poll(() => p.getByRole('heading', { name: 'Dossiers', exact: true }).count(), { timeout: 15_000 }).toBe(1);

    await p.unrouteAll({ behavior: 'ignoreErrors' });
    await refuser(p, /\/portefeuille$/);
    await p.reload();
    await expect.poll(() => couche(p).innerText().catch(() => ''), { timeout: 10_000 }).toContain('SkanFact n\'a pas pu ouvrir ton cabinet.');
    expect(erreurs).toEqual([]);
    await p.unrouteAll({ behavior: 'ignoreErrors' });
    await couche(p).getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect.poll(() => p.getByRole('heading', { name: 'Dossiers', exact: true }).count(), { timeout: 15_000 }).toBe(1);
    expect(await couche(p).count()).toBe(0);
    await p.context().close();
  }, 120_000);

  // (1.137.0) Après l'ouverture : la carte « Ce mois-ci » du Suivi d'un dossier disparaissait sans rien dire quand le
  // serveur refusait de la lire.
  it('le Suivi d\'un dossier : « Ce mois-ci » refusé par le serveur le dit, et « Réessayer » le relit', async () => {
    // Un client sur SkanFact, sous mandat accepté (un dossier tenu au cabinet n'a pas de « Ce mois-ci »).
    const jeton = await personne('hatem');
    const cab = (await api('POST', '/cabinets', jeton, { nom: 'Cabinet Jlassi Conseil' })).corps;
    const sarra = await personne('sarra');
    const dossier = String((await api('POST', '/entreprises', sarra, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${dossier}/mandat`, sarra, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${String(cab.id)}/mandats/${mandat}/accepter`, jeton)).statut).toBe(200);
    const p = await ouvrir(jeton);
    await refuser(p, /\/compta\/resume$/);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${String(cab.id)}#/dossier/${dossier}/suivi`);
    const carte = p.locator('#d-ce-mois');
    await expect.poll(() => carte.locator('[data-ce-mois-refus]').innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/^Ce mois-ci n'a pas pu se lire\. ./);
    expect(await carte.locator('[data-ce-mois-pieces]').count()).toBe(0);
    await p.unrouteAll({ behavior: 'ignoreErrors' });
    await carte.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect.poll(() => carte.locator('[data-ce-mois-pieces]').innerText().catch(() => ''), { timeout: 15_000 }).toBe('Aucune vente ni aucun achat dans ses livres ce mois-ci.');
    expect(await carte.locator('[data-ce-mois-refus]').count()).toBe(0);
    await p.context().close();
  }, 120_000);

  // (1.138.0) La Comptabilité d'un dossier, la Production et les Échéances : la lecture refusée le dit, avec « Réessayer »
  // (les Échéances disaient « Aucune échéance à suivre » d'une lecture qui avait échoué).
  it('au Cabinet, la Comptabilité, la Production et les Échéances refusées le disent, et « Réessayer » les relit', async () => {
    const jeton = await personne('hatem');
    const cab = (await api('POST', '/cabinets', jeton, { nom: 'Cabinet Jlassi Conseil' })).corps;
    const sarra = await personne('sarra');
    const dossier = String((await api('POST', '/entreprises', sarra, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${dossier}/mandat`, sarra, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${String(cab.id)}/mandats/${mandat}/accepter`, jeton)).statut).toBe(200);
    const p = await ouvrir(jeton);
    await refuser(p, /\/(compta\/ecritures|production|questions)$/);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${String(cab.id)}#/echeances`);
    await expect.poll(() => p.locator('#ech-refus h2').innerText().catch(() => ''), { timeout: 15_000 }).toBe('Le calendrier n\'a pas pu se lire');
    expect(await p.getByText('Aucune échéance à suivre', { exact: false }).count()).toBe(0);
    await p.evaluate(() => { location.hash = '#/production'; });
    // (1.194.0) La Production est le Tableau de bord : « À faire maintenant » reste, la grille dit qu'elle ne s'est pas lue.
    await expect.poll(() => p.locator('#tb-refus').innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/^La grille ne s'est pas lue\s+./);
    expect(await p.locator('#tb-relire').innerText()).toBe('Réessayer');
    await p.evaluate((d) => { location.hash = `#/dossier/${d}/comptabilite`; }, dossier);
    await expect.poll(() => p.locator('#lv-refus').innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/^La comptabilité n'a pas pu se lire\. ./);
    // Le serveur revenu, chaque « Réessayer » relit sans recharger la page.
    await p.unrouteAll({ behavior: 'ignoreErrors' });
    await p.locator('#lv-relire-tout').click();
    await expect.poll(async () => { const v = await p.locator('#c-livres').innerText().catch(() => ''); return v.length > 0 && !v.includes('Lecture des paquets') && !v.includes('Lecture du livre'); }, { timeout: 15_000 }).toBe(true);
    expect(await p.locator('#lv-refus').count()).toBe(0);
    // La Production se relit d'elle-même quand on y revient ; les Échéances, par leur « Réessayer » s'il est encore là.
    await p.evaluate(() => { location.hash = '#/production'; });
    await expect.poll(async () => { const v = await p.locator('#page-bord').innerText().catch(() => ''); return v.includes('Tableau de bord') && !v.includes('Lecture des dossiers'); }, { timeout: 15_000 }).toBe(true);
    expect(await p.locator('#tb-refus').count()).toBe(0);
    await p.evaluate(() => { location.hash = '#/echeances'; });
    await p.waitForTimeout(1000);
    if (await p.locator('#ech-relire').count()) await p.locator('#ech-relire').click();
    await expect.poll(() => p.getByText('Aucune échéance à suivre', { exact: false }).count(), { timeout: 15_000 }).toBe(1);
    await p.context().close();
  }, 120_000);
});
