// L'abonnement, à la souris (lot des fonctions qui manquent, 14a, 12/10/2026 ; migration 0082, docs/abonnement.md ;
// web/v10/abonnement-essai.txt, plateforme/abonnement.js). Ce que le parcours vérifie, écran ET serveur :
//   - l'essai qui finit dans cinq jours se dit dans la barre (en orange) et sur « Me guider » ; le bouton de la carte
//     ouvre l'onglet « Ton abonnement », qui dit les jours, les deux offres et comment s'abonner ;
//   - en lecture seule, l'onglet le dit avec le jour ; une NOUVELLE pièce le dit à l'ouverture, avant la saisie, et
//     « Enregistrer » est refusé avant le contrôle de la saisie : rien n'arrive au serveur ; le bouton du refus mène à
//     l'abonnement ;
//   - un commercial voit la lecture seule, pas l'onglet ; la pastille lui dit qui règle l'abonnement.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { jourEnFrancais, plusJours } from '../../serveur/abonnement/etat.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('l\'abonnement, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-abonnement-'));
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
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const personne = async (prenom: string) => {
    const email = `${prenom.toLowerCase()}-abonnement-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: 'Un-bon-mot-de-passe' });
    return { email, jeton: String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const erreurs: string[] = [];
  const ouvrir = async (jeton: string, ent: string, hash: string) => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 20_000 }).not.toBe('');
    await plusTard(p);
    return p;
  };
  const pastille = (p: Page) => p.locator('#lic-banner').innerText().then(net).catch(() => '');
  const aujourdhui = aujourdhuiATunis();
  const finEssai = (ent: string, jour: string) => admin.query('update plateforme.abonnement set essai_jusqu_au = $2 where entreprise = $1', [ent, jour]);

  it('l\'essai qui finit se dit ; en lecture seule, une nouvelle pièce le dit avant la saisie et rien n\'arrive au serveur', async () => {
    const nadia = await personne('Nadia');
    const ent = String((await api('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Quincaillerie de l\'essai' })).corps.id);
    const karim = await personne('Karim');
    const inv = String((await api('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email: karim.email, roles: ['commercial'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', karim.jeton, { jeton: inv })).statut).toBe(200);

    // ── L'essai finit dans cinq jours : la barre le dit en orange, « Me guider » aussi ─────────────────────────────────
    await finEssai(ent, plusJours(aujourdhui, 5));
    const p = await ouvrir(nadia.jeton, ent, '#/guide');
    await expect.poll(() => pastille(p), { timeout: 15_000 }).toBe('Essai — 5 jours avant la fin');
    expect(await p.locator('#lic-banner').getAttribute('class')).toMatch(/\bwarn\b/);
    await expect.poll(() => p.locator('#g-essai-t').innerText().then(net), { timeout: 10_000 }).toBe('Ton essai : encore 5 jours');
    expect(await p.locator('#g-licence').innerText()).toBe('Voir l\'abonnement');

    // Le bouton de la carte ouvre l'onglet « Ton abonnement » : les jours, les deux offres, comment s'abonner.
    await p.locator('#g-licence').click();
    await expect.poll(() => p.locator('#abonnement-panel .abo-tete h3').innerText().then(net).catch(() => ''), { timeout: 15_000 }).toBe('Encore 5 jours d\'essai');
    expect(await p.locator('#set-tabs [data-tab="abonnement"]').getAttribute('class')).toMatch(/\bactive\b/);
    expect(await p.locator('#abonnement-panel .abo-offre h4').allInnerTexts()).toEqual(['Essentiel', 'Complet']);
    expect((await p.locator('#abonnement-panel .abo-prix b').allInnerTexts()).map(net)).toEqual(['390', '690']);
    // S'abonner se fait ici (1.84.0, C19) : les quatre choix et « Je choisis cette offre », plus un e-mail.
    expect(await p.locator('#abo-choix .abo-choix-un').count()).toBe(4);
    expect(await p.getByRole('button', { name: 'Je choisis cette offre', exact: true }).count()).toBe(1);
    // Les règles telles qu'elles valent pour elle (0104), jamais écrites dans l'écran : la durée de SON essai (trente jours
    // à sa création), les rappels du jour, la grâce de son échéance.
    expect(net(await p.locator('#abonnement-panel .abo-jauge-txt').innerText())).toBe('5 jours sur 30');
    const etapes = net(await p.locator('#abonnement-panel .abo-etapes').innerText());
    expect(etapes).toContain('Les rappels Un e-mail 15 jours et 7 jours avant l\'échéance, puis la veille.');
    expect(etapes).toContain('7 jours de grâce Après l\'échéance, tout marche encore.');
    await p.screenshot({ animations: 'disabled', fullPage: true, path: path.join(PHOTOS, 'abonnement-1-essai.png') });

    // ── L'essai fini il y a dix jours : sept jours de grâce, puis la lecture seule depuis avant-hier ────────────────────
    await finEssai(ent, plusJours(aujourdhui, -10));
    const depuis = jourEnFrancais(plusJours(aujourdhui, -2));
    await p.reload();
    await plusTard(p);
    await expect.poll(() => pastille(p), { timeout: 15_000 }).toBe('Lecture seule — voir l\'abonnement');
    await p.locator('#set-tabs [data-tab="abonnement"]').click();
    await expect.poll(() => p.locator('#abonnement-panel .abo-tete h3').innerText().then(net).catch(() => ''), { timeout: 15_000 }).toBe(`En lecture seule depuis le ${depuis}`);
    await p.screenshot({ animations: 'disabled', fullPage: true, path: path.join(PHOTOS, 'abonnement-2-lecture-seule.png') });

    // Une nouvelle pièce le dit à l'ouverture, avant qu'on tape quoi que ce soit.
    await p.evaluate(() => { location.hash = '#/doc/new/devis'; });
    await expect.poll(() => p.locator('#abo-banner').innerText().then(net).catch(() => ''), { timeout: 15_000 })
      .toContain(`Lecture seule depuis le ${depuis} : cette nouvelle pièce ne pourra pas être enregistrée.`);
    expect(await p.locator('#abo-voir').innerText()).toBe('Voir l\'abonnement');
    // Le seul bouton principal est l'étape suivante : l'abonnement, plus « Enregistrer » (1.87.4).
    expect(await p.locator('#view .btn-primary:visible').evaluateAll((l) => l.map((b) => b.id))).toEqual(['abo-voir']);
    // Une facture aussi : « Émettre la facture » n'est plus le bouton principal.
    await p.evaluate(() => { location.hash = '#/doc/new/facture'; });
    await p.locator('#issue').waitFor({ timeout: 15_000 });
    expect(await p.locator('#view .btn-primary:visible').evaluateAll((l) => l.map((b) => b.id))).toEqual(['abo-voir']);
    // Et un achat.
    await p.evaluate(() => { location.hash = '#/achat/new'; });
    await p.locator('#view #abo-banner').waitFor({ timeout: 15_000 });
    expect(await p.locator('#view .btn-primary:visible').evaluateAll((l) => l.map((b) => b.id))).toEqual(['abo-voir']);
    await p.evaluate(() => { location.hash = '#/doc/new/devis'; });
    await p.locator('#abo-banner').waitFor({ timeout: 15_000 });
    // « Enregistrer » est refusé AVANT le contrôle de la saisie (on ne fait pas choisir un client pour rien)…
    await p.locator('#save').click();
    const refus = p.locator('#modal-root .modal').last();
    await expect.poll(() => refus.locator('h2').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toBe(`Lecture seule depuis le ${depuis}`);
    expect(net(await refus.innerText())).toContain('Créer un nouveau document : il faut un abonnement en cours.');
    // … et rien n'arrive au serveur.
    const documents = async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, nadia.jeton)).corps.objets as { collection: string }[]).filter((o) => o.collection === 'documents').length;
    expect(await documents()).toBe(0);
    // Le bouton du refus mène à l'abonnement.
    await refus.locator('#go-lic').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toBe('#/parametres');
    await expect.poll(() => p.locator('#abonnement-panel .abo-tete h3').isVisible().catch(() => false), { timeout: 15_000 }).toBe(true);

    // Au téléphone, menu fermé : la pastille se voit sous la barre du haut (1.87.9) — elle vivait dans le menu replié, et
    // la lecture seule ne se lisait qu'au refus d'une nouvelle facture. Le reste du pied du menu reste replié.
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR', isMobile: true, hasTouch: true });
    await tel.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, nadia.jeton);
    const t = await tel.newPage();
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await expect.poll(() => pastille(t), { timeout: 20_000 }).toBe('Lecture seule — voir l\'abonnement');
    const boite = await t.locator('#lic-banner').boundingBox();
    expect(boite && boite.y < 160 && boite.width > 300).toBe(true);
    expect(await t.locator('.sidebar-foot a[data-route="modules"]').isVisible()).toBe(false);
    await tel.close();

    // ── Un commercial : la lecture seule, pas l'onglet ; la pastille lui dit qui règle ─────────────────────────────────
    const k = await ouvrir(karim.jeton, ent, '#/parametres');
    await expect.poll(() => pastille(k), { timeout: 15_000 }).toBe('Lecture seule — voir l\'abonnement');
    expect(await k.locator('#set-tabs [data-tab="abonnement"]').count()).toBe(0);
    await k.locator('#lic-banner').click();
    const qui = k.locator('#modal-root .modal').last();
    await expect.poll(() => qui.locator('h2').innerText().catch(() => ''), { timeout: 10_000 }).toBe('L\'abonnement de l\'entreprise');
    expect(net(await qui.innerText())).toContain('C\'est le propriétaire de l\'entreprise, ou un administrateur, qui choisit l\'offre et règle l\'abonnement : préviens-le.');
    await k.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'abonnement-3-commercial.png') });
    await qui.getByRole('button', { name: 'Compris', exact: true }).click();

    expect(erreurs).toEqual([]);
  }, 180_000);
});
