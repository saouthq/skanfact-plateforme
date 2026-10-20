// Le livre d'un dossier se relit quand il a bougé (1.79.0 ; docs/recette.md, « 1.79.0 »), à la souris. Leïla regarde le
// livre-journal d'un client pendant que des mouvements y arrivent :
//   - en revenant sur la fenêtre, « Consulter » compte le nouveau brouillard sans recharger la page ;
//   - en passant à « Déclarer », l'en-tête du livre et la déclaration sont lus au même moment : un seul chiffre ;
//   - pendant une saisie, rien ne se redessine sous la main ;
//   - (1.80.0) aux Échéances, une déclaration pas prête le dit avant d'être marquée déposée ; le client à valider y est
//     nommé, et « Valider ses écritures » ouvre sa saisie.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('le livre d\'un dossier se relit quand il a bougé, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-livre-a-jour-'));
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
  const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
  const annee = aujourdhui.slice(0, 4);

  it('Consulter se relit en revenant sur la fenêtre, Déclarer dit le même chiffre que l\'en-tête, la saisie ne bouge pas', async () => {
    const personne = async (qui: string) => {
      const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
      await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
      const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
      await api('POST', '/moi/code', jeton, { methode: 'application' });
      return jeton;
    };
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    // Son client, sur SkanFact, lui a confié son dossier (le mandat accepté) : c'est lui qui vend et encaisse.
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Droguerie du Port' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, client);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila);
    const frais = (id: string, montant: string) => ({ collection: 'movements', cle: id, rang: 0, revision: null,
      contenu: { id, date: aujourdhui, kind: 'banque', amount: { '~n': montant }, accountId: 'k-banque', method: 'virement', label: `Frais ${id}` } });
    const envoyer = async (changements: unknown[]) => expect((await api('POST', `/entreprises/${ent}/dossier-v10`, client, { changements })).statut).toBe(200);
    await envoyer([{ collection: 'accounts', cle: 'k-banque', rang: 0, revision: null,
      contenu: { id: 'k-banque', name: 'BIAT', kind: 'banque', bank: '', rib: '', opening: 0, openingDate: aujourdhui, isDefault: true, statementBalance: '', notes: '' } },
    frais('m1', '7.125')]);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, leila);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/journal/${annee}`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    const enTete = () => p.locator('#lv-brouillard').locator('xpath=..').innerText().catch(() => '');
    await expect.poll(enTete, { timeout: 15_000 }).toBe('Compter 1 écriture en brouillard');

    // 1. Un mouvement arrive pendant que Leïla est ailleurs ; elle revient sur la fenêtre : le livre le compte.
    await envoyer([frais('m2', '3.5')]);
    await p.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(enTete, { timeout: 10_000 }).toBe('Compter 2 écritures en brouillard');

    // 2. Un autre arrive ; elle passe à « Déclarer » : l'en-tête et la déclaration du mois, lus au même moment.
    await envoyer([frais('m3', '1.75')]);
    await p.locator('.seg button, button').filter({ hasText: /^Déclarer et clôturer$/ }).first().click();
    const declaration = p.locator('#c-livres');
    await expect.poll(() => declaration.innerText(), { timeout: 15_000 }).toMatch(/3 pièces encore en brouillard sur ce mois/);
    expect(await enTete()).toBe('Compter 3 écritures en brouillard');

    // 3. Dans la saisie, un mouvement qui arrive ne redessine rien sous la main (le contenu marqué reste le même).
    await p.locator('button').filter({ hasText: /^Saisir/ }).first().click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/comptabilite\/saisie\//);
    await p.waitForTimeout(800);
    await p.evaluate(() => { const e = document.querySelector('#c-livres')?.firstElementChild as (Element & { marque?: number }) | null | undefined; if (e) e.marque = 1; });
    await envoyer([frais('m4', '2.25')]);
    await p.evaluate(() => window.dispatchEvent(new Event('focus')));
    await p.waitForTimeout(1500);
    expect(await p.evaluate(() => (document.querySelector('#c-livres')?.firstElementChild as (Element & { marque?: number }) | null)?.marque)).toBe(1);

    // 4. (1.80.0) Aux Échéances : sans mois terminé, le calendrier vide dit sa vraie raison ; une pièce du mois dernier au
    //    brouillard, et la TVA de ce mois-là est « à valider » : « Marquer déposée » le dit avant de pointer.
    await p.evaluate(() => { location.hash = '#/echeances'; });
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 15_000 }).toMatch(/Droguerie du Port n'a encore rien à déclarer sur un mois terminé/);
    const premierDuMois = new Date(`${aujourdhui.slice(0, 7)}-01T12:00:00Z`);
    const moisDernier = new Date(premierDuMois.getTime() - 5 * 86_400_000).toISOString().slice(0, 10);
    await envoyer([{ ...frais('m5', '1.5'), contenu: { ...frais('m5', '1.5').contenu, date: moisDernier } }]);
    await p.reload();
    const depot = p.locator('[data-depot]').first();
    await depot.waitFor({ timeout: 15_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    expect(await depot.innerText()).toBe('Marquer déposée');
    // (1.80.0) Le client « à valider » est nommé sous la carte, avec le geste qui mène à sa saisie.
    expect(await p.locator('.ech-qui').first().innerText()).toMatch(/^Droguerie du Port\s*Valider ses écritures$/);
    await depot.click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').innerText()).toMatch(/n'est pas prête$/);
    expect(await fenetre.innerText()).toMatch(/Pas encore prête dans SkanFact\s*:\s*1 client à valider\./);
    await fenetre.getByRole('button', { name: 'Pas encore', exact: true }).click();
    await p.waitForTimeout(500);
    expect(await p.locator('[data-depot]').first().innerText()).toBe('Marquer déposée');
    await p.locator('[data-depot]').first().click();
    await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Marquer déposée quand même', exact: true }).click();
    await expect.poll(() => p.locator('[data-depot]').first().innerText()).toBe('Annuler « déposée »');
    await p.locator('[data-valider-dossier]').first().click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/dossier/${ent}/comptabilite/saisie/${moisDernier.slice(0, 4)}`);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
