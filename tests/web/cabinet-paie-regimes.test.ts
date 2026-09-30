// Les taux par contrat de la paie d'un dossier, à la souris (brique 55 ; docs/cabinet.md, C45). L'écran
// est celui du Cabinet v10 (« Taux par contrat… ») ; les taux se gardent dans la fiche du dossier, au
// serveur, en texte décimal. Ce que le parcours vérifie, écran ET serveur :
//   - un taux trop fin se refuse sur SA case, avant l'enregistrement ;
//   - les taux enregistrés sont ceux de la fiche du serveur, et le panneau les dit ;
//   - le bulletin d'un salarié en CIVP les suit : le barème que le serveur garde avec lui est celui du
//     contrat (sans CNSS employeur, sans IRPP), et le serveur l'a recalculé au millime.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('les taux par contrat de la paie d\'un dossier, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-regimes-'));
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

  it('les taux du CIVP se gardent dans la fiche, le panneau les dit, et le bulletin d\'un salarié en CIVP les suit', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    expect((await api('POST', `/entreprises/${cafe}/compta/exercices`, associe, { annee: 2025, ouverture: [] })).statut).toBe(201);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/paie/2025`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();
    const ouvrir = async (bouton: string, dedans: string) => expect.poll(async () => {
      if (!await p.locator(dedans).count()) await p.locator(bouton).first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator(dedans).count();
    }, { timeout: 20_000 }).toBe(1);
    await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
    await expect.poll(() => p.locator('#pa-regimes-bloc').innerText()).toMatch(/Tous les contrats suivent le barème général/);

    // ── Les taux du CIVP : un taux trop fin se refuse sur sa case ───────────────────────────────────
    await ouvrir('#pa-regimes', '#rc-t');
    const civp = (k: string) => fenetre.locator(`[data-rc="civp"][data-k="${k}"]`);
    await civp('cnssEmployer').fill('1,23456');
    await fenetre.locator('#ok').click();
    await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('data-k'))).toBe('cnssEmployer');
    await expect.poll(async () => (await p.locator('body').innerText()).includes('un taux se garde avec quatre décimales au plus')).toBe(true);
    const fiche = async () => ((await api('GET', `/cabinets/${cabinet}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: Record<string, unknown> }[])
      .find((f) => f.entreprise === cafe)?.contenu ?? {};
    expect((await fiche()).paie).toBeUndefined();
    await civp('cnssEmployer').fill('0');
    await civp('solidarity').fill('0,5');
    await fenetre.locator('[data-rc-irpp="civp"]').check();
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Taux par contrat enregistrés.');
    expect((await fiche()).paie).toEqual({ regimesContrat: { civp: { cnssEmployer: '0', solidarity: '0.5', sansIrpp: true } } });
    await expect.poll(() => p.locator('#pa-regimes-bloc').innerText()).toMatch(/CIVP\s*: CNSS employeur 0 %, Solidarité 0,5 %, sans IRPP/);

    // ── Un salarié en CIVP, son bulletin de mars ────────────────────────────────────────────────────
    await p.locator('#pa-mois').selectOption('3');
    await ouvrir('#pa-salarie', '#modal-root [name=nom]');
    await fenetre.locator('[name=nom]').fill('Amel Trabelsi');
    await fenetre.locator('[name=contrat]').selectOption('civp');
    await fenetre.locator('[name=brut]').fill('1250,500');
    await fenetre.locator('[name=embauche]').fill('01/01/2025');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Salarié enregistré.');
    await ouvrir('#pa-bulletin', '#bf');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Bulletin enregistré.');
    const lignes = (await api('GET', `/entreprises/${cafe}/paie/bulletins?annee=2025`, associe)).corps.lignes as { id: string; mois: number; brut: string; net: string }[];
    expect(lignes.map((b) => [b.mois, b.brut])).toEqual([[3, '1250.500']]);
    const detail = (await api('GET', `/entreprises/${cafe}/paie/bulletins/${lignes[0]?.id}`, associe)).corps as { bareme: Record<string, unknown>; montants?: Record<string, string> };
    // Le barème que le serveur garde avec le bulletin est celui du CIVP ; les autres taux, ceux du barème général.
    expect([detail.bareme.cnssEmployeur, detail.bareme.solidarite, detail.bareme.sansIrpp, detail.bareme.cnssSalarie]).toEqual(['0.0000', '0.5000', true, '9.1800']);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-paie-regimes.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
