// Un membre retiré, à la souris (brique 76 ; docs/hors-ligne.md, H13 ; 03 D8). Karim est administrateur
// de l'épicerie de Nadia, et a sa propre entreprise ; son portable (« mon ordinateur ») garde une copie
// des deux. Il travaille sans réseau sur l'épicerie : un client créé. Pendant ce temps, Nadia le retire
// de l'équipe. Ce que le parcours vérifie, écran ET serveur :
//   - le portable rouvre l'épicerie, le réseau revenu : ce que Karim y avait fait hors ligne est REMIS
//     au serveur (en quarantaine : Nadia décidera), puis ce que le poste gardait de l'épicerie s'efface
//     — la copie de SA propre entreprise reste — et le bandeau le dit ; une remise qui échoue n'efface
//     rien ; « Continuer » mène à l'entrée, qui ouvre son entreprise ;
//   - rien n'est appliqué d'office : Nadia voit la remise (Karim, depuis son portable, le client).

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

describe('un membre retiré, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>> | null = null;
  let adresse = '';
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-membre-retire-'));
  const configuration = () => ({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), web: dossier, livreurMs: 60_000 });
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...configuration(), port: 0 });
    adresse = serveur.adresse;
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });
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
  // Une personne, le code du téléphone en place, et une session sur un appareil nommé.
  const personne = async (nom: string) => {
    const email = `${nom.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const session = async (appareil: string) => {
      const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: appareil, type: 'navigateur' } });
      return String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    };
    return { email, premier, session };
  };
  const entreprise = async (jeton: string, nom: string, client: string) => {
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: nom })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: client } }] });
    return ent;
  };
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
  // Ce que le poste garde de chaque entreprise : une copie ? quelque chose qui attend ?
  const garde = (p: Page, ent: string) => p.evaluate(async (id) => {
    const P = (window as unknown as { SkanPoste: { lireCopie: (x: string) => Promise<unknown>; lireAttente: (x: string) => Promise<unknown> } }).SkanPoste;
    return { copie: !!(await P.lireCopie(id).catch(() => null)), attente: !!(await P.lireAttente(id).catch(() => null)) };
  }, ent);

  it('le portable de Karim, retiré de l\'équipe : ce qu\'il avait fait est remis, la copie de l\'épicerie s\'efface, la sienne reste', async () => {
    const nadia = await personne('Nadia');
    const epicerie = await entreprise(nadia.premier, 'Épicerie Nadia', 'Boulangerie du Lac');
    const karim = await personne('Karim');
    const sienne = await entreprise(karim.premier, 'Karim SARL', 'Garage du Port');
    const invitation = String((await api('POST', `/entreprises/${epicerie}/invitations`, nadia.premier, { email: karim.email, roles: ['administrateur'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', karim.premier, { jeton: invitation })).statut).toBe(200);
    const portable = await karim.session('Chrome sur Windows');

    // Le portable de Karim, « mon ordinateur » (l'application installée) : une copie des deux entreprises.
    const c = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' });
    await c.addInitScript((j) => {
      if (navigator.storage) Object.assign(navigator.storage, { persist: async () => true, persisted: async () => true });
      if (location.protocol.startsWith('http') && !localStorage.getItem('test.pose')) { localStorage.setItem('test.pose', '1'); localStorage.setItem('skanfact.jeton', j); }
    }, portable);
    let p = await c.newPage();
    await ouvrir(p, `${adresse}/v10/?e=${sienne}#/clients`);
    await expect.poll(() => garde(p, sienne), { timeout: 15_000 }).toEqual({ copie: true, attente: false });
    await ouvrir(p, `${adresse}/v10/?e=${epicerie}#/clients`);
    await expect.poll(() => garde(p, epicerie), { timeout: 15_000 }).toEqual({ copie: true, attente: false });

    // Sans réseau, sur l'épicerie : un client créé, qui attend.
    await couper(c);
    await p.locator('#new').click();
    const f = p.locator('#modal-root .modal').last();
    await f.locator('input[name=name]').fill('Client de Karim');
    await f.locator('#ok').click();
    await expect.poll(() => garde(p, epicerie), { timeout: 10_000 }).toEqual({ copie: true, attente: true });
    await p.close();
    await retablir();

    // Nadia retire Karim de l'équipe.
    const equipe = (await api('GET', `/entreprises/${epicerie}/equipe`, nadia.premier)).corps.membres as { id: string; nom: string }[];
    expect((await api('DELETE', `/entreprises/${epicerie}/membres/${equipe.find((m) => m.nom === 'Karim')?.id}`, nadia.premier)).statut).toBe(200);

    // Le portable rouvre l'épicerie, le réseau revenu. Une première fois, la remise échoue (le serveur
    // trébuche) : rien ne s'efface, et l'écran le dit.
    await c.setOffline(false);
    await c.route('**/v1/quarantaine', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    p = await c.newPage();
    await p.goto(`${adresse}/v10/?e=${epicerie}#/clients`);
    await expect.poll(() => p.locator('#poste-bandeau').innerText(), { timeout: 20_000 })
      .toMatch(/^Cette entreprise ne t'est plus ouverte\. Ce que tu y avais enregistré sans réseau n'a pas encore pu être remis au serveur : rien n'est effacé tant qu'il ne l'a pas reçu\.\s*Réessayer$/);
    expect(await garde(p, epicerie)).toEqual({ copie: true, attente: true });
    // Le serveur revient d'aplomb : « Réessayer » remet, efface, et le dit.
    await c.unroute('**/v1/quarantaine');
    await p.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await expect.poll(() => p.locator('#poste-bandeau').innerText(), { timeout: 20_000 })
      .toMatch(/^Cette entreprise ne t'est plus ouverte \(tu as été retiré de son équipe, ou elle n'existe plus\) : ce que ce poste en gardait est effacé, et ton changement fait hors ligne est remis à son propriétaire, qui décidera\.\s*Continuer$/);
    await p.screenshot({ path: path.join(PHOTOS, 'membre-retire-1-efface.png') });
    expect(await garde(p, epicerie)).toEqual({ copie: false, attente: false });
    expect(await garde(p, sienne)).toEqual({ copie: true, attente: false });
    // L'entrée ne rouvrira plus l'épicerie sans réseau.
    expect(await p.evaluate(() => localStorage.getItem('skanfact.hors_ligne'))).toBe(null);
    // Rien n'est appliqué d'office ; Nadia voit la remise.
    const remises = (await api('GET', `/entreprises/${epicerie}/quarantaine`, nadia.premier)).corps.remises as { appareil: string; utilisateur: string; changements: { contenu: { name?: string } | null }[] }[];
    expect(remises.map((r) => [r.appareil, r.utilisateur, r.changements.map((x) => x.contenu?.name).filter(Boolean)])).toEqual([['Chrome sur Windows', 'Karim', ['Client de Karim']]]);
    // « Continuer » : l'entrée ouvre l'entreprise de Karim.
    await p.getByRole('button', { name: 'Continuer', exact: true }).click();
    await p.waitForURL(new RegExp(`/v10/\\?e=${sienne}`), { timeout: 20_000 });
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await p.screenshot({ path: path.join(PHOTOS, 'membre-retire-2-la-sienne.png') });
  }, 240_000);
});
