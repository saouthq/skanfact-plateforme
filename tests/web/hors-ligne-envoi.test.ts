// Enregistrer sans réseau (brique 73 ; docs/hors-ligne.md, H5 à H7). À la souris, sur « mon
// ordinateur » ; le réseau se coupe pour de vrai (le serveur s'arrête, le navigateur se dit hors ligne)
// et revient au même port. Ce que le parcours vérifie, écran ET serveur :
//   - un client créé sans réseau : aucune fenêtre « Rien n'a été enregistré » ; le bandeau compte ce qui
//     attend ; c'est gardé sur le poste, chiffré ; la page rechargée le montre encore ; au retour du
//     réseau, il part seul, et le bandeau le dit ;
//   - un client changé sans réseau ET ailleurs : la version du serveur est gardée, la mienne mise de
//     côté (dans le dossier, jamais perdue) et dite — la page ouverte (la v10 fusionne) comme rouverte
//     plus tard (le point de contact fusionne de même) ;
//   - se déconnecter avec des changements qui attendent : la question d'abord ; « Attendre le réseau »
//     ne perd rien ;
//   - la session finie pendant la coupure (12 heures sans rien faire) : se reconnecter, et ce qui
//     attendait part.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { rendre, t } from '../../textes/index.ts';
import '../../web/src/textes.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('enregistrer sans réseau, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>> | null = null;
  let adresse = '';
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-hors-ligne-envoi-'));
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
  // Un parcours qui s'arrête en route ne laisse pas le serveur arrêté aux suivants.
  afterEach(async () => { await retablir(); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  let email = '';
  let secret = '';
  const personne = async (nom: string) => {
    email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    return jeton;
  };
  type Objet = { collection: string; cle: string; revision: number; contenu: Record<string, unknown> & { name?: string } };
  const objets = async (jeton: string, ent: string) => (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
  const clients = async (jeton: string, ent: string) => (await objets(jeton, ent)).filter((o) => o.collection === 'clients').map((o) => o.contenu.name).sort();
  // Ce que la v10 a mis de côté (conflictArchive : une liste de pièces, gardée dans le dossier).
  const misDeCote = async (jeton: string, ent: string) => JSON.stringify((await objets(jeton, ent)).filter((o) => o.collection === 'conflictArchive' || o.cle === 'conflictArchive').map((o) => o.contenu));
  // Le nombre de changements que le bandeau dit en attente.
  const enAttente = async (p: Page) => { const m = /(\d+) changements attendent|(Un) changement attend/.exec(await p.locator('#poste-bandeau').innerText()); return m ? (m[2] ? 1 : Number(m[1])) : 0; };
  // Une entreprise, et un client dans son dossier.
  const entreprise = async (jeton: string) => {
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Épicerie Ennour' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Boulangerie du Lac' } }] });
    return ent;
  };
  // Changer le client c1 au serveur, comme un autre membre de l'équipe (par sa révision du moment).
  const changerAilleurs = async (jeton: string, ent: string, nom: string) => {
    const c1 = (await objets(jeton, ent)).find((o) => o.collection === 'clients' && o.cle === 'c1');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'clients', cle: 'c1', rang: 0, revision: c1?.revision ?? null, contenu: { ...c1?.contenu, name: nom } }] })).statut).toBe(200);
  };
  // Ce qui attend sur le poste : présent ? lisible en clair ?
  const attente = (p: Page, ent: string, nom: string) => p.evaluate(async ([id, cherche]) => {
    if (!(await indexedDB.databases()).some((b) => b.name === 'skanfact-poste')) return null;
    const db = await new Promise<IDBDatabase>((ok, ko) => { const r = indexedDB.open('skanfact-poste'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    const a = db.objectStoreNames.contains('attentes')
      ? await new Promise<{ chiffre: ArrayBuffer } | undefined>((ok, ko) => { const r = db.transaction('attentes').objectStore('attentes').get(id); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); })
      : undefined;
    db.close();
    return a ? { lisible: new TextDecoder('latin1').decode(new Uint8Array(a.chiffre)).includes(cherche) } : null;
  }, [ent, nom] as const);
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
  // « Mon ordinateur » : la session gardée dans le navigateur, posée une fois.
  // L'application installée : le navigateur promet de garder ce que le poste garde (04 § 4, brique 75).
  const installee = (c: BrowserContext) => c.addInitScript(() => {
    if (navigator.storage) Object.assign(navigator.storage, { persist: async () => true, persisted: async () => true });
  });
  const monOrdinateur = async (jeton: string) => {
    const c = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await installee(c);
    await c.addInitScript((j) => {
      if (!location.protocol.startsWith('http') || localStorage.getItem('test.pose')) return;
      localStorage.setItem('test.pose', '1');
      localStorage.setItem('skanfact.jeton', j);
    }, jeton);
    return c;
  };
  const pret = async (p: Page, ent: string) => {
    await ouvrir(p, `${adresse}/v10/?e=${ent}#/clients`);
    await expect.poll(() => p.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => p.evaluate(async () => (await indexedDB.databases()).some((b) => b.name === 'skanfact-poste')), { timeout: 15_000 }).toBe(true);
    await p.waitForTimeout(500);
  };
  const nouveauClient = async (p: Page, nom: string) => {
    await p.locator('#new').click();
    const f = p.locator('#modal-root .modal').last();
    await f.locator('input[name=name]').fill(nom);
    await f.locator('#ok').click();
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 10_000 }).toContain(nom);
  };
  const renommerC1 = async (p: Page, nom: string) => {
    await p.evaluate(() => { location.hash = '#/client/c1'; });
    await p.locator('[data-rowmenu="CL:c1"]').first().click();
    await p.getByRole('menuitem').filter({ hasText: 'Modifier la fiche' }).click();
    const f = p.locator('#modal-root .modal').last();
    await f.locator('input[name=name]').fill(nom);
    await f.locator('#ok').click();
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 10_000 }).toContain(nom);
  };
  const rienNaEteEnregistre = (p: Page) => p.locator('#modal-root').getByText('Rien n\'a été enregistré').count();

  it('un client créé sans réseau se garde sur le poste, se montre au rechargement, et part seul au retour du réseau', async () => {
    const jeton = await personne('patron');
    const ent = await entreprise(jeton);
    const c = await monOrdinateur(jeton);
    let p = await c.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await pret(p, ent);

    await couper(c);
    await nouveauClient(p, 'Épicerie Hors Réseau');
    await expect.poll(() => p.locator('#poste-bandeau').innerText(), { timeout: 10_000 })
      .toBe(`Hors ligne depuis ${await p.locator('#poste-bandeau strong').innerText().then((t) => t.replace(/^Hors ligne depuis /, '').replace(/\.$/, ''))}. Ce que tu vois reste à l'écran. Un changement attend le réseau : gardé sur ce poste, il partira seul à son retour.`);
    expect(await rienNaEteEnregistre(p)).toBe(0);
    expect(await attente(p, ent, 'Hors Réseau')).toEqual({ lisible: false });
    await p.screenshot({ path: path.join(PHOTOS, 'hors-ligne-envoi-1-attente.png') });

    // Rechargée sans réseau, la page le montre encore, et le bandeau le compte.
    await p.reload();
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 15_000 }).toContain('Épicerie Hors Réseau');
    await expect.poll(() => p.locator('#poste-bandeau').innerText()).toMatch(/Tu consultes la copie de ce poste, du .*\. Un changement attend le réseau/);

    // Le réseau revient : il part seul, et le bandeau le dit.
    await retablir();
    expect(await clients(jeton, ent)).toEqual(['Boulangerie du Lac']);
    await c.setOffline(false);
    await expect.poll(() => clients(jeton, ent), { timeout: 20_000 }).toEqual(['Boulangerie du Lac', 'Épicerie Hors Réseau']);
    await expect.poll(() => p.locator('#poste-bandeau').innerText(), { timeout: 15_000 }).toMatch(/^Le réseau est revenu : ton changement fait hors ligne est enregistré\./);
    await expect.poll(() => attente(p, ent, 'Hors Réseau')).toBe(null);
    await p.screenshot({ path: path.join(PHOTOS, 'hors-ligne-envoi-2-parti.png') });
    // Et rien ne se double : la page rouverte ne renvoie rien.
    await p.close();
    p = await c.newPage();
    await ouvrir(p, `${adresse}/v10/?e=${ent}#/clients`);
    await p.waitForTimeout(1_500);
    expect(await clients(jeton, ent)).toEqual(['Boulangerie du Lac', 'Épicerie Hors Réseau']);
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('un client changé sans réseau et ailleurs : la version du serveur gardée, la mienne mise de côté et dite (page ouverte)', async () => {
    const jeton = await personne('patronne');
    const ent = await entreprise(jeton);
    const c = await monOrdinateur(jeton);
    const p = await c.newPage();
    await pret(p, ent);
    await couper(c);
    await renommerC1(p, 'Boulangerie du Lac (poste)');
    expect(await rienNaEteEnregistre(p)).toBe(0);
    // Pendant ce temps, un autre membre change le même client.
    await retablir();
    await changerAilleurs(jeton, ent, 'Boulangerie du Lac (serveur)');
    await c.setOffline(false);
    await expect.poll(() => p.locator('#modal-root').innerText(), { timeout: 20_000 }).toMatch(/Modifications des deux côtés/);
    await p.screenshot({ path: path.join(PHOTOS, 'hors-ligne-envoi-3-conflit.png') });
    expect(await clients(jeton, ent)).toEqual(['Boulangerie du Lac (serveur)']);
    await expect.poll(() => misDeCote(jeton, ent), { timeout: 15_000 }).toContain('Boulangerie du Lac (poste)');
  }, 180_000);

  it('rouverte plus tard avec le réseau : ce qui attendait part d\'abord ; changé ailleurs, la version du serveur gardée et la mienne mise de côté', async () => {
    const jeton = await personne('gerant');
    const ent = await entreprise(jeton);
    const c = await monOrdinateur(jeton);
    let p = await c.newPage();
    await pret(p, ent);
    await couper(c);
    await nouveauClient(p, 'Librairie Amal');
    await expect.poll(() => enAttente(p), { timeout: 10_000 }).toBeGreaterThan(0);
    const apresAmal = await enAttente(p);
    await renommerC1(p, 'Boulangerie du Lac (poste)');
    // Gardé sur le poste avant de fermer : le bandeau compte le changement de plus.
    await expect.poll(() => enAttente(p), { timeout: 10_000 }).toBeGreaterThan(apresAmal);
    await p.close();
    await retablir();
    await changerAilleurs(jeton, ent, 'Boulangerie du Lac (serveur)');
    await c.setOffline(false);
    p = await c.newPage();
    await ouvrir(p, `${adresse}/v10/?e=${ent}#/clients`);
    await expect.poll(() => p.locator('#poste-bandeau').innerText(), { timeout: 20_000 })
      .toMatch(/^Le réseau est revenu : tes 2 changements faits hors ligne sont enregistrés\. Une pièce avait changé ailleurs : la version du serveur est gardée, la tienne est mise de côté, rien n'est perdu\.$/);
    expect(await clients(jeton, ent)).toEqual(['Boulangerie du Lac (serveur)', 'Librairie Amal']);
    expect(await misDeCote(jeton, ent)).toContain('Boulangerie du Lac (poste)');
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 15_000 }).toMatch(/Boulangerie du Lac \(serveur\)[\s\S]*Librairie Amal/);
    await p.screenshot({ path: path.join(PHOTOS, 'hors-ligne-envoi-4-rouverte.png') });
  }, 180_000);

  it('se déconnecter avec des changements qui attendent : la question d\'abord ; « Attendre le réseau » ne perd rien', async () => {
    const jeton = await personne('prudent');
    const ent = await entreprise(jeton);
    const c = await monOrdinateur(jeton);
    const p = await c.newPage();
    await pret(p, ent);
    await couper(c);
    await nouveauClient(p, 'Quincaillerie Nour');
    await p.locator('#brand-btn').click();
    await p.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect.poll(() => p.locator('#poste-bandeau').innerText(), { timeout: 10_000 })
      .toMatch(/^Des changements faits hors ligne ne sont pas encore partis : te déconnecter maintenant les efface de ce poste\./);
    await p.screenshot({ path: path.join(PHOTOS, 'hors-ligne-envoi-5-deconnexion.png') });
    await p.getByRole('button', { name: 'Attendre le réseau', exact: true }).click();
    expect(p.url()).toContain('/v10/');
    expect(await attente(p, ent, 'Nour')).toEqual({ lisible: false });
    // Le réseau revient : il part, et la déconnexion ne demande plus rien.
    await retablir();
    await c.setOffline(false);
    await expect.poll(() => clients(jeton, ent), { timeout: 20_000 }).toEqual(['Boulangerie du Lac', 'Quincaillerie Nour']);
  }, 180_000);

  it('la session finie pendant la coupure : se reconnecter, et ce qui attendait part', async () => {
    const jeton = await personne('patient');
    const moi = { email, secret };
    const ent = await entreprise(jeton);
    const c = await monOrdinateur(jeton);
    let p = await c.newPage();
    await pret(p, ent);
    await couper(c);
    await nouveauClient(p, 'Épicerie du Retour');
    await expect.poll(() => enAttente(p), { timeout: 10_000 }).toBe(1);
    await p.close();
    // Pendant la coupure, la session a pris fin au serveur (12 heures sans rien faire).
    await retablir();
    expect((await api('POST', '/deconnexion', jeton)).statut).toBe(200);
    await c.setOffline(false);
    // Rouverte : l'entrée demande de se reconnecter ; la même personne, et ce qui attendait part.
    p = await c.newPage();
    await p.goto(`${adresse}/`);
    const titre = (cle: string) => { const x = rendre(t(cle), 'fr'); return x.charAt(0).toUpperCase() + x.slice(1); };
    await p.locator('label.field').filter({ hasText: titre('ecran.connexion.email') }).locator('input').fill(moi.email);
    await p.locator('label.field').filter({ hasText: titre('ecran.connexion.mot_de_passe') }).locator('input').fill('Un-bon-mot-de-passe');
    await p.getByRole('button', { name: titre('ecran.connexion.bouton'), exact: true }).click();
    await p.locator('label.field').filter({ hasText: titre('ecran.code.champ') }).locator('input').fill(codeTotp(depuisBase32(moi.secret), Date.now()));
    await p.getByRole('button', { name: titre('ecran.code.bouton'), exact: true }).click();
    await p.waitForURL(/\/v10\/\?e=/, { timeout: 20_000 });
    const nouveau = String(await p.evaluate(() => localStorage.getItem('skanfact.jeton')));
    await expect.poll(() => clients(nouveau, ent), { timeout: 20_000 }).toEqual(['Boulangerie du Lac', 'Épicerie du Retour']);
    await expect.poll(() => p.locator('#poste-bandeau').innerText(), { timeout: 15_000 }).toMatch(/^Le réseau est revenu : ton changement fait hors ligne est enregistré\./);
  }, 180_000);
});
