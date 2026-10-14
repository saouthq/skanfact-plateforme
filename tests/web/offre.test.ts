// Ce que l'offre ouvre, à la souris (14c ; docs/abonnement.md, « 14c » ; web/v10/offre-complet.txt,
// plateforme/abonnement.js). Ce que le parcours vérifie, écran ET serveur :
//   - en Essentiel, la Paie porte son cadenas dans la barre, et sa page le dit à l'entrée (l'offre Complet) ; « Créer
//     mon premier salarié » est retenu AVANT la saisie (aucun formulaire), et rien n'arrive au serveur ; le bouton mène à
//     « Ton abonnement », où la carte Essentiel dit ce qui reste dans Complet ;
//   - les trois onglets de la comptabilité complète portent leur cadenas, et disent ce qui reste ouvert ;
//   - passée à Complet, plus de cadenas : le formulaire du salarié s'ouvre.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { faire } from '../../base/abonnement.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

describe('ce que l\'offre ouvre, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const exploitant = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-offre-'));
  beforeAll(async () => {
    await admin.connect(); await exploitant.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await admin.end(); await exploitant.end();
    fs.rmSync(dossier, { recursive: true, force: true });
  });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const erreurs: string[] = [];
  const ouvrir = async (jeton: string, ent: string, hash: string) => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, jeton);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 20_000 }).not.toBe('');
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    return p;
  };
  const fenetre = (p: Page) => p.locator('#modal-root .modal-bg').last();
  const salaries = async (ent: string) => Number((await admin.query(`select count(*) n from socle.dossier_v10 where entreprise = $1 and collection = 'employees'`, [ent])).rows[0].n);

  it('en Essentiel, la paie et la comptabilité complète se lisent sans se créer ; passée à Complet, tout s\'ouvre', async () => {
    const email = `nadia-offre-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Atelier en Essentiel' })).corps.id);
    await faire(exploitant, ent, { geste: 'payer', offre: 'essentiel', periodicite: 'annuel', motif: 'virement reçu' });

    // ── La paie : le cadenas, le bandeau d'entrée, et la porte AVANT la saisie ─────────────────────────────────────────
    const p = await ouvrir(jeton, ent, '#/paie');
    expect(await p.locator('.sidebar a[data-route="paie"] .nav-lock').count()).toBe(1);
    expect(net(await p.locator('.offre-banner').innerText())).toContain('« Salariés et paie » fait partie de l\'offre Complet : tu peux tout lire ici, pas créer de nouvelles pièces.');
    await p.getByRole('button', { name: /Créer mon premier salarié/ }).click();
    await expect.poll(() => fenetre(p).locator('h2').innerText().catch(() => '')).toBe('Offre Essentiel');
    expect(net(await fenetre(p).innerText())).toContain('Créer une fiche de salarié fait partie de l\'offre Complet');
    expect(await p.getByText('Nouveau salarié', { exact: true }).count()).toBe(0);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'offre-1-paie-essentiel.png') });
    await fenetre(p).getByRole('button', { name: 'Voir l\'abonnement' }).click();
    await expect.poll(() => p.locator('.abo-offre.courante .abo-pas').innerText().then(net).catch(() => ''), { timeout: 10_000 })
      .toBe('La paie et la comptabilité complète sont dans Complet : ce qui existe se lit, mais rien de nouveau ne s\'y crée.');
    expect(await salaries(ent)).toBe(0);

    // ── La comptabilité complète : ses trois onglets, affichés, portent leur cadenas et disent ce qui reste ─────────────
    await p.evaluate(() => { location.hash = '#/modules'; });
    await p.locator('input[data-sousmod="compta.livres"]').check();
    await p.evaluate(() => { location.hash = '#/compta'; });
    const grandLivre = p.locator('#c-tabs button[data-tab="grandlivre"]');
    await grandLivre.waitFor();
    await grandLivre.click();
    await expect.poll(() => fenetre(p).locator('h2').innerText().catch(() => '')).toBe('La comptabilité complète');
    expect(net(await fenetre(p).innerText())).toContain('Tes écritures, ta TVA, tes clôtures et le paquet de ton comptable restent disponibles.');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'offre-2-compta-essentiel.png') });
    await fenetre(p).getByRole('button', { name: 'Fermer' }).click();
    expect(await p.locator('#c-tabs button.active').getAttribute('data-tab')).not.toBe('grandlivre');

    // ── Passée à Complet : plus de cadenas, le formulaire s'ouvre ─────────────────────────────────────────────────────
    await faire(exploitant, ent, { geste: 'payer', offre: 'complet', periodicite: 'annuel', motif: 'passe à Complet' });
    const q = await ouvrir(jeton, ent, '#/paie');
    expect(await q.locator('.sidebar a[data-route="paie"] .nav-lock').count()).toBe(0);
    expect(await q.locator('.offre-banner').count()).toBe(0);
    await q.getByRole('button', { name: /Créer mon premier salarié/ }).click();
    await expect.poll(() => q.getByText('Nouveau salarié', { exact: true }).count()).toBe(1);
    expect(erreurs).toEqual([]);
  }, 120_000);
});
