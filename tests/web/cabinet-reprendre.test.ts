// Une écriture commencée au Cabinet, pas encore enregistrée (1.164.0, décision du 27/10/2026, demande de Skander « fait
// aussi pour cabinet ») : la même règle que les pièces neuves de l'entreprise (tests/web/reprendre.test.ts). À la souris :
//   - sur « mon ordinateur », elle se garde sur le poste, CHIFFRÉE ; fermer l'onglet ne demande rien ; rouverte, la saisie
//     du dossier propose « Reprendre » (elle revient telle quelle) ou « Le jeter » ; enregistrée, elle ne se propose plus ;
//   - sur l'ordinateur d'un autre, rien ne se garde, et fermer l'onglet demande (il fermait sans un mot).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('une écriture commencée au Cabinet se garde et se reprend, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-reprendre-'));
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
  const personne = async (qui: string) => {
    const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  // Ce que le poste garde en brouillon d'écriture pour ce cabinet : les clés, et si le libellé s'y lit en clair.
  const brouillons = (p: Page, cab: string) => p.evaluate(async (c) => {
    if (!(await indexedDB.databases()).some((b) => b.name === 'skanfact-poste')) return { cles: [] as string[], lisible: false };
    const db = await new Promise<IDBDatabase>((ok, ko) => { const r = indexedDB.open('skanfact-poste'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    const tout = await new Promise<{ cles: IDBValidKey[]; valeurs: { chiffre: ArrayBuffer }[] }>((ok, ko) => {
      const s = db.transaction('copies').objectStore('copies');
      const k = s.getAllKeys(); const v = s.getAll();
      v.onsuccess = () => ok({ cles: k.result, valeurs: v.result }); v.onerror = () => ko(v.error);
    });
    db.close();
    const i = tout.cles.map(String).map((x, n) => [x, n] as const).filter(([x]) => x.startsWith(`b:ecriture:${c}.`));
    return { cles: i.map(([x]) => x), lisible: i.some(([, n]) => new TextDecoder('latin1').decode(new Uint8Array(tout.valeurs[n]?.chiffre ?? new ArrayBuffer(0))).includes('Caisse du marché')) };
  }, cab);

  it("gardée sur « mon ordinateur », elle se reprend après l'onglet fermé ; ailleurs, fermer l'onglet demande", async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const client = await personne('client');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Droguerie du Port' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, client);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila);
    const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
    const annee = aujourdhui.slice(0, 4);
    // Un mouvement de banque du client : son livre de l'année a une écriture, la saisie s'y ouvre.
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, client, { changements: [
      { collection: 'accounts', cle: 'k-banque', rang: 0, revision: null,
        contenu: { id: 'k-banque', name: 'BIAT', kind: 'banque', bank: '', rib: '', opening: 0, openingDate: aujourdhui, isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'movements', cle: 'm1', rang: 0, revision: null,
        contenu: { id: 'm1', date: aujourdhui, kind: 'banque', amount: { '~n': '7.125' }, accountId: 'k-banque', method: 'virement', label: 'Frais de tenue de compte' } },
    ] })).statut).toBe(200);
    const lien = `${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/saisie/${annee}`;

    // « Mon ordinateur », l'application installée (le navigateur promet de garder : 04 § 4).
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript(() => { if (navigator.storage) Object.assign(navigator.storage, { persist: async () => true, persisted: async () => true }); });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http') || localStorage.getItem('test.pose')) return;
      localStorage.setItem('test.pose', '1');
      localStorage.setItem('skanfact.jeton', j);
    }, leila);
    const erreurs: string[] = [];
    let p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    const ouvrir = async () => {
      await p.goto(lien);
      await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
      await plusTard(p);
      await p.locator('#sa-ok').waitFor({ timeout: 15_000 });
    };
    await ouvrir();
    await p.locator('#sa-journal').selectOption('OD');
    await p.locator('#sa-libelle').fill('Caisse du marché');
    const tr = p.locator('#sa-lignes tr[data-i="0"]');
    await tr.locator('input[data-k="compte"]').fill('6132');
    await tr.locator('input[data-k="debit"]').fill('84,375');
    // Gardée, chiffrée, une seconde après la dernière frappe ; fermer l'onglet ne demande plus rien.
    await expect.poll(() => brouillons(p, cabinet).then((b) => b.cles.length), { timeout: 10_000 }).toBe(1);
    expect((await brouillons(p, cabinet)).lisible).toBe(false);
    await expect.poll(() => p.evaluate(() => window.onbeforeunload === null), { timeout: 10_000 }).toBe(true);

    // L'onglet fermé, la saisie rouverte : le bandeau la propose, la grille est neuve.
    await p.close({ runBeforeUnload: false });
    p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await ouvrir();
    const bandeau = p.locator('#sa-reprendre');
    await bandeau.waitFor({ timeout: 20_000 });
    expect(net(await bandeau.innerText())).toMatch(/^Écriture commencée le \d\d\/\d\d à \d\d h \d\d, pas encore enregistrée OD · « Caisse du marché » · 1 ligne\. Gardée sur cet ordinateur seulement : elle n'est au brouillard qu'une fois enregistrée\. Reprendre Le jeter$/);
    expect(await p.locator('#sa-libelle').inputValue()).toBe('');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-reprendre-1-bandeau.png') });
    await p.locator('#sa-reprendre-ok').click();
    await expect.poll(() => p.locator('#sa-libelle').inputValue()).toBe('Caisse du marché');
    expect(await p.locator('#sa-lignes tr[data-i="0"] input[data-k="debit"]').inputValue()).toBe('84,375');
    expect(await p.locator('#sa-reprendre').count()).toBe(0);

    // Enregistrée au brouillard : le poste l'oublie, la saisie rouverte n'a plus rien à proposer.
    const tr1 = p.locator('#sa-lignes tr[data-i="1"]');
    await tr1.locator('input[data-k="compte"]').fill('531');
    await tr1.locator('input[data-k="credit"]').fill('84,375');
    await p.locator('#sa-ok').click();
    await expect.poll(() => p.locator('tr.br-ligne', { hasText: 'Caisse du marché' }).count(), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => brouillons(p, cabinet).then((b) => b.cles.length), { timeout: 10_000 }).toBe(0);
    await ouvrir();
    await p.waitForTimeout(1500);
    expect(await p.locator('#sa-reprendre').count()).toBe(0);

    // « Le jeter » : une autre pièce commencée, l'onglet fermé ; jetée, elle ne revient plus.
    await p.locator('#sa-libelle').fill('Caisse du marché, suite');
    await expect.poll(() => brouillons(p, cabinet).then((b) => b.cles.length), { timeout: 10_000 }).toBe(1);
    await p.close({ runBeforeUnload: false });
    p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await ouvrir();
    await p.locator('#sa-reprendre-non').click({ timeout: 20_000 });
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => ''))).toContain('Brouillon jeté : rien n\'avait été enregistré.');
    await expect.poll(() => brouillons(p, cabinet).then((b) => b.cles.length), { timeout: 10_000 }).toBe(0);
    expect(erreurs).toEqual([]);
    await cx.close();

    // L'ordinateur d'un autre (la session le temps de l'onglet) : rien ne se garde, et fermer l'onglet demande.
    const autre = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await autre.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, leila);
    p = await autre.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await ouvrir();
    await p.locator('#sa-libelle').fill('Caisse du marché');
    await expect.poll(() => p.evaluate(() => typeof window.onbeforeunload), { timeout: 10_000 }).toBe('function');
    await p.waitForTimeout(1500);
    expect((await brouillons(p, cabinet)).cles).toEqual([]);
    expect(erreurs).toEqual([]);
    await autre.close();
  }, 240_000);
});
