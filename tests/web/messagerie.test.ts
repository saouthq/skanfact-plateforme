// La messagerie à la souris (lot messagerie ; docs/messagerie.md ; maquettes « Mon comptable » et « Les messages de tes
// clients »). Amine (Gharbi Informatique SARL) et son comptable, Sonia (Cabinet Ben Youssef). Ce que le parcours
// vérifie, écran ET serveur :
//   - « Mon comptable » paraît dans le menu avec le mandat ; sa pastille compte une question et une pièce demandée UNE
//     fois chacune ; la page dit le cabinet et depuis quand ;
//   - la question de la révision se répond sur place (la pastille et l'encart baissent) ; la pièce demandée s'envoie en
//     photo et se dit reçue ; « Parler d'une pièce » n'envoie que le genre, l'identifiant et le libellé ; un message vide
//     est refusé sous le champ ;
//   - la boîte du cabinet s'ouvre sur ce qui l'attend (« Attend le client » quand rien n'est à traiter), passe le client
//     « À traiter » quand il écrit, avec la pastille du menu ; la conversation signe chaque message de son auteur ;
//     « C'est traité » le sort de « À traiter » ; « Demander une pièce » ouvre la conversation sur le champ de la pièce ;
//   - au téléphone, rien ne déborde.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
// Une vraie photo PNG d'un pixel : le serveur la reconnaît à ses premiers octets.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('la messagerie entre l\'entreprise et son cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-messagerie-'));
  const photo = path.join(dossier, 'facture-steg-aout.png');
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    fs.writeFileSync(photo, PNG);
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  type Corps = Record<string, unknown> & { id?: string; code?: string; mandat?: string; messages?: { texte: string; piece: unknown; demande: unknown; auteur: string; lu: boolean }[] };
  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Corps };
  };
  const personne = async (prefixe: string, nom: string) => {
    const email = `${prefixe}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const page = async (jeton: string, largeur = 1440, hauteur = 900) => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', ...(largeur < 500 ? { isMobile: true, hasTouch: true } : {}) });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    return { p, erreurs };
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const net = (s: string) => s.replace(/\s+/g, ' ').trim();
  const deborde = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  it('Amine et son comptable s\'écrivent : la pastille, la question répondue sur place, la pièce demandée envoyée en photo, la boîte du cabinet', async () => {
    const sonia = await personne('sonia', 'Sonia Ben Youssef');
    const cab = (await api('POST', '/cabinets', sonia, { nom: 'Cabinet Ben Youssef' })).corps;
    const amine = await personne('amine', 'Amine Gharbi');
    const ent = String((await api('POST', '/entreprises', amine, { raisonSociale: 'Gharbi Informatique SARL' })).corps.id);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, amine, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Société Atlas' } },
      { collection: 'documents', cle: 'd1', rang: 0, revision: null, contenu: { id: 'd1', type: 'devis', number: 'DEV-2026-004', status: 'envoyé', clientId: 'c1', date: '2026-10-05',
        lines: [{ id: 'l1', designation: 'Maintenance du parc', qty: 1, unitPrice: 1200, vatRate: 19 }] } },
    ] })).statut).toBe(200);
    // Sans mandat, pas d'entrée « Mon comptable » : ni à l'ouverture, ni une fois le serveur lu, ni sur la page suivante.
    const sans = await page(amine);
    const lue = sans.p.waitForResponse((r) => r.url().includes('/messages/attente'));
    await sans.p.goto(`${serveur.adresse}/v10/?e=${ent}`);
    await sans.p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    expect((await (await lue).json()).cabinet).toBeNull();
    await sans.p.waitForTimeout(500);
    await sans.p.evaluate(() => { location.hash = '#/clients'; });
    await sans.p.locator('#view h1').filter({ hasText: 'Clients' }).waitFor({ timeout: 15_000 });
    expect(await sans.p.locator('nav a[data-route="comptable"]').count()).toBe(0);
    await sans.p.context().close();

    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, amine, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, sonia)).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/questions`, sonia, { periode: '2026-09', compte: '411', piece: 'DEV-2026-004', montant: '1428', objet: 'Paiement',
      texte: 'Ce devis a-t-il été accepté ?', attendu: 'confirmation' })).statut).toBe(201);
    expect((await api('POST', `/entreprises/${ent}/compta/questions/envoyer`, sonia, { annee: 2026 })).corps.envoyees).toBe(1);

    // ── Le cabinet : rien à traiter, la boîte s'ouvre sur ce qui attend le client ; il demande une pièce ──────────
    const c = await page(sonia);
    await c.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages`);
    await c.p.locator('.msg-boite h1').waitFor({ timeout: 20_000 });
    await expect.poll(() => c.p.getByRole('tab', { name: /^Attend le client/ }).getAttribute('aria-selected')).toBe('true');
    expect(net(await c.p.locator('.msg-filtres').innerText())).toBe('À traiter (0) Attend le client (1) Tout (1)');
    expect(await c.p.locator('#nav-messages').isVisible()).toBe(false);
    await c.p.getByRole('button', { name: 'Demander une pièce', exact: true }).click();
    const champPiece = c.p.locator('[data-msg-demande-txt]');
    await expect.poll(() => champPiece.evaluate((e) => e === document.activeElement), { timeout: 15_000 }).toBe(true);
    await champPiece.fill('La facture STEG d\'août');
    await c.p.locator('[data-msg-texte]').fill('Il me manque une pièce pour ta TVA.');
    await c.p.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect.poll(async () => net(await c.p.locator('[data-msg-fil]').innerText()), { timeout: 15_000 }).toMatch(/Pièce demandée · La facture STEG d'août Attendue Reçue autrement/);

    // ── Amine : l'entrée, sa pastille (une question et une pièce, comptées une fois chacune) ──────────────────────
    const a = await page(amine);
    await a.p.goto(`${serveur.adresse}/v10/?e=${ent}`);
    await a.p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(a.p);
    const entree = a.p.locator('nav a[data-route="comptable"]');
    await expect.poll(async () => net(await entree.innerText().catch(() => '')), { timeout: 15_000 }).toBe('Mon comptable 2');
    await entree.click();
    await a.p.locator('.msg-page h1').waitFor({ timeout: 15_000 });
    expect(net(await a.p.locator('.msg-tete').innerText())).toMatch(/Mon comptable Cabinet Ben Youssef tient ta comptabilité depuis le \d\d\/\d\d\/\d{4}$/);
    const attente = a.p.locator('[data-msg-attente]');
    await expect.poll(async () => net(await attente.innerText())).toBe('En attente de toi 1 question sans réponse et 1 pièce demandée de ton cabinet.');
    // Ouvrir le fil le marque lu, pièce demandée comprise (elle ne compte pas parmi les non-lus) : le cabinet voit « Lue ».
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/messages?cote=cabinet`, sonia)).corps.messages ?? [])[0]?.lu, { timeout: 15_000 }).toBe(true);
    await a.p.screenshot({ path: path.join(PHOTOS, 'messagerie-1-mon-comptable.png') });

    // La question, répondue sur place.
    await a.p.locator('[data-msg-q-texte]').fill('Oui, accepté le 7 octobre.');
    await a.p.getByRole('button', { name: 'Envoyer ma réponse', exact: true }).click();
    await expect.poll(async () => net(await attente.innerText()), { timeout: 15_000 }).toBe('En attente de toi 1 pièce demandée de ton cabinet.');
    await expect.poll(async () => net(await entree.innerText())).toBe('Mon comptable 1');
    // La pièce demandée, en photo.
    const [choix] = await Promise.all([a.p.waitForEvent('filechooser'), a.p.getByRole('button', { name: 'Envoyer la pièce…', exact: true }).click()]);
    await choix.setFiles(photo);
    await expect.poll(async () => net(await attente.innerText()), { timeout: 15_000 }).toBe('En attente de toi Rien : aucune question ni pièce demandée n\'attend ta réponse.');
    expect(net(await a.p.locator('[data-msg-fil]').innerText())).toMatch(/Pièce demandée · La facture STEG d'août Reçue/);
    expect(await entree.locator('.nav-count').isVisible()).toBe(false);
    // Un message vide : refusé sous le champ, rien ne part.
    await a.p.getByRole('button', { name: 'Envoyer', exact: true }).click();
    expect(net(await a.p.locator('[data-msg-refus]').innerText())).toBe('Un message vide n\'apprend rien à ton cabinet : écris quelque chose ou joins une photo.');
    // « Parler d'une pièce » : le devis, puis un mot ; Entrée envoie.
    await a.p.getByRole('button', { name: 'Parler d\'une pièce', exact: true }).click();
    await a.p.locator('.msg-fp-ligne').filter({ hasText: 'DEV-2026-004' }).click();
    await a.p.locator('[data-msg-texte]').fill('Et voici le devis.');
    await a.p.locator('[data-msg-texte]').press('Enter');
    await expect.poll(async () => net(await a.p.locator('[data-msg-fil]').innerText()), { timeout: 15_000 }).toMatch(/Et voici le devis\. Devis · DEV-2026-004 · Société Atlas/);
    const lus = (await api('GET', `/entreprises/${ent}/messages?cote=cabinet`, sonia)).corps.messages ?? [];
    expect(lus[0]?.piece).toEqual({ genre: 'devis', id: 'd1', libelle: expect.stringMatching(/^DEV-2026-004 · Société Atlas · /) });
    await a.p.screenshot({ path: path.join(PHOTOS, 'messagerie-2-echanges.png') });
    expect(a.erreurs).toEqual([]);

    // ── Le cabinet : la pastille des Messages, vue d'une autre page ; le client à traiter ; la conversation signée ;
    // « C'est traité » ─────────────────────────────────────────────────────────────────────────────────────────────
    const compteurs = (p: Page) => p.waitForResponse((r) => r.url().endsWith(`/cabinets/${cab.id}/messages`));
    // Le Cabinet rouvert (une page neuve : changer seulement l'adresse après « # » ne recharge rien), au premier plan (un
    // onglet caché ne relit rien : la pastille attend qu'on le regarde).
    await c.p.bringToFront();
    await c.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossiers`);
    let pastille = compteurs(c.p);
    await c.p.reload();
    await pastille;
    await expect.poll(async () => net(await c.p.locator('#nav-messages').innerText().catch(() => ''))).toBe('1');
    await c.p.locator('nav a[data-route="messages"]').click();
    await c.p.locator('.msg-boite h1').waitFor({ timeout: 20_000 });
    await expect.poll(async () => net(await c.p.locator('.msg-filtres').innerText()), { timeout: 15_000 }).toBe('À traiter (1) Attend le client (0) Tout (1)');
    await c.p.getByRole('button', { name: 'Ouvrir la conversation', exact: true }).click();
    await c.p.locator('[data-msg-fil]').waitFor({ timeout: 15_000 });
    await expect.poll(async () => net(await c.p.locator('[data-msg-fil]').innerText()), { timeout: 15_000 }).toMatch(/Amine Gharbi · \d\d:\d\d En réponse à : La facture STEG d'août facture-steg-aout\.png Photo · 1 Ko Ouvrir/);
    expect(net(await c.p.locator('[data-msg-fil]').innerText())).toMatch(/Amine Gharbi · \d\d:\d\d Réponse à la question sur DEV-2026-004 Oui, accepté le 7 octobre\./);
    // Amine a ouvert le fil : sa pièce demandée, qui ne compte pas comme un message non lu, est pourtant lue.
    expect(net(await c.p.locator('[data-msg-fil]').innerText())).toMatch(/Pièce demandée · La facture STEG d'août Reçue Lue/);
    await c.p.screenshot({ path: path.join(PHOTOS, 'messagerie-3-cabinet.png') });
    await c.p.getByRole('button', { name: 'C\'est traité', exact: true }).click();
    await c.p.getByRole('button', { name: /Les messages de tes clients/ }).click();
    await expect.poll(async () => net(await c.p.locator('.msg-filtres').innerText().catch(() => '')), { timeout: 15_000 }).toBe('À traiter (0) Attend le client (0) Tout (1)');
    // Rouvert ailleurs que dans la boîte, la pastille compte ce qui est à traiter : rien, alors qu'un client est en ligne.
    await c.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossiers`);
    pastille = compteurs(c.p);
    await c.p.reload();
    await pastille;
    await c.p.waitForTimeout(300);
    expect(await c.p.locator('#nav-messages').isVisible()).toBe(false);
    expect(c.erreurs).toEqual([]);

    // ── Au téléphone : rien ne déborde ───────────────────────────────────────────────────────────────────────────
    const t = await page(amine, 390, 844);
    await t.p.goto(`${serveur.adresse}/v10/?e=${ent}#/comptable`);
    await t.p.locator('.msg-page h1').waitFor({ timeout: 20_000 });
    await plusTard(t.p);
    expect(await deborde(t.p)).toBe(0);
    const tc = await page(sonia, 390, 844);
    await tc.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages`);
    await tc.p.locator('.msg-boite h1').waitFor({ timeout: 20_000 });
    expect(await deborde(tc.p)).toBe(0);
    expect([...t.erreurs, ...tc.erreurs]).toEqual([]);
  }, 180_000);
});
