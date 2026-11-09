// (1.341.0) L'export des écritures du Cabinet, joué par Leïla avant d'être écrit ici :
//   - la page s'ouvre sur le dernier mois FINI qui a des écritures, jamais sur le mois en cours, et « Le dernier mois
//     fini » y ramène ;
//   - les clients sans écriture se disent par ce qui les attend : tenu au cabinet (à saisir), des pièces reçues (à
//     classer), rien reçu (à relancer) — et rien ne se relance sur un mois qui n'est pas fini.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('l\'export des écritures du Cabinet (1.341.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-ex1341-'));
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



  it('(1.341.0) l\'export s\'ouvre sur le dernier mois fini ; les clients sans écriture se disent par ce qui les attend', async () => {
    const { jeton: associe } = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    // Le mois en cours du navigateur (Tunis), celui que l'écran tient pour « pas fini ».
    const enCours = new Date().toLocaleDateString('fr-CA', { timeZone: 'Africa/Tunis' }).slice(0, 7);
    const client = async (nom: string, gerant: string, mois: string[]) => {
      const { jeton: j } = await personne(gerant);
      const ent = String((await api('POST', '/entreprises', j, { raisonSociale: nom })).corps.id);
      const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, j, { codeCabinet: cab.code })).corps.mandat);
      expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
      for (const m of mois) {
        expect((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: `${m}-01`, journal: 'OD', piece: `OD-${m}`, libelle: 'Honoraires',
          lignes: [{ compte: '6226', debit: '100,125' }, { compte: '401', credit: '100,125' }] })).statut).toBe(201);
      }
      expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, associe, { contenu: { contact: gerant.split(' ')[0], forme: 'SARL', from: moisFini }, revision: null })).statut).toBeLessThan(300);
      return { ent, gerant: j };
    };
    // Le garage a des écritures le mois fini ET ce mois-ci ; le café envoie une photo ; la librairie n'envoie rien ;
    // la menuiserie est tenue au cabinet.
    await client('Garage Triki', 'Sami Triki', [moisFini, enCours]);
    const cafe = await client('Café Dar Zitouna', 'Walid Ferchichi', []);
    await client('Librairie Ennour', 'Amel Nouri', []);
    expect((await api('POST', `/cabinets/${cab.id}/dossiers`, associe, { raisonSociale: 'Menuiserie du Sahel' })).statut).toBeLessThan(300);
    const photo = await api('POST', `/entreprises/${cafe.ent}/messages/fichiers`, cafe.gerant, { cote: 'entreprise', nom: 'ticket-carburant.png', contenu: PNG });
    expect((await api('POST', `/entreprises/${cafe.ent}/messages`, cafe.gerant, { cote: 'entreprise', texte: '', fichier: photo.corps.id })).statut).toBe(201);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/ecritures`);
    await p.locator('#e-from').waitFor({ timeout: 20_000 });
    await plusTard(p);
    const lignes = async () => (await p.locator('#view .panel ul.small li').allInnerTexts()).map(net);

    // Le dernier mois fini, et non le mois en cours (qui a pourtant une écriture du garage).
    expect(await p.locator('#e-from').inputValue()).toBe(moisFini);
    expect(await p.locator('#e-to').inputValue()).toBe(moisFini);
    expect(net(await p.locator('#e-last').innerText())).toBe('Le dernier mois fini');
    await expect.poll(lignes, { timeout: 15_000 }).toEqual([
      'Tenu au cabinet, à saisir par toi : Menuiserie du Sahel',
      'Des pièces reçues, à classer : Café Dar Zitouna · Les classer',
      'Rien reçu : Librairie Ennour · Les relancer',
    ]);
    expect(await p.locator('#view .panel ul.small a[href="#/relances"]').count()).toBe(1);

    // Le mois en cours : rien ne se relance.
    await p.locator('#e-to').selectOption(enCours);
    await p.locator('#e-from').selectOption(enCours);
    await expect.poll(async () => (await lignes()).at(-1), { timeout: 10_000 }).toBe('Le mois n\'est pas fini : Librairie Ennour');
    expect(await p.locator('#view .panel ul.small a[href="#/relances"]').count()).toBe(0);
    // « Le dernier mois fini » y ramène.
    await p.locator('#e-last').click();
    await expect.poll(() => p.locator('#e-from').inputValue(), { timeout: 10_000 }).toBe(moisFini);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
