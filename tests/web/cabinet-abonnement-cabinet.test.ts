// L'abonnement du cabinet, à la souris (lot 3 de l'abonnement, 1.120.0 ; migration 0172, docs/abonnement.md C22 ;
// plateforme/abonnement-cabinet.js, web/v10/abonnement-cabinet.txt). Ce que le parcours vérifie, écran ET serveur :
//   - « Ton abonnement », dans les Réglages du Cabinet, compte les dossiers tenus : trois gratuits ;
//   - « Nouveau dossier client » dit, AVANT la saisie, ce que le quatrième coûtera ; créé, sa facture arrive d'elle-même
//     dans « Ton abonnement », à payer, et la pastille du haut le dit ;
//   - payée en ligne (chez Konnect, sur le portefeuille de l'entreprise SkanFact), la page de retour ramène au Cabinet,
//     sur « Ton abonnement », payé jusqu'à la fin de sa période ; la pastille se tait.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { jourEnFrancais, plusJours } from '../../serveur/abonnement/etat.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';
import { konnectSimule } from '../konnect-simule.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('l\'abonnement du cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  let konnect: Awaited<ReturnType<typeof konnectSimule>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-abonnement-cabinet-'));
  const jour = aujourdhuiATunis();
  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const personne = async (prenom: string) => {
    const email = `${prenom.toLowerCase()}-abo-cab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: prenom, motDePasse: MDP });
    return { email, jeton: String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
  };
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    konnect = await konnectSimule();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    // La facture part seule (comme en production) ; le tour de la minute éloigné : seul celui lancé juste après un
    // dossier créé, pour son cabinet, travaille.
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_KONNECT: konnect.base,
      SKANFACT_FACTURE_AU_CHOIX: '1', SKANFACT_FACTURIER_MS: '3600000' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    // Amira, de la direction, désigne l'entreprise SkanFact et y branche le paiement en ligne.
    const amira = await personne('Amira');
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', amira.jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, amira.email, 'direction', 'mise en place des essais');
    const k = await api('POST', '/console/connexion', undefined, { email: amira.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
    const console = String((await api('POST', '/console/connexion/code', undefined, { defi: k.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const editeur = String((await api('POST', '/entreprises', amira.jeton, { raisonSociale: 'SkanFact Éditions SARL' })).corps.id);
    await admin.query('delete from plateforme.editeur');
    expect((await api('POST', '/console/reglages/factures/editeur', console, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
    expect((await api('GET', `/entreprises/${editeur}/dossier-v10`, amira.jeton)).statut).toBe(200);
    expect((await api('PUT', `/entreprises/${editeur}/paiement-en-ligne`, amira.jeton, { portefeuille: 'portefeuille-skanfact-cab', cle: 'sk_test_cle-de-l-api-konnect-c4a1' })).statut).toBe(200);
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await konnect?.fermer(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };

  it('Nadia : trois dossiers gratuits, le quatrième annoncé puis facturé, payé en ligne, et le retour sur son abonnement', async () => {
    const nadia = await personne('Nadia');
    await api('POST', '/moi/code', nadia.jeton, { methode: 'application' });
    const cabinet = String((await api('POST', '/cabinets', nadia.jeton, { nom: 'Cabinet Bouzid' })).corps.id);
    for (const nom of ['Boulangerie El Amal', 'Pharmacie Ennasr', 'Garage Sfax Auto']) {
      expect((await api('POST', `/cabinets/${cabinet}/dossiers`, nadia.jeton, { raisonSociale: nom })).statut).toBe(201);
    }
    const erreurs: string[] = [];
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, nadia.jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    const panneau = p.locator('#lic-panel');
    const versAbonnement = async () => {
      await p.evaluate(() => { location.hash = '#/reglages'; });
      await expect.poll(() => panneau.locator('#abo-etat').isVisible().catch(() => false), { timeout: 15_000 }).toBe(true);
    };
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossiers`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);

    // ── Trois dossiers tenus : les trois gratuits ; le panneau s'appelle « Ton abonnement » ──────────────────────────────
    await versAbonnement();
    expect(net(await p.locator('#pan-licence > h2').innerText())).toMatch(/^Ton abonnement/);
    expect(net(await panneau.locator('#abo-etat h3').innerText())).toBe('3 dossiers tenus sur 3 gratuits');
    expect((await panneau.locator('.abc-pastille').allInnerTexts()).map(net)).toEqual(['Gratuit', 'Gratuit', 'Gratuit']);
    expect(await p.locator('#lic-banner').isVisible()).toBe(false);

    // ── Le quatrième : ce qu'il coûtera se lit avant la saisie ───────────────────────────────────────────────────────────
    await p.evaluate(() => { location.hash = '#/dossiers'; });
    await cliquer(p.locator('#new-d'));
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('#nd-abonnement').innerText().then(net).catch(() => ''), { timeout: 10_000 })
      .toContain('Ce sera ton 4e dossier tenu : au-delà de tes 3 gratuits, il se paie 60 DT HT par an');
    await p.screenshot({ path: path.join(PHOTOS, 'abonnement-cabinet-1-avertissement.png') });
    await fenetre.locator('#f-name').fill('Librairie Le Savoir');
    await cliquer(fenetre.locator('#ok'));
    await expect.poll(() => p.locator('#modal-root .modal').count(), { timeout: 15_000 }).toBe(0);

    // ── Sa facture arrive d'elle-même ; la pastille du haut la dit ───────────────────────────────────────────────────────
    await versAbonnement();
    const facture = panneau.locator('#abo-factures .abo-facture').first();
    await expect.poll(() => facture.innerText().then(net).catch(() => ''), { timeout: 30_000 }).toContain('72,400 DT');
    const echeance = plusJours(jour, 15);
    expect(net(await panneau.locator('#abo-etat h3').innerText())).toBe(`Ta facture est à régler avant le ${jourEnFrancais(echeance)}`);
    await expect.poll(() => p.locator('#lic-banner').innerText().then(net).catch(() => ''), { timeout: 15_000 })
      .toBe(`Facture à régler avant le ${jourEnFrancais(echeance)}`);
    // Le vert de l'écran : régler la facture (un seul).
    expect((await panneau.locator('.btn-primary').allInnerTexts()).map(net)).toEqual(['Régler ma facture']);
    await p.screenshot({ path: path.join(PHOTOS, 'abonnement-cabinet-2-facture.png'), fullPage: true });

    // ── Payée chez Konnect, sur le portefeuille de SkanFact ; le retour ramène au Cabinet, sur son abonnement ───────────
    await cliquer(panneau.getByRole('button', { name: 'Régler ma facture', exact: true }));
    await p.waitForURL(/\/payer\//, { timeout: 15_000 });
    expect([...konnect.paiements.values()].find((x) => x.portefeuille === 'portefeuille-skanfact-cab')).toMatchObject({ montant: 72400, devise: 'TND' });
    await cliquer(p.getByRole('button', { name: 'Payer (simulation)' }));
    await p.waitForURL(/\/espace\/retour\.html/, { timeout: 15_000 });
    await expect.poll(() => p.locator('h1').innerText().catch(() => ''), { timeout: 15_000 }).toBe('Paiement reçu');
    // Le lien mène au Cabinet de CE cabinet (pas à une entreprise, ni à la dernière ouverte).
    expect(await p.getByRole('link', { name: 'Revenir à ton abonnement' }).getAttribute('href')).toBe(`/v10/cabinet/?c=${encodeURIComponent(cabinet)}`);
    // Les Réglages se redessinent quand une relecture arrive après leur premier dessin : au démarrage (la boîte de
    // réception, aussitôt lue), puis au retour dans la fenêtre (elle a changé). Rouge le 23/10/2026 sous la charge de la
    // batterie : le second dessin ne savait plus quel panneau amener, la page revenait en haut.
    await p.addInitScript(() => {
      const w = window as unknown as { cabinet?: Record<string, unknown>; __boiteLue?: number };
      let pont: Record<string, unknown> | undefined;
      Object.defineProperty(w, 'cabinet', { configurable: true, get: () => pont, set: (v: Record<string, unknown>) => {
        pont = v;
        // Le second dessin du démarrage lit l'abonnement après le premier (une machine lente) : c'est à lui d'amener le panneau.
        const dessiner = v.dessinerAbonnementCabinet as (...a: unknown[]) => Promise<unknown>;
        let dessins = 0;
        v.dessinerAbonnementCabinet = async (...a: unknown[]) => { dessins += 1; if (dessins === 2) await new Promise((r) => setTimeout(r, 1500)); return dessiner(...a); };
        const lire = v.inbox as () => Promise<{ nouveaux: unknown[] }>;
        v.inbox = async () => {
          const r = await lire();
          w.__boiteLue = (w.__boiteLue ?? 0) + 1;
          return w.__boiteLue === 1 ? r : { ...r, nouveaux: [{ name: 'paquet.skanpack', path: 'paquet.skanpack' }] };
        };
      } });
    });
    await cliquer(p.getByRole('link', { name: 'Revenir à ton abonnement' }));
    const fin = plusJours(`${Number(jour.slice(0, 4)) + 1}${jour.slice(4)}`, -1);
    await expect.poll(() => p.locator('#lic-panel #abo-etat h3').innerText().then(net).catch(() => ''), { timeout: 20_000 })
      .toBe(`Ton abonnement est payé jusqu'au ${jourEnFrancais(fin)}`);
    expect(new URL(p.url()).searchParams.get('c')).toBe(cabinet);
    // Le panneau arrive par son haut (son état), pas centré ni en bas des Réglages ; et il y reste quand la page se redessine.
    const enHaut = () => p.locator('#pan-licence').evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= -2 && r.top < 80; });
    await expect.poll(enHaut, { timeout: 10_000 }).toBe(true);
    // Nadia descend un peu lire ses dossiers ; la page se redessine (elle revient dans la fenêtre) : elle reste où elle était.
    const haut = () => p.locator('#pan-licence').evaluate((el) => Math.round(el.getBoundingClientRect().top));
    const arrivee = await haut();
    await p.mouse.move(900, 500);
    await p.mouse.wheel(0, 300);
    await expect.poll(haut, { timeout: 5_000 }).toBeLessThan(arrivee - 200);
    const lu = await haut();
    await p.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => p.evaluate(() => (window as unknown as { __boiteLue?: number }).__boiteLue), { timeout: 10_000 }).toBe(2);
    await p.waitForTimeout(1500);
    expect(Math.abs((await haut()) - lu)).toBeLessThanOrEqual(2);
    expect(net(await panneau.locator('#abo-factures .abo-fa-etat').first().innerText())).toBe('Payée');
    await expect.poll(() => p.locator('#lic-banner').isVisible(), { timeout: 10_000 }).toBe(false);
    const ligne = (await admin.query('select paye_jusqu_au::text paye from plateforme.abonnement_cabinet where cabinet = $1', [cabinet])).rows[0] as { paye: string };
    expect(ligne.paye).toBe(fin);
    await p.screenshot({ path: path.join(PHOTOS, 'abonnement-cabinet-3-payee.png') });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);

  // Recette de tous les états (23/10/2026) : le premier dossier ne disait pas qu'il ne coûte rien.
  it('Hédi : le premier dossier tenu dit qu\'il est gratuit, avant la saisie', async () => {
    const hedi = await personne('Hedi');
    await api('POST', '/moi/code', hedi.jeton, { methode: 'application' });
    const cabinet = String((await api('POST', '/cabinets', hedi.jeton, { nom: 'Cabinet Trabelsi' })).corps.id);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, hedi.jeton);
    const p = await cx.newPage();
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossiers`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await cliquer(p.locator('#new-d'));
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('#nd-gratuit').innerText().then(net).catch(() => ''), { timeout: 10_000 })
      .toBe('Ce sera ton 1er dossier tenu sur 3 gratuits : il ne coûte rien.');
    expect(await fenetre.locator('#nd-abonnement').count()).toBe(0);
    await cx.close();
  }, 120_000);

  // Recette du 23/10/2026 : la création refusée faute de paiement disait où aller (« Réglages, Ton abonnement ») mais
  // n'offrait que « Compris » ; Walid devait chercher le panneau lui-même. Le refus mène maintenant à l'abonnement, d'un bouton.
  it('Walid : en lecture seule, « Nouveau dossier client » refuse en le disant et mène à « Ton abonnement » d\'un bouton', async () => {
    const walid = await personne('Walid');
    await api('POST', '/moi/code', walid.jeton, { methode: 'application' });
    const cabinet = String((await api('POST', '/cabinets', walid.jeton, { nom: 'Cabinet Gharbi' })).corps.id);
    for (const nom of ['Menuiserie Ezzahra', 'Quincaillerie Ariana', 'Café Le Port', 'Imprimerie Nabeul']) {
      expect((await api('POST', `/cabinets/${cabinet}/dossiers`, walid.jeton, { raisonSociale: nom })).statut).toBe(201);
    }
    await expect.poll(async () => Number((await admin.query('select count(*) n from plateforme.facture_cabinet where cabinet = $1', [cabinet])).rows[0].n), { timeout: 30_000 }).toBe(1);
    // L'échéance passée, la grâce comprise : les dossiers payants passent en lecture seule.
    await admin.query('update plateforme.facture_cabinet set echeance = echeance - 60 where cabinet = $1', [cabinet]);
    const erreurs: string[] = [];
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, walid.jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossiers`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await cliquer(p.locator('#new-d'));
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.innerText().then(net).catch(() => ''), { timeout: 10_000 }).toContain('un dossier tenu de plus attend qu\'elle soit réglée');
    expect(await fenetre.getByRole('button', { name: 'Compris', exact: true }).count()).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'abonnement-cabinet-4-lecture-seule.png') });
    await cliquer(fenetre.getByRole('button', { name: 'Ouvrir mon abonnement', exact: true }));
    await expect.poll(() => p.locator('#lic-panel #abo-etat h3').innerText().then(net).catch(() => ''), { timeout: 15_000 })
      .toMatch(/^Tes dossiers payants sont en lecture seule depuis le /);
    expect(new URL(p.url()).hash).toBe('#/reglages');
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    expect((await p.locator('#lic-panel .btn-primary').allInnerTexts()).map(net)).toEqual(['Régler ma facture']);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
