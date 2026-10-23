// L'abonnement après sa revue, lot 1, à la souris (1.118.0 ; docs/revue-abonnement.md ; web/v10/abonnement-revue.txt,
// plateforme/abonnement.js). Ce que le parcours vérifie :
//   - l'accueil le dit, en haut, quand l'essai finit, en grâce et en lecture seule, avec un seul bouton ; en grâce et en
//     lecture seule il est le bouton principal, les premiers pas se taisent, et en lecture seule l'en-tête ne propose
//     plus de créer ; à qui ne règle pas l'abonnement, le bouton dit qui le fait ;
//   - « Ton abonnement » dit ce qui rouvre tel que ça se passe, la grâce sur sa durée, l'essai prolongé sans un total
//     faux ; une entreprise suspendue n'est pas invitée à s'abonner, mais à nous écrire.

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

describe('l\'abonnement après sa revue, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-abonnement-revue-'));
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
    const email = `${prenom.toLowerCase()}-abo-revue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
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
  const finEssai = (ent: string, jour: string) => admin.query('update plateforme.abonnement set essai_jusqu_au = $2 where entreprise = $1', [ent, jour]);
  const aujourdhui = aujourdhuiATunis();
  const bandeau = (p: Page) => p.locator('#abo-accueil').innerText().then(net).catch(() => '');
  const principaux = (p: Page) => p.locator('#view .btn-primary:visible').evaluateAll((l) => l.map((b) => b.id || b.textContent?.trim()));

  it('en lecture seule, l\'accueil le dit en haut avec un seul bouton, et ne propose plus de créer ; il mène aux offres', async () => {
    const nadia = await personne('Nadia');
    const ent = String((await api('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Quincaillerie Fermée' })).corps.id);
    await finEssai(ent, plusJours(aujourdhui, -10));
    const p = await ouvrir(nadia.jeton, ent, '#/dashboard');
    await expect.poll(() => bandeau(p), { timeout: 15_000 }).toBe(`Lecture seule depuis le ${jourEnFrancais(plusJours(aujourdhui, -2))}. L'essai est terminé. Tout se lit, s'imprime et s'exporte, mais rien de nouveau ne se crée. Choisis ton offre : dès que sa facture est réglée, tout se rouvre. Choisir mon offre`);
    expect(await principaux(p)).toEqual(['abo-accueil-go']);
    expect(await p.locator('#new-devis, #new-facture').count()).toBe(0);
    expect(await p.locator('#view .pp-accueil, #view .premiers-pas').count()).toBe(0);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'abonnement-revue-1-accueil-lecture-seule.png') });
    await p.locator('#abo-accueil-go').click();
    await expect.poll(() => p.locator('#abonnement-panel .abo-tete h3').innerText().then(net).catch(() => ''), { timeout: 15_000 }).toMatch(/^En lecture seule depuis le /);
    expect(net(await p.locator('#abonnement-panel .abo-tete p').first().innerText())).toBe('L\'essai est terminé. Tout se lit, s\'imprime et s\'exporte ; tes données restent à toi. Choisis ton offre : ta facture arrive ici, et dès qu\'elle est réglée, tout se rouvre, tel que tu l\'as laissé.');
    expect(net(await p.locator('#abonnement-panel').innerText())).not.toContain('aussitôt');
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('en grâce, le bouton du bandeau est le seul vert : « + Nouvelle facture » ne l\'est plus, les premiers pas se taisent ; la grâce se dit sur sa durée', async () => {
    const sonia = await personne('Sonia');
    const ent = String((await api('POST', '/entreprises', sonia.jeton, { raisonSociale: 'Atelier en Grâce' })).corps.id);
    await finEssai(ent, plusJours(aujourdhui, -2));
    const p = await ouvrir(sonia.jeton, ent, '#/dashboard');
    await expect.poll(() => bandeau(p), { timeout: 15_000 }).toMatch(/^Ton essai est terminé\. Tout marche encore jusqu'au .+ ; le .+, l'entreprise passe en lecture seule\. Choisis ton offre avant cette date\. Choisir mon offre$/);
    expect(await principaux(p)).toEqual(['abo-accueil-go']);
    expect(await p.locator('#new-facture').count()).toBe(1);
    expect(await p.locator('#view .pp-accueil, #view .premiers-pas').count()).toBe(0);
    await p.locator('#abo-accueil-go').click();
    await expect.poll(() => p.locator('#abonnement-panel .abo-jauge-txt').innerText().then(net).catch(() => ''), { timeout: 15_000 }).toBe('Encore 6 jours de grâce, sur 7');
    // Rien n'attend son paiement : il faut choisir, pas « régler ».
    expect(net(await p.locator('#abonnement-panel .abo-pastille').innerText())).toBe('Essai terminé');
    // Au téléphone, le bandeau et son bouton se voient dès l'ouverture, de toute la largeur.
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR', isMobile: true, hasTouch: true });
    await tel.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, sonia.jeton);
    const t = await tel.newPage();
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await plusTard(t);
    await expect.poll(() => bandeau(t), { timeout: 20_000 }).toContain('Ton essai est terminé.');
    // Mesuré une fois l'accueil posé (il se redessine quand l'abonnement est relu).
    await expect.poll(async () => { const b = await t.locator('#abo-accueil-go').boundingBox(); return !!b && b.y + b.height < 844 && b.width > 300 && b.height >= 44; },
      { timeout: 15_000 }).toBe(true);
    await t.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'abonnement-revue-2-accueil-grace-telephone.png') });
    await tel.close();
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('à un commercial, le bandeau dit qui règle l\'abonnement ; à l\'essai qui court, l\'accueil ne dit rien', async () => {
    const nadia = await personne('Nadia');
    const ent = String((await api('POST', '/entreprises', nadia.jeton, { raisonSociale: 'Quincaillerie de Karim' })).corps.id);
    const karim = await personne('Karim');
    const inv = String((await api('POST', `/entreprises/${ent}/invitations`, nadia.jeton, { email: karim.email, roles: ['commercial'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', karim.jeton, { jeton: inv })).statut).toBe(200);
    const p = await ouvrir(nadia.jeton, ent, '#/dashboard');
    await p.locator('#view h1').first().waitFor();
    await p.waitForTimeout(1500);
    expect(await p.locator('#abo-accueil').count()).toBe(0);
    await finEssai(ent, plusJours(aujourdhui, -10));
    const k = await ouvrir(karim.jeton, ent, '#/dashboard');
    await expect.poll(() => bandeau(k), { timeout: 15_000 }).toContain('C\'est le propriétaire de l\'entreprise, ou un administrateur, qui règle l\'abonnement. Qui le règle ?');
    await k.locator('#abo-accueil-go').click();
    await expect.poll(() => k.locator('#modal-root .modal h2').last().innerText().catch(() => ''), { timeout: 10_000 }).toBe('L\'abonnement de l\'entreprise');
    expect(erreurs).toEqual([]);
  }, 120_000);

  it('suspendue, l\'entreprise est invitée à nous écrire, jamais à s\'abonner ; prolongé, l\'essai ne dit pas un total faux', async () => {
    const nizar = await personne('Nizar');
    const ent = String((await api('POST', '/entreprises', nizar.jeton, { raisonSociale: 'Garage Suspendu' })).corps.id);
    await admin.query('update plateforme.abonnement set suspendu_le = $2 where entreprise = $1', [ent, aujourdhui]);
    const p = await ouvrir(nizar.jeton, ent, '#/dashboard');
    await expect.poll(() => bandeau(p), { timeout: 15_000 }).toContain('SkanFact a suspendu l\'abonnement : écris-nous pour rouvrir l\'entreprise.');
    expect(net(await p.locator('#abo-accueil-go').innerText())).toBe('Écrire à SkanFact');
    await p.evaluate(() => { location.hash = '#/parametres'; });
    await p.locator('#set-tabs [data-tab="abonnement"]').click();
    await expect.poll(() => p.locator('#abonnement-panel .abo-pastille').innerText().then(net).catch(() => ''), { timeout: 15_000 }).toBe('Suspendu');
    expect(await p.locator('#abonnement-panel a.abo-tete-btn').getAttribute('href')).toMatch(/^mailto:contact@skanfact\.tn/);
    expect(await p.locator('#abonnement-panel [data-choisir]').count()).toBe(0);
    expect(net(await p.locator('#abonnement-panel').innerText())).not.toMatch(/abonne-toi|Choisis ton offre/);

    // Un essai prolongé de quatorze jours : dix-neuf jours restent, sur un essai qui en dure désormais quarante-quatre.
    const fethi = await personne('Fethi');
    const e2 = String((await api('POST', '/entreprises', fethi.jeton, { raisonSociale: 'Menuiserie Prolongée' })).corps.id);
    await finEssai(e2, plusJours(aujourdhui, 19));
    await admin.query("insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, avant, apres) values ($1, 'essai_prolonge', 'exploitation', 'il attend son comptable', '{}', jsonb_build_object('essaiJusquAu', $2::text))", [e2, plusJours(aujourdhui, 19)]);
    const f = await ouvrir(fethi.jeton, e2, '#/parametres');
    await f.locator('#set-tabs [data-tab="abonnement"]').click();
    await expect.poll(() => f.locator('#abonnement-panel .abo-jauge-txt').innerText().then(net).catch(() => ''), { timeout: 15_000 }).toBe('19 jours restants');
    expect(erreurs).toEqual([]);
  }, 120_000);
});
