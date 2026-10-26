// Une seule façon de dire un état (1.146.0 ; UX 3, docs/recette.md § 13). Le catalogue des tons, posé dans les vraies
// pages (l'entreprise et le Cabinet chargent les mêmes feuilles) :
//   - alerte (rouge) : ce qui est en retard — une facture de vente, un achat, une échéance du Cabinet ;
//   - attire (orange) : ce qui est commencé et pas fini — une facture ou un achat payé en partie ;
//   - bleu : ce qui attend son heure chez l'autre — une pièce émise, un achat à payer ;
//   - calme (gris, la charte des maquettes, 1.153.0) : rien à faire, ou plus rien — un brouillon, une pièce annulée
//     (annulée était rouge depuis la 1.146.0 : la charte la range avec ce qui est fini, pas avec ce qui coûte).
// Le même état se dit d'une seule couleur, d'un écran à l'autre.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('les tons d\'un état, un seul par état', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-tons-'));
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
    return (texte ? JSON.parse(texte) : {}) as Record<string, unknown>;
  };
  // La couleur du texte de chaque marque, posée dans la page telle que l'écran la dessine.
  const tons = (p: Page, marques: Record<string, string>) => p.evaluate((m) => {
    const boite = document.createElement('div');
    document.body.appendChild(boite);
    const r: Record<string, string> = {};
    for (const [nom, html] of Object.entries(m)) {
      boite.innerHTML = html;
      const el = boite.querySelector('[data-ton]') as HTMLElement;
      r[nom] = getComputedStyle(el).color;
    }
    boite.remove();
    return r;
  }, marques);
  const PASTILLES = {
    venteRetard: '<span class="badge retard" data-ton>en retard</span>',
    achatRetard: '<span class="badge b-late" data-ton>retard</span>',
    ventePartielle: '<span class="badge partielle" data-ton>partielle</span>',
    achatPartiel: '<span class="badge b-part" data-ton>partiel</span>',
    venteEmise: '<span class="badge émis" data-ton>émis</span>',
    achatDu: '<span class="badge b-due" data-ton>à payer</span>',
    annulee: '<span class="badge annulée" data-ton>annulée</span>',
    brouillon: '<span class="badge brouillon" data-ton>brouillon</span>',
  };

  it('à l\'entreprise et au Cabinet : en retard en rouge, partielle en orange, émise et à payer en bleu, annulée calme', async () => {
    const email = `rim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Rim Gharbi', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Librairie El Kitab' })).id);
    const cab = String((await api('POST', '/cabinets', jeton, { nom: 'Cabinet Gharbi' })).id);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/factures`);
    await p.locator('#view h1, .as-ecran').first().waitFor({ timeout: 20_000 });
    expect(new URL(p.url()).pathname).toBe('/v10/');
    const e = await tons(p, PASTILLES);
    expect(e.venteRetard).toBe(e.achatRetard);
    expect(e.annulee).toBe(e.brouillon);
    expect(e.annulee).not.toBe(e.venteRetard);
    expect(e.ventePartielle).toBe(e.achatPartiel);
    expect(e.venteEmise).toBe(e.achatDu);
    expect(new Set([e.venteRetard, e.ventePartielle, e.venteEmise, e.brouillon]).size).toBe(4);
    // (1.150.0) Un fait calme (la pièce est émise) : le constat en gras, l'explication en texte courant.
    const poids = await p.evaluate(() => {
      const d = document.createElement('div');
      d.innerHTML = '<div class="banner info lock-banner"><span><b>Cette pièce est émise.</b> <span class="tel-detail">La règle.</span></span></div>';
      document.body.appendChild(d);
      const r = [getComputedStyle(d.querySelector('b') as Element).fontWeight, getComputedStyle(d.querySelector('.tel-detail') as Element).fontWeight];
      d.remove();
      return r.map(Number);
    });
    expect(poids[0]).toBeGreaterThanOrEqual(700);
    expect(poids[1]).toBeLessThanOrEqual(400);

    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab}#/echeances`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    expect(new URL(p.url()).pathname).toBe('/v10/cabinet/');
    const c = await tons(p, { ...PASTILLES, echeanceRetard: '<div class="dc-echeance retard"><span data-ton>28/10</span></div>' });
    expect(c.echeanceRetard).toBe(c.venteRetard);
    expect(c.venteRetard).toBe(e.venteRetard);
    expect(c.ventePartielle).toBe(e.ventePartielle);
    await cx.close();
  }, 120_000);
});
