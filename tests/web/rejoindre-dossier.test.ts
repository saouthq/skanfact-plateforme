// Le client tenu rejoint son dossier (1.78.0 ; 03 § 3.5 ; docs/recette.md), à la souris :
//   - au Cabinet, sur un dossier tenu, le panneau « Ton client sur SkanFact » se lit sous ses mois ; l'associé écrit
//     l'adresse de son client ; sans relais d'e-mails, l'écran le dit et montre le lien ;
//   - le client ouvre le lien : sa vitrine (son dossier, son cabinet), son adresse remplie ; il crée son compte, et son
//     dossier s'ouvre : il en est le propriétaire, le mandat continue, son essai commence ;
//   - au Cabinet, le dossier n'est plus tenu : le panneau disparaît, l'en-tête dit qu'il est sur SkanFact.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le client tenu rejoint son dossier, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-rejoindre-'));
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

  it('l\'associé invite son client tenu ; le client crée son compte par le lien et devient le propriétaire de son dossier', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const ent = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Boulangerie Zitouna' })).corps.entreprise);
    const erreurs: string[] = [];

    // Au Cabinet : le dossier tenu, son panneau sous ses mois, avant les relances.
    const c = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    c.on('pageerror', (x) => erreurs.push(x.message));
    await c.addInitScript((j) => { sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}`);
    const panneau = c.locator('#d-rejoindre');
    await expect.poll(() => panneau.innerText().catch(() => ''), { timeout: 20_000 }).toContain('Ton client sur SkanFact');
    expect(await c.locator('#view').evaluate((v) => {
      const p = v.querySelector('#d-rejoindre'), r = [...v.querySelectorAll('.panel h2')].find((h) => h.textContent?.startsWith('Relances'));
      return !!p && !!r && !!(p.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    // Une adresse qui ne va pas se refuse sur sa case, sans rien envoyer.
    await c.locator('#rejoindre-email').fill('gerant');
    await c.getByRole('button', { name: 'Inviter mon client', exact: true }).click();
    await expect.poll(() => panneau.locator('[role=alert]').innerText()).toMatch(/par exemple gerant@entreprise\.tn/);
    const adresse = `gerant-${Date.now()}@exemple.tn`;
    await c.locator('#rejoindre-email').fill(adresse);
    await c.getByRole('button', { name: 'Inviter mon client', exact: true }).click();
    await expect.poll(() => panneau.innerText(), { timeout: 15_000 }).toContain(`Tu as invité ${adresse}`);
    expect(await panneau.innerText()).toContain('Ce serveur n\'envoie pas d\'e-mails');
    const lien = await c.locator('#rejoindre-lien').inputValue();
    expect(lien).toMatch(/\/\?dossier=[A-Za-z0-9_-]{20,}$/);
    await c.screenshot({ path: path.join(PHOTOS, 'rejoindre-dossier-1-cabinet.png') });

    // Le client, sur un navigateur neuf : sa vitrine, son adresse remplie ; son compte créé, son dossier s'ouvre.
    const e = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    e.on('pageerror', (x) => erreurs.push(x.message));
    await e.goto(lien);
    await e.getByRole('heading', { level: 1, name: 'Créer ton compte' }).waitFor({ timeout: 15_000 });
    await expect.poll(() => e.locator('.ent-vitrine').innerText()).toContain('Ton dossier Boulangerie Zitouna');
    expect(await e.locator('.ent-vitrine').innerText()).toContain('Cabinet Ennour tient tes livres à jour sur SkanFact');
    expect(await e.locator('main').innerText()).toContain('Cabinet Ennour t\'invite à rejoindre le dossier de Boulangerie Zitouna');
    expect(await e.locator('label.field').filter({ hasText: 'Adresse e-mail' }).locator('input').inputValue()).toBe(adresse);
    await e.screenshot({ path: path.join(PHOTOS, 'rejoindre-dossier-2-lien.png') });
    await e.locator('label.field').filter({ hasText: 'Ton nom' }).locator('input').fill('Mourad Zitouni');
    await e.locator('label.field').filter({ hasText: 'Mot de passe' }).locator('input').fill('Un-bon-mot-de-passe');
    await e.getByRole('button', { name: 'Créer mon compte', exact: true }).click();
    await e.waitForURL(new RegExp(`/v10/\\?e=${ent}`), { timeout: 20_000 });
    await e.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await expect.poll(() => e.locator('body').innerText(), { timeout: 15_000 }).toContain('Boulangerie Zitouna');
    await expect.poll(() => e.locator('body').innerText(), { timeout: 15_000 }).toMatch(/Essai : \d+\sjours/);
    await e.screenshot({ path: path.join(PHOTOS, 'rejoindre-dossier-3-client.png') });
    const jeton = await e.evaluate(() => sessionStorage.getItem('skanfact.jeton') ?? localStorage.getItem('skanfact.jeton'));
    expect(((await api('GET', `/entreprises/${ent}/mandat`, String(jeton))).corps.mandat as { statut: string }).statut).toBe('actif');

    // Au Cabinet : le dossier n'est plus tenu.
    await c.reload();
    await c.locator('#view h1').filter({ hasText: 'Boulangerie Zitouna' }).waitFor({ timeout: 15_000 });
    await expect.poll(() => c.locator('#view').innerText(), { timeout: 15_000 }).toContain('sur SkanFact : ses livres sont à jour en direct');
    expect(await c.locator('#d-rejoindre').count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
