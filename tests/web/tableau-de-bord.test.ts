// Le Tableau de bord du Cabinet, Priorités comprises (1.194.0 ; maquette docs/maquettes/cabinet/tableau-de-bord.html),
// à la souris. Skander, 30/10/2026 : « on va fusionner Priorités et Tableau de bord et on va appliquer la maquette ».
// Ce que le parcours vérifie :
//   - une seule entrée dans la barre, qui porte le chiffre rouge des urgents ; l'ancien lien des Priorités y mène ;
//   - « À faire maintenant » d'abord, « À voir » replié derrière son nombre ;
//   - la campagne du mois : un anneau, cinq étapes ; un clic sur une étape ne garde que ses dossiers dans la grille ;
//   - le choix d'une personne vaut pour toute la page (la grille, « À faire ») ;
//   - la recherche vide le dit, avec « Effacer la recherche » ; le menu ⋯ d'une ligne mène à sa fiche ;
//   - au téléphone, rien ne déborde de la page.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le Tableau de bord du Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-tb-'));
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
    const email = `${(nom.split(' ')[0] ?? '').normalize('NFD').replace(/[^a-z]/gi, '')}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return { jeton, email };
  };
  // Le dernier mois fini (celui de la campagne) : le mois en cours n'entre jamais dans la grille.
  const moisAvant = (() => { const d = new Date(); const a = d.getUTCFullYear(), m = d.getUTCMonth() - 1; return m <= 0 ? `${a - 1}-${String(12 + m).padStart(2, '0')}` : `${a}-${String(m).padStart(2, '0')}`; })();
  const moisFini = (() => { const d = new Date(); const a = d.getUTCFullYear(), m = d.getUTCMonth(); return m === 0 ? `${a - 1}-12` : `${a}-${String(m).padStart(2, '0')}`; })();

  // Un cabinet de deux personnes (Leïla, associée ; Rim, saisie) et trois clients sur SkanFact : la menuiserie confiée à
  // Rim, les deux autres à personne. Le garage a déposé la déclaration du mois fini.
  async function unCabinet() {
    const { jeton: associe } = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const rim = await personne('Rim Toumi');
    const inv = (await api('POST', `/cabinets/${cab.id}/invitations`, associe, { email: rim.email, role: 'saisie' })).corps as { jeton: string };
    expect((await api('POST', '/invitations/accepter', rim.jeton, { jeton: inv.jeton })).statut).toBe(200);
    const client = async (nom: string, gerant: string, contact: string, depuis = moisFini) => {
      const { jeton: j } = await personne(gerant);
      const ent = String((await api('POST', '/entreprises', j, { raisonSociale: nom })).corps.id);
      const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, j, { codeCabinet: cab.code })).corps.mandat);
      expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
      expect((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: `${moisFini}-14`, journal: 'OD', piece: 'OD-1', libelle: 'Honoraires',
        lignes: [{ compte: '6226', debit: '100,125' }, { compte: '401', credit: '100,125' }] })).statut).toBe(201);
      expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, associe, { contenu: { contact, forme: 'SARL', from: depuis }, revision: null })).statut).toBeLessThan(300);
      return { ent, mandat };
    };
    // La librairie est tenue depuis le mois d'avant, sans rien écrit : un mois sans écriture, urgent.
    const librairie = await client('Librairie Ennour', 'Amel Nouri', 'Amel', moisAvant);
    const menuiserie = await client('Menuiserie Ben Ali', 'Hédi Ben Ali', 'Hédi');
    const garage = await client('Garage Triki', 'Sami Triki', 'Sami');
    expect((await api('PUT', `/entreprises/${garage.ent}/compta/declarations/${moisFini}`, associe, { cases: { tvaCollectee: '19,024' } })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${garage.ent}/compta/declarations/${moisFini}/pointer`, associe, { quoi: 'deposee', le: `${moisFini}-28` })).statut).toBe(200);
    // La menuiserie est confiée à Rim (sa saisie).
    const eq = (await api('GET', `/cabinets/${cab.id}/equipe`, associe)).corps as { membres: { membre: string; nom: string }[] };
    const membreRim = eq.membres.find((m) => m.nom === 'Rim Toumi')?.membre;
    expect(membreRim).toBeTruthy();
    expect((await api('PUT', `/cabinets/${cab.id}/mandats/${menuiserie.mandat}/affectations/${membreRim}`, associe, { role: 'saisie' })).statut).toBeLessThan(300);
    return { associe, cab, librairie, menuiserie, garage };
  }
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
  };

  it('une page : À faire, la campagne du mois, la grille, la charge ; une personne vaut pour toute la page', async () => {
    const { associe, cab, menuiserie } = await unCabinet();
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));

    // L'ancien lien des Priorités mène au Tableau de bord ; la barre n'a plus qu'une entrée, avec le chiffre des urgents.
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/priorites`);
    await p.locator('#page-bord #tb-grille').waitFor({ timeout: 20_000 });
    await plusTard(p);
    expect(p.url()).toMatch(/#\/production$/);
    expect(await p.locator('#page-bord h1').innerText()).toMatch(/^Tableau de bord/);
    const routes = await p.locator('#nav .nav-quotidien > a.lien').evaluateAll((l) => l.map((a) => (a as HTMLElement).dataset.route));
    expect(routes).toEqual(['production', 'pieces', 'echeances', 'messages']);
    const urgents = await p.locator('#tb-afaire [data-priorite^="u:"]').count();
    expect(await p.locator('#nav-production').innerText()).toBe(urgents ? String(urgents) : '');

    // Le travail de qui : tout le cabinet, puis chacun avec les dossiers qu'il suit (rien n'est confié à Leïla).
    expect((await p.locator('.tb-qui [data-tb-qui]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '))).toEqual(['Tout le cabinet', 'Leïla 0', 'Rim 1']);
    expect(await p.locator('.tb-qui [data-tb-qui=""]').getAttribute('aria-pressed')).toBe('true');

    // « À voir » se replie derrière son nombre quand il y a de l'urgent, et se déplie d'un clic.
    expect(urgents).toBeGreaterThan(0);
    expect(await p.locator('#tb-afaire .afaire-ligne').filter({ hasText: 'Librairie Ennour' }).innerText()).toMatch(/1 mois sans écriture/);
    const avoir = p.locator('#tb-avoir');
    expect(await avoir.getAttribute('aria-expanded')).toBe('false');
    expect(await p.locator('#tb-afaire [data-priorite^="v:"]').count()).toBe(0);
    await avoir.click();
    expect(await p.locator('#tb-avoir').getAttribute('aria-expanded')).toBe('true');
    expect(await p.locator('#tb-afaire [data-priorite^="v:"]').count()).toBeGreaterThan(0);

    // La campagne du mois : le garage a déposé, les deux autres non ; l'anneau dit 1 sur 3.
    const camp = p.locator('#tb-campagne');
    expect(await camp.locator('.tb-h-v').innerText()).toMatch(/^1\s*sur 3$/);
    expect(await camp.locator('.tb-h-titre').innerText()).toMatch(/^Déclarations d(e |')\S+$/);
    expect(await camp.innerText()).toMatch(/À VÉRIFIER/);
    expect(await camp.locator('[data-tb-etape="fini"] .tb-et-n').innerText()).toBe('1');
    expect(await camp.locator('[data-tb-etape="fini"] .tb-et-noms').innerText()).toBe('Garage Triki');
    // Un clic sur « Déposée » ne garde que le garage dans la grille, et la puce le dit ; elle le retire d'un clic.
    await camp.locator('[data-tb-etape="fini"]').click();
    const lignes = () => p.locator('#tb-grille tbody tr[data-tb-id] td.cl b').allInnerTexts();
    await expect.poll(lignes).toEqual(['Garage Triki']);
    expect(await p.locator('.tb-p-et').innerText()).toMatch(/: déposée\s*1/);
    await p.locator('.tb-p-et').click();
    await expect.poll(async () => (await lignes()).length).toBe(3);
    await p.screenshot({ path: path.join(PHOTOS, 'tableau-de-bord-1.png'), fullPage: true });

    // Rim : la grille ne garde que la menuiserie ; « À faire » ne parle plus que d'elle ; la charge la surligne.
    await p.locator('.tb-qui [data-tb-qui]').filter({ hasText: 'Rim' }).click();
    await expect.poll(lignes).toEqual(['Menuiserie Ben Ali']);
    // (Une ligne du cabinet entier, sans dossier, comme « On est le 30 : relancer », reste.)
    expect(await p.locator('#tb-afaire .afaire-ligne').filter({ hasText: 'Librairie Ennour' }).count()).toBe(0);
    for (const t of await p.locator('#tb-afaire .afaire-ligne:not(:has(.marque-s.cab)) .afaire-txt').allInnerTexts()) expect(t).toMatch(/Menuiserie Ben Ali/);
    expect(await p.locator('.tb-qui [data-tb-qui]').filter({ hasText: 'Rim' }).getAttribute('aria-pressed')).toBe('true');
    await p.locator('.tb-qui [data-tb-qui=""]').click();
    await expect.poll(async () => (await lignes()).length).toBe(3);

    // La charge de chacun : Rim saisit la menuiserie.
    const charge = p.locator('#tb-charge');
    expect(await charge.locator('.top-l').filter({ hasText: 'Rim Toumi' }).innerText()).toMatch(/saisie/);

    // La recherche qui ne trouve rien le dit, et « Effacer la recherche » rend la grille.
    await p.locator('#tb-q').fill('zzz');
    await expect.poll(() => p.locator('#tb-vide').innerText().catch(() => '')).toMatch(/^Aucun dossier ne s'appelle « zzz »/);
    await p.locator('#tb-q-effacer').click();
    await expect.poll(async () => (await lignes()).length).toBe(3);
    await p.locator('#tb-q').fill('menuis');
    await expect.poll(lignes).toEqual(['Menuiserie Ben Ali']);
    expect(await p.locator('#tb-q').evaluate((i) => i === document.activeElement)).toBe(true);
    await p.locator('#tb-q').fill('');

    // Le menu ⋯ d'une ligne : sa comptabilité, ses échéances, écrire au contact, sa fiche.
    const ligneM = p.locator('#tb-grille tbody tr[data-tb-id]').filter({ hasText: 'Menuiserie Ben Ali' });
    await expect.poll(() => ligneM.count()).toBe(1);
    await ligneM.locator('.tb-trois').click();
    const menu = p.locator('.row-menu');
    await expect.poll(() => menu.innerText().catch(() => '')).toMatch(/Ouvrir sa comptabilité/);
    expect(await menu.innerText()).toMatch(/Écrire à Hédi/);
    expect(await menu.innerText()).toMatch(/suivi par Rim/i);
    await menu.getByRole('menuitem').filter({ hasText: 'Sa fiche' }).click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/dossier/${menuiserie.ent}`);

    // La ligne ouvre la comptabilité du client.
    await p.evaluate(() => { location.hash = '#/production'; });
    await p.locator('#tb-grille').waitFor({ timeout: 15_000 });
    await p.locator('#tb-grille tbody tr[data-tb-id]').filter({ hasText: 'Menuiserie Ben Ali' }).locator('td.cl').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/dossier/${menuiserie.ent}/comptabilite`);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);

  it('au téléphone : rien ne déborde, la grille défile dans son cadre, l\'onglet du bas s\'appelle « Tableau »', async () => {
    const { associe, cab } = await unCabinet();
    const cx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}`);
    await p.locator('#page-bord #tb-grille').waitFor({ timeout: 20_000 });
    await plusTard(p);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await p.locator('#bandeau-ordinateur').count()).toBe(0);
    await expect.poll(() => p.locator('.sb-onglets .sb-onglet[aria-current="page"] .nom').innerText()).toBe('Tableau');
    // La grille, plus large que l'écran, défile dans son cadre.
    expect(await p.locator('#tb-dossiers .lf-tab').evaluate((e) => getComputedStyle(e).overflowX)).toBe('auto');
    // Au doigt, le menu ⋯ d'une ligne se touche (44 points).
    const bouton = await p.locator('#tb-grille .tb-trois').first().boundingBox();
    expect(Math.round(bouton?.height ?? 0)).toBeGreaterThanOrEqual(44);
    expect(Math.round(bouton?.width ?? 0)).toBeGreaterThanOrEqual(44);
    await p.screenshot({ path: path.join(PHOTOS, 'tableau-de-bord-tel.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
