// La fiche du dossier au Cabinet (maquette « Fiche du dossier », docs/maquettes/cabinet/fiche-du-dossier.html ; 1.170.0), à la souris.
// Ce que le parcours vérifie, le 28/10/2026 (septembre se dépose aujourd'hui, août est en retard) :
//   - un client dont rien n'est arrivé depuis juillet : UN geste (« Relancer Hédi… », le seul bouton vert de la page) pour août
//     et septembre, la phrase de l'en-tête, « Rien à réviser », août dit « en retard depuis le 28/09 » ;
//   - un mois de l'année s'ouvre ; le menu ⋯ ; la note de l'équipe s'écrit et se range sur la fiche ;
//   - un client qui vient d'arriver (aucune écriture) : « Bienvenue au cabinet » ; un dossier inconnu : « plus dans ton portefeuille » ;
//   - au téléphone : rien ne déborde, pas d'avis « pensé pour un ordinateur », et sans réseau la relance attend.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const LE_28 = new Date('2026-10-28T10:00:00+01:00');

describe('la fiche du dossier au Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-fiche-'));
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
    return { jeton, email };
  };
  // Un cabinet ; la menuiserie, sur SkanFact, dont la mission commence en août et dont la dernière écriture est du 15/07 ;
  // un hôtel qui vient de confier son dossier, sans aucune écriture.
  async function unCabinet() {
    const { jeton: associe } = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const client = async (nom: string, gerant: string) => {
      const { jeton: j } = await personne(gerant);
      const ent = String((await api('POST', '/entreprises', j, { raisonSociale: nom })).corps.id);
      const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, j, { codeCabinet: cab.code })).corps.mandat);
      expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
      return ent;
    };
    const menuiserie = await client('Menuiserie Ben Ali', 'Hédi Ben Ali');
    expect((await api('POST', `/entreprises/${menuiserie}/compta/ecritures`, associe, { date: '2026-07-15', journal: 'OD', piece: 'OD-1', libelle: 'Honoraires',
      lignes: [{ compte: '6226', debit: '100,000' }, { compte: '401', credit: '100,000' }] })).statut).toBe(201);
    expect((await api('PUT', `/cabinets/${cab.id}/fiches/${menuiserie}`, associe, { contenu: { contact: 'Hédi', fonction: 'gérant', forme: 'SARL', activite: 'menuiserie bois', ville: 'Ben Arous', from: '2026-08', fees: 350_000 }, revision: null })).statut).toBeLessThan(300);
    const hotel = await client('Hôtel Les Pins', 'Mounir Ben Hassen');
    expect((await api('PUT', `/cabinets/${cab.id}/fiches/${hotel}`, associe, { contenu: { contact: 'Mounir' }, revision: null })).statut).toBeLessThan(300);
    return { associe, cab, menuiserie, hotel };
  }
  async function contexte(jeton: string, tel = false) {
    const cx = await navigateur.newContext({ viewport: tel ? { width: 390, height: 844 } : { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', ...(tel ? { isMobile: true, hasTouch: true } : {}) });
    await cx.clock.setFixedTime(LE_28);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    return { p, erreurs };
  }
  async function ouvrir(p: Page, cabinet: string, ent: string, attendre = '.fd-ms') {
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}`);
    await p.locator(attendre).first().waitFor({ timeout: 25_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
  }

  it('au bureau : rien reçu depuis juillet, un seul geste ; le mois, le menu, la note ; un client qui arrive ; un dossier inconnu', async () => {
    const { associe, cab, menuiserie, hotel } = await unCabinet();
    const { p, erreurs } = await contexte(associe);
    await ouvrir(p, cab.id, menuiserie, '.fd-afs');
    // Août (en retard) et septembre (à déposer aujourd'hui) n'ont rien reçu : une seule ligne, un seul geste.
    const lignes = p.locator('.fd-afs > li');
    expect(await lignes.count()).toBe(1);
    expect(await lignes.first().innerText()).toMatch(/Août et septembre · rien reçu[\s\S]*Aucune écriture depuis le 15\/07\. Août est en retard depuis le 28\/09 ; Septembre se dépose aujourd'hui\. Hédi n'a jamais été relancé\./);
    expect(await p.locator('#page-fd .btn-primary').allInnerTexts()).toEqual(['Relancer Hédi…']);
    expect(await p.locator('.fd-phrase').innerText()).toBe('Rien reçu depuis le 15/07 · août en retard · septembre à déposer aujourd\'hui · jamais relancé');
    expect(await p.locator('.fd-rv-rien').innerText()).toBe('Rien à réviser : aucune écriture depuis le 15/07. Elle commence dès que Hédi enregistre ses pièces.');
    expect(await p.locator('#page-fd .fd-sous').innerText()).toMatch(/^SARL · menuiserie bois · Ben Arous/);
    expect(await p.locator('#page-fd').innerText()).toMatch(/350,000 DT HT par mois/);
    expect(await p.locator('#bandeau-ordinateur').count()).toBe(0);

    // Un mois de l'année : août dit depuis quand il est en retard, et s'ouvre.
    const aout = p.locator('[data-fd-mois="2026-08"]');
    expect(await aout.innerText()).toMatch(/en retard depuis le 28\/09/);
    await aout.click();
    await expect.poll(() => p.locator('.fd-page').innerText()).toMatch(/Août 2026/);

    // Le menu ⋯ du dossier.
    await p.locator('#fd-menu').click();
    const gestes = await p.getByRole('menuitem').allInnerTexts();
    expect(gestes.map((g) => g.split('\n')[0])).toEqual(expect.arrayContaining(['Modifier la fiche', 'Confier à…', 'Noter une relance faite ailleurs…', 'Archiver le dossier…']));
    await p.keyboard.press('Escape');
    await p.mouse.click(700, 20);

    // La note de l'équipe : elle s'écrit, et se range sur la fiche.
    await p.locator('#fd-note').click();
    await p.locator('#fd-note-t').fill('Préfère être appelé le matin.');
    await p.getByRole('button', { name: 'Enregistrer la note' }).click();
    await expect.poll(() => p.locator('#toast').innerText()).toMatch(/Note enregistrée sur la fiche/);
    await expect.poll(() => p.locator('.fd-note').innerText()).toBe('Préfère être appelé le matin.');

    // Un client qui vient d'arriver : ses premiers pas, dans l'ordre.
    await ouvrir(p, cab.id, hotel, '.fd-bv');
    expect(await p.locator('#fd-bv').innerText()).toBe('Bienvenue au cabinet, Hôtel Les Pins');
    expect(await p.locator('#page-fd .btn-primary').allInnerTexts()).toEqual(['Écrire à Mounir']);

    // Un dossier qui n'est plus dans le portefeuille : il le dit, et ramène aux dossiers.
    await p.evaluate(() => { location.hash = '#/dossier/inconnu-123'; });
    await expect.poll(() => p.locator('#page-fd-x').innerText().catch(() => '')).toMatch(/Ce dossier n'est plus dans ton portefeuille/);
    await p.getByRole('button', { name: 'Revenir à Tous les dossiers' }).click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/dossiers');
    expect(erreurs).toEqual([]);
  });

  it('au téléphone : rien ne déborde, pas d\'avis « pensé pour un ordinateur » ; sans réseau, la relance attend', async () => {
    const { associe, cab, menuiserie } = await unCabinet();
    const { p, erreurs } = await contexte(associe, true);
    await ouvrir(p, cab.id, menuiserie, '.fd-afs');
    await p.waitForTimeout(800);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await p.locator('#bandeau-ordinateur').count()).toBe(0);
    expect(await p.locator('[data-fd-mois]').count()).toBe(12);
    // Sans réseau : la fiche se lit, le bandeau le dit, et « Relancer » attend le retour du réseau.
    await p.context().setOffline(true);
    await p.evaluate(() => { location.hash = '#/dossiers'; });
    await p.waitForTimeout(500);
    await p.evaluate((e) => { location.hash = `#/dossier/${e}`; }, menuiserie);
    await expect.poll(() => p.locator('.fd-band').first().innerText().catch(() => '')).toMatch(/Pas de réseau : ce poste montre le dossier tel qu'il le connaît\./);
    expect(await p.getByRole('button', { name: 'Relancer Hédi…' }).isDisabled()).toBe(true);
    expect(erreurs).toEqual([]);
  });
});
