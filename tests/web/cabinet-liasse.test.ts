// La liasse et l'annuel, à la souris (brique 41 ter ; docs/cabinet.md, C26 et C27). L'écran est celui
// du Cabinet v10 ; la liasse se déduit du livre du serveur par le moteur de la v10 ; les retraitements,
// le taux d'impôt et le modèle de rubriques s'enregistrent au serveur. Ce que le parcours vérifie :
//   - deux chemins, un chiffre : le résultat de la liasse est celui des comptes que le serveur tient ;
//     la liasse tombe juste (actif = passif) ;
//   - le taux se saisit, un retraitement s'ajoute : le résultat fiscal et l'impôt suivent, au millime,
//     et le serveur les tient ; retiré, il ne compte plus ;
//   - le modèle de rubriques du cabinet s'écrit, et la liasse le suit.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la liasse et l\'annuel, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-liasse-'));
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

  type Annuel = { retraitements: { libelle: string; montant: string }[]; tauxImpot: string | null };
  const annuel = async (ent: string, jeton: string) => (await api('GET', `/entreprises/${ent}/compta/annuel/2026`, jeton)).corps as Annuel;

  it('le résultat des livres du serveur ; le taux et un retraitement font le résultat fiscal et l\'impôt ; le modèle de rubriques s\'écrit', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    const saisir = async (date: string, journal: string, piece: string, lignes: [string, string, string][]) =>
      String((await api('POST', `/entreprises/${cafe}/compta/ecritures`, associe, { date, journal, piece, libelle: `Pièce ${piece}`, lignes: lignes.map(([compte, debit, credit]) => ({ compte, debit, credit })) })).corps.id);
    // Des recettes de 10 000,750 et des achats de 3 200,250, en caisse : 6 800,500 de résultat.
    const ids = [await saisir('2026-03-05', 'CA', 'R-1', [['5411', '10000,750', ''], ['7071', '', '10000,750']]),
      await saisir('2026-04-08', 'CA', 'A-1', [['6061', '3200,250', ''], ['5411', '', '3200,250']])];
    expect((await api('POST', `/entreprises/${cafe}/compta/ecritures/valider`, associe, { ids })).statut).toBe(200);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async () => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/liasse/2026`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
      await p.locator('#li-taux').waitFor({ timeout: 15_000 });
    };
    const fiscal = async () => (await p.locator('h2', { hasText: 'Résultat fiscal et impôt' }).locator('xpath=..').locator('tbody').first().innerText()).replace(/\s+/g, ' ');

    // ── Deux chemins, un chiffre ───────────────────────────────────────────────────────────────────
    await aller();
    const balance = (await api('GET', `/entreprises/${cafe}/compta/balance?du=2026-01-01&au=2026-12-31`, associe)).corps.comptes as { compte: string; solde: string }[];
    const resultat = -balance.filter((c) => /^[67]/.test(c.compte)).reduce((s, c) => s + Math.round(Number(c.solde) * 1000), 0) / 1000;
    expect(resultat).toBe(6800.5);
    expect(await fiscal()).toMatch(/^Résultat comptable 6 800,500 DT/);
    expect(await p.locator('#li-juste').count()).toBe(1);
    expect(await fiscal()).toMatch(/Impôt —/);

    // ── Le taux, puis un retraitement : le fiscal suit, le serveur les tient ───────────────────────
    await p.locator('#li-taux').fill('25');
    await p.locator('#li-taux-ok').click();
    await expect.poll(async () => (await annuel(cafe, associe)).tauxImpot).toBe('25');
    await expect.poll(fiscal).toMatch(/Impôt au taux de 25 % 1 700,125 DT/);
    await p.locator('#li-rt-add').click();
    const fenetre = p.locator('#modal-root .modal').last();
    await fenetre.locator('#rt-montant').fill('1000,125');
    await fenetre.locator('#rt-libelle').fill('Amende fiscale non déductible');
    await fenetre.locator('#rt-ok').click();
    await expect.poll(async () => (await annuel(cafe, associe)).retraitements).toEqual([expect.objectContaining({ libelle: 'Amende fiscale non déductible', montant: '1000.125' })]);
    await expect.poll(fiscal).toMatch(/\+ Réintégrations 1 000,125 DT − Déductions et reports 0,000 DT Résultat fiscal 7 800,625 DT Impôt au taux de 25 % 1 950,156 DT/i);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-liasse-1-fiscal.png'), fullPage: true });
    // Retiré, il ne compte plus.
    await p.locator('[data-rtx]').first().click();
    await expect.poll(async () => (await annuel(cafe, associe)).retraitements).toEqual([]);
    // Attendre ce qui CHANGE : « 6 800,500 » était déjà vrai avant l'ajout.
    await expect.poll(() => p.locator('#li-rt-table').count()).toBe(0);
    await expect.poll(fiscal).toMatch(/\+ Réintégrations 0,000 DT − Déductions et reports 0,000 DT Résultat fiscal 6 800,500 DT/i);

    // ── Le modèle de rubriques du cabinet : repris, une rubrique renommée, la liasse le suit ──────────
    await p.locator('#li-modele').click();
    const modele = p.locator('#modal-root .modal').last();
    await modele.locator('#sr-liasse-reset').click();
    await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Reprendre', exact: true }).click();
    const tresorerie = modele.locator('tr[data-lr]', { has: p.locator('input[data-k="comptes"][value="5"]') });
    await tresorerie.first().locator('input[data-k="label"]').fill('Caisse et banques du café');
    await modele.locator('#sr-liasse-save').click();
    await expect.poll(async () => ((await api('GET', `/cabinets/${cabinet}/reglages`, associe)).corps.contenu as { liasse?: { label: string }[] }).liasse?.some((r) => r.label === 'Caisse et banques du café')).toBe(true);
    await aller();
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/Caisse et banques du café\s+6\s800,500/);
    expect(await p.locator('#li-juste').count()).toBe(1);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-liasse-2-modele.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
