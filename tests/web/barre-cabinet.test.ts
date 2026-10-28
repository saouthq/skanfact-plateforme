// La barre du Cabinet (maquette « Barre v3 », lot 1 b, 26/10/2026 ; docs/maquettes-appliquees.md), à la souris et au
// clavier. Ce que le parcours vérifie :
//   - la tête : le nom du cabinet, ses initiales sur l'ardoise, combien de dossiers ; son menu donne le code du cabinet ;
//   - « Mon cabinet » : les Priorités (la page d'arrivée), les Pièces reçues, les Échéances, l'Avancement, les Messages,
//     chacun avec son chiffre, le même que la page qui le montre ; « Le cabinet » s'ouvre à côté de la barre ;
//   - le dossier ouvert : sa carte (nom, relié ou tenu), ses entrées qui mènent à SES écrans ; entrer dans un dossier en
//     fait le dossier ouvert ; le changer : la recherche, l'étoile (favori, gardé en haut), Ctrl + chiffre ;
//   - une écriture commencée dans un dossier : changer de dossier le dit, « Rester » garde tout ;
//   - « Créer » écrit dans le dossier ouvert (E, R, D ; O pour l'associé) ;
//   - les Pièces reçues : une pièce envoyée par un client se classe (la boîte et les chiffres se vident), et se remet ;
//   - au téléphone : Priorités, Messages, « + », Échéances, Plus.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('la barre du Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-barre-cab-'));
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
    const email = `${nom.split(' ')[0]}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  // Un cabinet, deux clients sur SkanFact (l'un envoie deux pièces, l'autre écrit), un dossier tenu.
  async function unCabinet() {
    const associe = await personne('Anis Gharbi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const client = async (nom: string, gerant: string) => {
      const j = await personne(gerant);
      const ent = String((await api('POST', '/entreprises', j, { raisonSociale: nom })).corps.id);
      const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, j, { codeCabinet: cab.code })).corps.mandat);
      expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
      return { j, ent };
    };
    const boulangerie = await client('Boulangerie El Amal', 'Sarra Mansour');
    const cafe = await client('Café Dar Zitouna', 'Yassine Zitouni');
    const tenu = String((await api('POST', `/cabinets/${cab.id}/dossiers`, associe, { raisonSociale: 'Menuiserie du Sahel' })).corps.entreprise);
    for (const [nom, texte] of [['facture-farine.png', 'La farine du 12'], ['ticket-agil.png', '']]) {
      const f = await api('POST', `/entreprises/${boulangerie.ent}/messages/fichiers`, boulangerie.j, { cote: 'entreprise', nom, contenu: PNG });
      expect((await api('POST', `/entreprises/${boulangerie.ent}/messages`, boulangerie.j, { cote: 'entreprise', texte, fichier: f.corps.id })).statut).toBe(201);
    }
    expect((await api('POST', `/entreprises/${cafe.ent}/messages`, cafe.j, { cote: 'entreprise', texte: 'Je passe jeudi pour la TVA.' })).statut).toBe(201);
    return { associe, cab, boulangerie, cafe, tenu };
  }
  async function ouvrir(p: Page, cabinet: string, hash: string) {
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}${hash}`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await p.waitForTimeout(600);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
  }
  const lien = (p: Page, nom: string) => p.locator('#nav .nav-quotidien > a.lien').filter({ hasText: nom });

  it('au bureau : la tête et son menu, « Mon cabinet » et ses chiffres, la page d\'arrivée, le dossier ouvert et ses écrans, le changement de dossier, Créer', async () => {
    const { associe, cab, boulangerie, cafe, tenu } = await unCabinet();
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' })).newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    // Sans adresse, le Cabinet s'ouvre sur ses Priorités.
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}`);
    await p.locator('#page-priorites').waitFor({ timeout: 20_000 });
    expect(p.url()).toMatch(/#\/priorites$/);

    // ── (1.166.1) Glisser n'appelle jamais les paquets : ils n'existent pas sur la plateforme (C4) ──
    // Le geste de Skander, le 28/10 : attraper une entrée de la barre et la promener sur la page.
    const voile = p.locator('#drop-veil');
    const entree = p.locator('#nav .nav-quotidien > a.lien[data-route="pieces"]');
    await entree.waitFor();
    const pieces = await entree.boundingBox();
    if (!pieces) throw new Error('l\'entrée « Pièces reçues » ne se voit pas');
    await p.mouse.move(pieces.x + 30, pieces.y + pieces.height / 2);
    await p.mouse.down();
    for (const [x, y] of [[400, 400], [700, 520], [900, 600]] as const) { await p.mouse.move(x, y, { steps: 4 }); expect(await voile.isHidden()).toBe(true); }
    await p.mouse.up();
    // Un fichier glissé puis lâché sur la page : rien ne paraît, et l'application reste où elle est.
    const lache = await p.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['x'], 'avril.skanpack'));
      const ev = (type: string) => { const e = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }); document.querySelector('#view')?.dispatchEvent(e); return e; };
      ev('dragenter');
      const vu = !(document.querySelector('#drop-veil') as HTMLElement).hidden;
      return { vu, retenu: ev('drop').defaultPrevented };
    });
    expect(lache).toEqual({ vu: false, retenu: true });
    expect(p.url()).toMatch(/#\/priorites$/);

    // ── La tête : le cabinet, ses initiales sur l'ardoise, combien de dossiers ──
    expect(await p.locator('#brand-cab').innerText()).toBe('Jlassi Conseil');
    expect(await p.locator('#barre .brand-mark').innerText()).toBe('JC');
    expect(await p.locator('#brand-cab-sous').innerText()).toBe('Cabinet · 3 dossiers');
    await expect.poll(() => p.locator('#b-moi .moi-nom').innerText()).toBe('Anis Gharbi\nAssocié');
    await p.locator('#brand-btn').click();
    const menu = p.locator('.sb-cabinet');
    expect(await menu.locator('.code-cab b').innerText()).toBe(cab.code);
    expect(await menu.getByRole('menuitem').allInnerTexts()).toEqual([
      'Tous les dossiers\n3 dossiers', 'Production\nCe qui avance, dossier par dossier', 'Équipe et dossiers confiés\n1 personne',
      'Modèles de messages\nLes demandes de pièces prêtes', 'Abonnement du cabinet\nRien à régler pour l\'instant', 'Réglages du cabinet']);
    await p.keyboard.press('Escape');
    expect(await menu.count()).toBe(0);

    // ── « Mon cabinet » : cinq pages, chacune son chiffre ; un seul lien par page ──
    expect(await p.locator('#nav .nav-quotidien > a.lien').evaluateAll((l) => l.map((a) => (a as HTMLElement).dataset.route)))
      .toEqual(['priorites', 'pieces', 'echeances', 'production', 'messages']);
    await expect.poll(() => lien(p, 'Pièces reçues').locator('.compte').innerText()).toBe('2');
    await expect.poll(() => lien(p, 'Messages').locator('.compte').innerText()).toBe('2');
    expect(await lien(p, 'Priorités').getAttribute('aria-current')).toBe('page');
    // Les Priorités disent ce qui attend, dossier par dossier, et le geste qui mène où agir.
    const avoir = p.locator('#page-priorites .afaire-ligne');
    await expect.poll(() => avoir.locator('.afaire-txt b').allInnerTexts()).toEqual(expect.arrayContaining(['2 pièces reçues à classer', '1 message du client']));
    expect(await p.locator('#page-priorites [data-chiffre="pieces"] .v').innerText()).toBe('2');
    await avoir.filter({ hasText: '1 message du client' }).getByRole('button', { name: 'Répondre' }).click();
    await expect.poll(() => p.url()).toContain(`#/messages/${cafe.ent}`);
    await p.goBack();
    // « Le cabinet » : un volet à côté de la barre, qui mène au portefeuille.
    await p.locator('#nav .nav-volet[data-famille="Le cabinet"]').click();
    const volet = p.locator('.sb-panneau');
    expect(await volet.locator('.pl-l b').allInnerTexts()).toEqual(['Tous les dossiers', 'Relances', 'Export des écritures', 'Équipe', 'Modèles de messages', 'Réglages']);
    expect((await volet.boundingBox())?.x ?? 0).toBeGreaterThan((await p.locator('#barre').boundingBox())?.width ?? 999);
    await volet.getByRole('link', { name: /Tous les dossiers/ }).click();
    await p.locator('#view tr[data-id]').first().waitFor();
    await p.screenshot({ path: path.join(PHOTOS, 'barre-cabinet-1.png') });

    // ── Le dossier ouvert : entrer dans un dossier en fait le dossier ouvert ; ses entrées mènent à SES écrans ──
    await ouvrir(p, cab.id, `#/dossier/${boulangerie.ent}`);
    const carte = p.locator('#b-dossier');
    expect(await carte.innerText()).toMatch(/^BE\nDossier ouvert · Relié\nBoulangerie El Amal\n/);
    const entrees = p.locator('#nav-dossier > a.lien');
    expect(await entrees.evaluateAll((l) => l.map((a) => [(a as HTMLElement).innerText.split('\n')[0], a.getAttribute('href')]))).toEqual([
      ['Écritures', `#/dossier/${boulangerie.ent}/comptabilite/saisie`], ['Pièces du dossier', `#/pieces/${boulangerie.ent}`],
      ['Banque', `#/dossier/${boulangerie.ent}/comptabilite/banque`], ['Déclarations', `#/dossier/${boulangerie.ent}/comptabilite/declaration`]]);
    expect(await entrees.filter({ hasText: 'Pièces du dossier' }).locator('.compte').innerText()).toBe('2 à classer');
    await entrees.filter({ hasText: 'Banque' }).click();
    await expect.poll(() => entrees.filter({ hasText: 'Banque' }).getAttribute('aria-current')).toBe('page');

    // ── Changer de dossier : la recherche, puis Entrée ; on garde l'écran (la banque) ──
    await carte.click();
    const choix = p.locator('.pop-dossier');
    expect(await choix.locator('[data-aller-dossier] .lib').evaluateAll((l) => l.map((x) => x.childNodes[0]?.textContent)))
      .toEqual(expect.arrayContaining(['Boulangerie El Amal', 'Café Dar Zitouna', 'Menuiserie du Sahel']));
    await p.keyboard.type('sahel');
    expect(await choix.locator('.ligne-d:not([hidden])').count()).toBe(1);
    await p.keyboard.press('Enter');
    await expect.poll(() => p.url()).toContain(`#/dossier/${tenu}/comptabilite/banque`);
    await expect.poll(() => carte.innerText()).toMatch(/Tenu\nMenuiserie du Sahel/);
    // Un dossier tenu ne reçoit pas de pièce demandée : « Créer » ne la propose pas.
    await p.keyboard.press('n');
    expect(await p.locator('.sb-creer [data-touche]').evaluateAll((l) => l.map((x) => (x as HTMLElement).dataset.touche))).toEqual(['E', 'R', 'O']);
    expect(await p.locator('.sb-creer .menu-titre').innerText()).toBe('Créer · Menuiserie du Sahel');
    await p.keyboard.press('Escape');
    // L'étoile garde un dossier en haut : il devient Ctrl 1.
    await carte.click();
    await choix.locator('.ligne-d').filter({ hasText: 'Café Dar Zitouna' }).locator('[data-etoile]').click();
    expect(await choix.locator('.menu-titre').first().innerText()).toBe('Favoris');
    expect(await choix.locator('.ligne-d').first().innerText()).toMatch(/^CD\nCafé Dar Zitouna[\s\S]*Ctrl 1$/);
    await p.keyboard.press('Escape');
    await p.locator('#view').click({ position: { x: 5, y: 5 } });
    await p.keyboard.press('Control+1');
    await expect.poll(() => p.url()).toContain(`#/dossier/${cafe.ent}/comptabilite/banque`);
    // Dans « Créer », un dossier relié propose aussi de demander une pièce, et D l'ouvre. La page de la banque se dessine
    // d'abord (sinon N arrive pendant son dessin), et le volet s'ouvre après la touche : on l'attend, on ne le lit pas une fois.
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.keyboard.press('n');
    await expect.poll(() => p.locator('.sb-creer [data-touche]').evaluateAll((l) => l.map((x) => (x as HTMLElement).dataset.touche)), { timeout: 10_000 }).toEqual(['E', 'R', 'D', 'O']);
    // Sur une machine lente, la page de la banque finit de se dessiner après l'ouverture du volet et le referme : D
    // n'arrive alors à rien (GitHub, 1.152.1 et 1.153.0). On rouvre le volet s'il s'est refermé, puis D.
    await expect.poll(async () => {
      if (!p.url().includes('#/messages/')) {
        if (!(await p.locator('.sb-creer').isVisible())) await p.keyboard.press('n');
        await p.locator('.sb-creer [data-touche="D"]').waitFor({ timeout: 3_000 }).catch(() => {});
        await p.keyboard.press('d');
      }
      return p.url();
    }, { timeout: 20_000 }).toContain(`#/messages/${cafe.ent}/demande`);
    await p.screenshot({ path: path.join(PHOTOS, 'barre-cabinet-2.png') });
    expect(erreurs).toEqual([]);
  });

  it('les pièces reçues : classer vide la boîte et les chiffres, « Annuler » la remet ; une écriture commencée retient avant de changer de dossier', async () => {
    const { associe, cab, boulangerie, cafe } = await unCabinet();
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' })).newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await ouvrir(p, cab.id, '#/pieces');
    const lignes = p.locator('#page-pieces tr[data-piece]');
    await expect.poll(() => lignes.count()).toBe(2);
    expect(await lignes.first().innerText()).toMatch(/ticket-agil\.png\nBoulangerie El Amal · Sarra Mansour/);
    expect(await lignes.last().innerText()).toMatch(/« La farine du 12 »/);
    await lignes.first().getByRole('button', { name: 'Classer' }).click();
    await expect.poll(() => lignes.count()).toBe(1);
    await expect.poll(() => lien(p, 'Pièces reçues').locator('.compte').innerText()).toBe('1');
    // « Annuler » remet la pièce à classer.
    await p.locator('#toast').getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(() => lignes.count()).toBe(2);
    await expect.poll(() => lien(p, 'Pièces reçues').locator('.compte').innerText()).toBe('2');
    // Les deux classées : la boîte le dit, l'onglet « Classées » dit qui et quand.
    await lignes.first().getByRole('button', { name: 'Classer' }).click();
    await expect.poll(() => lignes.count()).toBe(1);
    await lignes.first().getByRole('button', { name: 'Classer' }).click();
    await expect.poll(() => p.locator('#page-pieces .vide-pr b').innerText()).toBe('Rien à classer');
    expect(await lien(p, 'Pièces reçues').locator('.compte').isHidden()).toBe(true);
    await p.getByRole('tab', { name: 'Classées' }).click();
    await expect.poll(() => lignes.count()).toBe(2);
    expect(await lignes.first().innerText()).toMatch(/Classée le \d\d\/\d\d, \d\d:\d\d par Anis Gharbi/);

    // ── Une écriture commencée et pas enregistrée : changer de dossier le dit avant ──
    // (Le livre du dossier a son exercice : une écriture y est déjà.)
    const annee = new Date().getFullYear();
    expect((await api('POST', `/entreprises/${boulangerie.ent}/compta/ecritures`, associe, { date: `${annee}-01-15`, journal: 'OD', piece: 'OD-1', libelle: 'Ouverture',
      lignes: [{ compte: '6226', debit: '100,000' }, { compte: '4286', credit: '100,000' }] })).statut).toBe(201);
    await ouvrir(p, cab.id, `#/dossier/${boulangerie.ent}/comptabilite/saisie/${annee}`);
    const libelle = p.locator('#sa-libelle, [data-champ="libelle"]').first();
    await libelle.waitFor({ timeout: 15_000 });
    await libelle.fill('Farine du Cap Bon');
    await p.locator('#b-dossier').click();
    await p.locator('.pop-dossier .ligne-d').filter({ hasText: 'Café Dar Zitouna' }).locator('[data-aller-dossier]').click();
    const garde = p.locator('#modal-root');
    await expect.poll(() => garde.innerText()).toMatch(/Ton écriture dans Boulangerie El Amal n'est pas enregistrée/);
    await garde.getByRole('button', { name: 'Rester' }).click();
    expect(p.url()).toContain(`#/dossier/${boulangerie.ent}/comptabilite/saisie`);
    expect(await libelle.inputValue()).toBe('Farine du Cap Bon');
    await p.locator('#b-dossier').click();
    await p.locator('.pop-dossier .ligne-d').filter({ hasText: 'Café Dar Zitouna' }).locator('[data-aller-dossier]').click();
    await garde.getByRole('button', { name: 'Passer à Café Dar Zitouna' }).click();
    await expect.poll(() => p.url()).toContain(`#/dossier/${cafe.ent}/comptabilite/saisie/${annee}`);
    expect(erreurs).toEqual([]);
  });

  it('au téléphone : Priorités, Messages, « + », Échéances, Plus ; le dossier ouvert dans « Plus »', async () => {
    const { associe, cab } = await unCabinet();
    const p = await (await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' })).newPage();
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await ouvrir(p, cab.id, '#/priorites');
    const onglets = p.locator('.sb-onglets');
    await expect.poll(() => onglets.locator('.sb-onglet .nom').allInnerTexts()).toEqual(['Priorités', 'Messages', 'Échéances', 'Plus']);
    expect(await onglets.locator('.sb-onglet[aria-current="page"] .nom').innerText()).toBe('Priorités');
    // Rien de la barre du bureau ne reste, sauf le haut.
    expect(await p.locator('#barre .barre-milieu').isVisible()).toBe(false);
    expect(await p.locator('#barre .tete-barre').isVisible()).toBe(true);
    await onglets.locator('[data-tel="creer"]').click();
    expect(await p.locator('.sb-feuille .grille-creer b').allInnerTexts()).toEqual(expect.arrayContaining(['Écriture', 'Importer un relevé', 'Nouveau dossier']));
    await p.locator('.sb-feuille-voile').click({ position: { x: 10, y: 10 } });
    await onglets.locator('[data-tel="plus"]').click();
    const plus = p.locator('.sb-plus');
    expect(await plus.locator('.plus-titre').allInnerTexts()).toEqual(expect.arrayContaining(['Le cabinet', 'Tout le dossier', 'Mon compte']));
    for (const b of await plus.locator('.liste-tel > a, .liste-tel > button').all()) expect((await b.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await p.screenshot({ path: path.join(PHOTOS, 'barre-cabinet-tel.png') });
  });
});
