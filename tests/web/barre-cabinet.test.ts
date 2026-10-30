// La barre du Cabinet (maquette « Barre v3 », lot 1 b, 26/10/2026 ; docs/maquettes-appliquees.md), à la souris et au
// clavier. Ce que le parcours vérifie :
//   - la tête : le nom du cabinet, ses initiales sur l'ardoise, combien de dossiers ; son menu donne le code du cabinet ;
//   - « Mon cabinet » : les Priorités (la page d'arrivée), les Pièces reçues, les Échéances, le Tableau de bord, les Messages,
//     chacun avec son chiffre, le même que la page qui le montre ; « Le cabinet » s'ouvre à côté de la barre ;
//   - le dossier ouvert : sa carte (nom, relié ou tenu), ses entrées qui mènent à SES écrans ; entrer dans un dossier en
//     fait le dossier ouvert ; le changer : la recherche, l'étoile (favori, gardé en haut), Ctrl + chiffre ;
//   - une écriture commencée dans un dossier : changer de dossier le dit, « Rester » garde tout ;
//   - « Créer » écrit dans le dossier ouvert (E, R, D ; O pour l'associé) ;
//   - les Pièces reçues : une pièce envoyée par un client se classe (la boîte et les chiffres se vident), et se remet ;
//     en double (laquelle), déjà saisie (où), plusieurs d'un coup, l'achat que le client saisit lui-même, sans réseau ;
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
    // La barre se redessine quand ses chiffres arrivent : l'entrée d'avant peut quitter la page entre deux lectures.
    let pieces = null;
    for (let i = 0; i < 20 && !pieces; i++) { await entree.waitFor(); pieces = await entree.boundingBox(); if (!pieces) await p.waitForTimeout(100); }
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
    await expect.poll(() => p.locator('#b-moi .moi-nom').innerText()).toBe('Anis Gharbi\nDirection');
    await p.locator('#brand-btn').click();
    const menu = p.locator('.sb-cabinet');
    expect(await menu.locator('.code-cab b').innerText()).toBe(cab.code);
    expect(await menu.getByRole('menuitem').allInnerTexts()).toEqual([
      'Tous les dossiers\n3 dossiers', 'Tableau de bord\nOù en est le cabinet, dossier par dossier', 'Équipe et dossiers confiés\n1 personne',
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
    // (1.188.0) « Demander une pièce » s'ouvre sur place, la fenêtre commune ; « Écrire plutôt dans la conversation » y mène.
    const demande = p.locator('#modal-root .modal').filter({ has: p.locator('#dm-piece') });
    await expect.poll(async () => {
      if (!(await demande.count())) {
        if (!(await p.locator('.sb-creer').isVisible())) await p.keyboard.press('n');
        await p.locator('.sb-creer [data-touche="D"]').waitFor({ timeout: 3_000 }).catch(() => {});
        await p.keyboard.press('d');
      }
      return demande.count();
    }, { timeout: 20_000 }).toBe(1);
    expect(await demande.locator('h2').innerText()).toMatch(/^Demander à /);
    expect(p.url()).not.toContain('#/messages/');
    await demande.locator('#dm-piece').fill('le relevé bancaire d\'octobre');
    // Nommée, la pièce compose le message (tant qu'on ne l'a pas réécrit).
    expect(await demande.locator('#dm-texte').inputValue()).toMatch(/il me manque le relevé bancaire d'octobre pour ton dossier\. Peux-tu me l'envoyer ici \? Une photo suffit\.$/);
    await demande.getByRole('button', { name: 'Écrire plutôt dans la conversation' }).click();
    await expect.poll(() => p.url(), { timeout: 20_000 }).toContain(`#/messages/${cafe.ent}/demande`);
    await expect.poll(() => p.locator('[data-msg-demande-txt]').first().inputValue(), { timeout: 15_000 }).toBe('le relevé bancaire d\'octobre');
    await p.screenshot({ path: path.join(PHOTOS, 'barre-cabinet-2.png') });
    expect(erreurs).toEqual([]);
  });

  it('les pièces reçues : chaque pièce a son geste, classer vide la boîte et les chiffres, « Annuler » la remet ; une écriture commencée retient avant de changer de dossier', async () => {
    const { associe, cab, boulangerie, cafe } = await unCabinet();
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' })).newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await ouvrir(p, cab.id, '#/pieces');
    // (1.167.0) La page de la maquette : les pièces du dossier dans l'ordre d'arrivée, chacune avec son genre ; la
    // première ouverte à droite, avec ce que le client en dit, son aperçu et SON geste.
    const lignes = p.locator('#page-pieces .pc-r[data-piece]');
    await expect.poll(() => lignes.count()).toBe(2);
    expect(await lignes.first().innerText()).toMatch(/^facture-farine\.png\nSarra · .+\nà saisir$/);
    expect(await lignes.last().innerText()).toMatch(/^ticket-agil\.png\nSarra · .+\nticket$/);
    expect(await p.locator('#page-pieces .pc-gh').innerText()).toMatch(/Boulangerie El Amal/);
    const voir = p.locator('#pc-voir');
    expect(await voir.locator('.pc-mot').innerText()).toMatch(/Sarra Mansour : « La farine du 12 »/);
    expect(await voir.locator('#pc-geste').innerText()).toBe('Saisir l\'achat');
    await expect.poll(() => voir.locator('#pc-papier img').count()).toBe(1);
    // La flèche du bas ouvre la suivante : un ticket, son geste à lui.
    await p.locator('#page-pieces h1').click();
    await p.keyboard.press('ArrowDown');
    await expect.poll(() => voir.locator('.pc-vt b').innerText()).toBe('ticket-agil.png');
    expect(await voir.locator('#pc-geste').innerText()).toBe('Saisir la dépense');
    // « Classer sans saisir › En double » : la boîte et les chiffres se vident ; « Annuler » la remet.
    await voir.getByRole('button', { name: /Classer sans saisir/ }).click();
    await voir.getByRole('menuitem', { name: /En double/ }).click();
    await p.locator('#modal-root').getByRole('button', { name: 'Classer en double' }).click();
    await expect.poll(() => lignes.count()).toBe(1);
    await expect.poll(() => lien(p, 'Pièces reçues').locator('.compte').innerText()).toBe('1');
    await p.locator('#toast').getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(() => lignes.count()).toBe(2);
    await expect.poll(() => lien(p, 'Pièces reçues').locator('.compte').innerText()).toBe('2');
    // Les deux classées « Rien à saisir » : la boîte le dit, l'onglet « Classées » dit ce qui a été fait, et qui.
    for (let i = 0; i < 2; i++) {
      await voir.getByRole('button', { name: /Classer sans saisir/ }).click();
      await voir.getByRole('menuitem', { name: /Rien à saisir/ }).click();
      await expect.poll(() => lignes.count()).toBe(1 - i);
    }
    await expect.poll(() => p.locator('#page-pieces .vide-pr b').innerText()).toBe('Rien à classer');
    expect(await lien(p, 'Pièces reçues').locator('.compte').isHidden()).toBe(true);
    await p.getByRole('tab', { name: 'Classées' }).click();
    await expect.poll(() => lignes.count()).toBe(2);
    expect(await lignes.first().innerText()).toMatch(/Rien à saisir : gardée dans le dossier · Anis Gharbi/);
    expect(await voir.locator('.pc-mot').innerText()).toMatch(/^Rien à saisir : gardée dans le dossier · par Anis Gharbi, /);
    // « Remettre à classer » la rend à la boîte.
    await voir.getByRole('button', { name: 'Remettre à classer' }).click();
    await expect.poll(() => lien(p, 'Pièces reçues').locator('.compte').innerText()).toBe('1');

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

  it('les pièces reçues : « Saisir l\'achat » ouvre la saisie préparée, et l\'achat enregistré prend la pièce, qui sort de la boîte', async () => {
    const { associe, cab, boulangerie } = await unCabinet();
    const annee = new Date().getFullYear();
    expect((await api('POST', `/entreprises/${boulangerie.ent}/compta/ecritures`, associe, { date: `${annee}-01-15`, journal: 'OD', piece: 'OD-1', libelle: 'Ouverture',
      lignes: [{ compte: '6226', debit: '100,000' }, { compte: '4286', credit: '100,000' }] })).statut).toBe(201);
    // Janvier est déclaré : sa TVA déposée le 20/02.
    expect((await api('PUT', `/entreprises/${boulangerie.ent}/compta/declarations/${annee}-01`, associe, { cases: { aDecaisser: '0,000' } })).statut).toBeLessThan(300);
    expect((await api('POST', `/entreprises/${boulangerie.ent}/compta/declarations/${annee}-01/pointer`, associe, { quoi: 'deposee', le: `${annee}-02-20` })).statut).toBeLessThan(300);
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' })).newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await ouvrir(p, cab.id, '#/pieces');
    const lignes = p.locator('#page-pieces .pc-r[data-piece]');
    await expect.poll(() => lignes.count()).toBe(2);
    await lignes.filter({ hasText: 'facture-farine.png' }).click();
    await p.locator('#pc-geste').click();
    // Le journal des achats, le nom de la pièce en libellé, et le bandeau qui dit d'où elle vient et ce qu'il faut corriger.
    await p.locator('#sa-libelle').waitFor({ timeout: 15_000 });
    expect(await p.locator('.sa-depuis').innerText()).toMatch(/Saisie de « facture-farine\.png » · Pièces reçues[\s\S]*elle sort des pièces à classer[\s\S]*mets celle de la facture/);
    expect(await p.locator('#sa-journal').inputValue()).toBe('AC');
    expect(await p.locator('#sa-libelle').inputValue()).toBe('facture-farine');
    // Une date dans un mois déjà déclaré : la page le dit avant le geste ; revenue dans un mois ouvert, l'avertissement s'en va.
    expect(await p.locator('#sa-decl').isHidden()).toBe(true);
    await p.locator('#sa-date').fill(`14/01/${annee}`);
    await p.locator('#sa-date').blur();
    await expect.poll(() => p.locator('#sa-decl').isVisible()).toBe(true);
    await expect.poll(() => p.locator('#sa-decl').innerText().catch(() => '')).toMatch(new RegExp(`Janvier ${annee} est déjà déclaré \\(déposée le 20/02\\)[\\s\\S]*ils ne diront plus ce qui a été déposé`));
    await p.locator('#sa-date').fill(`14/03/${annee}`);
    await p.locator('#sa-date').blur();
    await expect.poll(() => p.locator('#sa-decl').isHidden()).toBe(true);
    await p.locator('input[data-k="compte"]').nth(0).fill('601');
    await p.locator('input[data-k="debit"]').nth(0).fill('412,300');
    await p.locator('input[data-k="compte"]').nth(1).fill('401');
    await p.locator('input[data-k="credit"]').nth(1).fill('412,300');
    await p.keyboard.press('Tab');
    await p.getByRole('button', { name: 'Enregistrer en brouillard' }).click();
    // On revient de soi-même aux pièces reçues, sur la suivante : celle-ci n'est plus à classer.
    await expect.poll(() => p.url()).toMatch(/#\/pieces$/);
    await expect.poll(() => p.locator('#toast').innerText()).toMatch(/« facture-farine\.png » est jointe à son écriture, au brouillard/);
    await expect.poll(() => lignes.count()).toBe(1);
    expect(await p.locator('#pc-voir .pc-vt b').innerText()).toBe('ticket-agil.png');
    expect(await lignes.first().innerText()).toMatch(/ticket-agil/);
    await p.getByRole('tab', { name: 'Classées' }).click();
    await expect.poll(() => lignes.filter({ hasText: 'facture-farine.png' }).innerText().catch(() => '')).toMatch(/[Jj]ointe/);
    expect(await p.locator('#page-pieces .page-head .muted').innerText()).toMatch(/^Ce qui a été fait de chaque pièce, par qui et quand/);
    await lignes.filter({ hasText: 'facture-farine.png' }).click();
    await expect.poll(() => p.locator('#pc-voir a', { hasText: 'Ouvrir l\'écriture' }).count()).toBe(1);
    expect(erreurs).toEqual([]);
  }, 60_000);

  it('les pièces reçues, avant de classer : l\'achat rangé par le client se vérifie à côté de la pièce ; un ticket le dit ; seul l\'achat qu\'un indice relie à la pièce se propose', async () => {
    const { associe, cab, boulangerie } = await unCabinet();
    const annee = new Date().getFullYear();
    const sarra = boulangerie.j;
    const achat = (id: string, num: string, fournisseur: string, ht: string, pj: unknown[]) => [
      { collection: 'suppliers', cle: `s-${id}`, rang: 0, revision: null, contenu: { id: `s-${id}`, name: fournisseur } },
      { collection: 'purchases', cle: `p-${id}`, rang: 1, revision: null, contenu: { id: `p-${id}`, kind: 'facture', number: num, date: `${annee}-01-10`, supplierId: `s-${id}`,
        currency: 'DT', category: 'Fournitures', fees: 0, withholdingRate: 0, createdAt: 1, attachments: pj,
        lines: [{ id: `p-${id}-l`, label: 'Fournitures', qty: 1, unitPrice: { '~n': ht }, vatRate: 19, destination: 'charge' }] } }];
    expect((await api('POST', `/entreprises/${boulangerie.ent}/dossier-v10`, sarra, { changements: [...achat('steg', 'FA-0919', 'STEG', '156.650', []), ...achat('cap', 'FA-0914', 'Minoterie du Cap Bon', '100.000', [])] })).statut).toBe(200);
    // Sarra range une photo dans son achat FA-0914 : elle arrive « à vérifier ».
    const f = await api('POST', `/entreprises/${boulangerie.ent}/messages/fichiers`, sarra, { cote: 'entreprise', nom: 'facture-minoterie.png', contenu: PNG });
    const m = await api('POST', `/entreprises/${boulangerie.ent}/messages`, sarra, { cote: 'entreprise', texte: '', fichier: f.corps.id });
    expect((await api('POST', `/entreprises/${boulangerie.ent}/messages/${m.corps.id}/achat`, sarra, { achat: 'p-cap', libelle: 'FA-0914 · Minoterie du Cap Bon' })).statut).toBe(200);
    // Puis une photo dont le nom dit le fournisseur de FA-0919 (l'indice qui relie la pièce à l'achat).
    const fs = await api('POST', `/entreprises/${boulangerie.ent}/messages/fichiers`, sarra, { cote: 'entreprise', nom: 'facture-steg.png', contenu: PNG });
    expect((await api('POST', `/entreprises/${boulangerie.ent}/messages`, sarra, { cote: 'entreprise', texte: '', fichier: fs.corps.id })).statut).toBe(201);
    const fe = await api('POST', `/entreprises/${boulangerie.ent}/messages/fichiers`, sarra, { cote: 'entreprise', nom: 'electricite-aout.png', contenu: PNG });
    expect((await api('POST', `/entreprises/${boulangerie.ent}/messages`, sarra, { cote: 'entreprise', texte: '', fichier: fe.corps.id })).statut).toBe(201);
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' })).newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await ouvrir(p, cab.id, '#/pieces');
    const lignes = p.locator('#page-pieces .pc-r[data-piece]');
    await expect.poll(() => lignes.count()).toBe(5);
    // « Déjà rangée par le client » : son achat, lu dans ses livres, à côté de la pièce ; on classe en connaissance de cause.
    await lignes.filter({ hasText: 'facture-minoterie.png' }).click();
    const vf = p.locator('#pc-voir .pc-vf');
    await expect.poll(() => vf.innerText().catch(() => '')).toMatch(/Déjà dans les achats de Sarra[\s\S]*FA-0914 · Minoterie du Cap Bon[\s\S]*Hors taxes\s+100,000[\s\S]*TVA\s+19,000[\s\S]*Total\s+119,000/);
    expect(await vf.innerText()).toMatch(/Compare le total au fichier : l'achat dit 119,000 DT/);
    expect(await p.locator('#pc-geste').innerText()).toBe('C\'est juste : classer');
    // Le ticket Agil : il n'est pas une facture ; rien ne le relie à FA-0919 (STEG), qui ne lui est donc pas proposé
    // (Skander, 29/10 : « à quoi ça sert si la pièce n'a rien à voir ? »). « Saisir » reste le geste principal ; joindre
    // reste possible à la main, depuis « Classer sans saisir », sans qu'aucun achat passe pour le bon.
    await lignes.filter({ hasText: 'ticket-agil.png' }).click();
    const voir = p.locator('#pc-voir');
    await expect.poll(() => voir.innerText().catch(() => '')).toMatch(/Un ticket de caisse n'est pas une facture/);
    expect(await voir.locator('.pc-av-j').count()).toBe(0);
    expect(await voir.innerText()).not.toMatch(/FA-0919/);
    expect(await p.locator('#pc-geste').getAttribute('class')).toMatch(/btn-primary/);
    await p.locator('#pc-menu').click();
    await p.locator('[data-pc-raison="joindre"]').click();
    const fen = p.locator('#modal-root');
    await expect.poll(() => fen.locator('.cl-dp-l li').allInnerTexts()).toEqual([expect.stringMatching(/^FA-0919 · STEG[\s\S]*186,414 DT · sans justificatif\s+Joindre à FA-0919$/)]);
    expect(await fen.locator('.btn-primary').count()).toBe(0);
    await fen.getByRole('button', { name: 'Annuler' }).click();
    // « electricite » : l'écriture ne dit que « STEG », mais la STEG vend l'électricité ; FA-0919 se propose, sans être le
    // geste principal (un fournisseur qui revient chaque mois n'est pas une preuve).
    await lignes.filter({ hasText: 'electricite-aout.png' }).click();
    await expect.poll(() => voir.locator('.pc-av-j').innerText().catch(() => '')).toMatch(/FA-0919 · STEG[\s\S]*La pièce dit ce que l'achat a payé/);
    expect(await p.locator('#pc-geste').getAttribute('class')).toMatch(/btn-primary/);
    // La photo nommée « steg » : FA-0919 lui est proposé, et la page dit pourquoi.
    await lignes.filter({ hasText: 'facture-steg.png' }).click();
    await expect.poll(() => voir.locator('.pc-av-j').innerText().catch(() => '')).toMatch(/Un achat de Sarra attend son justificatif\.[\s\S]*FA-0919 · STEG[\s\S]*186,414 DT[\s\S]*Le même fournisseur que la pièce/);
    await voir.getByRole('button', { name: 'C\'est la même : joindre à FA-0919' }).click();
    await expect.poll(() => lignes.count()).toBe(4);
    await expect.poll(() => p.locator('#toast').innerText()).toMatch(/« facture-steg\.png » est jointe à FA-0919/);
    // « Déposer des pièces » : dans quel dossier (celui de la pièce ouverte), puis la fenêtre du classeur de ce dossier.
    await p.locator('#pc-deposer').click();
    expect(await p.locator('#pc-dep-d option:checked').innerText()).toMatch(/^Boulangerie El Amal · relié$/);
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#dp-t').innerText().catch(() => '')).toBe('Déposer des pièces dans le classeur');
    expect(await p.locator('#modal-root').innerText()).toMatch(/Boulangerie El Amal · ce que le client t'a donné/);
    expect(erreurs).toEqual([]);
  }, 60_000);

  it('les pièces reçues, l\'aide de la page : d\'où viennent les pièces, ses quatre gestes guidés ; un fichier abîmé se redemande, il ne se saisit pas', async () => {
    const { associe, cab, boulangerie } = await unCabinet();
    // Un PDF coupé pendant l'envoi : son en-tête est là, le reste non.
    const f = await api('POST', `/entreprises/${boulangerie.ent}/messages/fichiers`, boulangerie.j, { cote: 'entreprise', nom: 'facture-abimee.pdf', contenu: Buffer.from('%PDF-1.4\nabîmée pendant l\'envoi').toString('base64') });
    expect((await api('POST', `/entreprises/${boulangerie.ent}/messages`, boulangerie.j, { cote: 'entreprise', texte: '', fichier: f.corps.id })).statut).toBe(201);
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' })).newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await ouvrir(p, cab.id, '#/pieces');
    // La bulle « i » du titre : les six chemins, et ce qui n'arrive pas ici.
    await p.locator('#page-pieces h1 .i[data-info="pc.page"]').click();
    await expect.poll(() => p.locator('body').innerText()).toMatch(/D'où viennent ces pièces[\s\S]*Six chemins[\s\S]*N'arrivent pas ici/);
    await p.keyboard.press('Escape');
    // « Guide-moi » : la visite de la page, et les quatre gestes de la maquette.
    await p.locator('#guide-moi').click();
    const menu = p.getByRole('menuitem');
    for (const t of ['Visite de la page', 'Saisir une facture d\'achat reçue', 'Vérifier une photo rangée par le client', 'Déposer des pièces reçues ailleurs', 'Redemander une pièce illisible']) {
      await expect.poll(() => menu.filter({ hasText: t }).count()).toBeGreaterThan(0);
    }
    await p.keyboard.press('Escape');
    // Le fichier abîmé : la page le dit, et son geste est de le redemander (pas de le saisir).
    await p.locator('#page-pieces .pc-r[data-piece]').filter({ hasText: 'facture-abimee.pdf' }).click();
    await expect.poll(() => p.locator('#pc-papier').innerText().catch(() => '')).toMatch(/Ce fichier ne s'ouvre pas[\s\S]*un message prêt pour Sarra/);
    await expect.poll(() => p.locator('#pc-geste').innerText()).toBe('Le redemander à Sarra');
    expect(await p.locator('#pc-geste').getAttribute('class')).toMatch(/btn-primary/);
    await p.locator('#pc-geste').click();
    await expect.poll(() => p.locator('#modal-root').innerText().catch(() => '')).toMatch(/Redemander la pièce à Boulangerie El Amal[\s\S]*facture-abimee\.pdf/);
    // Une pièce lisible garde son geste.
    await p.locator('#modal-root').getByRole('button', { name: 'Annuler' }).click();
    await p.locator('#page-pieces .pc-r[data-piece]').filter({ hasText: 'facture-farine.png' }).click();
    await expect.poll(() => p.locator('#pc-geste').innerText()).toBe('Saisir l\'achat');
    expect(erreurs).toEqual([]);
  }, 60_000);

  it('les pièces reçues : ce que le cabinet dépose lui-même (WhatsApp, papier) s\'y classe comme le reste, sans paraître deux fois dans le classeur', async () => {
    const { associe, cab, tenu } = await unCabinet();
    // Anis dépose une photo reçue par WhatsApp dans le dossier tenu (la Menuiserie), à classer.
    const d = await api('POST', `/cabinets/${cab.id}/classeur/${tenu}/documents`, associe, { rubrique: 'piece', periode: `${new Date().getFullYear()}-09`,
      titre: 'WhatsApp Image bois', provenance: 'WhatsApp du gérant', nom: 'WhatsApp-bois.png', contenu: PNG });
    expect(d.statut).toBe(201);
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' })).newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await ouvrir(p, cab.id, '#/pieces');
    const lignes = p.locator('#page-pieces .pc-r[data-piece]');
    // Elle est là, avec les deux pièces de la boulangerie, et le compte les dit trois.
    await expect.poll(() => lignes.count()).toBe(3);
    expect(await p.locator('[data-onglet-pr="aclasser"] .compte').innerText()).toBe('3');
    // Le classeur du dossier la montre une seule fois (il la lit parmi ses documents, pas aussi parmi les pièces reçues).
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossier/${tenu}/classeur`);
    await p.locator('#page-cl .cl-res').first().waitFor({ timeout: 25_000 });
    await expect.poll(() => p.locator('.cl-res-t').first().innerText()).toMatch(/^Septembre \d{4}\s+1 pièce\b/);
    expect(await p.locator('#page-cl li[data-cl-k]').filter({ hasText: 'WhatsApp' }).count()).toBe(1);
    await ouvrir(p, cab.id, '#/pieces');
    await expect.poll(() => lignes.count()).toBe(3);
    const la = lignes.filter({ hasText: 'WhatsApp-bois.png' });
    expect(await la.innerText()).toMatch(/WhatsApp du gérant · déposée par Anis/);
    await la.click();
    // Ce qu'on en sait : qui l'a déposée, d'où elle vient ; pas de « Répondre » (ce n'est pas le client qui l'a envoyée).
    await expect.poll(() => p.locator('#pc-voir .pc-mot').innerText().catch(() => '')).toMatch(/Déposée par Anis, reçue par WhatsApp du gérant[\s\S]*Dossier tenu : personne d'autre ne la voit/);
    expect(await p.locator('#pc-voir .pc-mot a', { hasText: 'Répondre' }).count()).toBe(0);
    // Son fichier s'ouvre (le classeur le garde) ; un dossier tenu n'a pas de conversation où la redemander.
    await expect.poll(() => p.locator('#pc-papier img').count()).toBe(1);
    await p.locator('#pc-menu').click();
    expect(await p.locator('[data-pc-raison="illisible"]').count()).toBe(0);
    // Classée « rien à saisir » : elle sort, et le classeur du dossier la dit classée, une seule fois.
    await p.locator('[data-pc-raison="rien"]').click();
    await expect.poll(() => lignes.count()).toBe(2);
    const docs = (await api('GET', `/cabinets/${cab.id}/classeur/${tenu}/documents`, associe)).corps.documents as { id: string; raison: string | null }[];
    expect(docs.find((x) => x.id === d.corps.id)?.raison).toBe('rien');
    expect(erreurs).toEqual([]);
  }, 60_000);

  it('les pièces reçues, les autres états : en double (laquelle), déjà saisie (où), plusieurs d\'un coup, un achat que le client saisit lui-même, la recherche vide, sans réseau', async () => {
    const { associe, cab, boulangerie, cafe } = await unCabinet();
    // (1.168.0) Le café ne confie au cabinet que sa comptabilité et ses déclarations : il saisit ses achats lui-même.
    expect((await api('PUT', `/entreprises/${cafe.ent}/mandat/perimetre`, cafe.j, { perimetre: ['comptabilite', 'declarations'] })).statut).toBe(200);
    const f = await api('POST', `/entreprises/${cafe.ent}/messages/fichiers`, cafe.j, { cote: 'entreprise', nom: 'facture-lait.png', contenu: PNG });
    expect((await api('POST', `/entreprises/${cafe.ent}/messages`, cafe.j, { cote: 'entreprise', texte: '', fichier: f.corps.id })).statut).toBe(201);
    const ctx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    const p = await ctx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await ouvrir(p, cab.id, '#/pieces');
    const lignes = p.locator('#page-pieces .pc-r[data-piece]');
    const ligne = (nom: string) => lignes.filter({ has: p.locator('.pc-rt b', { hasText: nom }) });
    const voir = p.locator('#pc-voir');
    const fen = p.locator('#modal-root');
    await expect.poll(() => lignes.count()).toBe(3);
    // L'achat du café : le geste principal le lui laisse, saisir soi-même reste possible, l'avertissement se lit avant.
    await ligne('facture-lait.png').click();
    expect(await voir.locator('.pc-nc').innerText()).toMatch(/Café Dar Zitouna saisit ses achats dans SkanFact.+saisie deux fois/);
    expect(await voir.locator('#pc-geste').innerText()).toBe('Lui laisser la saisie');
    expect(await voir.getByRole('button', { name: 'La saisir moi-même' }).count()).toBe(1);
    // Un achat de la boulangerie (saisie confiée) n'a pas cet avertissement.
    await ligne('facture-farine.png').click();
    expect(await voir.locator('.pc-nc').count()).toBe(0);
    // « En double » demande laquelle est l'originale : l'autre pièce du même dossier, gardée avec le classement.
    await voir.getByRole('button', { name: /Classer sans saisir/ }).click();
    await voir.getByRole('menuitem', { name: /En double/ }).click();
    await expect.poll(() => fen.locator('h2').innerText()).toBe('De quelle pièce est-ce la copie ?');
    expect(await fen.locator('[data-pc-orig]').allInnerTexts()).toEqual([expect.stringMatching(/^ticket-agil\.png\n/)]);
    await fen.getByRole('button', { name: 'Classer en double' }).click();
    await expect.poll(() => lignes.count()).toBe(2);
    // « Déjà saisie » demande où, et le garde aussi.
    await ligne('ticket-agil.png').click();
    await voir.getByRole('button', { name: /Classer sans saisir/ }).click();
    await voir.getByRole('menuitem', { name: /Déjà saisie/ }).click();
    await fen.locator('#pc-ds').fill('Achat FA-0919');
    await fen.getByRole('button', { name: 'Classer : déjà saisie' }).click();
    await expect.poll(() => lignes.count()).toBe(1);
    await p.getByRole('tab', { name: 'Classées' }).click();
    await expect.poll(() => lignes.count()).toBe(2);
    await ligne('facture-farine.png').click();
    expect(await voir.locator('.pc-mot').innerText()).toMatch(/^En double : la même que ticket-agil\.png · par Anis Gharbi, .+$/);
    await ligne('ticket-agil.png').click();
    expect(await voir.locator('.pc-mot').innerText()).toMatch(/^Déjà saisie dans Achat FA-0919 · par Anis Gharbi, .+$/);
    // Les deux remises à classer, puis choisies avec la troisième : un geste pour les trois, « Annuler » pour les trois.
    for (const nom of ['ticket-agil.png', 'facture-farine.png']) {
      await ligne(nom).click();
      await voir.getByRole('button', { name: 'Remettre à classer' }).click();
      await expect.poll(() => ligne(nom).count()).toBe(0);
    }
    await p.getByRole('tab', { name: /À classer/ }).click();
    await expect.poll(() => lignes.count()).toBe(3);
    for (const c of await p.locator('[data-pc-choix]').all()) await c.check();
    const lot = p.locator('.pc-lot');
    expect(await lot.innerText()).toMatch(/^3 pièces choisies\nde 2 dossiers/);
    await lot.getByRole('button', { name: 'Classer : rien à saisir' }).click();
    await expect.poll(() => lignes.count()).toBe(0);
    await expect.poll(() => p.locator('#page-pieces .vide-pr').innerText()).toMatch(/^Rien à classer\n+Aujourd'hui, 3 pièces ont été classées\./);
    expect(await lien(p, 'Pièces reçues').locator('.compte').isHidden()).toBe(true);
    await p.locator('#toast').getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(() => lignes.count()).toBe(3);
    expect(await p.locator('.pc-lot').count()).toBe(0);
    // La recherche sans résultat : elle propose de chercher dans les classées, ou d'effacer.
    await p.locator('#pc-q').fill('loyer');
    await expect.poll(() => p.locator('#page-pieces .vide-pr b').innerText()).toBe('Aucune pièce ne correspond à « loyer »');
    await p.getByRole('button', { name: 'Chercher dans les classées' }).click();
    await expect.poll(() => p.getByRole('tab', { name: 'Classées' }).getAttribute('aria-selected')).toBe('true');
    expect(await p.locator('#pc-q').inputValue()).toBe('loyer');
    await p.getByRole('button', { name: 'Effacer la recherche' }).click();
    expect(await p.locator('#pc-q').inputValue()).toBe('');
    // Sans réseau : la page dit ce qu'elle savait et à quelle heure ; saisir et classer attendent.
    await p.getByRole('tab', { name: /À classer/ }).click();
    await expect.poll(() => lignes.count()).toBe(3);
    await ctx.setOffline(true);
    await p.evaluate(() => window.dispatchEvent(new Event('offline')));
    await ligne('facture-farine.png').click();
    await expect.poll(() => p.locator('#page-pieces .pr-ban').innerText()).toMatch(/^Pas de réseau : ce poste montre ce qu'il savait à \d{1,2} h \d{2}\./);
    expect(await voir.locator('#pc-geste').isDisabled()).toBe(true);
    await ctx.setOffline(false);
    expect(erreurs).toEqual([]);
    void boulangerie;
  });

  it('(1.186.0) épingler une page du volet « Le cabinet » dans « Mon cabinet », la ranger, la retirer', async () => {
    const { associe, cab } = await unCabinet();
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' })).newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await ouvrir(p, cab.id, '#/priorites');
    const routes = () => p.locator('#nav .nav-quotidien > a.lien').evaluateAll((l) => l.map((a) => (a as HTMLElement).dataset.route));
    expect(await routes()).toEqual(['priorites', 'pieces', 'echeances', 'production', 'messages']);
    // Le volet dit comment faire, et chaque page qu'on peut épingler porte son épingle.
    await p.locator('#nav .nav-volet[data-famille="Le cabinet"]').click();
    const volet = p.locator('.sb-panneau');
    expect(await volet.locator('.panneau-pied').innerText()).toContain('épingle une page pour l\'avoir dans « Mon cabinet »');
    expect(await volet.locator('[data-epingle]').evaluateAll((l) => l.map((b) => (b as HTMLElement).dataset.epingle))).toEqual(['dossiers', 'relances', 'ecritures', 'reglages']);
    await volet.locator('[data-epingle="relances"]').click();
    await volet.locator('[data-epingle="dossiers"]').click();
    // Le volet reste ouvert, la ligne se lit « Dans « Mon cabinet » » et sa coche la retirera.
    const ligne = volet.locator('.ligne').filter({ hasText: 'Relances' });
    expect(await ligne.innerText()).toMatch(/^Relances\s*Dans « Mon cabinet »$/);
    expect(await ligne.locator('[data-epingle]').getAttribute('aria-label')).toBe('Retirer de « Mon cabinet » : Relances');
    await p.keyboard.press('Escape');
    expect(await routes()).toEqual(['priorites', 'pieces', 'echeances', 'production', 'messages', 'relances', 'dossiers']);
    // Rangée en la glissant, elle garde sa place au rechargement, et mène à sa page.
    await p.locator('#nav .nav-quotidien > a.lien[data-route="dossiers"]').dragTo(p.locator('#nav .nav-quotidien > a.lien[data-route="priorites"]'));
    await expect.poll(routes).toEqual(['dossiers', 'priorites', 'pieces', 'echeances', 'production', 'messages', 'relances']);
    await ouvrir(p, cab.id, '#/priorites');
    expect(await routes()).toEqual(['dossiers', 'priorites', 'pieces', 'echeances', 'production', 'messages', 'relances']);
    await p.locator('#nav .nav-quotidien > a.lien[data-route="relances"]').click();
    await expect.poll(() => p.url()).toMatch(/#\/relances$/);
    await expect.poll(() => p.locator('#nav .nav-quotidien > a.lien[data-route="relances"]').getAttribute('aria-current')).toBe('page');
    // La coche la retire ; le volet la propose de nouveau, avec sa phrase.
    await p.locator('#nav .nav-volet[data-famille="Le cabinet"]').click();
    await volet.locator('[data-epingle="relances"]').click();
    expect(await volet.locator('.ligne').filter({ hasText: 'Relances' }).innerText()).toMatch(/^Relances\s*Les clients à qui des mois manquent/);
    await p.keyboard.press('Escape');
    expect(await routes()).toEqual(['dossiers', 'priorites', 'pieces', 'echeances', 'production', 'messages']);
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
