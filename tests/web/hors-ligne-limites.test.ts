// Les limites du hors-ligne (brique 75 ; docs/hors-ligne.md, H11 et H12). À la souris, sur « mon
// ordinateur » ; le réseau se coupe pour de vrai (le serveur s'arrête) et revient au même port. Ce que
// le parcours vérifie, écran ET poste :
//   - un navigateur qui ne promet pas de garder (pas de stockage persistant, 04 § 4) : sans réseau, on
//     consulte la copie, mais rien ne s'enregistre ; le bandeau le dit, la fenêtre « Rien n'a été
//     enregistré » dit pourquoi et quoi faire, et rien n'attend sur le poste ;
//   - l'application qui DEMANDE à garder (un premier lancement) : c'est accordé, et elle enregistre ;
//   - plus de 72 heures sans le serveur (04 § 7, 03 D8) : ce qui attendait partira, mais rien de neuf
//     ne s'enregistre ; à 71 heures, si. Le serveur revenu, le compte repart.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const HEURE = 3600 * 1000;

describe('les limites du hors-ligne, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>> | null = null;
  let adresse = '';
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-hors-ligne-limites-'));
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
  // Une personne (le code du téléphone en place) et son entreprise, un client dans son dossier.
  const patron = async () => {
    const email = `limites-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Patron', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Épicerie Ennour' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Boulangerie du Lac' } }] });
    return { jeton, ent };
  };
  type Objet = { collection: string; contenu: { name?: string } };
  const clients = async (jeton: string, ent: string) => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[])
    .filter((o) => o.collection === 'clients').map((o) => o.contenu.name).sort();
  // « Mon ordinateur », et ce que le navigateur répond quand on lui demande de garder : `deja` (déjà
  // promis) et `accorde` (ce qu'il répond à la demande).
  const monOrdinateur = async (jeton: string, deja: boolean, accorde: boolean) => {
    const c = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await c.addInitScript(([j, d, a]) => {
      if (navigator.storage) Object.assign(navigator.storage, { persisted: async () => d, persist: async () => a });
      if (!location.protocol.startsWith('http') || localStorage.getItem('test.pose')) return;
      localStorage.setItem('test.pose', '1');
      localStorage.setItem('skanfact.jeton', j);
    }, [jeton, deja, accorde] as const);
    return c;
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const pret = async (p: Page, ent: string) => {
    await p.goto(`${adresse}/v10/?e=${ent}#/clients`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await p.waitForTimeout(600);
    await plusTard(p);
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
  // Ce qui attend sur le poste (présent, et ce qu'il contient, déchiffré par le poste lui-même).
  const attente = (p: Page, ent: string) => p.evaluate(async (id) => {
    const a = await (window as unknown as { SkanPoste: { lireAttente: (x: string) => Promise<{ contenu: { data: { clients?: { name: string }[] } } } | null> } }).SkanPoste.lireAttente(id).catch(() => null);
    return a ? (a.contenu.data.clients ?? []).map((c) => c.name).sort() : null;
  }, ent);
  const fenetre = (p: Page) => p.locator('#modal-root .modal').filter({ hasText: 'Rien n\'a été enregistré' });
  // Le texte d'une fenêtre, sans les espaces insécables que la v10 pose avant « : » et « ; ».
  const texteDe = async (p: Page) => (await fenetre(p).innerText()).replace(/[\u00a0\u202f]/g, ' ');
  const bandeau = (p: Page) => p.locator('#poste-bandeau').innerText();
  const contact = (p: Page) => p.evaluate(() => Number(localStorage.getItem('skanfact.dernier_contact')) || 0);
  const reculer = (p: Page, heures: number) => p.evaluate((ms) => localStorage.setItem('skanfact.dernier_contact', String(Date.now() - ms)), heures * HEURE);

  it('un navigateur qui ne promet pas de garder : sans réseau, on consulte, rien ne s\'enregistre, et l\'écran dit pourquoi', async () => {
    const { jeton, ent } = await patron();
    const c = await monOrdinateur(jeton, false, false);
    const p = await c.newPage();
    await pret(p, ent);
    await couper(c);
    const PHRASE = 'Ce navigateur peut vider ce que ce poste garde : sans réseau, tu consultes, mais rien ne s\'enregistre. Pour enregistrer sans réseau, installe l\'application (menu du navigateur, « Installer SkanFact »).';
    await expect.poll(() => bandeau(p), { timeout: 10_000 }).toMatch(/^Hors ligne depuis \d{1,2} h \d\d\. Ce que tu vois reste à l'écran\. /);
    expect((await bandeau(p)).endsWith(PHRASE)).toBe(true);
    // Créer un client : refusé, et la fenêtre dit pourquoi ; rien n'attend sur le poste.
    await nouveauClient(p, 'Épicerie Sans Promesse');
    await expect.poll(() => texteDe(p), { timeout: 10_000 }).toContain(PHRASE);
    await p.screenshot({ path: path.join(PHOTOS, 'hors-ligne-limites-1-persistant.png') });
    expect(await attente(p, ent)).toBe(null);
    await fenetre(p).getByRole('button', { name: 'Fermer', exact: true }).click();
    // On consulte toujours : rechargée sans réseau, la copie s'ouvre.
    await p.reload();
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 15_000 }).toContain('Boulangerie du Lac');
    expect((await bandeau(p)).endsWith(PHRASE)).toBe(true);
    await retablir();
    expect(await clients(jeton, ent)).toEqual(['Boulangerie du Lac']);
  }, 180_000);

  it('plus de 72 heures sans le serveur : ce qui attendait partira, mais rien de neuf ne s\'enregistre ; à 71 heures, si', async () => {
    const { jeton, ent } = await patron();
    // Un premier lancement de l'application installée : elle demande à garder, c'est accordé.
    const c = await monOrdinateur(jeton, false, true);
    const p = await c.newPage();
    const debut = Date.now();
    await pret(p, ent);
    // Le serveur a répondu : le compte des 72 heures part de maintenant.
    expect(await contact(p)).toBeGreaterThanOrEqual(debut);
    await couper(c);
    // 71 heures après le dernier contact : on enregistre encore, et ça attend le réseau.
    await reculer(p, 71);
    await nouveauClient(p, 'Client A');
    await expect.poll(() => bandeau(p), { timeout: 10_000 }).toMatch(/Un changement attend le réseau : gardé sur ce poste, il partira seul à son retour\.$/);
    expect(await fenetre(p).count()).toBe(0);
    // 72 heures et 5 minutes : rien de neuf ne s'enregistre ; ce qui attendait reste.
    await reculer(p, 72 + 5 / 60);
    await nouveauClient(p, 'Client B');
    const DROITS = 'Plus de 72 heures sans contact avec le serveur : rien de neuf ne s\'enregistre sur ce poste tant qu\'il n\'a pas revu tes droits ; tu consultes.';
    await expect.poll(() => texteDe(p), { timeout: 10_000 }).toContain(DROITS);
    await expect.poll(() => bandeau(p)).toMatch(/Un changement attend le réseau : gardé sur ce poste, il partira seul à son retour\. Plus de 72 heures sans contact avec le serveur : rien de neuf ne s'enregistre sur ce poste tant qu'il n'a pas revu tes droits ; tu consultes\.$/);
    await p.screenshot({ path: path.join(PHOTOS, 'hors-ligne-limites-2-72h.png') });
    expect(await attente(p, ent)).toEqual(['Boulangerie du Lac', 'Client A']);
    await fenetre(p).getByRole('button', { name: 'Fermer', exact: true }).click();
    // Le réseau revient sans le serveur (un portail d'hôtel, un serveur en panne) : ce n'est pas un
    // contact, le compte des 72 heures ne repart pas.
    await c.setOffline(false);
    await p.waitForTimeout(1_500);
    expect(await contact(p)).toBeLessThan(Date.now() - 72 * HEURE);
    // Le serveur revient : ce qui attendait part, et ce qui était resté à l'écran avec (en ligne, le
    // serveur revoit tout) ; le compte repart.
    await retablir();
    await c.setOffline(true);
    await c.setOffline(false);
    await expect.poll(() => clients(jeton, ent), { timeout: 30_000 }).toEqual(['Boulangerie du Lac', 'Client A', 'Client B']);
    await expect.poll(() => contact(p)).toBeGreaterThan(Date.now() - 60_000);
  }, 180_000);
});
