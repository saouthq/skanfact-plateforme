// Ce que l'offre compte, à la souris (14c, deuxième partie ; docs/abonnement.md, « 14c » ; 0099). Ce que le parcours
// vérifie, écran ET serveur :
//   - la console : « Ouvrir un module acheté seul » dit AVANT le geste les modules d'après ; fait, la fiche les écrit ;
//   - « Préparer la facture… » d'une Essentiel au mois avec la paie achetée, une équipe de cinq (elle ne se compte pas :
//     les utilisateurs sont sans limite, 0102) et onze salariés présents (le sorti ne compte pas) : l'aperçu dit chaque
//     ligne, son compte et le net à payer ; préparée, la base garde le total ;
//   - l'application du client : la paie s'ouvre (plus de cadenas), la comptabilité complète reste fermée ; la carte
//     Essentiel dit ce qui est acheté ; sous les offres, ce qui s'ajoute et son prix du jour ; l'histoire dit le module ;
//     « jamais par utilisateur » (vrai de nouveau depuis 0102) ;
//   - « L'équipe » n'annonce aucun prix, quelle que soit sa taille : inviter ne coûte rien (Skander, 14/10/2026) ;
//     « Ton abonnement » dit ce que l'entreprise utilise aujourd'hui sur ce que son offre comprend, sans ligne pour les
//     utilisateurs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { faire } from '../../base/abonnement.ts';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';

// La preuve d'un paiement reçu hors de la plateforme (0113) : sans elle, rien n'est payé.
const RECU = { facture: 'F-2020-001', montant: 390000n, moyen: 'virement' as const, le: '2020-01-01' };

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('ce que l\'offre compte, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-offre-compte-'));
  const erreurs: string[] = [];
  let n = 0;
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

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const personne = async (sorte: string) => {
    const email = `offre-compte-web-${sorte}-${Date.now()}-${++n}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: `${sorte} ${n}`, motDePasse: MDP });
    return { email, jeton: String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
  };
  // La direction : son compte de l'application (propriétaire de l'entreprise SkanFact) et son jeton de la console.
  const direction = async () => {
    const p = await personne('amira');
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', p.jeton, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, p.email, 'direction', 'essai de 14c à la souris');
    const r = await api('POST', '/console/connexion', undefined, { email: p.email, motDePasse: MDP, appareil: { nom: 'Essai', type: 'navigateur' } });
    const c = await api('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) });
    return { appli: p.jeton, console: String(c.corps.jeton) };
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };

  it('la direction ouvre la paie seule, la facture compte ce qui dépasse ; le client voit sa paie ouverte et les prix de ce qui s\'ajoute', async () => {
    const amira = await direction();
    // L'entreprise SkanFact, d'où partent nos factures.
    const editeur = String((await api('POST', '/entreprises', amira.appli, { raisonSociale: 'SkanFact Éditions SARL' })).corps.id);
    await admin.query('delete from plateforme.facture_abonnement');
    await admin.query('delete from plateforme.editeur');
    expect((await api('POST', '/console/reglages/factures/editeur', amira.console, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
    await api('GET', `/entreprises/${editeur}/dossier-v10`, amira.appli);
    // Sonia, en Essentiel au mois, et son équipe de cinq : personne ne s'en compte (0102).
    const sonia = await personne('sonia');
    const ent = String((await api('POST', '/entreprises', sonia.jeton, { raisonSociale: 'Atelier Mejri' })).corps.id);
    await faire(admin, ent, { geste: 'payer', paiement: RECU, offre: 'essentiel', periodicite: 'mensuel', motif: 'virement reçu' });
    for (const roles of [['commercial'], ['magasinier'], ['caissier', 'lecture'], ['caissier']]) {
      const m = await personne('membre');
      const inv = await api('POST', `/entreprises/${ent}/invitations`, sonia.jeton, { email: m.email, roles });
      expect((await api('POST', '/invitations/accepter', m.jeton, { jeton: String(inv.corps.jeton) })).statut).toBe(200);
    }

    // ── La console : la paie, achetée seule ──────────────────────────────────────────────────────────────────────────
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { sessionStorage.setItem('skanfact.console.jeton', j); }, amira.console);
    const c = await cx.newPage();
    c.on('pageerror', (e) => erreurs.push(e.message));
    await c.goto(`${serveur.adresse}/console/#/clients/${ent}?onglet=abonnement`);
    await expect.poll(() => c.locator('h1').first().innerText().catch(() => ''), { timeout: 20_000 }).toBe('Atelier Mejri');
    await cliquer(c.locator('.c-menu > button'));
    await cliquer(c.locator('.c-menu-liste button', { hasText: 'Ouvrir un module acheté seul' }));
    const fenetre = c.getByRole('dialog');
    await expect.poll(() => fenetre.locator('.c-apercu-details').innerText().then(net).catch(() => ''), { timeout: 10_000 })
      .toBe('Le module Paie s\'ouvre aujourd\'hui ; la prochaine facture rattrape les jours de la période payée qui court.');
    await fenetre.getByLabel('Motif', { exact: true }).fill('Sonia lance la paie de ses ouvriers');
    await cliquer(fenetre.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(() => fenetre.count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => c.locator('.c-faits').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toContain('Modules achetés seuls Paie');

    // Onze salariés présents et un sorti, entrés maintenant que la paie est ouverte ; et un client (une entreprise qui
    // travaille déjà : l'assistant de démarrage ne s'ouvre pas sur elle).
    const changements = [...Array.from({ length: 12 }, (_, i) => ({ collection: 'employees', cle: `sal-${i + 1}`, rang: null, revision: null,
      contenu: { id: `sal-${i + 1}`, name: `Salarié ${i + 1}`, grossSalary: 1180 + i * 15, hireDate: '2025-03-01', ...(i === 11 ? { endDate: '2026-01-31' } : {}) } })),
    { collection: 'clients', cle: 'cl-1', rang: 0, revision: null, contenu: { id: 'cl-1', name: 'Menuiserie Ennour' } }];
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sonia.jeton, { changements })).statut).toBe(200);

    // ── La facture : chaque ligne, son compte, et le net (dans l'onglet « Factures » de la fiche, depuis la 1.19.0) ─────
    await c.goto(`${serveur.adresse}/console/#/clients/${ent}?onglet=factures`);
    await c.reload();
    const factures = c.locator('section[aria-labelledby="fiche-factures"]');
    await cliquer(factures.getByRole('button', { name: /Préparer la facture/ }));
    const f = c.getByRole('dialog');
    const lignesF = () => f.locator('.c-fa-lignes li').allInnerTexts().then((t) => t.map(net)).catch(() => [] as string[]);
    await expect.poll(async () => (await lignesF()).length, { timeout: 10_000 }).toBe(4);
    const lignes = await lignesF();
    expect(lignes.slice(0, 3)).toEqual([
      'Essentiel, au mois 39,000 DT',
      'Module paie (acheté seul) 15,000 DT',
      'Salariés au-delà de l\'offre 11 comptés, 10 dans l\'offre : 1 × 1,200 DT. 1,200 DT',
    ]);
    // La paie s'est ouverte après le paiement de la période qui court, qui ne la comptait pas (0113) : la facture rattrape
    // ses jours — ici tous, la période n'ayant pas commencé. Ses dates suivent le jour du test.
    expect(lignes[3]).toMatch(/^Module paie, ouvert en cours de période \(rattrapage\) (\d+) jours sur \1, du \d\d\/\d\d\/\d{4} au \d\d\/\d\d\/\d{4}\. 15,000 DT$/);
    // (39 + 15 + 1,200 + 15) × 1,19 + 1 de timbre.
    expect(net(await f.locator('.c-fa-net').innerText())).toContain('84,538 DT');
    await c.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'offre-compte-1-facture.png') });
    await f.getByLabel('Motif', { exact: true }).fill('Échéance du mois, avec la paie et l\'équipe');
    await cliquer(f.locator('.c-dialogue-pied .c-btn-principal'));
    await expect.poll(() => f.count(), { timeout: 10_000 }).toBe(0);
    expect((await admin.query('select montant_ht::text m from plateforme.facture_abonnement where entreprise = $1', [ent])).rows).toEqual([{ m: '70200' }]);
    await cx.close();

    // ── L'application de Sonia : la paie ouverte, la comptabilité complète fermée, les prix de ce qui s'ajoute ─────────
    const ax = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await ax.addInitScript((x) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', x); }, sonia.jeton);
    const p = await ax.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/paie`);
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 20_000 }).not.toBe('');
    await plusTard(p);
    expect(await p.locator('.sidebar a[data-route="paie"] .nav-lock').count()).toBe(0);
    expect(await p.locator('.offre-banner').count()).toBe(0);
    expect(await p.locator('.sidebar .nav-lock').count()).toBeGreaterThan(0);
    await p.evaluate(() => { location.hash = '#/parametres'; });
    await cliquer(p.locator('#set-tabs [data-tab="abonnement"]'));
    await expect.poll(() => p.locator('.abo-offre.courante .abo-pas').innerText().then(net).catch(() => ''), { timeout: 15_000 })
      .toBe('La paie est achetée en plus d\'Essentiel. La comptabilité complète est dans Complet : ce qui existe se lit, mais rien de nouveau ne s\'y crée.');
    const plus = p.locator('#abo-plus li');
    expect((await plus.evaluateAll((e) => e.map((x) => (x as HTMLElement).dataset.option)))).toEqual(['caisse', 'etablissement', 'salarie', 'module_paie', 'module_compta']);
    expect(net(await p.locator('#abo-plus li[data-option="salarie"]').innerText())).toBe('Un salarié de plus dans la paie La paie en comprend dix sur Essentiel, vingt sur Complet. Aujourd\'hui : 11 salariés, 1 de plus que ton offre. 12 DT HT par an ou 1,200 DT HT par mois');
    expect(net(await p.locator('.abo-histoire li').first().innerText())).toContain('Module acheté (la paie)');
    expect(net(await p.locator('#abonnement-panel').innerText())).toContain('Un prix par entreprise, jamais par utilisateur.');
    await p.locator('#abo-plus').scrollIntoViewIfNeeded();
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'offre-compte-2-au-dela.png') });
    await ax.close();
    expect(erreurs).toEqual([]);
  }, 150_000);

  it('l\'équipe n\'annonce aucun prix, même grande ; « Ton abonnement » dit ce qui est pris, sans ligne pour les utilisateurs', async () => {
    const walid = await personne('walid');
    const ent = String((await api('POST', '/entreprises', walid.jeton, { raisonSociale: 'Librairie Comptée' })).corps.id);
    await faire(admin, ent, { geste: 'payer', paiement: RECU, offre: 'essentiel', periodicite: 'annuel', motif: 'virement reçu' });
    // Un client : une entreprise qui travaille déjà (l'assistant de démarrage ne s'ouvre pas sur elle).
    await api('GET', `/entreprises/${ent}/dossier-v10`, walid.jeton);
    await api('POST', `/entreprises/${ent}/dossier-v10`, walid.jeton, { changements: [{ collection: 'clients', cle: 'cl-1', rang: 0, revision: null, contenu: { id: 'cl-1', name: 'École Ennour' } }] });
    // Une équipe de six, au-delà des trois que comptait l'ancienne Essentiel, et deux invitations qui attendent.
    for (const roles of [['commercial'], ['magasinier'], ['lecture'], ['commercial', 'lecture'], ['caissier']]) {
      const m = await personne('membre');
      const inv = await api('POST', `/entreprises/${ent}/invitations`, walid.jeton, { email: m.email, roles });
      expect((await api('POST', '/invitations/accepter', m.jeton, { jeton: String(inv.corps.jeton) })).statut).toBe(200);
    }
    for (const [nom, roles] of [['karim', ['commercial']], ['hela', ['magasinier']]] as const) {
      expect((await api('POST', `/entreprises/${ent}/invitations`, walid.jeton, { email: `${nom}-${Date.now()}@exemple.tn`, roles })).statut).toBe(201);
    }
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((x) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', x); }, walid.jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 20_000 }).not.toBe('');
    await plusTard(p);
    await cliquer(p.locator('#set-tabs [data-tab="equipe"]'));
    await p.locator('#eqp-inviter').waitFor({ timeout: 15_000 });
    // Inviter une septième personne : la fenêtre ne parle ni de prix ni de facture.
    await cliquer(p.locator('#eqp-inviter'));
    await expect.poll(() => p.locator('#eqp-email').count()).toBe(1);
    const fenetre = p.locator('#eqp-ok').locator('xpath=ancestor::*[.//h2][1]');
    expect(net(await fenetre.innerText())).toMatch(/^Inviter quelqu'un/);
    expect(net(await fenetre.innerText())).not.toMatch(/\bDT\b|coût|prochaine facture|ton offre|comprend/i);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'offre-compte-3-inviter.png') });
    await p.keyboard.press('Escape');
    // « Ton abonnement » : ce qui est pris aujourd'hui, et rien sur les utilisateurs.
    await cliquer(p.locator('#set-tabs [data-tab="abonnement"]'));
    const auj = (option: string) => p.locator(`#abo-plus li[data-option="${option}"] .abo-plus-auj`).innerText().then(net).catch(() => '');
    await expect.poll(() => auj('caisse'), { timeout: 15_000 }).toBe('Aujourd\'hui : 0 caisse sur 1 comprise.');
    expect(await p.locator('#abo-plus li[data-option="utilisateur"]').count()).toBe(0);
    expect(await p.locator('#abo-plus li[data-option="salarie"] .abo-plus-auj').count()).toBe(0);
    expect(net(await p.locator('#abo-plus .abo-plus-tete p').innerText())).toContain('ton équipe, elle, n\'a pas de limite');
    expect(net(await p.locator('.abo-offre[data-offre="essentiel"]').innerText())).toContain('Des utilisateurs sans limite, un établissement');
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 150_000);
});
