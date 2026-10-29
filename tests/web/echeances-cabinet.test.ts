// Les Échéances du Cabinet (maquette « Échéances », docs/maquettes/cabinet/echeances.html ; 1.168.0), à la souris. Ce que
// le parcours vérifie, le 29/10/2026 (la déclaration de septembre devait partir le 28) :
//   - la liste : la déclaration en retard d'abord, ouverte à droite avec chaque dossier, ce qui lui manque et son geste ;
//   - « Relancer » : le message prêt, les pièces attendues cochées, une date ; il part dans la conversation du client, et
//     chaque pièce attendue y devient une demande datée ;
//   - « Marquer déposée… » d'un dossier qui n'a rien de prêt : néant ou pièces reçues ailleurs, le choix d'abord ; la ligne
//     passe aux déposées, « Annuler « déposée » » la remet ;
//   - la vue Mois : le calendrier du mois ;
//   - des clients sans aucune écriture : la page quitte son squelette (« Aucune échéance à suivre ») ;
//   - au téléphone : la liste, puis la déclaration ouverte.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const LE_29 = new Date('2026-10-29T10:00:00+01:00');

describe('les Échéances du Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-echeances-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
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
    const email = `${(nom.split(' ')[0] ?? '').normalize('NFD').replace(/[^a-z]/gi, '')}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  // Un cabinet, deux clients sur SkanFact, une écriture chacun.
  async function unCabinet(ecritures = true) {
    const associe = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const client = async (nom: string, gerant: string, jour: string) => {
      const j = await personne(gerant);
      const ent = String((await api('POST', '/entreprises', j, { raisonSociale: nom })).corps.id);
      const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, j, { codeCabinet: cab.code })).corps.mandat);
      expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
      // Une écriture : les livres ont commencé, les déclarations des mois suivants sont à suivre.
      if (ecritures) expect((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: jour, journal: 'OD', piece: 'OD-1', libelle: 'Honoraires',
        lignes: [{ compte: '6226', debit: '100,000' }, { compte: '401', credit: '100,000' }] })).statut).toBe(201);
      return { j, ent };
    };
    // La librairie a commencé en août et n'a rien envoyé pour septembre ; la menuiserie a son septembre à réviser.
    return { associe, cab, librairie: await client('Librairie Ennour', 'Hela Ben Salah', '2026-08-14'), menuiserie: await client('Menuiserie Ben Ali', 'Karim Ben Ali', '2026-09-15') };
  }
  async function ouvrir(p: Page, cabinet: string) {
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/echeances`);
    await p.locator('#page-ech .ec-i').first().waitFor({ timeout: 25_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
  }

  it('au bureau : la déclaration en retard, relancer un client, marquer déposée sans rien de prêt, l\'annuler, la vue Mois', async () => {
    const { associe, cab, librairie } = await unCabinet();
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.clock.setFixedTime(LE_29);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await ouvrir(p, cab.id);
    // La déclaration de septembre, en retard d'un jour, en tête et ouverte, avec ses deux dossiers et leur geste.
    const sept = p.locator('#page-ech .ec-i').filter({ hasText: 'Déclaration de septembre' });
    expect(await sept.innerText()).toMatch(/en retard de 1 jour/);
    expect(await p.locator('#page-ech .ec-i').first().innerText()).toMatch(/Déclaration de septembre/);
    const det = p.locator('#page-ech .ec-det');
    expect(await det.locator('h2').first().innerText()).toBe('Déclaration de septembre 2026');
    const ligne = (nom: string) => det.locator('.ec-r').filter({ hasText: nom });
    await expect.poll(() => det.locator('.ec-r').count()).toBe(2);
    expect(await ligne('Librairie Ennour').getByRole('button', { name: 'Relancer' }).count()).toBe(1);

    // Relancer : le message, les pièces attendues, une date ; il part dans la conversation, ses pièces en demandes datées.
    await ligne('Librairie Ennour').getByRole('button', { name: 'Relancer' }).click();
    const fen = p.locator('#modal-root');
    await expect.poll(() => fen.locator('h2').innerText()).toBe('Relancer Librairie Ennour');
    expect(await fen.locator('#ec-msg').inputValue()).toMatch(/septembre/);
    expect(await fen.locator('[data-ec-att]:checked').count()).toBeGreaterThan(0);
    await fen.getByRole('button', { name: 'Envoyer la relance' }).click();
    await expect.poll(() => p.locator('#toast').innerText()).toMatch(/Librairie Ennour/);
    const fil = (await api('GET', `/entreprises/${librairie.ent}/messages?cote=entreprise`, librairie.j)).corps as { attente: { demandes: number } };
    expect(fil.attente.demandes).toBeGreaterThan(0);

    // « Marquer déposée… » sans rien de prêt : le geste attend le choix (néant, ou des pièces reçues ailleurs).
    await ligne('Menuiserie Ben Ali').getByRole('button', { name: /Les autres gestes/ }).click();
    await p.getByRole('menuitem', { name: /Marquer déposée…/ }).click();
    await expect.poll(() => fen.locator('h2').innerText()).toBe('Menuiserie Ben Ali n\'a rien de prêt pour septembre');
    expect(await fen.locator('#ok').isDisabled()).toBe(true);
    await fen.locator('[data-ec-choix="neant"]').click();
    expect(await fen.locator('#ok').isDisabled()).toBe(false);
    await fen.locator('#ok').click();
    await expect.poll(() => p.locator('#toast').innerText()).toMatch(/Menuiserie Ben Ali : marquée déposée \(néant\)/);
    await expect.poll(() => ligne('Menuiserie Ben Ali').innerText()).toMatch(/Déposée/);
    // Elle se défait : « Annuler « déposée » » dans son menu.
    await ligne('Menuiserie Ben Ali').getByRole('button', { name: /Les autres gestes/ }).click();
    await p.getByRole('menuitem', { name: /Annuler « déposée »/ }).click();
    await expect.poll(() => ligne('Menuiserie Ben Ali').innerText()).not.toMatch(/Déposée/);

    // La vue Mois : octobre, le 28 marqué.
    await p.getByRole('button', { name: /Mois/ }).first().click();
    await expect.poll(() => p.locator('#page-ech').innerText()).toMatch(/octobre 2026/i);
    expect(erreurs).toEqual([]);
  });

  it('des clients sans aucune écriture : la page quitte son squelette et dit pourquoi elle est vide', async () => {
    // La première lecture ne change rien à ce que la page savait (rien) : elle redessine quand même (1.168.0).
    const { associe, cab } = await unCabinet(false);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.clock.setFixedTime(LE_29);
    const p = await cx.newPage();
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/echeances`);
    await expect.poll(() => p.locator('#view').innerText().catch(() => ''), { timeout: 15_000 }).toMatch(/Aucune échéance à suivre pour l'instant/);
    expect(await p.locator('#view .ec-sq').count()).toBe(0);
  });

  it('au téléphone : la liste, puis la déclaration ouverte et son retour', async () => {
    const { associe, cab } = await unCabinet();
    const cx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', isMobile: true, hasTouch: true });
    await cx.clock.setFixedTime(LE_29);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await ouvrir(p, cab.id);
    const largeur = await p.evaluate(() => document.documentElement.scrollWidth);
    expect(largeur).toBeLessThanOrEqual(390);
    await p.locator('#page-ech .ec-i').filter({ hasText: 'Déclaration de septembre' }).click();
    await expect.poll(() => p.locator('#page-ech .ec-det .ec-r').count()).toBe(2);
    expect(await p.locator('#page-ech .ec-det').isVisible()).toBe(true);
    expect(erreurs).toEqual([]);
  });
});
