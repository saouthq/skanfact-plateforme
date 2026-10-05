// Le parcours joué comme une personne (règle du projet : rien ne s'annonce avant d'avoir été refait à
// la souris et vu à l'écran), de bout en bout : créer son compte (un mot de passe trop court se
// refuse sur son champ) et s'y retrouver connecté, choisir la découverte sur la porte,
// poser le code du téléphone ; puis, dans l'application v10 servie par la plateforme : une facture
// pour un client créé depuis l'éditeur, émise par le serveur (le numéro de sa série, le même net à
// payer à l'écran et au serveur), retrouvée après rechargement ; se déconnecter par le menu du haut,
// et revenir d'un autre appareil (un mauvais mot de passe d'abord) avec le code à six chiffres. Chaque bouton est trouvé par ce qu'il
// dit, jamais par son rang.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { LONGUEUR_MINIMALE } from '../../commun/compte.ts';
import { motif, rendre, t } from '../../textes/index.ts';
import '../../web/src/textes.ts';
import { versionDuCode } from '../../serveur/ecrans.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import * as jsqr from 'jsqr';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const titre = (cle: string, v: Record<string, string> = {}) => { const s = rendre(t(cle, v), 'fr'); return s.charAt(0).toUpperCase() + s.slice(1); };
const phrase = (cle: string, v = {}) => rendre(motif(cle, v), 'fr');

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
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
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

    // La porte : la découverte ; le rôle de propriétaire exige alors le code du téléphone, d'abord.
    await ecran(p, 'ecran.porte.titre');
    await bouton(p, 'ecran.porte.essai_bouton').click();
    await ecran(p, 'ecran.code_requis.titre');
    await bouton(p, 'ecran.code_requis.bouton').click();
    await ecran(p, 'ecran.code_pose.titre');
    // Le téléphone scanne le code QR (brique 145) : l'image dessinée, relue par un lecteur de QR.
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
    const secret = new URL(lu).searchParams.get('secret') ?? '';
    // La clé écrite en clair est la même, par groupes de quatre (pour qui la tape à la main) ; le lien ouvre l'application.
    expect((await p.locator('.code-cle').innerText()).replace(/\s/g, '')).toBe(secret);
    expect(await p.getByRole('link', { name: titre('ecran.code_pose.ouvrir') }).getAttribute('href')).toBe(lu);
    // Un code faux ne laisse pas partir : le refus le dit, sur son champ.
    const champCode = champ(p, 'ecran.code_pose.essai');
    const juste = codeTotp(depuisBase32(secret), Date.now());
    await champCode.fill(juste === '000000' ? '111111' : '000000');
    await bouton(p, 'ecran.code_pose.bouton').click();
    await expect.poll(() => p.getByRole('alert').first().innerText()).toBe(phrase('compte.code_essai_faux'));
    expect(await champCode.evaluate((e) => e === document.activeElement)).toBe(true);
    await ecran(p, 'ecran.code_pose.titre');
    await p.screenshot({ path: path.join(PHOTOS, 'parcours-0-code-qr.png') });
    // Le code que montre le téléphone : on continue.
    await champCode.fill(codeTotp(depuisBase32(secret), Date.now()));
    await bouton(p, 'ecran.code_pose.bouton').click();

    // L'application v10 de l'entreprise d'essai s'ouvre.
    await p.waitForURL(/\/v10\/\?e=[0-9a-f-]{36}/, { timeout: 15_000 });
    const ent = new URL(p.url()).searchParams.get('e') ?? '';
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await plusTard(p);
    // Au pied du menu, la version du code qui tourne (le jour de l'envoi et son empreinte), jamais « vdev » : c'est ce
    // qu'un testeur recopie quand il signale un problème (vu sur le serveur d'essai le 05/10/2026).
    await expect.poll(() => p.locator('#app-version').innerText()).toBe(`v${versionDuCode()}`);
    expect(versionDuCode()).toMatch(/^20\d\d\.\d\d\.\d\d · [0-9a-f]{7,}$/);
    await p.screenshot({ path: path.join(PHOTOS, 'parcours-1-accueil.png') });

    // Une facture, dans l'éditeur de la v10 : le client se crée depuis l'éditeur, et revient choisi.
    await p.getByRole('link', { name: 'Factures', exact: true }).click();
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
    await p.getByRole('link', { name: 'Factures', exact: true }).click();
    await pageV10(p, /Factures/);
    await plusTard(p);
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/FAC-2026-001[\s\S]*Boulangerie Ennour/);
    await p.screenshot({ path: path.join(PHOTOS, 'parcours-4-liste.png') });

    // Se déconnecter par le menu du haut de la v10.
    await p.locator('#brand-btn').click();
    await p.getByRole('button', { name: 'Se déconnecter' }).click();
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
    await champ(q, 'ecran.code.champ').fill('000000');
    await bouton(q, 'ecran.code.bouton').click();
    await expect.poll(() => q.getByRole('alert').first().innerText()).toBe(phrase('connexion.code_faux'));
    await champ(q, 'ecran.code.champ').fill(codeTotp(depuisBase32(secret), Date.now()));
    await bouton(q, 'ecran.code.bouton').click();
    await q.waitForURL(new RegExp(`/v10/\\?e=${ent}`), { timeout: 15_000 });
    await q.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await plusTard(q);
    // Sur le téléphone, le menu s'ouvre par son bouton.
    await q.getByRole('button', { name: 'Menu', exact: true }).click();
    await q.getByRole('link', { name: 'Factures', exact: true }).click();
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

  it('dans une vraie entreprise : l\'exemple mène à l\'entreprise d\'essai sans rien écrire, les réglages de l\'ordinateur n\'apparaissent pas, un fichier exporté se télécharge', async () => {
    const qui = await inscrite('Mourad Trabelsi');
    const vraie = String((await qui.api('POST', '/entreprises', qui.jeton, { raisonSociale: 'Atelier Mourad SARL' })).id);
    const p = await qui.ouvrir(vraie, '#/parametres');
    // Un fichier « enregistré » par la v10 arrive dans les téléchargements, sous son nom.
    const [fichier] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => (window as unknown as { skanfact: { saveText: (n: string, c: string) => Promise<string> } }).skanfact.saveText('journal-ventes-2026.csv', 'a;b\n1;2'))]);
    expect(fichier.suggestedFilename()).toBe('journal-ventes-2026.csv');
    expect(fs.readFileSync(await fichier.path(), 'utf8')).toBe('a;b\n1;2');
    const avant = (await admin.query('select count(*)::int n from socle.dossier_v10 where entreprise = $1', [vraie])).rows[0].n;
    // Données et sécurité : ni sauvegardes du disque, ni mot de passe du fichier, ni « Tout effacer ».
    await p.getByText('Données et sécurité', { exact: true }).click();
    await expect.poll(() => p.locator('#p-exemple').isVisible()).toBe(true);
    for (const id of ['p-sauvegardes', 'p-externe', 'p-motdepasse', 'p-danger', 'p-dossiers']) expect(await p.locator(`#${id}`).isVisible()).toBe(false);
    await p.screenshot({ path: path.join(PHOTOS, 'reglages-donnees.png') });
    // « Charger l'exemple » ouvre l'entreprise d'essai, et n'a rien écrit dans la vraie.
    await p.locator('#load-demo').click();
    await p.waitForURL(new RegExp(`/v10/\\?e=${qui.essai}`), { timeout: 15_000 });
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    expect((await admin.query('select count(*)::int n from socle.dossier_v10 where entreprise = $1', [vraie])).rows[0].n).toBe(avant);
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
    await p.locator('#nav a[href="#/achats"], a[href="#/achats"]').first().click();
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
    await p.locator('#nav a[href="#/achats"], a[href="#/achats"]').first().click();
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
    // Calculé à la main dans tests/v10/paie.test.ts : brut 1 385,122 ; net 1 120,270.
    await expect.poll(auServeur).toMatchObject([{ nom: 'Sonia Trabelsi', brut: 1385122n, net: 1120270n, paye_le: null, cnss: '91800' }]);
    const [premier] = await auServeur();
    await expect.poll(() => p.locator('#p-body tr', { hasText: 'Sonia Trabelsi' }).innerText()).toMatch(/1\s?120,270/);

    // Une loi de finances : la CNSS du salarié passe à 9,68 % dans les barèmes. Le bulletin établi
    // garde la sienne : marqué payé ensuite, il ne change pas d'un millime.
    await p.locator('#p-tabs button[data-tab=baremes]').click();
    await p.locator('#rf input[name=cnssEmployee]').fill('9.68');
    await p.locator('#rf-save').click();
    await expect.poll(async () => (await admin.query(`select contenu->'cnssEmployee'->>'~n' c from socle.dossier_v10 where entreprise = $1 and collection = '_racine' and cle = 'payrollSettings'`, [qui.essai])).rows[0]?.c).toBe('9.68');
    await p.locator('#p-tabs button[data-tab=bulletins]').click();
    await p.locator('#p-body [data-payer]').click();
    await expect.poll(async () => (await auServeur())[0]?.paye_le).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await auServeur())[0]).toMatchObject({ net: 1120270n, cnss: '91800' });

    // Le mois suivant se calcule avec le nouveau barème.
    const suivant = Number(premier?.mois) === 12 ? 1 : Number(premier?.mois) + 1;
    if (suivant === 1) await p.locator('#p-year').selectOption(String(Number(premier?.annee) + 1));
    await p.locator('#p-month').selectOption(String(suivant));
    await p.locator('#p-gen').click();
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => (await auServeur()).length).toBe(2);
    const [, second] = await auServeur();
    expect(second).toMatchObject({ cnss: '96800', brut: 1234567n });
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
    expect(ecran[0]).toMatchObject({ net: '1120.270' });
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
    await expect.poll(() => p.locator('#toast').innerText()).toMatch(/^Ticket TIC-\d{4}-001 encaissé/);
    await p.screenshot({ path: path.join(PHOTOS, 'caisse-essai.png') });
    expect((await admin.query(`select contenu->>'number' n from socle.dossier_v10 where entreprise = $1 and collection = 'documents'`, [qui.essai])).rows.map((r) => r.n))
      .toEqual([expect.stringMatching(/^TIC-\d{4}-001$/)]);
    expect(await p.getByText('Rien n\'a été enregistré').count()).toBe(0);
    expect(qui.erreurs).toEqual([]);
  }, 120_000);
});
