// Le nom et le matricule d'un dossier, à la souris (brique 57 ; docs/cabinet.md, C47). L'écran est la
// fiche du dossier du Cabinet v10. Ce que le parcours vérifie, écran ET serveur :
//   - un dossier tenu : son nom et son matricule s'écrivent ; un matricule mal écrit se refuse sur sa
//     case, rien ne part ; bien écrit, le serveur les garde ;
//   - un client sur SkanFact : ses cases ne s'écrivent pas, et la fiche dit pourquoi, sans « paquets ».

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le nom et le matricule d\'un dossier, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-nom-'));
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

  it('le dossier tenu se renomme et reçoit son matricule ; celui d\'un client sur SkanFact reste le sien', async () => {
    const associe = await personne('associe');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps;
    const cabinet = String(cab.id);
    const tenu = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Boulangerie' })).corps.entreprise);
    // Un dossier tenu qui a déjà une écriture (des mois dans sa production).
    expect((await api('POST', `/entreprises/${tenu}/compta/ecritures`, associe, {
      date: '2026-03-20', journal: 'OD', piece: 'OD-1', libelle: 'Loyer', lignes: [{ compte: '6132', debit: '850,500' }, { compte: '401', credit: '850,500' }] })).statut).toBe(201);
    // Un client sur SkanFact, qui a choisi ce cabinet.
    const patron = await personne('client');
    const ent = String((await api('POST', '/entreprises', patron, { raisonSociale: 'Menuiserie Ben Salah' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, patron, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    const lu = async (e: string) => ((await api('GET', `/cabinets/${cabinet}/portefeuille`, associe)).corps.dossiers as { entreprise: string; raisonSociale: string; matriculeFiscal: string | null }[])
      .find((d) => d.entreprise === e);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const toast = () => p.locator('#toast').innerText();
    const fiche = async (e: string) => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${e}`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
        await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
      }
      await expect.poll(async () => {
        if (!await p.locator('#modal-root #f-name').count()) await p.locator('#edit').first().click({ timeout: 2_000 }).catch(() => {});
        return p.locator('#modal-root #f-name').count();
      }, { timeout: 20_000 }).toBe(1);
      return p.locator('#modal-root .modal').last();
    };

    // ── Le dossier tenu : un matricule mal écrit se refuse sur sa case ─────────────────────────────
    let f = await fiche(tenu);
    expect(await f.innerText()).not.toMatch(/paquet/i);
    expect([await f.locator('#f-name').getAttribute('readonly'), await f.locator('#f-mat').getAttribute('readonly')]).toEqual([null, null]);
    await f.locator('#f-name').fill('Boulangerie Ennour');
    await f.locator('#f-mat').fill('1234567A');
    await f.locator('#ok').click();
    await expect.poll(() => p.evaluate(() => document.activeElement?.id)).toBe('f-mat');
    await expect.poll(async () => (await p.locator('body').innerText()).includes('Le matricule fiscal s\'écrit 1234567A/B/C/000')).toBe(true);
    expect((await lu(tenu))?.raisonSociale).toBe('Boulangerie');
    // Bien écrit : le serveur garde le nom et le matricule.
    // Bien écrit, même avec des points et en minuscules : le serveur le garde dans sa forme.
    const chiffres = String(1_000_000 + Math.floor(Math.random() * 8_999_999));
    const matricule = `${chiffres}A/P/M/000`;
    await f.locator('#f-mat').fill(`${chiffres}a.p.m.000`);
    await f.locator('#ok').click();
    await expect.poll(async () => { const d = await lu(tenu); return [d?.raisonSociale, d?.matriculeFiscal]; }, { timeout: 15_000 }).toEqual(['Boulangerie Ennour', matricule]);
    await expect.poll(toast, { timeout: 15_000 }).toBe('Fiche enregistrée.');
    await expect.poll(() => p.locator('#view h1').first().innerText(), { timeout: 15_000 }).toMatch(/Boulangerie Ennour/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-nom-tenu.png') });

    // ── Un nouveau client : un matricule mal écrit se refuse sur sa case, rien n'est créé ──────────
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossiers`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    await expect.poll(async () => {
      if (!await p.locator('#modal-root #f-name').count()) await p.getByRole('button', { name: 'Nouveau client…' }).first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator('#modal-root #f-name').count();
    }, { timeout: 20_000 }).toBe(1);
    const nouveau = p.locator('#modal-root .modal').last();
    await nouveau.locator('#f-name').fill('Café des Arts');
    await nouveau.locator('#f-mat').fill('12345');
    await nouveau.locator('#ok').click();
    await expect.poll(() => p.evaluate(() => document.activeElement?.id)).toBe('f-mat');
    expect(((await api('GET', `/cabinets/${cabinet}/portefeuille`, associe)).corps.dossiers as unknown[]).length).toBe(2);
    await nouveau.locator('#no').click();

    // ── Le client sur SkanFact : ses cases ne s'écrivent pas, et la fiche dit pourquoi ──────────────
    f = await fiche(ent);
    expect([await f.locator('#f-name').getAttribute('readonly'), await f.locator('#f-mat').getAttribute('readonly')]).toEqual(['', '']);
    expect(await f.innerText()).toMatch(/Ce client est sur SkanFact\s:\sson nom et son matricule sont ceux qu.il y a donnés, lui seul les change\./);
    expect(await f.innerText()).not.toMatch(/paquet/i);
    await f.locator('#f-email').fill('contact@menuiserie.tn');
    await f.locator('#ok').click();
    await expect.poll(toast, { timeout: 15_000 }).toBe('Fiche enregistrée.');
    await expect.poll(async () => ((await api('GET', `/cabinets/${cabinet}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: Record<string, unknown> }[])
      .find((x) => x.entreprise === ent)?.contenu.email, { timeout: 15_000 }).toBe('contact@menuiserie.tn');
    expect((await lu(ent))?.raisonSociale).toBe('Menuiserie Ben Salah');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-nom-client.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
