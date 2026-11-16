// Un cabinet tout neuf dont aucun client n'est sur SkanFact (revue du 16/11/2026, avant le premier alpha-test) : le
// cas de la plupart des cabinets. Ce que le parcours vérifie, à la souris :
//   - les Relances, les Pièces reçues et le portefeuille parlent d'un cabinet qui tient tout lui-même, et s'accordent ;
//   - sans livre encore, le titre et le fil de la comptabilité suivent l'écran ouvert ;
//   - la balance d'ouverture tapée en commençant le livre se retrouve dans la phrase de la balance (elle disait « ce
//     livre part de zéro ») ; l'invite de son libellé dit le nom du compte tapé.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('un cabinet dont aucun client n\'est sur SkanFact (1.368.1)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-seul-'));
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

  it('ses écrans parlent d\'un cabinet qui tient tout lui-même, le titre suit l\'écran sans livre, et la balance dit sa balance d\'ouverture', async () => {
    const associe = await personne('Sami');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Gharbi' })).corps.id);
    const ent = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Quincaillerie Ben Salah' })).corps.entreprise);
    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const net = (t: string) => t.replace(/\s+/g, ' ');
    const vue = async () => net(await p.locator('#view').innerText());
    const aller = async (h: string) => { await p.evaluate((x) => { location.hash = x; }, h); };
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/relances`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();

    // Un seul client, tenu : la phrase s'accorde (« aucun de tes 1 client »).
    await expect.poll(vue, { timeout: 15_000 }).toContain('Personne à relancer : ton client n\'est pas sur SkanFact. Tu tiens ses livres au cabinet, et rien ne lui est réclamé.');
    // Les pièces : rien n'arrive seul, elles se déposent (l'écran promettait ce que « tes clients envoient »).
    await aller('#/pieces');
    await expect.poll(vue, { timeout: 15_000 }).toContain('tes clients ne sont pas sur SkanFact, rien n\'arrive seul');
    expect(await vue()).not.toContain('ce que tes clients envoient dans leur conversation');
    await aller(`#/pieces/${ent}`);
    await expect.poll(vue, { timeout: 15_000 }).toContain('ce client n\'est pas sur SkanFact. Dépose ici les pièces qu\'il t\'apporte');
    await aller('#/dossiers');
    await expect.poll(vue, { timeout: 15_000 }).toContain('1 tenu au cabinet · 0 relié');

    // Sans livre encore, le titre et le fil suivent l'écran (« Saisie » restait sous le titre de l'écran d'avant).
    await aller(`#/dossier/${ent}/comptabilite/saisie`);
    await p.locator('#lv-reprendre').waitFor({ timeout: 20_000 });
    await aller(`#/dossier/${ent}/comptabilite/liasse`);
    await expect.poll(async () => net(await p.locator('#cp-titre').innerText()), { timeout: 10_000 }).toBe('Liasse');
    expect(net(await p.locator('#cp-fil').innerText())).toBe('Comptabilité › Déclarer et clôturer');
    await aller(`#/dossier/${ent}/comptabilite/banque`);
    await expect.poll(async () => net(await p.locator('#cp-titre').innerText()), { timeout: 10_000 }).toBe('Banque');
    expect(net(await p.locator('#cp-fil').innerText())).toBe('Comptabilité › Saisir');

    // Le livre commence avec sa balance d'ouverture, tapée : l'invite du libellé dit le compte, et la balance la nomme.
    await p.locator('#lv-reprendre').click();
    const f = p.locator('#modal-root .modal').last();
    await f.locator('[name=c0]').fill('532');
    await f.locator('[name=d0]').fill('1000');
    await f.getByRole('button', { name: 'Ajouter une ligne', exact: true }).click();
    expect(await f.locator('[name=l0]').getAttribute('placeholder')).toBe('Banques');
    await f.locator('[name=c1]').fill('101');
    await f.locator('[name=k1]').fill('1000');
    await f.getByRole('button', { name: 'Créer le livre', exact: true }).click();
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 20_000 }).toMatch(/Livre de \d{4} créé/);
    await aller(`#/dossier/${ent}/comptabilite/balance`);
    await expect.poll(vue, { timeout: 20_000 }).toContain('la balance d\'ouverture reprise (2 comptes) est une pièce du journal AN');
    expect(await vue()).not.toContain('ce livre part de zéro');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-sans-client-balance.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
