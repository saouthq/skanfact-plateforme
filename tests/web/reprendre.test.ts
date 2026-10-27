// Quitter une pièce neuve (1.164.0, décision du 27/10/2026, maquettes facture, devis et achat, états « sortir »,
// « sortir-perdu », « reprendre » et « reprendre-b »), à la souris, sur l'entreprise d'essai :
//   - sur « mon ordinateur », la pièce commencée se garde à chaque frappe : la quitter ne demande rien, un toast dit
//     qu'elle est gardée et offre « Rouvrir » ; la page neuve suivante propose « Reprendre » ou « Le jeter » ;
//   - une facture qui a déjà un client et une ligne s'enregistre seule en brouillon : la page neuve propose « La reprendre » ;
//   - la commande fournisseur suit la même règle ;
//   - sur un poste partagé (sans « mon ordinateur »), rien ne se garde : la question reste, et dit pourquoi.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('quitter une pièce neuve, la reprendre, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-reprendre-'));
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
  const net = (s: string) => s.replace(/\s+/g, ' ').trim();
  const essai = async (nom: string) => {
    const email = `${nom}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra Mansour', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).corps.id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    expect((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).statut).toBe(200);
    // Un client et un fournisseur à elle (pas l'exemple de cinq ans).
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c-jas', rang: 20, revision: null, contenu: { id: 'c-jas', name: 'Clinique Les Jasmins' } },
      { collection: 'suppliers', cle: 's-sfax', rang: 20, revision: null, contenu: { id: 's-sfax', name: 'Sfax Informatique', paymentTermsDays: 30 } },
    ] });
    return { jeton, ent };
  };
  // `garde` : la session gardée sur l'appareil (« mon ordinateur », le jeton dans localStorage) ; sinon, le temps de l'onglet.
  const ouvrir = async (jeton: string, garde: boolean) => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript(([j, g]) => { if (location.protocol.startsWith('http')) (g ? localStorage : sessionStorage).setItem('skanfact.jeton', j as string); }, [jeton, garde] as const);
    // L'entreprise d'essai s'ouvre telle quelle, comme après « Ouvrir telle quelle » (sans préparer l'exemple).
    await cx.addInitScript(() => { const e = new URLSearchParams(location.search).get('e'); if (e) sessionStorage.setItem('skanfact.essai_tel_quel', e); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    return { cx, p, erreurs };
  };
  // Les bandeaux d'accueil (« Plus tard ») se ferment ; jamais le « Plus tard » du bandeau « La reprendre ».
  const aller = async (p: Page, ent: string, hash: string) => {
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#${hash}`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    const plusTard = p.locator('button:not(#ed-reprendre-non)', { hasText: /^Plus tard$/ });
    for (let i = 0; i < 3 && await plusTard.count(); i++) await plusTard.first().click({ timeout: 3_000 }).catch(() => undefined);
  };
  const ligne = async (p: Page, texte: string) => {
    const a = p.locator('#ed-ajout');
    await a.click(); await a.fill(texte); await a.press('Enter');
    await expect.poll(() => p.locator('#lines [data-k=label]').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value))).toContain(texte);
    await p.keyboard.press('Escape');
  };
  const lignes = (p: Page) => p.locator('#lines [data-k=label]').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value));

  it('sur « mon ordinateur » : quitter ne demande rien, « Rouvrir », puis « Reprendre » ou « Le jeter » ; une facture avec client se reprend du serveur', async () => {
    const { jeton, ent } = await essai('sarra-reprendre');
    const { cx, p, erreurs } = await ouvrir(jeton, true);
    await aller(p, ent, '/doc/new/facture');
    await ligne(p, 'Audit du réseau, 3 sites');
    await expect.poll(() => p.locator('#ed-garde').isVisible(), { timeout: 10_000 }).toBe(true);
    expect(net(await p.locator('#ed-garde').innerText())).toBe('brouillon gardé à chaque frappe');
    // Gardée, elle n'annonce pas « Modifications non enregistrées », et fermer l'onglet ne demande rien : rien ne se perd.
    expect(await p.locator('#dirty-dot').isVisible()).toBe(false);
    await expect.poll(() => p.evaluate(() => window.onbeforeunload === null)).toBe(true);

    // 1. On la quitte par le chemin : aucune question, un toast qui le dit et offre « Rouvrir ».
    await p.locator('.ed-chemin a.ed-retour').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/factures');
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    await expect.poll(async () => net(await p.locator('#toast').innerText())).toBe('Facture gardée sur cet ordinateur : « Nouvelle facture » te proposera de la reprendre Rouvrir');
    await p.screenshot({ path: path.join(PHOTOS, 'reprendre-1-toast.png') });
    await p.locator('#toast #toast-undo').click();
    await expect.poll(() => lignes(p), { timeout: 10_000 }).toEqual(['Audit du réseau, 3 sites']);

    // 2. La page neuve suivante la propose : « Reprendre » rend la ligne.
    await aller(p, ent, '/dashboard');
    await aller(p, ent, '/doc/new/facture');
    const bandeau = p.locator('#ed-reprendre');
    await bandeau.waitFor({ timeout: 20_000 });
    expect(net(await bandeau.innerText())).toMatch(/^Facture commencée le \d\d\/\d\d à \d\d h \d\d, pas encore enregistrée .+ Reprendre Le jeter$/);
    expect(await lignes(p)).toEqual([]);
    await p.screenshot({ path: path.join(PHOTOS, 'reprendre-2-bandeau.png') });
    await p.locator('#ed-reprendre-ok').click();
    await expect.poll(() => lignes(p), { timeout: 10_000 }).toEqual(['Audit du réseau, 3 sites']);

    // 3. « Le jeter » l'efface : la page neuve d'après n'a plus rien à proposer.
    await aller(p, ent, '/dashboard');
    await aller(p, ent, '/doc/new/facture');
    await p.locator('#ed-reprendre-non').click({ timeout: 20_000 });
    await expect.poll(async () => net(await p.locator('#toast').innerText())).toBe('Brouillon jeté : rien n\'avait été enregistré');
    await aller(p, ent, '/dashboard');
    await aller(p, ent, '/doc/new/facture');
    await p.waitForTimeout(1500);
    expect(await p.locator('#ed-reprendre').count()).toBe(0);

    // 4. Avec un client et une ligne, elle s'enregistre seule en brouillon sur le serveur : la page neuve d'après propose
    //    « La reprendre », qui l'ouvre, ou « Plus tard ».
    await p.getByText('Clinique Les Jasmins', { exact: true }).first().click();
    await ligne(p, 'Maintenance trimestrielle');
    await expect.poll(() => p.locator('#ed-enreg').isVisible(), { timeout: 15_000 }).toBe(true);
    await aller(p, ent, '/dashboard');
    await aller(p, ent, '/doc/new/facture');
    await bandeau.waitFor({ timeout: 20_000 });
    expect(net(await bandeau.innerText())).toMatch(/^Une facture pour Clinique Les Jasmins t'attend en brouillon depuis aujourd'hui à \d\d h \d\d .+ La reprendre Plus tard$/);
    await p.screenshot({ path: path.join(PHOTOS, 'reprendre-3-serveur.png') });
    await p.locator('#ed-reprendre-ok').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toMatch(/^#\/doc\/(?!new)/);
    await expect.poll(() => lignes(p)).toContain('Maintenance trimestrielle');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);

  it('la commande fournisseur se garde et se reprend ; sur un poste partagé, la question reste et dit pourquoi', async () => {
    const { jeton, ent } = await essai('sarra-reprendre-cf');
    const { cx, p, erreurs } = await ouvrir(jeton, true);
    await aller(p, ent, '/commandef/new');
    const lab = p.locator('#cf-lines input[data-k=label]').first();
    await lab.fill('Câble réseau Cat6, 305 m'); await lab.press('Tab');
    await p.waitForTimeout(2200);
    await aller(p, ent, '/dashboard');
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    await aller(p, ent, '/commandef/new');
    const bandeau = p.locator('#cf-reprendre');
    await bandeau.waitFor({ timeout: 20_000 });
    expect(net(await bandeau.innerText())).toMatch(/^Commande commencée le \d\d\/\d\d à \d\d h \d\d, pas encore enregistrée 1 ligne\. Gardée sur cet ordinateur seulement : elle prend son numéro quand tu l'enregistres\. Reprendre Le jeter$/);
    await p.locator('#cf-reprendre-ok').click();
    await expect.poll(() => p.locator('#cf-lines input[data-k=label]').first().inputValue(), { timeout: 10_000 }).toBe('Câble réseau Cat6, 305 m');
    // Enregistrée, elle n'attend plus : la page neuve suivante n'a rien à reprendre.
    await p.locator('[data-combo=supplierId] .combo-btn').click();
    await p.locator('.combo-pop [role=option]').first().click();
    await p.locator('#save').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/^#\/commandef\/(?!new)/);
    await aller(p, ent, '/commandef/new');
    await p.waitForTimeout(1500);
    expect(await p.locator('#cf-reprendre').count()).toBe(0);
    expect(erreurs).toEqual([]);
    await cx.close();

    // Un poste partagé : rien ne se garde, la question reste, nomme la pièce et dit pourquoi elle serait perdue.
    const partage = await ouvrir(jeton, false);
    await aller(partage.p, ent, '/doc/new/devis');
    expect(await partage.p.locator('#ed-garde').count()).toBe(0);
    await ligne(partage.p, 'Installation de caméras');
    await partage.p.locator('.ed-chemin a.ed-retour').click();
    const fenetre = partage.p.locator('#modal-root .modal').last();
    await fenetre.waitFor({ timeout: 5_000 });
    expect(net(await fenetre.innerText())).toBe('Quitter sans enregistrer ? Rien ne se garde sur cet ordinateur : tu es connecté sans « mon ordinateur » (un poste partagé, ou une fenêtre privée). En quittant, ce devis commencé est perdu. Annuler Quitter sans enregistrer Enregistrer et continuer');
    await partage.p.screenshot({ path: path.join(PHOTOS, 'reprendre-4-partage.png') });
    await partage.p.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click();
    await expect.poll(() => partage.p.evaluate(() => location.hash)).toBe('#/devis');
    expect(partage.erreurs).toEqual([]);
    await partage.cx.close();
  }, 180_000);
});
