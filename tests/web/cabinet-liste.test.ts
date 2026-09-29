// Une liste de clients collée, à la souris (brique 52 ; docs/cabinet.md, C42). L'écran est celui du
// Cabinet v10 (Dossiers → Ajouter mes clients… → Coller une liste). Ce que le parcours vérifie, écran ET
// serveur :
//   - un matricule incomplet arrête tout, sur la ligne qui le porte : rien n'est ajouté ;
//   - un matricule écrit avec des points se garde avec des « / », comme le serveur le tient ;
//   - la liste corrigée ajoute chaque client au portefeuille (son matricule, sa fiche : l'adresse, le
//     téléphone), et un client déjà là est ignoré et nommé.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('une liste de clients collée, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-liste-'));
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

  type Dossier = { entreprise: string; raisonSociale: string; matriculeFiscal: string | null };

  it('une ligne fausse arrête tout ; la liste corrigée ajoute chaque client, un doublon est ignoré et nommé', async () => {
    const associe = await personne('Karim');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Jasmins' });
    const portefeuille = async () => ((await api('GET', `/cabinets/${cabinet}/portefeuille`, associe)).corps.dossiers as Dossier[]);
    const fiches = async () => ((await api('GET', `/cabinets/${cabinet}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: { email?: string; phone?: string } }[]);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossiers`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    const toast = () => p.locator('#toast').innerText();
    const ouvrir = async (bouton: string, dedans: string) => expect.poll(async () => {
      if (!await p.locator(dedans).isVisible()) await p.locator(bouton).first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator(dedans).isVisible();
    }, { timeout: 30_000 }).toBe(true);

    await ouvrir('#new-d', '#nd-coller');
    await p.locator('#nd-coller').click();
    await p.locator('#cl-liste').waitFor();
    // ── Une ligne fausse arrête tout ──────────────────────────────────────────────────────────────
    await p.locator('#cl-liste').fill('Menuiserie Trabelsi SUARL ; 1122334A/M/P/000 ; contact@trabelsi.tn ; 71 222 333\nPharmacie El Menzah ; 1234567A\nCafé des Jasmins');
    await p.locator('#modal-root .modal').last().locator('#ok').click();
    await expect.poll(toast).toMatch(/« Pharmacie El Menzah » : le matricule fiscal « 1234567A » est incomplet ou ne se lit pas.*rien n'a été ajouté\./);
    expect((await portefeuille()).map((d) => d.raisonSociale)).toEqual(['Café des Jasmins']);
    // ── Corrigée : chaque client entre, le doublon est ignoré et nommé ──────────────────────────────
    await p.locator('#cl-liste').fill('Menuiserie Trabelsi SUARL ; 1122334A/M/P/000 ; contact@trabelsi.tn ; 71 222 333\nPharmacie El Menzah ; 1234567A.B.C.099\nCafé des Jasmins');
    await expect.poll(() => p.locator('#cl-apercu').innerText()).toMatch(/2 clients entreront/);
    await p.locator('#modal-root .modal').last().locator('#ok').click();
    await expect.poll(toast).toMatch(/2 clients ajoutés à ton portefeuille — 1 doublon ignoré : Café des Jasmins\./);
    const lus = await portefeuille();
    expect(lus.map((d) => [d.raisonSociale, d.matriculeFiscal]).sort()).toEqual([
      ['Café des Jasmins', null], ['Menuiserie Trabelsi SUARL', '1122334A/M/P/000'], ['Pharmacie El Menzah', '1234567A/B/C/099']].sort());
    const menuiserie = lus.find((d) => d.raisonSociale.startsWith('Menuiserie'))?.entreprise;
    expect((await fiches()).find((f) => f.entreprise === menuiserie)?.contenu).toMatchObject({ email: 'contact@trabelsi.tn', phone: '71 222 333' });
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/Pharmacie El Menzah/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-liste-clients.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
