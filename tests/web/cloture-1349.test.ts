// L'Exercice d'un dossier au Cabinet, joué comme un comptable (1.349.0 ; docs/revue-modules.md). Ce que le parcours
// vérifie :
//   - un exercice qui court : « Clôturer l'exercice… » est éteint, et la phrase dit pourquoi et à partir de quand —
//     AVANT le clic, jamais par un message qui s'efface ;
//   - « Le dossier pour le client… » n'est pas offert en ligne, où il ne pourrait rien écrire.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('l\'exercice d\'un dossier, joué comme un comptable (1.349.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cloture-1349-'));
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


  it('(1.349.0) un exercice qui court ne se clôture pas, et le bouton éteint dit pourquoi avant le clic ; pas de fichier pour le client en ligne', async () => {
    const client = await personne('client');
    const associe = await personne('associe');
    const ent = String((await api('POST', '/entreprises', client, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Jlassi' });
    const cabinet = String(cab.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    const an = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' }).slice(0, 4);
    const r = await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: `${an}-01-01`, journal: 'AN', piece: 'AN-1', libelle: 'Ouverture',
      lignes: [{ compte: '532', debit: '10000,500' }, { compte: '101', credit: '10000,500' }] });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids: [String(r.corps.id)] })).statut).toBe(200);

    const erreurs: string[] = [];
    const ctx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/exercice/${an}`);
    await p.locator('#cl-cloturer').waitFor({ timeout: 20_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    expect(await p.locator('#cl-cloturer').isDisabled()).toBe(true);
    expect(await p.locator('#cl-cloturer').getAttribute('aria-describedby')).toBe('cl-cloturer-motif');
    expect((await p.locator('#cl-cloturer-motif').innerText()).replace(/\s+/g, ' ')).toBe(`L'exercice ${an} n'est pas fini : il se clôture à partir du 01/01/${Number(an) + 1}.`);
    await p.locator('#cl-cloturer').click({ force: true }).catch(() => {});
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    expect(await p.locator('#cl-fichier').count()).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'cloture-1349-en-cours.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
