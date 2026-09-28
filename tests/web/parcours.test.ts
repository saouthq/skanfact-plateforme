// Le premier parcours joué comme une personne (règle du projet : rien ne s'annonce avant d'avoir
// été refait à la souris et vu à l'écran) : créer son compte (un mot de passe trop court se refuse
// sur son champ), se tromper de mot de passe, se connecter, créer une entreprise d'essai, poser le
// code sur le téléphone, noter ses codes, se déconnecter, puis revenir d'un autre appareil avec le
// code à six chiffres. Chaque bouton est trouvé par ce qu'il dit, jamais par son rang.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { LONGUEUR_MINIMALE } from '../../commun/compte.ts';
import { motif, rendre, t } from '../../textes/index.ts';
import '../../web/src/textes.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const titre = (cle: string) => { const s = rendre(t(cle), 'fr'); return s.charAt(0).toUpperCase() + s.slice(1); };
const phrase = (cle: string, v = {}) => rendre(motif(cle, v), 'fr');

describe('le premier parcours, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const champ = (p: Page, cle: string) => p.getByLabel(titre(cle), { exact: true });
  const bouton = (p: Page, cle: string) => p.getByRole('button', { name: titre(cle), exact: true });
  const ecran = (p: Page, cle: string) => p.getByRole('heading', { level: 1, name: titre(cle) }).waitFor({ timeout: 10_000 });

  it('de la création du compte au retour avec le code du téléphone', async () => {
    const email = `parcours-${Date.now()}@exemple.tn`;
    const p = await (await navigateur.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await p.goto(serveur.adresse);
    await ecran(p, 'ecran.connexion.titre');

    // Créer son compte : un mot de passe trop court est refusé SUR son champ, qui prend le focus.
    await bouton(p, 'ecran.connexion.creer_compte').click();
    await ecran(p, 'ecran.inscription.titre');
    await champ(p, 'ecran.connexion.email').fill(email);
    await champ(p, 'ecran.inscription.nom').fill('Sami Gharbi');
    await champ(p, 'ecran.connexion.mot_de_passe').fill('court');
    await bouton(p, 'ecran.inscription.bouton').click();
    await expect.poll(() => p.getByRole('alert').first().innerText()).toBe(phrase('mot_de_passe.trop_court', { min: LONGUEUR_MINIMALE }));
    expect(await champ(p, 'ecran.connexion.mot_de_passe').evaluate((e) => e === document.activeElement)).toBe(true);
    await champ(p, 'ecran.connexion.mot_de_passe').fill('Un-bon-mot-de-passe');
    await bouton(p, 'ecran.inscription.bouton').click();

    // Se tromper de mot de passe, puis se connecter.
    await ecran(p, 'ecran.connexion.titre');
    await champ(p, 'ecran.connexion.email').fill(email);
    await champ(p, 'ecran.connexion.mot_de_passe').fill('pas-le-bon-mot');
    await bouton(p, 'ecran.connexion.bouton').click();
    await expect.poll(() => p.getByRole('alert').first().innerText()).toBe(phrase('connexion.refusee'));
    await champ(p, 'ecran.connexion.mot_de_passe').fill('Un-bon-mot-de-passe');
    await bouton(p, 'ecran.connexion.bouton').click();

    // Aucune entreprise : le bouton principal crée l'entreprise d'essai ; le rôle exige alors le code.
    await ecran(p, 'ecran.entreprises.titre');
    await bouton(p, 'ecran.entreprises.creer_essai').click();
    await ecran(p, 'ecran.code_requis.titre');
    await bouton(p, 'ecran.code_requis.bouton').click();
    await ecran(p, 'ecran.code_pose.titre');
    const adresse = await p.locator('code').innerText();
    const secret = /secret=([A-Z2-7]+)/.exec(adresse)?.[1] ?? '';
    expect(secret).not.toBe('');
    expect(await p.locator('ul li').count()).toBe(10);
    await bouton(p, 'ecran.code_pose.bouton').click();
    await ecran(p, 'ecran.entreprises.titre');
    await expect.poll(() => p.getByText('Entreprise d\'essai de Sami Gharbi').count()).toBe(1);
    await bouton(p, 'ecran.deconnexion').click();
    await ecran(p, 'ecran.connexion.titre');

    // D'un autre appareil (un autre navigateur) : le mot de passe, puis le code à six chiffres.
    const q = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await q.goto(serveur.adresse);
    await champ(q, 'ecran.connexion.email').fill(email);
    await champ(q, 'ecran.connexion.mot_de_passe').fill('Un-bon-mot-de-passe');
    await bouton(q, 'ecran.connexion.bouton').click();
    await ecran(q, 'ecran.code.titre');
    await champ(q, 'ecran.code.champ').fill('000000');
    await bouton(q, 'ecran.code.bouton').click();
    await expect.poll(() => q.getByRole('alert').first().innerText()).toBe(phrase('connexion.code_faux'));
    await champ(q, 'ecran.code.champ').fill(codeTotp(depuisBase32(secret), Date.now()));
    await bouton(q, 'ecran.code.bouton').click();
    await ecran(q, 'ecran.entreprises.titre');
    await expect.poll(() => q.getByText(titre('ecran.entreprises.essai'), { exact: false }).count()).toBeGreaterThan(0);
  }, 120_000);
});
