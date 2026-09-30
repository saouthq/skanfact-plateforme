// La quarantaine, à la souris (brique 74 bis ; docs/hors-ligne.md, H10 ; 04 § 7). Nadia travaille sans
// réseau sur son portable (« mon ordinateur ») : un client créé, un autre renommé. Le portable se perd ;
// au bureau, le même client change, et le portable est retiré. Ce que le parcours vérifie, écran ET
// serveur :
//   - le portable rouvert (l'application s'ouvre sur l'entrée), le réseau revenu : ce qu'il avait fait
//     hors ligne est REMIS au serveur, puis tout ce qu'il gardait s'efface, et l'entrée le dit ; rien
//     n'est appliqué d'office ; une remise qui échoue n'efface rien, et l'écran le dit ;
//   - au bureau, le bandeau le dit, « Voir » mène au panneau : qui, depuis quel appareil, quoi ;
//     « Rejeter… » demande d'abord ; « Accepter » applique le client créé, et met de côté le renommage (le client a changé depuis au
//     bureau : sa version est gardée), et le dit ; rechargé, l'écran montre le client arrivé.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la quarantaine, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>> | null = null;
  let adresse = '';
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-quarantaine-'));
  const configuration = () => ({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), web: dossier, livreurMs: 60_000 });
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...configuration(), port: 0 });
    adresse = serveur.adresse;
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });
  // Le réseau se coupe pour de vrai : le serveur s'arrête, et revient au même port.
  const couper = async (c: BrowserContext) => { await c.setOffline(true); await serveur?.arreter(); serveur = null; };
  const retablir = async () => { if (!serveur) serveur = await demarrer({ ...configuration(), port: Number(new URL(adresse).port) }); };
  afterEach(async () => { await retablir(); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  type Objet = { collection: string; cle: string; revision: number; contenu: Record<string, unknown> & { name?: string } };
  const objets = async (jeton: string, ent: string) => (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
  const clients = async (jeton: string, ent: string) => (await objets(jeton, ent)).filter((o) => o.collection === 'clients').map((o) => o.contenu.name).sort();
  const enAttente = async (p: Page) => { const m = /(\d+) changements attendent|(Un) changement attend/.exec(await p.locator('#poste-bandeau').innerText()); return m ? (m[2] ? 1 : Number(m[1])) : 0; };
  const posteGarde = (p: Page) => p.evaluate(async () => (await indexedDB.databases()).some((b) => b.name === 'skanfact-poste'));
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const ouvrir = async (p: Page, url: string) => {
    await p.goto(url);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await p.waitForTimeout(600);
    await plusTard(p);
  };

  it('le portable retiré remet ce qu\'il avait fait hors ligne ; accepté, ce qui a changé depuis est mis de côté et dit', async () => {
    const email = `nadia-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const ent = String((await api('POST', '/entreprises', premier, { raisonSociale: 'Épicerie Nadia' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, premier);
    await api('POST', `/entreprises/${ent}/dossier-v10`, premier, { changements: [{ collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Boulangerie du Lac' } }] });
    const session = async (nom: string) => {
      const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom, type: 'navigateur' } });
      return String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    };
    const portableJeton = await session('Chrome sur Windows');
    const bureauJeton = await session('Chrome sur Linux');

    // Le portable, « mon ordinateur » : sans réseau, un client créé, et c1 renommé. (Sans service des
    // écrans : la page reste ouverte pendant la coupure, et le parcours doit pouvoir faire échouer une
    // remise, ce que le navigateur ne permet pas derrière lui.)
    const cp = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' });
    await cp.addInitScript((j) => { if (location.protocol.startsWith('http') && !localStorage.getItem('test.pose')) { localStorage.setItem('test.pose', '1'); localStorage.setItem('skanfact.jeton', j); } }, portableJeton);
    let p = await cp.newPage();
    await ouvrir(p, `${adresse}/v10/?e=${ent}#/clients`);
    await expect.poll(() => posteGarde(p), { timeout: 15_000 }).toBe(true);
    await p.waitForTimeout(500);
    await couper(cp);
    await p.locator('#new').click();
    const f = p.locator('#modal-root .modal').last();
    await f.locator('input[name=name]').fill('Café des Arts');
    await f.locator('#ok').click();
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 10_000 }).toContain('Café des Arts');
    await p.evaluate(() => { location.hash = '#/client/c1'; });
    await p.locator('[data-rowmenu="CL:c1"]').first().click();
    await p.getByRole('menuitem').filter({ hasText: 'Modifier la fiche' }).click();
    const g = p.locator('#modal-root .modal').last();
    await g.locator('input[name=name]').fill('Boulangerie du Lac (portable)');
    await g.locator('#ok').click();
    await expect.poll(() => enAttente(p), { timeout: 10_000 }).toBe(2);
    // Le portable se referme, sans réseau ; puis il se perd.
    await p.close();
    await retablir();

    // Au bureau : c1 change, et le portable est retiré.
    const c1 = (await objets(bureauJeton, ent)).find((o) => o.cle === 'c1');
    await api('POST', `/entreprises/${ent}/dossier-v10`, bureauJeton, { changements: [{ collection: 'clients', cle: 'c1', rang: 0, revision: c1?.revision ?? null, contenu: { ...c1?.contenu, name: 'Boulangerie du Lac (bureau)' } }] });
    const appareils = (await api('GET', '/moi/appareils', bureauJeton)).corps.appareils as { id: string; nom: string }[];
    expect((await api('DELETE', `/moi/appareils/${appareils.find((a) => a.nom === 'Chrome sur Windows')?.id}`, bureauJeton)).statut).toBe(200);

    // Le portable est rouvert, le réseau revenu : l'application s'ouvre sur l'entrée. Une première fois,
    // la remise échoue (le serveur trébuche) : rien ne s'efface, et l'écran le dit.
    await cp.setOffline(false);
    await cp.route('**/v1/quarantaine', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    p = await cp.newPage();
    await p.goto(`${adresse}/`);
    await expect.poll(() => p.locator('#poste-bandeau').innerText(), { timeout: 30_000 })
      .toMatch(/^Cet appareil a été retiré de ton compte\. Ce qu'il avait enregistré sans réseau n'a pas encore pu être remis au serveur\s: rien n'est effacé tant qu'il ne l'a pas reçu\.\s*Réessayer$/);
    await p.screenshot({ path: path.join(PHOTOS, 'quarantaine-0-remise-ratee.png') });
    expect(await posteGarde(p)).toBe(true);
    expect(await p.evaluate(() => !!localStorage.getItem('skanfact.jeton'))).toBe(true);
    // Le serveur revient d'aplomb : « Réessayer » remet, puis efface.
    await cp.unroute('**/v1/quarantaine');
    await p.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 30_000 })
      .toBe('Cet appareil a été retiré de ton compte : ce qu\'il gardait pour travailler sans réseau est effacé, et tes 2 changements faits hors ligne sont mis de côté au serveur, où le propriétaire de l\'entreprise les acceptera ou les rejettera ; reconnecte-toi pour continuer.');
    await p.screenshot({ path: path.join(PHOTOS, 'quarantaine-1-portable.png') });
    await expect.poll(() => posteGarde(p), { timeout: 10_000 }).toBe(false);
    expect(await p.evaluate(() => [localStorage.getItem('skanfact.jeton'), localStorage.getItem('skanfact.hors_ligne')])).toEqual([null, null]);
    // Rien n'est appliqué d'office.
    expect(await clients(bureauJeton, ent)).toEqual(['Boulangerie du Lac (bureau)']);

    // Au bureau : le bandeau le dit, « Voir » mène au panneau.
    const cb = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cb.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, bureauJeton);
    const b = await cb.newPage();
    const erreurs: string[] = [];
    b.on('pageerror', (e) => erreurs.push(e.message));
    await ouvrir(b, `${adresse}/v10/?e=${ent}#/clients`);
    await expect.poll(() => b.locator('#poste-bandeau').innerText(), { timeout: 15_000 })
      .toMatch(/^Un appareil retiré a remis 2 changements faits hors ligne : ils attendent ta décision\.\s*Voir$/);
    await b.screenshot({ path: path.join(PHOTOS, 'quarantaine-2-bandeau.png') });
    await b.getByRole('button', { name: 'Voir', exact: true }).click();
    await b.waitForTimeout(800);
    await plusTard(b);
    const panneau = b.locator('#p-quarantaine');
    await expect.poll(() => panneau.innerText(), { timeout: 15_000 })
      .toMatch(/Remis par Nadia, depuis «\s*Chrome sur Windows\s*», le \d\d\/\d\d\/\d{4} à \d+ h \d\d\.\s*Client «\s*Boulangerie du Lac \(portable\)\s*» modifié\s*Client «\s*Café des Arts\s*» ajouté\s*\d+ réglages? du dossier\s*Accepter\s*Rejeter…$/);
    await b.screenshot({ path: path.join(PHOTOS, 'quarantaine-3-panneau.png') });

    // « Rejeter… » demande d'abord : rien n'est décidé tant qu'on n'a pas dit oui.
    await panneau.getByRole('button', { name: 'Rejeter…', exact: true }).click();
    await expect.poll(() => panneau.getByRole('alert').innerText()).toBe('Rien de cette remise ne s\'appliquera. Elle reste gardée au serveur.');
    expect(((await api('GET', `/entreprises/${ent}/quarantaine`, bureauJeton)).corps.remises as unknown[]).length).toBe(1);
    // Accepter : le client créé arrive ; le renommage est mis de côté, la version du bureau gardée.
    await panneau.getByRole('button', { name: 'Accepter', exact: true }).click();
    await expect.poll(() => panneau.innerText(), { timeout: 15_000 })
      .toMatch(/Un changement appliqué\.\s*Mis de côté\s:\s*Client «\s*Boulangerie du Lac \(portable\)\s*» modifié — Elle a changé depuis sur le serveur\s: la version du serveur est gardée, celle de l'appareil reste avec la remise\.\s*Recharge pour voir ce qui a été appliqué\.\s*Recharger$/);
    await b.screenshot({ path: path.join(PHOTOS, 'quarantaine-4-accepte.png') });
    expect(await clients(bureauJeton, ent)).toEqual(['Boulangerie du Lac (bureau)', 'Café des Arts']);
    // Rechargé : l'écran montre le client arrivé, et plus rien n'attend.
    await panneau.getByRole('button', { name: 'Recharger', exact: true }).click();
    await b.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await b.evaluate(() => { location.hash = '#/clients'; });
    await expect.poll(() => b.locator('#view').innerText(), { timeout: 15_000 }).toContain('Café des Arts');
    expect(await b.locator('#p-quarantaine').count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 240_000);
});
