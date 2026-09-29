// Le fichier CNSS du trimestre, à la souris (brique 49 ; docs/cabinet.md, C39). L'écran est celui du
// Cabinet v10 (Comptabilité → Paie) ; le fichier est fabriqué par son moteur sur la paie que le serveur
// tient. Ce que le parcours vérifie, écran ET serveur :
//   - sans matricule employeur, le fichier ne sort pas : la case est nommée, avec le geste qui la lève ;
//   - le matricule posé dans la fiche du dossier (gardé au serveur), le fichier se télécharge sous le
//     nom que le format exige ; son salaire est l'assiette que le serveur déclare (deux chemins, un
//     chiffre) ; l'écran dit de ne pas le renommer.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le fichier CNSS du trimestre, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-cnss-'));
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

  it('refusé sans matricule employeur, puis téléchargé sous son nom ; son salaire est l\'assiette du serveur', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    expect((await api('POST', `/entreprises/${cafe}/compta/exercices`, associe, { annee: 2025, ouverture: [] })).statut).toBe(201);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/paie/2025`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    const toast = () => p.locator('#toast').innerText();
    const fenetre = p.locator('#modal-root .modal').last();
    const ouvrir = async (bouton: string, dedans: string) => expect.poll(async () => {
      if (!await p.locator(dedans).count()) await p.locator(bouton).first().click({ timeout: 2_000 }).catch(() => {});
      return p.locator(dedans).count();
    }, { timeout: 20_000 }).toBe(1);
    await p.locator('#pa-mois').waitFor({ timeout: 15_000 });
    await p.locator('#pa-mois').selectOption('3');

    // ── Une salariée, sa fiche CNSS complète, son bulletin de mars ────────────────────────────────
    await ouvrir('#pa-salarie', '#modal-root [name=nom]');
    await fenetre.locator('[name=nom]').fill('Sonia Khelifi');
    await fenetre.locator('[name=brut]').fill('1250,500');
    await fenetre.locator('[name=embauche]').fill('01/01/2025');
    await fenetre.locator('[name=cin]').fill('07654321');
    await fenetre.locator('[name=cnss]').fill('12345678-90');
    await fenetre.locator('[name=identiteCnss]').fill('Sonia Ali Khelifi');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Salarié enregistré.');
    await ouvrir('#pa-bulletin', '#bf');
    await fenetre.locator('#ok').click();
    await expect.poll(toast).toBe('Bulletin enregistré.');

    // ── Sans matricule employeur, le fichier ne sort pas : la case est nommée, avec son geste ──────────
    await expect.poll(() => p.locator('#pa-fichier-bloc').innerText()).toMatch(/Le fichier CNSS attend/);
    expect(await p.locator('#pa-fichier').isDisabled()).toBe(true);
    await p.locator('[data-pa-emp="employeur"]').click();
    await p.locator('#f-cnss').waitFor();
    await p.locator('#f-cnss').fill('123456-72');
    await fenetre.locator('#ok').click();
    await expect.poll(async () => ((await api('GET', `/cabinets/${cabinet}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: { cnssEmployeur?: string } }[])
      .find((f) => f.entreprise === cafe)?.contenu.cnssEmployeur).toBe('123456-72');

    // ── Le fichier se télécharge sous le nom du format ; son salaire est l'assiette du serveur ───────────
    await expect.poll(() => p.locator('#pa-fichier').isEnabled(), { timeout: 20_000 }).toBe(true);
    const [telechargement] = await Promise.all([p.waitForEvent('download'), p.locator('#pa-fichier').click()]);
    expect(telechargement.suggestedFilename()).toBe('DS00123456720000.12025');
    const contenu = fs.readFileSync(String(await telechargement.path()), 'latin1');
    const lignes = contenu.split('\r\n');
    expect(lignes.length).toBe(2);
    expect(lignes[1]).toBe('');
    expect(lignes[0]?.length).toBe(122);
    expect(/^[\x20-\x7e]*$/.test(contenu.replace(/\r\n/g, ''))).toBe(true);
    const cnss = (await api('GET', `/entreprises/${cafe}/paie/cnss?annee=2025&trimestre=1`, associe)).corps as { lignes: { assiette: string }[] };
    expect(cnss.lignes.length).toBe(1);
    const assiette = cnss.lignes[0]?.assiette ?? '';
    expect(assiette).toMatch(/^\d+\.\d{3}$/);
    // Le salaire du fichier : en millimes, sur dix chiffres (le format de la CNSS).
    expect(lignes[0]?.slice(0, 8 + 2 + 4 + 1 + 4)).toBe('00123456720000' + '1' + '2025');
    expect(lignes[0]).toContain('SONIA ALI KHELIFI');
    expect(lignes[0]).toContain('07654321' + assiette.replace('.', '').padStart(10, '0'));
    const dialogue = p.locator('#modal-root .modal').last();
    await expect.poll(() => dialogue.innerText()).toMatch(/Fichier CNSS téléchargé/);
    expect(await dialogue.innerText()).toMatch(/DS00123456720000\.12025/);
    expect(await dialogue.innerText()).toMatch(/Garde-lui exactement ce nom/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-cnss.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
