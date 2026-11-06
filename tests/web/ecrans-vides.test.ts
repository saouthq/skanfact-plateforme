// Les premiers écrans de chaque module, au modèle des maquettes (1.265.0, Skander 03/11/2026 : « les écrans vides, fais-les
// comme celles des maquettes précédentes, afin de garder la même DA »). Une entreprise neuve ouvre chaque module : la carte
// est celle de Factures, Devis, Clients et Fournisseurs — l'icône, le titre, le texte, les boutons dont le premier est le
// seul principal, et à droite les étapes qui suivent. Une phrase grise sous un titre, sans icône, ne passe plus.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'tests/web/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

// [route, titre de la carte, nombre d'étapes à droite (0 : la carte tient sur une colonne)]
const ECRANS: [string, string, number][] = [
  ['factures', 'Réclamer l\'argent du travail fait', 3],
  ['devis', 'Proposer un prix, avant de travailler', 4],
  ['fournisseurs', 'Ceux chez qui tu achètes', 4],
  ['achats', 'Ce que tu dépenses, et la TVA que tu récupères', 4],
  ['relances', 'Relancer tes impayés', 3],
  ['catalogue', 'Ce que tu vends, prêt à reprendre', 3],
  ['listesprix', 'Des prix à part pour certains clients', 3],
  ['contrats', 'Les factures qui se répètent toutes seules', 3],
  ['commandesf', 'Ce que tu commandes à tes fournisseurs', 3],
  ['marges', 'Ce que te rapporte chaque chantier', 4],
  ['stock', 'Ce que tu as en rayon', 3],
  ['immos', 'Ce que tu gardes plusieurs années', 3],
  ['tresorerie', 'Est-ce que j\'aurai de quoi payer le mois prochain ?', 3],
  ['paie', 'Les salariés que tu paies', 4],
  ['accords', 'Aucune demande d\'accord', 0],
];

describe('les premiers écrans des modules, au modèle des maquettes', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-vides-'));
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
    return (texte ? JSON.parse(texte) : {}) as Record<string, unknown>;
  };
  const plusTard = async (p: Page) => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  it('chaque module vide montre la carte des maquettes : icône, titre, un seul bouton principal, les étapes', async () => {
    const email = `vides-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra Mansour', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await p.locator('#view h1, #view h2').first().waitFor({ timeout: 20_000 });
    await plusTard(p);

    const lu: string[] = [];
    for (const [route, titre, etapes] of ECRANS) {
      await p.evaluate((r) => { location.hash = '#/' + r; }, route);
      const carte = p.locator('#view .panel.premiere');
      await expect.poll(() => carte.locator('h2').first().innerText().then(net).catch(() => ''), { timeout: 10_000, message: route }).toBe(titre);
      // L'icône de la charte, dans sa pastille.
      expect(await carte.locator('.pr-t > .pr-ic svg').count(), route).toBe(1);
      // Les étapes, numérotées, à droite ; sans étapes, la carte tient sur une colonne.
      expect(await carte.locator('.pr-e li').count(), route).toBe(etapes);
      expect(await carte.evaluate((e) => e.classList.contains('seul')), route).toBe(etapes === 0);
      if (etapes) expect(await carte.locator('.pr-e li > b').allInnerTexts(), route).toEqual(Array.from({ length: etapes }, (_, i) => String(i + 1)));
      // Le texte n'est plus la petite phrase grise de l'ancien état vide.
      expect(await carte.locator('p.small').count(), route).toBe(0);
      // Un seul bouton principal sur la page : celui de la carte quand elle en a un.
      const verts = await p.locator('#view .btn-primary').filter({ visible: true }).count();
      expect(verts, route).toBeLessThanOrEqual(1);
      lu.push(route);
    }
    expect(lu.length).toBe(ECRANS.length);
    await p.evaluate(() => { location.hash = '#/achats'; });
    await p.locator('#view .panel.premiere .pr-e').waitFor();
    await p.screenshot({ path: path.join(PHOTOS, 'vides-achats.png') });
    // Au téléphone : une seule colonne, les étapes sous le texte.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate(() => { location.hash = '#/paie'; });
    // La carte de la PAIE (dans .pm) : celle des achats est encore là un instant sur une machine lente, et se mesurait à sa
    // place (vu sur GitHub le 06/11/2026 : la preuve « la paie garde ses deux colonnes » restait verte).
    await p.locator('#view .pm .panel.premiere .pr-e').waitFor();
    // L'écran se redessine au changement de largeur : les deux boîtes se lisent d'un coup, sur la carte affichée.
    const boites = () => p.evaluate(() => { const c = document.querySelector('#view .pm .panel.premiere'); const t = c?.querySelector('.pr-t')?.getBoundingClientRect(); const e = c?.querySelector('.pr-e')?.getBoundingClientRect(); return t && e && t.height ? { bas: t.bottom, haut: e.top } : null; });
    await expect.poll(boites).not.toBeNull();
    const b = await boites();
    if (!b) throw new Error('la carte de la paie a disparu au téléphone');
    expect(b.haut).toBeGreaterThan(b.bas - 1);
    expect(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
