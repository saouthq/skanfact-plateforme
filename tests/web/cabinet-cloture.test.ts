// La clôture de l'exercice, à la souris (brique 45 ; docs/cabinet.md, C35). L'écran est celui du Cabinet
// v10 ; les contrôles, les états et les à-nouveaux se calculent par la v10 sur le livre du serveur ; la
// clôture et la réouverture vont au serveur. Ce que le parcours vérifie, écran ET serveur :
//   - avec une écriture au brouillard, la clôture se refuse avant la question, et dit pourquoi ;
//   - clôturé, la période est validée jusqu'au 31 décembre, l'exercice clos au nom de l'associé ;
//   - les à-nouveaux de l'année d'après se posent au 1er janvier, en brouillard, au millime ;
//   - rouvert avec un motif, le motif se lit sur l'écran et au serveur.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la clôture de l\'exercice, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-clo-'));
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

  type Exercice = { annee: number; closLe: string | null; closPar: string | null; reouvertures: { motif: string }[] };
  type Ecriture = { journal: string; date: string; statut: string; lignes: { compte: string; debit: string; credit: string }[] };

  it('refusée sur un brouillard, clôturée, les à-nouveaux posés au 1er janvier, rouverte avec son motif', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    expect((await api('POST', `/entreprises/${cafe}/compta/exercices`, associe, { annee: 2025, ouverture: [
      { compte: '532', libelle: 'Banque', debit: '12500,250' }, { compte: '101', libelle: 'Capital', credit: '12500,250' }] })).statut).toBe(201);
    const od = String((await api('POST', `/entreprises/${cafe}/compta/ecritures`, associe, { date: '2025-11-30', journal: 'OD', piece: 'OD-9', libelle: 'Honoraires à payer',
      lignes: [{ compte: '6226', debit: '300,125' }, { compte: '4286', credit: '300,125' }] })).corps.id);
    const exercice = async (annee: number) => ((await api('GET', `/entreprises/${cafe}/compta/exercices`, associe)).corps.exercices as Exercice[]).find((x) => x.annee === annee);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async () => {
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/exercice/2025`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    await aller();
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();
    const ouvrir = async (bouton: string, dedans: string) => expect.poll(async () => {
      if (!await p.locator(dedans).count()) await p.locator(bouton).first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator(dedans).count();
    }, { timeout: 20_000 }).toBe(1);

    // ── Une écriture au brouillard : refusé avant la question, et dit pourquoi ───────────────────
    await p.locator('#cl-cloturer').waitFor({ timeout: 20_000 });
    expect(await p.locator('#cl-fusion').count()).toBe(0);
    await p.locator('#cl-cloturer').click();
    await expect.poll(toast).toMatch(/^1\spièce encore en brouillard/);
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    expect((await exercice(2025))?.closLe).toBeNull();

    // ── Validée à la souris dans la saisie : de retour sur l'exercice, ses contrôles se relisent ─────
    await p.locator('[data-ctrl="brouillard"]').click();
    await expect.poll(async () => {
      if (!await p.getByRole('menuitem').filter({ hasText: 'Valider cette écriture' }).count()) await p.locator(`[data-rowmenu="B:${od}"]`).first().click({ timeout: 2_000 }).catch(() => {});
      return p.getByRole('menuitem').filter({ hasText: 'Valider cette écriture' }).count();
    }, { timeout: 20_000 }).toBe(1);
    await p.getByRole('menuitem').filter({ hasText: 'Valider cette écriture' }).click();
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => ((await api('GET', `/entreprises/${cafe}/compta/ecritures?limite=500`, associe)).corps.ecritures as { id: string; statut: string }[])
      .find((e) => e.id === od)?.statut, { timeout: 10_000 }).toBe('validee');
    await p.evaluate((h) => { location.hash = h; }, `#/dossier/${cafe}/comptabilite/exercice/2025`);
    await expect.poll(() => p.locator('#cl-sec-controles').innerText().catch(() => ''), { timeout: 20_000 }).toMatch(/Les pièces encore en brouillard\s+rien à signaler/);
    await ouvrir('#cl-cloturer', '#modal-root .modal');
    expect(await fenetre.innerText()).toMatch(/La période sera validée jusqu'au 31\/12\/2025/);
    await fenetre.getByRole('button', { name: 'Clôturer', exact: true }).click();
    await expect.poll(toast).toBe('Exercice clos.');
    expect(await exercice(2025)).toMatchObject({ closPar: 'associe' });
    await expect.poll(() => p.locator('#cl-clos').innerText()).toMatch(/Exercice clos le \d{2}\/\d{2}\/\d{4} par associe\./);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-cloture-1-close.png') });

    // ── Les à-nouveaux de 2026, au 1er janvier, en brouillard, au millime ────────────────────────
    await expect.poll(() => p.locator('#cl-suivant').innerText()).toBe('Ouvrir 2026 (à-nouveaux)…');
    await ouvrir('#cl-suivant', '#modal-root .modal');
    expect(await fenetre.innerText()).toMatch(/À-nouveaux posés sur 2026/);
    await fenetre.getByRole('button', { name: 'Rester sur 2025', exact: true }).click();
    const an = ((await api('GET', `/entreprises/${cafe}/compta/ecritures?limite=500`, associe)).corps.ecritures as Ecriture[]).filter((e) => e.date === '2026-01-01');
    expect(an.map((e) => [e.journal, e.statut])).toEqual([['AN', 'brouillard']]);
    expect(an[0]?.lignes.map((l) => [l.compte, l.debit, l.credit]).sort()).toEqual([
      ['101', '0.000', '12500.250'], ['13', '300.125', '0.000'], ['4286', '0.000', '300.125'], ['532', '12500.250', '0.000']]);
    expect(await exercice(2026)).toMatchObject({ annee: 2026, closLe: null });
    await expect.poll(() => p.locator('#cl-suivant').innerText()).toBe('Refaire les à-nouveaux de 2026…');

    // ── Rouvert, avec son motif ───────────────────────────────────────────────────────────────────
    await ouvrir('#cl-rouvrir', '#cl-motif');
    await fenetre.locator('#cl-motif').fill('Facture d\'électricité de décembre reçue après la clôture');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Exercice rouvert.');
    expect((await exercice(2025))?.reouvertures.map((r) => r.motif)).toEqual(['Facture d\'électricité de décembre reçue après la clôture']);
    await expect.poll(() => p.locator('#cl-rouvert').innerText()).toMatch(/Facture d'électricité de décembre reçue après la clôture/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-cloture-2-rouvert.png') });
    expect(erreurs).toEqual([]);
  }, 240_000);
});
