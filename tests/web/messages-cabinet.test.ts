// Les Messages du Cabinet, à la souris (1.176.0 ; maquette docs/maquettes/cabinet/messages.html). Ce que le parcours vérifie,
// le 29/10/2026 :
//   - l'en-tête de la page : « Messages », sa phrase (qui attend ta réponse, qui doit une pièce), « Écrire à plusieurs
//     clients… » et le menu ⋯ de la page ;
//   - la liste : la portée « Tout le cabinet » (la direction), le résumé du cabinet qui filtre, les onglets et leurs chiffres,
//     sous chaque client le mois de son dossier (la même lecture que la liste des Dossiers) ;
//   - la conversation : son en-tête (le contact, « À traiter », « Marquer comme traité » E, le menu ⋯) ;
//   - le dossier à côté : le contact, l'année en segments, son mois, « Ouvrir le dossier », « On attend de… » quand une
//     pièce est demandée, et l'alerte par e-mail en interrupteur ;
//   - le clavier : E sur une ligne marque le client traité.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const LE_29 = new Date('2026-10-29T10:00:00+01:00');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('les Messages du Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-messages-cab-'));
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

  it('la boîte à trois colonnes : la phrase, la portée, le mois de chaque client, le dossier à côté, E pour traiter', async () => {
    const associe = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const client = async (nom: string, gerant: string) => {
      const j = await personne(gerant);
      const ent = String((await api('POST', '/entreprises', j, { raisonSociale: nom })).corps.id);
      const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, j, { codeCabinet: cab.code })).corps.mandat);
      expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
      expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, associe, { contenu: { contact: gerant, forme: 'SARL' }, revision: null })).statut).toBe(200);
      return { j, ent };
    };
    const hela = await client('Librairie Ennour', 'Hela Ben Salah');
    const karim = await client('Menuiserie Ben Ali', 'Karim Ben Ali');
    // Hela écrit au cabinet ; le cabinet demande une pièce à Karim (pour le 10 novembre).
    expect((await api('POST', `/entreprises/${hela.ent}/messages`, hela.j, { cote: 'entreprise', texte: 'Bonjour, la facture STEG de septembre, je la retrouve pas. C\'est grave ?' })).statut).toBe(201);
    expect((await api('POST', `/entreprises/${karim.ent}/messages`, associe, { cote: 'cabinet', texte: '', demande: 'Le relevé BIAT de septembre', pour: '2026-11-10' })).statut).toBe(201);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.clock.setFixedTime(LE_29);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages`);
    await p.locator('#page-msg .msg-filtres').waitFor({ timeout: 25_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();

    // ── L'en-tête : le titre, la phrase, les gestes ─────────────────────────────────────────────────────────────
    expect(net(await p.locator('#page-msg h1').innerText())).toMatch(/^Messages/);
    await expect.poll(async () => net(await p.locator('#msg-phrase').innerText())).toBe('1 client attend une réponse du cabinet · Menuiserie Ben Ali te doit une pièce ou une réponse.');
    expect(await p.getByRole('button', { name: 'Écrire à plusieurs clients…', exact: true }).isVisible()).toBe(true);
    // La pastille de la barre dit le même chiffre que l'onglet « À traiter » (la portée de la barre).
    await expect.poll(async () => net(await p.locator('#nav-messages').innerText())).toBe('1');
    // ── La liste : la portée (la direction voit tout le cabinet), les onglets, le mois de chaque client ────────────
    expect(await p.locator('[data-portee-choix]').inputValue()).toBe('tout');
    expect(net(await p.locator('.msg-liste-n').innerText())).toBe('2 conversations');
    expect(net(await p.locator('.msg-filtres').innerText())).toBe('À traiter 1 Attend le client 1 Tout 2');
    const ligne = (nom: string) => p.locator('.msg-dossier').filter({ hasText: nom });
    expect(net(await ligne('Librairie Ennour').locator('.msg-extrait').innerText())).toBe('Hela : Bonjour, la facture STEG de septembre, je la retrouve pas. C\'est grave ?');
    expect(await ligne('Librairie Ennour').locator('.msg-dossier-l3 .msg-mois, .msg-dossier-l3 .msg-puce').count()).toBeGreaterThan(0);
    // ── La conversation de Hela, ouverte : son contact, « À traiter », « Marquer comme traité » ────────────────────
    await expect.poll(async () => net(await p.locator('.msg-tete-integre h2').innerText())).toBe('Librairie Ennour');
    expect(net(await p.locator('.msg-tete-integre .msg-sous').innerText())).toBe('Hela Ben Salah');
    expect(net(await p.locator('.msg-tete-etat').innerText())).toBe('À traiter Marquer comme traité E');
    // Le menu ⋯ : la question de la révision, le dossier, en grand.
    await p.getByRole('button', { name: 'Les autres gestes de cette conversation' }).click();
    expect((await p.getByRole('menuitem').allInnerTexts()).map((x) => x.split('\n')[0])).toEqual(['Question sur une pièce…', 'Ouvrir le dossier', 'Ouvrir en grand']);
    await p.keyboard.press('Escape');
    await expect.poll(() => p.getByRole('menuitem').count()).toBe(0);
    // ── Le dossier à côté : le contact, l'année, « Ouvrir le dossier », l'alerte ; rien n'est attendu de Hela ───────
    const cote = p.locator('[data-cote]');
    expect(net(await cote.locator('.msg-cote-qui').innerText())).toBe('HB Hela Ben Salah Librairie Ennour personne ne le suit encore');
    expect(await cote.locator('.msg-segs i').count()).toBe(12);
    expect(await cote.getByRole('link', { name: /Ouvrir le dossier/ }).getAttribute('href')).toBe(`#/dossier/${hela.ent}`);
    expect(await cote.locator('[data-msg-attente]').count()).toBe(0);
    expect(await cote.getByRole('switch', { name: /Me prévenir par e-mail/ }).count()).toBe(1);
    // ── Karim : la pièce demandée se lit dans « On attend de Karim » ───────────────────────────────────────────────
    // « À traiter » ne montre que Hela : « Tout » montre aussi Karim.
    expect(await ligne('Menuiserie Ben Ali').count()).toBe(0);
    await p.getByRole('tab', { name: /^Tout/ }).click();
    await ligne('Menuiserie Ben Ali').click();
    await expect.poll(async () => net(await cote.locator('[data-msg-attente]').innerText().catch(() => ''))).toBe('ON ATTEND DE KARIM 1 Le relevé BIAT de septembre pièce demandée · pour le 10/11/2026');
    expect(net(await p.locator('.msg-tete-etat').innerText())).toBe('Attend le client');
    // ── Le résumé du cabinet (Tout le cabinet) : rien en retard, aucune question ouverte, aucune photo : il se tait ─
    expect(await p.locator('[data-resume]').isHidden()).toBe(true);
    // ── E sur la ligne de Hela : elle quitte « À traiter » ─────────────────────────────────────────────────────────
    await ligne('Librairie Ennour').click();
    await ligne('Librairie Ennour').focus();
    await p.keyboard.press('e');
    await expect.poll(async () => net(await p.locator('#toast').innerText()), { timeout: 15_000 }).toMatch(/^C'est noté : Librairie Ennour quitte « À traiter »/);
    await expect.poll(async () => net(await p.locator('.msg-filtres').innerText()), { timeout: 15_000 }).toBe('À traiter 0 Attend le client 1 Tout 2');
    await expect.poll(async () => net(await p.locator('#msg-phrase').innerText())).toBe('Aucun client n\'attend de réponse du cabinet · Menuiserie Ben Ali te doit une pièce ou une réponse.');
    await expect.poll(() => p.locator('#nav-messages').isVisible()).toBe(false);
    // La boîte tient dans l'écran.
    expect(await p.evaluate(() => { const m = document.querySelector('main') as HTMLElement; return m.scrollHeight <= m.clientHeight; })).toBe(true);
    expect(erreurs).toEqual([]);
  }, 90_000);
});
