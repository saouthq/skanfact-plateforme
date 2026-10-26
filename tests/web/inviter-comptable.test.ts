// Inviter son comptable par e-mail, quand il n'est pas encore sur SkanFact (1.77.0 ; docs/recette.md), à la souris :
//   - le client, dans Paramètres › Envois, coche ce qu'il confie et écrit l'adresse de son comptable ; sans relais
//     d'e-mails, l'écran le dit et montre le lien, à copier ;
//   - le comptable ouvre le lien : son adresse est remplie, la vitrine parle du dossier qui l'attend (pas d'une facture),
//     le navigateur retient l'adresse comme identifiant ; puis son cabinet, le code du téléphone, et le Cabinet s'ouvre
//     avec la proposition du client en tête de la page ; il l'accepte ;
//   - le client voit qui tient ses livres.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('inviter son comptable par e-mail, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-invcpt-'));
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

  it('le client invite par e-mail ; le comptable crée son compte et son cabinet par le lien ; la proposition en tête, acceptée', async () => {
    const email = `client-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Hédi Ferjani', motDePasse: 'Un-bon-mot-de-passe' });
    const client = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Imprimerie Ferjani' })).corps.id);
    const erreurs: string[] = [];

    // Le client : Paramètres › Envois › Ton cabinet comptable ; la paie cochée en plus ; l'adresse de son comptable.
    const e = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', permissions: ['clipboard-read', 'clipboard-write'] })).newPage();
    e.on('pageerror', (x) => erreurs.push(x.message));
    await e.addInitScript((j) => { sessionStorage.setItem('skanfact.jeton', j); }, client);
    // (1.94.0) Le premier pas « Inviter mon comptable » de l'Accueil mène au champ de son adresse, le curseur dedans.
    await e.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await e.locator('#view h1').first().waitFor({ timeout: 15_000 });
    for (let i = 0; i < 3 && await e.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await e.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await e.locator('#view').getByRole('button', { name: 'Inviter mon comptable', exact: true }).first().click();
    await expect.poll(() => e.evaluate(() => document.activeElement?.id), { timeout: 15_000 }).toBe('mandat-email');
    // (1.128.0) Point 11 de la revue du mois d'un client : le panneau du cabinet d'abord (pas la carte vide des questions),
    // et le seul vert là où est le curseur, « Inviter mon comptable » ; le code tapé, il passe à « Confier mon dossier ».
    const verts = () => e.locator('#view .btn-primary').filter({ visible: true }).allInnerTexts();
    expect(await e.locator('#c-body > .panel').first().getAttribute('id')).toBe('p-cabinet-mandat');
    expect(await e.locator('#p-questions').count()).toBe(0);
    await expect.poll(verts, { timeout: 10_000 }).toEqual(['Inviter mon comptable']);
    await e.locator('#mandat-code').fill('ABC123');
    expect(await verts()).toEqual(['Confier mon dossier']);
    await e.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await e.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await e.getByRole('tab', { name: 'Envois', exact: true }).click();
    await e.locator('#mandat-email').waitFor({ timeout: 15_000 });
    // Les deux chemins se lisent côte à côte, de même poids.
    expect(await e.locator('.mandat-chemin h3').allInnerTexts()).toEqual(['Il a SkanFact Cabinet', 'Il n\'est pas encore sur SkanFact']);
    // Une adresse qui ne va pas se refuse sur sa case, sans rien envoyer.
    await e.locator('#mandat-email').fill('comptable');
    await e.getByRole('button', { name: 'Inviter mon comptable', exact: true }).click();
    await expect.poll(() => e.locator('#mandat-inviter [role=alert]').innerText()).toMatch(/par exemple nom@cabinet\.tn/);
    expect((await api('GET', `/entreprises/${ent}/mandat/invitation`, client)).corps.invitation).toBeNull();
    await e.locator('[data-perimetre="paie"]').check();
    const adresse = `comptable-${Date.now()}@exemple.tn`;
    // (1.94.0) Au clavier : Entrée dans le champ invite, comme le bouton.
    await e.locator('#mandat-email').fill(adresse);
    await e.locator('#mandat-email').press('Enter');
    // Ce serveur n'envoie pas d'e-mails : l'écran le dit, et montre le lien.
    await expect.poll(() => e.locator('#mandat-inviter').innerText(), { timeout: 15_000 }).toContain(`Tu as invité ${adresse}`);
    // Le curseur va au geste qui suit (copier le lien), et la copie se dit en une phrase.
    await expect.poll(() => e.evaluate(() => document.activeElement?.id)).toBe('mandat-lien-copier');
    await e.keyboard.press('Enter');
    await expect.poll(() => e.locator('#mandat-lien-copie').innerText()).toMatch(/^Lien copié\s:\scolle-le dans ton message à ton comptable\.$/);
    expect(await e.evaluate(() => navigator.clipboard.readText())).toBe(await e.locator('#mandat-lien').inputValue());
    expect(await e.locator('#mandat-inviter').innerText()).toContain('Ce serveur n\'envoie pas d\'e-mails');
    // (1.100.0) Redessinées, les cases disent ce que l'invitation confie : la paie cochée restait décochée à l'écran.
    expect(await e.locator('[data-perimetre="paie"]').isChecked()).toBe(true);
    expect((await e.locator('#mandat-invite').innerText()).replace(/\s+/g, ' ')).toContain(`Tu as invité ${adresse} pour la comptabilité, les déclarations, la saisie des achats et la paie :`);
    const lien = await e.locator('#mandat-lien').inputValue();
    expect(lien).toMatch(new RegExp(`^${serveur.adresse.replace(/[.]/g, '\\.')}/\\?comptable=[A-Za-z0-9_-]{20,}$`));
    await e.screenshot({ path: path.join(PHOTOS, 'inviter-comptable-1-client.png') });
    // Rechargé, le lien ne se montre plus (une fois, en secours) ; l'invitation, si.
    await e.reload();
    await e.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await e.getByRole('tab', { name: 'Envois', exact: true }).click();
    await expect.poll(() => e.locator('#mandat-inviter').innerText(), { timeout: 15_000 }).toContain(`Tu as invité ${adresse}`);
    expect(await e.locator('#mandat-lien').count()).toBe(0);
    expect(await e.locator('[data-perimetre="paie"]').isChecked()).toBe(true);

    // Le comptable, sur un navigateur neuf : le lien ouvre la création du compte, son adresse remplie.
    const c = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    c.on('pageerror', (x) => erreurs.push(x.message));
    await c.goto(lien);
    await c.getByRole('heading', { level: 1, name: 'Créer ton compte' }).waitFor({ timeout: 15_000 });
    await expect.poll(() => c.locator('.ent-vitrine').innerText()).toContain('Les livres de Imprimerie Ferjani');
    expect(await c.locator('.ent-vitrine').innerText()).not.toContain('première facture');
    expect(await c.locator('main').innerText()).toContain('Hédi Ferjani t\'invite à tenir les livres de Imprimerie Ferjani sur SkanFact');
    const champEmail = c.locator('label.field').filter({ hasText: 'Adresse e-mail' }).locator('input');
    expect(await champEmail.inputValue()).toBe(adresse);
    // Le navigateur retient l'adresse avec le mot de passe, pas le nom.
    expect(await champEmail.getAttribute('autocomplete')).toBe('username');
    expect(new URL(c.url()).search).toBe('');
    await c.screenshot({ path: path.join(PHOTOS, 'inviter-comptable-2-lien.png') });
    await c.locator('label.field').filter({ hasText: 'Ton nom' }).locator('input').fill('Karim Jlassi');
    await c.locator('label.field').filter({ hasText: 'Mot de passe' }).locator('input').fill('Un-bon-mot-de-passe');
    await c.getByRole('button', { name: 'Créer mon compte', exact: true }).click();
    // Pas d'entreprise à créer : son cabinet, avec la phrase du dossier qui l'attend.
    await c.getByRole('heading', { level: 1, name: 'Ton cabinet' }).waitFor({ timeout: 15_000 });
    expect(await c.locator('main, .ent').first().innerText()).toContain('le dossier de Imprimerie Ferjani y arrive aussitôt');
    await c.locator('label.field').filter({ hasText: 'Nom du cabinet' }).locator('input').fill('Cabinet Jlassi Conseil');
    await c.getByRole('button', { name: 'Créer mon cabinet', exact: true }).click();
    await c.getByRole('button', { name: 'Mettre en place le code', exact: true }).click();
    const cle = (await c.locator('.code-cle').innerText()).replace(/\s/g, '');
    await c.getByText('Je les ai mis de côté', { exact: true }).click();
    await c.locator('label.field').filter({ hasText: 'Le code que montre l\'application' }).locator('input').fill(codeTotp(depuisBase32(cle), Date.now()));
    await c.getByRole('button', { name: 'Vérifier et continuer', exact: true }).click();
    await c.waitForURL(/\/v10\/cabinet\/\?c=[0-9a-f-]{36}/, { timeout: 15_000 });
    // Le Cabinet s'ouvre (sur ses Priorités depuis la 1.152.0) : la proposition du client en tête, avant les premiers pas
    // d'un cabinet neuf (`.cab-neuf`), avec la paie qu'il a cochée.
    const bandeau = c.locator('.banner').filter({ hasText: 'Imprimerie Ferjani' });
    await bandeau.waitFor({ timeout: 15_000 });
    expect(await bandeau.innerText()).toContain('la comptabilité, les déclarations, la saisie des achats et la paie');
    expect(await c.locator('#view').evaluate((v) => {
      const b = v.querySelector('.banner'), pp = v.querySelector('.cab-neuf, .premiers-pas, #premiers-pas, .panel');
      return !!b && !!pp && !!(b.compareDocumentPosition(pp) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    await c.waitForTimeout(1000);
    await c.screenshot({ path: path.join(PHOTOS, 'inviter-comptable-3-cabinet.png') });
    await bandeau.getByRole('button', { name: 'Accepter', exact: true }).click();
    await expect.poll(() => c.locator('.banner').filter({ hasText: 'Imprimerie Ferjani' }).count(), { timeout: 15_000 }).toBe(0);
    await expect.poll(() => c.locator('#view').innerText(), { timeout: 15_000 }).toContain('Imprimerie Ferjani');

    // Le client voit qui tient ses livres ; l'invitation a servi.
    await e.reload();
    await e.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await e.getByRole('tab', { name: 'Envois', exact: true }).click();
    await expect.poll(() => e.locator('#cab-pair').innerText(), { timeout: 15_000 }).toContain('Cabinet Jlassi Conseil tient tes livres depuis le');
    expect((await api('GET', `/entreprises/${ent}/mandat/invitation`, client)).corps.invitation).toBeNull();
    // Le lien, rouvert, ne vaut plus : l'entrée le dit.
    const d = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    await d.goto(lien);
    await expect.poll(() => d.locator('main').innerText(), { timeout: 15_000 }).toContain('ce lien ne vaut plus'.replace(/^c/, 'C'));
    expect(erreurs).toEqual([]);
  }, 180_000);
});
