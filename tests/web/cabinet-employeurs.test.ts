// La CNSS des seuls employeurs, à la souris (brique 54 ; docs/cabinet.md, C44). L'écran est celui des
// Échéances du Cabinet v10 ; ce que les livres disent des salariés, le serveur le compte mois par mois.
// Ce que le parcours vérifie : sur le dernier trimestre fini, la carte CNSS ne vise que le client dont les
// livres portent des salaires ; celui dont le trimestre est saisi sans un salaire n'y est plus, et
// personne n'y est compté « par prudence ».

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la CNSS des seuls employeurs, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-employeurs-'));
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
    const email = `${nom}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };

  it('la carte CNSS du dernier trimestre ne vise que l\'employeur, plus le client saisi sans salaire', async () => {
    const associe = await personne('Karim');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const garage = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Garage du Port' })).corps.entreprise);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    // Le dernier trimestre fini, et ses trois mois.
    const maintenant = new Date();
    let annee = maintenant.getUTCFullYear(), trimestre = Math.floor(maintenant.getUTCMonth() / 3);
    if (trimestre === 0) { annee--; trimestre = 4; }
    const mois = [0, 1, 2].map((i) => `${annee}-${String((trimestre - 1) * 3 + 1 + i).padStart(2, '0')}`);
    const od = async (ent: string, date: string, debit: string, credit: string) => expect((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, {
      date, journal: 'OD', piece: `OD-${date}`, libelle: 'Pièce du mois', lignes: [{ compte: debit, debit: '1250,500' }, { compte: credit, credit: '1250,500' }] })).statut).toBe(201);
    for (const [i, m] of mois.entries()) {
      await od(garage, `${m}-20`, i === 0 ? '6400' : '6132', i === 0 ? '421' : '401');
      await od(cafe, `${m}-20`, '6132', '401');
    }

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/echeances`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    const carte = p.locator('#view .ech').filter({ hasText: new RegExp(`CNSS du ${trimestre}\\S* trimestre`) });
    await expect.poll(() => carte.count(), { timeout: 20_000 }).toBe(1);
    const texte = await carte.innerText();
    // Un seul client visé — l'employeur, dont le trimestre est saisi (« prêt ») — et personne par prudence.
    expect(texte).toMatch(/sur 1 client\b/);
    expect(texte).toMatch(/1 prêt/);
    expect(texte).toMatch(/clients employeurs : leur Paie ou leurs comptes de rémunération le disent\./);
    expect(texte).not.toMatch(/prudence/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-employeurs.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
