// L'entrée refaite (lot entrée, 06/10/2026 ; maquettes validées par Skander, docs/entree.md), jouée à la souris dans un
// vrai navigateur : le mot de passe oublié de bout en bout (proposé seulement si le serveur sait envoyer l'e-mail), la
// jauge du mot de passe et « Afficher », la forme du matricule dite pendant la frappe avec le haut de la facture qui se
// dessine, les codes de secours copiés et téléchargés, et l'écran d'ouverture qui coche ce qui est fait. Et le code
// reçu par e-mail (lot onboarding, 0076) : « Vérifie ton e-mail » à l'inscription (une adresse mal tapée s'y corrige),
// « C'est bien toi ? » sur un appareil inconnu ; le code du téléphone, exigé du seul comptable d'un cabinet.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { LONGUEUR_MINIMALE } from '../../commun/compte.ts';
import { motif, rendre, t } from '../../textes/index.ts';
import '../../web/src/textes.ts';
import type { Courriel } from '../../serveur/courriel.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import * as jsqr from 'jsqr';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const VERSION = '2026.10.06 · 0a1b2c3';
const titre = (cle: string, v: Record<string, string | number> = {}) => { const s = rendre(t(cle, v), 'fr'); return s.charAt(0).toUpperCase() + s.slice(1); };
const phrase = (cle: string, v: Record<string, string | number> = {}) => rendre(motif(cle, v), 'fr');

describe('l\'entrée refaite, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  let sansCourriel: Awaited<ReturnType<typeof demarrer>>;
  const partis: Courriel[] = [];
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-entree-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    const c = { ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VERSION: VERSION }), port: 0, web: dossier, livreurMs: 60_000 };
    serveur = await demarrer(c, { courriel: { envoyer: async (m) => { partis.push(m); } } });
    sansCourriel = await demarrer(c);
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await sansCourriel?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const champ = (p: Page, cle: string) => p.locator('label.field').filter({ hasText: titre(cle) }).locator('input');
  const bouton = (p: Page, cle: string) => p.getByRole('button', { name: titre(cle), exact: true });
  const ecran = (p: Page, cle: string, v: Record<string, string> = {}) => p.getByRole('heading', { level: 1, name: titre(cle, v) }).waitFor({ timeout: 10_000 });
  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => (await (await fetch(`${serveur.adresse}/v1${chemin}`, {
    method: methode, headers: { ...(corps === undefined ? {} : { 'content-type': 'application/json' }), ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  })).json()) as Record<string, unknown>;
  // Le dernier code parti à cette adresse, lu dans l'objet de l'e-mail (« Ton code SkanFact : 482913 »).
  const codeRecu = (email: string) => /(\d{6})$/.exec(partis.filter((m) => m.a === email).at(-1)?.objet ?? '')?.[1] ?? '';
  let n = 0;
  async function personne() {
    const email = `entree-${++n}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Amine Gharbi', motDePasse: 'Un-bon-mot-de-passe' });
    // Ce serveur envoie des e-mails : la première connexion vérifie l'adresse, par le code reçu.
    const defi = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Essai', type: 'navigateur' } })).defi);
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi, code: codeRecu(email) })).jeton);
    return { email, jeton };
  }
  async function page(jeton?: string, adresse = serveur.adresse) {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true });
    await cx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: adresse });
    const p = await cx.newPage();
    if (jeton) await p.addInitScript((j) => sessionStorage.setItem('skanfact.jeton', j), jeton);
    return p;
  }

  it('mot de passe oublié : proposé seulement si l\'e-mail peut partir ; le lien reçu choisit un nouveau mot de passe, qui ouvre ensuite le compte', async () => {
    const { email } = await personne();
    // Un serveur sans relais d'e-mails ne propose rien qu'il ne saurait faire.
    const sans = await page(undefined, sansCourriel.adresse);
    await sans.goto(sansCourriel.adresse);
    await ecran(sans, 'ecran.connexion.titre');
    await expect.poll(async () => (await sans.locator('body').innerText()).length).toBeGreaterThan(0);
    await sans.waitForTimeout(500);
    expect(await bouton(sans, 'ecran.connexion.oublie').count()).toBe(0);
    await sans.context().close();

    const p = await page();
    await p.goto(serveur.adresse);
    await ecran(p, 'ecran.connexion.titre');
    await champ(p, 'ecran.connexion.email').fill(email);
    await bouton(p, 'ecran.connexion.oublie').click();
    await ecran(p, 'ecran.oubli.titre');
    // L'adresse tapée à la connexion est déjà là.
    expect(await champ(p, 'ecran.connexion.email').inputValue()).toBe(email);
    const avant = partis.length;
    await bouton(p, 'ecran.oubli.bouton').click();
    await ecran(p, 'ecran.oubli.envoye_titre');
    expect(await p.getByRole('status').filter({ hasText: email }).innerText()).toBe(phrase('ecran.oubli.envoye', { email }));
    expect(partis.length).toBe(avant + 1);
    const lien = /https?:\/\/[^\s]+\?reinitialiser=[A-Za-z0-9_-]+/.exec(partis.at(-1)?.texte ?? '')?.[0] ?? '';
    expect(lien.startsWith(`${serveur.adresse}/?reinitialiser=`)).toBe(true);

    // Le lien de l'e-mail : le jeton quitte l'adresse aussitôt.
    await p.goto(lien);
    await ecran(p, 'ecran.nouveau.titre');
    expect(new URL(p.url()).search).toBe('');
    await champ(p, 'ecran.connexion.mot_de_passe').fill('court');
    expect(await p.locator('.ent-aide[aria-live]').innerText()).toBe(phrase('ecran.inscription.encore', { n: LONGUEUR_MINIMALE - 5 }));
    await champ(p, 'ecran.connexion.mot_de_passe').fill('Une-phrase-toute-neuve');
    await p.screenshot({ path: path.join(PHOTOS, 'entree-nouveau-mot-de-passe.png') });
    await bouton(p, 'ecran.nouveau.bouton').click();
    await ecran(p, 'ecran.connexion.titre');
    await expect.poll(() => p.locator('#toast').innerText()).toBe(phrase('ecran.nouveau.fait'));
    // Le même lien ne sert plus : il le dit, et propose d'en demander un autre.
    await p.goto(lien);
    await ecran(p, 'ecran.nouveau.perime_titre');
    await bouton(p, 'ecran.nouveau.redemander').click();
    await ecran(p, 'ecran.oubli.titre');
    // Le nouveau mot de passe ouvre le compte. Cet appareil, SkanFact ne le connaît pas : « C'est bien toi ? », un code
    // part à l'adresse, à demi cachée à l'écran ; « Renvoyer le code » attend ses 30 secondes. Puis la porte (il n'a pas
    // encore d'entreprise).
    await p.goto(serveur.adresse);
    await champ(p, 'ecran.connexion.email').fill(email);
    await champ(p, 'ecran.connexion.mot_de_passe').fill('Une-phrase-toute-neuve');
    const envoyes = partis.length;
    await bouton(p, 'ecran.connexion.bouton').click();
    await ecran(p, 'ecran.courriel.titre_appareil');
    expect(partis.length).toBe(envoyes + 1);
    expect(partis.at(-1)?.texte).toContain('depuis un nouvel appareil');
    expect(await p.locator('.ent-entete [data-donnee]').innerText()).toBe('e•••••@exemple.tn');
    expect(await p.locator('.ent-renvoi button').innerText()).toMatch(/^Renvoyer le code dans \d+ s$/);
    expect(await p.locator('.ent-renvoi button').isDisabled()).toBe(true);
    await expect.poll(() => champ(p, 'ecran.courriel.champ_appareil').evaluate((i) => i === document.activeElement)).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'entree-bien-toi.png') });
    await champ(p, 'ecran.courriel.champ_appareil').fill(codeRecu(email));
    await bouton(p, 'ecran.courriel.bouton').click();
    await ecran(p, 'ecran.porte.titre');
    await p.context().close();
  });

  it('créer son compte : « Vérifie ton e-mail » tient au rechargement ; une adresse mal tapée se corrige, et le code part à la bonne', async () => {
    const faute = `amine.gharbi-${++n}-${Date.now()}@exmple.tn`;
    const bonne = faute.replace('@exmple.tn', '@exemple.tn');
    const p = await page();
    await p.goto(serveur.adresse);
    await bouton(p, 'ecran.connexion.creer_compte').click();
    await ecran(p, 'ecran.inscription.titre');
    await champ(p, 'ecran.connexion.email').fill(faute);
    await champ(p, 'ecran.inscription.nom').fill('Amine Gharbi');
    await champ(p, 'ecran.connexion.mot_de_passe').fill('Un-bon-mot-de-passe');
    await bouton(p, 'ecran.inscription.bouton').click();
    // L'étape 1 sur 3 : l'adresse en entier (la faute s'y voit), et le curseur dans la case du code.
    await ecran(p, 'ecran.courriel.titre_inscription');
    const adresse = p.locator('.ent-entete [data-donnee]');
    expect(await adresse.innerText()).toBe(faute);
    await expect.poll(() => champ(p, 'ecran.courriel.champ_inscription').evaluate((i) => i === document.activeElement)).toBe(true);
    const premier = codeRecu(faute);
    expect(premier).toMatch(/^\d{6}$/);
    expect(partis.at(-1)?.texte).toContain('pour vérifier ton adresse e-mail');
    // Recharger la page ne perd pas l'écran : le défi se garde dans l'onglet.
    await p.reload();
    await ecran(p, 'ecran.courriel.titre_inscription');
    expect(await adresse.innerText()).toBe(faute);
    // « Ce n'est pas ton adresse ? La corriger » : le nouveau code part à la bonne adresse, l'ancien ne vaut plus.
    await p.getByRole('button', { name: titre('ecran.courriel.corriger'), exact: true }).click();
    expect(await champ(p, 'ecran.courriel.corriger_champ').inputValue()).toBe(faute);
    await champ(p, 'ecran.courriel.corriger_champ').fill(bonne);
    await p.screenshot({ path: path.join(PHOTOS, 'entree-corriger-adresse.png') });
    await bouton(p, 'ecran.courriel.corriger_bouton').click();
    await expect.poll(() => p.locator('#toast').innerText()).toBe(phrase('ecran.courriel.corrigee'));
    expect(await adresse.innerText()).toBe(bonne);
    const second = codeRecu(bonne);
    expect(second).toMatch(/^\d{6}$/);
    await champ(p, 'ecran.courriel.champ_inscription').fill(premier === second ? '000000' : premier);
    await bouton(p, 'ecran.courriel.bouton_inscription').click();
    await expect.poll(() => p.getByRole('alert').first().innerText()).toBe(phrase('connexion.code_faux'));
    // Rechargée, la page garde l'adresse corrigée ; le bon code vérifie l'adresse, et la porte s'ouvre.
    await p.reload();
    await ecran(p, 'ecran.courriel.titre_inscription');
    expect(await adresse.innerText()).toBe(bonne);
    await champ(p, 'ecran.courriel.champ_inscription').fill(second);
    await bouton(p, 'ecran.courriel.bouton_inscription').click();
    await ecran(p, 'ecran.porte.titre');
    await expect.poll(() => p.locator('#toast').innerText()).toBe(phrase('ecran.courriel.verifiee'));
    expect((await admin.query('select email, adresse_verifiee_le is not null verifiee from socle.utilisateur where email in ($1, $2)', [faute, bonne])).rows)
      .toEqual([{ email: bonne, verifiee: true }]);
    await p.context().close();
  });

  it('créer son compte : la jauge dit pendant la frappe ce qui manque, « Afficher » montre le mot de passe', async () => {
    const p = await page();
    await p.goto(serveur.adresse);
    await bouton(p, 'ecran.connexion.creer_compte').click();
    await ecran(p, 'ecran.inscription.titre');
    const mdp = champ(p, 'ecran.connexion.mot_de_passe');
    const aide = p.locator('.ent-aide[aria-live]');
    expect(await aide.innerText()).toBe(phrase('ecran.inscription.mot_de_passe_aide', { min: LONGUEUR_MINIMALE }));
    await mdp.fill('a'.repeat(LONGUEUR_MINIMALE - 1));
    expect(await aide.innerText()).toBe(phrase('ecran.inscription.encore_un'));
    expect(await p.locator('.ent-jauge span.plein').count()).toBe(1);
    await mdp.fill('a'.repeat(LONGUEUR_MINIMALE + 4));
    expect(await aide.innerText()).toBe(phrase('ecran.inscription.assez'));
    expect(await p.locator('.ent-jauge span.plein').count()).toBe(4);
    expect(await mdp.getAttribute('type')).toBe('password');
    await p.getByRole('button', { name: titre('ecran.champ.afficher_mdp') }).click();
    expect(await mdp.getAttribute('type')).toBe('text');
    await p.getByRole('button', { name: titre('ecran.champ.cacher_mdp') }).click();
    expect(await mdp.getAttribute('type')).toBe('password');
    await p.context().close();
  });

  it('ton entreprise : la forme du matricule se dit pendant la frappe, et le haut de la facture se dessine avec ce qui est tapé', async () => {
    const { jeton } = await personne();
    const p = await page(jeton);
    await p.goto(serveur.adresse);
    await ecran(p, 'ecran.porte.titre');
    await bouton(p, 'ecran.porte.demarrer_bouton').click();
    await ecran(p, 'ecran.porte.entreprise_titre');
    const aide = p.locator('.ent-champ').filter({ has: champ(p, 'ecran.porte.matricule') }).locator('.ent-aide');
    expect(await aide.innerText()).toBe(phrase('ecran.porte.mf_ou'));
    await champ(p, 'ecran.porte.raison').fill('Gharbi Informatique SARL');
    await champ(p, 'ecran.porte.matricule').fill('1234567A');
    expect(await aide.innerText()).toBe(phrase('ecran.porte.mf_debut'));
    await champ(p, 'ecran.porte.matricule').fill('1234567O/A/M/000');
    expect(await aide.innerText()).toBe(phrase('ecran.porte.mf_faux'));
    await champ(p, 'ecran.porte.matricule').fill('1234567 a a m 000');
    expect(await aide.innerText()).toBe(phrase('ecran.porte.mf_ok'));
    expect(await p.locator('.ent-apercu-nom').innerText()).toBe(`Gharbi Informatique SARL\n${rendre(t('ecran.porte.apercu_mf'), 'fr')} : 1234567A/A/M/000`);
    await p.screenshot({ path: path.join(PHOTOS, 'entree-ton-entreprise.png') });
    await p.context().close();
  });

  it('la sécurité du comptable d\'un cabinet : son cabinet se dit ; les codes de secours se copient et se téléchargent ; l\'ouverture coche ce qui est fait', async () => {
    const { email, jeton } = await personne();
    // Le code du téléphone n'est exigé que du comptable d'un cabinet, qui voit les comptes et les salaires de ses clients
    // (0076) : son cabinet créé, il le met en place d'abord.
    await api('POST', '/cabinets', jeton, { nom: 'Cabinet Ennour' });
    const p = await page(jeton);
    // L'écran d'ouverture ne dure que le temps du chargement : un observateur note ce qu'il montre, dans l'onglet.
    await p.addInitScript(() => {
      if (location.pathname !== '/') return;
      new MutationObserver(() => {
        const o = document.querySelector('.ent-ouverture');
        if (!o?.querySelector('li')) return;
        sessionStorage.setItem('essai.ouverture', JSON.stringify({
          titre: o.querySelector('h1')?.textContent ?? '', nom: o.querySelector('.ent-ouverture-nom')?.textContent ?? '',
          lignes: [...o.querySelectorAll('li')].map((l) => l.textContent ?? ''),
        }));
      }).observe(document, { childList: true, subtree: true });
    });
    await p.goto(serveur.adresse);
    await ecran(p, 'ecran.code_requis.titre');
    expect(await p.locator('.ent-bandeau').innerText()).toBe(titre('ecran.code_requis.cabinet', { nom: 'Cabinet Ennour' }));
    await bouton(p, 'ecran.code_requis.bouton').click();
    await ecran(p, 'ecran.code_pose.titre');
    // Le téléphone scanne le code QR : l'image dessinée, relue par un lecteur de QR, dit l'adresse du compte ; la clé
    // écrite en clair est la sienne, et le lien l'ouvre dans l'application.
    const pixels = await p.getByRole('img', { name: phrase('ecran.code_pose.qr') }).evaluate(async (el) => {
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(new XMLSerializer().serializeToString(el.querySelector('svg') as SVGElement))}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 400; c.height = 400;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 400); g.drawImage(img, 0, 0, 400, 400);
      return Array.from(g.getImageData(0, 0, 400, 400).data);
    });
    const lu = jsqr.default.default(Uint8ClampedArray.from(pixels), 400, 400)?.data ?? '';
    expect(lu).toMatch(new RegExp(`^otpauth://totp/SkanFact%3A${encodeURIComponent(email).replace(/\./g, '\\.')}\\?secret=[A-Z2-7]+&issuer=SkanFact&digits=6&period=30$`));
    expect((await p.locator('.code-cle').innerText()).replace(/\s/g, '')).toBe(new URL(lu).searchParams.get('secret'));
    expect(await p.getByRole('link', { name: titre('ecran.code_pose.ouvrir') }).getAttribute('href')).toBe(lu);
    const codes = (await p.locator('.ent-secours li').allInnerTexts()).map((c) => c.trim());
    expect(codes).toHaveLength(10);
    // Copier : les dix codes, un par ligne.
    await p.locator('.ent-secours').getByRole('button', { name: titre('ecran.code_pose.copier'), exact: true }).click();
    await expect.poll(() => p.evaluate(() => navigator.clipboard.readText())).toBe(codes.join('\n'));
    // Télécharger : un fichier texte qui les porte tous.
    const [fichier] = await Promise.all([p.waitForEvent('download'), bouton(p, 'ecran.code_pose.telecharger').click()]);
    expect(fichier.suggestedFilename()).toBe('skanfact-codes-de-secours.txt');
    const contenu = fs.readFileSync(await fichier.path(), 'utf8');
    for (const c of codes) expect(contenu).toContain(c);
    // La case cochée, un code faux n'active rien : le refus le dit, sur son champ, et le compte n'a toujours pas de code.
    const cle = (await p.locator('.code-cle').innerText()).replace(/\s/g, '');
    await p.getByRole('checkbox', { name: titre('ecran.code_pose.garde') }).check();
    const juste = codeTotp(depuisBase32(cle), Date.now());
    await champ(p, 'ecran.code_pose.essai').fill(juste === '000000' ? '111111' : '000000');
    await bouton(p, 'ecran.code_pose.bouton').click();
    await expect.poll(() => p.getByRole('alert').first().innerText()).toBe(phrase('compte.code_essai_faux'));
    expect(await champ(p, 'ecran.code_pose.essai').evaluate((e) => e === document.activeElement && e.getAttribute('aria-invalid') === 'true')).toBe(true);
    expect((await api('GET', '/moi', jeton)).code_methode).toBeNull();
    // Le premier code juste : l'ouverture coche ce qui est fait le temps que l'application arrive.
    await champ(p, 'ecran.code_pose.essai').fill(codeTotp(depuisBase32(cle), Date.now()));
    await bouton(p, 'ecran.code_pose.bouton').click();
    await p.waitForURL(/\/v10\/cabinet\/\?c=[0-9a-f-]{36}/, { timeout: 15_000 });
    // Ce que l'écran d'ouverture a montré, noté par l'observateur de la page (il garde la dernière version, avant que
    // l'application ne la remplace).
    expect(JSON.parse(await p.evaluate(() => sessionStorage.getItem('essai.ouverture') ?? 'null'))).toEqual({
      titre: titre('ecran.ouverture.cabinet_titre'), nom: 'Cabinet Ennour',
      lignes: [titre('ecran.ouverture.compte'), titre('ecran.ouverture.protege'), titre('ecran.ouverture.cabinet'), titre('ecran.ouverture.charge')],
    });
    await p.context().close();
  });

  // Ce que le parcours sur app.skanfact.tn a relevé le 06/10/2026, une fois l'entrée en ligne.
  it('l\'entrée ne bouge pas sous la frappe et dit vrai : la clé se coupe entre ses groupes, le refus montre la case, rien ne se dit fait avant la vérification', async () => {
    const { jeton } = await personne();
    const p = await page(jeton);
    await p.goto(serveur.adresse);
    await ecran(p, 'ecran.porte.titre');
    await bouton(p, 'ecran.porte.demarrer_bouton').click();
    await ecran(p, 'ecran.porte.entreprise_titre');
    // L'aide du matricule change de hauteur pendant la frappe : le champ du dessus ne bouge pas pour autant.
    const haut = async () => (await champ(p, 'ecran.porte.raison').boundingBox())?.y;
    const avant = await haut();
    const aide = p.locator('.ent-champ').filter({ has: champ(p, 'ecran.porte.matricule') }).locator('.ent-aide');
    const hauteurs = [(await aide.boundingBox())?.height];
    await champ(p, 'ecran.porte.raison').fill('Gharbi Informatique SARL');
    await champ(p, 'ecran.porte.matricule').fill('1234567A');
    hauteurs.push((await aide.boundingBox())?.height);
    expect(await haut()).toBe(avant);
    await champ(p, 'ecran.porte.matricule').fill('1234567A/A/M/000');
    hauteurs.push((await aide.boundingBox())?.height);
    expect(await haut()).toBe(avant);
    // L'instrument a mesuré : l'aide a bien changé de hauteur.
    expect(new Set(hauteurs).size).toBeGreaterThan(1);
    // Au téléphone, le haut de la facture passe sous le formulaire : la phrase ne dit pas qu'il est « à côté ».
    await p.setViewportSize({ width: 390, height: 844 });
    const form = await p.locator('.ent-deux > form').boundingBox();
    const apercu = await p.locator('.ent-apercu').boundingBox();
    expect((apercu?.y ?? 0) >= (form?.y ?? 0) + (form?.height ?? 0)).toBe(true);
    expect(await p.locator('.ent-titre-page p').innerText()).not.toMatch(/à côté/);
    await p.setViewportSize({ width: 1440, height: 900 });
    // L'écran du code, que seul le comptable d'un cabinet met en place d'abord (0076).
    await api('POST', '/cabinets', jeton, { nom: 'Cabinet Gharbi' });
    await p.goto(serveur.adresse);
    await ecran(p, 'ecran.code_requis.titre');
    await bouton(p, 'ecran.code_requis.bouton').click();
    await ecran(p, 'ecran.code_pose.titre');
    // La clé à taper à la main tient sur plusieurs lignes, mais aucun groupe de quatre ne se coupe.
    const cle = await p.locator('.code-cle').evaluate((el) => {
      const texte = el.firstChild as Text;
      const lignes = (r: Range) => new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
      const tout = document.createRange(); tout.selectNodeContents(el);
      let i = 0;
      const groupes = (texte.textContent ?? '').split(' ').map((g) => {
        const r = document.createRange(); r.setStart(texte, i); r.setEnd(texte, i + g.length); i += g.length + 1; return lignes(r);
      });
      return { lignes: lignes(tout), groupes };
    });
    expect(cle.lignes).toBeGreaterThan(1);
    expect(cle.groupes.every((n) => n === 1)).toBe(true);
    // « Vérifier » sans la case cochée : le refus montre la case (sa bordure change) et y met le curseur.
    const caseGarde = p.locator('.ent-secours label.check');
    const bord = () => caseGarde.evaluate((e) => getComputedStyle(e).borderTopColor);
    const bordAvant = await bord();
    await champ(p, 'ecran.code_pose.essai').fill('123456');
    const verifier = bouton(p, 'ecran.code_pose.bouton');
    await verifier.click();
    expect(await p.evaluate(() => document.activeElement?.getAttribute('type'))).toBe('checkbox');
    expect(await bord()).not.toBe(bordAvant);
    // Cocher ne déplace pas le bouton, et rien ne dit le code en place tant qu'il n'est pas vérifié.
    const place = await verifier.boundingBox();
    await p.getByRole('checkbox', { name: titre('ecran.code_pose.garde') }).check();
    expect(await verifier.boundingBox()).toEqual(place);
    expect(await p.locator('.ent-pose-pied .ent-aide').innerText()).not.toMatch(/parfait|sera demandé/i);
    await p.context().close();
  });

  // Le code n'est exigé que du comptable d'un cabinet (0076) : la propriétaire d'une entreprise qui crée ensuite son
  // cabinet n'ouvre plus rien sans lui (le serveur refuse tout, sauf de le mettre en place) ; la page de son entreprise
  // comme celle de son cabinet la renvoient à l'écran du code, au lieu de dire une erreur.
  it('devenue comptable d\'un cabinet sans code : la page de son entreprise, puis celle du cabinet, la renvoient à l\'écran du code', async () => {
    const { jeton } = await personne();
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Librairie Ennour' })).id);
    const p = await page(jeton);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    const cabinet = String((await api('POST', '/cabinets', jeton, { nom: 'Cabinet Ennour' })).id);
    // La page de son entreprise, rouverte dans un onglet neuf : l'ancien part de lui-même vers l'écran du code à son
    // prochain appel au serveur, et le recharger pouvait tomber au milieu (« net::ERR_ABORTED », vu sur GitHub le
    // 09/10/2026). La page s'en va avant d'avoir fini de se charger : on attend qu'elle soit partie (« commit »), puis
    // l'écran où elle arrive.
    const cx = p.context();
    await p.close();
    const q = await cx.newPage();
    await q.addInitScript((j) => sessionStorage.setItem('skanfact.jeton', j), jeton);
    await q.goto(`${serveur.adresse}/v10/?e=${ent}`, { waitUntil: 'commit' });
    await ecran(q, 'ecran.code_requis.titre');
    expect(new URL(q.url()).pathname).toBe('/');
    expect(await q.locator('.ent-bandeau').innerText()).toBe(titre('ecran.code_requis.cabinet', { nom: 'Cabinet Ennour' }));
    await q.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}`, { waitUntil: 'commit' });
    await ecran(q, 'ecran.code_requis.titre');
    expect(new URL(q.url()).pathname).toBe('/');
    await cx.close();
  });
});
