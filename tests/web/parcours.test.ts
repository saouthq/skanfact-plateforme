// Le parcours joué comme une personne (règle du projet : rien ne s'annonce avant d'avoir été refait à
// la souris et vu à l'écran), de bout en bout : créer son compte (un mot de passe trop court se
// refuse sur son champ) et s'y retrouver connecté, commencer avec son entreprise sur la porte (la découverte
// sur l'exemple a son parcours : tests/web/exemple.test.ts), qui s'ouvre sans exiger le code du téléphone (facultatif
// depuis le 09/10/2026, sauf pour un comptable de cabinet), sur l'assistant de démarrage (son parcours en détail :
// tests/web/assistant.test.ts) ; puis, dans l'application v10 servie par la plateforme : une facture
// pour un client créé depuis l'éditeur, émise par le serveur (le numéro de sa série, le même net à
// payer à l'écran et au serveur), retrouvée après rechargement ; activer le code du téléphone dans Paramètres → Ton
// compte ; se déconnecter par le menu du haut,
// et revenir d'un autre appareil (un mauvais mot de passe d'abord) avec le code à six chiffres. Chaque bouton est trouvé par ce qu'il
// dit, jamais par son rang.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { pdfTelecharge } from '../pdf-telecharge.ts';
import { build } from 'vite';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { LONGUEUR_MINIMALE } from '../../commun/compte.ts';
import { motif, rendre, t } from '../../textes/index.ts';
import '../../web/src/textes.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import * as jsqr from 'jsqr';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
// La version que le serveur des tests annonce (donnée, pas lue dans git : les preuves tournent dans une copie sans lui) :
// le numéro que l'envoi déclare, puis le début de son empreinte (serveur/ecrans.ts).
const VERSION = '1.4.2 · 0a1b2c3';
const titre = (cle: string, v: Record<string, string> = {}) => { const s = rendre(t(cle, v), 'fr'); return s.charAt(0).toUpperCase() + s.slice(1); };
const phrase = (cle: string, v = {}) => rendre(motif(cle, v), 'fr');
// La prose de la v10 se lit à la française (C.typoFr, 10.14.0) : une espace fine insécable devant « : ; ? ! » et »,
// et après «.
const fine = (s: string) => s.replace(/ ([?!;:»%])/g, ' $1').replace(/« /g, '« ');

describe('le parcours, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-'));
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VERSION: VERSION }), port: 0, web: dossier, livreurMs: 60_000 });
    // Un nom de fichier accentué : Chromium le garde si sa langue est en UTF-8 (sans LANG, il le remplace par « download »).
    navigateur = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8' } });
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  // Un champ est trouvé par son libellé (qui porte aussi sa bulle « i »).
  const champ = (p: Page, cle: string) => p.locator('label.field').filter({ hasText: titre(cle) }).locator('input');
  const bouton = (p: Page, cle: string) => p.getByRole('button', { name: titre(cle), exact: true });
  const ecran = (p: Page, cle: string) => p.getByRole('heading', { level: 1, name: titre(cle) }).waitFor({ timeout: 10_000 });
  // Dans la v10 : la page est reconnue à son titre, et les fenêtres de bienvenue se ferment comme une
  // personne le ferait (« Plus tard »), si elles s'ouvrent.
  const pageV10 = async (p: Page, nom: RegExp) => {
    await p.locator('#view h1').filter({ hasText: nom }).first().waitFor({ timeout: 15_000 });
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3; i++) {
      const b = p.getByRole('button', { name: 'Plus tard', exact: true });
      if (!(await b.count())) return;
      await b.first().click();
    }
  };

  it('du compte à la facture émise par le serveur, retrouvée après rechargement, puis le retour d\'un autre appareil', async () => {
    const email = `parcours-${Date.now()}@exemple.tn`;
    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' @ ' + p.url() + ' ' + (e.stack ?? '').split('\n').slice(0, 4).join(' / ')));
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

    // Le compte créé, on est connecté tout de suite : rien à retaper (vu le 05/10/2026 sur le vrai serveur).

    // La porte : « Commencer avec mon entreprise » ; l'application s'ouvre ensuite, sans exiger le code du téléphone
    // (recommandé, il s'active plus loin dans Ton compte).
    await ecran(p, 'ecran.porte.titre');
    await bouton(p, 'ecran.porte.demarrer_bouton').click();
    await ecran(p, 'ecran.porte.entreprise_titre');
    await champ(p, 'ecran.porte.raison').fill('Épicerie Sami Gharbi');
    // Un O pour la lettre-clé : refusé sur son champ, en disant pourquoi (E4 : la porte disait « le serveur a rencontré
    // une erreur »). Puis recopié de la carte, en minuscules et avec des espaces : il passe, sous sa forme lisible.
    // Le champ montre la forme attendue (E4 : il n'en montrait aucune).
    expect(await champ(p, 'ecran.porte.matricule').getAttribute('placeholder')).toBe('1234567A/A/M/000');
    // Déjà celui d'une autre entreprise, écrit autrement : refusé en le disant, SUR son champ, qui prend le focus (E5 :
    // le refus ne vivait que 2,6 secondes en bas de l'écran). Un matricule à ce fichier seul (tests/matricule-libre.ts).
    await admin.query(`with o as (insert into socle.organisation (type, nom) values ('independant', 'Quincaillerie du Lac') returning id)
      insert into socle.entreprise (organisation, raison_sociale, matricule_fiscal) select id, 'Quincaillerie du Lac', '6931471B/A/M/000' from o`);
    await champ(p, 'ecran.porte.matricule').fill('6931471 b a m 000');
    await bouton(p, 'ecran.porte.creer').click();
    await expect.poll(() => p.getByRole('alert').first().innerText()).toBe(phrase('base.entreprise.matricule_pris'));
    expect(await champ(p, 'ecran.porte.matricule').evaluate((e) => e === document.activeElement && e.getAttribute('aria-invalid') === 'true')).toBe(true);
    await champ(p, 'ecran.porte.matricule').fill('1234567O/A/M/000');
    await bouton(p, 'ecran.porte.creer').click();
    await expect.poll(() => p.getByRole('alert').first().innerText()).toBe(phrase('socle.matricule_forme', { matricule: '1234567O/A/M/000' }));
    await champ(p, 'ecran.porte.matricule').fill('1234567 a a m 000');
    await bouton(p, 'ecran.porte.creer').click();

    // L'application v10 de l'entreprise s'ouvre, sans écran du code entre les deux, sur l'assistant de démarrage (lot
    // onboarding) : « Où te joindre ? » (rien d'obligatoire), le métier (une épicerie : le commerce, et son catalogue de
    // départ), la TVA (le réel, déjà coché) et le menu proposé ; « Ouvrir mon entreprise » ouvre son accueil.
    await p.waitForURL(/\/v10\/\?e=[0-9a-f-]{36}/, { timeout: 15_000 });
    const ent = new URL(p.url()).searchParams.get('e') ?? '';
    const assistant = p.locator('#setup.as');
    const etape = (texte: string) => assistant.getByRole('heading', { level: 1, name: fine(texte), exact: true }).waitFor({ timeout: 15_000 });
    await etape('Où te joindre ?');
    await assistant.getByRole('button', { name: 'Continuer', exact: true }).click();
    await etape('Que fais-tu ?');
    await assistant.locator('.as-tuile').filter({ hasText: 'Commerce et vente de produits' }).click();
    await assistant.getByRole('button', { name: 'Continuer', exact: true }).click();
    await etape('Factures-tu la TVA ?');
    expect(await assistant.getByRole('radio', { name: /Oui, je facture la TVA/ }).isChecked()).toBe(true);
    await assistant.getByRole('button', { name: 'Continuer', exact: true }).click();
    await etape('De quoi as-tu besoin ?');
    await assistant.getByRole('button', { name: 'Ouvrir mon entreprise', exact: true }).click();
    await assistant.waitFor({ state: 'detached' });
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await plusTard(p);
    // Au pied du menu, le numéro de la version qui tourne, jamais « vdev » : c'est ce qu'un testeur recopie quand il
    // signale un problème (vu sur le serveur d'essai le 05/10/2026). L'envoi se lit au survol (13/10/2026 : « Vx.x.x »).
    await expect.poll(() => p.locator('#app-version').innerText()).toBe('v1.4.2');
    expect(await p.locator('#app-version').getAttribute('title')).toBe('Envoi 0a1b2c3');
    await p.screenshot({ path: path.join(PHOTOS, 'parcours-1-accueil.png') });

    // Une facture, dans l'éditeur de la v10 : le client se crée depuis l'éditeur, et revient choisi.
    await p.locator('#nav a[data-route="factures"]').click();
    await pageV10(p, /Factures/);
    await p.getByRole('button', { name: '+ Nouvelle facture' }).click();
    await pageV10(p, /Nouvelle facture/);
    await plusTard(p);
    await p.locator('[data-combo=clientId] .combo-btn').click();
    await p.getByRole('button', { name: '+ Nouveau client' }).click();
    await p.locator('#cf input[name=name]').fill('Boulangerie Ennour');
    await p.locator('#cf input[name=matricule]').fill('1234567B');
    await p.locator('#modal-root').getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(() => p.locator('[data-combo=clientId] .combo-val').innerText()).toContain('Boulangerie Ennour');
    await p.locator('#lines input[data-k=label]').first().fill('Pain de campagne');
    await p.locator('#lines input[data-k=qty]').first().fill('3');
    await p.locator('#lines input[data-k=unitPrice]').first().fill('2.125');
    // 3 × 2,125 = 6,375 HT ; TVA 19 % : 1,211 ; timbre 1,000 : 8,586 DT (règle de la v10, au millime).
    await expect.poll(async () => ((await p.locator('#totals').innerText()).replace(/\s+/g, ' '))).toMatch(/8,586/);
    await p.screenshot({ path: path.join(PHOTOS, 'parcours-2-editeur.png') });

    // Émettre : la v10 demande d'abord ; le serveur numérote dans la série de l'entreprise.
    await p.locator('#issue').click();
    await p.locator('#modal-root #ok').click();
    await pageV10(p, /Facture FAC-2026-001/);
    const piece = (await admin.query(`select numero_texte, statut, net_a_payer::text net from ventes.piece where entreprise = $1`, [ent])).rows;
    expect(piece).toEqual([{ numero_texte: 'FAC-2026-001', statut: 'emise', net: '8586' }]);
    await p.screenshot({ path: path.join(PHOTOS, 'parcours-3-emise.png') });

    // Recharger : la facture émise est toujours là, avec son numéro, dans la liste des factures.
    await p.waitForTimeout(600);
    await p.reload();
    await pageV10(p, /Facture FAC-2026-001/);
    await plusTard(p);
    await p.locator('#nav a[data-route="factures"]').click();
    await pageV10(p, /Factures/);
    await plusTard(p);
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/FAC-2026-001[\s\S]*Boulangerie Ennour/);
    await p.screenshot({ path: path.join(PHOTOS, 'parcours-4-liste.png') });

    // Paramètres → Ton compte : ce serveur n'envoie pas d'e-mails, le mot de passe suffit ; une application
    // d'authentification, recommandée, s'active dans une fenêtre en quatre étapes (lot onboarding ; le choix du code,
    // 0081) ; rien ne change avant le premier code juste.
    await p.getByRole('link', { name: 'Paramètres', exact: true }).first().click();
    await pageV10(p, /Paramètres/);
    await plusTard(p);
    await p.getByRole('tab', { name: 'Ton compte', exact: true }).click();
    const carte = p.locator('#cpt-code');
    await expect.poll(() => carte.locator('#cpt-etat').innerText(), { timeout: 15_000 }).toBe('Mot de passe seul');
    expect(await carte.getAttribute('class')).toContain('cpt-recommande');
    await carte.getByRole('button', { name: 'Utiliser une application…', exact: true }).click();
    const fenetre = p.locator('#modal-root');
    // Le téléphone scanne le code QR (brique 145) : l'image dessinée, relue par un lecteur de QR.
    const pixels = await fenetre.getByRole('img', { name: 'Le code QR à scanner avec ton application d\'authentification' }).evaluate(async (el) => {
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
    const secret = new URL(lu).searchParams.get('secret') ?? '';
    // La clé écrite en clair est la même, par groupes de quatre (pour qui la tape à la main) ; le lien ouvre l'application.
    expect((await fenetre.locator('.cpt-cle code').innerText()).replace(/\s/g, '')).toBe(secret);
    expect(await fenetre.getByRole('link', { name: 'Déjà sur ton téléphone ? Ouvrir dans l\'application' }).getAttribute('href')).toBe(lu);
    // Les codes de secours ne se montreront plus : sans « Je les ai mis de côté », la fenêtre ne part pas, le dit, et
    // montre la case.
    const premier = fenetre.locator('label.field').filter({ hasText: 'Le code de SkanFact dans l\'application' }).locator('input');
    const activer = fenetre.getByRole('button', { name: 'Vérifier et activer', exact: true });
    const juste = codeTotp(depuisBase32(secret), Date.now());
    await premier.fill(juste);
    await activer.click();
    await expect.poll(() => fenetre.getByRole('alert').innerText()).toBe(fine('Mets d\'abord tes codes de secours de côté (copie-les ou télécharge-les), puis coche « Je les ai mis de côté ».'));
    expect(await fenetre.getByRole('checkbox', { name: 'Je les ai mis de côté' }).evaluate((e) => e === document.activeElement)).toBe(true);
    await fenetre.getByRole('checkbox', { name: 'Je les ai mis de côté' }).check();
    // Un code faux n'active rien : le refus le dit, sur son champ, et le compte n'a toujours pas de code.
    await premier.fill(juste === '000000' ? '111111' : '000000');
    await activer.click();
    await expect.poll(() => fenetre.getByRole('alert').innerText()).toBe(fine(phrase('compte.code_essai_faux')));
    expect(await premier.evaluate((e) => e === document.activeElement)).toBe(true);
    // Le refus se lit en entier, au bas de cette fenêtre plus haute que l'écran (vu le 09/10/2026 : la moitié du
    // message passait sous le bord).
    await expect.poll(async () => {
      const [boite, message] = await Promise.all([fenetre.locator('.modal').boundingBox(), fenetre.getByRole('alert').boundingBox()]);
      return !!boite && !!message && message.y >= boite.y && message.y + message.height <= boite.y + boite.height;
    }).toBe(true);
    expect((await admin.query('select code_methode from socle.utilisateur where email = $1', [email])).rows).toEqual([{ code_methode: null }]);
    await p.screenshot({ path: path.join(PHOTOS, 'parcours-0-code-qr.png') });
    // Le code que montre le téléphone : le code est activé, et la carte le dit.
    await premier.fill(codeTotp(depuisBase32(secret), Date.now()));
    await activer.click();
    await expect.poll(() => carte.locator('#cpt-etat').innerText()).toBe('Par application');
    expect(await carte.locator('#cpt-restants').innerText()).toBe('10 codes de secours');
    expect(await fenetre.getByRole('button', { name: 'Vérifier et activer' }).count()).toBe(0);

    // Se déconnecter par le menu de la personne, au pied de la barre.
    await p.locator('#b-moi').click();
    await p.getByRole('menuitem', { name: 'Se déconnecter' }).click();
    await ecran(p, 'ecran.connexion.titre');
    expect(erreurs).toEqual([]);

    // D'un autre appareil (un autre navigateur) : le mot de passe, puis le code à six chiffres ; la
    // même entreprise s'ouvre, avec sa facture.
    const q = await (await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' })).newPage();
    q.on('pageerror', (e) => erreurs.push(e.message + ' @ ' + q.url()));
    await q.goto(serveur.adresse);
    // Se tromper de mot de passe, puis le bon.
    await champ(q, 'ecran.connexion.email').fill(email);
    await champ(q, 'ecran.connexion.mot_de_passe').fill('pas-le-bon-mot');
    await bouton(q, 'ecran.connexion.bouton').click();
    await expect.poll(() => q.getByRole('alert').first().innerText()).toBe(phrase('connexion.refusee'));
    await champ(q, 'ecran.connexion.mot_de_passe').fill('Un-bon-mot-de-passe');
    await bouton(q, 'ecran.connexion.bouton').click();
    await ecran(q, 'ecran.code.titre');
    // Le curseur attend dans la case du code, et le téléphone perdu se dit à l'écran (pas seulement dans la bulle « i ») :
    // « Utiliser un code de secours » fait attendre un code de secours (lot entrée), et revient au code du téléphone.
    await expect.poll(() => champ(q, 'ecran.code.champ').evaluate((i) => i === document.activeElement)).toBe(true);
    expect(await q.locator('#code-perdu').innerText()).toBe(titre('ecran.code.utiliser_secours'));
    await q.locator('#code-perdu').click();
    await ecran(q, 'ecran.code.titre_secours');
    await expect.poll(() => champ(q, 'ecran.code.champ_secours').evaluate((i) => i === document.activeElement)).toBe(true);
    await q.locator('#code-perdu').click();
    await ecran(q, 'ecran.code.titre');
    await champ(q, 'ecran.code.champ').fill('000000');
    await bouton(q, 'ecran.code.bouton').click();
    await expect.poll(() => q.getByRole('alert').first().innerText()).toBe(phrase('connexion.code_faux'));
    await champ(q, 'ecran.code.champ').fill(codeTotp(depuisBase32(secret), Date.now()));
    await bouton(q, 'ecran.code.bouton').click();
    await q.waitForURL(new RegExp(`/v10/\\?e=${ent}`), { timeout: 15_000 });
    await q.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await plusTard(q);
    // Sur le téléphone, toutes les pages sont dans « Plus », l'onglet du bas (maquette « Barre v3 »).
    await q.locator('.sb-onglets [data-tel="plus"]').click();
    await q.locator('.sb-plus a[href="#/factures"]').click();
    await pageV10(q, /Factures/);
    await expect.poll(() => q.locator('#view').innerText()).toContain('FAC-2026-001');
    await q.screenshot({ path: path.join(PHOTOS, 'parcours-5-telephone.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);

  // Une personne inscrite par l'API, son entreprise d'essai et le code en place ; `ouvrir` ouvre
  // l'application v10 de l'entreprise voulue dans un nouvel onglet.
  async function inscrite(nom: string) {
    const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => (await (await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(corps === undefined ? {} : { 'content-type': 'application/json' }), ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    })).json()) as Record<string, unknown>;
    const email = `${nom.toLowerCase().replace(/\W+/g, '-')}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    const essai = String((await api('POST', '/entreprises-essai', jeton)).id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    const erreurs: string[] = [];
    const ouvrir = async (ent: string, chemin = '') => {
      const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true });
      await contexte.addInitScript((j) => sessionStorage.setItem('skanfact.jeton', j), jeton);
      // L'entreprise d'essai sert ici d'entreprise de travail (ses tiers d'essai, sans l'exemple de cinq ans) : elle s'ouvre
      // telle quelle, comme après « Ouvrir telle quelle » ; vide de pièces, elle partirait vers « On prépare l'exemple ».
      await contexte.addInitScript(() => { const e = new URLSearchParams(location.search).get('e'); if (e) sessionStorage.setItem('skanfact.essai_tel_quel', e); });
      const p = await contexte.newPage();
      p.on('pageerror', (e) => erreurs.push(`${e.message} @ ${p.url()}`));
      await p.goto(`${serveur.adresse}/v10/?e=${ent}${chemin}`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await plusTard(p);
      return p;
    };
    return { api, jeton, essai, ouvrir, erreurs };
  }

  it('deux onglets modifient le même client : rien n\'est écrasé en silence, la version du serveur gagne et l\'autre est mise de côté, et l\'enregistrement reprend', async () => {
    const qui = await inscrite('Hela Mansour');
    const a = await qui.ouvrir(qui.essai, '#/clients');
    const b = await qui.ouvrir(qui.essai, '#/clients');
    const modifier = async (p: Page, champ: string, valeur: string) => {
      await p.locator('tr', { hasText: 'Menuiserie du Lac (exemple)' }).getByRole('button', { name: /Actions/ }).click();
      await p.getByText('Modifier le client', { exact: true }).click();
      await p.locator(`#cf input[name=${champ}]`).fill(valeur);
      await p.locator('#modal-root').getByRole('button', { name: 'Enregistrer', exact: true }).click();
    };
    const auServeur = async () => (await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'clients' and contenu->>'name' = 'Menuiserie du Lac (exemple)'`, [qui.essai])).rows[0]?.contenu;
    // A enregistre d'abord ; B, qui ne l'a pas vu, modifie le même client.
    await modifier(a, 'phone', '71 000 111');
    await expect.poll(async () => (await auServeur())?.phone).toBe('71 000 111');
    await modifier(b, 'contact', 'M. Karim Jaziri');
    // B est prévenu, en clair ; jamais « Rien n'a été enregistré ».
    await expect.poll(() => b.locator('#modal-root').innerText()).toContain('Modifications des deux côtés');
    expect(await b.getByText('Rien n\'a été enregistré').count()).toBe(0);
    await b.screenshot({ path: path.join(PHOTOS, 'conflit-deux-onglets.png') });
    // Le serveur garde la version de A ; celle de B est mise de côté dans le dossier, rien n'est perdu.
    expect(await auServeur()).toMatchObject({ phone: '71 000 111' });
    const archive = (await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'conflictArchive'`, [qui.essai])).rows.map((r) => r.contenu);
    expect(archive).toEqual([expect.objectContaining({ kind: 'clients', record: expect.objectContaining({ contact: 'M. Karim Jaziri' }) })]);
    // Et B enregistre de nouveau normalement ensuite.
    await b.locator('#modal-root').getByRole('button', { name: 'J\'ai compris' }).click();
    await modifier(b, 'contact', 'M. Karim Jaziri');
    await expect.poll(async () => (await auServeur())?.contact).toBe('M. Karim Jaziri');
    expect(await auServeur()).toMatchObject({ phone: '71 000 111' });
    expect(qui.erreurs).toEqual([]);
  }, 120_000);

  // « Ouvrir l'exemple » depuis une vraie entreprise (l'entreprise d'essai, sans rien écrire ici) : tests/web/exemple.test.ts.
  it('dans une vraie entreprise : les réglages de l\'ordinateur n\'apparaissent pas, ni leurs puces, et un fichier exporté se télécharge', async () => {
    const qui = await inscrite('Mourad Trabelsi');
    const vraie = String((await qui.api('POST', '/entreprises', qui.jeton, { raisonSociale: 'Atelier Mourad SARL' })).id);
    const p = await qui.ouvrir(vraie, '#/parametres');
    // Un fichier « enregistré » par la v10 arrive dans les téléchargements, sous son nom.
    const [fichier] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => (window as unknown as { skanfact: { saveText: (n: string, c: string) => Promise<string> } }).skanfact.saveText('journal-ventes-2026.csv', 'a;b\n1;2'))]);
    expect(fichier.suggestedFilename()).toBe('journal-ventes-2026.csv');
    expect(fs.readFileSync(await fichier.path(), 'utf8')).toBe('a;b\n1;2');
    // Données et sécurité : ni sauvegardes du disque, ni mot de passe du fichier, ni « Tout effacer » — ni leurs puces
    // dans le sommaire de l'onglet (elles menaient à un panneau caché, vu le 05/10/2026).
    await p.getByText('Données et sécurité', { exact: true }).click();
    await expect.poll(() => p.locator('#p-exemple').isVisible()).toBe(true);
    for (const id of ['p-sauvegardes', 'p-externe', 'p-motdepasse', 'p-danger', 'p-dossiers']) {
      expect(await p.locator(`#${id}`).isVisible()).toBe(false);
      expect(await p.locator(`#set-somm [data-somm="${id}"]`).isVisible()).toBe(false);
    }
    expect(await p.locator('#set-somm [data-somm="p-exemple"]').isVisible()).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'reglages-donnees.png') });
    expect(qui.erreurs).toEqual([]);
  }, 120_000);

  it('une facture émise, puis payée en partie et corrigée par un avoir, à la souris : le serveur tient le paiement et numérote l\'avoir ; l\'écran et le serveur disent le même reste', async () => {
    const qui = await inscrite('Rania Kefi');
    const p = await qui.ouvrir(qui.essai, '#/factures');
    // La facture : 2 × 450,500 à 19 %, timbre 1,000 → 1 073,190 DT.
    await p.getByRole('button', { name: '+ Nouvelle facture' }).click();
    await pageV10(p, /Nouvelle facture/);
    await plusTard(p);
    await p.locator('[data-combo=clientId] .combo-btn').click();
    await p.locator('[data-combo=clientId] .combo-q').fill('Menuiserie');
    await p.locator('[data-combo=clientId] .combo-list [role=option]').first().click();
    await p.locator('#lines input[data-k=label]').first().fill('Table en chêne massif');
    await p.locator('#lines input[data-k=qty]').first().fill('2');
    await p.locator('#lines input[data-k=unitPrice]').first().fill('450.5');
    await expect.poll(async () => (await p.locator('#totals').innerText()).replace(/\s+/g, ' ')).toMatch(/1 073,190/);
    await p.locator('#issue').click();
    await p.locator('#modal-root #ok').click();
    await pageV10(p, /Facture FAC-2026-001/);
    await plusTard(p);
    // Plus de « Marquer annulée… » : une facture émise se corrige par un avoir.
    expect(await p.getByRole('button', { name: /Marquer annulée/ }).count()).toBe(0);

    // Un paiement : un montant plus précis que le dinar se refuse sur son champ ; 300,000 s'enregistre.
    await p.locator('#pay').click();
    await p.locator('#pf2 input[name=amount]').fill('300.1234');
    await p.locator('#modal-root').getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(() => p.locator('#toast').innerText()).toContain('Un montant en DT se compte à 3 décimales au plus.');
    await p.locator('#pf2 input[name=amount]').fill('300');
    await p.locator('#modal-root').getByRole('button', { name: 'Enregistrer', exact: true }).click();
    const reglements = async () => (await admin.query('select montant from ventes.reglement where entreprise = $1', [qui.essai])).rows.map((r) => r.montant);
    await expect.poll(reglements).toEqual([300000n]);

    // L'avoir, depuis la facture : une table sur deux (450,500 + 19 % = 536,095 DT).
    await p.locator('#lock-credit').click();
    await pageV10(p, /Nouvel avoir/);
    await plusTard(p);
    await p.locator('#lines input[data-k=qty]').first().fill('1');
    await p.screenshot({ path: path.join(PHOTOS, 'avoir-editeur.png') });
    await p.locator('#issue').click();
    await p.locator('#modal-root #ok').click();
    await pageV10(p, /Avoir AVO-2026-001/);
    const avoir = (await admin.query(`select a.numero_texte, a.net_a_payer, f.numero_texte facture from ventes.piece a join ventes.piece f on f.id = a.corrige where a.entreprise = $1 and a.type = 'avoir'`, [qui.essai])).rows;
    expect(avoir).toEqual([{ numero_texte: 'AVO-2026-001', net_a_payer: 536095n, facture: 'FAC-2026-001' }]);
    await p.screenshot({ path: path.join(PHOTOS, 'avoir-emis.png') });

    // Deux chemins, un chiffre : ce que l'écran de la v10 dit rester dû est ce que le serveur calcule.
    const ecran = await p.evaluate(() => {
      const w = window as unknown as { __data: { documents: { type: string; number: string }[]; company: unknown }; SkanCore: { invoiceBalance: (d: unknown, data: unknown, c: unknown) => { remaining: number } } };
      const f = w.__data.documents.find((d) => d.type === 'facture' && d.number === 'FAC-2026-001');
      return w.SkanCore.invoiceBalance(f, w.__data, w.__data.company).remaining.toFixed(3);
    });
    const piece = String((await admin.query(`select id from ventes.piece where entreprise = $1 and type = 'facture'`, [qui.essai])).rows[0].id);
    const serveur = (await qui.api('GET', `/entreprises/${qui.essai}/ventes/${piece}`, qui.jeton)).suivi as { reste: string; statut: string };
    // 1 073,190 − 300,000 − 536,095 = 237,095.
    expect({ ecran, serveur: serveur.reste, statut: serveur.statut }).toEqual({ ecran: '237.095', serveur: '237.095', statut: 'partielle' });
    expect(qui.erreurs).toEqual([]);
  }, 120_000);

  it('un achat saisi, réglé puis corrigé par un avoir, à la souris : le serveur tient la pièce, son règlement et l\'avoir rattaché ; l\'écran et le serveur disent le même reste ; la facture ne se supprime pas sous son avoir', async () => {
    const qui = await inscrite('Nadia Ferchichi');
    await qui.api('GET', `/entreprises/${qui.essai}/dossier-v10`, qui.jeton);
    await qui.api('POST', `/entreprises/${qui.essai}/dossier-v10`, qui.jeton, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Bureau Plus SARL', contact: '', matricule: '', address: '', phone: '', email: '', rib: '', bank: '', notes: '', paymentTermsDays: '', withholdingRate: '' } },
    ] });
    const p = await qui.ouvrir(qui.essai, '#/achats');
    const auServeur = async () => (await admin.query('select ref_v10, nature, numero_fournisseur, net_a_payer, lie from achats.piece where entreprise = $1 order by cree_le', [qui.essai])).rows;
    // La facture du fournisseur : 40 × 12,345 à 19 %, 1,000 de frais, retenue 1,5 % → 579,808 DT.
    await p.locator('#new').click();
    await pageV10(p, /Nouvelle facture/);
    await plusTard(p);
    await p.locator('[data-combo=supplierId] .combo-btn').click();
    await p.locator('[data-combo=supplierId] .combo-q').fill('Bureau');
    await p.locator('[data-combo=supplierId] .combo-list [role=option]').first().click();
    await p.locator('#view input[name=number]').fill('FA-2026-0412');
    await p.locator('#view input[name=fees]').fill('1');
    await p.locator('#view select[name=withholdingRate]').selectOption('1.5');
    await p.locator('#b-lines input[data-k=label]').first().fill('Ramettes de papier');
    await p.locator('#b-lines input[data-k=qty]').first().fill('40');
    await p.locator('#b-lines input[data-k=unitPrice]').first().fill('12.345');
    // Des frais plus précis que le dinar se refusent sur leur champ, avant d'enregistrer.
    await p.locator('#view input[name=fees]').fill('1.2345');
    await p.locator('#save').click();
    await expect.poll(() => p.locator('#toast').innerText()).toContain('Des frais en DT se comptent à 3 décimales au plus.');
    expect(await auServeur()).toEqual([]);
    await p.locator('#view input[name=fees]').fill('1');
    await p.locator('#save').click();
    await expect.poll(auServeur).toMatchObject([{ nature: 'facture', numero_fournisseur: 'FA-2026-0412', net_a_payer: 579808n }]);
    await pageV10(p, /FA-2026-0412/);
    await plusTard(p);

    // Un règlement : trop précis, il se refuse sur son champ ; 300,000 s'enregistre au serveur.
    await p.locator('#pay').click();
    await p.locator('#spf input[name=amount]').fill('300.1234');
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#toast').innerText()).toContain('Un montant en DT se compte à 3 décimales au plus.');
    await p.locator('#spf input[name=amount]').fill('300');
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => (await admin.query('select montant from achats.reglement where entreprise = $1', [qui.essai])).rows.map((r) => r.montant)).toEqual([300000n]);

    // L'avoir, depuis la liste : « Saisir un avoir sur cette pièce » le rattache tout seul.
    // (maquette « Barre v3 ») Les achats, dans le volet « Acheter » (« Au quotidien » porte les pages du métier).
    await p.locator('#nav .nav-volet[data-famille="Acheter"]').click();
    await p.locator('.sb-panneau a[href="#/achats"]').click();
    await pageV10(p, /Achats/);
    await p.locator('tr', { hasText: 'FA-2026-0412' }).getByRole('button', { name: /Actions/ }).click();
    await p.getByText('Saisir un avoir sur cette pièce', { exact: true }).click();
    await pageV10(p, /avoir/i);
    await plusTard(p);
    await p.locator('#view input[name=number]').fill('AV-2026-0033');
    await p.locator('#b-lines input[data-k=label]').first().fill('Ramettes abîmées');
    await p.locator('#b-lines input[data-k=qty]').first().fill('4');
    await p.locator('#b-lines input[data-k=unitPrice]').first().fill('12.345');
    await p.locator('#save').click();
    await expect.poll(async () => (await auServeur()).length).toBe(2);
    const [f, av] = await auServeur();
    expect(av).toMatchObject({ nature: 'avoir', numero_fournisseur: 'AV-2026-0033', lie: expect.any(String) });
    await p.screenshot({ path: path.join(PHOTOS, 'achat-avoir.png') });

    // Deux chemins, un chiffre : le reste que l'écran calcule est celui du serveur.
    const ecran = await p.evaluate(() => {
      const w = window as unknown as { __data: { purchases: { number: string }[]; company: unknown }; SkanCore: { purchaseBalance: (x: unknown, c: unknown, d: unknown) => { remaining: number }; purchaseStatus: (x: unknown, c: unknown, j: undefined, d: unknown) => string } };
      const x = w.__data.purchases.find((y) => y.number === 'FA-2026-0412');
      return { reste: w.SkanCore.purchaseBalance(x, w.__data.company, w.__data).remaining.toFixed(3), statut: w.SkanCore.purchaseStatus(x, w.__data.company, undefined, w.__data) };
    });
    const id = String((await admin.query('select id from achats.piece where entreprise = $1 and ref_v10 = $2', [qui.essai, f?.ref_v10])).rows[0].id);
    const serveur = (await qui.api('GET', `/entreprises/${qui.essai}/achats/${id}`, qui.jeton)).suivi as { reste: string; statut: string };
    // L'avoir reprend la retenue de sa facture : 58,762 − 0,881 = 57,881 ; 579,808 − 300,000 − 57,881 = 221,927.
    expect({ ecran: ecran.reste, serveur: serveur.reste, statut: serveur.statut }).toEqual({ ecran: '221.927', serveur: '221.927', statut: 'partiel' });
    expect(ecran.statut).toBe('partiel');

    // La facture ne se supprime pas tant que l'avoir y est rattaché : l'écran le dit avant de demander.
    // (maquette « Barre v3 ») Les achats, dans le volet « Acheter » (« Au quotidien » porte les pages du métier).
    await p.locator('#nav .nav-volet[data-famille="Acheter"]').click();
    await p.locator('.sb-panneau a[href="#/achats"]').click();
    await pageV10(p, /Achats/);
    await p.locator('tr', { hasText: 'FA-2026-0412' }).first().click();
    await pageV10(p, /FA-2026-0412/);
    await p.locator('#more-btn').click();
    await p.locator('#del').click();
    await expect.poll(() => p.locator('#toast').innerText()).toContain('Un avoir ou un acompte est rattaché à cet achat');
    expect(await auServeur()).toHaveLength(2);
    expect(await p.getByText('Rien n\'a été enregistré').count()).toBe(0);
    expect(qui.erreurs).toEqual([]);
  }, 120_000);

  it('la paie à la souris : le premier salarié, le bulletin du mois, une prime, une loi de finances, payé ; le serveur recalcule chaque bulletin au millime de l\'écran, et un bulletin garde son barème', async () => {
    const qui = await inscrite('Rania Mejri');
    const p = await qui.ouvrir(qui.essai, '#/paie');
    await pageV10(p, /Paie/);
    await plusTard(p);
    const auServeur = async () => (await admin.query(`select b.id, b.annee, b.mois, b.brut, b.net, b.paye_le, b.bareme->>'cnssSalarie' cnss, s.nom
      from paie.bulletin b join paie.salarie s on s.id = b.salarie where b.entreprise = $1 order by b.annee, b.mois`, [qui.essai])).rows;

    // Le premier salarié, par sa fiche : embauché le 1er mars 2025, chef de famille, deux enfants.
    await p.locator('#emp-first').click();
    await p.locator('#ef input[name=name]').fill('Sonia Trabelsi');
    await p.locator('#ef input[name=grossSalary]').fill('1234.567');
    await p.locator('#ef input[name=headOfFamily]').check();
    await p.locator('#ef input[name=children]').fill('2');
    const embauche = p.locator('#ef .datefield').filter({ has: p.locator('input[name=hireDate]') }).locator('.d-txt');
    await embauche.fill('01/03/2025');
    await embauche.press('Tab');
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => (await admin.query('select nom, enfants, chef_de_famille, date_entree from paie.salarie where entreprise = $1', [qui.essai])).rows)
      .toEqual([{ nom: 'Sonia Trabelsi', enfants: 2, chef_de_famille: true, date_entree: '2025-03-01' }]);

    // Le bulletin du mois (« Établir le bulletin manquant »), puis une prime de rendement.
    await p.locator('#p-tabs button[data-tab=bulletins]').click();
    await p.locator('#p-gen').click();
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => (await auServeur()).length).toBe(1);
    await p.locator('#p-body tr', { hasText: 'Sonia Trabelsi' }).getByRole('button', { name: /Actions/ }).click();
    await p.getByText('Modifier le bulletin', { exact: true }).click();
    await p.locator('#add-bon').click();
    await p.locator('#bf-bon input[data-f=label]').fill('Rendement');
    await p.locator('#bf-bon input[data-f=amount]').fill('150.555');
    await p.locator('#modal-root #ok').click();
    // Calculé à la main dans tests/v10/paie.test.ts (le barème livré, celui de 2026) : brut 1 385,122 ; net 1 120,386.
    await expect.poll(auServeur).toMatchObject([{ nom: 'Sonia Trabelsi', brut: 1385122n, net: 1120386n, paye_le: null, cnss: '96800' }]);
    const [premier] = await auServeur();
    await expect.poll(() => p.locator('#p-body tr', { hasText: 'Sonia Trabelsi' }).innerText()).toMatch(/1\s?120,386/);

    // Une loi de finances (inventée) : la CNSS du salarié passe à 9,93 % dans les barèmes. Le bulletin établi
    // garde la sienne : marqué payé ensuite, il ne change pas d'un millime.
    await p.locator('#p-tabs button[data-tab=baremes]').click();
    await p.locator('#rf input[name=cnssEmployee]').fill('9.93');
    await p.locator('#rf-save').click();
    await expect.poll(async () => (await admin.query(`select contenu->'cnssEmployee'->>'~n' c from socle.dossier_v10 where entreprise = $1 and collection = '_racine' and cle = 'payrollSettings'`, [qui.essai])).rows[0]?.c).toBe('9.93');
    await p.locator('#p-tabs button[data-tab=bulletins]').click();
    await p.locator('#p-body [data-payer]').click();
    await expect.poll(async () => (await auServeur())[0]?.paye_le).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await auServeur())[0]).toMatchObject({ net: 1120386n, cnss: '96800' });

    // Le mois suivant se calcule avec le nouveau barème.
    const suivant = Number(premier?.mois) === 12 ? 1 : Number(premier?.mois) + 1;
    if (suivant === 1) await p.locator('#p-year').selectOption(String(Number(premier?.annee) + 1));
    await p.locator('#p-month').selectOption(String(suivant));
    await p.locator('#p-gen').click();
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => (await auServeur()).length).toBe(2);
    const [, second] = await auServeur();
    expect(second).toMatchObject({ cnss: '99300', brut: 1234567n });
    await p.screenshot({ path: path.join(PHOTOS, 'paie.png') });

    // Deux chemins, un chiffre : ce que l'écran a calculé est ce que le serveur recalcule.
    const ecran = await p.evaluate(() => {
      const w = window as unknown as { __data: { payslips: { year: number; month: number; computed: { net: number; employerCost: number } }[] } };
      return w.__data.payslips.map((b) => ({ cle: b.year * 100 + b.month, periode: `${b.year}-${b.month}`, net: b.computed.net.toFixed(3), cout: b.computed.employerCost.toFixed(3) })).sort((a, b) => a.cle - b.cle).map(({ periode, net, cout }) => ({ periode, net, cout }));
    });
    const serveur = [];
    for (const b of await auServeur()) {
      const lu = await qui.api('GET', `/entreprises/${qui.essai}/paie/bulletins/${String(b.id)}`, qui.jeton) as { annee: number; mois: number; montants: { net: string; coutEmployeur: string } };
      serveur.push({ cle: lu.annee * 100 + lu.mois, periode: `${lu.annee}-${lu.mois}`, net: lu.montants.net, cout: lu.montants.coutEmployeur });
    }
    // Dans l'ordre des mois (le 1er octobre, « 2026-10 » se rangeait en texte avant « 2026-9 »).
    expect(serveur.sort((a, b) => a.cle - b.cle).map(({ periode, net, cout }) => ({ periode, net, cout }))).toEqual(ecran);
    expect(ecran[0]).toMatchObject({ net: '1120.386' });
    expect(qui.erreurs).toEqual([]);
  }, 120_000);

  // 1.59.0 (docs/paie.md, « Le métier de la paie, premier lot ») : les primes de chaque mois se posent sur la fiche, une
  // fois ; le bulletin du mois les reprend, au prorata des jours payés pour une prime « au jour » (le journal de paie
  // réel de septembre 2026 prorate ainsi la présence et le transport) ; des barèmes d'avant 2026 se disent.
  it('les primes de chaque mois à la souris : posées sur la fiche, reprises au jour par le bulletin, et des barèmes d\'avant 2026 se disent', async () => {
    const qui = await inscrite('Nour Ben Salah');
    const p = await qui.ouvrir(qui.essai, '#/paie');
    await pageV10(p, /Paie/);
    const auServeur = async () => (await admin.query('select brut, net, primes from paie.bulletin where entreprise = $1', [qui.essai])).rows;
    const fiche = async () => (await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'employees'`, [qui.essai])).rows[0]?.contenu;

    // La fiche, avec ses deux primes : présence et transport, au jour (la case est cochée d'office).
    await p.locator('#emp-first').click();
    // La fenêtre a sa largeur dès l'ouverture : la première prime ne l'élargit pas sous le curseur (vu à l'écran).
    const largeur = () => p.locator('.modal').evaluate((e) => Math.round(e.getBoundingClientRect().width));
    const auDepart = await largeur();
    await p.locator('#ef input[name=name]').fill('Nour Ben Salah');
    await p.locator('#ef input[name=grossSalary]').fill('612');
    const embauche = p.locator('#ef .datefield').filter({ has: p.locator('input[name=hireDate]') }).locator('.d-txt');
    await embauche.fill('01/01/2026');
    await embauche.press('Tab');
    await p.locator('#ef-add-prime').click();
    expect(await largeur()).toBe(auDepart);
    // Le curseur est dans le libellé de la nouvelle ligne.
    expect(await p.evaluate(() => (document.activeElement as HTMLInputElement | null)?.dataset.p)).toBe('label');
    await p.keyboard.type('Prime de présence');
    await p.locator('#ef-primes input[data-p=amount]').nth(0).fill('30');
    await p.locator('#ef-add-prime').click();
    await p.keyboard.type('Prime de transport');
    // Un libellé sans montant se refuse sur SA case ; la fiche reste ouverte.
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#toast').innerText()).toContain('La prime « Prime de transport » n\'a pas de montant');
    expect(await p.locator('#ef').count()).toBe(1);
    expect(await p.evaluate(() => (document.activeElement as HTMLInputElement | null)?.dataset.p)).toBe('amount');
    expect(await fiche()).toBeUndefined();
    await p.locator('#ef-primes input[data-p=amount]').nth(1).fill('50');
    // L'aide de la fiche compte les primes.
    await expect.poll(() => p.locator('#ef-hint').innerText()).toMatch(/Sur ce brut et ses primes/);
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => (await fiche())?.primes?.map((x: { label: string; amount: number; parJour: boolean }) => [x.label, x.amount, x.parJour]))
      .toEqual([['Prime de présence', 30, true], ['Prime de transport', 50, true]]);
    // La liste des salariés estime le net avec les primes : 692 de brut, CNSS 66,986, IRPP 21,877, CSS 2,813.
    await expect.poll(() => p.locator('#p-body tr[data-eid]').first().innerText()).toMatch(/600,324/);
    // Et le brut dit ses primes, que le net estimé compte.
    expect(await p.locator('#p-body tr[data-eid]').first().innerText()).toMatch(/\+ 80,000\sDT de primes/);
    // Sa page aussi, et elle nomme les primes.
    await p.locator('#p-body tr[data-eid]').first().click();
    await pageV10(p, /Nour Ben Salah/);
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/Net estimé\s+600,324[\s\S]*primes de la fiche comprises, hors retenues/i);
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/Primes de chaque mois\s+Prime de présence 30,000\sDT au jour · Prime de transport 50,000\sDT au jour/);
    await p.locator('#back').click();
    await pageV10(p, /Paie/);

    // « Établir le bulletin manquant » : un mois plein, les deux primes entières.
    await p.locator('#p-tabs button[data-tab=bulletins]').click();
    await p.locator('#p-gen').click();
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => (await auServeur())[0]?.primes?.map((x: { montant: number }) => x.montant)).toEqual([30000, 50000]);
    expect((await auServeur())[0]?.brut).toBe(692000n);

    // Six jours et demi sans solde : les primes au jour suivent (19,5 jours payés sur 26), et le disent.
    await p.locator('#p-body tr', { hasText: 'Nour Ben Salah' }).getByRole('button', { name: /Actions/ }).click();
    await p.getByText('Modifier le bulletin', { exact: true }).click();
    // Les primes ont la largeur de la fenêtre : un libellé se lit en entier (côte à côte, « Prime d »).
    expect(await p.locator('#bf-bon input[data-f=label]').first().evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(300);
    await p.locator('#bf input[name=absentDays]').fill('6.5');
    await expect.poll(() => p.locator('#bf-bon').innerText()).toMatch(/au jour\s: 19,5 j payés sur 26 · 30,000\sDT pour un mois plein/);
    expect(await p.locator('#bf-bon input[data-f=amount]').evaluateAll((l) => l.map((x) => Number((x as HTMLInputElement).value)))).toEqual([22.5, 37.5]);
    // Un montant retapé n'est plus « au jour » : sa ligne ne le prétend plus.
    await p.locator('#bf-bon input[data-f=amount]').nth(1).fill('40');
    await expect.poll(() => p.locator('#bf-bon [data-pj]').count()).toBe(1);
    await p.locator('#modal-root #ok').click();
    // 612 − 153 (6,5 jours) + 22,5 + 40 = 521,5 ; le serveur recalcule le bulletin et trouve le même net que l'écran.
    await expect.poll(async () => (await auServeur())[0]?.brut).toBe(521500n);
    const net = await p.evaluate(() => (window as unknown as { __data: { payslips: { computed: { net: number } }[] } }).__data.payslips[0]?.computed.net.toFixed(3));
    expect(String(Number((await auServeur())[0]?.net) / 1000)).toBe(String(Number(net)));
    expect((await auServeur())[0]?.primes.map((x: { libelle: string; montant: number }) => [x.libelle, x.montant])).toEqual([['Prime de présence', 22500], ['Prime de transport', 40000]]);

    // Des barèmes enregistrés avec les taux d'avant 2026 (une entreprise qui les a gardés) : les Barèmes et
    // l'onglet Bulletins le disent ; « Prendre les taux de 2026 » les écrit dans leurs cases, sans rien garder.
    await p.locator('#p-tabs button[data-tab=baremes]').click();
    expect(await p.locator('#rf-2026').count()).toBe(0);
    await p.locator('#rf input[name=cnssEmployee]').fill('9.18');
    await p.locator('#rf input[name=cnssEmployer]').fill('16.57');
    await p.locator('#rf input[name=solidarity]').fill('1');
    await p.locator('#rf-save').click();
    await p.locator('#p-tabs button[data-tab=bulletins]').click();
    await expect.poll(() => p.locator('#p-2026').innerText()).toMatch(/Tes barèmes gardent des taux d'avant 2026 \(CNSS salarié 9,18\s%, CNSS employeur 16,57\s%, solidarité 1\s%\)/);
    await p.locator('#p-2026-voir').click();
    await expect.poll(() => p.locator('#p-tabs button.active').getAttribute('data-tab')).toBe('baremes');
    await expect.poll(() => p.locator('#rf-2026').innerText()).toMatch(/CNSS salarié 9,18\s% au lieu de 9,68\s%, CNSS employeur 16,57\s% au lieu de 17,07\s%, solidarité 1\s% au lieu de 0,5\s%/);
    await p.locator('#rf-2026-prendre').click();
    expect(await p.locator('#rf input[name=cnssEmployee]').inputValue()).toBe('9.68');
    expect(await p.locator('#rf input[name=solidarity]').inputValue()).toBe('0.5');
    // Rien n'est gardé avant « Enregistrer les barèmes ».
    expect((await admin.query(`select contenu->'cnssEmployee'->>'~n' c from socle.dossier_v10 where entreprise = $1 and collection = '_racine' and cle = 'payrollSettings'`, [qui.essai])).rows[0]?.c).toBe('9.18');
    await p.locator('#rf-save').click();
    await expect.poll(async () => (await admin.query(`select contenu->'cnssEmployee'->>'~n' c from socle.dossier_v10 where entreprise = $1 and collection = '_racine' and cle = 'payrollSettings'`, [qui.essai])).rows[0]?.c).toBe('9.68');
    await expect.poll(() => p.locator('#rf-2026').count()).toBe(0);
    await p.locator('#p-tabs button[data-tab=bulletins]').click();
    expect(await p.locator('#p-2026').count()).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-primes.png') });
    expect(qui.erreurs).toEqual([]);
  }, 120_000);

  // 1.60.0 (docs/paie.md, « Le pointage ») : une case par salarié et par jour, à la souris et au clavier ; les jours
  // payés se recalculent à chaque geste ; le bulletin du mois reprend les absences et les heures supplémentaires, et un
  // bulletin établi qui ne suit plus le pointage le dit et se met à jour d'un geste.
  it('le pointage à la souris et au clavier : la grille du mois, les heures supplémentaires, le bulletin qui le suit', async () => {
    const qui = await inscrite('Salma Gharbi');
    await qui.api('GET', `/entreprises/${qui.essai}/dossier-v10`, qui.jeton);
    await qui.api('POST', `/entreprises/${qui.essai}/dossier-v10`, qui.jeton, { changements: [
      { collection: 'employees', cle: 'sal-1', rang: 0, revision: null, contenu: { id: 'sal-1', name: 'Salarié Un', grossSalary: { '~n': '1234.567' }, hireDate: '2020-01-06', contract: 'cdi',
        primes: [{ label: 'Prime de présence', amount: 80, taxable: true, parJour: true }] } },
      { collection: 'employees', cle: 'sal-2', rang: 1, revision: null, contenu: { id: 'sal-2', name: 'Salarié Deux', grossSalary: 980, hireDate: '2021-02-01', contract: 'cdi' } },
    ] });
    const p = await qui.ouvrir(qui.essai, '#/paie');
    await pageV10(p, /Paie/);
    const pointage = async () => (await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'timesheets' and contenu->>'employeeId' = 'sal-1'`, [qui.essai])).rows[0]?.contenu;
    // Le bulletin du salarié 1 d'abord (son brut de base est le plus grand).
    const auServeur = async () => (await admin.query('select brut, net, primes from paie.bulletin where entreprise = $1 order by brut_de_base desc', [qui.essai])).rows;
    await p.locator('#p-tabs button[data-tab=pointage]').click();
    await p.locator('#pt-grille').waitFor();
    // Le mois de paie ouvert (le mois écoulé) : on lit son calendrier pour viser des jours ouvrables et un dimanche.
    const annee = Number(await p.locator('#p-year').inputValue()), mois = Number(await p.locator('#pt-mois').inputValue());
    const jourDeSemaine = (j: number) => new Date(Date.UTC(annee, mois - 1, j)).getUTCDay();
    const dimanche = [...Array(7).keys()].map((i) => i + 1).find((j) => jourDeSemaine(j) === 0) ?? 0;
    // Un lundi et le mardi qui suit : deux jours ouvrables côte à côte.
    const lundi = dimanche + 1;
    const ligne = p.locator('#pt-grille tr[data-pe="sal-1"]');
    const kase = (j: number) => ligne.locator(`.pt-c[data-pt="${j}"]`);
    const payes = () => ligne.locator('[data-pt-payes]').innerText();
    expect(await payes()).toBe('26');
    // Les jours payés se lisent sans faire défiler : juste après le nom (vu à l'écran : derrière trente jours de 48 px).
    const [boite, chiffre] = await Promise.all([p.locator('#pt-grille').locator('xpath=..').boundingBox(), ligne.locator('[data-pt-payes]').boundingBox()]);
    expect((chiffre?.x ?? 1e6) + (chiffre?.width ?? 0)).toBeLessThan((boite?.x ?? 0) + (boite?.width ?? 0));
    // La case du tableau, pas seulement son bouton : une règle de l'application lui donnait 48 px.
    expect((await kase(1).locator('xpath=..').boundingBox())?.width ?? 99).toBeLessThanOrEqual(28);
    expect(await kase(dimanche).innerText()).toBe('R');
    expect(await kase(lundi).innerText()).toBe('P');
    // Sans majoration réglée, pas de colonne d'heures : la grille dit où les régler.
    expect(await p.locator('#pt-grille .pt-hs').count()).toBe(0);
    await expect.poll(() => p.locator('#pt-sans-hs').innerText()).toMatch(/règle d'abord leurs majorations dans les Barèmes/);
    expect(await pointage()).toBeUndefined();

    // Un clic passe au code suivant (présent → demi-journée) ; le curseur reste sur la case.
    await kase(lundi).click();
    await expect.poll(() => kase(lundi).innerText()).toBe('½');
    await expect.poll(payes).toBe('25,5');
    expect(await p.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.pt)).toBe(String(lundi));
    // Une lettre pose son code ; la flèche passe au jour suivant, où une autre lettre pose le sien.
    await p.keyboard.press('a');
    await expect.poll(() => kase(lundi).innerText()).toBe('A');
    await p.keyboard.press('ArrowRight');
    expect(await p.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.pt)).toBe(String(lundi + 1));
    await p.keyboard.press('a');
    await expect.poll(payes).toBe('24');
    expect(await ligne.locator('[data-pt-abs]').innerText()).toBe('2');
    // Un dimanche ne passe que de « Repos » à « Présent » ; une absence s'y refuse, et le dit.
    await kase(dimanche).click();
    await expect.poll(() => kase(dimanche).innerText()).toBe('P');
    await p.keyboard.press('a');
    await expect.poll(() => p.locator('#toast').innerText()).toMatch(new RegExp(`Le ${dimanche} \\S+ est un jour de repos\\s: il se pointe «\\sRepos\\s», ou «\\sPrésent\\s»`));
    expect(await kase(dimanche).innerText()).toBe('P');
    expect(await payes()).toBe('24');
    // Seul ce qui diffère du calendrier est gardé, au serveur.
    await expect.poll(async () => (await pointage())?.jours).toEqual({ [lundi]: 'A', [lundi + 1]: 'A', [dimanche]: 'P' });

    // Les heures supplémentaires : la majoration se règle dans les Barèmes, puis la grille a sa colonne. Le bouton amène
    // à la case (vu à l'écran : en haut d'une longue page), et elle se tape d'emblée.
    await p.locator('#pt-baremes').click();
    await expect.poll(() => p.locator('#p-tabs button.active').getAttribute('data-tab')).toBe('baremes');
    expect(await p.locator('#rf input[name=heuresMois]').inputValue()).toBe('208');
    await expect.poll(() => p.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name)).toBe('hsMaj1');
    await p.keyboard.type('25');
    expect(await p.locator('#rf input[name=hsMaj1]').inputValue()).toBe('25');
    await p.locator('#rf-save').click();
    await expect.poll(async () => (await admin.query(`select contenu->'hsMaj1' m from socle.dossier_v10 where entreprise = $1 and collection = '_racine' and cle = 'payrollSettings'`, [qui.essai])).rows[0]?.m).toBe(25);
    await p.locator('#p-tabs button[data-tab=pointage]').click();
    await expect.poll(() => p.locator('#pt-grille thead').innerText()).toMatch(/HS \+25 %/);
    // Au clavier, comme dans un tableur : Entrée passe au salarié suivant dans la même colonne ; après Tab, la grille se
    // redessine et rend le curseur à la case où Tab l'a posé (vu à l'écran : il se perdait, et la frappe suivante aussi).
    // Les lignes vont par nom : « Salarié Deux », puis « Salarié Un ».
    expect(await p.locator('#pt-grille tbody tr').evaluateAll((l) => l.map((x) => (x as HTMLElement).dataset.pe))).toEqual(['sal-2', 'sal-1']);
    await p.locator('#pt-grille tr[data-pe="sal-2"] .pt-hs[data-hs="25"]').click();
    await p.keyboard.type('4');
    await p.keyboard.press('Enter');
    const ouEst = () => p.evaluate(() => { const a = document.activeElement as HTMLElement | null; return { e: a?.closest('tr')?.dataset.pe, hs: a?.dataset.hs, pt: a?.dataset.pt }; });
    await expect.poll(ouEst).toEqual({ e: 'sal-1', hs: '25', pt: undefined });
    await p.keyboard.type('6');
    await p.keyboard.press('Tab');
    await expect.poll(ouEst).toEqual({ e: 'sal-1', hs: undefined, pt: '1' });
    const heures = async () => ((await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'timesheets'`, [qui.essai])).rows as { contenu: { employeeId: string; hs: Record<string, number> } }[])
      .map((r) => [r.contenu.employeeId, r.contenu.hs]).sort();
    await expect.poll(heures).toEqual([['sal-1', { 25: 6 }], ['sal-2', { 25: 4 }]]);

    // Le bulletin du mois reprend le pointage : deux jours retirés, la prime au jour sur 24 jours, les heures majorées.
    await p.locator('#p-tabs button[data-tab=bulletins]').click();
    await p.locator('#p-gen').click();
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.evaluate(() => (window as unknown as { __data: { payslips: { employeeId: string; absentDays: number }[] } }).__data.payslips.find((x) => x.employeeId === 'sal-1')?.absentDays)).toBe(2);
    // 80 × 24 / 26 = 73,846 ; 1 234,567 × 6 × 1,25 / 208 = 44,516.
    await expect.poll(async () => (await auServeur())[0]?.primes?.map((x: { libelle: string; montant: number }) => [x.libelle, x.montant]))
      .toEqual([['Prime de présence', 73846], ['Heures supplémentaires : 6 h à +25 %', 44516]]);
    const netEcran = async () => p.evaluate(() => (window as unknown as { __data: { payslips: { employeeId: string; computed: { net: number } }[] } }).__data.payslips.find((x) => x.employeeId === 'sal-1')?.computed.net.toFixed(3));
    expect(String(Number((await auServeur())[0]?.net) / 1000)).toBe(String(Number(await netEcran())));

    // Le lundi était un oubli : il revient « Présent ». Le bulletin établi ne suit plus le pointage, et la grille le dit.
    await p.locator('#p-tabs button[data-tab=pointage]').click();
    await kase(lundi).focus();
    await p.keyboard.press('p');
    await expect.poll(payes).toBe('25');
    await expect.poll(() => p.locator('#pt-ecarts').innerText()).toMatch(/Le bulletin de Salarié Un ne suit plus le pointage\s: 2 jours non payés au bulletin, 1 au pointage\./);
    // Sous la grille : apparue, l'alerte ne déplace aucune case (vu à l'écran : au-dessus, elle poussait la grille).
    const [grilleB, alerteB] = await Promise.all([p.locator('#pt-grille').boundingBox(), p.locator('#pt-ecarts').boundingBox()]);
    expect(alerteB?.y ?? 0).toBeGreaterThan((grilleB?.y ?? 1e6) + (grilleB?.height ?? 0));
    await p.locator('#pt-ecarts [data-pt-reprendre]').click();
    await expect.poll(() => p.locator('#pt-ecarts').count()).toBe(0);
    // 80 × 25 / 26 = 76,923 ; les heures ne se doublent pas.
    await expect.poll(async () => (await auServeur())[0]?.primes?.map((x: { montant: number }) => x.montant)).toEqual([76923, 44516]);
    expect(String(Number((await auServeur())[0]?.net) / 1000)).toBe(String(Number(await netEcran())));
    await p.screenshot({ path: path.join(PHOTOS, 'paie-pointage.png') });
    expect(qui.erreurs).toEqual([]);
  }, 120_000);

  // 1.61.0 (docs/paie.md, « Le journal de paie et les états ») : le journal du mois, à l'écran, imprimé et en CSV ; ce que
  // la paie du mois ajoute à la déclaration mensuelle ; l'état récapitulatif CNSS du trimestre, imprimé. Les chiffres
  // sont ceux des bulletins (deux chemins, un chiffre).
  it('le journal de paie et les états à la souris : le journal du mois, la déclaration mensuelle, l\'état récapitulatif CNSS', async () => {
    const qui = await inscrite('Amel Trabelsi');
    await qui.api('GET', `/entreprises/${qui.essai}/dossier-v10`, qui.jeton);
    await qui.api('POST', `/entreprises/${qui.essai}/dossier-v10`, qui.jeton, { changements: [
      // Des noms et des montants de vraie taille (trois salariés, des primes) : avec des noms courts et des petits
      // montants, un journal aux en-têtes sur une ligne tenait quand même à l'écran.
      { collection: 'employees', cle: 'sal-1', rang: 0, revision: null, contenu: { id: 'sal-1', name: 'Salarié Numéro Un', grossSalary: { '~n': '1234.567' }, hireDate: '2020-01-06', contract: 'cdi',
        primes: [{ label: 'Prime de présence', amount: 80, taxable: true, parJour: true }, { label: 'Prime de rendement', amount: { '~n': '125.5' }, taxable: true }] } },
      { collection: 'employees', cle: 'sal-2', rang: 1, revision: null, contenu: { id: 'sal-2', name: 'Salarié Numéro Deux', grossSalary: { '~n': '1520.25' }, hireDate: '2021-02-01', contract: 'cdi',
        primes: [{ label: 'Prime de transport', amount: { '~n': '55.385' }, taxable: true }] } },
      { collection: 'employees', cle: 'sal-3', rang: 2, revision: null, contenu: { id: 'sal-3', name: 'Salarié Numéro Trois', grossSalary: 980, hireDate: '2022-03-01', contract: 'cdi' } },
    ] });
    const p = await qui.ouvrir(qui.essai, '#/paie');
    await pageV10(p, /Paie/);
    await p.locator('#p-tabs button[data-tab=bulletins]').click();
    // Sans bulletin, pas de journal.
    expect(await p.locator('#p-journal').count()).toBe(0);
    await p.locator('#p-gen').click();
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#p-journal').count()).toBe(1);
    type Bulletin = { employeeId: string; month: number; computed: Record<string, number> };
    const bulletins = () => p.evaluate(() => (window as unknown as { __data: { payslips: Bulletin[] } }).__data.payslips);
    const somme = async (k: string) => Math.round((await bulletins()).reduce((a, x) => a + (x.computed[k] ?? 0), 0) * 1000) / 1000;
    const nombre = (t: string) => Number(t.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));

    // Le journal du mois : une ligne par bulletin, dans l'ordre du registre (Salarié Un est entré le premier), les
    // colonnes du journal réel, et des totaux qui sont ceux des bulletins.
    await p.locator('#p-journal').click();
    const journal = p.locator('#jp-table');
    await journal.waitFor();
    expect(await journal.locator('tbody tr[data-jp]').evaluateAll((l) => l.map((x) => (x as HTMLElement).dataset.jp))).toEqual(['sal-1', 'sal-2', 'sal-3']);
    expect(await journal.locator('tbody tr[data-jp] td:first-child').allInnerTexts()).toEqual(['0001', '0002', '0003']);
    // (Le texte des en-têtes, pas leur rendu en capitales.)
    expect((await journal.locator('thead th').allTextContents()).map((x) => x.trim())).toEqual(['N°', 'Salarié', 'J.', 'Base', 'H.S.', 'Indemnités', 'Brut', 'S. cotisable', 'CNSS', 'S. imposable', 'IRPP', 'CSS', 'S. net', 'Retenues', 'Net à payer', 'TFP', 'FOPROLOS', 'AT', 'CNSS pat.']);
    for (const [col, cle] of [['net', 'net'], ['brut', 'gross'], ['cnss', 'cnssEmployee'], ['irpp', 'irpp'], ['patronal', 'cnssEmployer']] as const) {
      expect(nombre(await journal.locator(`tr[data-jp-total] td[data-col=${col}]`).innerText()), col).toBe(await somme(cle));
    }
    // À l'ordinateur, les dix-sept colonnes se lisent sans faire défiler.
    expect(await p.locator('.modal').evaluate((e) => Math.round(e.getBoundingClientRect().width))).toBeGreaterThan(1300);
    expect(await journal.locator('xpath=..').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    // Sur toute machine : les en-têtes des chiffres passent à la ligne, la largeur du tableau est celle de ses chiffres (la
    // nuit du 20/10/2026, sur la machine de GitHub, aux polices plus étroites, des en-têtes qui ne se coupaient pas
    // tenaient encore dans la largeur, et le défaut passait).
    expect(await journal.locator('thead th.r').evaluateAll((l) => l.filter((x) => getComputedStyle(x).whiteSpace === 'nowrap').map((x) => x.textContent))).toEqual([]);
    // Imprimé (le PDF fait par le serveur, 1.88.0) : les mêmes lignes.
    const imprime = await pdfTelecharge(p, () => p.locator('#jp-pdf').click());
    expect(imprime.texte).toContain('Nombre de salariés : 3');
    expect(imprime.texte).toMatch(/Journal de paie[\s\S]*0001 Salarié Numéro Un/);
    // En CSV, pour le comptable : une ligne par bulletin et le total.
    const [csv] = await Promise.all([p.waitForEvent('download'), p.locator('#jp-csv').click()]);
    expect(csv.suggestedFilename()).toMatch(/^Journal_de_paie_\d{4}-\d{2}\.csv$/);
    const lignes = fs.readFileSync(await csv.path(), 'utf8').replace(/^\ufeff/, '').trim().split('\r\n');
    expect(lignes.map((l) => l.split(';').slice(0, 2).join(';'))).toEqual(['N°;Salarié', '1;Salarié Numéro Un', '2;Salarié Numéro Deux', '3;Salarié Numéro Trois', ';Total']);
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('#jp-table').count()).toBe(0);
    // On regarde un autre mois des bulletins : la déclaration mensuelle, elle, s'ouvre sur le mois qu'on déclare maintenant
    // (vu à l'écran le 19 octobre : elle suivait le mois des bulletins, et s'ouvrait sur octobre, vide).
    const moisBulletins = Number((await bulletins())[0]?.month);
    await p.locator('#p-month').selectOption(String(moisBulletins === 12 ? 11 : moisBulletins + 1));
    await expect.poll(() => p.locator('#p-journal').count()).toBe(0);

    // Les déclarations : ce que la paie du mois ajoute à la déclaration mensuelle, les montants des bulletins.
    await p.locator('#p-tabs button[data-tab=declarations]').click();
    const annee = Number(await p.locator('#p-year').inputValue());
    const mois = Number(await p.locator('#dm-mois').inputValue());
    expect(mois).toBe(moisBulletins);
    const dm = p.locator('#dm-table');
    expect(await dm.locator('tr[data-dm]').evaluateAll((l) => l.map((x) => (x as HTMLElement).dataset.dm))).toEqual(['irpp', 'css', 'tfp', 'foprolos']);
    for (const [cle, k] of [['irpp', 'irpp'], ['css', 'css'], ['tfp', 'tfp'], ['foprolos', 'foprolos']] as const) {
      expect(nombre((await dm.locator(`tr[data-dm=${cle}] td`).last().innerText()).replace(/DT/, '')), cle).toBe(await somme(k));
    }
    const suivant = mois === 12 ? `28/01/${annee + 1}` : `28/${String(mois + 1).padStart(2, '0')}/${annee}`;
    // (L'espace avant les deux-points est insécable.)
    expect(await p.locator('#dm-panneau .filters span').innerText()).toMatch(new RegExp(`^Échéance usuelle\\s: ${suivant}, avec la TVA du mois$`));
    const [dmCsv] = await Promise.all([p.waitForEvent('download'), p.locator('#dm-csv').click()]);
    expect(fs.readFileSync(await dmCsv.path(), 'utf8').replace(/^\ufeff/, '').split('\r\n')[0]).toBe('Impôt ou taxe;Base;Taux (%);Montant');
    // Un mois sans bulletin le dit.
    await p.locator('#dm-mois').selectOption(String(mois === 1 ? 2 : mois - 1));
    await expect.poll(() => p.locator('#dm-vide').innerText()).toMatch(/la paie n'ajoute rien à la déclaration de ce mois-là/);
    await p.locator('#dm-mois').selectOption(String(mois));
    await dm.waitFor();

    // L'état récapitulatif CNSS du trimestre : les cotisations sur le total des salaires, au taux du régime, et le total
    // des salaires en lettres ; il s'imprime.
    await p.locator('#d-quarter').selectOption(String(Math.ceil(mois / 3)));
    const etat = p.locator('#cn-etat');
    await etat.waitFor();
    const salaires = await somme('cnssBase');
    expect(nombre((await etat.locator('[data-etat=salaires]').innerText()).replace(/DT/, ''))).toBe(salaires);
    expect(nombre((await etat.locator('[data-etat=secu]').innerText()).replace(/DT/, ''))).toBe(Math.round(salaires * 26.75 * 10) / 1000);
    expect(await etat.innerText()).toMatch(/Sécurité sociale\s+26,75\s%/);
    const KC = ecranDeLaPlateforme('core.js') as { amountToWords: (n: number, c: string) => string };
    expect(await etat.locator('[data-etat=lettres]').innerText()).toBe(KC.amountToWords(salaires, 'DT'));
    const etatImprime = await pdfTelecharge(p, () => p.locator('#cn-etat-pdf').click());
    expect(etatImprime.texte).toContain('État récapitulatif des salaires déclarés');
    expect(etatImprime.texte).toContain(KC.amountToWords(salaires, 'DT').replace(/[\u00a0\u202f]/g, ' '));
    // (1.73.0) La déclaration annuelle d'employeur : « Net des bulletins » (la tuile « Net versé » ne compte que les bulletins
    // payés), et son état en CSV aux colonnes du moteur commun, que le Cabinet exporte aussi, avec son total.
    expect(await p.locator('h2', { hasText: 'Déclaration annuelle d\'employeur' }).locator('xpath=..').locator('thead th').allTextContents()).toContain('Net des bulletins');
    const [anCsv] = await Promise.all([p.waitForEvent('download'), p.locator('#an-csv').click()]);
    const lignesAn = fs.readFileSync(await anCsv.path(), 'utf8').replace(/^\ufeff/, '').split('\r\n').filter(Boolean);
    expect(lignesAn[0]).toBe('Salarié;CIN;N° CNSS;Mois payés;Brut annuel;CNSS retenue;IRPP retenu;Solidarité;Net des bulletins');
    expect(lignesAn.at(-1)).toMatch(/^Total;;;;\d/);
    await p.screenshot({ path: path.join(PHOTOS, 'paie-etats.png') });
    expect(qui.erreurs).toEqual([]);
  }, 120_000);

  // 1.62.0 (docs/paie.md, « L'absence du mois d'une entrée ») : le bulletin d'un mois d'entrée avec une absence sans solde,
  // établi, puis rouvert et enregistré à la souris. L'absence se retire au taux du salaire du contrat, la fenêtre du
  // bulletin aussi, et le serveur refait le bulletin au millime.
  it('l\'absence du mois d\'une entrée à la souris : établi, rouvert et enregistré, le bulletin retire l\'absence au taux du contrat, et le serveur le refait', async () => {
    const qui = await inscrite('Rim Haddad');
    // Le mois de paie d'une entreprise neuve : le mois écoulé. L'entrée le 15 ; deux jours ouvrables sans solde ensuite.
    const auj = new Date();
    const an = auj.getUTCMonth() === 0 ? auj.getUTCFullYear() - 1 : auj.getUTCFullYear(), mo = auj.getUTCMonth() === 0 ? 12 : auj.getUTCMonth();
    const jour = (j: number) => `${an}-${String(mo).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
    const ouvrables = [...Array(12).keys()].map((k) => k + 17).filter((j) => new Date(`${jour(j)}T00:00:00Z`).getUTCDay() !== 0).slice(0, 2);
    await qui.api('GET', `/entreprises/${qui.essai}/dossier-v10`, qui.jeton);
    await qui.api('POST', `/entreprises/${qui.essai}/dossier-v10`, qui.jeton, { changements: [
      { collection: 'employees', cle: 'sal-e', rang: 0, revision: null, contenu: { id: 'sal-e', name: 'Salarié Entré', grossSalary: 1300, hireDate: jour(15), contract: 'cdi' } },
      { collection: 'leaves', cle: 'l1', rang: 0, revision: null, contenu: { id: 'l1', employeeId: 'sal-e', kind: 'sans-solde', from: jour(ouvrables[0] ?? 17), to: jour(ouvrables[1] ?? 18) } },
    ] });
    const p = await qui.ouvrir(qui.essai, '#/paie');
    await pageV10(p, /Paie/);
    await p.locator('#p-tabs button[data-tab=bulletins]').click();
    await p.locator('#p-gen').click();
    await p.locator('#modal-root #ok').click();
    type Calcul = { baseGross: number; absenceCut: number; absentDays: number; brutDuMois: number; net: number };
    const calcul = () => p.evaluate(() => (window as unknown as { __data: { payslips: { computed: Calcul }[] } }).__data.payslips[0]?.computed);
    await expect.poll(async () => (await calcul())?.absentDays).toBe(2);
    // 1 300 × 2 / 26 = 100 retenus, sur le salaire du contrat (et non sur le brut proratisé du mois).
    expect([(await calcul())?.absenceCut, (await calcul())?.brutDuMois]).toEqual([100, 1300]);
    const auServeur = async () => (await admin.query('select brut_du_mois, retenue_absence, net from paie.bulletin where entreprise = $1', [qui.essai])).rows[0];
    await expect.poll(async () => (await auServeur())?.retenue_absence).toBe(100000n);
    expect((await auServeur())?.brut_du_mois).toBe(1300000n);
    // Rouvert et enregistré tel quel : la fenêtre calcule avec le prorata du mois, l'absence ne change pas.
    await p.locator('#p-body tr', { hasText: 'Salarié Entré' }).getByRole('button', { name: /Actions/ }).click();
    await p.getByText('Modifier le bulletin', { exact: true }).click();
    await expect.poll(() => p.locator('#bf-calc').innerText()).toMatch(/dont absence retirée\s+−\s100,000\sDT/);
    await p.locator('#modal-root #ok').click();
    // (Rien n'a changé : le dossier ne renvoie pas le bulletin, le serveur garde sa révision.)
    await expect.poll(() => p.locator('#bf').count()).toBe(0);
    expect([(await calcul())?.absenceCut, (await auServeur())?.retenue_absence, (await auServeur())?.brut_du_mois]).toEqual([100, 100000n, 1300000n]);
    expect(String(Number((await auServeur())?.net) / 1000)).toBe(String((await calcul())?.net));
    // Le journal : les jours payés du bulletin, et une base qui est le salaire du contrat sur ces jours.
    await p.locator('#p-journal').click();
    const ligneJ = p.locator('#jp-table tr[data-jp="sal-e"]');
    const jours = Number((await ligneJ.locator('td[data-col=jours]').innerText()).replace(',', '.'));
    const base = Number((await ligneJ.locator('td[data-col=base]').innerText()).replace(/\s/g, '').replace(',', '.'));
    expect(base).toBe(Math.round(1300 * jours / 26 * 1000) / 1000);
    expect(qui.erreurs).toEqual([]);
  }, 120_000);

  // La caisse en ligne (brique 115) : avant elle, « Encaisser » se refusait avec sa phrase ; le ticket part maintenant au
  // serveur, qui le numérote dans sa série et le garde (l'entreprise d'essai comprise).
  it('la caisse est en ligne : « Encaisser » vend un pain, numéroté par le serveur, et le ticket est au serveur', async () => {
    const qui = await inscrite('Walid Chaabane');
    // Un compte de caisse et un article au prix connu : tout ce que la caisse de la v10 demande (le
    // dossier est d'abord lu, comme l'écran le fait : c'est la première lecture qui l'amorce).
    await qui.api('GET', `/entreprises/${qui.essai}/dossier-v10`, qui.jeton);
    await qui.api('POST', `/entreprises/${qui.essai}/dossier-v10`, qui.jeton, { changements: [
      { collection: 'accounts', cle: 'cai', rang: 0, revision: null, contenu: { id: 'cai', name: 'Caisse du magasin', kind: 'caisse' } },
      { collection: 'catalog', cle: 'art1', rang: 0, revision: null, contenu: { id: 'art1', label: 'Pain de campagne', unitPrice: { '~n': '0.25' }, vatRate: 0 } },
    ] });
    // La caisse s'ouvre sur cet appareil, avec son fond (brique 116).
    expect((await qui.api('POST', `/entreprises/${qui.essai}/caisse/ouvrir`, qui.jeton, { fond: '50' })).fond).toBe('50.000');
    const p = await qui.ouvrir(qui.essai, '#/caisse');
    await p.locator('#view h1').filter({ hasText: /Caisse/ }).first().waitFor();
    await plusTard(p);
    await p.locator('#cs-articles [data-art]').first().click();
    await p.locator('#cs-encaisser').click();
    await p.locator('#cs-valider').click();
    await expect.poll(() => p.locator('#toast').innerText()).toMatch(/^Ticket TIC-\d{4}-001 encaissé/);
    await p.screenshot({ path: path.join(PHOTOS, 'caisse-essai.png') });
    expect((await admin.query(`select contenu->>'number' n from socle.dossier_v10 where entreprise = $1 and collection = 'documents'`, [qui.essai])).rows.map((r) => r.n))
      .toEqual([expect.stringMatching(/^TIC-\d{4}-001$/)]);
    expect(await p.getByText('Rien n\'a été enregistré').count()).toBe(0);
    expect(qui.erreurs).toEqual([]);
  }, 120_000);
});
