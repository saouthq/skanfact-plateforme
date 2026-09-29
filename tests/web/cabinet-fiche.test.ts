// La fiche et les réglages du cabinet, à la souris (brique 47 ; docs/cabinet.md, C37). Les écrans sont
// ceux du Cabinet v10 (Réglages → Mon cabinet, Comptabilité, L'application). Ce que le parcours
// vérifie, écran ET serveur :
//   - le nom, l'adresse, le téléphone et les trois jours s'enregistrent ; le nom se lit en haut de
//     l'écran, et tout se relit après un rechargement ;
//   - un nom vide, une adresse illisible sont refusés sur le champ, et rien ne part ;
//   - la grille de saisie et le thème s'enregistrent, et le thème s'applique à la réouverture ;
//   - la visite « Nommer mon cabinet » se joue jusqu'au bout, sans parler d'un fichier d'appairage.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la fiche du cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-fiche-'));
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

  type Saisie = { journalParDefaut: string; dateComplete: boolean; validerParLot: boolean; regleLe?: string };
  type Reglages = { contenu: { email?: string; phone?: string; relanceDay?: number; theme?: string; saisie?: Saisie } & Record<string, unknown>; revision: number | null };

  it('le nom, l\'adresse, le téléphone, les jours, la grille de saisie et le thème s\'enregistrent et se relisent', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const reglages = async () => (await api('GET', `/cabinets/${cabinet}/reglages`, associe)).corps as Reglages;
    const nom = async () => ((await api('GET', '/cabinets', associe)).corps.cabinets as { id: string; nom: string }[]).find((c) => c.id === cabinet)?.nom;

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async (h: string) => {
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}${h}`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    const toast = () => p.locator('#toast').innerText();
    const ouvrir = async (bouton: string, dedans: string) => expect.poll(async () => {
      if (!await p.locator(dedans).isVisible()) await p.locator(bouton).first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator(dedans).isVisible();
    }, { timeout: 30_000 }).toBe(true);

    // ── Mon cabinet : un nom vide, une adresse illisible, et rien ne part ───────────────────────────
    await aller('#/reglages');
    await ouvrir('#set-tabs [data-tab="cabinet"]', '#c-save');
    expect(await p.locator('#c-name').inputValue()).toBe('Cabinet Ennour');
    await p.locator('#c-name').fill('Cabinet Ennour & Associés');
    await p.locator('#c-email').fill('contact-cabinet-ennour');
    await p.locator('#c-save').click();
    await expect.poll(toast).toBe('L\'adresse e-mail du cabinet ne se lit pas : écris-la comme « contact@cabinet.tn ».');
    expect(await p.locator('.field:has(#c-email)').getAttribute('class')).toMatch(/champ-faute/);
    await p.locator('#c-name').fill('  ');
    await p.locator('#c-email').fill('contact@cabinet-ennour.tn');
    await p.locator('#c-save').click();
    await expect.poll(toast).toBe('Donne un nom à ton cabinet : il signe tes relances.');
    expect(await p.locator('.field:has(#c-name)').getAttribute('class')).toMatch(/champ-faute/);
    expect(await nom()).toBe('Cabinet Ennour');
    expect((await reglages()).revision).toBe(null);

    // ── Tout s'enregistre ; le nom se lit en haut de l'écran ───────────────────────────────────────
    await p.locator('#c-name').fill('Cabinet Ennour & Associés');
    await p.locator('#c-phone').fill('+216 71 234 567');
    await p.locator('#c-day').fill('12');
    await p.locator('#c-tvaday').fill('20');
    await p.locator('#c-cnssday').fill('14');
    await p.locator('#c-save').click();
    await expect.poll(() => p.locator('#c-saved').innerText()).toBe('✓ enregistré');
    expect(await p.locator('#brand-cab').innerText()).toBe('Cabinet Ennour & Associés');
    expect(await nom()).toBe('Cabinet Ennour & Associés');
    expect((await reglages()).contenu).toMatchObject({ email: 'contact@cabinet-ennour.tn', phone: '+216 71 234 567', relanceDay: 12, deadlines: { tvaDay: 20, cnssDay: 14 } });
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-fiche-1-enregistree.png') });

    // ── La grille de saisie (Comptabilité) ──────────────────────────────────────────────────────
    await ouvrir('#set-tabs [data-tab="compta"]', '#sr-save');
    const journal = (await p.locator('#sr-journal option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).find((v) => v) ?? '';
    expect(journal).not.toBe('');
    await p.locator('#sr-journal').selectOption(journal);
    await p.locator('#sr-datec').uncheck();
    await p.locator('#sr-save').click();
    await expect.poll(() => p.locator('#sr-saved').innerText()).toBe('✓ enregistré');
    const saisie = (await reglages()).contenu.saisie;
    expect(saisie).toMatchObject({ journalParDefaut: journal, dateComplete: false, validerParLot: true });
    expect(typeof saisie?.regleLe).toBe('string');

    // ── Le thème (L'application) : il s'applique tout de suite, et se garde ──────────────────────
    await ouvrir('#set-tabs [data-tab="app"]', '.theme-op:has(input[value="dark"])');
    await p.locator('.theme-op:has(input[value="dark"]) .theme-t').click();
    await expect.poll(async () => (await reglages()).contenu.theme).toBe('dark');
    expect(await p.evaluate(() => document.body.classList.contains('dark'))).toBe(true);
    // La fiche n'a pas bougé pour autant.
    expect((await reglages()).contenu).toMatchObject({ email: 'contact@cabinet-ennour.tn', relanceDay: 12, saisie: { journalParDefaut: journal } });

    // ── Rouvert, tout se relit ─────────────────────────────────────────────────────────────────
    await aller('#/reglages');
    await p.reload();
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    expect(await p.evaluate(() => document.body.classList.contains('dark'))).toBe(true);
    await ouvrir('#set-tabs [data-tab="cabinet"]', '#c-save');
    expect(await p.locator('#c-name').inputValue()).toBe('Cabinet Ennour & Associés');
    expect(await p.locator('#c-email').inputValue()).toBe('contact@cabinet-ennour.tn');
    expect(await p.locator('#c-phone').inputValue()).toBe('+216 71 234 567');
    expect([await p.locator('#c-day').inputValue(), await p.locator('#c-tvaday').inputValue(), await p.locator('#c-cnssday').inputValue()]).toEqual(['12', '20', '14']);
    expect(await p.locator('#brand-cab').innerText()).toBe('Cabinet Ennour & Associés');
    await ouvrir('#set-tabs [data-tab="compta"]', '#sr-save');
    expect(await p.locator('#sr-journal').inputValue()).toBe(journal);
    expect(await p.locator('#sr-datec').isChecked()).toBe(false);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-fiche-2-relue.png') });

    // ── La visite « Nommer mon cabinet » se montre de nouveau, et se joue jusqu'au bout ────────────
    await p.goto('about:blank');
    await aller('#/guide');
    const ligne = p.locator('.g-carte').filter({ has: p.locator('.g-carte-titre', { hasText: /^Nommer mon cabinet$/ }) });
    await expect.poll(() => ligne.count()).toBe(1);
    expect(await ligne.innerText()).not.toMatch(/appairage|fichier/);
    await ligne.getByRole('button', { name: 'Commencer' }).click();
    const bulle = p.locator('#visite-bulle');
    await expect.poll(() => bulle.innerText()).toMatch(/Le nom du cabinet/);
    // La page peut encore se redessiner juste après son ouverture (l'équipe se lit après) : le nom
    // tapé se retape tant qu'il n'est pas resté dans la case.
    const taperLeNom = () => expect.poll(async () => {
      if (await p.locator('#c-name').inputValue() !== 'Cabinet Ennour') await p.locator('#c-name').fill('Cabinet Ennour');
      await p.waitForTimeout(400);
      return p.locator('#c-name').inputValue();
    }, { timeout: 20_000 }).toBe('Cabinet Ennour');
    await taperLeNom();
    await bulle.getByRole('button', { name: 'Suivant' }).click();
    await expect.poll(() => bulle.innerText()).toMatch(/Son adresse/);
    expect(await bulle.innerText()).not.toMatch(/appairage/);
    await taperLeNom();
    await bulle.getByRole('button', { name: 'Suivant' }).click();
    await expect.poll(() => bulle.innerText()).toMatch(/Enregistrer/);
    expect(await bulle.innerText()).not.toMatch(/DÉJÀ FAIT/i);
    await p.locator('#c-save').click();
    await expect.poll(() => bulle.innerText()).toMatch(/Ton cabinet a son nom/);
    expect(await bulle.innerText()).toMatch(/Il signe désormais tes relances, et tes clients le lisent quand ils te confient leur dossier\./);
    expect(await nom()).toBe('Cabinet Ennour');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-fiche-3-visite.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);
});
