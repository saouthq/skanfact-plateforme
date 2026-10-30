// Les Messages du Cabinet, à la souris (1.176.0 ; maquette docs/maquettes/cabinet/messages.html). Ce que le parcours vérifie,
// le 29/10/2026 :
//   - l'en-tête de la page : « Messages », sa phrase (qui attend ta réponse, qui doit une pièce), « Écrire à plusieurs
//     clients… » et le menu ⋯ de la page ;
//   - la liste : la portée « Tout le cabinet » (la direction), le résumé du cabinet qui filtre, les onglets et leurs chiffres,
//     sous chaque client le mois de son dossier (la même lecture que la liste des Dossiers) ;
//   - la conversation : son en-tête (le contact, « À traiter », « Marquer comme traité » E, le menu ⋯) ;
//   - le dossier à côté : le contact, l'année en segments, son mois, « Ouvrir le dossier », « On attend de… » quand une
//     pièce est demandée, et l'alerte par e-mail en interrupteur ;
//   - le clavier : E sur une ligne marque le client traité ;
//   - (1.177.0) la note pour l'équipe : son onglet, « Noter », la carte au cadenas dans le fil ; le client ne la lit pas.

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
    expect((await p.getByRole('menuitem').allInnerTexts()).map((x) => x.split('\n')[0])).toEqual(['Question sur une pièce…', 'Me le remontrer demain', 'Noter une promesse…', 'Confier à…', 'Ouvrir le dossier', 'Ouvrir en grand', 'Exporter la conversation (PDF)']);
    await p.keyboard.press('Escape');
    await expect.poll(() => p.getByRole('menuitem').count()).toBe(0);
    // ── (1.177.0) La note pour l'équipe : l'onglet, le champ, « Noter », la ligne du bas ; dans le fil, la carte au cadenas ─
    const ecrire = p.locator('[data-msg-ecrire]');
    expect(await ecrire.getByRole('tab').allInnerTexts()).toEqual(['Message à Hela', 'Note pour l\'équipe']);
    expect(await ecrire.locator('[data-msg-note-pied]').isHidden()).toBe(true);
    await ecrire.getByRole('tab', { name: 'Note pour l\'équipe' }).click();
    expect(net(await ecrire.locator('[data-msg-note-pied]').innerText())).toBe('Hela ne lit jamais les notes ; elles restent dans le dossier, avec leur date.');
    expect(await ecrire.getByRole('button', { name: 'Demander une pièce' }).isDisabled()).toBe(true);
    // Vide, elle est refusée, et le refus le dit.
    await ecrire.getByRole('button', { name: 'Noter', exact: true }).click();
    expect(await ecrire.locator('[data-msg-refus]').innerText()).toBe('Une note vide n\'apprend rien à l\'équipe : écris ce qu\'il faut savoir, puis « Noter ».');
    await ecrire.locator('[data-msg-texte]').fill('La STEG de septembre manque : à demander avec la déclaration.');
    await ecrire.getByRole('button', { name: 'Noter', exact: true }).click();
    await expect.poll(async () => net(await p.locator('[data-msg-fil] .msg-note').innerText().catch(() => '')), { timeout: 15_000 })
      .toMatch(/^Note pour l'équipe · toi · \d\d:\d\d La STEG de septembre manque : à demander avec la déclaration\.$/);
    expect(await ecrire.locator('[data-msg-texte]').inputValue()).toBe('');
    // Hela ne la lit pas : son fil ne la porte pas (la conversation de l'entreprise ne lit que les messages).
    const vuParHela = JSON.stringify((await api('GET', `/entreprises/${hela.ent}/messages?cote=entreprise`, hela.j)).corps);
    expect(vuParHela).toContain('je la retrouve pas');
    expect(vuParHela).not.toContain('La STEG de septembre manque');
    // Retour au message : « Envoyer », les gestes rendus, la ligne du bas tue.
    await ecrire.getByRole('tab', { name: 'Message à Hela' }).click();
    expect(await ecrire.getByRole('button', { name: 'Envoyer', exact: true }).count()).toBe(1);
    expect(await ecrire.getByRole('button', { name: 'Demander une pièce' }).isDisabled()).toBe(false);
    expect(await ecrire.locator('[data-msg-note-pied]').isHidden()).toBe(true);
    // ── Le dossier à côté : le contact, l'année, « Ouvrir le dossier », l'alerte ; rien n'est attendu de Hela ───────
    const cote = p.locator('[data-cote]');
    expect(net(await cote.locator('.msg-cote-qui').innerText())).toBe('H Hela Ben Salah Librairie Ennour personne ne le suit encore');
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
  it('(1.178.0) le cabinet neuf, la promesse du client, « Me le remontrer demain », tout le monde a sa réponse, le dossier tenu', async () => {
    const nadia = await personne('Nadia Ferchichi');
    const cab = (await api('POST', '/cabinets', nadia, { nom: 'Ferchichi Expertise' })).corps as { id: string; code: string };
    expect((await api('POST', `/cabinets/${cab.id}/dossiers`, nadia, { raisonSociale: 'Clinique Les Jasmins' })).statut).toBe(201);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, nadia);
    // La même adresse (seul le # change) ne recharge pas la page : la seconde fois, elle se recharge.
    let ouverte = false;
    const ouvrir = async () => {
      if (ouverte) await p.reload(); else await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages`);
      ouverte = true;
      await p.locator('#msg-racine .msg-neuf, #page-msg .msg-filtres').first().waitFor({ timeout: 25_000 });
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    // ── Le cabinet neuf : ce que fait la messagerie, le code, inviter, les modèles, un aperçu ─────────────────────────
    await ouvrir();
    const neuf = p.locator('.msg-neuf');
    expect(net(await neuf.locator('h2').innerText())).toBe('Tes clients t\'écriront ici');
    expect(net(await neuf.locator('.msg-neuf-tete p').innerText())).toMatch(/Ton client est tenu au cabinet, sans compte SkanFact : aucune conversation pour l'instant\.$/);
    expect((await neuf.locator('.msg-neuf-pas > li > b').allInnerTexts())).toEqual(['Ton code cabinet', 'Inviter un client', 'Préparer tes modèles']);
    expect(net(await neuf.locator('.msg-neuf-code').innerText())).toBe(cab.code);
    expect(await neuf.locator('.msg-neuf-ap').isVisible()).toBe(true);

    // ── Un client en ligne, Amel, qui promet ─────────────────────────────────────────────────────────────────────
    const amel = await personne('Amel Ennour');
    const ent = String((await api('POST', '/entreprises', amel, { raisonSociale: 'Librairie Ennour' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, amel, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, nadia)).statut).toBe(200);
    expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, nadia, { contenu: { contact: 'Amel Ennour' }, revision: null })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/messages`, amel, { cote: 'entreprise', texte: 'Désolée pour le retard, je vous envoie tout vendredi, promis.' })).statut).toBe(201);
    await ouvrir();
    await expect.poll(async () => net(await p.locator('.msg-tete-integre h2').innerText().catch(() => ''))).toBe('Librairie Ennour');
    // La promesse se propose sous son message : vendredi d'abord ; « Noter pour vendredi ».
    const pop = p.locator('[data-msg-pp]');
    await pop.waitFor({ timeout: 15_000 });
    expect(net(await pop.locator('b').first().innerText())).toBe('Noter la promesse d\'Amel');
    expect(net(await pop.locator('[data-msg-pp-jour]').first().innerText())).toMatch(/^ven\. \d\d\/\d\d$/);
    expect(net(await pop.locator('[data-msg-pp-oui]').innerText())).toBe('Noter pour vendredi');
    await pop.locator('[data-msg-pp-oui]').click();
    await expect.poll(async () => net(await p.locator('[data-msg-promesse]').innerText().catch(() => '')), { timeout: 15_000 })
      .toMatch(/^Amel promet ses pièces de \S+ pour vendredi \d\d\/\d\d notée par toi · elle compte dans « Attend le client » ; vendredi soir sans rien, elle revient dans « À traiter » Retirer$/);
    expect(net(await p.locator('#toast').innerText())).toMatch(/^Promesse notée : vendredi \d\d\/\d\d Annuler$/);
    await expect.poll(async () => net(await p.locator('.msg-tete-etat').innerText())).toBe('Attend le client');
    await expect.poll(async () => net(await p.locator('.msg-filtres').innerText())).toBe('À traiter 0 Attend le client 1 Tout 1');
    expect(net(await p.locator('.msg-dossier').filter({ hasText: 'Librairie Ennour' }).locator('.msg-puce.promis').innerText())).toMatch(/^promis ven\. \d\d\/\d\d$/);
    expect(net(await p.locator('[data-cote] [data-msg-attente]').innerText())).toMatch(/^ON ATTEND D'AMEL 1 Ses pièces de \S+ promis pour vendredi \d\d\/\d\d$/i);
    // Retirer : elle revient dans « À traiter ».
    await p.locator('[data-msg-promesse-retirer]').click();
    await expect.poll(async () => net(await p.locator('.msg-filtres').innerText()), { timeout: 15_000 }).toBe('À traiter 1 Attend le client 0 Tout 1');

    // ── « Me le remontrer demain » : elle quitte mon « À traiter » ; tout le monde a sa réponse ─────────────────────
    await p.getByRole('button', { name: 'Les autres gestes de cette conversation' }).click();
    await p.getByRole('menuitem', { name: /^Me le remontrer demain/ }).click();
    await expect.poll(async () => net(await p.locator('.msg-tete-etat').innerText()), { timeout: 15_000 }).toMatch(/^Plus tard · \S+ \d\d\/\d\d$/);
    await expect.poll(async () => net(await p.locator('.msg-filtres').innerText())).toBe('À traiter 0 Attend le client 0 Tout 1');
    expect(net(await p.locator('#toast').innerText())).toMatch(/^Elle revient \S+ \d\d\/\d\d : d'ici là, elle quitte ton « À traiter »\. Annuler$/);
    await expect.poll(async () => net(await p.locator('[data-msg-calme] b').innerText().catch(() => ''))).toBe('Tout le monde a sa réponse');
    expect(net(await p.locator('[data-msg-calme] > span').nth(1).innerText())).toMatch(/^Aucune pièce attendue, aucune question ouverte\./);
    // La remettre : elle revient.
    await p.getByRole('button', { name: 'Les autres gestes de cette conversation' }).click();
    await p.getByRole('menuitem', { name: /^La remettre dans « À traiter »/ }).click();
    await expect.poll(async () => net(await p.locator('.msg-filtres').innerText()), { timeout: 15_000 }).toBe('À traiter 1 Attend le client 0 Tout 1');

    // ── Le dossier tenu, sans SkanFact : dans « Tout », et l'invitation à sa place ───────────────────────────────────
    await p.getByRole('tab', { name: /^Tout/ }).click();
    expect(net(await p.locator('.msg-tenus-t').innerText())).toBe('SANS SKANFACT · 1 DOSSIER TENU');
    await p.locator('.msg-tenu').filter({ hasText: 'Clinique Les Jasmins' }).click();
    await expect.poll(async () => net(await p.locator('.msg-tenu-g h2').innerText().catch(() => ''))).toBe('Clinique Les Jasmins n\'est pas encore sur SkanFact');
    expect(await p.getByRole('button', { name: 'Inviter Clinique Les Jasmins sur SkanFact', exact: true }).isVisible()).toBe(true);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);

  it('(1.179.0) la lecture, le refus qui réessaie, hors ligne, « Demain » et « Traité » sur la ligne, glisser au téléphone, exporter en PDF', async () => {
    const sonia = await personne('Sonia Gharbi');
    const cab = (await api('POST', '/cabinets', sonia, { nom: 'Gharbi Audit' })).corps as { id: string; code: string };
    const hela = await personne('Hela Ben Salah');
    const ent = String((await api('POST', '/entreprises', hela, { raisonSociale: 'Librairie Ennour' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, hela, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, sonia)).statut).toBe(200);
    expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, sonia, { contenu: { contact: 'Hela Ben Salah' }, revision: null })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/messages`, hela, { cote: 'entreprise', texte: 'La facture STEG de septembre, je la retrouve pas.' })).statut).toBe(201);
    expect((await api('POST', `/cabinets/${cab.id}/notes/${ent}`, sonia, { texte: 'Note interne : relancer la STEG nous-mêmes.' })).statut).toBe(201);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, sonia);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossiers`);
    await p.locator('#view h1').first().waitFor({ timeout: 25_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    // La lecture de la boîte, retenue puis refusée (le cabinet s'ouvre d'abord : il lit aussi la boîte pour ses pastilles).
    let mode: 'tenir' | 'refus' | 'passer' = 'tenir';
    let lacher = () => {};
    const tenue = new Promise<void>((ok) => { lacher = ok; });
    await p.route(/\/v1\/cabinets\/[^/]+\/messages$/, async (r) => {
      if (r.request().method() !== 'GET') return r.continue();
      if (mode === 'tenir') await tenue;
      if (mode === 'refus') return r.fulfill({ status: 500, contentType: 'application/json', body: '{"motif":"Le serveur a rencontré une erreur."}' });
      return r.continue();
    });

    // ── La lecture : la page a déjà sa forme ─────────────────────────────────────────────────────────────────────
    await p.evaluate(() => { location.hash = '#/messages'; });
    await p.locator('.msg-sq-w .msg-sq .msg-sq-l').first().waitFor({ timeout: 15_000 });
    expect(net(await p.locator('#msg-phrase').innerText())).toBe('Lecture de tes conversations…');
    expect(await p.locator('.msg-sq .msg-boite-conv .msg-sq-b').count()).toBe(4);
    // ── Le refus : la page figée, ce qui s'est passé, « Réessayer maintenant », de quoi faire en attendant ─────────
    mode = 'refus'; lacher();
    await expect.poll(async () => net(await p.locator('[data-msg-echec]').innerText().catch(() => '')), { timeout: 15_000 })
      .toBe('Tes conversations ne se sont pas lues Le serveur ne les a pas rendues cette fois. Rien n\'est perdu : ce que tes clients ont écrit est gardé sur le serveur, et la boîte réessaie seule toutes les 30 secondes. Réessayer maintenant Ouvrir un dossier en attendant →');
    expect(net(await p.locator('#msg-phrase').innerText())).toBe('Tes conversations ne se sont pas lues.');
    expect(await p.locator('.msg-refus-w .msg-sq.msg-fige').count()).toBe(1);
    mode = 'passer';
    await p.getByRole('button', { name: 'Réessayer maintenant' }).click();
    await p.locator('#page-msg .msg-filtres').waitFor({ timeout: 15_000 });
    await expect.poll(async () => net(await p.locator('#msg-phrase').innerText())).toMatch(/^1 client attend une réponse du cabinet/);

    // ── Hors ligne : la bande, la boîte telle qu'elle était, écrire attend ; le réseau revenu, tout se rouvre ──────
    await p.locator('.msg-tete-integre h2').waitFor({ timeout: 15_000 });
    await cx.setOffline(true);
    await expect.poll(async () => net(await p.locator('[data-msg-hors]').innerText().catch(() => '')), { timeout: 10_000 })
      .toMatch(/^Hors ligne · tes conversations telles qu'elles étaient à \d\d h \d\d ; écrire revient avec le réseau se reconnecte tout seul$/);
    const champ = p.locator('[data-msg-texte]');
    expect([await champ.isDisabled(), await champ.getAttribute('placeholder')]).toEqual([true, 'Écrire revient avec le réseau']);
    expect(await p.locator('#msg-plusieurs').isDisabled()).toBe(true);
    expect(await p.locator('[data-msg-traite]').isDisabled()).toBe(true);
    await cx.setOffline(false);
    await expect.poll(async () => p.locator('[data-msg-hors]').isHidden(), { timeout: 15_000 }).toBe(true);
    expect([await champ.isDisabled(), await champ.getAttribute('placeholder')]).toEqual([false, 'Écrire à Hela…   Entrée envoie, Maj+Entrée va à la ligne']);
    expect(await p.locator('#msg-plusieurs').isDisabled()).toBe(false);

    // ── « Demain » et « Traité » au survol de la ligne ; « Annuler » remet « Demain » ─────────────────────────────
    const ligne = p.locator('.msg-gl').filter({ hasText: 'Librairie Ennour' });
    await ligne.hover();
    await ligne.getByRole('button', { name: 'Demain' }).click();
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => '')), { timeout: 15_000 })
      .toMatch(/^La conversation de Librairie Ennour revient \S+ \d\d\/\d\d : d'ici là, elle quitte ton « À traiter »\. Annuler$/);
    await expect.poll(async () => net(await p.locator('.msg-filtres').innerText())).toBe('À traiter 0 Attend le client 0 Tout 1');
    await p.locator('#toast').getByRole('button', { name: /Annuler/ }).click();
    await expect.poll(async () => net(await p.locator('.msg-filtres').innerText()), { timeout: 15_000 }).toBe('À traiter 1 Attend le client 0 Tout 1');
    await ligne.hover();
    await ligne.getByRole('button', { name: 'Traité' }).click();
    await expect.poll(async () => net(await p.locator('.msg-filtres').innerText()), { timeout: 15_000 }).toBe('À traiter 0 Attend le client 0 Tout 1');

    // ── Exporter la conversation en PDF : tout le fil, par date ; la note pour l'équipe n'y est pas ─────────────────
    let page = '';
    await p.route(/\/v1\/pdf$/, async (r) => {
      const corps = r.request().postDataJSON() as { html: string; nom: string };
      page = corps.html;
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nom: `${corps.nom}.pdf`, pages: 1, pdf: 'JVBERi0xLjQK' }) });
    });
    await p.getByRole('button', { name: 'Les autres gestes de cette conversation' }).click();
    await p.getByRole('menuitem', { name: /^Exporter la conversation \(PDF\)/ }).click();
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => '')), { timeout: 15_000 })
      .toMatch(/^« Conversation Librairie Ennour \d{4}-\d\d-\d\d\.pdf » est dans tes téléchargements : 1 échange, par date\.$/);
    expect(page).toContain('Conversation avec Librairie Ennour');
    expect(page).toContain('La facture STEG de septembre, je la retrouve pas.');
    expect(page).toContain('Hela Ben Salah (client)');
    expect(page).not.toContain('relancer la STEG nous-mêmes');
    expect(erreurs).toEqual([]);
    await cx.close();

    // ── Au téléphone, la ligne glisse et découvre « Demain » et « Traité » ─────────────────────────────────────────
    expect((await api('POST', `/entreprises/${ent}/messages`, hela, { cote: 'entreprise', texte: 'Je l\'ai retrouvée, je vous l\'envoie.' })).statut).toBe(201);
    const ct = await navigateur.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    const t = await ct.newPage();
    const erreursT: string[] = [];
    t.on('pageerror', (e) => erreursT.push(e.message));
    await t.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, sonia);
    await t.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages`);
    await t.locator('#page-msg .msg-filtres').waitFor({ timeout: 25_000 });
    for (let i = 0; i < 3 && await t.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await t.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    const rangee = t.locator('.msg-gl').filter({ hasText: 'Librairie Ennour' });
    expect(await rangee.getByRole('button', { name: 'Traité' }).evaluate((b) => { const r = b.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b || b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(false);
    await rangee.locator('.msg-dossier').evaluate((el) => {
      const b = el.getBoundingClientRect();
      const ev = (type: string, x: number) => el.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: 7, clientX: x, clientY: b.y + 20, bubbles: true }));
      ev('pointerdown', b.x + 300); for (let x = 290; x >= 120; x -= 20) ev('pointermove', b.x + x); ev('pointerup', b.x + 120);
    });
    await expect.poll(async () => rangee.evaluate((g) => g.classList.contains('ouvert'))).toBe(true);
    await t.waitForTimeout(300);
    await rangee.getByRole('button', { name: 'Traité' }).click();
    await expect.poll(async () => net(await t.locator('.msg-filtres').innerText()), { timeout: 15_000 }).toBe('À traiter 0 Attend le client 0 Tout 1');
    expect(erreursT).toEqual([]);
    await ct.close();
  }, 180_000);
});
