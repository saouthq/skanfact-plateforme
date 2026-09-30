// L'application installable, qui s'ouvre et se consulte sans réseau (brique 72 ; docs/hors-ligne.md).
// À la souris, dans un vrai navigateur. Le réseau se coupe pour de vrai : le serveur s'arrête (le
// service des écrans passe à côté de la coupure que le navigateur simule), et le navigateur se dit hors
// ligne ; il revient au même port. Ce que le parcours vérifie :
//   - sur « mon ordinateur » (la session gardée sur l'appareil), la copie de l'entreprise est sur le
//     poste, CHIFFRÉE (le nom d'un client ne s'y lit pas) par une clé que le navigateur ne laisse pas
//     sortir ;
//   - le réseau coupé : la page se recharge (le service des écrans), l'entreprise se consulte, et le
//     bandeau dit « Hors ligne », depuis quand, et de quand date la copie ; l'application refermée se
//     rouvre depuis l'entrée, toujours sans réseau ;
//   - le réseau revenu : le bandeau le dit, et « Recharger » relit le serveur ;
//   - une page mise à jour, vue en ligne, est celle qui s'ouvre sans réseau (jamais un écran périmé) ;
//   - se déconnecter efface la copie et sa clé ; sur l'ordinateur d'un autre, rien n'est gardé ;
//   - par l'entrée : « mon ordinateur » garde la session dans le navigateur, « le poste de quelqu'un
//     d'autre » ne la garde que dans l'onglet ; une nouvelle connexion efface les copies de la précédente.

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

describe('l\'application sans réseau, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>> | null = null;
  let adresse = '';
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-hors-ligne-'));
  const configuration = () => ({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), web: dossier, livreurMs: 60_000 });
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...configuration(), port: 0 });
    adresse = serveur.adresse;
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });
  // Couper le réseau : le navigateur se dit hors ligne, et le serveur s'arrête ; le rétablir, au même port.
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
  // Une personne inscrite, le code du téléphone en place (le secret de son application, pour l'entrée).
  let email = '';
  let secret = '';
  const personne = async (nom: string) => {
    email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    return jeton;
  };
  // Une entreprise, et un client dans son dossier.
  const entreprise = async (jeton: string) => {
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Épicerie Ennour' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Boulangerie du Lac' } }] });
    return ent;
  };
  // Ce que le poste garde, lu dans le navigateur : la copie de l'entreprise (en clair ? quelle taille ?) et sa clé.
  const lePoste = (p: Page, ent: string) => p.evaluate(async (id) => {
    const bases = await indexedDB.databases();
    if (!bases.some((b) => b.name === 'skanfact-poste')) return null;
    const db = await new Promise<IDBDatabase>((ok, ko) => { const r = indexedDB.open('skanfact-poste'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    const lire = (magasin: string, cle: string) => new Promise<{ chiffre: ArrayBuffer; extractable: boolean } | undefined>((ok, ko) => {
      if (!db.objectStoreNames.contains(magasin)) { ok(undefined); return; }
      const r = db.transaction(magasin).objectStore(magasin).get(cle); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
    });
    const copie = await lire('copies', id) as { chiffre: ArrayBuffer; le: number } | undefined;
    const cle = await lire('cles', 'appareil');
    db.close();
    const octets = copie ? new Uint8Array(copie.chiffre) : null;
    return {
      copie: !!copie, le: copie ? copie.le : 0, taille: octets ? octets.length : 0,
      lisible: octets ? new TextDecoder('latin1').decode(octets).includes('Boulangerie') : false,
      cleExportable: cle ? cle.extractable : null,
    };
  }, ent);
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
  const contexte = async (jeton: string, ouGarder: 'localStorage' | 'sessionStorage'): Promise<BrowserContext> => {
    const c = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    // Comme l'entrée après la connexion : sur « mon ordinateur », la session gardée dans le navigateur ;
    // posée une fois (se déconnecter la retire, et elle ne doit pas revenir).
    await c.addInitScript(([j, ou]) => {
      if (!location.protocol.startsWith('http') || localStorage.getItem('test.pose')) return;
      localStorage.setItem('test.pose', '1');
      (ou === 'localStorage' ? localStorage : sessionStorage).setItem('skanfact.jeton', j);
    }, [jeton, ouGarder] as const);
    return c;
  };

  it('sur mon ordinateur : la copie chiffrée ; sans réseau, l\'entreprise se rouvre et se consulte ; le réseau revenu, on recharge ; déconnecté, le poste oublie', async () => {
    const jeton = await personne('patron');
    const ent = await entreprise(jeton);
    const c = await contexte(jeton, 'localStorage');
    const erreurs: string[] = [];
    let p = await c.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await ouvrir(p, `${adresse}/v10/?e=${ent}#/clients`);
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 15_000 }).toMatch(/Boulangerie du Lac/);
    // Le service des écrans a pris la main, et la copie est sur le poste, chiffrée, sa clé non exportable.
    await expect.poll(() => p.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => (await lePoste(p, ent))?.copie, { timeout: 15_000 }).toBe(true);
    const poste = await lePoste(p, ent);
    expect(poste).toMatchObject({ copie: true, lisible: false, cleExportable: false });
    expect(poste?.taille).toBeGreaterThan(100);
    expect(await p.locator('#poste-bandeau:visible').count()).toBe(0);
    // Relue du serveur, sans rien enregistrer : la copie se refait.
    const avant = poste?.le ?? 0;
    await p.waitForTimeout(50);
    await ouvrir(p, `${adresse}/v10/?e=${ent}&relu=1#/clients`);
    await expect.poll(async () => (await lePoste(p, ent))?.le ?? 0, { timeout: 15_000 }).toBeGreaterThan(avant);

    // ── Le réseau coupé : la page se recharge, l'entreprise se consulte, le bandeau le dit ─────────
    await couper(c);
    // Le réseau vient de tomber, l'écran est déjà ouvert : ce qu'on voit reste, et le bandeau le dit.
    await expect.poll(() => p.locator('#poste-bandeau').innerText(), { timeout: 15_000 })
      .toMatch(/^Hors ligne depuis \d{1,2} h \d\d\. Ce que tu vois reste à l'écran\. Ce que tu enregistres se garde sur ce poste, et partira seul au retour du réseau\.$/);
    await p.reload();
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 15_000 }).toMatch(/Boulangerie du Lac/);
    await expect.poll(() => p.locator('#poste-bandeau').innerText())
      .toMatch(/^Hors ligne depuis \d{1,2} h \d\d\. Tu consultes la copie de ce poste, du \d\d\/\d\d\/\d{4} à \d{1,2} h \d\d\. Ce que tu enregistres se garde sur ce poste, et partira seul au retour du réseau\.$/);
    await p.screenshot({ path: path.join(PHOTOS, 'hors-ligne-1-copie.png') });

    // L'application refermée se rouvre depuis l'entrée, toujours sans réseau.
    await p.close();
    p = await c.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${adresse}/`);
    await p.waitForURL(/\/v10\/\?e=/, { timeout: 20_000 });
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.evaluate(() => { location.hash = '#/clients'; });
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 15_000 }).toMatch(/Boulangerie du Lac/);
    await expect.poll(() => p.locator('#poste-bandeau').innerText()).toMatch(/^Hors ligne depuis/);

    // ── Le réseau revenu : le bandeau le dit, « Recharger » relit le serveur ─────────────────────
    await retablir();
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'clients', cle: 'c2', rang: 1, revision: null, contenu: { id: 'c2', name: 'Pâtisserie Nour' } }] });
    await c.setOffline(false);
    await expect.poll(() => p.locator('#poste-bandeau').innerText(), { timeout: 15_000 }).toMatch(/^Le réseau est revenu\. Recharge pour voir ce que les autres ont fait depuis ta copie\./);
    await p.screenshot({ path: path.join(PHOTOS, 'hors-ligne-2-revenu.png') });
    await p.getByRole('button', { name: 'Recharger', exact: true }).click();
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.evaluate(() => { location.hash = '#/clients'; });
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 15_000 }).toMatch(/Pâtisserie Nour/);
    expect(await p.locator('#poste-bandeau:visible').count()).toBe(0);

    // ── Se déconnecter, même sans réseau : la copie et sa clé s'effacent, la session aussi ────────
    await expect.poll(async () => (await lePoste(p, ent))?.copie, { timeout: 15_000 }).toBe(true);
    await couper(c);
    await p.locator('#brand-btn').click();
    await p.getByRole('button', { name: 'Se déconnecter' }).click();
    await p.waitForURL((u) => !u.pathname.startsWith('/v10'), { timeout: 20_000 });
    await expect.poll(() => lePoste(p, ent), { timeout: 15_000 }).toBe(null);
    expect(await p.evaluate(() => [localStorage.getItem('skanfact.jeton'), sessionStorage.getItem('skanfact.jeton'), localStorage.getItem('skanfact.hors_ligne')])).toEqual([null, null, null]);
    await retablir();
    await c.setOffline(false);
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('une page mise à jour, vue en ligne, est celle qui s\'ouvre sans réseau', async () => {
    const jeton = await personne('maj');
    const ent = await entreprise(jeton);
    const c = await contexte(jeton, 'localStorage');
    const p = await c.newPage();
    await ouvrir(p, `${adresse}/v10/?e=${ent}#/clients`);
    await expect.poll(() => p.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => (await lePoste(p, ent))?.copie, { timeout: 15_000 }).toBe(true);
    // Une nouvelle version de la page arrive sur le serveur, et se voit en ligne.
    const page = path.join(dossier, 'v10/index.html');
    const avant = fs.readFileSync(page, 'utf8');
    fs.writeFileSync(page, avant.replace('<title>', '<meta name="skanfact-version" content="neuve">\n  <title>'));
    try {
      await p.reload();
      await expect.poll(() => p.locator('meta[name="skanfact-version"]').getAttribute('content'), { timeout: 15_000 }).toBe('neuve');
      // Sans réseau, c'est elle qui s'ouvre.
      await couper(c);
      await p.reload();
      await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
      expect(await p.locator('meta[name="skanfact-version"]').getAttribute('content')).toBe('neuve');
    } finally {
      fs.writeFileSync(page, avant);
      if (!serveur) await retablir();
    }
  }, 120_000);

  it('sur l\'ordinateur d\'un autre : rien n\'est gardé, et sans réseau l\'écran le dit', async () => {
    const jeton = await personne('invite');
    const ent = await entreprise(jeton);
    const c = await contexte(jeton, 'sessionStorage');
    const p = await c.newPage();
    await ouvrir(p, `${adresse}/v10/?e=${ent}#/clients`);
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 15_000 }).toMatch(/Boulangerie du Lac/);
    await expect.poll(() => p.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
    await p.waitForTimeout(1_000);
    expect((await lePoste(p, ent))?.copie ?? false).toBe(false);
    await couper(c);
    await p.reload();
    await expect.poll(() => p.locator('#poste-bandeau').innerText(), { timeout: 20_000 })
      .toMatch(/^Hors ligne : sur l'ordinateur d'un autre, rien n'est gardé sur le poste\. Reviens quand le réseau sera là\.\s*Réessayer$/);
    await p.screenshot({ path: path.join(PHOTOS, 'hors-ligne-3-autre.png') });
    expect(await p.locator('#view').innerText()).not.toMatch(/Boulangerie du Lac/);
    await retablir();
  }, 120_000);

  // L'entrée, à la souris : l'adresse, le mot de passe, la case « poste de quelqu'un d'autre », le code.
  const titre = (cle: string) => { const x = rendre(t(cle), 'fr'); return x.charAt(0).toUpperCase() + x.slice(1); };
  const seConnecter = async (p: Page, qui: { email: string; secret: string }, posteDUnAutre: boolean) => {
    await p.goto(`${adresse}/`);
    await p.locator('label.field').filter({ hasText: titre('ecran.connexion.email') }).locator('input').fill(qui.email);
    await p.locator('label.field').filter({ hasText: titre('ecran.connexion.mot_de_passe') }).locator('input').fill('Un-bon-mot-de-passe');
    if (posteDUnAutre) await p.getByText(titre('ecran.connexion.poste_autre')).click();
    await p.getByRole('button', { name: titre('ecran.connexion.bouton'), exact: true }).click();
    await p.locator('label.field').filter({ hasText: titre('ecran.code.champ') }).locator('input').fill(codeTotp(depuisBase32(qui.secret), Date.now()));
    await p.getByRole('button', { name: titre('ecran.code.bouton'), exact: true }).click();
    await p.waitForURL(/\/v10\/\?e=/, { timeout: 20_000 });
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
  };
  const jetons = (p: Page) => p.evaluate(() => [!!sessionStorage.getItem('skanfact.jeton'), !!localStorage.getItem('skanfact.jeton')]);

  it('par l\'entrée : mon ordinateur garde la session, le poste d\'un autre non ; une nouvelle connexion efface les copies de la précédente', async () => {
    const jetonA = await personne('amel');
    const amel = { email, secret };
    const entA = await entreprise(jetonA);
    const jetonB = await personne('bechir');
    const bechir = { email, secret };
    await entreprise(jetonB);

    // Mon ordinateur : la session dans le navigateur, et la copie de l'entreprise ouverte.
    const c = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    const p = await c.newPage();
    await seConnecter(p, amel, false);
    expect(await jetons(p)).toEqual([true, true]);
    await expect.poll(async () => (await lePoste(p, entA))?.copie, { timeout: 15_000 }).toBe(true);

    // Une autre personne se connecte sur ce navigateur (la session d'Amel a pris fin) : la copie d'Amel s'efface.
    await p.evaluate(() => { sessionStorage.removeItem('skanfact.jeton'); localStorage.removeItem('skanfact.jeton'); });
    await seConnecter(p, bechir, false);
    expect((await lePoste(p, entA))?.copie ?? false).toBe(false);

    // Le poste de quelqu'un d'autre : la session dans l'onglet seulement, et rien de gardé.
    const q = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    await seConnecter(q, amel, true);
    expect(await jetons(q)).toEqual([true, false]);
    await q.waitForTimeout(1_000);
    expect((await lePoste(q, entA))?.copie ?? false).toBe(false);

    // Sans code encore (la connexion aboutit sans lui) : la case compte de même.
    const chedly = `chedly-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: chedly, nom: 'Chedly', motDePasse: 'Un-bon-mot-de-passe' });
    const r = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    await r.goto(`${adresse}/`);
    await r.locator('label.field').filter({ hasText: titre('ecran.connexion.email') }).locator('input').fill(chedly);
    await r.locator('label.field').filter({ hasText: titre('ecran.connexion.mot_de_passe') }).locator('input').fill('Un-bon-mot-de-passe');
    await r.getByText(titre('ecran.connexion.poste_autre')).click();
    await r.getByRole('button', { name: titre('ecran.connexion.bouton'), exact: true }).click();
    await expect.poll(() => jetons(r), { timeout: 15_000 }).toEqual([true, false]);
  }, 180_000);
});
