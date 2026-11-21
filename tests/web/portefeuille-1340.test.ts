// (1.340.0) Le portefeuille du Cabinet (« Tous les dossiers ») et le pont, joué par Leïla avant d'être écrit ici :
//   - « Pièces manquantes » ne réclame qu'un mois dont rien n'est arrivé : un client dont les écritures sont là (le cabinet
//     n'a pas déposé) n'y est pas, ni un client qui a envoyé des pièces par « Mon comptable » — sa ligne dit « 1 pièce
//     reçue, à classer » et son menu « Classer sa pièce » ;
//   - « Relancer le suivant… » saute le client déjà relancé aujourd'hui ;
//   - « Ajouter un client… » demande avant de créer un client déjà au portefeuille (casse et accents mis à part) ;
//   - « Archiver le dossier… » pose sa question, puis laisse « Annuler » ; un archivé se lit et s'exporte.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le portefeuille du Cabinet et le pont (1.340.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-pf1340-'));
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
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();


  it('(1.340.0) « Pièces manquantes » ne réclame que ce qui manque ; « Relancer » saute le relancé du jour ; un doublon se demande ; l\'archivage se montre', async () => {
    const { jeton: associe } = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    // Le mois d'avant le dernier mois fini : sa date limite (le 28 du mois suivant) est toujours passée.
    const echu = (() => { const d = new Date(); let a = d.getUTCFullYear(), m = d.getUTCMonth() - 1; if (m < 1) { m += 12; a -= 1; } return `${a}-${String(m).padStart(2, '0')}`; })();
    const client = async (nom: string, gerant: string, ecrire: boolean, relance = false) => {
      const { jeton: j } = await personne(gerant);
      const ent = String((await api('POST', '/entreprises', j, { raisonSociale: nom })).corps.id);
      const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, j, { codeCabinet: cab.code })).corps.mandat);
      expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
      if (ecrire) for (const m of [echu, moisFini]) {
        expect((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: `${m}-14`, journal: 'OD', piece: `OD-${m}`, libelle: 'Honoraires',
          lignes: [{ compte: '6226', debit: '100,125' }, { compte: '401', credit: '100,125' }] })).statut).toBe(201);
      }
      expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, associe, { contenu: { contact: gerant.split(' ')[0], forme: 'SARL', from: echu,
        ...(relance ? { relances: [{ at: Date.now(), via: 'tel', months: [echu], note: 'appelé ce matin' }] } : {}) }, revision: null })).statut).toBeLessThan(300);
      return { ent, gerant: j };
    };
    const atelier = await client('Atelier Numérique Sfax', 'Karim Ben Salah', false, true);
    const cafe = await client('Café Dar Zitouna', 'Walid Ferchichi', false);
    const garage = await client('Garage Triki', 'Sami Triki', true);
    const librairie = await client('Librairie Ennour', 'Amel Nouri', false);
    const photo = await api('POST', `/entreprises/${cafe.ent}/messages/fichiers`, cafe.gerant, { cote: 'entreprise', nom: 'ticket-carburant.png', contenu: PNG });
    expect((await api('POST', `/entreprises/${cafe.ent}/messages`, cafe.gerant, { cote: 'entreprise', texte: '', fichier: photo.corps.id })).statut).toBe(201);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossiers`);
    await p.locator('#page-tb tr[data-id]').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    const ligneDe = (ent: string) => p.locator(`#page-tb tr[data-id="${ent}"]`);

    // Le café a envoyé sa photo : sa ligne le dit, et son lien mène à ses pièces.
    await expect.poll(async () => net(await ligneDe(cafe.ent).locator('.cd-pc').innerText().catch(() => '')), { timeout: 15_000 }).toBe('1 pièce reçue, à classer');
    expect(await ligneDe(cafe.ent).locator('.cd-pc').getAttribute('href')).toBe(`#/pieces/${cafe.ent}`);
    // « Pièces manquantes » : l'atelier (relancé ce matin) et la librairie ; ni le garage (ses écritures sont là), ni le café.
    await p.locator('[data-cd-vue="manque"]').click();
    await expect.poll(async () => (await p.locator('#page-tb tr[data-id]').evaluateAll((t) => t.map((x) => x.getAttribute('data-id')))).sort().join(','), { timeout: 15_000 })
      .toBe([atelier.ent, librairie.ent].sort().join(','));
    expect(net(await p.locator('.cd-rt').innerText())).toContain('Café Dar Zitouna a envoyé des pièces : elles attendent d\'être classées.');
    // « Relancer le suivant… » saute l'atelier, relancé aujourd'hui : il écrit à la librairie.
    await p.locator('#cd-relancer-tous').click();
    await expect.poll(async () => net(await p.locator('#modal-root h2').last().innerText().catch(() => '')), { timeout: 10_000 }).toBe('Relancer Librairie Ennour');
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('#modal-root .modal').count(), { timeout: 10_000 }).toBe(0);

    // « Tous » : le menu du garage ne propose pas de le relancer ; celui du café propose de classer sa pièce.
    await p.locator('[data-cd-vue="tous"]').click();
    await ligneDe(garage.ent).locator('[data-cd-menu]').click();
    await expect.poll(() => p.locator('.cd-menu [data-cd-geste="ouvrir"]').count(), { timeout: 10_000 }).toBe(1);
    expect(await p.locator('.cd-menu [data-cd-geste="relancer"]').count()).toBe(0);
    await ligneDe(cafe.ent).locator('[data-cd-menu]').click();
    await expect.poll(async () => net(await p.locator('.cd-menu [data-cd-geste="pieces"] .rm-l').innerText().catch(() => '')), { timeout: 10_000 }).toBe('Classer sa pièce');

    // (CABPORTEFEUILLE-7) « Archiver le dossier… » est un geste à part : une question qui dit ce qu'il fait, puis « Annuler ».
    await p.locator('.cd-menu [data-cd-geste="archiver"]').click();
    await expect.poll(async () => net(await p.locator('#modal-root h2').last().innerText().catch(() => '')), { timeout: 10_000 }).toBe('Archiver Café Dar Zitouna ?');
    expect(await p.locator('#modal-root #f-name').count()).toBe(0);
    expect(net(await p.locator('#modal-root .modal').last().innerText())).toContain('Il se lit et s\'exporte toujours');
    await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Archiver le dossier' }).click();
    await expect.poll(() => p.locator('#toast .toast-txt').innerText().catch(() => ''), { timeout: 10_000 }).toBe('Dossier archivé : Café Dar Zitouna');
    await expect.poll(() => ligneDe(cafe.ent).count(), { timeout: 10_000 }).toBe(0);
    await p.locator('#toast .toast-undo').click();
    await expect.poll(() => ligneDe(cafe.ent).count(), { timeout: 10_000 }).toBe(1);
    // On le réarchive pour de bon, par le même geste.
    await ligneDe(cafe.ent).locator('[data-cd-menu]').click();
    await p.locator('.cd-menu [data-cd-geste="archiver"]').click();
    await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Archiver le dossier' }).click();
    await expect.poll(() => ligneDe(cafe.ent).count(), { timeout: 10_000 }).toBe(0);

    // (CABPORTEFEUILLE-8) Ouvert en lecture, un archivé reste celui qu'on regarde, ne réclame plus rien, et s'exporte en entier.
    await p.locator('[data-cd-vue="archives"]').click();
    await ligneDe(cafe.ent).getByRole('button', { name: 'Ouvrir en lecture' }).click();
    await p.locator('#page-fd').waitFor({ timeout: 15_000 });
    await expect.poll(async () => net(await p.locator('#b-dossier').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/Café Dar Zitouna[\s\S]*archivé · en lecture/);
    expect(await p.locator('#page-fd .fd-m.pc, #page-fd .fd-m.manque').count()).toBe(0);
    expect(await p.locator('#page-fd .fd-leg-r').count()).toBe(0);
    await p.locator('#fd-export').click();
    await expect.poll(() => p.url(), { timeout: 10_000 }).toMatch(new RegExp(`#/dossier/${cafe.ent}/classeur`));
    await expect.poll(async () => net(await p.locator('#modal-root #ex-t').innerText().catch(() => '')), { timeout: 15_000 }).toContain('Exporter le classeur de Café Dar Zitouna');
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('#modal-root .modal').count(), { timeout: 10_000 }).toBe(0);
    await p.evaluate((e) => { location.hash = `#/dossier/${e}`; }, cafe.ent);
    await p.locator('#page-fd [data-cd-geste="archiver"]').click();
    await expect.poll(async () => net(await p.locator('#modal-root h2').last().innerText().catch(() => '')), { timeout: 10_000 }).toBe('Désarchiver Café Dar Zitouna ?');
    await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Désarchiver le dossier' }).click();
    await expect.poll(() => p.locator('#toast .toast-txt').innerText().catch(() => ''), { timeout: 10_000 }).toBe('Dossier désarchivé : Café Dar Zitouna');
    await p.evaluate(() => { location.hash = '#/dossiers'; });
    await p.locator('#page-tb tr[data-id]').first().waitFor({ timeout: 20_000 });

    // « Ajouter un client… » : « garage TRIKI » est déjà au portefeuille ; « Ouvrir son dossier » y mène, rien n'est créé.
    await p.locator('#new-d').click();
    await p.locator('#f-name').fill('garage TRIKI');
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => net(await p.locator('#modal-root h2').last().innerText().catch(() => '')), { timeout: 10_000 }).toBe('Garage Triki est déjà dans ton portefeuille');
    await p.locator('#dq-ouvrir').click();
    await expect.poll(() => p.url(), { timeout: 10_000 }).toMatch(new RegExp(`#/dossier/${garage.ent}$`));
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossiers`);
    await p.locator('#page-tb tr[data-id]').first().waitFor({ timeout: 20_000 });
    expect(await p.locator('#page-tb tr[data-id]').count()).toBe(4);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
