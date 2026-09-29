// L'inventaire de stock, à la souris (brique 42 bis ; docs/cabinet.md, C30). L'écran est celui du
// Cabinet v10 ; la variation se calcule par la v10 sur le livre du serveur ; l'inventaire et sa
// variation vont au serveur. Ce que le parcours vérifie, écran ET serveur :
//   - l'inventaire collé depuis un tableur s'enregistre, son total calculé au serveur au millime ;
//   - la variation (le compté contre ce que le compte de stock porte) s'écrit au brouillard, au
//     millime, liée ; l'inventaire ne se refait plus sous elle, et le refus le dit.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('l\'inventaire de stock, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-inv-'));
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

  type Inventaire = { total: string; ecriture: string | null };
  const inventaire = async (ent: string, jeton: string) => (await api('GET', `/entreprises/${ent}/compta/inventaires/2025`, jeton)).corps.inventaire as Inventaire | null;

  it('l\'inventaire collé s\'enregistre au millime ; la variation s\'écrit au brouillard, liée ; dessous, l\'inventaire ne se refait pas', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    // Le compte de stock porte 150,000 : le compté (203,282) en fait une variation de +53,282.
    const achat = String((await api('POST', `/entreprises/${cafe}/compta/ecritures`, associe, { date: '2025-01-02', journal: 'OD', piece: 'STK-0', libelle: 'Stock repris',
      lignes: [{ compte: '37', debit: '150' }, { compte: '401', credit: '150' }] })).corps.id);
    expect((await api('POST', `/entreprises/${cafe}/compta/ecritures/valider`, associe, { ids: [achat] })).statut).toBe(200);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/inventaire/2025`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();
    const ouvrir = async (bouton: string, dedans: string) => expect.poll(async () => {
      if (!await p.locator(dedans).count()) await p.locator(bouton).first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator(dedans).count();
    }, { timeout: 20_000 }).toBe(1);

    // ── L'inventaire collé depuis un tableur ────────────────────────────────────────────────────────
    await ouvrir('#iv-saisir2', '#iv-lignes');
    await fenetre.locator('[name=date]').fill('31/12/2025');
    await fenetre.locator('#iv-lignes').fill('REF-01\tCâble HDMI 2 m\t24\t7,555\nFARINE\tFarine (kg)\t12,345\t1,779');
    await expect.poll(() => fenetre.locator('#iv-apercu').innerText()).toMatch(/2 lignes — total 203,282/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-inventaire-1-saisie.png') });
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Inventaire enregistré.');
    expect(await inventaire(cafe, associe)).toMatchObject({ total: '203.282', ecriture: null });

    // ── La variation : +53,257, au brouillard, liée ─────────────────────────────────────────────────
    await expect.poll(() => p.locator('#iv-ecrire').isEnabled(), { timeout: 15_000 }).toBe(true);
    await p.locator('#iv-ecrire').click();
    await expect.poll(toast).toBe('Variation de stock passée en brouillard.');
    const lie = (await inventaire(cafe, associe))?.ecriture;
    const ecrites = (await api('GET', `/entreprises/${cafe}/compta/ecritures?limite=500`, associe)).corps.ecritures as { id: string; statut: string; lignes: { compte: string; debit: string; credit: string }[] }[];
    expect(ecrites.find((e) => e.id === lie)).toMatchObject({ statut: 'brouillard', lignes: [
      { compte: '37', debit: '53.282', credit: '0.000' }, { compte: '603', debit: '0.000', credit: '53.282' }] });
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-inventaire-2-variation.png') });

    // ── Dessous, l'inventaire ne se refait pas : le refus le dit ───────────────────────────────────
    await ouvrir('#iv-saisir', '#iv-lignes');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toMatch(/^L'inventaire de 2025 est déjà passé en écriture \(la variation de stock\) : elle est encore au brouillard/);
    expect((await inventaire(cafe, associe))?.ecriture).toBe(lie);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
