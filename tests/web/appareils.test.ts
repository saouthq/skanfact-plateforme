// Tes appareils, à la souris (brique 74 ; docs/hors-ligne.md, H9). Nadia a deux appareils : son portable
// (« mon ordinateur », qui garde une copie de l'entreprise) et le PC du bureau. Le portable est perdu.
// Ce que le parcours vérifie, écran ET serveur :
//   - depuis le bureau, Paramètres → Ton compte → « Tes appareils » : les deux, celui-ci marqué ;
//     « Retirer… » demande d'abord, puis retire ; le portable est dit retiré ;
//   - le portable, à sa reconnexion : ce qu'il gardait est effacé AVANT toute autre chose (la copie, sa
//     clé, la session), et l'entrée le dit ;
//   - le Mac, retiré à son tour et rouvert par l'entrée (pas par son entreprise) : pareil.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { rendre, t } from '../../textes/index.ts';
import '../../web/src/textes.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('tes appareils, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-appareils-'));
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
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  // Ce que le poste garde : la base du navigateur existe-t-elle encore ?
  const posteGarde = (p: Page) => p.evaluate(async () => (await indexedDB.databases()).some((b) => b.name === 'skanfact-poste'));

  it('le bureau retire le portable perdu ; le portable, à sa reconnexion, efface ce qu\'il gardait, et l\'entrée le dit', async () => {
    const email = `nadia-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const entree = (await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Firefox sur Mac', type: 'navigateur' } })).corps;
    const [premier, macAppareil] = [String(entree.jeton), String(entree.appareil)];
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const ent = String((await api('POST', '/entreprises', premier, { raisonSociale: 'Épicerie Nadia' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, premier);
    await api('POST', `/entreprises/${ent}/dossier-v10`, premier, { changements: [{ collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Boulangerie du Lac' } }] });
    // Une session par appareil, avec le code.
    const session = async (nom: string) => {
      const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom, type: 'navigateur' } });
      return String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    };
    const portableJeton = await session('Chrome sur Windows');
    const bureauJeton = await session('Chrome sur Linux');

    // Le portable : « mon ordinateur », la copie de l'entreprise sur le poste.
    const cp = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cp.addInitScript((j) => { if (location.protocol.startsWith('http') && !localStorage.getItem('test.pose')) { localStorage.setItem('test.pose', '1'); localStorage.setItem('skanfact.jeton', j); } }, portableJeton);
    const portable = await cp.newPage();
    await portable.goto(`${serveur.adresse}/v10/?e=${ent}#/clients`);
    await portable.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(portable);
    await expect.poll(() => posteGarde(portable), { timeout: 15_000 }).toBe(true);

    // Le bureau : Paramètres → Ton compte → Tes appareils (avec l'adresse, le mot de passe et le code : lot onboarding).
    const cb = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cb.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, bureauJeton);
    const bureau = await cb.newPage();
    const erreurs: string[] = [];
    bureau.on('pageerror', (e) => erreurs.push(e.message));
    await bureau.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await bureau.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(bureau);
    await bureau.getByRole('tab', { name: 'Ton compte', exact: true }).click();
    const panneau = bureau.locator('#p-appareils');
    await expect.poll(() => panneau.innerText(), { timeout: 15_000 }).toMatch(/Tes appareils[\s\S]*Chrome sur Linux\s*cet appareil[\s\S]*Chrome sur Windows/);
    expect(await panneau.innerText()).toContain('Firefox sur Mac');
    // L'appareil où l'on est ne se retire pas d'ici (on s'en déconnecte).
    expect(await panneau.locator('tr').filter({ hasText: 'cet appareil' }).getByRole('button').count()).toBe(0);
    await bureau.screenshot({ path: path.join(PHOTOS, 'appareils-1-liste.png') });
    // « Retirer… » demande d'abord ; « Oui, le retirer » retire.
    const ligne = panneau.locator('tr').filter({ hasText: 'Chrome sur Windows' });
    await ligne.getByRole('button', { name: 'Retirer…', exact: true }).click();
    await expect.poll(() => panneau.getByRole('alert').innerText()).toBe('«\u202fChrome sur Windows\u202f» ne pourra plus rien ouvrir, et ce qu\'il garde s\'effacera à sa prochaine connexion.');
    expect((await api('GET', '/moi', portableJeton)).statut).toBe(200);
    await ligne.getByRole('button', { name: 'Oui, le retirer', exact: true }).click();
    await expect.poll(() => panneau.locator('tr').filter({ hasText: 'Chrome sur Windows' }).innerText(), { timeout: 15_000 }).toMatch(/Retiré le \d\d\/\d\d\/\d{4}/);
    expect(await panneau.locator('tr').filter({ hasText: 'Chrome sur Windows' }).getByRole('button').count()).toBe(0);
    await bureau.screenshot({ path: path.join(PHOTOS, 'appareils-2-retire.png') });

    // Le portable se reconnecte : il efface ce qu'il gardait, et l'entrée le dit.
    await portable.reload();
    await portable.waitForURL((u) => !u.pathname.startsWith('/v10'), { timeout: 20_000 });
    await expect.poll(() => portable.locator('#toast').innerText(), { timeout: 15_000 })
      .toBe('Cet appareil a été retiré de ton compte : ce qu\'il gardait pour travailler sans réseau est effacé ; reconnecte-toi pour continuer.');
    await portable.screenshot({ path: path.join(PHOTOS, 'appareils-3-efface.png') });
    expect(await posteGarde(portable)).toBe(false);
    expect(await portable.evaluate(() => [localStorage.getItem('skanfact.jeton'), sessionStorage.getItem('skanfact.jeton')])).toEqual([null, null]);

    // Le Mac, retiré à son tour, rouvert par l'entrée (et non par son entreprise) : l'entrée efface, et le dit.
    const cm = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cm.addInitScript((j) => { if (location.protocol.startsWith('http') && !localStorage.getItem('test.pose')) { localStorage.setItem('test.pose', '1'); localStorage.setItem('skanfact.jeton', j); } }, premier);
    const mac = await cm.newPage();
    await mac.goto(`${serveur.adresse}/v10/?e=${ent}#/clients`);
    await mac.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(mac);
    await expect.poll(() => posteGarde(mac), { timeout: 15_000 }).toBe(true);
    expect((await api('DELETE', `/moi/appareils/${macAppareil}`, bureauJeton)).statut).toBe(200);
    await mac.goto(`${serveur.adresse}/`);
    await expect.poll(() => mac.locator('#toast').innerText(), { timeout: 15_000 })
      .toBe('Cet appareil a été retiré de ton compte : ce qu\'il gardait pour travailler sans réseau est effacé ; reconnecte-toi pour continuer.');
    await expect.poll(() => posteGarde(mac), { timeout: 10_000 }).toBe(false);
    expect(await mac.evaluate(() => [localStorage.getItem('skanfact.jeton'), localStorage.getItem('skanfact.poste_de')])).toEqual([null, null]);
    // « Reconnecte-toi pour continuer » : par l'entrée, avec le code. Le Mac revient comme un appareil
    // neuf, sous un nom qu'on lit (pas la signature du navigateur).
    const titre = (cle: string) => { const x = rendre(t(cle), 'fr'); return x.charAt(0).toUpperCase() + x.slice(1); };
    await mac.locator('label.field').filter({ hasText: titre('ecran.connexion.email') }).locator('input').fill(email);
    await mac.locator('label.field').filter({ hasText: titre('ecran.connexion.mot_de_passe') }).locator('input').fill('Un-bon-mot-de-passe');
    await mac.getByRole('button', { name: titre('ecran.connexion.bouton'), exact: true }).click();
    const code = mac.locator('label.field').filter({ hasText: titre('ecran.code.champ') }).locator('input');
    await code.waitFor({ timeout: 20_000 });
    await code.fill(codeTotp(depuisBase32(secret), Date.now()));
    await mac.getByRole('button', { name: titre('ecran.code.bouton'), exact: true }).click();
    await mac.waitForURL(/\/v10\/\?e=/, { timeout: 20_000 });
    await mac.locator('#view h1').first().waitFor({ timeout: 20_000 });
    const noms = ((await api('GET', '/moi/appareils', bureauJeton)).corps.appareils as { nom: string; retireLe: string | null }[])
      .filter((a) => !a.retireLe).map((a) => a.nom).sort();
    expect(noms).toEqual(['Chrome sur Linux', 'Chrome sur Linux']);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
