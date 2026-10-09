// Ton compte, à la souris (lot onboarding, 09/10/2026 ; maquettes validées par Skander ; migration 0076, docs/entree.md) :
// le premier onglet des Paramètres de l'entreprise et des Réglages du Cabinet. Ce que le parcours vérifie, écran ET
// serveur :
//   - l'adresse change par un code reçu à la nouvelle (le mot de passe actuel d'abord), et l'ancienne est prévenue ;
//   - le mot de passe change par l'actuel ; chaque refus se dit sous les boutons, et sa case se marque ;
//   - le code du téléphone : de nouveaux codes de secours, puis le désactiver, chaque fois par le code du moment ; un
//     e-mail confirme la désactivation ;
//   - au Cabinet, le code est exigé : il ne se désactive pas ; changer de téléphone demande le code actuel, et le
//     nouveau ne remplace l'ancien qu'à son premier code juste.
// L'activation (le code QR relu) est jouée par le parcours : tests/web/parcours.test.ts.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { motif, rendre } from '../../textes/index.ts';
import type { Courriel } from '../../serveur/courriel.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const phrase = (cle: string, v: Record<string, string | number> = {}) => rendre(motif(cle, v), 'fr');

describe('ton compte, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const partis: Courriel[] = [];
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-compte-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 },
      { courriel: { envoyer: async (m) => { partis.push(m); } } });
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
  // Le dernier code parti à cette adresse, lu dans l'objet de l'e-mail (« Ton code SkanFact : 482913 »).
  const codeRecu = (email: string) => /(\d{6})$/.exec(partis.filter((m) => m.a === email).at(-1)?.objet ?? '')?.[1] ?? '';
  // Une personne inscrite ; ce serveur envoie des e-mails : son adresse se vérifie par le code reçu.
  async function personne(nom: string) {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const defi = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.defi);
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi, code: codeRecu(email) })).corps.jeton);
    return { email, jeton };
  }
  // Les Paramètres (ou les Réglages du Cabinet), l'onglet Ton compte ; sans adresse, la page rechargée (une même adresse
  // ne recharge rien).
  async function ouvrirCompte(p: Page, adresse?: string) {
    if (adresse) await p.goto(`${serveur.adresse}${adresse}`); else await p.reload();
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await p.getByRole('tab', { name: 'Ton compte', exact: true }).click();
  }
  async function page(jeton: string) {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    return { p, erreurs };
  }
  // Dans la fenêtre ouverte : un champ par son libellé, un bouton par ce qu'il dit, le refus sous les boutons.
  const fenetre = (p: Page) => p.locator('#modal-root');
  const champ = (p: Page, libelle: string) => fenetre(p).locator('label.field').filter({ hasText: libelle }).locator('input');
  const bouton = (p: Page, nom: string) => fenetre(p).getByRole('button', { name: nom, exact: true });
  const refus = (p: Page) => fenetre(p).getByRole('alert');
  const aLeCurseur = (l: Locator) => l.evaluate((e) => e === document.activeElement && e.getAttribute('aria-invalid') === 'true');
  const faux = (bon: string) => (bon === '000000' ? '111111' : '000000');

  it('l\'entreprise : l\'adresse change par un code reçu à la nouvelle ; le mot de passe par l\'actuel ; de nouveaux codes de secours, puis le code désactivé, par le code du moment', async () => {
    const { email, jeton } = await personne('nadia');
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Librairie Ennour' })).corps.id);
    const { p, erreurs } = await page(jeton);
    await ouvrirCompte(p, `/v10/?e=${ent}#/parametres`);
    // Les cartes : l'adresse vérifiée, le code recommandé (pas activé), un nouvel appareil vérifié par e-mail.
    await expect.poll(() => p.locator('#cpt-email').innerText(), { timeout: 15_000 }).toBe(email);
    expect(await p.locator('.cpt-carte').filter({ has: p.locator('#cpt-email') }).innerText()).toContain('Vérifiée');
    expect(await p.locator('#cpt-etat').innerText()).toBe('Désactivé');
    expect(await p.locator('#cpt-code').getAttribute('class')).toContain('cpt-recommande');
    expect(await p.locator('#cpt-code').getByRole('button', { name: 'Activer le code', exact: true }).count()).toBe(1);
    expect(await p.locator('.cpt-discret').innerText()).toContain('Un nouvel appareil se vérifie par e-mail');
    await p.screenshot({ path: path.join(PHOTOS, 'compte-1-entreprise.png') });

    // Changer d'adresse : un mot de passe faux est refusé sur sa case ; puis un code part à la nouvelle adresse, et
    // rien ne change avant qu'il soit tapé.
    const nouvelle = email.replace('@exemple.tn', '@exemple.com.tn');
    await p.getByRole('button', { name: 'Changer d\'adresse…', exact: true }).click();
    await champ(p, 'Ta nouvelle adresse e-mail').fill(nouvelle);
    await champ(p, 'Ton mot de passe actuel').fill('pas-le-bon-mot');
    await bouton(p, 'Envoyer le code').click();
    await expect.poll(() => refus(p).innerText()).toBe(phrase('compte.mot_de_passe_actuel_faux'));
    expect(await aLeCurseur(champ(p, 'Ton mot de passe actuel'))).toBe(true);
    await champ(p, 'Ton mot de passe actuel').fill('Un-bon-mot-de-passe');
    await bouton(p, 'Envoyer le code').click();
    await expect.poll(() => fenetre(p).innerText()).toContain(`On vient d'envoyer un code à ${nouvelle}.`);
    const code = codeRecu(nouvelle);
    expect(code).toMatch(/^\d{6}$/);
    expect((await api('GET', '/moi', jeton)).corps.email).toBe(email);
    await champ(p, 'Le code reçu à cette adresse').fill(faux(code));
    await bouton(p, 'Confirmer la nouvelle adresse').click();
    await expect.poll(() => refus(p).innerText()).toBe(phrase('connexion.code_faux'));
    expect(await aLeCurseur(champ(p, 'Le code reçu à cette adresse'))).toBe(true);
    await champ(p, 'Le code reçu à cette adresse').fill(code);
    await bouton(p, 'Confirmer la nouvelle adresse').click();
    await expect.poll(() => p.locator('#toast').innerText()).toBe(`Adresse changée : un e-mail a prévenu ${email}.`);
    await expect.poll(() => p.locator('#cpt-email').innerText()).toBe(nouvelle);
    expect((await api('GET', '/moi', jeton)).corps.email).toBe(nouvelle);
    expect(partis.filter((m) => m.a === email).at(-1)?.objet).toBe('L\'adresse de ton compte SkanFact a changé');

    // Changer le mot de passe : l'actuel faux, puis un nouveau trop court, chacun refusé sur sa case ; puis c'est fait,
    // et cette session reste ouverte.
    await p.getByRole('button', { name: 'Changer le mot de passe…', exact: true }).click();
    await champ(p, 'Ton mot de passe actuel').fill('pas-le-bon-mot');
    await champ(p, 'Le nouveau').fill('Une-phrase-toute-neuve');
    await bouton(p, 'Changer le mot de passe').click();
    await expect.poll(() => refus(p).innerText()).toBe(phrase('compte.mot_de_passe_actuel_faux'));
    expect(await aLeCurseur(champ(p, 'Ton mot de passe actuel'))).toBe(true);
    await champ(p, 'Ton mot de passe actuel').fill('Un-bon-mot-de-passe');
    await champ(p, 'Le nouveau').fill('court');
    await bouton(p, 'Changer le mot de passe').click();
    await expect.poll(() => aLeCurseur(champ(p, 'Le nouveau'))).toBe(true);
    await champ(p, 'Le nouveau').fill('Une-phrase-toute-neuve');
    await bouton(p, 'Changer le mot de passe').click();
    await expect.poll(() => p.locator('#toast').innerText()).toBe('Mot de passe changé : tes autres sessions sont fermées.');
    expect((await api('GET', '/moi', jeton)).statut).toBe(200);
    expect((await api('POST', '/connexion', undefined, { email: nouvelle, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Autre', type: 'navigateur' } })).corps.etat).toBe('refuse');
    expect((await api('POST', '/connexion', undefined, { email: nouvelle, motDePasse: 'Une-phrase-toute-neuve', appareil: { nom: 'Autre', type: 'navigateur' } })).corps.etat).toBe('code');

    // Le code activé (d'un coup, par l'API : l'activation à l'écran est au parcours) : la carte le dit, avec ses codes.
    const secret = String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.cle);
    await ouvrirCompte(p);
    await expect.poll(() => p.locator('#cpt-etat').innerText(), { timeout: 15_000 }).toBe('Activé');
    expect(await p.locator('#cpt-restants').innerText()).toBe('10 codes de secours');
    expect(await p.locator('#cpt-code').getAttribute('class')).not.toContain('cpt-recommande');
    expect(await p.locator('.cpt-discret').innerText()).toContain('Un nouvel appareil demande le code du téléphone');

    // De nouveaux codes de secours : le code du moment d'abord ; les dix nouveaux se montrent une fois.
    await p.getByRole('button', { name: 'Nouveaux codes de secours…', exact: true }).click();
    const actuel = champ(p, 'Le code de ton application, ou un code de secours');
    await actuel.fill(faux(codeTotp(depuisBase32(secret), Date.now())));
    await bouton(p, 'Créer de nouveaux codes').click();
    await expect.poll(() => refus(p).innerText()).toBe(phrase('connexion.code_faux'));
    expect(await aLeCurseur(actuel)).toBe(true);
    await actuel.fill(codeTotp(depuisBase32(secret), Date.now()));
    await bouton(p, 'Créer de nouveaux codes').click();
    await expect.poll(() => fenetre(p).locator('.cpt-secours li').count()).toBe(10);
    const secours = (await fenetre(p).locator('.cpt-secours li').allInnerTexts()).map((c) => c.trim());
    await bouton(p, 'Je les ai mis de côté').click();
    await expect.poll(() => fenetre(p).locator('.cpt-secours').count()).toBe(0);
    expect(await p.locator('#cpt-restants').innerText()).toBe('10 codes de secours');

    // Désactiver : demandé, le code du moment d'abord (un faux est refusé) ; un e-mail le confirme.
    await p.getByRole('button', { name: 'Désactiver…', exact: true }).click();
    const garder = bouton(p, 'Garder le code');
    expect(await garder.getAttribute('class')).toContain('btn-primary');
    await champ(p, 'Le code de ton application, ou un code de secours').fill(faux(codeTotp(depuisBase32(secret), Date.now())));
    await bouton(p, 'Désactiver').click();
    await expect.poll(() => refus(p).innerText()).toBe(phrase('connexion.code_faux'));
    expect((await api('GET', '/moi', jeton)).corps.code_methode).toBe('application');
    // Un des nouveaux codes de secours le remplace.
    await champ(p, 'Le code de ton application, ou un code de secours').fill(secours[0] ?? '');
    await bouton(p, 'Désactiver').click();
    await expect.poll(() => fenetre(p).locator('h2').innerText()).toBe('Le code du téléphone est désactivé');
    expect(await fenetre(p).innerText()).toContain(`Un e-mail de confirmation est parti à ${nouvelle}.`);
    expect(partis.filter((m) => m.a === nouvelle).at(-1)?.objet).toBe('Le code du téléphone a été désactivé');
    await p.screenshot({ path: path.join(PHOTOS, 'compte-2-desactive.png') });
    await bouton(p, 'Revenir aux paramètres').click();
    await expect.poll(() => p.locator('#cpt-etat').innerText()).toBe('Désactivé');
    expect((await api('GET', '/moi', jeton)).corps.code_methode).toBeNull();
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 120_000);

  it('le Cabinet : le code est exigé et ne se désactive pas ; changer de téléphone demande le code actuel, et le nouveau ne vaut qu\'à son premier code', async () => {
    const { email, jeton } = await personne('karim');
    const cabinet = String((await api('POST', '/cabinets', jeton, { nom: 'Cabinet Ben Salah' })).corps.id);
    const ancien = String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.cle);
    const secretEnBase = async () => (await admin.query('select code_secret from socle.utilisateur where email = $1', [email])).rows[0]?.code_secret as string;
    const { p, erreurs } = await page(jeton);
    await ouvrirCompte(p, `/v10/cabinet/?c=${cabinet}#/reglages`);
    await expect.poll(() => p.locator('#cpt-etat').innerText(), { timeout: 15_000 }).toBe('Exigé');
    expect(await p.locator('#cpt-code').innerText()).toContain('Il est exigé de chaque comptable d\'un cabinet');
    expect(await p.getByRole('button', { name: 'Désactiver…' }).count()).toBe(0);
    expect(await p.locator('#cpt-restants').innerText()).toBe('10 codes de secours');
    // Tes appareils, dans le même onglet.
    await expect.poll(() => p.locator('#appareils-liste').innerText()).toContain('cet appareil');
    await p.screenshot({ path: path.join(PHOTOS, 'compte-3-cabinet.png') });

    // Changer de téléphone : le code actuel d'abord (un faux est refusé, sur sa case).
    await p.getByRole('button', { name: 'Changer de téléphone…', exact: true }).click();
    const actuel = champ(p, 'Le code de ton téléphone actuel, ou un code de secours');
    await actuel.fill(faux(codeTotp(depuisBase32(ancien), Date.now())));
    await bouton(p, 'Continuer').click();
    await expect.poll(() => refus(p).innerText()).toBe(phrase('connexion.code_faux'));
    expect(await aLeCurseur(actuel)).toBe(true);
    await actuel.fill(codeTotp(depuisBase32(ancien), Date.now()));
    await bouton(p, 'Continuer').click();
    // La clé du nouveau téléphone ; l'ancien vaut toujours tant que le nouveau n'a pas donné son premier code.
    const cle = fenetre(p).locator('.cpt-cle code');
    await cle.waitFor({ timeout: 10_000 });
    const nouveau = (await cle.innerText()).replace(/\s/g, '');
    expect(nouveau).toMatch(/^[A-Z2-7]{16,}$/);
    expect(nouveau).not.toBe(ancien);
    expect(await secretEnBase()).toBe(ancien);
    await fenetre(p).getByRole('checkbox', { name: 'Je les ai mis de côté' }).check();
    const premier = champ(p, 'Le code de SkanFact dans l\'application');
    // Le code de l'ancien téléphone ne prouve pas le nouveau.
    await premier.fill(codeTotp(depuisBase32(ancien), Date.now()));
    await bouton(p, 'Vérifier et activer').click();
    await expect.poll(() => refus(p).innerText()).toBe(phrase('compte.code_essai_faux'));
    expect(await secretEnBase()).toBe(ancien);
    await premier.fill(codeTotp(depuisBase32(nouveau), Date.now()));
    await bouton(p, 'Vérifier et activer').click();
    await expect.poll(() => p.locator('#toast').innerText()).toBe('C\'est fait : SkanFact demandera le code de ton nouveau téléphone.');
    expect(await secretEnBase()).toBe(nouveau);
    await expect.poll(() => p.locator('#cpt-etat').innerText()).toBe('Exigé');
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 120_000);
});
