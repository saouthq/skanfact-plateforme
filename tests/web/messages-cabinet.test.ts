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
    // (1.181.0) Dans la boîte d'écriture, comme une messagerie : « Message » et « Note », leur nom entier au survol et au
    // lecteur d'écran.
    expect(await ecrire.getByRole('tab').allInnerTexts()).toEqual(['Message', 'Note']);
    expect(await ecrire.getByRole('tab').evaluateAll((l) => l.map((t) => t.getAttribute('aria-label')))).toEqual(['Message à Hela', 'Note pour l\'équipe']);
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

  it('(1.180.0) « Imputer le virement » : la réponse du client propose ses comptes, jamais la banque, et l\'écriture va au brouillard', async () => {
    const leila = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', leila, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const sarra = await personne('Sarra Ben Amor');
    const ent = String((await api('POST', '/entreprises', sarra, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, leila, { contenu: { contact: 'Sarra Ben Amor' }, revision: null })).statut).toBe(200);
    // Un virement reçu le 14/09 que personne ne sait expliquer, au compte d'attente ; la question ; la réponse de Sarra.
    const vir = await api('POST', `/entreprises/${ent}/compta/ecritures`, leila, { date: '2026-09-14', journal: 'BQ', piece: 'VIR 14/09', libelle: 'Virement reçu',
      lignes: [{ compte: '532', debit: '1250,375' }, { compte: '471', credit: '1250,375' }] });
    expect(vir.statut).toBe(201);
    const q = await api('POST', `/entreprises/${ent}/compta/questions`, leila, { periode: '2026-09', compte: '471', ecriture: vir.corps.id, piece: 'VIR 14/09',
      montant: '1250,375', objet: 'Un virement reçu le 14/09', texte: 'À quoi correspond ce virement ?', attendu: 'explication' });
    expect((await api('POST', `/entreprises/${ent}/compta/questions/envoyer`, leila, { annee: 2026 })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/questions/${String(q.corps.id)}/repondre`, sarra, { texte: 'C\'est l\'acompte de la Clinique Les Jasmins pour les gâteaux du 30/09.' })).statut).toBe(200);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.clock.setFixedTime(LE_29);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, leila);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages`);
    await p.locator('#page-msg .msg-filtres').waitFor({ timeout: 25_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await p.getByRole('tab', { name: /^Tout/ }).click();
    await p.locator('.msg-dossier').filter({ hasText: 'Boulangerie El Amal' }).first().click();
    // Sous la réponse de Sarra (signée de son prénom), le geste et ce qu'il fera, lu dans le livre.
    const carte = p.locator('.msg-imp').first();
    await carte.waitFor({ timeout: 15_000 });
    expect(net(await carte.innerText())).toMatch(/^Imputer le virement Voir dans la révision sort les 1\s?250,375 DT du compte 471, au compte que tu choisis$/);
    // La fenêtre : le compte proposé d'après la réponse (un acompte : 419, les avances reçues), déjà dans la case, et le
    // curseur sur le bouton principal (la liste du plan, ouverte d'emblée, couvrait la fenêtre).
    await p.locator('[data-msg-imputer]').click();
    const fen = p.locator('.modal').filter({ has: p.locator('#msg-imputer') });
    await fen.waitFor();
    expect(net(await fen.locator('h2').innerText())).toMatch(/^Imputer le virement · 1\s?250,375 DT$/);
    expect(await fen.locator('[name=compte]').inputValue()).toBe('419');
    expect(net(await fen.locator('#msg-imp-nom').innerText())).toBe('Clients créditeurs (avances reçues)');
    expect(await fen.locator('[data-imp-prop]').allInnerTexts()).toEqual(['419 · Clients créditeurs (avances reçues)', '411 · Clients']);
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('ok');
    expect(await p.locator('.sugg-pop').count()).toBe(0);
    // Chercher « banq » dans le plan ne propose pas la banque : l'argent y est déjà.
    await fen.locator('[name=compte]').fill('');
    await fen.locator('[name=compte]').pressSequentially('banq');
    await p.locator('.sugg-pop').waitFor();
    expect(net(await p.locator('.sugg-pop').innerText())).not.toMatch(/\b5\d\d/);
    await p.keyboard.press('Escape');
    // Un autre compte proposé, d'un clic ; puis « Imputer au brouillard ».
    await fen.locator('[data-imp-prop="411"]').click();
    expect(await fen.locator('[name=compte]').inputValue()).toBe('411');
    expect(await fen.locator('[data-imp-prop="411"]').getAttribute('class')).toContain('on');
    await fen.getByRole('button', { name: 'Imputer au brouillard' }).click();
    await expect.poll(async () => net(await p.locator('.msg-imp.fait').innerText().catch(() => ''))).toMatch(/^Imputée : 1\s?250,375 DT sortis du compte 471, au brouillard/);
    // Dans le livre : une écriture au brouillard, 471 débité, 411 crédité, du montant du livre.
    const ecritures = (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=50`, leila)).corps.ecritures as { piece: string; journal: string; numero: string | null; lignes: { compte: string }[] }[];
    const imp = ecritures.filter((e) => e.journal === 'OD' && e.piece === 'VIR 14/09');
    expect(imp.map((e) => [e.numero, e.lignes.map((l) => l.compte)])).toEqual([[null, ['471', '411']]]);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);

  it('(1.182.0) retrouver les notes, l\'accueil sans conversation, la liste vide qui mène au travail, les modèles en deux colonnes, la pièce demandée en étapes, la page en pleine largeur', async () => {
    const leila = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', leila, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const yasmine = await personne('Yasmine Dridi');
    const ent = String((await api('POST', '/entreprises', yasmine, { raisonSociale: 'Institut Yasmine' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, yasmine, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, leila, { contenu: { contact: 'Yasmine Dridi' }, revision: null })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/messages`, leila, { cote: 'cabinet', texte: '', demande: 'Une photo lisible de IMG_0412.jpg' })).statut).toBe(201);
    expect((await api('POST', `/entreprises/${ent}/messages`, yasmine, { cote: 'entreprise', texte: 'Je la reprends ce soir.' })).statut).toBe(201);
    expect((await api('POST', `/cabinets/${cab.id}/notes/${ent}`, leila, { texte: 'Note : elle envoie toujours le soir, relancer le matin.' })).statut).toBe(201);

    const cx = await navigateur.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.clock.setFixedTime(LE_29);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, leila);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages`);
    await p.locator('#page-msg .msg-filtres').waitFor({ timeout: 25_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    // La page prend toute la largeur : plus de plafond qui la centrait (barre repliée, deux bandes vides).
    expect(await p.locator('.cab-page').first().evaluate((e) => getComputedStyle(e).maxWidth)).toBe('none');
    // Le menu ⋯ de la page : chaque entrée, son nom au-dessus de ce qu'elle fait (ils se chevauchaient).
    await p.locator('#msg-page-menu').click();
    const entree = p.locator('.msg-page-m button').first();
    const [b, sous] = [await entree.locator('.msg-page-m-t > b').boundingBox(), await entree.locator('.msg-page-m-t > span').boundingBox()];
    expect(b && sous && sous.y >= b.y + b.height - 1).toBe(true);
    // Chaque entrée a son icône, comme le menu ⋯ d'une conversation.
    expect(await p.locator('.msg-page-m button .msg-page-m-ic svg').count()).toBe(await p.locator('.msg-page-m button').count());
    await p.keyboard.press('Escape');
    await p.mouse.click(10, 1000);

    // La pièce demandée : ses étapes sur une ligne, sous la carte.
    await expect.poll(async () => net(await p.locator('.msg-tete-integre h2').innerText().catch(() => ''))).toBe('Institut Yasmine');
    const etapes = p.locator('.msg-demande-carte .msg-frise-d li');
    await etapes.first().waitFor();
    const hauts = await etapes.evaluateAll((l) => l.map((x) => Math.round(x.getBoundingClientRect().top)));
    expect(hauts.length).toBe(2);
    expect(new Set(hauts).size).toBe(1);
    // Une ligne d'étapes, pas deux étages (le nom, sa date dessous) : la carte prenait la hauteur d'un message de plus.
    expect((await p.locator('.msg-demande-carte .msg-frise-d').boundingBox())?.height ?? 99).toBeLessThanOrEqual(24);
    expect(net(await p.locator('.msg-demande-carte .msg-frise-d').innerText())).toMatch(/^Demandée \d\d\/\d\d Attendue sans date$/);

    // Les notes de l'équipe : toutes, depuis le menu ⋯ ; une, et le fil l'éclaire.
    await p.getByRole('button', { name: 'Les autres gestes de cette conversation' }).click();
    await p.getByRole('menuitem', { name: /^Les notes de l'équipe \(1\)/ }).click();
    expect(await p.locator('[data-msg-fil]').isHidden()).toBe(true);
    expect(net(await p.locator('.msg-notes-dit').innerText())).toMatch(/^1 note pour l'équipe dans cette conversation : Yasmine ne les voit pas\./);
    await p.locator('[data-msg-trouve-note]').click();
    expect(await p.locator('[data-msg-fil]').isVisible()).toBe(true);
    await expect.poll(() => p.locator('.msg-ligne-note.msg-eclaire').count()).toBe(1);
    // En mode Note, sous la boîte d'écriture : « Voir les 1 note ».
    await p.getByRole('tab', { name: 'Note pour l\'équipe' }).click();
    expect(net(await p.locator('[data-msg-voir-notes]').innerText())).toBe('Voir les 1 note');
    await p.getByRole('tab', { name: 'Message à Yasmine' }).click();

    // Les modèles : vides, trois exemples au texte déjà rempli ; un exemple pris, ce que lira la cliente, en direct.
    await p.getByRole('button', { name: 'Modèles de messages', exact: true }).click();
    const fm = p.getByRole('dialog', { name: 'Modèles de messages' });
    await expect.poll(async () => net(await fm.locator('[data-mo-liste]').innerText())).toMatch(/^Aucun modèle encore\./);
    expect(net(await fm.locator('.msg-mo-ex').first().innerText())).toMatch(/^Pièces du mois Bonjour Institut Yasmine, pour boucler [a-zéû]+ \d{4}, il me manque des pièces\./);
    expect(await fm.locator('[data-mo-apercu]').isHidden()).toBe(true);
    await fm.getByRole('button', { name: 'Bien reçu', exact: true }).click();
    expect(await fm.locator('[data-mo-apercu]').isVisible()).toBe(true);
    expect(await fm.locator('[data-mo-apercu] small').textContent()).toBe('Ce que lira Institut Yasmine');
    expect(await fm.locator('[data-mo-apercu-txt]').textContent()).toBe('Bien reçu, merci Institut Yasmine. Je m\'en occupe.');
    await fm.locator('[data-mo-texte]').fill('Bonjour , ');
    await fm.locator('[data-mo-texte]').evaluate((t: HTMLTextAreaElement) => t.setSelectionRange(8, 8));
    await fm.getByRole('button', { name: '{client}', exact: true }).click();
    expect(await fm.locator('[data-mo-texte]').inputValue()).toBe('Bonjour {client}, ');
    await fm.getByRole('button', { name: 'Fermer', exact: true }).click();
    await fm.getByRole('button', { name: /^Fermer/ }).click();
    expect(await fm.count()).toBe(0);

    // « Attend le client », vide : la carte dit pourquoi c'est une bonne nouvelle, et mène au travail ; au milieu,
    // l'accueil propose la prochaine conversation.
    await p.getByRole('tab', { name: /^Attend le client/ }).click();
    await expect.poll(async () => net(await p.locator('.msg-calme-attend').innerText().catch(() => ''))).toMatch(/^Aucun client ne doit de réponse\./);
    expect(net(await p.locator('.msg-conv-accueil > b').innerText())).toBe('Une conversation attend ta réponse');
    await p.getByRole('button', { name: 'Ouvrir Institut Yasmine', exact: true }).click();
    await expect.poll(async () => net(await p.locator('.msg-tete-integre h2').innerText().catch(() => ''))).toBe('Institut Yasmine');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);

  it('(1.184.0) la promesse nomme la pièce demandée dont parle le client ; « Choisir… » montre la date qu\'on tape', async () => {
    const leila = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', leila, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const fatma = await personne('Fatma Jebali');
    const ent = String((await api('POST', '/entreprises', fatma, { raisonSociale: 'Épicerie Essaada' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, fatma, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, leila, { contenu: { contact: 'Fatma Jebali' }, revision: null })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/messages`, leila, { cote: 'cabinet', texte: 'Il me manque :', demandes: ['La carte d\'identification fiscale', 'Le relevé bancaire d\'octobre'] })).statut).toBe(201);
    expect((await api('POST', `/entreprises/${ent}/messages`, fatma, { cote: 'entreprise', texte: 'Le relevé arrive lundi, promis.' })).statut).toBe(201);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, leila);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages/${ent}`);
    const pop = p.locator('[data-msg-pp]');
    await pop.waitFor({ timeout: 25_000 });
    // Deux pièces attendent ; son message parle du relevé : c'est lui qu'elle promet, pas « ses pièces du mois ».
    expect(await pop.locator('[data-msg-pp-quoi]').inputValue()).toBe('le relevé bancaire d\'octobre');
    // Le champ de date du Cabinet est un texte (sans calendrier) : invisible, il se montre au clic et la date s'y tape.
    const date = pop.locator('[data-msg-pp-date]');
    expect(await date.evaluate((e) => getComputedStyle(e).opacity)).toBe('0');
    await pop.locator('.msg-pp-autre').click();
    await expect.poll(() => date.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
