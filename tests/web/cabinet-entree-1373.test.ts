// L'entrée d'un comptable qui vient essayer (1.373.0 ; issue 3 de la revue du 16/11/2026), à la souris :
//   - la porte lui parle : trois cartes de même poids, dont la sienne ;
//   - un refus ne fait plus perdre le curseur (un cabinet créé sous le nom « C ») ;
//   - le cabinet créé, il choisit : découvrir avec un dossier d'exemple, ou commencer avec ses clients ;
//   - l'exemple se charge en disant où il en est (une barre), s'ouvre, et la visite de sa fiche part toute seule ;
//   - le code du téléphone ne barre plus l'essai (0216) : rien tant que le cabinet n'a que l'exemple ; au premier vrai
//     dossier, sept jours, rappelés en haut du tableau de bord ; passé ce délai, l'écran du code, puis le Cabinet.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('l\'entrée d\'un comptable (1.373.0), à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-entree-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  // Le Cabinet dans le navigateur, avec la session de la personne (posée comme l'entrée la pose).
  // Sans cabinet : l'entrée (/), qui choisit ce qu'elle ouvre.
  const ouvrir = async (jeton: string, cabinet: string | null, erreurs: string[]): Promise<Page> => {
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await p.goto(cabinet ? `${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossiers` : serveur.adresse);
    return p;
  };


  it('la porte, le refus sans perdre le curseur, l\'exemple chargé et visité, le premier vrai dossier, puis le code au huitième jour', async () => {
    const email = `entree-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Hédi Trabelsi', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const erreurs: string[] = [];
    const p = await ouvrir(jeton, null, erreurs);
    const net = (t: string) => t.replace(/\s+/g, ' ').trim();

    // ── La porte : trois cartes de même poids, celle du comptable comprise ─────────────────────────────────────────
    await p.getByRole('heading', { level: 1, name: 'Bienvenue dans SkanFact' }).waitFor({ timeout: 15_000 });
    const cartes = p.locator('.ent-choix > article');
    expect(await cartes.count()).toBe(3);
    expect(net(await cartes.nth(2).innerText())).toMatch(/^Pour les comptables Tenir les dossiers de mes clients .*Un dossier d'exemple pour tout essayer Tes clients n'ont pas besoin d'avoir SkanFact Je suis un cabinet comptable$/);
    const boites = await cartes.evaluateAll((l) => l.map((a) => a.getBoundingClientRect()).map((r) => ({ y: Math.round(r.y), l: Math.round(r.width) })));
    expect(new Set(boites.map((b) => b.y)).size).toBe(1);
    expect(Math.max(...boites.map((b) => b.l)) - Math.min(...boites.map((b) => b.l))).toBeLessThanOrEqual(2);
    await p.screenshot({ path: path.join(PHOTOS, 'entree-cabinet-1-porte.png') });
    await p.getByRole('button', { name: 'Je suis un cabinet comptable', exact: true }).click();

    // ── Le nom : refusé vide, puis tapé d'une traite — le curseur n'a pas quitté la case ───────────────────────────
    await p.getByRole('heading', { level: 1, name: 'Ton cabinet' }).waitFor({ timeout: 10_000 });
    expect(net(await p.locator('.ent-fil').innerText())).toBe('Ton compte 2 Ton cabinet 3 Ton départ');
    await p.getByRole('button', { name: 'Créer mon cabinet', exact: true }).click();
    await expect.poll(() => p.locator('.ent-aide.alerte').innerText().catch(() => '')).toBe('Il faut au moins 2 caractères.');
    await p.keyboard.type('Cabinet Trabelsi & Associés', { delay: 15 });
    const nom = p.getByRole('textbox', { name: 'Nom du cabinet' });
    expect(await nom.inputValue()).toBe('Cabinet Trabelsi & Associés');
    expect(await nom.evaluate((e) => e === document.activeElement)).toBe(true);
    // Un nom d'une lettre ne passe pas non plus.
    expect((await api('POST', '/cabinets', jeton, { nom: 'C' })).statut).toBe(400);
    await p.getByRole('button', { name: 'Créer mon cabinet', exact: true }).click();

    // ── Le départ : l'exemple (recommandé) ou ses clients ──────────────────────────────────────────────────────────
    await p.getByRole('heading', { level: 1, name: 'Ton cabinet « Cabinet Trabelsi & Associés » est créé' }).waitFor({ timeout: 10_000 });
    expect(await p.locator('.ent-choix > article h2').allInnerTexts()).toEqual(['Découvrir avec un dossier d\'exemple', 'Commencer avec mes clients']);
    await p.screenshot({ path: path.join(PHOTOS, 'entree-cabinet-2-depart.png') });
    await p.getByRole('button', { name: 'Ouvrir le dossier d\'exemple', exact: true }).click();
    // Aucun écran de code entre les deux : le Cabinet s'ouvre, et l'exemple se prépare en le disant.
    await p.waitForURL(/\/v10\/cabinet\/\?c=[0-9a-f-]{36}/, { timeout: 15_000 });
    const cabinet = String(new URL(p.url()).searchParams.get('c'));
    await p.locator('#ex-charge').waitFor({ timeout: 15_000 });
    expect(net(await p.locator('#ex-charge').innerText())).toContain('Compte une à deux minutes');
    await expect.poll(async () => Number(await p.locator('#ex-charge .ex-barre').getAttribute('aria-valuenow').catch(() => '0')), { timeout: 60_000 }).toBeGreaterThan(20);
    // Pas d'invitation à une visite par-dessus la fenêtre qui travaille.
    expect(await p.locator('#guide-appel').count()).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'entree-cabinet-3-charge.png') });
    // L'exemple ouvert, la visite de sa fiche part toute seule.
    await p.waitForURL(/#\/dossier\//, { timeout: 170_000 });
    await p.locator('#visite-bulle').waitFor({ timeout: 20_000 });
    expect(net(await p.locator('#visite-bulle').innerText())).toContain('La fiche d\'un dossier');
    expect(net(await p.locator('#brand-cab-sous').innerText())).toBe('Cabinet · ton dossier d\'exemple');
    await p.screenshot({ path: path.join(PHOTOS, 'entree-cabinet-4-visite.png') });
    await p.keyboard.press('Escape');
    // L'exemple dit sa TVA telle qu'elle est réglée, et une seule mention « À VÉRIFIER » sur la fiche.
    const fiche = await p.locator('#view').innerText();
    expect(fiche).toContain('mensuelle · déclarée le 28');
    expect(fiche.match(/À VÉRIFIER/g)?.length ?? 0).toBeLessThanOrEqual(1);
    // Le compte : pas de code exigé, et aucun jour annoncé.
    const compte = async () => (await api('GET', '/moi', jeton)).corps as { codeAConfigurer: boolean; compte: { codeExige: boolean; codeExigeLe: string | null } };
    expect(await compte()).toMatchObject({ codeAConfigurer: false, compte: { codeExige: false, codeExigeLe: null } });

    // ── Le premier vrai dossier : annoncé dans la fenêtre, puis sept jours, rappelés ───────────────────────────────
    await p.evaluate(() => { location.hash = '#/production'; });
    await p.locator('#page-bord').waitFor({ timeout: 15_000 });
    // Seul dans son cabinet : pas de « Les miens / Tous ».
    expect(await p.locator('[data-portee], [data-portee-page]').count()).toBe(0);
    expect(await p.locator('#rappel-code').count()).toBe(0);
    await p.locator('#btn-creer, .btn-creer, button:has-text("Créer")').first().click();
    const menu = p.locator('[role=menu], .row-menu').last();
    await expect.poll(() => menu.innerText().then(net).catch(() => '')).toContain('Ouvrir le dossier d\'exemple');
    await p.getByText('Nouveau dossier', { exact: true }).first().click();
    await p.locator('#nd-code').waitFor({ timeout: 10_000 });
    expect(net(await p.locator('#nd-code').innerText())).toMatch(/^Sept jours après ton premier vrai dossier, SkanFact te demandera de protéger ton compte par un code sur ton téléphone/);
    await p.locator('.modal input').first().fill('Garage Ben Salah');
    await p.locator('.modal #ok').click();
    await p.waitForURL(/#\/dossier\//, { timeout: 20_000 });
    // Pas barré : il travaille. Le compte dit le jour.
    const apres = await compte();
    expect(apres.codeAConfigurer).toBe(false);
    expect(Math.round((Date.parse(String(apres.compte.codeExigeLe)) - Date.now()) / 86_400_000)).toBe(7);
    await p.reload();
    await p.evaluate(() => { location.hash = '#/production'; });
    await p.locator('#rappel-code').waitFor({ timeout: 20_000 });
    expect(net(await p.locator('#rappel-code').innerText())).toMatch(/^Protège ton compte d'ici 7 jours\. Ton cabinet tient un vrai dossier : à partir du \d\d\/\d\d\/\d{4}, SkanFact demandera à chaque comptable un code sur son téléphone/);
    // Le vrai dossier là, l'exemple sort des comptes du cabinet.
    expect(net(await p.locator('#brand-cab-sous').innerText())).toBe('Cabinet · 1 dossier');
    await p.screenshot({ path: path.join(PHOTOS, 'entree-cabinet-5-rappel.png') });
    await p.locator('[data-rappel-code]').click();
    await p.locator('#compte-panel').waitFor({ timeout: 15_000 });

    // ── Huit jours plus tard : le code est exigé, il se pose, et le Cabinet rouvre ─────────────────────────────────
    await admin.query(`update socle.entreprise set cree_le = now() - interval '8 days' where tenue_par = $1 and not exemple`, [cabinet]);
    await admin.query(`update socle.mandat set cree_le = now() - interval '8 days' where cabinet = $1`, [cabinet]);
    await p.goto(serveur.adresse);
    await p.getByRole('heading', { level: 1, name: 'Ton cabinet a un vrai dossier : protège ton compte' }).waitFor({ timeout: 20_000 });
    expect(await p.locator('.ent-fil').count()).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'entree-cabinet-6-code.png') });
    await p.getByRole('button', { name: 'Mettre en place le code', exact: true }).click();
    const cle = (await p.locator('.code-cle').innerText()).replace(/\s/g, '');
    // Les codes de secours gardés, la phrase dit ce qui reste ; les six chiffres tapés, elle dit que tout est prêt (1.76.0).
    await p.getByText('Je les ai mis de côté', { exact: true }).click();
    await expect.poll(() => p.locator('.ent-aide.ok').innerText()).toMatch(/il reste à taper le code/);
    await p.locator('label.field').filter({ hasText: 'Le code que montre l\'application' }).locator('input').fill(codeTotp(depuisBase32(cle), Date.now()));
    await expect.poll(() => p.locator('.ent-aide.ok').innerText()).toMatch(/^Tout est prêt : « vérifier et continuer » contrôle le code tapé/i);
    await p.getByRole('button', { name: 'Vérifier et continuer', exact: true }).click();
    await p.waitForURL(/\/v10\/cabinet\/\?c=[0-9a-f-]{36}/, { timeout: 15_000 });
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    expect(await p.locator('#rappel-code').count()).toBe(0);
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 420_000);
});
