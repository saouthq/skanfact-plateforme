// L'exemple rempli, et « Faire une facture » pas à pas, à l'écran (retour de Skander, 05/10/2026 ; docs/exemple.md ;
// serveur/v10/exemple.ts, web/v10/exemple.txt). Skander, sur un compte neuf : « le jeu d'exemple ne marche pas, il me dit
// tu es déjà dans l'exemple mais il n'y a rien dessus afin de faire la visite guidée, et l'assistant de remplissage ne
// guide pas pour une facture, il le fait pour un devis ». Ce que ce parcours tient :
//   - « Commencer la découverte » sur la porte : l'entreprise d'essai s'ouvre, une fenêtre dit que l'exemple se prépare,
//     le serveur la remplit, la page s'ouvre toute seule dessus, et la découverte démarre sur des pièces ;
//   - la découverte va au bout, et sa fin ne parle pas de licence ; « Passer à ma vraie entreprise » demande la raison
//     sociale, crée l'entreprise, l'ouvre sur l'assistant de démarrage, et la visite des premiers pas y démarre ensuite ;
//   - dans la vraie entreprise, « Guide-moi » sur une nouvelle facture propose « Faire une facture », qui mène geste après
//     geste jusqu'au brouillon enregistré, au millime ;
//   - « Me guider » ne propose pas les visites sans objet en ligne (les sauvegardes, les mises à jour…) ; les Paramètres
//     ne montrent pas de puce vers un panneau absent ;
//   - « Ouvrir l'exemple », depuis la vraie entreprise, ramène à l'entreprise d'essai déjà remplie, sans rien y reverser
//     et sans rien écrire dans la vraie.
// Les données discriminent : 12 × 18,750 à 19 %, timbre 1,000 → 268,750 DT.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import pg from 'pg';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('l\'exemple rempli et « Faire une facture », à l\'écran', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-exemple-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return (texte ? JSON.parse(texte) : {}) as Record<string, unknown>;
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  const bulle = (p: Page) => p.locator('#visite-bulle');
  const titreBulle = (p: Page) => p.locator('#visite-bulle #visite-titre').innerText().then(net).catch(() => '');
  const classeBulle = (p: Page) => bulle(p).getAttribute('class').then((c) => c ?? '').catch(() => '');
  const lignes = (p: Page, cle: string) => p.locator(`#lines tr:first-child input[data-k="${cle}"]`);
  const compter = async (table: string, ent: string) => Number((await admin.query(`select count(*)::int n from ${table} where entreprise = $1`, [ent])).rows[0].n);

  it('Skander, sur un compte neuf : l\'exemple se remplit, la découverte va au bout, puis sa vraie entreprise et sa première facture, guidée jusqu\'au brouillon', async () => {
    // Un compte neuf, son code posé ; aucune entreprise encore : la porte.
    const email = `skander-exemple-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Skander', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).adresseApplication))?.[1] ?? '';
    const defi = (await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Portable', type: 'navigateur' } })).defi;
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi, code: codeTotp(depuisBase32(secret), Date.now()) })).jeton);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(`${e.message} @ ${p.url()}`));
    await p.goto(serveur.adresse);

    // 1. La porte : « Commencer la découverte ». L'exemple se prépare, puis la page s'ouvre dessus, et la découverte
    // démarre sur des pièces.
    await p.getByRole('button', { name: 'Commencer la découverte', exact: true }).click();
    await p.waitForURL(/\/v10\/\?e=[0-9a-f-]{36}/, { timeout: 20_000 });
    const essai = new URL(p.url()).searchParams.get('e') ?? '';
    await expect.poll(() => p.locator('#modal-root').innerText().then(net).catch(() => ''), { timeout: 20_000 }).toMatch(/^L'exemple se prépare Cinq ans d'une entreprise inventée/);
    // Le serveur verse l'exemple (une minute, plus sur une petite machine), puis la page s'ouvre dessus.
    await expect.poll(() => p.locator('#view .demo-banner').isVisible().catch(() => false), { timeout: 240_000 }).toBe(true);
    await expect.poll(() => titreBulle(p), { timeout: 20_000 }).toBe('Bienvenue dans l\'exemple');
    expect(await compter('ventes.piece', essai)).toBeGreaterThan(250);
    expect(net(await p.locator('#view').innerText())).toMatch(/À faire \d+/);
    await p.screenshot({ path: path.join(PHOTOS, 'exemple-1-decouverte.png') });

    // 2. La découverte, chapitre après chapitre, jusqu'à sa fin ; aucune bulle perdue en chemin.
    for (let i = 0; i < 40 && !/\bfin\b/.test(await classeBulle(p)); i++) {
      await p.waitForTimeout(900);
      expect(await classeBulle(p), await titreBulle(p)).not.toMatch(/perdu/);
      const chapitre = bulle(p).locator('[data-v=chapitre]');
      await (await chapitre.count() ? chapitre : bulle(p).locator('[data-v=suiv]')).first().click();
    }
    expect(await titreBulle(p)).toBe('Tu as fait le tour !');
    const fin = net(await bulle(p).innerText());
    expect(fin).toContain('abonnement réglé ou pas, tu gardes la lecture, l\'impression et l\'export');
    expect(fin).not.toMatch(/licence/i);

    // 3. « Passer à ma vraie entreprise » : sa raison sociale, et elle s'ouvre sur l'assistant de démarrage (lot
    // onboarding), traversé ici sans rien remplir (« Je le ferai plus tard », « Plus tard », le réel, le menu proposé) ;
    // la visite des premiers pas démarre ensuite.
    await bulle(p).getByRole('button', { name: /Passer à ma vraie entreprise/ }).click();
    await expect.poll(() => p.locator('#modal-root h2').first().innerText().catch(() => '')).toBe('Ta vraie entreprise');
    await p.locator('#modal-root label.field').filter({ hasText: 'Raison sociale' }).locator('input').fill('Quincaillerie El Amen');
    await p.locator('#modal-root').getByRole('button', { name: 'Créer et ouvrir', exact: true }).click();
    await p.waitForURL((u) => /\/v10\/\?e=[0-9a-f-]{36}/.test(u.href) && !u.href.includes(essai), { timeout: 20_000 });
    const vraie = new URL(p.url()).searchParams.get('e') ?? '';
    const assistant = p.locator('#setup.as');
    await assistant.getByRole('heading', { level: 1 }).filter({ hasText: /^Où te joindre/ }).waitFor({ timeout: 20_000 });
    await assistant.getByRole('button', { name: 'Je le ferai plus tard', exact: true }).click();
    await assistant.getByRole('button', { name: 'Plus tard', exact: true }).click();
    await assistant.getByRole('heading', { level: 1 }).filter({ hasText: /^Factures-tu la TVA/ }).waitFor();
    await assistant.getByRole('button', { name: 'Continuer', exact: true }).click();
    await assistant.getByRole('button', { name: 'Ouvrir mon entreprise', exact: true }).click();
    await assistant.waitFor({ state: 'detached' });
    await expect.poll(() => titreBulle(p), { timeout: 20_000 }).toBe('Ta vraie entreprise');
    const moi = await api('GET', '/moi', jeton) as { entreprises: { id: string; essai: boolean; nom?: string; raisonSociale?: string }[] };
    expect(moi.entreprises.find((e) => e.id === vraie)?.essai).toBe(false);
    await p.keyboard.press('Escape');

    // 4. « Guide-moi » sur une nouvelle facture propose « Faire une facture », qui mène jusqu'au brouillon.
    await p.getByRole('button', { name: '+ Nouvelle facture' }).first().click();
    await p.locator('#view h1').filter({ hasText: 'Nouvelle facture' }).waitFor({ timeout: 15_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await p.getByRole('button', { name: 'Guide-moi', exact: true }).click();
    const menu = p.locator('.guide-menu');
    await expect.poll(() => menu.innerText().then(net).catch(() => '')).toContain('Faire une facture');
    await menu.getByText('Faire une facture', { exact: true }).click();
    await expect.poll(() => titreBulle(p)).toBe('Choisis le client');
    // Le client n'existe pas encore : il se crée depuis la liste, sans quitter la facture.
    await p.locator('[data-combo=clientId] .combo-btn').click();
    await p.getByRole('button', { name: '+ Nouveau client' }).click();
    await p.locator('#cf input[name=name]').fill('Société Hammami Bâtiment');
    await p.locator('#modal-root').getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(() => p.locator('[data-combo=clientId] .combo-val').innerText()).toContain('Société Hammami Bâtiment');
    const gestes: Record<string, () => Promise<void>> = {
      'L\'objet': () => p.locator('#view input[name="subject"]').fill('Fourniture de quincaillerie, chantier de Sousse'),
      'La désignation': () => lignes(p, 'label').fill('Ciment gris, sac 50 kg'),
      'La quantité': () => lignes(p, 'qty').fill('12'),
      'Le prix unitaire hors taxe': () => lignes(p, 'unitPrice').fill('18.75'),
    };
    const vus: string[] = [];
    for (let i = 0; i < 40; i++) {
      await p.waitForTimeout(700);
      const t = await titreBulle(p);
      const c = await classeBulle(p);
      if (/\bfin\b/.test(c)) break;
      expect(c, t).not.toMatch(/perdu/);
      if (vus.at(-1) === t) continue;
      vus.push(t);
      if (gestes[t]) await gestes[t]();
      if (t === 'Enregistrer le brouillon') { await p.locator('#save').click(); continue; }
      await bulle(p).locator('[data-v=suiv]').first().click();
    }
    expect(await titreBulle(p)).toBe('Ta facture est prête');
    expect(vus).toEqual(expect.arrayContaining(['Choisis le client', 'La retenue à la source', 'Le timbre fiscal', 'La désignation', 'Le prix unitaire hors taxe', 'Les totaux', 'L\'aperçu', 'Enregistrer le brouillon']));
    expect(net(await p.locator('#totals').innerText())).toMatch(/268,750/);
    const docs = ((await api('GET', `/entreprises/${vraie}/dossier-v10`, jeton)).objets as { collection: string; contenu: Record<string, unknown> }[])
      .filter((o) => o.collection === 'documents').map((o) => o.contenu);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ type: 'facture', status: 'brouillon', subject: 'Fourniture de quincaillerie, chantier de Sousse' });
    await p.screenshot({ path: path.join(PHOTOS, 'exemple-2-facture-guidee.png') });
    await bulle(p).getByRole('button', { name: 'Terminer', exact: true }).click();

    // 5. « Me guider » : pas de visite sans objet en ligne ; « Faire une facture » y est.
    await p.evaluate(() => { location.hash = '#/guide'; });
    await p.locator('#view h1').filter({ hasText: 'Me guider' }).waitFor({ timeout: 15_000 });
    const guide = net(await p.locator('#view').innerText());
    expect(guide).toContain('Faire une facture');
    for (const absente of ['Revenir à une sauvegarde', 'Installer une mise à jour', 'Mettre mes données à l\'abri', 'Recevoir la clôture de mon comptable', 'Joindre un justificatif, et le retrouver']) expect(guide).not.toContain(absente);

    // 6. Les Paramètres : aucune puce vers un panneau absent ; « Ouvrir l'exemple » ramène à l'exemple, sans rien
    // reverser ni rien écrire ici.
    await p.evaluate(() => { location.hash = '#/parametres'; });
    await p.locator('#view h1').filter({ hasText: 'Paramètres' }).waitFor({ timeout: 15_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    // « Tes appareils » vit dans Ton compte, avec l'adresse, le mot de passe et le code (lot onboarding).
    await p.locator('#set-tabs [data-tab=compte]').click();
    expect(await p.locator('#set-somm .somm-chip:visible').allInnerTexts()).toEqual(['Ton compte', 'Tes appareils']);
    await p.locator('#set-tabs [data-tab=donnees]').click();
    const puces = await p.locator('#set-somm .somm-chip:visible').allInnerTexts();
    expect(puces).toContain('Essayer sans risque');
    for (const absente of ['Dossiers', 'Sauvegardes', 'Copie externe', 'Mot de passe', 'Zone sensible']) expect(puces).not.toContain(absente);
    const avant = await compter('socle.dossier_v10', vraie);
    const pieces = await compter('ventes.piece', essai);
    await p.locator('#load-demo').click();
    await p.waitForURL(new RegExp(`/v10/\\?e=${essai}`), { timeout: 20_000 });
    await expect.poll(() => p.locator('#view .demo-banner').isVisible(), { timeout: 20_000 }).toBe(true);
    expect(await compter('ventes.piece', essai)).toBe(pieces);
    expect(await compter('socle.dossier_v10', vraie)).toBe(avant);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 600_000);
});
