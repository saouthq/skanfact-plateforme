// Ton compte, à la souris (lot onboarding, 09/10/2026 ; maquettes validées par Skander ; migration 0076, docs/entree.md) :
// le premier onglet des Paramètres de l'entreprise et des Réglages du Cabinet. Ce que le parcours vérifie, écran ET
// serveur :
//   - l'adresse change par un code reçu à la nouvelle (le mot de passe actuel d'abord), et l'ancienne est prévenue ;
//   - le mot de passe change par l'actuel ; chaque refus se dit sous les boutons, et sa case se marque ;
//   - le code de connexion au choix (0081) : l'e-mail par défaut ; une application, puis de nouveaux codes de secours et
//     le retour à l'e-mail, chaque fois par le code du moment (un e-mail confirme le retour) ;
//   - le SMS : le numéro, le code reçu, les codes de secours ; changer de numéro par un code de preuve reçu par SMS ;
//   - au Cabinet, avec un relais d'e-mails, le comptable revient à l'e-mail s'il le veut ; changer de téléphone demande
//     le code actuel, et le nouveau ne remplace l'ancien qu'à son premier code juste.
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
  // Le même, sans relais d'e-mails : le code y est encore exigé du comptable d'un cabinet (0076, 0081).
  let sansCourriel: Awaited<ReturnType<typeof demarrer>>;
  const partis: Courriel[] = [];
  // Ce qui partirait chez le fournisseur de SMS : le numéro et le texte.
  const sms: { telephone: string; texte: string }[] = [];
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-compte-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 },
      { courriel: { envoyer: async (m) => { partis.push(m); } }, sms: { envoyer: async (telephone, texte) => { sms.push({ telephone, texte }); } } });
    sansCourriel = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await sansCourriel?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

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
  async function ouvrirCompte(p: Page, adresse?: string, base = serveur.adresse) {
    if (adresse) await p.goto(`${base}${adresse}`); else await p.reload();
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
    // Les cartes : l'adresse vérifiée, le code par e-mail (le choix par défaut : rien à activer), le SMS et l'application
    // proposés, un nouvel appareil vérifié par e-mail.
    await expect.poll(() => p.locator('#cpt-email').innerText(), { timeout: 15_000 }).toBe(email);
    expect(await p.locator('.cpt-carte').filter({ has: p.locator('#cpt-email') }).innerText()).toContain('Vérifiée');
    expect(await p.locator('#cpt-etat').innerText()).toBe('Par e-mail');
    expect(await p.locator('#cpt-code').getAttribute('class')).not.toContain('cpt-recommande');
    expect(await p.locator('.cpt-option.cpt-choisi').getAttribute('data-methode')).toBe('courriel');
    expect(await p.locator('#cpt-code').getByRole('button', { name: 'Recevoir par SMS…', exact: true }).count()).toBe(1);
    expect(await p.locator('#cpt-code').getByRole('button', { name: 'Utiliser une application…', exact: true }).count()).toBe(1);
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
    await expect.poll(() => p.locator('#cpt-etat').innerText(), { timeout: 15_000 }).toBe('Par application');
    expect(await p.locator('#cpt-restants').innerText()).toBe('10 codes de secours');
    expect(await p.locator('.cpt-option.cpt-choisi').getAttribute('data-methode')).toBe('application');
    expect(await p.locator('.cpt-discret').innerText()).toContain('Un nouvel appareil demande le code de ton application');

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

    // Revenir à l'e-mail : demandé, le code du moment d'abord (un faux est refusé) ; un e-mail le confirme.
    await p.getByRole('button', { name: 'Revenir à l\'e-mail…', exact: true }).click();
    const garder = bouton(p, 'Garder l\'application');
    expect(await garder.getAttribute('class')).toContain('btn-primary');
    await champ(p, 'Le code de ton application, ou un code de secours').fill(faux(codeTotp(depuisBase32(secret), Date.now())));
    await bouton(p, 'Revenir à l\'e-mail').click();
    await expect.poll(() => refus(p).innerText()).toBe(phrase('connexion.code_faux'));
    expect((await api('GET', '/moi', jeton)).corps.code_methode).toBe('application');
    // Un des nouveaux codes de secours le remplace.
    await champ(p, 'Le code de ton application, ou un code de secours').fill(secours[0] ?? '');
    await bouton(p, 'Revenir à l\'e-mail').click();
    await expect.poll(() => fenetre(p).locator('h2').innerText()).toBe('Ton code arrive désormais par e-mail');
    expect(await fenetre(p).innerText()).toContain(`Un e-mail de confirmation est parti à ${nouvelle}.`);
    expect(partis.filter((m) => m.a === nouvelle).at(-1)?.objet).toBe('Ton code de connexion arrive désormais par e-mail');
    await p.screenshot({ path: path.join(PHOTOS, 'compte-2-desactive.png') });
    await bouton(p, 'Revenir aux paramètres').click();
    await expect.poll(() => p.locator('#cpt-etat').innerText()).toBe('Par e-mail');
    expect((await api('GET', '/moi', jeton)).corps.code_methode).toBeNull();
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 120_000);

  // Qui a le code du téléphone ne reçoit jamais de code par e-mail à la connexion : la carte disait « elle se vérifie à ta
  // prochaine connexion », et c'était faux (0077).
  it('une adresse qu\'aucune connexion ne vérifie (le code du téléphone actif) se vérifie ici, par un code reçu à cette adresse', async () => {
    const { email, jeton } = await personne('sami');
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Quincaillerie Sami' })).corps.id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    // Un compte d'avant le relais d'e-mails : son adresse n'a jamais été prouvée.
    await admin.query('update socle.utilisateur set adresse_verifiee_le = null where email = $1', [email]);
    const { p, erreurs } = await page(jeton);
    await ouvrirCompte(p, `/v10/?e=${ent}#/parametres`);
    const carte = p.locator('.cpt-carte').filter({ has: p.locator('#cpt-email') });
    await expect.poll(() => carte.innerText(), { timeout: 15_000 }).toContain('À vérifier');
    expect(await carte.innerText()).not.toContain('prochaine connexion');
    await carte.getByRole('button', { name: 'Vérifier mon adresse', exact: true }).click();
    expect(await fenetre(p).innerText()).toContain(`Un code va partir à ${email}.`);
    await bouton(p, 'Envoyer le code').click();
    await expect.poll(() => fenetre(p).innerText()).toContain(`On vient d'envoyer un code à ${email}.`);
    const code = codeRecu(email);
    expect(partis.filter((m) => m.a === email).at(-1)?.texte).toContain('vérifier ton adresse e-mail');
    await champ(p, 'Le code reçu à cette adresse').fill(faux(code));
    await bouton(p, 'Vérifier mon adresse').click();
    await expect.poll(() => refus(p).innerText()).toBe(phrase('connexion.code_faux'));
    expect(await aLeCurseur(champ(p, 'Le code reçu à cette adresse'))).toBe(true);
    await champ(p, 'Le code reçu à cette adresse').fill(code);
    await bouton(p, 'Vérifier mon adresse').click();
    await expect.poll(() => p.locator('#toast').innerText()).toBe('Adresse vérifiée.');
    await expect.poll(() => carte.innerText()).toContain('Vérifiée');
    expect(await carte.getByRole('button', { name: 'Vérifier mon adresse' }).count()).toBe(0);
    expect(((await api('GET', '/moi', jeton)).corps.compte as { adresseVerifiee: boolean }).adresseVerifiee).toBe(true);
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 120_000);

  it('le Cabinet : avec un relais d\'e-mails, le comptable peut revenir à l\'e-mail ; changer de téléphone demande le code actuel, et le nouveau ne vaut qu\'à son premier code', async () => {
    const { email, jeton } = await personne('karim');
    const cabinet = String((await api('POST', '/cabinets', jeton, { nom: 'Cabinet Ben Salah' })).corps.id);
    const ancien = String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.cle);
    const secretEnBase = async () => (await admin.query('select code_secret from socle.utilisateur where email = $1', [email])).rows[0]?.code_secret as string;
    const { p, erreurs } = await page(jeton);
    await ouvrirCompte(p, `/v10/cabinet/?c=${cabinet}#/reglages`);
    await expect.poll(() => p.locator('#cpt-etat').innerText(), { timeout: 15_000 }).toBe('Par application');
    expect(((await api('GET', '/moi', jeton)).corps.compte as { codeExige: boolean; comptable: boolean })).toMatchObject({ codeExige: false, comptable: true });
    expect(await p.getByRole('button', { name: 'Revenir à l\'e-mail…' }).count()).toBe(1);
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
    await expect.poll(() => p.locator('#cpt-etat').innerText()).toBe('Par application');

    // Le même compte sur un serveur sans relais d'e-mails : le code y est exigé du comptable d'un cabinet (0076), et
    // rien ne propose de le retirer ; la ligne de l'e-mail dit ce qui est exigé.
    await ouvrirCompte(p, `/v10/cabinet/?c=${cabinet}#/reglages`, sansCourriel.adresse);
    await expect.poll(() => p.locator('#cpt-etat').innerText(), { timeout: 15_000 }).toBe('Par application');
    expect(await p.locator('.cpt-option[data-methode=courriel]').innerText()).toContain('Exigé : SMS ou application');
    expect(await p.getByRole('button', { name: 'Désactiver le code…' }).count()).toBe(0);
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 120_000);

  // Le code par SMS (0081) : un numéro mal tapé se refuse sur sa case, sans rien envoyer ; un code part au mobile donné,
  // et rien ne change avant qu'il soit tapé ; puis les codes de secours. Changer de numéro se prouve par un code reçu
  // à l'ancien ; revenir à l'e-mail aussi. Ce qui part chez le fournisseur : le numéro et le code, rien d'autre.
  it('le SMS à la souris : le numéro, le code reçu, les codes de secours ; changer de numéro, puis revenir à l\'e-mail, par un code reçu par SMS', async () => {
    const { email, jeton } = await personne('lina');
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Atelier Lina' })).corps.id);
    const { p, erreurs } = await page(jeton);
    await ouvrirCompte(p, `/v10/?e=${ent}#/parametres`);
    await expect.poll(() => p.locator('#cpt-etat').innerText(), { timeout: 15_000 }).toBe('Par e-mail');
    // La page pose des espaces insécables devant « : » (la typographie de l'app) : on compare à plat.
    const plat = (t: string) => t.replace(/[\u00a0\u202f]/g, ' ');
    const refusDit = async () => plat(await refus(p).innerText());
    const dernierSms = () => sms.at(-1);
    const codeSms = () => (/(\d{3}) (\d{3})$/.exec(dernierSms()?.texte ?? '') ?? []).slice(1, 3).join('');

    // Un fixe n'est pas un mobile : refusé sur sa case, et rien ne part.
    await p.getByRole('button', { name: 'Recevoir par SMS…', exact: true }).click();
    const avant = sms.length;
    await champ(p, 'Ton numéro de mobile').fill('71 123 456');
    await bouton(p, 'Envoyer le code').click();
    await expect.poll(refusDit).toBe(plat(phrase('compte.telephone_invalide')));
    expect(await aLeCurseur(champ(p, 'Ton numéro de mobile'))).toBe(true);
    expect(sms.length).toBe(avant);

    // Un mobile : le code part, le numéro se montre masqué ; rien ne change avant le code.
    await champ(p, 'Ton numéro de mobile').fill('22 123 456');
    await bouton(p, 'Envoyer le code').click();
    await expect.poll(() => fenetre(p).innerText()).toContain('On vient d\'envoyer un code par SMS au +216 \u2022\u2022 \u2022\u2022\u2022 456.');
    expect(dernierSms()?.telephone).toBe('+21622123456');
    expect(dernierSms()?.texte).toMatch(/^Ton code SkanFact : \d{3} \d{3}$/);
    expect((await api('GET', '/moi', jeton)).corps.code_methode).toBeNull();
    await p.screenshot({ path: path.join(PHOTOS, 'compte-5-sms-fenetre.png') });
    const recu = codeSms();
    await champ(p, 'Le code reçu par SMS').fill(faux(recu));
    await bouton(p, 'Vérifier et activer').click();
    await expect.poll(refusDit).toBe(plat(phrase('compte.sms_essai_faux')));
    expect(await aLeCurseur(champ(p, 'Le code reçu par SMS'))).toBe(true);
    await champ(p, 'Le code reçu par SMS').fill(recu);
    await bouton(p, 'Vérifier et activer').click();
    await expect.poll(() => fenetre(p).locator('.cpt-secours li').count()).toBe(10);
    // La carte, derrière la fenêtre, dit déjà le SMS.
    await expect.poll(() => p.locator('#cpt-etat').innerText()).toBe('Par SMS');
    expect((await api('GET', '/moi', jeton)).corps.code_methode).toBe('sms');
    await bouton(p, 'Je les ai mis de côté').click();
    await expect.poll(() => p.locator('#toast').innerText()).toBe('C\'est fait : ton code arrivera par SMS sur chaque nouvel appareil.');
    expect(await p.locator('#cpt-telephone').innerText()).toBe('+216 \u2022\u2022 \u2022\u2022\u2022 456');
    expect(await p.locator('.cpt-option.cpt-choisi').getAttribute('data-methode')).toBe('sms');
    expect(await p.locator('.cpt-discret').innerText()).toContain('Un nouvel appareil demande le code reçu par SMS');
    await p.screenshot({ path: path.join(PHOTOS, 'compte-4-sms.png') });
    // Au téléphone : la carte se lit sans défiler de côté, chaque geste sous sa ligne.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.locator('#cpt-code').screenshot({ path: path.join(PHOTOS, 'compte-6-sms-telephone.png') });
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await p.setViewportSize({ width: 1440, height: 900 });

    // Changer de numéro : sans preuve, le refus nomme le bouton qui en envoie une ; puis la preuve reçue à l'ancien numéro.
    await p.getByRole('button', { name: 'Changer de numéro…', exact: true }).click();
    const preuve = champ(p, 'Le code reçu par SMS, ou un code de secours');
    await champ(p, 'Ton numéro de mobile').fill('50 000 789');
    await bouton(p, 'Envoyer le code').click();
    await expect.poll(refusDit).toBe(plat(phrase('compte.preuve_sms_manque')));
    expect(await aLeCurseur(preuve)).toBe(true);
    await bouton(p, 'M\'envoyer un code par SMS').click();
    await expect.poll(async () => plat(await fenetre(p).locator('#cpt-preuve-dit').innerText())).toBe('Code envoyé au +216 \u2022\u2022 \u2022\u2022\u2022 456 : il vaut 10 minutes, une fois.');
    expect(dernierSms()?.telephone).toBe('+21622123456');
    await preuve.fill(codeSms());
    await bouton(p, 'Envoyer le code').click();
    await expect.poll(() => fenetre(p).innerText()).toContain('On vient d\'envoyer un code par SMS au +216 \u2022\u2022 \u2022\u2022\u2022 789.');
    expect(dernierSms()?.telephone).toBe('+21650000789');
    // L'ancien numéro reste celui du compte tant que le nouveau n'a pas donné son code.
    expect((await admin.query('select telephone from socle.utilisateur where email = $1', [email])).rows[0]?.telephone).toBe('+21622123456');
    await champ(p, 'Le code reçu par SMS').fill(codeSms());
    await bouton(p, 'Vérifier et activer').click();
    await expect.poll(() => fenetre(p).locator('.cpt-secours li').count()).toBe(10);
    await bouton(p, 'Je les ai mis de côté').click();
    await expect.poll(() => p.locator('#toast').innerText()).toBe('C\'est fait : ton code arrivera à ton nouveau numéro.');
    await expect.poll(() => p.locator('#cpt-telephone').innerText()).toBe('+216 \u2022\u2022 \u2022\u2022\u2022 789');
    expect((await admin.query('select telephone from socle.utilisateur where email = $1', [email])).rows[0]?.telephone).toBe('+21650000789');

    // Revenir à l'e-mail : la preuve par SMS, au nouveau numéro ; un e-mail le confirme.
    await p.getByRole('button', { name: 'Revenir à l\'e-mail…', exact: true }).click();
    expect(await bouton(p, 'Garder le SMS').getAttribute('class')).toContain('btn-primary');
    await bouton(p, 'M\'envoyer un code par SMS').click();
    await expect.poll(() => fenetre(p).locator('#cpt-preuve-dit').innerText()).toContain('+216 \u2022\u2022 \u2022\u2022\u2022 789');
    expect(dernierSms()?.telephone).toBe('+21650000789');
    await champ(p, 'Le code reçu par SMS, ou un code de secours').fill(codeSms());
    await bouton(p, 'Revenir à l\'e-mail').click();
    await expect.poll(() => fenetre(p).locator('h2').innerText()).toBe('Ton code arrive désormais par e-mail');
    expect(partis.filter((m) => m.a === email).at(-1)?.objet).toBe('Ton code de connexion arrive désormais par e-mail');
    await bouton(p, 'Revenir aux paramètres').click();
    await expect.poll(() => p.locator('#cpt-etat').innerText()).toBe('Par e-mail');
    expect((await api('GET', '/moi', jeton)).corps.code_methode).toBeNull();
    // Rien d'autre que le numéro et le code n'est parti chez le fournisseur.
    for (const m of sms) expect(m.texte).toMatch(/^Ton code SkanFact : \d{3} \d{3}$/);
    expect(erreurs).toEqual([]);
    await p.context().close();
  }, 120_000);
});
