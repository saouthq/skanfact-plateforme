// La messagerie à la souris (lot messagerie ; docs/messagerie.md ; maquettes « Mon comptable » et « Les messages de tes
// clients »). Amine (Gharbi Informatique SARL) et son comptable, Sonia (Cabinet Ben Youssef). Ce que le parcours
// vérifie, écran ET serveur :
//   - « Mon comptable » paraît dans le pied du menu (qui ne défile jamais) avec le mandat ; sa pastille compte une
//     question et une pièce demandée UNE fois chacune ; la page dit le cabinet et depuis quand ;
//   - la question de la révision se répond sur place (la pastille et l'encart baissent, elle se dit « Répondue ») ; la
//     pièce demandée s'envoie par une fenêtre (la photo vue avant de partir, « Annuler » n'envoie rien) et se dit reçue ;
//     « Parler d'une pièce » n'envoie que le genre, l'identifiant et le libellé ; un message vide est refusé sous le champ ;
//   - la boîte du cabinet s'ouvre sur ce qui l'attend (« Attend le client » quand rien n'est à traiter), la conversation
//     du client à droite de la liste ; elle passe le client « À traiter » quand il écrit, avec la pastille du menu ; la
//     conversation signe chaque message de son auteur ; « Marquer comme traité » le sort de « À traiter » ;
//   - (1.115.0) avec deux clients : ↑ et ↓ passent de l'un à l'autre, le client traité reste sous les yeux, la pastille
//     des non-lus ne se répète pas en « À traiter », « Ouvrir en grand » mène à sa page ; la pièce demandée se répond
//     avec un achat déjà saisi ;
//   - au téléphone, rien ne déborde, « Envoyer » est dans l'écran, et les messages ont leur bouton à côté de « Menu ».

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
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', acceptDownloads: true, ...(largeur < 500 ? { isMobile: true, hasTouch: true } : {}) });
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
    expect(await sans.p.locator('#foot-comptable').isVisible()).toBe(false);
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
    // (1.102.0) Sans nom, la pièce est refusée ; le refus se lève dès qu'on la nomme.
    await c.p.getByRole('button', { name: 'Envoyer', exact: true }).click();
    expect(net(await c.p.locator('[data-msg-refus]').innerText())).toMatch(/^Nomme la pièce que tu demandes/);
    await champPiece.pressSequentially('L');
    expect(await c.p.locator('[data-msg-refus]').innerText()).toBe('');
    await champPiece.fill('La facture STEG d\'août');
    await c.p.locator('[data-msg-texte]').fill('Il me manque une pièce pour ta TVA.');
    await c.p.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect.poll(async () => net(await c.p.locator('[data-msg-fil]').innerText()), { timeout: 15_000 }).toMatch(/Pièce demandée La facture STEG d'août pour le \d\d\/\d\d\/\d{4} Attendue Reçue autrement/);

    // ── Amine : l'entrée, sa pastille (une question et une pièce, comptées une fois chacune) ──────────────────────
    const a = await page(amine);
    await a.p.goto(`${serveur.adresse}/v10/?e=${ent}`);
    await a.p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(a.p);
    // (1.115.0) À l'écran dès l'ouverture : en bas du menu, il fallait le faire défiler. (1.151.0) Avec les pages du jour,
    // dans « Au quotidien » (la barre des maquettes), une seule fois.
    const entree = a.p.locator('#nav .nav-quotidien a[data-route="comptable"]');
    await expect.poll(async () => net(await entree.innerText().catch(() => '')), { timeout: 15_000 }).toBe('Mon comptable 2');
    expect(await a.p.locator('a[data-route="comptable"]').count()).toBe(1);
    expect(await entree.evaluate((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
    // (1.102.0) L'Accueil le dit dans « À faire », du même compte que la pastille (la pastille, au bas d'un menu à faire
    // défiler, en était le seul signe : parcours du 21/10/2026) ; il se relit sans recharger quand ce compte change.
    const aFaire = a.p.locator('#todo-list li', { hasText: 'Ton cabinet attend' });
    await expect.poll(async () => net(await aFaire.innerText().catch(() => '')), { timeout: 15_000 })
      .toMatch(/^Ton cabinet attend 1 pièce et 1 réponse Elle est attendue pour le \d\d\/\d\d\/\d{4}\. Réponds-lui dans « Mon comptable », avec le fichier qu'il attend\. Répondre$/);
    const encore = await api('POST', `/entreprises/${ent}/messages`, sonia, { cote: 'cabinet', texte: '', demande: 'Le contrat de location' });
    expect(encore.statut).toBe(201);
    await a.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(async () => net(await aFaire.innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/^Ton cabinet attend 2 pièces et 1 réponse La première est attendue pour le /);
    expect((await api('POST', `/entreprises/${ent}/messages/${String(encore.corps.id)}/recue`, sonia)).statut).toBe(200);
    await a.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(async () => net(await aFaire.innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/^Ton cabinet attend 1 pièce et 1 réponse /);
    await aFaire.getByRole('button', { name: 'Répondre', exact: true }).click();
    await a.p.locator('.msg-page h1').waitFor({ timeout: 15_000 });
    expect(net(await a.p.locator('.msg-tete').innerText())).toMatch(/Mon comptable Cabinet Ben Youssef tient ta comptabilité depuis le \d\d\/\d\d\/\d{4} Chercher$/);
    const attente = a.p.locator('[data-msg-attente]');
    await expect.poll(async () => net(await attente.innerText())).toBe('En attente de toi 1 question sans réponse et 1 pièce demandée de ton cabinet. Répondre, en commençant par la plus ancienne');
    // Ouvrir le fil le marque lu, pièce demandée comprise (elle ne compte pas parmi les non-lus) : le cabinet voit « Lue ».
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/messages?cote=cabinet`, sonia)).corps.messages ?? [])[0]?.lu, { timeout: 15_000 }).toBe(true);
    await a.p.screenshot({ path: path.join(PHOTOS, 'messagerie-1-mon-comptable.png') });

    // La question, répondue sur place. L'encart y mène : elle est plus haut que les derniers messages, hors de la vue
    // quand la page s'ouvre (parcours du 21/10/2026) ; « Répondre » met le curseur dans sa réponse, la plus ancienne d'abord.
    const reponse = a.p.locator('[data-msg-q-texte]');
    await attente.getByRole('button', { name: 'Répondre, en commençant par la plus ancienne', exact: true }).click();
    await expect.poll(() => reponse.evaluate((e) => e === document.activeElement)).toBe(true);
    await a.p.keyboard.type('Oui, accepté le 7 octobre.');
    await a.p.getByRole('button', { name: 'Envoyer ma réponse', exact: true }).click();
    await expect.poll(async () => net(await attente.innerText()), { timeout: 15_000 }).toBe('En attente de toi 1 pièce demandée de ton cabinet. Répondre');
    // (1.115.0) Répondue, elle le dit (son étiquette disparaissait sans rien à sa place).
    expect(net(await a.p.locator('.msg-question').first().innerText())).toMatch(/Répondue$/);
    // Une pièce demandée qui arrive le fil ouvert, sans aucun autre message à lire : vue ici, elle est dite lue (elle ne
    // compte pas parmi les non-lus ; plus haut, la question non lue suffisait à tout marquer). Reçue, elle s'en va.
    const autre = await api('POST', `/entreprises/${ent}/messages`, sonia, { cote: 'cabinet', texte: '', demande: 'Le relevé de septembre' });
    expect(autre.statut).toBe(201);
    await a.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/messages?cote=cabinet`, sonia)).corps.messages ?? [])
      .find((m) => (m as unknown as { id: string }).id === autre.corps.id)?.lu, { timeout: 15_000 }).toBe(true);
    expect((await api('POST', `/entreprises/${ent}/messages/${String(autre.corps.id)}/recue`, sonia)).statut).toBe(200);
    await a.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(async () => net(await attente.innerText()), { timeout: 15_000 }).toBe('En attente de toi 1 pièce demandée de ton cabinet. Répondre');
    // Une pièce demandée aussi : « Répondre » mène à son bouton.
    await attente.getByRole('button', { name: 'Répondre', exact: true }).click();
    await expect.poll(() => a.p.evaluate(() => document.activeElement?.textContent ?? '')).toBe('Envoyer la pièce…');
    await expect.poll(async () => net(await entree.innerText())).toBe('Mon comptable 1');
    // (1.115.0) La pièce demandée, par une fenêtre : rien ne part avant « Envoyer à mon cabinet » (le fichier partait dès
    // qu'il était choisi) ; « Annuler » ne laisse rien derrière lui.
    const fenetre = a.p.getByRole('dialog', { name: 'Envoyer la pièce demandée' });
    await a.p.getByRole('button', { name: 'Envoyer la pièce…', exact: true }).click();
    await fenetre.getByRole('button', { name: 'Envoyer à mon cabinet', exact: true }).click();
    expect(await fenetre.locator('[data-ep-refus]').innerText()).toBe('Choisis d\'abord la photo ou le PDF de la pièce.');
    let [choix] = await Promise.all([a.p.waitForEvent('filechooser'), fenetre.getByRole('button', { name: 'Choisir la photo ou le PDF…', exact: true }).click()]);
    await choix.setFiles(photo);
    await expect.poll(() => fenetre.locator('.msg-ep-choisi img').count()).toBe(1);
    // (1.116.0) L'aperçu se voit vraiment : la page interdisait les images faites sur place (blob:), l'image restait vide.
    await expect.poll(() => fenetre.locator('.msg-ep-choisi img').evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await fenetre.getByRole('button', { name: 'Annuler', exact: true }).click();
    expect(await fenetre.count()).toBe(0);
    expect(((await api('GET', `/entreprises/${ent}/messages?cote=cabinet`, sonia)).corps.messages ?? []).filter((m) => (m as unknown as { fichier: unknown }).fichier).length).toBe(0);
    await a.p.getByRole('button', { name: 'Envoyer la pièce…', exact: true }).click();
    [choix] = await Promise.all([a.p.waitForEvent('filechooser'), fenetre.getByRole('button', { name: 'Choisir la photo ou le PDF…', exact: true }).click()]);
    await choix.setFiles(photo);
    expect(net(await fenetre.locator('.msg-ep-choisi').innerText())).toBe('facture-steg-aout.png Photo · 1 Ko Changer');
    await fenetre.locator('[data-ep-mot]').fill('La voici.');
    await fenetre.getByRole('button', { name: 'Envoyer à mon cabinet', exact: true }).click();
    await expect.poll(async () => net(await attente.innerText()), { timeout: 15_000 }).toBe('En attente de toi Rien : aucune question ni pièce demandée n\'attend ta réponse.');
    expect(await fenetre.count()).toBe(0);
    expect(net(await a.p.locator('[data-msg-fil]').innerText())).toMatch(/Pièce demandée La facture STEG d'août Reçue/);
    expect(net(await a.p.locator('[data-msg-fil]').innerText())).toMatch(/En réponse à : La facture STEG d'août La voici\. facture-steg-aout\.png Photo · 1 Ko/);
    // La page, devenue assez courte pour tenir sans défiler, garde la place de sa barre : sinon tout son contenu glissait
    // de 15 px vers la droite, sous le curseur, à la dernière réponse (parcours du 21/10/2026).
    const zone = await a.p.evaluate(() => { const m = document.querySelector('main') as HTMLElement; return { court: m.scrollHeight <= m.clientHeight, garde: m.offsetWidth - m.clientWidth }; });
    expect(zone.court).toBe(true);
    expect(zone.garde).toBeGreaterThan(0);
    expect(await entree.locator('.nav-count').isVisible()).toBe(false);
    // Un message vide : refusé sous le champ, rien ne part.
    await a.p.getByRole('button', { name: 'Envoyer', exact: true }).click();
    expect(net(await a.p.locator('[data-msg-refus]').innerText())).toBe('Un message vide n\'apprend rien à ton cabinet : écris quelque chose ou joins une photo.');
    // (1.102.0) Le refus se lève au premier mot tapé (il restait sous le message qu'on écrivait).
    await a.p.locator('[data-msg-texte]').pressSequentially('E');
    expect(await a.p.locator('[data-msg-refus]').innerText()).toBe('');
    await a.p.locator('[data-msg-texte]').fill('');
    // « Parler d'une pièce » : le devis, puis un mot ; Entrée envoie.
    await a.p.getByRole('button', { name: 'Parler d\'une pièce', exact: true }).click();
    await a.p.locator('.msg-fp-ligne').filter({ hasText: 'DEV-2026-004' }).click();
    await a.p.locator('[data-msg-texte]').fill('Et voici le devis.');
    await a.p.locator('[data-msg-texte]').press('Enter');
    await expect.poll(async () => net(await a.p.locator('[data-msg-fil]').innerText()), { timeout: 15_000 }).toMatch(/Et voici le devis\. Devis DEV-2026-004 · Société Atlas/);
    // (1.94.0) La carte garde son « · » avec le genre : la ligne qui passe à la suivante commence par le numéro.
    expect(await a.p.locator('[data-msg-fil] .msg-carte-txt').last().evaluate((n) => [...n.children].map((x) => (x as HTMLElement).innerText.trim().charAt(0)))).toEqual(['D', 'D']);
    // Une photo envoyée avec le devis n'est pas un achat : « Ranger dans mes achats… » ne se propose pas sous elle.
    await a.p.getByRole('button', { name: 'Parler d\'une pièce', exact: true }).click();
    await a.p.locator('.msg-fp-ligne').filter({ hasText: 'DEV-2026-004' }).click();
    const [joindre] = await Promise.all([a.p.waitForEvent('filechooser'), a.p.getByRole('button', { name: 'Joindre une photo ou un PDF', exact: true }).click()]);
    await joindre.setFiles(photo);
    await a.p.locator('[data-msg-texte]').fill('Le devis signé, en photo.');
    await a.p.locator('[data-msg-texte]').press('Enter');
    const derniere = a.p.locator('[data-msg-fil] .msg-ligne').filter({ hasText: 'Le devis signé, en photo.' });
    await expect.poll(() => derniere.locator('.msg-fichier').count(), { timeout: 15_000 }).toBe(1);
    expect(await derniere.locator('[data-msg-ranger]').count()).toBe(0);
    // (1.94.0) « Enregistrer » garde le fichier sous son nom (ouvert dans un onglet, il s'appelait d'un identifiant).
    const [enregistre] = await Promise.all([a.p.waitForEvent('download'), derniere.locator('[data-msg-enregistrer]').click()]);
    expect(enregistre.suggestedFilename()).toBe('facture-steg-aout.png');
    const lus = (await api('GET', `/entreprises/${ent}/messages?cote=cabinet`, sonia)).corps.messages ?? [];
    expect(lus[0]?.piece).toEqual({ genre: 'devis', id: 'd1', libelle: expect.stringMatching(/^DEV-2026-004 · Société Atlas · /) });
    await a.p.screenshot({ path: path.join(PHOTOS, 'messagerie-2-echanges.png') });
    expect(a.erreurs).toEqual([]);

    // ── Le cabinet : la pastille des Messages, vue d'une autre page ; le client à traiter ; la conversation signée, à
    // droite de la liste ; « Marquer comme traité » ─────────────────────────────────────────────────────────────────
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
    // (1.115.0) La conversation du client est déjà là, à droite de la liste : il fallait un aperçu, puis « Ouvrir la
    // conversation », sur une autre page.
    await c.p.locator('.msg-boite [data-msg-fil]').waitFor({ timeout: 15_000 });
    expect(await c.p.getByRole('button', { name: 'Ouvrir la conversation', exact: true }).count()).toBe(0);
    await expect.poll(async () => net(await c.p.locator('[data-msg-fil]').innerText()), { timeout: 15_000 }).toMatch(/Amine Gharbi · \d\d:\d\d En réponse à : La facture STEG d'août La voici\. facture-steg-aout\.png Photo · 1 Ko Ouvrir/);
    expect(net(await c.p.locator('[data-msg-fil]').innerText())).toMatch(/Amine Gharbi · \d\d:\d\d Réponse à la question « Paiement » sur DEV-2026-004 Oui, accepté le 7 octobre\./);
    // Amine a ouvert le fil : sa pièce demandée, qui ne compte pas comme un message non lu, est pourtant lue.
    expect(net(await c.p.locator('[data-msg-fil]').innerText())).toMatch(/Pièce demandée La facture STEG d'août Reçue Lue/);
    // (1.102.0) Ce qui attend le client se dit sans affirmer ce qu'on ne sait pas (« ce client a répondu à tes questions »
    // s'affichait aussi sur un fil où rien n'avait jamais été demandé).
    expect(net(await c.p.locator('[data-msg-cote]').innerText())).toMatch(/^Rien : aucune question ni pièce demandée n'attend sa réponse\./);
    await c.p.screenshot({ path: path.join(PHOTOS, 'messagerie-3-cabinet.png') });
    // (1.116.0) La photo du client s'ouvre dans un onglet où elle se voit (il restait vide : la page interdisait blob:).
    const [onglet] = await Promise.all([c.p.waitForEvent('popup'), c.p.locator('[data-msg-fil] [data-msg-fichier]').first().click()]);
    await expect.poll(() => onglet.evaluate(() => (document.querySelector('img') as HTMLImageElement | null)?.naturalWidth ?? 0), { timeout: 15_000 }).toBeGreaterThan(0);
    await onglet.close();
    // (1.115.0) « Marquer comme traité » dit ce que fait le geste (« Rien à faire ? » et un petit « C'est traité »).
    await c.p.getByRole('button', { name: 'Marquer comme traité', exact: true }).click();
    // Enregistré avant de changer d'écran (sur une machine lente, la boîte se relisait avant : « À traiter (1) »).
    await expect.poll(async () => (await c.p.locator('#toast').textContent()) ?? '', { timeout: 15_000 }).toMatch(/^C'est noté/);
    // (1.98.0) Plus rien à traiter : le bouton ne se propose plus (il promettait de sortir de « À traiter » un client qui
    // n'y était plus, après une réponse du cabinet : parcours du 21/10/2026). Le lien vers la révision reste.
    await expect.poll(() => c.p.getByRole('button', { name: 'Marquer comme traité', exact: true }).count(), { timeout: 15_000 }).toBe(0);
    expect(await c.p.locator('[data-msg-revision]').count()).toBe(1);
    // La liste se relit d'elle-même, et le client reste sous les yeux, choisi, même hors de « À traiter ».
    await expect.poll(async () => net(await c.p.locator('.msg-filtres').innerText().catch(() => '')), { timeout: 15_000 }).toBe('À traiter (0) Attend le client (0) Tout (1)');
    expect(await c.p.locator('.msg-dossier.choisi').count()).toBe(1);
    // Rouvert ailleurs que dans la boîte, la pastille compte ce qui est à traiter : rien, alors qu'un client est en ligne.
    await c.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossiers`);
    pastille = compteurs(c.p);
    await c.p.reload();
    await pastille;
    await c.p.waitForTimeout(300);
    expect(await c.p.locator('#nav-messages').isVisible()).toBe(false);
    // (1.116.0) « Saisir cette pièce » : la photo s'ouvre dans un onglet, la saisie du client à l'année du message.
    await c.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages/${ent}`);
    const saisir = c.p.locator('[data-msg-fil] .msg-fichier').filter({ hasText: 'facture-steg-aout.png' }).getByRole('button', { name: 'Saisir cette pièce', exact: true }).first();
    await saisir.waitFor({ timeout: 20_000 });
    const [photoSaisie] = await Promise.all([c.p.waitForEvent('popup'), saisir.click()]);
    await photoSaisie.close();
    await expect.poll(() => c.p.url(), { timeout: 15_000 }).toMatch(new RegExp(`#/dossier/${ent}/comptabilite/saisie/\\d{4}$`));
    expect(await c.p.locator('#toast').textContent()).toMatch(/^La photo s'ouvre dans un autre onglet/);
    expect(c.erreurs).toEqual([]);

    // ── Au téléphone : rien ne déborde ───────────────────────────────────────────────────────────────────────────
    const t = await page(amine, 390, 844);
    await t.p.goto(`${serveur.adresse}/v10/?e=${ent}#/comptable`);
    await t.p.locator('.msg-page h1').waitFor({ timeout: 20_000 });
    await plusTard(t.p);
    expect(await deborde(t.p)).toBe(0);
    // (1.115.0) « Envoyer » dans l'écran, sans défiler (il fallait descendre sous toute la conversation pour écrire), et
    // au-dessus des onglets du bas (maquette « Barre v3 »).
    expect(await t.p.getByRole('button', { name: 'Envoyer', exact: true }).evaluate((e) => e.getBoundingClientRect().bottom <= innerHeight - 84)).toBe(true);
    // (maquette « Barre v3 ») Ce qui attend du cabinet se compte sur la cloche du haut, et « Mon comptable » est dans
    // « Plus » (les onglets du bas).
    const cloche = t.p.locator('#b-cloche');
    expect(await cloche.isVisible()).toBe(true);
    expect(await cloche.getAttribute('aria-label')).toMatch(/^Nouvelles/);
    await t.p.locator('.sb-onglets [data-tel="plus"]').click();
    expect(await t.p.locator('.sb-plus a[href="#/comptable"]').innerText().then((x) => x.replace(/\s+/g, ' ').trim())).toMatch(/^Mon comptable/);
    await t.p.locator('.sb-onglets [data-tel="plus"]').click();
    const tc = await page(sonia, 390, 844);
    await tc.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages`);
    await tc.p.locator('.msg-boite h1').waitFor({ timeout: 20_000 });
    expect(await deborde(tc.p)).toBe(0);
    // Au téléphone, une ligne ouvre la conversation sur sa page (deux colonnes n'y tiennent pas).
    expect(await tc.p.locator('[data-conv]').count()).toBe(0);
    await tc.p.locator('.msg-dossier').first().click();
    await tc.p.locator('[data-msg-fil]').waitFor({ timeout: 15_000 });
    expect(tc.p.url()).toContain(`#/messages/${ent}`);
    expect(await tc.p.getByRole('button', { name: 'Envoyer', exact: true }).evaluate((e) => e.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    expect(await deborde(tc.p)).toBe(0);
    expect([...t.erreurs, ...tc.erreurs]).toEqual([]);

    // (1.134.0) Sans réseau, « Mon comptable » garde son titre et le dit avec les mots du bandeau « Hors ligne » ; le réseau
    // revenu, la conversation se rouvre seule, sans attendre la relecture des trente secondes.
    const h = await page(amine);
    await h.p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await h.p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(h.p);
    await h.p.context().setOffline(true);
    await h.p.evaluate(() => { location.hash = '#/comptable'; });
    await expect.poll(() => h.p.locator('[data-msg-echec]').innerText().then(net).catch(() => ''), { timeout: 15_000 })
      .toBe('Pas de réseau : la messagerie attend la connexion. Elle s\'ouvre toute seule dès que le réseau revient. Réessayer');
    expect(await h.p.locator('.msg-page h1').innerText()).toBe('Mon comptable');
    await h.p.context().setOffline(false);
    await h.p.locator('[data-msg-fil]').waitFor({ timeout: 8_000 });
    expect(h.erreurs).toEqual([]);
    // Au Cabinet, sur l'ordinateur d'un autre (rien ne se garde sur le poste) : la boîte et une page du serveur disent qu'il
    // n'y a pas de réseau, plus « le serveur ne répond pas » ; le réseau revenu, la boîte se rouvre seule.
    const hc = await page(sonia);
    await hc.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossiers`);
    await hc.p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(hc.p);
    await hc.p.context().setOffline(true);
    await hc.p.evaluate(() => { location.hash = '#/production'; });
    await expect.poll(() => hc.p.locator('#view').innerText().then(net).catch(() => ''), { timeout: 15_000 }).toContain('Pas de réseau pour lire cette page : réessaie quand la connexion revient.');
    await hc.p.evaluate(() => { location.hash = '#/messages'; });
    await expect.poll(() => hc.p.locator('[data-msg-echec]').innerText().then(net).catch(() => ''), { timeout: 15_000 })
      .toBe('Pas de réseau : la boîte attend la connexion. Elle s\'ouvre toute seule dès que le réseau revient. Réessayer');
    await hc.p.context().setOffline(false);
    await hc.p.locator('.msg-boite h1').waitFor({ timeout: 8_000 });
    expect(hc.erreurs).toEqual([]);
  }, 180_000);

  it('(1.115.0) la boîte de deux clients : le clavier, le client traité qui reste, une pastille sans écho, « Ouvrir en grand », la pièce demandée répondue par un achat saisi', async () => {
    const sonia = await personne('sonia2', 'Sonia Ben Youssef');
    const cab = (await api('POST', '/cabinets', sonia, { nom: 'Cabinet Ben Youssef' })).corps;
    const relier = async (prefixe: string, nom: string, raison: string) => {
      const j = await personne(prefixe, nom);
      const e = String((await api('POST', '/entreprises', j, { raisonSociale: raison })).corps.id);
      const m = String((await api('POST', `/entreprises/${e}/mandat`, j, { codeCabinet: cab.code })).corps.mandat);
      expect((await api('POST', `/cabinets/${cab.id}/mandats/${m}/accepter`, sonia)).statut).toBe(200);
      return { j, e };
    };
    const amine = await relier('amine2', 'Amine Gharbi', 'Gharbi Informatique SARL');
    const leila = await relier('leila2', 'Leïla Mansour', 'Boulangerie du Lac');
    // L'achat que le cabinet va demander est déjà saisi chez Amine.
    expect((await api('POST', `/entreprises/${amine.e}/dossier-v10`, amine.j, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Société Atlas' } },
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'STEG' } },
      { collection: 'purchases', cle: 'p1', rang: 0, revision: null, contenu: { id: 'p1', kind: 'facture', number: 'F-8841', date: '2026-10-10', supplierId: 's1', currency: 'DT', category: 'Électricité', fees: 0, withholdingRate: 0, createdAt: 1,
        lines: [{ id: 'pl1', label: 'Électricité septembre', qty: 1, unitPrice: { '~n': '85.4' }, vatRate: 19, destination: 'charge' }] } },
    ] })).statut).toBe(200);
    // Une conversation plus haute que l'écran : le fil défile en lui-même, la boîte ne déborde pas.
    for (let i = 1; i <= 8; i++) {
      expect((await api('POST', `/entreprises/${leila.e}/messages`, leila.j, { cote: 'entreprise', texte: `Question ${i} : la caisse du ${i} octobre ne tombe pas juste, faut-il la corriger avant la déclaration ?` })).statut).toBe(201);
    }
    expect((await api('POST', `/entreprises/${leila.e}/messages`, leila.j, { cote: 'entreprise', texte: 'Quand dois-je déposer la TVA ?' })).statut).toBe(201);
    expect((await api('POST', `/entreprises/${amine.e}/messages`, amine.j, { cote: 'entreprise', texte: 'Bonjour, les pièces arrivent.' })).statut).toBe(201);
    const demande = await api('POST', `/entreprises/${amine.e}/messages`, sonia, { cote: 'cabinet', texte: '', demande: 'La facture STEG d\'août' });
    expect(demande.statut).toBe(201);
    expect((await api('POST', `/entreprises/${amine.e}/messages`, amine.j, { cote: 'entreprise', texte: 'Je regarde.' })).statut).toBe(201);

    const c = await page(sonia);
    await c.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages`);
    await c.p.locator('.msg-boite [data-msg-fil]').waitFor({ timeout: 20_000 });
    await expect.poll(async () => net(await c.p.locator('.msg-filtres').innerText())).toBe('À traiter (2) Attend le client (0) Tout (2)');
    const ligne = (nom: string) => c.p.locator('.msg-dossier').filter({ hasText: nom });
    // Le premier client s'ouvre à droite ; l'autre attend, sa pastille de non-lus seule : elle dit déjà « À traiter »,
    // l'étiquette ne la répète pas.
    const premier = net(await c.p.locator('.msg-dossier').first().innerText());
    const [nomPremier, nomSecond] = premier.startsWith('Boulangerie') ? ['Boulangerie du Lac', 'Gharbi Informatique SARL'] : ['Gharbi Informatique SARL', 'Boulangerie du Lac'];
    expect(await ligne(nomPremier).getAttribute('aria-current')).toBe('true');
    expect(await ligne(nomSecond).locator('.msg-non-lus').count()).toBe(1);
    expect(await ligne(nomSecond).locator('.msg-etat-pastille').count()).toBe(0);
    // ↓ passe au client suivant, sa conversation s'ouvre à droite (et se lit : sa pastille s'en va, l'étiquette revient).
    await ligne(nomPremier).focus();
    await c.p.keyboard.press('ArrowDown');
    await expect.poll(async () => net(await c.p.locator('.msg-tete-integre h2').innerText())).toBe(nomSecond);
    expect(await ligne(nomSecond).evaluate((e) => e === document.activeElement && e.classList.contains('choisi'))).toBe(true);
    await c.p.keyboard.press('ArrowUp');
    await expect.poll(async () => net(await c.p.locator('.msg-tete-integre h2').innerText())).toBe(nomPremier);
    await expect.poll(() => ligne(nomSecond).locator('.msg-non-lus').count(), { timeout: 15_000 }).toBe(0);
    await ligne('Boulangerie du Lac').click();
    await expect.poll(async () => net(await c.p.locator('.msg-tete-integre h2').innerText())).toBe('Boulangerie du Lac');
    expect(net(await ligne('Boulangerie du Lac').locator('.msg-etat-pastille').innerText())).toBe('À traiter');
    // Traité : il quitte « À traiter », mais reste dans la liste, choisi, tant qu'on le lit.
    await c.p.getByRole('button', { name: 'Marquer comme traité', exact: true }).click();
    await expect.poll(async () => net(await c.p.locator('.msg-filtres').innerText()), { timeout: 15_000 }).toBe('À traiter (1) Attend le client (0) Tout (2)');
    expect(await ligne('Boulangerie du Lac').getAttribute('aria-current')).toBe('true');
    expect(net(await ligne('Boulangerie du Lac').locator('.msg-etat-pastille').innerText())).toBe('Rien à faire');
    // Le fil prend la hauteur : la boîte tient dans l'écran, « Envoyer » compris.
    expect(await c.p.evaluate(() => { const m = document.querySelector('main') as HTMLElement; return m.scrollHeight <= m.clientHeight; })).toBe(true);
    expect(await c.p.getByRole('button', { name: 'Envoyer', exact: true }).evaluate((e) => e.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    // « Ouvrir en grand » : la conversation sur sa page.
    await c.p.getByRole('button', { name: 'Ouvrir en grand', exact: true }).click();
    await expect.poll(() => c.p.url()).toContain(`#/messages/${leila.e}`);
    await c.p.locator('.msg-retour').waitFor({ timeout: 15_000 });
    // (1.116.0) Demander à plusieurs clients : les mêmes pièces, la même date (dans sept jours), chacun dans son fil.
    await c.p.locator('.msg-retour').click();
    await c.p.locator('.msg-boite [data-msg-fil]').waitFor({ timeout: 15_000 });
    await c.p.getByRole('button', { name: 'Demander à plusieurs clients…', exact: true }).click();
    const dg = c.p.getByRole('dialog', { name: 'Demander des pièces à plusieurs clients' });
    await dg.locator('[data-dg-piece]').fill('Le relevé bancaire de septembre');
    await dg.getByRole('button', { name: '+ Une autre pièce', exact: true }).click();
    await c.p.keyboard.type('La facture Ooredoo de septembre');
    await dg.getByRole('button', { name: 'Envoyer la demande', exact: true }).click();
    expect(await dg.locator('[data-dg-refus]').innerText()).toBe('Coche au moins un client.');
    await dg.getByRole('button', { name: 'Tous', exact: true }).click();
    await dg.getByRole('button', { name: 'Envoyer la demande', exact: true }).click();
    await expect.poll(() => dg.count(), { timeout: 15_000 }).toBe(0);
    const dans7 = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Tunis' });
    for (const x of [amine, leila]) {
      const d = ((await api('GET', `/entreprises/${x.e}/messages?cote=entreprise`, x.j)).corps.messages ?? []) as unknown as { demande: { texte: string; pour: string } | null }[];
      expect(d.filter((m) => m.demande?.pour === dans7).map((m) => m.demande?.texte).sort()).toEqual(['La facture Ooredoo de septembre', 'Le relevé bancaire de septembre']);
    }
    // La conversation ouverte les montre aussitôt.
    await expect.poll(async () => net(await c.p.locator('.msg-boite [data-msg-fil]').innerText()), { timeout: 15_000 }).toContain(`La facture Ooredoo de septembre pour le ${dans7.slice(8, 10)}/${dans7.slice(5, 7)}/${dans7.slice(0, 4)}`);
    expect(c.erreurs).toEqual([]);

    // Amine répond à la pièce demandée avec l'achat déjà saisi : la demande est reçue, la pièce citée.
    const a = await page(amine.j);
    await a.p.goto(`${serveur.adresse}/v10/?e=${amine.e}`);
    await a.p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(a.p);
    await a.p.locator('#nav a[data-route="comptable"]').click({ timeout: 15_000 });
    await a.p.locator('.msg-page h1').waitFor({ timeout: 20_000 });
    // (1.140.0) Un seul vert : plusieurs pièces attendent, seule la plus ancienne porte « Envoyer la pièce… » en vert.
    const envois = a.p.locator('[data-msg-envoyer-piece]');
    await expect.poll(() => envois.count(), { timeout: 15_000 }).toBeGreaterThan(1);
    expect(await envois.evaluateAll((b) => b.filter((x) => x.classList.contains('btn-primary')).length)).toBe(1);
    expect(await envois.first().evaluate((x) => x.classList.contains('btn-primary'))).toBe(true);
    const fenetre = a.p.getByRole('dialog', { name: 'Envoyer la pièce demandée' });
    await a.p.locator('.msg-demande-carte').filter({ hasText: 'La facture STEG d\'août' }).getByRole('button', { name: 'Envoyer la pièce…', exact: true }).click();
    await fenetre.getByText('Elle est déjà dans SkanFact').click();
    await fenetre.getByRole('button', { name: 'Envoyer à mon cabinet', exact: true }).click();
    expect(await fenetre.locator('[data-ep-refus]').innerText()).toBe('Choisis la pièce de ton dossier qui répond à la demande.');
    await fenetre.locator('.msg-fp-chercher').fill('steg');
    expect(net(await fenetre.locator('.msg-fp-liste').innerText())).toMatch(/^Achat F-8841 · STEG · 101,626 DT 10\/10\/2026$/);
    await fenetre.locator('.msg-fp-ligne').click();
    expect(await fenetre.locator('.msg-fp-ligne').getAttribute('aria-selected')).toBe('true');
    await fenetre.getByRole('button', { name: 'Envoyer à mon cabinet', exact: true }).click();
    await expect.poll(() => fenetre.count(), { timeout: 15_000 }).toBe(0);
    await expect.poll(async () => net(await a.p.locator('[data-msg-fil]').innerText()), { timeout: 15_000 }).toMatch(/Pièce demandée La facture STEG d'août Reçue/);
    const lus = (await api('GET', `/entreprises/${amine.e}/messages?cote=cabinet`, sonia)).corps.messages ?? [];
    const envoi = lus.find((m) => (m as unknown as { repondA: string }).repondA === demande.corps.id) as unknown as { piece: unknown; fichier: unknown } | undefined;
    expect(envoi?.piece).toEqual({ genre: 'achat', id: 'p1', libelle: expect.stringMatching(/^F-8841 · STEG · 101,626\s+DT$/) });
    expect(envoi?.fichier).toBeNull();
    expect(a.erreurs).toEqual([]);
    // (1.116.0) Chez le cabinet, « Ouvrir » mène l'achat cité aux livres du client : son numéro cherché au livre-journal.
    await c.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages/${amine.e}`);
    const carte = c.p.locator('[data-msg-fil] .msg-carte').filter({ hasText: 'F-8841' });
    await carte.getByRole('button', { name: 'Ouvrir', exact: true }).click({ timeout: 20_000 });
    await expect.poll(() => c.p.url(), { timeout: 15_000 }).toContain(`#/dossier/${amine.e}/comptabilite/journal`);
    await expect.poll(() => c.p.locator('#lv-q').inputValue(), { timeout: 15_000 }).toBe('F-8841');

    // (1.117.0) La liste des dossiers : la ligne d'un client « À traiter » porte la pastille de ses messages (Amine vient
    // de répondre), autant de lignes que le chiffre du menu ; elle mène à la conversation, pas à la fiche.
    await c.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossiers`);
    await c.p.locator(`tr[data-id="${amine.e}"]`).waitFor({ timeout: 20_000 });
    await expect.poll(() => c.p.locator(`tr[data-id="${amine.e}"] .dl-msg`).count(), { timeout: 15_000 }).toBe(1);
    expect(await c.p.locator(`tr[data-id="${leila.e}"] .dl-msg`).count()).toBe(0);
    await expect.poll(async () => (await c.p.locator('#nav-messages').textContent()) ?? '').toBe(String(await c.p.locator('tr[data-id] .dl-msg').count()));
    await c.p.locator(`tr[data-id="${amine.e}"] .dl-msg`).click();
    await expect.poll(() => c.p.url()).toContain(`#/messages/${amine.e}`);
    await c.p.locator('[data-msg-fil]').waitFor({ timeout: 15_000 });

    // (1.117.0) Chercher dans le fil : « steg » trouve la pièce demandée (sans les majuscules), le mot surligné ; choisie,
    // elle se montre dans le fil, éclairée.
    await c.p.getByRole('button', { name: 'Chercher', exact: true }).click();
    const champQ = c.p.getByRole('searchbox', { name: 'Chercher dans ces messages' });
    await expect.poll(() => champQ.evaluate((e) => e === document.activeElement)).toBe(true);
    await champQ.fill('s');
    await expect.poll(async () => net(await c.p.locator('[data-msg-trouves]').innerText())).toBe('Encore une lettre : la recherche commence à deux.');
    await champQ.fill('steg');
    const trouve = c.p.locator('[data-msg-trouve]').filter({ hasText: 'Pièce demandée : La facture STEG d\'août' });
    await trouve.waitFor({ timeout: 15_000 });
    expect(await trouve.locator('mark').innerText()).toBe('STEG');
    expect(await c.p.locator('[data-msg-fil]').isVisible()).toBe(false);
    await trouve.click();
    await expect.poll(() => c.p.locator('[data-msg-fil]').isVisible()).toBe(true);
    expect(await c.p.locator('[data-msg-trouves]').isVisible()).toBe(false);
    await expect.poll(() => c.p.locator(`[data-msg-id="${String(demande.corps.id)}"].msg-eclaire`).count()).toBe(1);
    await champQ.waitFor({ state: 'hidden' });

    // (1.117.0) Les modèles : le premier se crée d'un exemple ; « Utiliser » le pose dans le champ, {client} et {mois}
    // remplacés ; une saisie commencée ne se jette pas sans le dire.
    const texteCab = c.p.locator('[data-msg-texte]');
    await c.p.getByRole('button', { name: 'Modèles de messages', exact: true }).click();
    const fm = c.p.getByRole('dialog', { name: 'Modèles de messages' });
    await expect.poll(async () => net(await fm.locator('[data-mo-liste]').innerText())).toMatch(/^Aucun modèle encore\./);
    await fm.getByRole('button', { name: 'Pièces du mois', exact: true }).click();
    await fm.getByRole('button', { name: 'Ajouter le modèle', exact: true }).click();
    const utiliser = fm.getByRole('button', { name: 'Utiliser', exact: true });
    await utiliser.waitFor({ timeout: 15_000 });
    await utiliser.click();
    expect(await fm.count()).toBe(0);
    const pose = await texteCab.inputValue();
    expect(pose).toMatch(/^Bonjour Gharbi Informatique SARL, pour boucler [a-zéû]+ \d{4}, il me manque des pièces\./);
    expect(pose).not.toContain('{');
    expect(await texteCab.evaluate((e) => e === document.activeElement)).toBe(true);
    expect(((await api('GET', `/cabinets/${cab.id}/messages/modeles`, sonia)).corps.modeles as { titre: string }[]).map((m) => m.titre)).toEqual(['Pièces du mois']);
    await c.p.getByRole('button', { name: 'Modèles de messages', exact: true }).click();
    await fm.locator('[data-mo-titre]').fill('Brouillon');
    await c.p.keyboard.press('Escape');
    expect(net(await fm.locator('[data-mo-refus]').innerText())).toMatch(/^Ce modèle n'est pas enregistré/);
    await c.p.keyboard.press('Escape');
    expect(await fm.count()).toBe(0);

    // (1.117.0) Chercher un client dans la boîte, quel que soit le filtre.
    await c.p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages`);
    const qClient = c.p.getByRole('searchbox', { name: 'Chercher un client' });
    await qClient.waitFor({ timeout: 20_000 });
    await qClient.fill('BOUL');
    await expect.poll(async () => c.p.locator('.msg-dossier-l1 b').allInnerTexts()).toEqual(['Boulangerie du Lac']);
    await qClient.fill('zzz');
    await expect.poll(async () => net(await c.p.locator('[data-liste]').innerText())).toMatch(/^Aucun client ne s'appelle « zzz »\./);
    expect(c.erreurs).toEqual([]);
  }, 180_000);
});
