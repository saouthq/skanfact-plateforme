// L'Accueil d'une entreprise qui travaille déjà (1.139.0 ; UX 3, web/v10/accueil-au-travail.txt). À la souris, dans un
// vrai navigateur. Ce que le parcours vérifie :
//   - avant la première facture émise : la porte de la bienvenue et « Tes premiers pas » en entier, en tête ;
//   - une facture émise : plus de porte ; l'« À faire » et les quatre chiffres d'abord, puis seulement les premiers pas
//     qui restent (les faits se comptent dans la jauge), puis le graphique.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('l\'Accueil d\'une entreprise qui travaille déjà', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-accueil-'));
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
  // L'ordre des grands blocs de l'Accueil, de haut en bas.
  const blocs = (p: Page) => p.evaluate(() => {
    const vus: string[] = [];
    const nom = (e: Element) => e.matches('.pp-accueil') ? 'bienvenue' : e.matches('.premiers-pas') ? 'premiers-pas'
      : e.matches('.stats') ? 'chiffres' : e.matches('.a-graph, .dash-grid') ? 'graphique' : /À faire/.test(e.querySelector('h2')?.textContent ?? '') ? 'a-faire' : '';
    // (1.156.0, maquette « Accueil ») « À faire » et le graphique vivent dans la colonne de gauche, sous les chiffres.
    for (const e of Array.from(document.querySelectorAll('#view > *, #view > .a-deux > .a-g > *'))) { const n = nom(e); if (n) vus.push(n); }
    return vus;
  });

  it('avant la première facture, la bienvenue en tête ; une facture émise, l\'À faire et les chiffres d\'abord, puis ce qui reste', async () => {
    const email = `sarra-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra Mansour', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
    const fiche = { id: 'c1', name: 'Hôtel Les Oliviers', matricule: '', address: '', email: '', phone: '', currency: 'DT' };
    const facture = {
      id: 'f1', type: 'facture', number: '', date: aujourdhui, dueDate: aujourdhui, clientId: 'c1', subject: 'Pain', status: 'brouillon',
      lines: [{ label: 'Pain de mie', description: '', qty: 3, unit: '', unitPrice: { '~n': '74.333' }, vatRate: 7 }],
      discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [],
    };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: fiche },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: facture }] })).statut).toBe(200);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const ouvrir = async () => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
      await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };

    // Une facture en brouillon seulement : le métier n'a pas commencé.
    await ouvrir();
    await expect.poll(() => blocs(p), { timeout: 15_000 }).toEqual(expect.arrayContaining(['bienvenue', 'premiers-pas']));
    const avant = await blocs(p);
    expect(avant.indexOf('premiers-pas')).toBeLessThan(Math.max(avant.indexOf('chiffres'), avant.indexOf('graphique')));
    expect(await p.locator('.premiers-pas li.fait').count()).toBeGreaterThan(0);

    // La facture émise : plus de porte ; l'À faire et les chiffres d'abord ; seulement ce qui reste.
    expect((await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: facture, client: fiche, revision: 1, rang: 0, netAPayer: '238.609' })).statut).toBe(200);
    await ouvrir();
    await expect.poll(() => blocs(p), { timeout: 15_000 }).toContain('chiffres');
    const apres = await blocs(p);
    expect(apres).not.toContain('bienvenue');
    expect(apres.indexOf('chiffres')).toBeLessThan(apres.indexOf('premiers-pas'));
    expect(apres.indexOf('premiers-pas')).toBeLessThan(apres.indexOf('graphique'));
    if (apres.includes('a-faire')) expect(apres.indexOf('chiffres')).toBeLessThan(apres.indexOf('a-faire'));
    expect(await p.locator('.premiers-pas li.fait').count()).toBe(0);
    const tete = (await p.locator('.premiers-pas .pp-tete').innerText()).replace(/\s+/g, ' ');
    expect(tete).toMatch(/Ta gestion tourne déjà\. Reste(nt \d+ gestes| un geste), quand tu veux/);
    const m = /(\d+) sur (\d+) faits/.exec(tete);
    expect(m).not.toBeNull();
    const [faits, total] = [Number(m?.[1]), Number(m?.[2])];
    expect(await p.locator('.premiers-pas li').count()).toBe(total - faits);
    // (1.147.0) Les chiffres qui valent zéro le disent en mots, pas « 0 en retard » ni « 0 devis envoyé ».
    expect((await p.locator('[data-stat=encaisser] .sub').innerText()).replace(/\s+/g, ' ').trim()).toBe('DT · 1 facture');
    expect((await p.locator('[data-stat=encaisser] .x').innerText()).replace(/\s+/g, ' ').trim()).toBe('rien en retard');
    expect((await p.locator('[data-stat=devis] .sub').innerText()).replace(/\s+/g, ' ').trim()).toBe('aucun devis en attente de réponse');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
