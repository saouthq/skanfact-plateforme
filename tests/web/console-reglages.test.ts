// « Réglages » de la plateforme, à la souris (docs/console.md C28 ; serveur/console/reglages.ts ;
// web/console/src/ecrans/Reglages.tsx ; web/public/plateforme/message.js). Ce que le parcours vérifie :
//   - la grille du jour et la frise des échéances ;
//   - la relecture d'une règle : la fenêtre nomme la règle, l'avis se choisit, et la carte dit qui l'a relue ;
//   - un refus dans une longue fenêtre se lit au-dessus des boutons, et le champ refusé reste à l'écran (vu le
//     13/10/2026 à la souris : la phrase tombait sous le bas de la fenêtre, on ne voyait qu'un cadre rouge) ;
//   - écrire, remplacer, retirer un message : le bandeau de l'application du client suit ; « Plus tard » le cache sans
//     faire remonter la page sous le curseur, et un message neuf reparaît ;
//   - un nouveau prix (0103) : l'aperçu du serveur, le jour trop tôt refusé sur sa case, le prix à venir sous la grille
//     avec qui l'a préparé, lu par le client dans « Ton abonnement », retiré avant sa date ; le préavis se règle ;
//   - les nouveautés (0120, C43) : allumer pour une entreprise par son numéro (un nom refusé sur sa case), la ligne et
//     l'onglet la disent, l'éteindre ; l'ouvrir à tous, la refermer ; le journal nomme la nouveauté ;
//   - le support lit sans aucun geste ; au téléphone, rien ne déborde.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { plusJours } from '../../serveur/abonnement/etat.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { versionTeif } from '../../serveur/v10/teif.ts';
import { cliquer } from '../cliquer.ts';
import { reposerLesReglesDeDepart } from '../regles-de-depart.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();
const CODE = 'essai.web_reglages';
// Deux nouveautés propres à ce passage (la base est commune aux essais) : ce serveur les porte, comme une version à venir.
const SUFFIXE = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const NOUVEAUTES = [
  { code: `salle_${SUFFIXE}`, nom: 'La caisse en salle', quoi: 'Les tables, les commandes en cuisine, l\'addition.' },
  { code: `banque_${SUFFIXE}`, nom: 'Le rapprochement bancaire', quoi: 'Le relevé de la banque, pointé tout seul.' },
];

describe('les réglages de la plateforme, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-reglages-'));
  const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'web-console-reglages-veille-')), 'veille.json');
  const erreurs: string[] = [];
  let jD = '', jS = '', jClient = '', ent = '';

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  // Un membre de l'équipe : son compte, le code de son téléphone, son rôle, et une session de la console.
  const membre = async (nom: string, role: 'direction' | 'support') => {
    const email = `console-reglages-${role}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: MDP });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, email, role, 'essai des réglages à la souris');
    const r = await api('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    return String((await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
  };
  const console_ = async (jeton: string, onglet = '', largeur = 1440, hauteur = 900) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { sessionStorage.setItem('skanfact.console.jeton', j); }, jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/console/#/reglages${onglet ? `?onglet=${onglet}` : ''}`);
    await expect.poll(() => p.locator('.c-rg').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    return p;
  };
  // L'application du client, sur l'accueil de son entreprise.
  const client = async (e = ent) => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jClient);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${e}#/dashboard`);
    await expect.poll(() => p.locator('#view .page-head h1').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  const ecrire = async (p: Page, texte: string, sorte: 'nouveaute' | 'maintenance', motif: string, cible?: string) => {
    await cliquer(p.getByRole('button', { name: 'Écrire un message…' }));
    const f = p.locator('[role="dialog"]');
    await f.getByLabel('La sorte', { exact: true }).selectOption(sorte);
    if (cible) await f.getByLabel('À qui', { exact: true }).selectOption(cible);
    await f.locator('textarea').first().fill(texte);
    await f.locator('textarea').last().fill(motif);
    await cliquer(f.getByRole('button', { name: 'Afficher le message', exact: true }));
    await expect.poll(() => f.count()).toBe(0);
  };

  beforeAll(async () => {
    await admin.connect();
    await admin.query('delete from plateforme.message_diffusion');
    await admin.query('delete from plateforme.message_clients');
    // Les règles de l'abonnement telles que la migration les a posées : un autre fichier de test a pu en poser d'autres.
    await reposerLesReglesDeDepart(admin, aujourdhuiATunis());
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source) values ($1, '250', '2024-01-01', 'Une règle d''essai : à vérifier avec un comptable')`, [CODE]);
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 }, { nouveautes: NOUVEAUTES });
    navigateur = await chromium.launch();
    // Des noms à ce fichier : les autres écrans de la console écrivent dans la même base (le journal liste chacun).
    jD = await membre('Amira Réglages', 'direction');
    jS = await membre('Karim Réglages', 'support');
    const email = `client-reglages-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Lina Réglages', motDePasse: MDP });
    jClient = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    ent = String((await api('POST', '/entreprises', jClient, { raisonSociale: 'Studio Lina Réglages' })).corps.id);
  }, 180_000);
  afterAll(async () => {
    // Aucun message ne reste affiché : les parcours suivants ouvrent l'application des clients sans lui. Aucun prix à venir
    // ne reste non plus (la base laisse effacer un prix tant qu'il est à venir).
    await admin.query('delete from plateforme.message_diffusion');
    await admin.query('delete from plateforme.message_clients');
    await admin.query('delete from plateforme.prix where a_partir_du > (now() at time zone \'Africa/Tunis\')::date');
    await admin.query('delete from plateforme.prix_option where a_partir_du > (now() at time zone \'Africa/Tunis\')::date');
    await admin.query('delete from plateforme.contenu_offre where a_partir_du > (now() at time zone \'Africa/Tunis\')::date');
    await admin.query('delete from plateforme.regle_remise where a_partir_du > (now() at time zone \'Africa/Tunis\')::date');
    await reposerLesReglesDeDepart(admin, aujourdhuiATunis());
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });

  it('les offres et prix : la grille du jour, en dinars hors taxes, et la frise des échéances', async () => {
    const p = await console_(jD);
    expect(net(await p.locator('.c-onglets [aria-current="page"]').innerText())).toBe('Offres et prix');
    const grille = net(await p.locator('section[aria-labelledby="rg-grille"] table').innerText());
    expect(grille).toMatch(/Essentiel.*390,000 DT.*39,000 DT/);
    expect(grille).toMatch(/Complet.*690,000 DT.*69,000 DT/);
    expect(net(await p.locator('section[aria-labelledby="rg-grille"] .c-carte-sous').innerText())).toContain('Un prix par entreprise, jamais par utilisateur');
    // Ce qui s'ajoute à l'offre (14c) : chaque ajout, ce que les offres en comprennent, ses prix du jour.
    const ajout = async (option: string) => net(await p.locator(`section[aria-labelledby="rg-ajouts"] tr[data-option="${option}"]`).innerText());
    expect(await p.locator('section[aria-labelledby="rg-ajouts"] tbody tr').evaluateAll((e) => e.map((x) => (x as HTMLElement).dataset.option)))
      .toEqual(['caisse', 'etablissement', 'salarie', 'module_paie', 'module_compta']);
    expect(await ajout('caisse')).toMatch(/^Une caisse de plus Essentiel en comprend 1 ; Complet, 2\. 120,000 DT 12,000 DT depuis le 28\/09\/2026 —$/);
    expect(net(await p.locator('section[aria-labelledby="rg-ajouts"]').innerText())).toContain('Les utilisateurs ne s\'y comptent jamais : sans limite dans les deux offres');
    expect(await ajout('salarie')).toMatch(/12,000 DT 1,200 DT/);
    expect(await ajout('module_paie')).toMatch(/150,000 DT 15,000 DT depuis le 28\/09\/2026 (aucune|une entreprise|\d+ entreprises)$/);
    expect(await p.locator('.c-rg-frise li').count()).toBeGreaterThanOrEqual(4);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('un nouveau prix : préparé avec son aperçu, lu à venir par le client, retiré avant sa date ; le préavis se règle', async () => {
    const p = await console_(jD);
    const aujourdhui = aujourdhuiATunis();
    const plusTot = plusJours(aujourdhui, 30);
    const enFrancais = (j: string) => `${j.slice(8, 10)}/${j.slice(5, 7)}/${j.slice(0, 4)}`;
    await cliquer(p.getByRole('button', { name: 'Préparer un nouveau prix…' }));
    const f = p.locator('[role="dialog"]');
    // L'aperçu a sa place dès l'ouverture : il dit ce qu'il dira, et le motif, dessous, ne bougera pas quand il arrivera.
    expect(net(await f.locator('.c-rg-prix-zone').innerText())).toBe('Écris le nouveau prix : l\'aperçu dira l\'écart avec celui d\'aujourd\'hui et combien d\'entreprises l\'ont.');
    const motifAvant = (await f.locator('textarea').boundingBox())?.y;
    await f.locator('select').selectOption({ label: 'Complet, au mois' });
    // Le prix à l'année tapé pour le mois : l'écart le dit, en couleur, avant le geste.
    await f.getByLabel('Le nouveau prix, hors taxes, en dinars').fill('690');
    await expect.poll(() => f.locator('.c-rg-prix-attention').innerText().then(net).catch(() => ''), { timeout: 10_000 })
      .toBe('Une hausse de 900,0 % : vérifie que c\'est bien le prix au mois');
    await f.getByLabel('Le nouveau prix, hors taxes, en dinars').fill('72');
    // L'aperçu du serveur : l'ancien prix barré, le nouveau, l'écart, qui l'a aujourd'hui.
    await expect.poll(() => f.locator('.c-rg-prix-zone').innerText().then(net).catch(() => ''), { timeout: 10_000 })
      .toMatch(/^69,000 DT → 72,000 DT HT au mois Une hausse de 4,3 % (Aucun abonné ne l'a aujourd'hui|Une entreprise l'a aujourd'hui|\d+ entreprises l'ont aujourd'hui)$/);
    expect(await f.locator('.c-rg-prix-apercu del').innerText()).toMatch(/^69,000/);
    expect(await f.locator('.c-rg-prix-attention').count()).toBe(0);
    expect(motifAvant).toBeDefined();
    expect((await f.locator('textarea').boundingBox())?.y).toBe(motifAvant);
    // Trop tôt : la case de la date se refuse, en disant le premier jour possible.
    await f.getByLabel('À partir du').fill(plusJours(aujourdhui, 5));
    await f.locator('textarea').fill('Nouvelle grille au mois');
    await cliquer(f.getByRole('button', { name: 'Préparer ce prix', exact: true }));
    await expect.poll(() => f.locator('.c-alerte').last().innerText().then(net).catch(() => '')).toBe(`Un nouveau prix commence au plus tôt le ${enFrancais(plusTot)} : c'est le préavis.`);
    await expect.poll(() => f.getByLabel('À partir du').getAttribute('aria-invalid')).toBe('true');
    await f.getByLabel('À partir du').fill(plusTot);
    await cliquer(f.getByRole('button', { name: 'Préparer ce prix', exact: true }));
    await expect.poll(() => f.count(), { timeout: 10_000 }).toBe(0);
    // À venir, sous la grille : le prix, sa date, qui l'a préparé et pourquoi.
    const venir = p.locator('.c-rg-venir[data-quoi="complet"][data-periodicite="mensuel"]');
    await expect.poll(() => venir.innerText().then(net).catch(() => ''), { timeout: 10_000 })
      .toMatch(new RegExp(`^À venir : Complet, au mois, 72,000 DT HT à partir du ${enFrancais(plusTot)} Préparé par Amira Réglages, aujourd'hui, \\d\\d:\\d\\d : « Nouvelle grille au mois » Le retirer avant sa date…$`));
    fs.mkdirSync(path.join(RACINE, 'dist/photos'), { recursive: true });
    await p.screenshot({ animations: 'disabled', path: path.join(RACINE, 'dist/photos', 'console-reglages-prix-a-venir.png') });
    // Un deuxième prix annoncé pour Complet, à l'année (par l'API) : sa carte en dit deux, celle d'Essentiel aucun.
    expect((await api('POST', '/console/reglages/prix', jD, { quoi: 'complet', periodicite: 'annuel', montant: '720', aPartirDu: plusTot, motif: 'Nouvelle grille à l\'année' })).statut).toBe(201);
    // Le client les lit dans « Ton abonnement », sous le prix d'aujourd'hui, l'année d'abord.
    const c = await client();
    await c.evaluate(() => { location.hash = '#/parametres'; });
    await cliquer(c.locator('#set-tabs [data-tab="abonnement"]'));
    await expect.poll(() => c.locator('.abo-offre[data-offre="complet"] .abo-avenir').allInnerTexts().then((t) => t.map(net)).catch(() => []), { timeout: 15_000 })
      .toEqual([`À partir du ${enFrancais(plusTot)} : 720 DT HT par an.`, `À partir du ${enFrancais(plusTot)} : 72 DT HT par mois.`]);
    expect(net(await c.locator('.abo-section-tete p').first().innerText())).toContain('Un changement annoncé vaut pour les périodes qui commencent à sa date');
    // L'autre offre le dit à la même place, et ce que chacune comprend commence à la même hauteur.
    expect(net(await c.locator('.abo-offre[data-offre="essentiel"] .abo-avenir-rien').innerText())).toBe('Aucun changement annoncé.');
    const haut = async (offre: string) => (await c.locator(`.abo-offre[data-offre="${offre}"] .abo-inclus`).boundingBox())?.y;
    // À moins d'un quart de ligne près : un vrai décalage fait la hauteur d'une ligne (celle de « Aucun changement
    // annoncé. », mesurée ici). Les deux cartes partagent leurs lignes, mais le navigateur arrondit les positions, et pas
    // pareil d'une colonne à l'autre ni d'une machine à l'autre : 0,096 point vu le 14/10/2026, 1,09 puis 0,6 point le
    // 15/10/2026 (ici, puis sur GitHub) sans qu'aucune ligne ne soit décalée. Mesuré jusqu'à ce que la page soit posée.
    const uneLigne = (await c.locator('.abo-offre[data-offre="essentiel"] .abo-avenir-rien').boundingBox())?.height ?? 0;
    expect(uneLigne).toBeGreaterThan(10);
    expect(await haut('essentiel')).toBeDefined();
    await expect.poll(async () => Math.abs((await haut('essentiel') ?? 0) - (await haut('complet') ?? Infinity)), { timeout: 5_000 }).toBeLessThan(uneLigne / 4);
    // Retiré avant sa date : il quitte la grille et l'écran du client.
    await cliquer(venir.getByRole('button', { name: 'Le retirer avant sa date…' }));
    const r = p.locator('[role="dialog"]');
    expect(net(await r.locator('.c-dialogue-sous').innerText())).toBe(`À venir : Complet, au mois, 72,000 DT HT à partir du ${enFrancais(plusTot)}`);
    await r.locator('textarea').fill('Grille repoussée');
    await cliquer(r.getByRole('button', { name: 'Retirer ce prix', exact: true }));
    await expect.poll(() => r.count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => venir.count(), { timeout: 10_000 }).toBe(0);
    expect((await api('POST', '/console/reglages/prix/retirer', jD, { quoi: 'complet', periodicite: 'annuel', aPartirDu: plusTot, motif: 'Grille à l\'année repoussée' })).statut).toBe(200);
    await c.reload();
    await cliquer(c.locator('#set-tabs [data-tab="abonnement"]'));
    await c.locator('.abo-offre[data-offre="complet"]').waitFor({ timeout: 15_000 });
    expect(await c.locator('.abo-avenir, .abo-avenir-rien').count()).toBe(0);
    await fermer(c);
    // Le préavis se règle ; la carte le dit aussitôt.
    await cliquer(p.getByRole('button', { name: 'Changer le préavis…' }));
    const pr = p.locator('[role="dialog"]');
    await pr.getByLabel('Le préavis, en jours').fill('20');
    await pr.locator('textarea').fill('Préavis plus court pour la rentrée');
    await cliquer(pr.getByRole('button', { name: 'Régler le préavis', exact: true }));
    await expect.poll(() => pr.count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => p.locator('.c-rg-preavis').innerText().then(net).catch(() => ''), { timeout: 10_000 })
      .toMatch(/^Un nouveau prix se prépare ici et commence au plus tôt 20 jours plus tard : c'est le préavis\. Les clients le lisent dans leur application dès qu'il est préparé\. Réglé par Amira Réglages, aujourd'hui, \d\d:\d\d : « Préavis plus court pour la rentrée » Changer le préavis…$/);
    // Un prix d'Essentiel, préparé puis retiré (par l'API) : le journal l'élide (« le prix d'Essentiel »).
    expect((await api('POST', '/console/reglages/prix', jD, { quoi: 'essentiel', periodicite: 'annuel', montant: '420', aPartirDu: plusJours(aujourdhui, 20), motif: 'Grille Essentiel essayée' })).statut).toBe(201);
    expect((await api('POST', '/console/reglages/prix/retirer', jD, { quoi: 'essentiel', periodicite: 'annuel', aPartirDu: plusJours(aujourdhui, 20), motif: 'Grille Essentiel repoussée' })).statut).toBe(200);
    // Le journal dit chaque geste : sur quel prix, de quoi à quoi ; le préavis, d'avant à après.
    await p.goto(`${serveur.adresse}/console/#/journal`);
    const ligne = (geste: string, sur: string) => p.locator('tr').filter({ hasText: geste }).filter({ hasText: sur }).first().innerText().then(net).catch(() => '');
    await expect.poll(() => ligne('Nouveau prix préparé', 'Complet, au mois'), { timeout: 15_000 })
      .toContain(`Nouveau prix préparé Réglages direction Le prix de Complet, au mois « Nouvelle grille au mois » 69,000 DT → 72,000 DT à partir du ${enFrancais(plusTot)}`);
    expect(await ligne('Prix à venir retiré', 'Complet, au mois'))
      .toContain(`Prix à venir retiré Réglages direction Le prix de Complet, au mois « Grille repoussée » 72,000 DT à partir du ${enFrancais(plusTot)} → 69,000 DT`);
    expect(await ligne('Prix à venir retiré', 'Grille Essentiel repoussée')).toContain('Prix à venir retiré Réglages direction Le prix d\'Essentiel, à l\'année « Grille Essentiel repoussée »');
    expect(await ligne('Préavis d\'un nouveau prix réglé', 'Préavis plus court'))
      .toContain('Préavis d\'un nouveau prix réglé Réglages direction Le préavis d\'un nouveau prix « Préavis plus court pour la rentrée » 30 jours → 20 jours');
    expect((await api('POST', '/console/reglages/preavis', jD, { jours: 30, motif: 'retour aux trente jours' })).statut).toBe(200);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 120_000);

  it('ce que chaque offre comprend : préparé avec son aperçu, lu à venir par le client, retiré avant sa date', async () => {
    const p = await console_(jD);
    const aujourdhui = aujourdhuiATunis();
    const plusTot = plusJours(aujourdhui, 30);
    const enFrancais = (j: string) => `${j.slice(8, 10)}/${j.slice(5, 7)}/${j.slice(0, 4)}`;
    const section = p.locator('section[aria-labelledby="rg-contenu"]');
    const ligne = async (quoi: string) => net(await section.locator(`tr[data-quoi="${quoi}"]`).innerText());
    // La grille du jour : chaque ligne, ce qu'Essentiel et Complet en comprennent.
    expect(await section.locator('tbody tr').evaluateAll((e) => e.map((x) => (x as HTMLElement).dataset.quoi)))
      .toEqual(['caisses', 'etablissements', 'salaries', 'paie', 'compta']);
    expect(await ligne('caisses')).toBe('Caisses comprises Au-delà, chaque caisse de plus se paie. 1 2');
    expect(await ligne('salaries')).toMatch(/^Salariés dans la paie Les employés dont l'entreprise fait la fiche de paie, pas les personnes qui utilisent SkanFact \(sans limite\)\..* 10 20$/);
    expect(await ligne('paie')).toMatch(/^La paie .* Achetée seule Comprise$/);
    // Préparer : Complet comprendra trois caisses. L'aperçu a sa place dès l'ouverture, puis dit ce qui change.
    await cliquer(section.getByRole('button', { name: 'Préparer un changement…' }));
    const f = p.locator('[role="dialog"]');
    expect(net(await f.locator('.c-rg-prix-zone').innerText())).toBe('Écris le nouveau nombre : l\'aperçu dira ce qui change et combien d\'entreprises ont cette offre.');
    const motifAvant = (await f.locator('textarea').boundingBox())?.y;
    await f.getByLabel('L\'offre', { exact: true }).selectOption('complet');
    await f.getByLabel('Ce qui change', { exact: true }).selectOption('caisses');
    await f.getByLabel('Combien l\'offre en comprendra').fill('3');
    expect(net(await f.locator('.c-rg-prix-zone').innerText()))
      .toMatch(/^Complet : 2 caisses comprises → 3 caisses comprises (Aucune entreprise n'a Complet aujourd'hui|Une entreprise a Complet aujourd'hui : à sa prochaine période, elle le lira sur sa facture|\d+ entreprises ont Complet aujourd'hui : à leur prochaine période, elles le liront sur leur facture)\.$/);
    expect((await f.locator('textarea').boundingBox())?.y).toBe(motifAvant);
    expect(await f.getByLabel('À partir du').inputValue()).toBe(plusTot);
    await f.locator('textarea').fill('Trois caisses en Complet');
    await cliquer(f.getByRole('button', { name: 'Préparer ce changement', exact: true }));
    await expect.poll(() => f.count(), { timeout: 10_000 }).toBe(0);
    // À venir : dans la case de Complet, et sous la grille avec qui l'a préparé et pourquoi.
    await expect.poll(() => section.locator('tr[data-quoi="caisses"] td[data-offre="complet"]').innerText().then(net).catch(() => ''), { timeout: 10_000 })
      .toBe(`2 → 3 le ${enFrancais(plusTot)}`);
    const venir = section.locator('.c-rg-venir[data-offre="complet"][data-quoi="caisses"]');
    expect(net(await venir.innerText()))
      .toMatch(new RegExp(`^À venir : Complet, à partir du ${enFrancais(plusTot)} : 3 caisses comprises Préparé par Amira Réglages, aujourd'hui, \\d\\d:\\d\\d : « Trois caisses en Complet » Le retirer avant sa date…$`));
    // Choisir n'est pas taper : la paie choisie (le nombre, vide, fait place à une liste), Échap referme sans question.
    await cliquer(section.getByRole('button', { name: 'Préparer un changement…' }));
    await f.getByLabel('Ce qui change', { exact: true }).selectOption('paie');
    await p.keyboard.press('Escape');
    await expect.poll(() => f.count()).toBe(0);
    // Essentiel à quatre caisses ce jour-là : plus que Complet, qui dit « Tout Essentiel » ; l'aperçu le dit en couleur.
    await cliquer(section.getByRole('button', { name: 'Préparer un changement…' }));
    // La fenêtre rouverte part d'Essentiel et des caisses.
    expect(await f.getByLabel('L\'offre', { exact: true }).inputValue()).toBe('essentiel');
    expect(await f.getByLabel('Ce qui change', { exact: true }).inputValue()).toBe('caisses');
    // Un module se propose dans l'autre état que le sien : la paie de Complet, comprise aujourd'hui, s'y propose achetée
    // seule, et l'aperçu dit ce que les abonnés de Complet perdraient.
    await f.getByLabel('L\'offre', { exact: true }).selectOption('complet');
    await f.getByLabel('Ce qui change', { exact: true }).selectOption('paie');
    expect(await f.getByLabel('La paie', { exact: true }).inputValue()).toBe('0');
    expect(net(await f.locator('.c-champ').filter({ has: p.locator('label', { hasText: /^La paie$/ }) }).locator('.c-champ-aide').innerText())).toBe('Aujourd\'hui, la paie est comprise.');
    expect(net(await f.locator('.c-rg-prix-zone').innerText()))
      .toMatch(/^Complet : la paie comprise → la paie achetée seule (Aucune entreprise n'a Complet aujourd'hui|Une entreprise a Complet aujourd'hui : à sa prochaine période, ce module se fermera chez elle, sauf acheté seul depuis sa fiche|\d+ entreprises ont Complet aujourd'hui : à leur prochaine période, ce module se fermera chez elles, sauf acheté seul depuis leur fiche)\.$/);
    await f.getByLabel('L\'offre', { exact: true }).selectOption('essentiel');
    await f.getByLabel('Ce qui change', { exact: true }).selectOption('caisses');
    await f.getByLabel('Combien l\'offre en comprendra').fill('4');
    expect(net(await f.locator('.c-rg-prix-attention').innerText()))
      .toBe(`Le ${enFrancais(plusTot)}, Complet : 3 caisses comprises. Essentiel comprendrait plus que Complet, dont la carte dit « Tout Essentiel » : change Complet d'abord.`);
    // Une ligne déjà préparée : l'aperçu le dit, et le bouton attend.
    await f.getByLabel('L\'offre', { exact: true }).selectOption('complet');
    expect(net(await f.locator('.c-rg-prix-zone').innerText())).toBe(`Un changement est déjà préparé pour cette ligne, à partir du ${enFrancais(plusTot)} : retire-le avant d'en préparer un autre.`);
    expect(await f.getByRole('button', { name: 'Préparer ce changement', exact: true }).isDisabled()).toBe(true);
    await cliquer(f.getByRole('button', { name: 'Annuler', exact: true }));
    await expect.poll(() => f.locator('.c-dialogue-question').count()).toBe(1);
    await cliquer(f.getByRole('button', { name: 'Abandonner', exact: true }));
    await expect.poll(() => f.count()).toBe(0);
    // Le client le lit sur la carte de Complet ; Essentiel dit à la même place que rien ne change pour elle.
    const c = await client();
    await c.evaluate(() => { location.hash = '#/parametres'; });
    await cliquer(c.locator('#set-tabs [data-tab="abonnement"]'));
    await expect.poll(() => c.locator('.abo-offre[data-offre="complet"] .abo-avenir').allInnerTexts().then((t) => t.map(net)).catch(() => []), { timeout: 15_000 })
      .toEqual([`À partir du ${enFrancais(plusTot)} : trois caisses comprises.`]);
    expect(net(await c.locator('.abo-offre[data-offre="essentiel"] .abo-avenir-rien').innerText())).toBe('Aucun changement annoncé.');
    // Ce que chaque carte dit aujourd'hui vient des mêmes nombres que la console.
    expect(await c.locator('.abo-offre[data-offre="complet"] .abo-inclus li').allInnerTexts().then((t) => t.map(net)))
      .toEqual(['Tout Essentiel', 'La paie, jusqu\'à vingt salariés', 'La comptabilité complète', 'Deux caisses au comptoir', 'Des utilisateurs sans limite, deux établissements']);
    expect(net(await c.locator('#abo-plus li[data-option="caisse"] .abo-plus-quoi').innerText())).toBe('Une caisse de plus Essentiel en comprend une ; Complet, deux.');
    await fermer(c);
    // Retiré avant sa date : il quitte la grille ; le journal dit sur quoi, de quoi à quoi.
    await cliquer(venir.getByRole('button', { name: 'Le retirer avant sa date…' }));
    const r = p.locator('[role="dialog"]');
    expect(net(await r.locator('.c-dialogue-sous').innerText())).toBe(`À venir : Complet, à partir du ${enFrancais(plusTot)} : 3 caisses comprises`);
    await r.locator('textarea').fill('Caisses repoussées');
    await cliquer(r.getByRole('button', { name: 'Retirer ce changement', exact: true }));
    await expect.poll(() => r.count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => venir.count(), { timeout: 10_000 }).toBe(0);
    await p.goto(`${serveur.adresse}/console/#/journal`);
    const auJournal = (motif: string) => p.locator('tr').filter({ hasText: motif }).first().innerText().then(net).catch(() => '');
    await expect.poll(() => auJournal('Trois caisses en Complet'), { timeout: 15_000 })
      .toContain(`Changement de contenu préparé Réglages direction Complet : caisses comprises « Trois caisses en Complet » 2 caisses comprises → 3 caisses comprises à partir du ${enFrancais(plusTot)}`);
    expect(await auJournal('Caisses repoussées'))
      .toContain(`Changement de contenu retiré Réglages direction Complet : caisses comprises « Caisses repoussées » 3 caisses comprises à partir du ${enFrancais(plusTot)} → 2 caisses comprises`);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 120_000);

  it('les remises : préparées avec leur aperçu, retirées avant leur date ; un groupe se déclare depuis la fiche, le client lit sa remise', async () => {
    const p = await console_(jD);
    const plusTot = plusJours(aujourdhuiATunis(), 30);
    const enFrancais = (j: string) => `${j.slice(8, 10)}/${j.slice(5, 7)}/${j.slice(0, 4)}`;
    const section = p.locator('section[aria-labelledby="rg-remises"]');
    // Les deux remises du jour : leur taux, leur durée.
    expect(net(await section.locator('tr[data-code="groupe"]').innerText())).toMatch(/^Remise de groupe Dès la deuxième société d'un groupe déclaré dans la fiche d'un client : .* 20 % sans limite$/);
    expect(net(await section.locator('tr[data-code="cabinet"]').innerText())).toMatch(/^Remise du cabinet Pour un client venu par son cabinet : .* 20 % 12 mois$/);
    // Préparer : celle du cabinet, 25 % pendant 6 mois. Le taux et la date ne bougent pas quand la durée apparaît.
    await cliquer(section.getByRole('button', { name: 'Préparer un changement…' }));
    const f = p.locator('[role="dialog"]');
    expect(net(await f.locator('.c-rg-prix-zone').innerText())).toBe('Écris le nouveau taux : l\'aperçu dira ce qui change.');
    const place = async () => [(await f.getByLabel('Taux (%)').boundingBox())?.y, (await f.getByLabel('À partir du').boundingBox())?.y];
    const avant = await place();
    await f.getByLabel('La remise', { exact: true }).selectOption('cabinet');
    expect(await place()).toEqual(avant);
    // Choisir n'est pas taper : la durée part vide (celle d'aujourd'hui, en indication).
    expect(await f.getByLabel('Durée (mois)').inputValue()).toBe('');
    expect(await f.getByLabel('Durée (mois)').getAttribute('placeholder')).toBe('12');
    await f.getByLabel('Taux (%)').fill('25');
    await f.getByLabel('Durée (mois)').fill('6');
    expect(net(await f.locator('.c-rg-prix-zone').innerText())).toBe(`Remise du cabinet : 20 % pendant 12 mois → 25 % pendant 6 mois Elle vaudra pour les clients venus par leur cabinet, sur chaque période qui commence à partir du ${enFrancais(plusTot)}, dans la durée comptée depuis leur première période payée.`);
    expect(await f.getByLabel('À partir du').inputValue()).toBe(plusTot);
    await f.locator('textarea').fill('Vingt-cinq pour cent, six mois');
    await cliquer(f.getByRole('button', { name: 'Préparer ce changement', exact: true }));
    await expect.poll(() => f.count(), { timeout: 10_000 }).toBe(0);
    // À venir : sous la remise, et sous la grille avec qui l'a préparé et pourquoi.
    await expect.poll(() => section.locator('tr[data-code="cabinet"] .c-rg-avenir').innerText().then(net).catch(() => ''), { timeout: 10_000 })
      .toBe(`→ 25 % pendant 6 mois le ${enFrancais(plusTot)}`);
    const venir = section.locator('.c-rg-venir[data-code="cabinet"]');
    expect(net(await venir.innerText()))
      .toMatch(new RegExp(`^À venir : remise du cabinet, 25 % pendant 6 mois à partir du ${enFrancais(plusTot)} Préparé par Amira Réglages, aujourd'hui, \\d\\d:\\d\\d : « Vingt-cinq pour cent, six mois » Le retirer avant sa date…$`));
    // Une remise déjà préparée : l'aperçu le dit, et le bouton attend.
    await cliquer(section.getByRole('button', { name: 'Préparer un changement…' }));
    await f.getByLabel('La remise', { exact: true }).selectOption('cabinet');
    expect(net(await f.locator('.c-rg-prix-zone').innerText())).toBe(`Un changement de cette remise est déjà préparé, à partir du ${enFrancais(plusTot)} : retire-le avant d'en préparer un autre.`);
    expect(await f.getByRole('button', { name: 'Préparer ce changement', exact: true }).isDisabled()).toBe(true);
    await p.keyboard.press('Escape');
    await expect.poll(() => f.count()).toBe(0);
    // Retiré avant sa date ; le journal dit sur quoi, de quoi à quoi.
    await cliquer(venir.getByRole('button', { name: 'Le retirer avant sa date…' }));
    await f.locator('textarea').fill('Remise repoussée');
    await cliquer(f.getByRole('button', { name: 'Retirer ce changement', exact: true }));
    await expect.poll(() => venir.count(), { timeout: 10_000 }).toBe(0);
    await p.goto(`${serveur.adresse}/console/#/journal`);
    const auJournal = (motif: string) => p.locator('tr').filter({ hasText: motif }).first().innerText().then(net).catch(() => '');
    await expect.poll(() => auJournal('Vingt-cinq pour cent, six mois'), { timeout: 15_000 })
      .toContain(`Changement de remise préparé Réglages direction La remise du cabinet « Vingt-cinq pour cent, six mois » 20 % pendant 12 mois → 25 % pendant 6 mois à partir du ${enFrancais(plusTot)}`);
    expect(await auJournal('Remise repoussée'))
      .toContain(`Changement de remise retiré Réglages direction La remise du cabinet « Remise repoussée » 25 % pendant 6 mois à partir du ${enFrancais(plusTot)} → 20 % pendant 12 mois`);

    // Un groupe : la seconde société de Lina, depuis sa fiche. Le Studio a payé le premier : il garde le prix normal.
    const atelier = String((await api('POST', '/entreprises', jClient, { raisonSociale: 'Atelier Lina Réglages' })).corps.id);
    await admin.query(`insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, apres) values ($1, 'paye', 'exploitation', 'paiement des essais', '{"debut": "2026-01-01"}')`, [ent]);
    await p.goto(`${serveur.adresse}/console/#/clients/${atelier}?onglet=abonnement`);
    const carte = p.locator('section[aria-labelledby="fiche-groupe"]');
    await expect.poll(() => carte.locator('.c-gr-remise').innerText().then(net).catch(() => ''), { timeout: 15_000 })
      .toBe('Aucune remise sur sa prochaine facture Elle n\'est dans aucun groupe, et aucune remise de cabinet ne court sur cette période : celle-ci ne vaut que pour la première année d\'une société venue par son cabinet.');
    expect(net(await carte.locator('.c-gr-voisines').innerText())).toBe('Les autres sociétés de Lina Réglages, dans aucun groupe : Studio Lina Réglages');
    await cliquer(carte.getByRole('button', { name: 'Créer un groupe' }));
    expect(await f.locator('.c-gr-cases input[type="checkbox"]').evaluateAll((e) => e.map((x) => [(x as HTMLInputElement).checked, (x as HTMLInputElement).disabled])))
      .toEqual([[true, true], [true, false]]);
    // L'aperçu, avant le geste : la première abonnée d'abord, au prix normal.
    await expect.poll(() => f.locator('.c-gr-apercu li').allInnerTexts().then((t) => t.map(net)), { timeout: 10_000 })
      .toEqual(['Studio Lina Réglages Première période payée : 01/01/2026 Prix normal', 'Atelier Lina Réglages cette fiche Pas encore abonnée −20 %']);
    await f.getByLabel('Nom du groupe').fill('Les ateliers de Lina');
    await f.locator('textarea').fill('Les deux sociétés de Lina');
    await cliquer(f.getByRole('button', { name: 'Créer le groupe', exact: true }));
    await expect.poll(() => f.count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => carte.locator('.c-gr-remise').innerText().then(net).catch(() => ''), { timeout: 10_000 })
      .toBe('−20 % sur sa prochaine facture Remise de groupe (Les ateliers de Lina) : Studio Lina Réglages, la première société abonnée du groupe, paie le prix normal.');
    // Le client de l'Atelier lit sa remise et pourquoi, au-dessus des offres.
    const c = await client(atelier);
    await c.evaluate(() => { location.hash = '#/parametres'; });
    await cliquer(c.locator('#set-tabs [data-tab="abonnement"]'));
    await expect.poll(() => c.locator('#abo-remise').innerText().then(net).catch(() => ''), { timeout: 15_000 })
      .toBe('−20 % sur ta prochaine facture Remise de groupe (Les ateliers de Lina) : la première société abonnée du groupe paie le prix normal, les suivantes ont la remise. Elle porte sur tout le hors taxes de la facture, l\'offre et ce qui s\'ajoute. Les prix ci-dessous sont ceux d\'avant la remise.');
    await fermer(c);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 150_000);

  it('une règle de l\'abonnement : la grâce se change à la souris, avec son aperçu ; le client et le journal la disent', async () => {
    const p = await console_(jD);
    const ligne = p.locator('.c-rg-regle-abo[data-code="grace"]');
    expect(net(await ligne.innerText())).toBe('7 jours de grâce après l\'échéance, où tout marche encore. La règle de départ : « Cadrage 07 (27/09/2026) : sept jours de grâce après l\'échéance, où tout marche encore » Changer la grâce…');
    expect(net(await p.locator('.c-rg-regle-abo[data-code="relances"] .c-sous').innerText())).toMatch(/^Une relance part 15 jours avant l'échéance, 7 jours avant et la veille\./);
    await cliquer(ligne.getByRole('button', { name: 'Changer la grâce…' }));
    const f = p.locator('[role="dialog"]');
    // Ce qu'on lit en ouvrant : la règle d'aujourd'hui, qui ne changerait rien ; le bouton attend une autre valeur.
    expect(await f.getByLabel('La grâce, en jours').inputValue()).toBe('7');
    expect(net(await f.locator('.c-rg-prix-zone').innerText())).toBe('C\'est déjà la règle d\'aujourd\'hui : rien ne changerait.');
    expect(await f.getByRole('button', { name: 'Poser cette règle', exact: true }).isDisabled()).toBe(true);
    const motifAvant = (await f.locator('textarea').boundingBox())?.y;
    // Hors des bornes : l'aperçu le dit à sa place, sans rien pousser.
    await f.getByLabel('La grâce, en jours').fill('45');
    expect(net(await f.locator('.c-rg-prix-zone').innerText())).toBe('La grâce compte de 0 à 30 jours : écris un nombre entier.');
    await f.getByLabel('La grâce, en jours').fill('10');
    expect(net(await f.locator('.c-rg-prix-zone').innerText()))
      .toMatch(/^7 jours de grâce → 10 jours de grâce 10 jours de grâce après l'échéance, où tout marche encore\. (Aucune entreprise n'est en grâce aujourd'hui|Une entreprise est en grâce aujourd'hui : elle garde la sienne|\d+ entreprises sont en grâce aujourd'hui : elles gardent la leur)$/);
    expect((await f.locator('textarea').boundingBox())?.y).toBe(motifAvant);
    await f.locator('textarea').fill('Dix jours pour la rentrée');
    await cliquer(f.getByRole('button', { name: 'Poser cette règle', exact: true }));
    await expect.poll(() => f.count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => ligne.innerText().then(net).catch(() => ''), { timeout: 10_000 })
      .toMatch(/^10 jours de grâce après l'échéance, où tout marche encore\. Réglée par Amira Réglages, aujourd'hui, \d\d:\d\d : « Dix jours pour la rentrée » Changer la grâce…$/);
    // La frise la dit aussi.
    expect(net(await p.locator('.c-rg-etape-grace').innerText())).toContain('10 jours de grâce');
    // Les relances aussi (par l'API) : dix jours et trois jours.
    expect((await api('POST', '/console/reglages/regle', jD, { code: 'relances', jours: [3, 10], motif: 'Dix jours puis trois' })).statut).toBe(200);
    // Le client lit les deux dans « Ton abonnement » : son échéance tombe après la règle.
    const c = await client();
    await c.evaluate(() => { location.hash = '#/parametres'; });
    await cliquer(c.locator('#set-tabs [data-tab="abonnement"]'));
    await expect.poll(() => c.locator('#abonnement-panel .abo-etapes').innerText().then(net).catch(() => ''), { timeout: 15_000 })
      .toContain('10 jours de grâce Après l\'échéance, tout marche encore.');
    expect(net(await c.locator('#abonnement-panel .abo-etapes').innerText())).toContain('Les rappels Un e-mail 10 jours et 3 jours avant l\'échéance.');
    await fermer(c);
    // Le journal : quelle règle, de quoi à quoi.
    await p.goto(`${serveur.adresse}/console/#/journal`);
    await expect.poll(() => p.locator('tr').filter({ hasText: 'Dix jours pour la rentrée' }).first().innerText().then(net).catch(() => ''), { timeout: 15_000 })
      .toContain('Règle de l\'abonnement changée Réglages direction La grâce après l\'échéance « Dix jours pour la rentrée » 7 jours → 10 jours');
    // Retour à la règle de départ pour la suite.
    expect((await api('POST', '/console/reglages/regle', jD, { code: 'grace', jours: [7], motif: 'retour aux sept jours' })).statut).toBe(200);
    expect((await api('POST', '/console/reglages/regle', jD, { code: 'relances', jours: [15, 7, 1], motif: 'retour aux trois relances' })).statut).toBe(200);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 120_000);

  it('la relecture d\'une règle : la fenêtre nomme la règle, l\'avis se choisit, et la carte dit qui l\'a relue', async () => {
    const p = await console_(jD, 'regles');
    const carte = p.locator('.c-rg-regle').filter({ hasText: CODE });
    expect(net(await carte.innerText())).toContain('Personne ne l\'a encore relue');
    await cliquer(carte.getByRole('button', { name: 'Noter la relecture du comptable…' }));
    const f = p.locator('[role="dialog"]');
    // Une règle qu'on ne sait pas nommer se dit par son code, une seule fois.
    expect(net(await f.locator('.c-dialogue-sous').innerText())).toBe(CODE);
    // Les choix commencent par une majuscule, comme tout libellé.
    expect(await f.locator('select option').allInnerTexts()).toEqual(['Juste telle quelle', 'À corriger']);
    await f.locator('input').first().fill('Mehdi Gharbi, cabinet pilote');
    await f.locator('select').selectOption('a_corriger');
    await f.locator('textarea').first().fill('Vérifie l\'article cité.');
    await f.locator('textarea').last().fill('relue au téléphone');
    await cliquer(f.getByRole('button', { name: 'Noter la relecture', exact: true }));
    await expect.poll(() => f.count()).toBe(0);
    await expect.poll(async () => net(await carte.innerText())).toMatch(/Relue le \d\d\/\d\d\/\d{4} par Mehdi Gharbi, cabinet pilote : à corriger\. Noté par Amira Réglages\./);
    expect(net(await carte.innerText())).toContain('« Vérifie l\'article cité. »');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('un refus dans une longue fenêtre se lit au-dessus des boutons, et le champ refusé reste à l\'écran', async () => {
    const p = await console_(jD, 'messages', 1440, 760);
    await cliquer(p.getByRole('button', { name: 'Écrire un message…' }));
    const f = p.locator('[role="dialog"]');
    await f.locator('textarea').first().fill('Court');
    await f.locator('textarea').last().fill('un motif');
    await cliquer(f.getByRole('button', { name: 'Afficher le message', exact: true }));
    const alerte = f.locator('.c-alerte-danger');
    await expect.poll(() => alerte.count()).toBe(1);
    // La fenêtre défile : sans quoi l'essai ne prouverait rien.
    expect(await f.evaluate((d) => d.scrollHeight - d.clientHeight)).toBeGreaterThan(100);
    const lisible = async (champ: ReturnType<Page['locator']>) => f.evaluate((d, [a, c]) => {
      const cadre = d.getBoundingClientRect(), pied = (d.querySelector('.c-dialogue-pied') as HTMLElement).getBoundingClientRect();
      const r = (a as HTMLElement).getBoundingClientRect(), x = (c as HTMLElement).getBoundingClientRect();
      const dessous = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { refusVu: r.top >= cadre.top && r.bottom <= pied.top + 0.5 && !!dessous && (a as HTMLElement).contains(dessous),
        champVu: x.top >= cadre.top && x.bottom <= r.top + 0.5, focus: document.activeElement === c };
    }, [await alerte.elementHandle(), await champ.elementHandle()] as const);
    // Le texte, en haut : la phrase du refus reste au-dessus du pied, le champ au-dessus d'elle, le curseur dedans.
    expect(await lisible(f.locator('textarea').first())).toEqual({ refusVu: true, champVu: true, focus: true });
    expect(net(await alerte.innerText())).toContain('dix à deux cent quarante caractères');
    // Le jour de fin, plus bas : même chose.
    await f.locator('textarea').first().fill('La relance automatique des devis arrive bientôt.');
    await f.locator('input[type="date"]').last().fill(plusJours(aujourdhuiATunis(), 40));
    await cliquer(f.getByRole('button', { name: 'Afficher le message', exact: true }));
    await expect.poll(async () => net(await alerte.innerText())).toContain('trente jours au plus');
    expect(await lisible(f.locator('input[type="date"]').last())).toEqual({ refusVu: true, champVu: true, focus: true });
    // Le motif, tout en bas, refusé pendant qu'on regarde le haut de la fenêtre : il vient à l'écran, au-dessus du refus.
    await f.locator('input[type="date"]').last().fill(plusJours(aujourdhuiATunis(), 7));
    await f.locator('textarea').last().fill('ok');
    await f.evaluate((d) => { d.scrollTop = 0; });
    // Un clic de souris, à l'endroit du bouton, comme un humain : le clic d'un sélecteur ferait d'abord défiler la
    // fenêtre jusqu'au bouton (collé en bas, il « est » à la fin du corps), et le motif serait déjà à l'écran.
    const bouton = await f.getByRole('button', { name: 'Afficher le message', exact: true }).boundingBox();
    if (!bouton) throw new Error('le bouton « Afficher le message » n\'est pas à l\'écran');
    await p.mouse.click(bouton.x + bouton.width / 2, bouton.y + bouton.height / 2);
    await expect.poll(async () => net(await alerte.innerText())).toContain('motif');
    expect(await f.evaluate((d) => d.scrollTop)).toBeGreaterThan(0);
    expect(await lisible(f.locator('textarea').last())).toEqual({ refusVu: true, champVu: true, focus: true });
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('écrire, remplacer, retirer : le bandeau du client suit ; « Plus tard » garde la place, un message neuf reparaît', async () => {
    const p = await console_(jD, 'messages');
    await ecrire(p, 'La relance automatique des devis arrive dans SkanFact.', 'nouveaute', 'annonce de la relance');
    await expect.poll(async () => net(await p.locator('.c-rg-actuel').innerText())).toContain('La relance automatique des devis arrive dans SkanFact.');
    // Qui l'a écrit et pourquoi, sans point derrière les deux-points ; et pas encore de message passé.
    expect(net(await p.locator('.c-rg-actuel').innerText())).toMatch(/Écrit par Amira Réglages, aujourd'hui, \d\d:\d\d : « annonce de la relance »$/);
    expect(net(await p.locator('main').innerText())).toContain('Aucun message passé : celui d\'au-dessus est le premier.');
    let c = await client();
    const bandeau = c.locator('#view > .sk-message');
    await expect.poll(() => bandeau.count(), { timeout: 20_000 }).toBe(1);
    expect(await bandeau.getAttribute('class')).toContain('sk-message-nouveaute');
    expect(net(await bandeau.innerText())).toMatch(/^Nouveauté La relance automatique des devis arrive dans SkanFact\. Plus tard$/);
    // « Plus tard » : la place reste, avec sa phrase ; le titre de la page ne bouge pas sous le curseur.
    const titre = c.locator('#view .page-head h1');
    const avant = await titre.boundingBox();
    await cliquer(bandeau.locator('.sk-message-plus-tard'));
    expect(await bandeau.getAttribute('class')).toContain('sk-message-cache');
    expect(net(await bandeau.innerText())).toBe('Message caché sur cet appareil : un nouveau message reparaîtra.');
    expect((await titre.boundingBox())?.y).toBe(avant?.y);
    // À la page suivante, plus rien ; et toujours rien au rechargement (le choix est gardé sur l'appareil).
    await c.goto(`${serveur.adresse}/v10/?e=${ent}#/factures`);
    await expect.poll(() => c.locator('#view .page-head h1').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await c.waitForTimeout(1_000);
    expect(await bandeau.count()).toBe(0);
    // Un message neuf (une maintenance) remplace le premier : il reparaît, dans le bleu de l'information.
    await ecrire(p, 'Maintenance dimanche de 22 h à 23 h : SkanFact sera indisponible.', 'maintenance', 'la maintenance');
    await c.reload();
    await expect.poll(() => bandeau.count(), { timeout: 20_000 }).toBe(1);
    expect(await bandeau.getAttribute('class')).toContain('sk-message-maintenance');
    expect(net(await bandeau.innerText())).toContain('Maintenance prévue Maintenance dimanche');
    await expect.poll(async () => net(await p.locator('.c-table').innerText())).toMatch(/La relance automatique des devis.*Remplacé le/);
    // Les jours d'un message passé sont ceux qui étaient prévus : la colonne le dit, à côté de la façon dont il est parti.
    // (Le texte des cellules, pas leur rendu : la feuille de style met les en-têtes en capitales.)
    expect((await p.locator('.c-table thead th').allTextContents()).map(net)).toEqual(['Sorte', 'Ce que les clients ont lu', 'Prévu', 'Comment il est parti']);
    // Retiré : il disparaît de l'application, et la console le range dans les messages passés, avec son motif.
    await cliquer(p.getByRole('button', { name: 'Le retirer maintenant…' }));
    const f = p.locator('[role="dialog"]');
    expect(net(await f.locator('.c-champ-aide').last().innerText())).toMatch(/^Pourquoi le retirer avant le \d\d\/\d\d\/\d{4}\.$/);
    await f.locator('textarea').fill('maintenance reportée');
    await cliquer(f.getByRole('button', { name: 'Retirer', exact: true }));
    await expect.poll(async () => net(await p.locator('.c-table').innerText())).toMatch(/Retiré le .*« maintenance reportée »/);
    await fermer(c);
    c = await client();
    await c.waitForTimeout(1_500);
    expect(await c.locator('#view > .sk-message').count()).toBe(0);
    expect(erreurs).toEqual([]);
    await fermer(c);
    await fermer(p);
  }, 120_000);

  it('un message pour les clients en essai (0139, C63) : la fenêtre dit combien il en atteint ; l\'entreprise en essai le voit, sa diffusion se compte ; l\'abonnée ne le voit pas', async () => {
    // Une seconde entreprise du même client, abonnée Complet : le message ne la vise pas.
    const abonnee = String((await api('POST', '/entreprises', jClient, { raisonSociale: 'Studio Lina Abonnée' })).corps.id);
    await admin.query(`update plateforme.abonnement set paye_jusqu_au = current_date + 100, offre = 'complet', periodicite = 'annuel' where entreprise = $1`, [abonnee]);
    const portee = (await api('GET', '/console/reglages', jD)).corps.portee as Record<string, number>;
    const p = await console_(jD, 'messages');
    await cliquer(p.getByRole('button', { name: 'Écrire un message…' }));
    const f = p.locator('[role="dialog"]');
    // Chaque public dit, avant le geste, combien d'entreprises il atteint aujourd'hui (le compte du serveur).
    const qui = f.getByLabel('À qui', { exact: true });
    expect((await qui.locator('option').allTextContents()).map(net)).toEqual([
      `Tous les clients · ${portee.tous}`, `Les clients en essai · ${portee.essai}`, `Les abonnés Essentiel · ${portee.essentiel}`,
      `Les abonnés Complet · ${portee.complet}`, `Les clients en retard de paiement · ${portee.en_retard}`, `Les clients en lecture seule · ${portee.lecture_seule}`]);
    await qui.selectOption('essai');
    const aide = p.locator(`[id="${await qui.getAttribute('aria-describedby')}"]`);
    expect(net(await aide.innerText())).toMatch(new RegExp(`^${portee.essai === 1 ? 'Une entreprise' : `${portee.essai} entreprises`} aujourd'hui, d'après l'état de`));
    await cliquer(f.getByRole('button', { name: 'Annuler', exact: true }));
    await expect.poll(() => f.count()).toBe(0);
    await ecrire(p, 'Ton essai : découvre la relance automatique des devis.', 'nouveaute', 'pour les essais', 'essai');
    const actuel = p.locator('.c-rg-actuel');
    await expect.poll(async () => net(await actuel.innerText())).toContain('Pour les clients en essai');
    expect(net(await actuel.locator('.c-rg-diffusion').innerText())).toBe('Pas encore vu : aucune entreprise ne l\'a affiché');
    // L'entreprise en essai le voit ; « Plus tard » le cache ; l'abonnée ne le voit pas.
    const c = await client();
    const bandeau = c.locator('#view > .sk-message');
    await expect.poll(() => bandeau.count(), { timeout: 20_000 }).toBe(1);
    // Montré : l'application le dit dès qu'il paraît, avant tout « Plus tard ».
    const vus = async (caches: boolean) => (await admin.query(`select count(*)::int n from plateforme.message_diffusion d join plateforme.message_clients m on m.id = d.message
      where m.texte like 'Ton essai%' and (d.cache_le is not null) = $1`, [caches])).rows[0]?.n;
    await expect.poll(() => vus(false), { timeout: 10_000 }).toBe(1);
    await cliquer(bandeau.locator('.sk-message-plus-tard'));
    await expect.poll(() => vus(true), { timeout: 10_000 }).toBe(1);
    const autre = await client(abonnee);
    await expect.poll(() => autre.locator('#view .page-head h1').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await autre.waitForTimeout(1_500);
    expect(await autre.locator('#view > .sk-message').count()).toBe(0);
    // La console : vu dans une entreprise, caché dans une — jamais par qui.
    await p.reload();
    await expect.poll(async () => net(await p.locator('.c-rg-actuel .c-rg-diffusion').innerText().catch(() => '')), { timeout: 15_000 })
      .toBe('Vu dans une entreprise · une l\'a caché par « Plus tard »');
    expect((await admin.query('select count(*)::int n from plateforme.message_diffusion d join plateforme.message_clients m on m.id = d.message where m.texte like $1', ['Ton essai%'])).rows[0]?.n).toBe(1);
    expect(erreurs).toEqual([]);
    await fermer(autre);
    await fermer(c);
    await fermer(p);
  }, 120_000);

  it('les nouveautés : allumée pour une entreprise par son numéro, éteinte ; ouverte à tous, refermée ; le journal la nomme', async () => {
    const [salle, banque] = NOUVEAUTES as [typeof NOUVEAUTES[0], typeof NOUVEAUTES[0]];
    const numero = String((await admin.query('select plateforme.numero_texte($1) n', [ent])).rows[0]?.n);
    const p = await console_(jD, 'nouveautes');
    const bloc = p.locator(`[data-nouveaute="${salle.code}"]`);
    expect(net(await bloc.innerText())).toContain('Allumée pour personne');
    await cliquer(bloc.getByRole('button', { name: 'Allumer pour une entreprise…' }));
    const f = p.getByRole('dialog');
    await f.getByLabel('Son numéro de client').fill('Studio Lina Réglages');
    await f.getByLabel('Motif', { exact: true }).fill('Volontaire pour essayer');
    await cliquer(f.getByRole('button', { name: 'Allumer', exact: true }));
    // Un nom n'est pas un numéro : refusé sur sa case, sans rien envoyer.
    await expect.poll(async () => net(await f.locator('.c-alerte').innerText())).toMatch(/numéro de client, comme « E-0012 »/);
    await f.getByLabel('Son numéro de client').fill(numero.toLowerCase());
    await cliquer(f.getByRole('button', { name: 'Allumer', exact: true }));
    await expect.poll(() => f.count()).toBe(0);
    await expect.poll(async () => net(await bloc.innerText())).toContain('1 entreprise volontaire');
    expect(net(await bloc.locator('tbody tr').innerText())).toMatch(new RegExp(`Studio Lina Réglages ${numero}.*allumée par Amira Réglages.*« Volontaire pour essayer »`));
    expect(net(await p.locator('.c-onglets [aria-current="page"]').innerText())).toMatch(/Nouveautés allumées 1/);
    expect((await api('GET', `/entreprises/${ent}/nouveautes`, jClient)).corps.nouveautes).toEqual([salle.code]);
    // L'éteindre : la ligne s'en va ; le client ne l'a plus.
    await cliquer(bloc.getByRole('button', { name: 'Éteindre pour Studio Lina Réglages' }));
    await f.getByLabel('Motif', { exact: true }).fill('Elle préfère attendre');
    await cliquer(f.getByRole('button', { name: 'Éteindre', exact: true }));
    await expect.poll(async () => net(await bloc.innerText())).toContain('Allumée pour personne');
    expect((await api('GET', `/entreprises/${ent}/nouveautes`, jClient)).corps.nouveautes).toEqual([]);
    // L'ouvrir à tous : la fenêtre dit qu'aucune volontaire ne la garde à la refermeture ; tout le monde la voit.
    const autre = p.locator(`[data-nouveaute="${banque.code}"]`);
    await cliquer(autre.getByRole('button', { name: 'L\'ouvrir à tous…' }));
    expect(net(await f.innerText())).toContain('On la referme d\'un geste.');
    await f.getByLabel('Motif', { exact: true }).fill('Essayée trois semaines');
    await cliquer(f.getByRole('button', { name: 'L\'ouvrir à tous', exact: true }));
    await expect.poll(async () => net(await autre.innerText())).toMatch(/Ouverte à toutes les entreprises.*Ouverte à tous depuis le .*, par Amira Réglages : « Essayée trois semaines »/);
    expect((await api('GET', `/entreprises/${ent}/nouveautes`, jClient)).corps.nouveautes).toEqual([banque.code]);
    await cliquer(autre.getByRole('button', { name: 'La refermer…' }));
    expect(net(await f.innerText())).toContain('Aucune entreprise volontaire ne la garde');
    await f.getByLabel('Motif', { exact: true }).fill('Un défaut trouvé');
    await cliquer(f.getByRole('button', { name: 'La refermer', exact: true }));
    await expect.poll(async () => net(await autre.innerText())).toContain('Allumée pour personne');
    // Le journal nomme la nouveauté, et l'entreprise quand elle s'allume pour elle.
    await p.goto(`${serveur.adresse}/console/#/journal`);
    const ligne = p.locator('tr', { hasText: 'Nouveauté éteinte pour une entreprise' }).filter({ hasText: 'Studio Lina Réglages' }).first();
    await expect.poll(async () => net(await ligne.innerText()), { timeout: 20_000 }).toContain('La caisse en salle');
    expect(net(await p.locator('tr', { hasText: 'Nouveauté refermée' }).filter({ hasText: 'Un défaut trouvé' }).first().innerText()))
      .toContain('La nouveauté « Le rapprochement bancaire »');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 120_000);

  it('le support lit les réglages, sans aucun geste', async () => {
    const p = await console_(jS);
    expect(net(await p.locator('.c-alerte-info').first().innerText())).toMatch(/^Réservé à la direction\./);
    await p.goto(`${serveur.adresse}/console/#/reglages?onglet=regles`);
    await expect.poll(() => p.locator('.c-rg-regle').count()).toBeGreaterThan(0);
    expect(await p.getByRole('button', { name: 'Noter la relecture du comptable…' }).count()).toBe(0);
    await p.goto(`${serveur.adresse}/console/#/reglages?onglet=messages`);
    await expect.poll(async () => net(await p.locator('main').innerText())).toContain('Les messages passés');
    expect(await p.getByRole('button', { name: 'Écrire un message…' }).count()).toBe(0);
    await p.goto(`${serveur.adresse}/console/#/reglages?onglet=nouveautes`);
    await expect.poll(() => p.locator('[data-nouveaute]').count()).toBe(2);
    expect(await p.locator('[data-nouveaute] button').count()).toBe(0);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('les formats officiels : chaque format, sa version et ce qui reste À VÉRIFIER ; une pièce retenue se compte sur l\'onglet et se dit en couleur', async () => {
    // Une facture du client, écrite, signée, puis retenue (son compte TTN manque) : posée par la base comme l'émission et
    // la signature l'écrivent (0049 à 0051).
    const uid = (await admin.query('select utilisateur from socle.membre where entreprise = $1 limit 1', [ent])).rows[0].utilisateur;
    const tiers = (await admin.query('insert into socle.tiers (entreprise, raison_sociale) values ($1, \'Client retenu\') returning id', [ent])).rows[0].id;
    const piece = (await admin.query(`insert into ventes.piece (entreprise, type, tiers, date_piece, echeance, net_a_payer, cree_par)
      values ($1, 'facture', $2, current_date, current_date, 100, $3) returning id`, [ent, tiers, uid])).rows[0].id;
    await admin.query(`insert into ventes.efacture (piece, entreprise, nom, xml, empreinte, version, ecrit_le, ecrit_par)
      values ($1, $2, 'TEIF_retenue.xml', '<TEIF/>', $3, $4, now(), $5)`, [piece, ent, 'a'.repeat(64), versionTeif(), uid]);
    const demande = (await admin.query(`insert into ventes.signature_demande (entreprise, pieces, identifiant, session, statut, cree_le, cree_par)
      values ($1, $2, 'essai', 'essai', 'signee', now(), $3) returning id`, [ent, [piece], uid])).rows[0].id;
    await admin.query(`insert into ventes.efacture_signee (piece, entreprise, xml, empreinte, demande, signe_le, signe_par)
      values ($1, $2, '<TEIF/>', $3, $4, now(), $5)`, [piece, ent, 'b'.repeat(64), demande, uid]);
    await admin.query(`insert into ventes.envoi_ttn (piece, entreprise, statut, prochain_essai, motif, cree_le, cree_par)
      values ($1, $2, 'a_envoyer', now(), $3, now(), $4)`, [piece, ent, JSON.stringify({ cle: 'efacture.ttn_sans_compte', valeurs: {} }), uid]);

    const p = await console_(jD);
    // L'onglet compte ce qui demande un geste chez un client (d'autres fichiers de tests en posent peut-être aussi).
    const onglet = p.locator('.c-onglets a', { hasText: 'Formats officiels' });
    await expect.poll(async () => Number(/(\d+)/.exec(net(await onglet.innerText()))?.[1] ?? 0)).toBeGreaterThanOrEqual(1);
    await cliquer(onglet);
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/reglages?onglet=formats');
    const lignes = p.locator('.c-rg-formats tbody tr');
    await expect.poll(() => lignes.count(), { timeout: 15_000 }).toBe(8);
    // L'en-tête dit les cinq questions de la maquette ; la version du fichier vient du code qui l'écrit.
    expect((await p.locator('.c-rg-formats thead th').allTextContents()).map(net))
      .toEqual(['Le format', 'Sa version', 'Ce que SkanFact en fait', 'Vérifié contre', 'Où on en est']);
    expect(net(await lignes.nth(0).innerText())).toContain(`TEIF ${versionTeif()}`);
    // Ce qui reste À VÉRIFIER se lit sur sa ligne, pour chaque format sauf l'export des écritures.
    expect(await p.locator('.c-rg-formats .c-rg-verifier').count()).toBe(7);
    expect(net(await lignes.filter({ hasText: 'L\'export des écritures' }).innerText())).not.toContain('À VÉRIFIER');
    // L'envoi à la TTN : la pièce retenue en couleur d'alerte, et ce serveur qui n'a pas l'adresse de la TTN.
    const ttn = lignes.filter({ hasText: 'L\'envoi à la TTN' });
    expect(await ttn.getAttribute('class')).toContain('c-rg-format-alerte');
    expect(net(await ttn.locator('.c-rg-format-geste').first().innerText())).toMatch(/^(Une retenue chez son entreprise|\d+ retenues chez leur entreprise)/);
    expect(net(await ttn.innerText())).toContain('Ce serveur n\'a pas l\'adresse de la TTN : les pièces signées attendent.');
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('au téléphone : aucun onglet ne déborde', async () => {
    for (const onglet of ['', 'regles', 'formats', 'messages', 'nouveautes']) {
      const p = await console_(jD, onglet, 390, 844);
      expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), onglet || 'prix').toBeLessThanOrEqual(0);
      if (!onglet) {
        // Ce que chaque offre comprend : une fiche par ligne, où Complet se lit sans faire défiler le tableau.
        const complet = p.locator('section[aria-labelledby="rg-contenu"] tr[data-quoi="caisses"] td[data-offre="complet"]');
        const boite = await complet.boundingBox();
        expect(boite && boite.x + boite.width).toBeLessThanOrEqual(390);
        expect(net(await complet.innerText())).toMatch(/^2/);
      }
      await fermer(p);
    }
    expect(erreurs).toEqual([]);
  }, 60_000);
});
