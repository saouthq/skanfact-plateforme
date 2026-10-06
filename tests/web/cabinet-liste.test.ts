// Une liste de clients collée, à la souris (brique 52 ; docs/cabinet.md, C42). L'écran est celui du
// Cabinet v10 (Dossiers → Ajouter mes clients… → Coller une liste). Ce que le parcours vérifie, écran ET
// serveur :
//   - un matricule incomplet arrête tout, sur la ligne qui le porte : rien n'est ajouté ;
//   - un matricule écrit avec des points se garde avec des « / », comme le serveur le tient ;
//   - la liste corrigée ajoute chaque client au portefeuille (son matricule, sa fiche : l'adresse, le
//     téléphone), et un client déjà là est ignoré et nommé ;
//   - (E5) la case du nouveau dossier tient la règle du serveur et le dit avec ses mots ; un matricule déjà celui d'une
//     entreprise sur SkanFact se dit sur sa case ; dans une liste, la ligne qui le porte est nommée, avec ce qui est entré.

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
    // La lettre-clé n'est jamais I, O ni U : la même règle que le serveur, avant d'écrire quoi que ce soit (E4).
    await p.locator('#cl-liste').fill('Pharmacie El Menzah ; 1234567O.B.C.099');
    await p.locator('#modal-root .modal').last().locator('#ok').click();
    await expect.poll(toast).toMatch(/« Pharmacie El Menzah » : le matricule fiscal « 1234567O\.B\.C\.099 » est incomplet ou ne se lit pas : sept chiffres, une lettre autre que I, O ou U.*rien n'a été ajouté\./);
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

  // E5 (vu sur le serveur d'essai, 06/10/2026) : la case du nouveau dossier contrôlait encore l'ancienne règle (une
  // lettre-clé O passait, et le serveur la refusait ensuite avec une autre phrase) ; un matricule déjà celui d'une
  // entreprise sur SkanFact ne se disait qu'en bas de l'écran ; dans une liste collée, il l'arrêtait au milieu sans
  // nommer la ligne ni dire ce qui était entré.
  it('un matricule refusé se dit sur sa case ; dans une liste, la ligne refusée est nommée avec ce qui est entré (E5)', async () => {
    // Une entreprise sur SkanFact porte 2236067E/A/M/000 (un matricule à ce fichier seul : tests/matricule-libre.ts).
    const patron = await personne('Moez');
    expect((await api('POST', '/entreprises', patron, { raisonSociale: 'Boulangerie Moez', matriculeFiscal: '2236067E/A/M/000' })).statut).toBe(201);
    const associe = await personne('Nadia');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet du Lac' })).corps.id);
    const portefeuille = async () => ((await api('GET', `/cabinets/${cabinet}/portefeuille`, associe)).corps.dossiers as Dossier[]).map((d) => d.raisonSociale).sort();

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossiers`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    const toast = () => p.locator('#toast').innerText();
    const marquee = () => p.locator('#f-mat').getAttribute('aria-invalid');
    await expect.poll(async () => {
      if (!await p.locator('#f-mat').isVisible()) await p.locator('#new-d').first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator('#f-mat').isVisible();
    }, { timeout: 30_000 }).toBe(true);
    const creer = () => p.locator('#modal-root .modal').last().locator('#ok').click();
    await p.locator('#f-name').fill('Épicerie du Port');

    // ── La lettre-clé O : la case la refuse avec la règle du serveur, dite avec ses mots, avant d'écrire ──────────────
    await p.locator('#f-mat').fill('2236068O/A/M/000');
    await creer();
    await expect.poll(toast).toBe('Le matricule fiscal s\'écrit comme sur la carte d\'identification fiscale : sept chiffres, une lettre autre que I, O ou U, puis code TVA, catégorie et établissement (1234567A/A/M/000). Laisse la case vide si tu ne l\'as pas.');
    expect(await marquee()).toBe('true');

    // ── Déjà celui d'une entreprise sur SkanFact, écrit autrement : le serveur le refuse, et la case le montre ────────
    await p.locator('#f-mat').fill('2236067 e a m 000');
    expect(await marquee()).toBeNull();
    await creer();
    await expect.poll(toast).toBe('Ce matricule fiscal est déjà celui d\'une entreprise sur SkanFact : si c\'est ton client, qu\'il te propose le mandat avec le code de ton cabinet.');
    await expect.poll(marquee).toBe('true');
    expect(await portefeuille()).toEqual([]);
    await p.locator('#modal-root .modal').last().locator('#no').click();

    // ── Dans une liste collée : la ligne refusée est nommée, avec ce qui est déjà entré ────────────────────────────────
    await expect.poll(async () => {
      if (!await p.locator('#nd-coller').isVisible()) await p.locator('#new-d').first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator('#nd-coller').isVisible();
    }, { timeout: 30_000 }).toBe(true);
    await p.locator('#nd-coller').click();
    await p.locator('#cl-liste').fill('Café Bleu\nÉpicerie du Port ; 2236067E/A/M/000\nLibrairie Clairefontaine');
    await p.locator('#modal-root .modal').last().locator('#ok').click();
    await expect.poll(toast).toBe('« Épicerie du Port » : ce matricule fiscal est déjà celui d\'une entreprise sur SkanFact : si c\'est ton client, qu\'il te propose le mandat avec le code de ton cabinet. Le client d\'avant est ajouté ; retire ou corrige cette ligne, puis ajoute la liste de nouveau : les clients déjà dans ton portefeuille seront ignorés.');
    expect(await portefeuille()).toEqual(['Café Bleu']);
    // La ligne retirée, la liste repart : le client d'avant est ignoré et nommé, le dernier entre.
    await p.locator('#cl-liste').fill('Café Bleu\nLibrairie Clairefontaine');
    await p.locator('#modal-root .modal').last().locator('#ok').click();
    await expect.poll(toast).toMatch(/1 client ajouté à ton portefeuille — 1 doublon ignoré : Café Bleu\./);
    expect(await portefeuille()).toEqual(['Café Bleu', 'Librairie Clairefontaine']);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
