// Les colonnes d'un formulaire ne s'élargissent pas pour un long nom (1.100.0, parcours du 21/10/2026). Sami fait un
// devis pour « Entreprise Générale de Bâtiment Chaabane » : la colonne du client s'élargissait au nom entier, et les
// deux dates voisines coupaient l'année (« 21/10/202 »). Les trois colonnes restent égales. (1.166.2, charte de la
// facture) Le nom a sa propre carte, au-dessus des dates : il s'y lit en entier, sans déborder.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');

describe('les colonnes d\'un formulaire, avec un long nom de client', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier_ = fs.mkdtempSync(path.join(os.tmpdir(), 'web-colonnes-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier_, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier_, livreurMs: 60_000 });
    navigateur = await chromium.launch();
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier_, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, { method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }) });
    const t = await r.text();
    return { statut: r.status, corps: (t ? JSON.parse(t) : {}) as Record<string, unknown> };
  };

  it('les deux dates d\'un devis se lisent en entier, et le long nom du client tient dans sa carte', async () => {
    const email = `sami-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sami', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Quincaillerie Trabelsi SARL' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Entreprise Générale de Bâtiment Chaabane' } },
      { collection: 'documents', cle: 'd1', rang: 0, revision: null, contenu: { id: 'd1', type: 'devis', status: 'brouillon', date: '2026-10-21', dueDate: '2026-11-20', clientId: 'c1',
        lines: [{ id: 'l1', label: 'Ciment CPA 42.5', qty: 120, unitPrice: { '~n': '18.75' }, vatRate: 19 }] } },
    ] })).statut).toBe(200);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/d1`);
    await p.locator('#f-head .datefield .d-txt').first().waitFor({ timeout: 20_000 });
    const mesure = await p.evaluate(() => {
      // (lot 4, maquette facture) La validité est une case « 30 jours · 20/11/2026 » qui ouvre son choix, plus un champ de date.
      const dates = [...document.querySelectorAll<HTMLInputElement>('#f-head .datefield .d-txt')];
      const validite = document.querySelector<HTMLElement>('#f-head #ed-ech');
      const colonnes = getComputedStyle(document.querySelector('#f-head') as HTMLElement).gridTemplateColumns.split(' ').map(parseFloat);
      const nom = document.querySelector('#f-head #ed-client .ed-cl-nom b') as HTMLElement;
      const carte = (document.querySelector('#f-head #ed-client') as HTMLElement).getBoundingClientRect();
      return { valeurs: [...dates.map((d) => d.value), (validite?.textContent ?? '').replace(/\s+/g, ' ').trim()],
        coupees: [...dates, ...(validite ? [validite] : [])].filter((d) => d.scrollWidth > d.clientWidth).length, colonnes,
        nom: nom.innerText, nomDeborde: nom.scrollWidth > nom.clientWidth || nom.getBoundingClientRect().right > carte.right + 0.5 };
    });
    expect(mesure.valeurs[0]).toBe('21/10/2026');
    expect(mesure.valeurs[1]).toMatch(/· 20\/11\/2026$/);
    // Trois colonnes égales (au pixel près), quel que soit le nom du client.
    expect(Math.max(...mesure.colonnes) - Math.min(...mesure.colonnes)).toBeLessThan(1);
    expect(mesure.coupees).toBe(0);
    // Le nom, lui, a la place de toute la carte : entier, et dedans.
    expect(mesure.nom).toBe('Entreprise Générale de Bâtiment Chaabane');
    expect(mesure.nomDeborde).toBe(false);
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 120_000);
});
