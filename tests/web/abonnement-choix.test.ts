// Choisir son offre dans l'application, à la souris (1.84.0 ; docs/abonnement.md C19 ; 0158). Hela, propriétaire d'une
// droguerie en essai, ouvre « Ton abonnement » :
//   - « T'abonner » propose les quatre choix, chacun avec son prix ; « Je choisis cette offre » reste éteint tant que
//     rien n'est coché ;
//   - elle coche Complet à l'année et choisit : l'onglet dit « Tu as choisi Complet, à l'année », le jour et son nom,
//     et que sa facture arrive ici ; « Changer de choix » rouvre les choix ;
//   - la console, elle, a la ligne « a choisi » dans « À décider ».

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer } from '../cliquer.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const MDP = 'Un-bon-mot-de-passe';
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('choisir son offre, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-abonnement-choix-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
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
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };

  it('Hela choisit son offre dans sa carte, confirme, et lit son choix ; la console le voit dans « À décider »', async () => {
    const jour = aujourdhuiATunis();
    const email = `hela-choix-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Hela Ben Ali', motDePasse: MDP });
    const hela = String((await api('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', hela, { raisonSociale: 'Droguerie Ennasr' })).corps.id);
    await admin.query('update plateforme.abonnement set essai_jusqu_au = $2::date + 12 where entreprise = $1', [ent, jour]);

    const erreurs: string[] = [];
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((x) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', x); }, hela);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 20_000 }).not.toBe('');
    await plusTard(p);
    await cliquer(p.locator('#set-tabs [data-tab="abonnement"]'));
    // L'état propose l'étape suivante (la revue du 22/10/2026 : il ne proposait rien) ; elle mène aux offres.
    const tete = p.getByRole('button', { name: 'Choisir mon offre', exact: true });
    await expect.poll(() => tete.isVisible().catch(() => false), { timeout: 15_000 }).toBe(true);
    expect(await tete.getAttribute('class')).toMatch(/\bbtn-primary\b/);
    await cliquer(tete);
    // Chaque carte a ses deux boutons, à l'année d'abord ; et ce que l'année fait gagner, calculé sur les prix du jour.
    const boutons = p.locator('#abonnement-panel [data-choisir]');
    expect((await boutons.allInnerTexts()).map(net)).toEqual(['Choisir Essentiel à l\'année', 'ou au mois', 'Choisir Complet à l\'année', 'ou au mois']);
    expect((await p.locator('#abonnement-panel .abo-annee').allInnerTexts()).map(net)).toEqual(['À l\'année, deux mois offerts.', 'À l\'année, deux mois offerts.']);
    // Rien ne part au premier clic : ce que le choix fera, puis « Annuler » ou la confirmation, seul bouton vert.
    // (1.121.0) Le récapitulatif s'ouvre au-dessus de l'onglet : rien ne bouge dans les cartes (ouvert dans la carte, il
    // poussait sa liste et laissait un trou dans l'autre), et il redit le total à régler, TVA et timbre compris.
    const liste = () => p.locator('[data-offre="essentiel"] .abo-inclus').evaluate((e) => Math.round(e.getBoundingClientRect().top - (e.closest('[data-offre]')?.getBoundingClientRect().top ?? 0)));
    const avant = await liste();
    await cliquer(p.locator('[data-choisir="complet:annuel"]'));
    const boite = p.locator('#abo-dialogue');
    expect(await boite.isVisible()).toBe(true);
    expect(await boite.getAttribute('aria-labelledby')).toBe('abo-dialogue-titre');
    // Une vraie fenêtre : au-dessus de tout, le reste de l'onglet inerte tant qu'elle est ouverte (Échap la referme).
    expect(await boite.evaluate((d) => d.matches(':modal'))).toBe(true);
    expect(net(await boite.locator('h3').innerText())).toBe('Complet, à l\'année');
    // Le total TTC ne se dit que si l'entreprise SkanFact est désignée (ici, selon les fichiers passés avant) : il se vérifie
    // dans abonnement-au-choix.test.ts.
    expect(net(await boite.locator('.abo-recap').innerText())).toMatch(/^Abonnement Complet 690 DT HT par an( Total à régler TVA et timbre fiscal compris 822,100 DT par an)?$/);
    expect(await liste()).toBe(avant);
    expect(await p.locator('#abonnement-panel .btn-primary:visible').evaluateAll((l) => l.map((b) => b.textContent?.trim()))).toEqual(['Je choisis Complet, à l\'année']);
    await cliquer(boite.getByRole('button', { name: 'Annuler', exact: true }));
    expect(await boite.isVisible()).toBe(false);
    // Ouvert puis annulé, le choix n'est jamais parti (relu après que l'écran a tout envoyé).
    await p.waitForLoadState('networkidle');
    expect((await admin.query('select count(*)::int n from plateforme.offre_choisie where entreprise = $1', [ent])).rows[0].n).toBe(0);
    // Le vert revient au bouton du haut quand la fenêtre a fini de se fermer (son événement suit le clic d'un instant).
    await expect.poll(() => tete.getAttribute('class'), { timeout: 5_000 }).toMatch(/\bbtn-primary\b/);
    await cliquer(p.locator('[data-choisir="complet:annuel"]'));
    await cliquer(p.getByRole('button', { name: 'Je choisis Complet, à l\'année', exact: true }));
    // L'onglet dit le choix, le jour et qui, juste sous l'état ; la facture arrivera ici, et un e-mail le dira.
    const choisi = p.locator('#abo-payer.abo-choisi');
    await expect.poll(() => choisi.locator('h4').innerText().then(net).catch(() => ''), { timeout: 15_000 }).toBe('Tu as choisi Complet, à l\'année');
    const texte = net(await choisi.innerText());
    expect(texte).toContain(`Le ${jour.split('-').reverse().join('/')}, par Hela Ben Ali.`);
    expect(texte).toContain('SkanFact prépare ta facture sur ce choix : elle arrive ici, dans « Tes factures », et un e-mail te prévient quand elle est prête.');
    expect(texte).not.toMatch(/règles tu la règles/);
    expect(await p.locator('#abo-etat + #abo-payer').count()).toBe(1);
    expect(await tete.count()).toBe(0);
    expect(await boutons.first().isVisible()).toBe(false);
    // « Changer de choix » rouvre les boutons des offres.
    await cliquer(p.getByRole('button', { name: 'Changer de choix', exact: true }));
    expect(await boutons.first().isVisible()).toBe(true);
    // Le jour d'un choix est celui de Tunis : fait à 23 h 30 en UTC le 1er janvier, il est du 2 janvier.
    const proprio = (await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id as string;
    await admin.query('insert into plateforme.offre_choisie (entreprise, offre, periodicite, par, le) values ($1, \'complet\', \'annuel\', $2, \'2030-01-01T23:30:00Z\')', [ent, proprio]);
    await p.reload();
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 20_000 }).not.toBe('');
    await plusTard(p);
    await cliquer(p.locator('#set-tabs [data-tab="abonnement"]'));
    await expect.poll(() => choisi.innerText().then(net).catch(() => ''), { timeout: 15_000 }).toContain('Le 02/01/2030, par Hela Ben Ali.');
    expect(erreurs).toEqual([]);

    // La console (la direction) : « Droguerie Ennasr a choisi Complet, à l'année ».
    const emailA = `amira-choix-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: emailA, nom: 'Amira Ben Salem', motDePasse: MDP });
    const premier = String((await api('POST', '/connexion', undefined, { email: emailA, motDePasse: MDP, appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    await ajouterALEquipe(admin, emailA, 'direction', 'mise en place des essais');
    const k = await api('POST', '/console/connexion', undefined, { email: emailA, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
    const console = String((await api('POST', '/console/connexion/code', undefined, { defi: k.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const decider = (await api('GET', '/console/accueil', console)).corps.decider as { sorte: string; entreprise?: { id: string }; offre?: string }[];
    expect(decider.filter((l) => l.entreprise?.id === ent)).toMatchObject([{ sorte: 'offre_choisie', offre: 'complet', periodicite: 'annuel', par: 'Hela Ben Ali' }]);
    await cx.close();
  }, 120_000);
});
