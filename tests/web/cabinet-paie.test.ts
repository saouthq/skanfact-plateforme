// La paie tenue par le cabinet, à la souris (brique 43 ; docs/cabinet.md, C31). L'écran est celui du
// Cabinet v10 ; le salarié et son bulletin s'enregistrent dans le dossier du client (le même que son
// SkanFact), le serveur recalcule le bulletin et tient l'écriture de paie du mois. Ce que le parcours
// vérifie, écran ET serveur :
//   - un salarié déclaré, un bulletin établi : la paie du serveur les tient, au millime de l'écran ;
//   - l'écriture de paie du mois existe sans qu'on la passe : le bouton le dit.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la paie tenue par le cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-paie-'));
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

  it('un salarié et son bulletin, écrits dans le dossier du client ; le serveur les tient au millime et écrit le mois', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    // Le livre de 2025 commencé (un client qui démarre : sans balance d'ouverture).
    expect((await api('POST', `/entreprises/${cafe}/compta/exercices`, associe, { annee: 2025, ouverture: [] })).statut).toBe(201);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/paie/2025`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();
    const ouvrir = async (bouton: string, dedans: string) => expect.poll(async () => {
      if (!await p.locator(dedans).count()) await p.locator(bouton).first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator(dedans).count();
    }, { timeout: 20_000 }).toBe(1);
    await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
    await p.locator('#pa-mois').selectOption('3');

    // ── Un salarié ───────────────────────────────────────────────────────────────────────────────
    await ouvrir('#pa-salarie', '#modal-root [name=nom]');
    await fenetre.locator('[name=nom]').fill('Amel Trabelsi');
    await fenetre.locator('[name=brut]').fill('1250,500');
    await fenetre.locator('[name=embauche]').fill('01/01/2025');
    await fenetre.locator('[name=chefDeFamille]').check();
    await fenetre.locator('[name=enfants]').fill('2');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Salarié enregistré.');
    const dossierPaie = async () => (await api('GET', `/entreprises/${cafe}/paie/dossier`, associe)).corps.objets as { collection: string; contenu: Record<string, unknown> }[];
    expect((await dossierPaie()).map((o) => [o.collection, o.contenu.name])).toEqual([['employees', 'Amel Trabelsi']]);

    // ── Son bulletin de mars ─────────────────────────────────────────────────────────────────────
    await ouvrir('#pa-bulletin', '#bf');
    await fenetre.locator('[name=primeLabel]').first().fill('Prime de rendement');
    await fenetre.locator('[name=primeAmount]').first().fill('100,250');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-1-bulletin.png') });
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Bulletin enregistré.');
    const bulletins = (await api('GET', `/entreprises/${cafe}/paie/bulletins?annee=2025`, associe)).corps.lignes as { mois: number; brut: string; net: string }[];
    expect(bulletins.map((b) => [b.mois, b.brut])).toEqual([[3, '1350.750']]);
    // Deux chemins, un chiffre : le net de l'écran est celui du serveur.
    const net = bulletins[0]?.net ?? '';
    await expect.poll(() => p.locator('table.pa-bulletins').innerText()).toMatch(new RegExp(net.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '\\s')));

    // ── L'écriture de paie du mois existe, sans qu'on la passe ──────────────────────────────────────
    const ecritures = (await api('GET', `/entreprises/${cafe}/compta/ecritures?limite=500`, associe)).corps.ecritures as { journal: string; date: string }[];
    expect(ecritures.filter((e) => e.journal === 'PAIE').map((e) => e.date)).toEqual(['2025-03-31']);
    await expect.poll(() => p.locator('#pa-ecrire').isDisabled()).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-2-mois.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
