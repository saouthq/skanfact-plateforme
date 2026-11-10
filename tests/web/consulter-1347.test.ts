// Les livres d'un dossier au Cabinet, consultés comme un comptable (1.347.0 ; docs/revue-modules.md). Ce que le parcours
// vérifie, écran ET moteur :
//   - le grand livre dit un solde dans le SENS du compte (« Solde créditeur … », jamais « Solde −… ») ;
//   - 421 et 425 ne portent plus le même nom, et un sous-compte qui reprend le nom de son parent le dit (« détail du 606 ») ;
//   - le lettrage d'un fournisseur se lit « Reste à payer 406,980 DT », le compte nommé et le 411 proposé une seule fois ;
//   - la recherche trouve un montant tapé sans ses millimes (« 406 » trouve 406,980).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('les livres d\'un dossier, consultés comme un comptable (1.347.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-consulter-1347-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const personne = async (nom: string) => {
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };


  it('(1.347.0) le grand livre dans le sens du compte, des noms qui se distinguent, le lettrage fournisseurs et la recherche par montant', async () => {
    const client = await personne('client');
    const associe = await personne('associe');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Jlassi' });
    const cabinet = String(cab.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    const saisir = async (date: string, journal: string, piece: string, libelle: string, lignes: [string, string, string, string?][]) => {
      const r = await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date, journal, piece, libelle, lignes: lignes.map(([compte, debit, credit, tiers]) => ({ compte, debit, credit, ...(tiers ? { tiers } : {}) })) });
      expect(r.statut, JSON.stringify(r.corps)).toBe(201);
      return String(r.corps.id);
    };
    const ids = [
      await saisir('2026-01-01', 'AN', 'AN-1', 'Solde de la banque repris', [['532', '10000,500', ''], ['101', '', '10000,500']]),
      await saisir('2026-03-01', 'AC', 'FA-0901', 'Farine de mars', [['606', '406,980', ''], ['401', '', '406,980', 'Minoterie du Cap Bon']]),
      await saisir('2026-03-02', 'AC', 'LV-77', 'Levures', [['6066', '120', ''], ['401', '', '120', 'Levures du Sahel']]),
      await saisir('2026-03-31', 'OD', 'SAL-3', 'Salaires de mars', [['640', '1250', ''], ['425', '', '1250']]),
      await saisir('2026-03-15', 'BQ', 'AV-3', 'Avance sur salaire', [['421', '200', ''], ['532', '', '200']]),
      await saisir('2026-03-20', 'VT', 'FAC-012', 'Pains pour le café', [['411', '595', '', 'Café Jasmin'], ['706', '', '500'], ['4371', '', '95']]),
    ];
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids })).statut).toBe(200);

    const erreurs: string[] = [];
    const ctx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const net = (t: string) => t.replace(/\s+/g, ' ').trim();
    const ouvrir = async (onglet: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/${onglet}/2026`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(600);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };

    // ── Le grand livre : chaque solde dans le sens du compte ; des noms qui se distinguent ───────────
    await ouvrir('grand-livre');
    const tete = async (compte: string) => net(await p.locator('summary.gl-tete').filter({ hasText: new RegExp(`^\\s*${compte} `) }).first().innerText());
    await expect.poll(() => tete('401'), { timeout: 15_000 }).toContain('Solde créditeur 526,980 DT');
    expect(await tete('532')).toContain('Solde débiteur 9 800,500 DT');
    expect(await tete('425')).toContain('Personnel — rémunérations dues');
    expect(await tete('421')).toContain('Personnel — avances et acomptes');
    expect(await tete('6066')).toContain('(détail du 606)');
    expect(await tete('606')).not.toContain('détail du');
    expect(net(await p.locator('#view').innerText())).not.toMatch(/Solde −/);
    await p.screenshot({ path: path.join(PHOTOS, 'consulter-1347-a-grand-livre.png'), fullPage: true });

    // ── Le lettrage d'un fournisseur se lit dans le sens du compte ─────────────────────────────────
    await ouvrir('lettrage');
    const options = await p.locator('#lv-compte option').allInnerTexts();
    expect(options.filter((o) => /^411\b/.test(o.trim()))).toHaveLength(1);
    expect(options.map((o) => net(o))).toContain('401 — Fournisseurs d\'exploitation');
    // Les clients d'abord, comme on arrive : ce qui reste dû se dit tel quel.
    await expect.poll(async () => net(await p.locator('#lv-verdict').innerText().catch(() => '')), { timeout: 10_000 }).toContain('595,000 DT');
    expect(net(await p.locator('.lt-tiers summary').first().innerText())).toContain('Reste dû 595,000 DT');
    await p.locator('#lv-compte').selectOption('401');
    await expect.poll(async () => net(await p.locator('#lv-verdict').innerText().catch(() => '')), { timeout: 10_000 }).toContain('526,980 DT créditeur');
    const tiers = (await p.locator('.lt-tiers summary').allInnerTexts()).map(net);
    expect(tiers.find((t) => t.startsWith('Minoterie du Cap Bon'))).toContain('Reste à payer 406,980 DT');
    expect(tiers.join(' ')).not.toContain('−');
    expect(net(await p.locator('#view h2').filter({ hasText: 'par ancienneté' }).first().innerText())).toContain('Ce qui reste à payer');
    await p.screenshot({ path: path.join(PHOTOS, 'consulter-1347-b-lettrage-401.png'), fullPage: true });

    // ── La recherche trouve un montant tapé sans ses millimes ─────────────────────────────────────
    await ouvrir('recherche');
    const chercher = async (q: string) => {
      await p.locator('#re-q').fill(q);
      await p.waitForTimeout(700);
      return net(await p.locator('#view').innerText());
    };
    expect(await chercher('406')).toContain('FA-0901');
    expect(await chercher('406,980')).toContain('FA-0901');
    expect(await chercher('406,5')).not.toContain('FA-0901');
    expect(await chercher('120')).toContain('LV-77');

    expect(erreurs).toEqual([]);
    await ctx.close();
  }, 180_000);
});
