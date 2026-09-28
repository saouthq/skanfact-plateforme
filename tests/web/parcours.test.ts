// Le parcours joué comme une personne (règle du projet : rien ne s'annonce avant d'avoir été refait à
// la souris et vu à l'écran), de bout en bout : créer son compte (un mot de passe trop court se
// refuse sur son champ), se tromper de mot de passe, se connecter, choisir la découverte sur la porte,
// poser le code du téléphone ; puis, dans l'application v10 servie par la plateforme : une facture
// pour un client créé depuis l'éditeur, émise par le serveur (le numéro de sa série, le même net à
// payer à l'écran et au serveur), retrouvée après rechargement ; se déconnecter par le menu du haut,
// et revenir d'un autre appareil avec le code à six chiffres. Chaque bouton est trouvé par ce qu'il
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
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

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

    // Se tromper de mot de passe, puis se connecter.
    await ecran(p, 'ecran.connexion.titre');
    await champ(p, 'ecran.connexion.email').fill(email);
    await champ(p, 'ecran.connexion.mot_de_passe').fill('pas-le-bon-mot');
    await bouton(p, 'ecran.connexion.bouton').click();
    await expect.poll(() => p.getByRole('alert').first().innerText()).toBe(phrase('connexion.refusee'));
    await champ(p, 'ecran.connexion.mot_de_passe').fill('Un-bon-mot-de-passe');
    await bouton(p, 'ecran.connexion.bouton').click();

    // La porte : la découverte ; le rôle de propriétaire exige alors le code du téléphone, d'abord.
    await ecran(p, 'ecran.porte.titre');
    await bouton(p, 'ecran.porte.essai_bouton').click();
    await ecran(p, 'ecran.code_requis.titre');
    await bouton(p, 'ecran.code_requis.bouton').click();
    await ecran(p, 'ecran.code_pose.titre');
    const secret = /secret=([A-Z2-7]+)/.exec(await p.locator('code').innerText())?.[1] ?? '';
    expect(secret).not.toBe('');
    await bouton(p, 'ecran.code_pose.bouton').click();

    // L'application v10 de l'entreprise d'essai s'ouvre.
    await p.waitForURL(/\/v10\/\?e=[0-9a-f-]{36}/, { timeout: 15_000 });
    const ent = new URL(p.url()).searchParams.get('e') ?? '';
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await plusTard(p);
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
    await champ(q, 'ecran.connexion.email').fill(email);
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
});
