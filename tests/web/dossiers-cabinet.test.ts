// Les Dossiers du Cabinet (maquette « Dossiers du cabinet », docs/maquettes/cabinet/dossiers.html ; 1.169.0), à la souris.
// Ce que le parcours vérifie, le 29/10/2026 :
//   - la liste : sous chaque nom sa forme et sa ville, sous chaque contact sa fonction, les honoraires sans « DT » (le titre
//     le dit), la proposition d'un client qui attend, en tête ;
//   - la fiche d'un client, à droite : « Ce qui se passe », sa mission ;
//   - « Noter une relance faite… » : un appel noté se range sur la fiche, la vue « Pièces manquantes » le dit ;
//   - « Confier à… » deux dossiers choisis : la direction d'abord dans la liste, puis la personne choisie les suit ;
//   - au téléphone : des cartes, la fiche en plein écran et son retour.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const LE_29 = new Date('2026-10-29T10:00:00+01:00');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('les Dossiers du Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-dossiers-'));
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
  // Un cabinet et son équipe (une collaboratrice), deux clients sur SkanFact et leur fiche, un hôtel qui propose son dossier.
  async function unCabinet() {
    const { jeton: associe } = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const rim = await personne('Rim Toumi');
    const inv = (await api('POST', `/cabinets/${cab.id}/invitations`, associe, { email: rim.email, role: 'saisie' })).corps as { jeton: string };
    expect((await api('POST', '/invitations/accepter', rim.jeton, { jeton: inv.jeton })).statut).toBe(200);
    const client = async (nom: string, gerant: string, jour: string, fiche: Record<string, unknown>) => {
      const { jeton: j } = await personne(gerant);
      const ent = String((await api('POST', '/entreprises', j, { raisonSociale: nom })).corps.id);
      const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, j, { codeCabinet: cab.code })).corps.mandat);
      expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
      expect((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: jour, journal: 'OD', piece: 'OD-1', libelle: 'Honoraires',
        lignes: [{ compte: '6226', debit: '100,000' }, { compte: '401', credit: '100,000' }] })).statut).toBe(201);
      expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, associe, { contenu: fiche, revision: null })).statut).toBeLessThan(300);
      return { j, ent };
    };
    const librairie = await client('Librairie Ennour', 'Amel Nouri', '2026-08-14', { contact: 'Amel', fonction: 'responsable', forme: 'SARL', ville: 'Ariana', fees: 250_125 });
    const menuiserie = await client('Menuiserie Ben Ali', 'Hédi Ben Ali', '2026-09-15', { contact: 'Hédi', fonction: 'gérant', forme: 'SUARL', ville: 'Ben Arous', fees: 350_000 });
    const { jeton: mounir } = await personne('Mounir Ben Hassen');
    const hotel = String((await api('POST', '/entreprises', mounir, { raisonSociale: 'Hôtel Les Pins' })).corps.id);
    expect((await api('POST', `/entreprises/${hotel}/mandat`, mounir, { codeCabinet: cab.code, perimetre: ['comptabilite', 'declarations', 'paie'] })).statut).toBeLessThan(300);
    return { associe, cab, librairie, menuiserie, hotel };
  }
  async function ouvrir(p: Page, cabinet: string, ligne = 'tr[data-id]') {
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossiers`);
    await p.locator(`#page-tb ${ligne}`).first().waitFor({ timeout: 25_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
  }

  it('au bureau : la liste, la proposition, la fiche, noter une relance, confier deux dossiers', async () => {
    const { associe, cab } = await unCabinet();
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.clock.setFixedTime(LE_29);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await ouvrir(p, cab.id);
    const ligne = (nom: string) => p.locator('#page-tb tr[data-id]').filter({ hasText: nom });
    // La ligne : sa forme et sa ville, la fonction du contact, les honoraires en dinars sans « DT » (au millime : 250,125).
    expect(await ligne('Librairie Ennour').locator('td.cl small').innerText()).toBe('SARL · Ariana');
    expect(await ligne('Menuiserie Ben Ali').locator('.cd-ct small').innerText()).toBe('gérant');
    expect((await ligne('Librairie Ennour').locator('td.r').innerText()).trim()).toBe('250,125');
    // La proposition de l'hôtel attend en tête : ce qu'il confie, et le geste.
    const prop = p.locator('.cd-prop');
    expect(await prop.innerText()).toMatch(/Hôtel Les Pins te confie son dossier[\s\S]*la comptabilité, les déclarations et la paie/);
    expect(await prop.getByRole('button', { name: 'Accepter le dossier' }).count()).toBe(1);

    // (1.183.0) Au bout de la ligne, écrire et confier : posés, transparents, révélés au survol (rien ne bouge sous le curseur).
    const vite = ligne('Menuiserie Ben Ali').locator('.cd-vite');
    expect(await vite.evaluate((e) => getComputedStyle(e).opacity)).toBe('0');
    await ligne('Menuiserie Ben Ali').hover();
    await expect.poll(() => vite.evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
    expect(await vite.getByRole('link', { name: 'Écrire à Hédi' }).getAttribute('href')).toMatch(/^#\/messages\//);
    await vite.getByRole('button', { name: 'Confier Menuiserie Ben Ali à…' }).click();
    expect(await p.locator('.cd-vite .cd-cf .cd-cf-h').innerText()).toBe('Confier Menuiserie Ben Ali à');
    await p.mouse.click(5, 880);
    await expect.poll(() => p.locator('.cd-cf').count()).toBe(0);

    // (1.183.0) Plus de fiche à côté : un clic ouvre le dossier ; on passe au suivant de LA liste vue, puis on y revient.
    expect(await p.locator('.cd-fiche').count()).toBe(0);
    await ligne('Librairie Ennour').locator('td.cl').click();
    await expect.poll(() => p.locator('#page-fd h1').innerText()).toMatch(/^Librairie Ennour/);
    const nav = p.getByRole('navigation', { name: 'D\'un dossier à l\'autre' });
    expect(net(await nav.locator('.fd-nav-n').innerText())).toBe('1 / 2');
    expect(await nav.getByRole('button', { name: 'Pas de dossier avant' }).isDisabled()).toBe(true);
    await nav.getByRole('button', { name: 'Le dossier suivant : Menuiserie Ben Ali' }).click();
    await expect.poll(() => p.locator('#page-fd h1').innerText()).toMatch(/^Menuiserie Ben Ali/);
    expect(net(await nav.locator('.fd-nav-n').innerText())).toBe('2 / 2');
    await nav.getByRole('link', { name: 'Tous les dossiers' }).click();
    await expect.poll(() => p.locator('#page-tb tr.kb td.cl b').innerText()).toBe('Menuiserie Ben Ali');
    // La liste vue fait l'ordre : réduite à un dossier par la recherche, pas de précédent ni de suivant pris ailleurs.
    // (la liste peut se redessiner une fois à son retour, avec ses données : on tape jusqu'à ce que la recherche tienne)
    await expect.poll(async () => { await p.locator('#q').fill('Menuiserie'); return p.locator('#page-tb tr[data-id]').count(); }).toBe(1);
    await ligne('Menuiserie Ben Ali').locator('td.cl').click();
    await expect.poll(() => p.locator('#page-fd h1').innerText()).toMatch(/^Menuiserie Ben Ali/);
    expect(await p.locator('.fd-nav').count()).toBe(0);
    await p.goBack();
    await p.locator('#q').fill('');
    await ligne('Librairie Ennour').waitFor();

    // « Noter une relance faite… » : un appel, rangé sur sa fiche ; la vue « Pièces manquantes » le dit.
    await ligne('Librairie Ennour').getByRole('button', { name: /Les gestes de/ }).click();
    await p.getByRole('menuitem', { name: /Noter une relance faite/ }).click();
    const fen = p.locator('#modal-root');
    await expect.poll(() => fen.locator('h2').innerText()).toBe('Noter une relance faite à Librairie Ennour');
    await fen.locator('input[name="cd-nr"][value="tel"]').check();
    await fen.locator('#cd-nr-note').fill('Elle envoie les relevés vendredi.');
    await fen.getByRole('button', { name: 'Noter la relance' }).click();
    await expect.poll(() => p.locator('#toast').innerText()).toMatch(/Relance notée sur la fiche de Librairie Ennour/);
    await p.locator('[role=tab][data-cd-vue="manque"]').click();
    await expect.poll(() => ligne('Librairie Ennour').innerText()).toMatch(/relancé le 29\/10, au téléphone/);
    await p.locator('[role=tab][data-cd-vue="tous"]').click();

    // « Confier à… » deux dossiers : la direction d'abord, puis Rim prend leur suivi.
    for (const n of ['Librairie Ennour', 'Menuiserie Ben Ali']) await ligne(n).locator('[data-cd-choix]').check();
    expect(await p.locator('.cd-bc').innerText()).toMatch(/2 dossiers choisis/);
    await p.locator('#cd-confier').click();
    const noms = await p.locator('.cd-cf [data-cd-a] .rm-l').allInnerTexts();
    expect(noms[0]).toBe('Leïla Jlassi');
    await p.locator('.cd-cf [data-cd-a]').filter({ hasText: 'Rim Toumi' }).click();
    await expect.poll(() => p.locator('#toast').innerText()).toMatch(/2 dossiers confiés à Rim/);
    await expect.poll(() => ligne('Menuiserie Ben Ali').locator('.cd-suivi .cd-p').first().getAttribute('title')).toBe('Rim Toumi');

    // (1.184.0) Un dossier tenu au cabinet : son client n'a pas de compte ; « Écrire… » propose WhatsApp et l'e-mail, la
    // messagerie SkanFact grisée, et le message ne lui parle pas de SkanFact.
    expect((await api('POST', `/cabinets/${cab.id}/dossiers`, associe, { raisonSociale: 'Transports Gabès' })).statut).toBeLessThan(300);
    await p.reload();
    await p.locator('#page-tb tr[data-id]').first().waitFor({ timeout: 25_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await ligne('Transports Gabès').hover();
    await ligne('Transports Gabès').locator('.cd-vite [data-cd-geste="ecrire"]').click();
    const fen2 = p.locator('#modal-root');
    await expect.poll(() => fen2.locator('h2').innerText()).toBe('Écrire à Transports Gabès');
    expect(await fen2.locator('[data-ec-par="fil"]').isDisabled()).toBe(true);
    expect(await fen2.locator('[data-ec-par="fil"]').innerText()).toMatch(/pas de compte SkanFact/);
    expect(await fen2.locator('[data-ec-par="mail"]').getAttribute('aria-pressed')).toBe('true');
    expect(await fen2.locator('#ec-msg').inputValue()).not.toMatch(/SkanFact/);
    await fen2.getByRole('button', { name: 'Annuler' }).click();
    expect(erreurs).toEqual([]);
  });

  it('au téléphone : des cartes, le dossier d\'un toucher, et le retour à la liste', async () => {
    const { associe, cab } = await unCabinet();
    const cx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', isMobile: true, hasTouch: true });
    await cx.clock.setFixedTime(LE_29);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await ouvrir(p, cab.id, '[data-cd-carte]');
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await p.locator('#page-tb table.cd-table').count()).toBe(0);
    await p.locator('[data-cd-carte]').filter({ hasText: 'Menuiserie Ben Ali' }).click();
    await expect.poll(() => p.locator('#page-fd h1').innerText()).toMatch(/^Menuiserie Ben Ali/);
    expect(await p.getByRole('navigation', { name: 'D\'un dossier à l\'autre' }).isVisible()).toBe(true);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await p.getByRole('link', { name: 'Tous les dossiers' }).click();
    await expect.poll(() => p.locator('[data-cd-carte]').first().isVisible()).toBe(true);
    expect(erreurs).toEqual([]);
  });

  it('(1.185.0) le début de mission : demandé à l\'acceptation, « à préciser » tant qu\'il ne l\'est pas, rien réclamé avant', async () => {
    const { associe, cab, hotel } = await unCabinet();
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.clock.setFixedTime(LE_29);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await ouvrir(p, cab.id);
    // Accepter le dossier : la page revenue demande d'abord à partir de quand le cabinet le tient.
    await p.locator('.cd-prop').getByRole('button', { name: 'Accepter le dossier' }).click();
    const fen = p.locator('#modal-root');
    await expect.poll(() => fen.locator('h2').innerText().catch(() => ''), { timeout: 25_000 }).toBe('À partir de quand tiens-tu Hôtel Les Pins ?');
    expect((await fen.locator('[data-dm] b').allInnerTexts())).toEqual(['Ce mois-ci · octobre 2026', 'Depuis janvier 2026', 'Un autre mois…']);
    expect(await fen.locator('#ok').isDisabled()).toBe(true);
    // « Plus tard » : la ligne le dit, sans rien réclamer (pas de mois en retard, pas de relance), et Priorités le rappelle.
    await fen.getByRole('button', { name: 'Plus tard' }).click();
    const ligne = p.locator('#page-tb tr[data-id]').filter({ hasText: 'Hôtel Les Pins' });
    await expect.poll(() => ligne.locator('.cd-mo-c').innerText()).toMatch(/^début de mission à préciser\s*Préciser…$/);
    await p.locator('[role=tab][data-cd-vue="manque"]').click();
    expect(await p.locator('#page-tb tr[data-id]').filter({ hasText: 'Hôtel Les Pins' }).count()).toBe(0);
    await p.evaluate(() => { location.hash = '#/production'; });
    // (1.194.0) « À voir » se replie derrière son nombre quand il y a de l'urgent : on le déplie.
    await p.locator('#tb-afaire').waitFor({ timeout: 15_000 });
    if (await p.locator('#tb-avoir[aria-expanded="false"]').count()) await p.locator('#tb-avoir').click();
    const tache = p.locator('#page-bord .afaire-ligne').filter({ hasText: 'Début de mission à préciser' });
    await expect.poll(() => tache.innerText().catch(() => '')).toMatch(/Hôtel Les Pins/);
    // « Préciser… » : un autre mois (une reprise en cours d'année) ; la fiche le garde, la ligne réclame à partir de lui.
    await tache.getByRole('button', { name: 'Préciser…' }).click();
    await fen.locator('[data-dm="autre"]').click();
    await fen.locator('#dm-autre').selectOption('2026-07');
    expect(await fen.locator('#ok').innerText()).toBe('Commencer en juillet 2026');
    await fen.locator('#ok').click();
    await expect.poll(() => p.locator('#toast').innerText()).toMatch(/^Hôtel Les Pins : ta mission commence en juillet 2026\. Rien ne lui est réclamé avant\./);
    const fiches = (await api('GET', `/cabinets/${cab.id}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: { from?: string } }[];
    expect(fiches.find((f) => f.entreprise === hotel)?.contenu.from).toBe('2026-07');
    await expect.poll(() => p.locator('#page-bord .afaire-ligne').filter({ hasText: 'Début de mission à préciser' }).count()).toBe(0);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
