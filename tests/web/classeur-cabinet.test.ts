// Le classeur du dossier au Cabinet (maquette « Classeur », docs/maquettes/cabinet/classeur.html ; 1.171.0), à la souris.
// Ce que le parcours vérifie, le 28/10/2026 :
//   - la barre : « Tout le dossier › Le classeur » mène au classeur ;
//   - un client dont septembre attend : l'arbre (septembre « 1 à traiter », sa rubrique Achats), la liste de la rubrique, la pièce
//     ouverte à droite avec son écriture au brouillard ; la recherche (ce qui se trouve, et ce qui ne se trouve pas) ;
//   - un client dont rien n'est arrivé depuis juillet : « Août et septembre 2026 », ce qui manque, un seul « Relancer » ;
//   - les déclarations de l'année ; au téléphone : les puces des mois, rien qui déborde, pas d'avis « pensé pour un ordinateur ».

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const LE_28 = new Date('2026-10-28T10:00:00+01:00');

describe('le classeur du dossier au Cabinet, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-classeur-'));
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
  async function unCabinet() {
    const { jeton: associe } = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const client = async (nom: string, gerant: string, fiche: Record<string, unknown>) => {
      const { jeton: j } = await personne(gerant);
      const ent = String((await api('POST', '/entreprises', j, { raisonSociale: nom })).corps.id);
      const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, j, { codeCabinet: cab.code })).corps.mandat);
      expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
      expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, associe, { contenu: fiche, revision: null })).statut).toBeLessThan(300);
      return ent;
    };
    const ecrire = async (ent: string, e: Record<string, unknown>) => expect((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, e)).statut).toBe(201);
    // La boulangerie : sa mission commence en septembre ; un achat de farine au brouillard, à vérifier.
    const boulangerie = await client('Boulangerie El Amal', 'Sarra Ben Salah', { contact: 'Sarra', from: '2026-09' });
    await ecrire(boulangerie, { date: '2026-09-03', journal: 'AC', piece: 'FA-0914', libelle: 'Minoterie du Cap Bon, farine T55',
      lignes: [{ compte: '601', debit: '1551,428' }, { compte: '4366', debit: '294,772' }, { compte: '401', credit: '1846,200' }] });
    // La menuiserie : sa mission commence en août, sa dernière écriture est du 15/07 ; rien depuis.
    const menuiserie = await client('Menuiserie Ben Ali', 'Hédi Ben Ali', { contact: 'Hédi', from: '2026-08' });
    await ecrire(menuiserie, { date: '2026-07-15', journal: 'OD', piece: 'OD-1', libelle: 'Honoraires',
      lignes: [{ compte: '6226', debit: '100,000' }, { compte: '401', credit: '100,000' }] });
    return { associe, cab, boulangerie, menuiserie };
  }
  async function contexte(jeton: string, tel = false) {
    const cx = await navigateur.newContext({ viewport: tel ? { width: 390, height: 844 } : { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', ...(tel ? { isMobile: true, hasTouch: true } : {}) });
    await cx.clock.setFixedTime(LE_28);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    return { p, erreurs };
  }
  async function ouvrir(p: Page, cabinet: string, ent: string) {
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/classeur`);
    await p.locator('#page-cl .cl-res').first().waitFor({ timeout: 25_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
  }

  it('au bureau : l\'arbre, la rubrique, la pièce et son écriture ; la recherche ; des mois vides ; les déclarations', async () => {
    const { associe, cab, boulangerie, menuiserie } = await unCabinet();
    const { p, erreurs } = await contexte(associe);
    await ouvrir(p, cab.id, boulangerie);
    // La barre : « Tout le dossier » propose le classeur en premier.
    expect(await p.locator('#nav-dossier .panneau.volet a').first().getAttribute('href')).toBe(`#/dossier/${boulangerie}/classeur`);
    // L'arbre : septembre attend, sa rubrique Achats est ouverte.
    expect(await p.locator('.cl-a-m.ici').innerText()).toMatch(/Septembre\s+1 à traiter/);
    expect(await p.locator('.cl-a-m.avant').innerText()).toMatch(/Janvier à août\s+avant la mission/);
    expect(await p.locator('.cl-a-s.ici').innerText()).toMatch(/Achats\s+1/);
    expect(await p.locator('.cl-res-t').first().innerText()).toMatch(/Septembre 2026\s+1 pièce · 0 en ordre · 1 à traiter/);
    const ligne = p.locator('li[data-cl-k]').filter({ hasText: 'FA-0914' });
    expect(await ligne.innerText()).toMatch(/1\s846,200[\s\S]*à vérifier/);
    // La pièce à droite : son écriture, au brouillard, ligne par ligne.
    await ligne.click();
    const ap = p.locator('.cl-ap');
    await expect.poll(() => ap.innerText()).toMatch(/L'écriture FA-0914, au brouillard[\s\S]*601[\s\S]*1\s551,428[\s\S]*4366[\s\S]*294,772/i);
    expect(await ap.innerText()).toMatch(/Elle compte dans la déclaration de septembre, pas encore préparée\./);
    expect(await ap.getByRole('link', { name: 'La vérifier dans les écritures' }).getAttribute('href')).toBe(`#/dossier/${boulangerie}/comptabilite/saisie`);
    // La recherche : ce qui se trouve (un fournisseur), et ce qui ne se trouve pas.
    await p.locator('#cl-q').fill('minoterie');
    await expect.poll(() => p.locator('.cl-res-t').first().innerText()).toMatch(/« minoterie » dans tout le dossier\s+1 pièce, sur 2026/);
    await p.locator('#cl-q').fill('ooredoo');
    await expect.poll(() => p.locator('.cl-vide').innerText().catch(() => '')).toMatch(/Rien pour « ooredoo » dans tout le dossier/);
    await p.locator('#cl-q').fill('');
    await p.waitForTimeout(400);
    // Les déclarations de l'année.
    await p.locator('.cl-arbre [data-cl-decls]').click();
    await expect.poll(() => p.locator('.cl-res-t').first().innerText()).toMatch(/Les déclarations de 2026/);

    // Des mois vides : août et septembre ensemble, ce qui manque, une seule relance.
    await ouvrir(p, cab.id, menuiserie);
    await expect.poll(() => p.locator('.cl-res-t').first().innerText()).toMatch(/Août et septembre 2026\s+aucune pièce · la dernière écriture de Hédi date du 15\/07/);
    expect(await p.locator('li.cl-trou').allInnerTexts()).toEqual([expect.stringMatching(/^Août 2026 · ventes, achats, relevé bancaire\nen retard depuis le 28\/09 · jamais relancé/), expect.stringMatching(/^Septembre 2026 · ventes, achats, relevé bancaire\nà déposer aujourd'hui/)]);
    expect(await p.locator('#page-cl .btn-primary').allInnerTexts()).toEqual(['Relancer Hédi…']);
    expect(await p.locator('#page-cl .fd-sous').innerText()).toMatch(/rien depuis le 15\/07/);
    expect(erreurs).toEqual([]);
  });

  it('au téléphone : les puces des mois, rien ne déborde, pas d\'avis « pensé pour un ordinateur »', async () => {
    const { associe, cab, boulangerie } = await unCabinet();
    const { p, erreurs } = await contexte(associe, true);
    await ouvrir(p, cab.id, boulangerie);
    await p.waitForTimeout(800);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(await p.locator('#bandeau-ordinateur').count()).toBe(0);
    expect(await p.locator('.cl-arbre').isVisible()).toBe(false);
    expect(await p.locator('.cl-tel-m [data-cl-m][aria-pressed="true"]').innerText()).toBe('sept.');
    await p.locator('li[data-cl-k]').filter({ hasText: 'FA-0914' }).click();
    await expect.poll(() => p.locator('.cl-ap').innerText().catch(() => '')).toMatch(/L'écriture FA-0914, au brouillard/i);
    await p.getByRole('button', { name: 'Revenir à la liste' }).click();
    await expect.poll(() => p.locator('li[data-cl-k]').count()).toBe(1);
    expect(erreurs).toEqual([]);
  });
});
