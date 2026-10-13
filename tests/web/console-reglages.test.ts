// « Réglages » de la plateforme, à la souris (docs/console.md C28 ; serveur/console/reglages.ts ;
// web/console/src/ecrans/Reglages.tsx ; web/public/plateforme/message.js). Ce que le parcours vérifie :
//   - la grille du jour et la frise des échéances ;
//   - la relecture d'une règle : la fenêtre nomme la règle, l'avis se choisit, et la carte dit qui l'a relue ;
//   - un refus dans une longue fenêtre se lit au-dessus des boutons, et le champ refusé reste à l'écran (vu le
//     13/10/2026 à la souris : la phrase tombait sous le bas de la fenêtre, on ne voyait qu'un cadre rouge) ;
//   - écrire, remplacer, retirer un message : le bandeau de l'application du client suit ; « Plus tard » le cache sans
//     faire remonter la page sous le curseur, et un message neuf reparaît ;
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
import { cliquer } from '../cliquer.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();
const CODE = 'essai.web_reglages';

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
  const client = async () => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jClient);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await expect.poll(() => p.locator('#view .page-head h1').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    return p;
  };
  const fermer = (p: Page) => p.context().close();
  const ecrire = async (p: Page, texte: string, sorte: 'nouveaute' | 'maintenance', motif: string) => {
    await cliquer(p.getByRole('button', { name: 'Écrire un message…' }));
    const f = p.locator('[role="dialog"]');
    await f.locator('select').selectOption(sorte);
    await f.locator('textarea').first().fill(texte);
    await f.locator('textarea').last().fill(motif);
    await cliquer(f.getByRole('button', { name: 'Afficher le message', exact: true }));
    await expect.poll(() => f.count()).toBe(0);
  };

  beforeAll(async () => {
    await admin.connect();
    await admin.query('delete from plateforme.message_clients');
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source) values ($1, '250', '2024-01-01', 'Une règle d''essai : à vérifier avec un comptable')`, [CODE]);
    fs.writeFileSync(veille, JSON.stringify({ problemes: {} }));
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_VEILLE_FICHIER: veille }), port: 0, web: dossier, livreurMs: 60_000 });
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
    // Aucun message ne reste affiché : les parcours suivants ouvrent l'application des clients sans lui.
    await admin.query('delete from plateforme.message_clients');
    await navigateur?.close(); await serveur?.arreter(); await admin.end();
    fs.rmSync(dossier, { recursive: true, force: true }); fs.rmSync(path.dirname(veille), { recursive: true, force: true });
  });

  it('les offres et prix : la grille du jour, en dinars hors taxes, et la frise des échéances', async () => {
    const p = await console_(jD);
    expect(net(await p.locator('.c-onglets [aria-current="page"]').innerText())).toBe('Offres et prix');
    const grille = net(await p.locator('.c-rg-grille').innerText());
    expect(grille).toMatch(/Essentiel.*390,000 DT.*39,000 DT/);
    expect(grille).toMatch(/Complet.*690,000 DT.*69,000 DT/);
    expect(await p.locator('.c-rg-frise li').count()).toBeGreaterThanOrEqual(4);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

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

  it('le support lit les réglages, sans aucun geste', async () => {
    const p = await console_(jS);
    expect(net(await p.locator('.c-alerte-info').first().innerText())).toMatch(/^Réservé à la direction\./);
    await p.goto(`${serveur.adresse}/console/#/reglages?onglet=regles`);
    await expect.poll(() => p.locator('.c-rg-regle').count()).toBeGreaterThan(0);
    expect(await p.getByRole('button', { name: 'Noter la relecture du comptable…' }).count()).toBe(0);
    await p.goto(`${serveur.adresse}/console/#/reglages?onglet=messages`);
    await expect.poll(async () => net(await p.locator('main').innerText())).toContain('Les messages passés');
    expect(await p.getByRole('button', { name: 'Écrire un message…' }).count()).toBe(0);
    expect(erreurs).toEqual([]);
    await fermer(p);
  }, 60_000);

  it('au téléphone : aucun onglet ne déborde', async () => {
    for (const onglet of ['', 'regles', 'messages']) {
      const p = await console_(jD, onglet, 390, 844);
      expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), onglet || 'prix').toBeLessThanOrEqual(0);
      await fermer(p);
    }
    expect(erreurs).toEqual([]);
  }, 60_000);
});
