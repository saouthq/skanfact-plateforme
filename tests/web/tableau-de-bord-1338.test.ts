// (1.338.0) Le Tableau de bord du Cabinet et le pont : les pièces que le client envoie par « Mon comptable », et celles que
// le cabinet dépose pour lui, comptent dans la campagne du mois, la grille, la fiche d'un mois et « Quand les pièces
// arrivent » ; la campagne nomme les personnes physiques, dues le 15. Joué à la souris (Leïla) avant d'être écrit ici.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le Tableau de bord du Cabinet et le pont (1.338.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-tb1338-'));
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
  const moisFini = (() => { const d = new Date(); const a = d.getUTCFullYear(), m = d.getUTCMonth(); return m === 0 ? `${a - 1}-12` : `${a}-${String(m).padStart(2, '0')}`; })();

  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
  };

  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n').toString('base64');
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();

  // (1.338.0) Le Tableau de bord et le pont, joués par Leïla. Café Dar Zitouna n'écrit rien : il envoie la photo de son
  // ticket par « Mon comptable ». La librairie n'écrit rien non plus : le cabinet dépose pour elle la facture reçue sur
  // WhatsApp. Le garage a une écriture ; le studio photo aussi, et c'est une personne physique (déclaration due le 15) ;
  // l'atelier dépose sa TVA au trimestre.
  // Avant : la campagne disait les deux premiers « Sans pièces », la grille « pièces manquantes », le panneau des arrivées
  // « aucune pièce », et « 3 pas encore prêtes » taisait le studio, dû avant les autres.
  it('(1.338.0) les pièces envoyées comptent dans la campagne, la grille, la fiche du mois et leurs arrivées ; la personne physique due le 15 se nomme', async () => {
    const { jeton: associe } = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const client = async (nom: string, gerant: string, forme: string, ecrire: boolean, tvaPeriod = '') => {
      const { jeton: j } = await personne(gerant);
      const ent = String((await api('POST', '/entreprises', j, { raisonSociale: nom })).corps.id);
      const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, j, { codeCabinet: cab.code })).corps.mandat);
      expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
      if (ecrire) {
        expect((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: `${moisFini}-14`, journal: 'OD', piece: 'OD-1', libelle: 'Honoraires',
          lignes: [{ compte: '6226', debit: '100,125' }, { compte: '401', credit: '100,125' }] })).statut).toBe(201);
      }
      expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, associe, { contenu: { contact: gerant.split(' ')[0], forme, from: moisFini, ...(tvaPeriod ? { tvaPeriod } : {}) }, revision: null })).statut).toBeLessThan(300);
      return { ent, gerant: j };
    };
    // L'atelier dépose sa TVA au trimestre : son mois se déclare plus tard, la campagne ne prend pas sa date.
    const atelier = await client('Atelier Numérique Sfax', 'Karim Ben Salah', 'SUARL', true, 'trimestrielle');
    const cafe = await client('Café Dar Zitouna', 'Walid Ferchichi', 'SUARL', false);
    const librairie = await client('Librairie Ennour', 'Amel Nouri', 'SARL', false);
    const garage = await client('Garage Triki', 'Sami Triki', 'SUARL', true);
    const studio = await client('Studio Photo Lumière', 'Ines Gharbi', 'Personne physique', true);
    const photo = await api('POST', `/entreprises/${cafe.ent}/messages/fichiers`, cafe.gerant, { cote: 'entreprise', nom: 'ticket-carburant.png', contenu: PNG });
    expect((await api('POST', `/entreprises/${cafe.ent}/messages`, cafe.gerant, { cote: 'entreprise', texte: '', fichier: photo.corps.id })).statut).toBe(201);
    expect((await api('POST', `/cabinets/${cab.id}/classeur/${librairie.ent}/documents`, associe,
      { rubrique: 'piece', periode: moisFini, titre: 'Facture STEG', provenance: 'WhatsApp d\'Amel', nom: 'steg.pdf', contenu: PDF })).statut).toBeLessThan(300);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/production`);
    await p.locator('#page-bord #tb-grille').waitFor({ timeout: 20_000 });
    await plusTard(p);

    // La campagne du mois fini : les deux clients qui ont envoyé des pièces sont « À saisir », personne n'est « Sans pièces ».
    const etape = (e: string) => p.locator(`#tb-campagne [data-tb-etape="${e}"]`);
    await expect.poll(async () => String(await etape('saisi').getAttribute('title')).split(', ').sort().join(' | '), { timeout: 15_000 })
      .toBe('Café Dar Zitouna | Librairie Ennour');
    expect(await etape('recu').locator('.tb-et-n').innerText()).toBe('0');
    expect(String(await etape('revise').getAttribute('title')).split(', ').sort().join(' | ')).toBe('Atelier Numérique Sfax | Garage Triki | Studio Photo Lumière');
    // Les trois autres dossiers, puis la personne physique, due le 15 du mois (avant eux), en retard après le 15.
    const auj = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
    const jour = Number(auj.slice(8, 10)), mm = auj.slice(5, 7);
    const autres = jour === 28 ? '4 ne le seront pas aujourd\'hui' : '4 pas encore prêtes';
    const pp = jour < 15 ? `1 personne physique au 15/${mm}, dans ${15 - jour} jour${15 - jour > 1 ? 's' : ''}` : jour === 15 ? `1 personne physique au 15/${mm}, aujourd'hui` : `1 dossier au 15/${mm} déjà en retard`;
    expect(net((await p.locator('#tb-campagne .tb-h-pp').innerText()).split('\n')[0] ?? '')).toBe(`aucune prête à déposer · ${autres} · ${pp}`);
    // La date limite : le 28 de ce mois, celle des dossiers mensuels — pas celle du trimestre de l'atelier, en premier dans la liste.
    const semaine = new Date(`${auj.slice(0, 7)}-28T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long' });
    expect(net(await p.locator('#tb-campagne .tb-h-quand').innerText())).toBe(jour < 28 ? `Date limite ${semaine} 28/${mm} · dans ${28 - jour} jour${28 - jour > 1 ? 's' : ''}`
      : jour === 28 ? 'Aujourd\'hui, la date limite de 4 dossiers' : `Date limite passée le 28/${mm} · 4 dossiers en retard`);

    // La grille : le mois fini des deux clients est « à saisir », avec ses pièces ; « Pièces manquantes » n'en compte aucun.
    for (const [ent, n] of [[cafe.ent, '1 pièce reçue, à classer'], [librairie.ent, '1 pièce reçue, à classer']] as const) {
      const c = p.locator(`#tb-grille tr[data-tb-id="${ent}"] [data-tb-case="${moisFini}"]`);
      expect(await c.locator('.prod-p').getAttribute('class')).toMatch(/\bprod-saisi\b/);
      expect(await c.getAttribute('title')).toContain(n);
    }
    expect(net(await p.locator('[data-tb-filtre="manque"]').innerText())).toBe('Pièces manquantes 0');
    expect(net(await p.locator('[data-tb-filtre="saisir"]').innerText())).toBe('À saisir 2');

    // Le menu ⋯ de Café ne propose plus de lui réclamer un mois dont les pièces sont là ; lui écrire, oui.
    await p.locator(`#tb-grille tr[data-tb-id="${cafe.ent}"] [data-rowmenu]`).click();
    const menu = p.locator('.row-menu');
    await menu.waitFor({ timeout: 10_000 });
    expect(await menu.getByText('Écrire à Walid', { exact: true }).count()).toBe(1);
    expect(await menu.getByText('Relancer', { exact: true }).count()).toBe(0);
    await p.keyboard.press('Escape');
    await expect.poll(() => menu.count()).toBe(0);

    // La fiche du mois de Café : ses pièces sont reçues, à classer ; le geste les ouvre dans « Pièces reçues ».
    await p.locator(`#tb-grille tr[data-tb-id="${cafe.ent}"] [data-tb-case="${moisFini}"]`).click();
    const fiche = p.locator('#tb-fiche');
    await fiche.waitFor({ timeout: 10_000 });
    expect(net(await fiche.locator('.tb-mc-et li').first().innerText())).toBe('✓ Pièces reçues 1 pièce reçue, à classer');
    expect(await fiche.locator('.tb-mc-a .btn-primary').innerText()).toBe('Classer la pièce');

    // Quand les pièces arrivent : la photo de Café et la pièce déposée pour la librairie arrivent aujourd'hui, pour le mois fini.
    const bloc = p.locator('#tb-arrivee');
    await expect.poll(() => bloc.locator(`.tb-ar-l[data-tb-ar="${cafe.ent}"] small`).innerText().catch(() => ''), { timeout: 15_000 })
      .toBe(`en moyenne le ${jour} · au plus tard le ${jour}`);
    expect(await bloc.locator(`.tb-ar-l[data-tb-ar="${librairie.ent}"] small`).innerText()).toBe(`en moyenne le ${jour} · au plus tard le ${jour}`);
    expect(await bloc.locator(`.tb-ar-l[data-tb-ar="${cafe.ent}"] .tb-ar-rien`).count()).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'tableau-de-bord-1338.png'), fullPage: true });

    await fiche.locator('.tb-mc-a .btn-primary').click();
    await expect.poll(() => p.url()).toMatch(new RegExp(`#/pieces/${cafe.ent}$`));
    expect(erreurs).toEqual([]);
    void garage; void studio; void atelier;
    await cx.close();
  }, 180_000);
});
