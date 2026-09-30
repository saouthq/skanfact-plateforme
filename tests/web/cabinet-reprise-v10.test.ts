// Reprendre le livre de la v10 d'un dossier tenu, à la souris (brique 64 ; docs/cabinet.md, C54). Le
// fichier `livre-2025.json` est fabriqué par le moteur de la v10 lui-même, puis choisi dans la fenêtre du
// navigateur. Ce que le parcours vérifie, écran ET serveur :
//   - un livre qui a une anomalie : le rapport la nomme, aucun bouton pour écrire, rien d'écrit ;
//   - le bon livre : le rapport compte ce qui passe ; « Reprendre ces écritures » les écrit avec leurs
//     numéros de la v10, et l'écran s'ouvre sur le livre de 2025.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('reprendre le livre de la v10 d\'un dossier tenu, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-reprise-v10-'));
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

  type Livre = { ecritures: { id: string; journal: string; lignes: { lettre: string }[] }[] };
  const KC = ecranDeLaPlateforme('compta.js') as {
    livreVide: (id: string, annee: number, o: Record<string, unknown>) => Livre;
    ajouterEcriture: (l: Livre, e: Record<string, unknown>, qui: string, quand: number) => { id: string };
    validerEcriture: (l: Livre, id: string, qui: string, quand: number) => { ok: boolean };
    lettrer: (l: Livre, compte: string, ids: string[], lettre: string, qui: string, jour: string) => { ok: boolean; lettre?: string };
    ajouterReleve: (l: Livre, r: Record<string, unknown>, qui: string, quand: number) => { ok: boolean; releve?: { id: string } };
    rapprocherAuto: (l: Livre, releve: string, o: Record<string, unknown>) => { ok: boolean };
    ajouterImmobilisation: (l: Livre, f: Record<string, unknown>, qui: string, quand: number) => { ok: boolean };
    ecrituresImmobilisations: (l: Livre, annee: number) => (Record<string, unknown> & { immoId: string })[];
    noterEcritureImmo: (l: Livre, immo: string, annee: number, ecriture: string) => { ok: boolean };
  };
  const livreDe2025 = () => {
    const L = KC.livreVide('D', 2025, {});
    const poser = (e: Record<string, unknown>, valider: boolean) => {
      const x = KC.ajouterEcriture(L, e, 'Leila', Date.UTC(2025, 5, 1));
      if (valider) expect(KC.validerEcriture(L, x.id, 'Leila', Date.UTC(2025, 5, 2)).ok).toBe(true);
      return x.id;
    };
    poser({ date: '2025-01-01', journal: 'AN', piece: 'AN', libelle: 'À-nouveaux', source: 'an', lignes: [{ compte: '532', debit: 12500.125 }, { compte: '101', credit: 12500.125 }] }, true);
    const fac = poser({ date: '2025-03-14', journal: 'VT', piece: 'FAC-2025-014', libelle: 'Facture Hôtel du Lac', lignes: [{ compte: '411', tiers: 'Hôtel du Lac', debit: 1191.001 }, { compte: '707', credit: 1000.001 }, { compte: '4367', credit: 191 }] }, true);
    const enc = poser({ date: '2025-04-02', journal: 'BQ', piece: 'VIR-88', libelle: 'Encaissement Hôtel du Lac', lignes: [{ compte: '532', debit: 1191.001 }, { compte: '411', tiers: 'Hôtel du Lac', credit: 1191.001 }] }, true);
    poser({ date: '2025-05-20', journal: 'AC', piece: 'FF-77', libelle: 'Papeterie', lignes: [{ compte: '6064', debit: 84.034 }, { compte: '4366', debit: 15.966 }, { compte: '401', credit: 100 }] }, false);
    expect(KC.lettrer(L, '411', [fac, enc], '', 'Leila', '2025-06-03').lettre).toBe('A');
    const rel = KC.ajouterReleve(L, { compte: '532', banque: 'BIAT', fichier: 'releve-avril.csv', empreinte: 'a1'.repeat(32), soldeDebut: 12500.125, soldeFin: 13678.626,
      lignes: [{ date: '2025-04-02', libelle: 'VIR HOTEL DU LAC', montant: 1191.001, reference: 'VIR-88' }, { date: '2025-04-30', libelle: 'FRAIS TENUE DE COMPTE', montant: -12.5, reference: '' }] }, 'Leila', Date.UTC(2025, 4, 5));
    expect(KC.rapprocherAuto(L, rel.releve?.id ?? '', { date: '2025-05-05' }).ok).toBe(true);
    return L;
  };
  // 2026 dans la v10 : ses lettres recommencent à A, que 2025 a déjà prise dans le dossier.
  const livreDe2026 = () => {
    const L = KC.livreVide('D', 2026, {});
    const poser = (e: Record<string, unknown>) => { const x = KC.ajouterEcriture(L, e, 'Leila', Date.UTC(2026, 1, 1)); expect(KC.validerEcriture(L, x.id, 'Leila', Date.UTC(2026, 1, 2)).ok).toBe(true); return x.id; };
    const f = poser({ date: '2026-01-10', journal: 'VT', piece: 'FAC-2026-001', libelle: 'Facture', lignes: [{ compte: '411', debit: 238 }, { compte: '707', credit: 200 }, { compte: '4367', credit: 38 }] });
    const r = poser({ date: '2026-01-20', journal: 'BQ', piece: 'VIR-101', libelle: 'Encaissement', lignes: [{ compte: '532', debit: 238 }, { compte: '411', credit: 238 }] });
    expect(KC.lettrer(L, '411', [f, r], '', 'Leila', '2026-02-03').lettre).toBe('A');
    return L;
  };

  it('le rapport se lit avant que rien ne s\'écrive ; une anomalie bloque ; le bon livre se reprend avec ses numéros', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const dossier = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Boulangerie Ennour' })).corps.entreprise);
    const ecritures = async () => ((await api('GET', `/entreprises/${dossier}/compta/ecritures?limite=500`, associe)).corps.ecritures as { piece: string; numero: string | null }[])
      .map((e) => [e.piece, e.numero]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const abime = livreDe2025();
    if (abime.ecritures[3]) abime.ecritures[3].journal = 'BQ2';
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'livres-v10-'));
    const fichierAbime = path.join(tmp, 'livre-2025.json');
    fs.writeFileSync(fichierAbime, JSON.stringify(abime));
    const fichierBon = path.join(tmp, 'livre-2025-bon.json');
    fs.writeFileSync(fichierBon, JSON.stringify(livreDe2025()));
    const fichier2026 = path.join(tmp, 'livre-2026.json');
    fs.writeFileSync(fichier2026, JSON.stringify(livreDe2026()));

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${dossier}/comptabilite`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    const choisir = async (fichier: string) => {
      await p.locator('#lv-reprise-v10').waitFor({ timeout: 20_000 });
      const [fenetre] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#lv-reprise-v10').click()]);
      await fenetre.setFiles(fichier);
      await p.locator('#modal-root #rv-rapport').waitFor({ timeout: 15_000 });
      return p.locator('#modal-root .modal').last();
    };

    // ── Le livre abîmé : l'anomalie nommée, aucun bouton pour écrire, rien d'écrit ─────────────────
    let m = await choisir(fichierAbime);
    expect(await m.locator('#rv-anomalies').innerText()).toMatch(/Un point empêche la reprise\s:\scorrige-le dans la v10[\s\S]*FF-77 du 20\/05\/2025\s:\sLe journal «\sBQ2\s» n'existe pas sur la plateforme/);
    expect(await m.locator('#ok').count()).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-reprise-v10-anomalie.png') });
    await m.locator('[data-close]').click();
    expect(await ecritures()).toEqual([]);

    // ── Le bon livre : le rapport, puis « Reprendre ces écritures » ─────────────────────────────────
    m = await choisir(fichierBon);
    const rapport = await m.locator('#rv-rapport').innerText();
    expect(rapport).toMatch(/Écritures validées — elles gardent leur numéro de la v10\s+3/);
    expect(rapport).toMatch(/Écritures au brouillard — elles restent au brouillard\s+1/);
    expect(rapport).toMatch(/Lettrages — ils se reprennent avec leur lettre\s+1/);
    expect(rapport).toMatch(/Relevés bancaires — avec leurs rapprochements\s+1 \(1 ligne rapprochée\)/);
    expect(rapport).toMatch(/Immobilisations — une fiche par bien, pour toute la vie du dossier\s+0 \(0 écriture de l'année reliée\)/);
    expect(await m.locator('#rv-ok').count()).toBe(1);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-reprise-v10-rapport.png') });
    await m.locator('#ok').click();
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 15_000 }).toBe('Livre de 2025 repris : 3 écritures validées, 1 au brouillard, 1 lettrage, 1 relevé.');
    expect(await ecritures()).toEqual([['AN', 'AN-2025-000001'], ['FAC-2025-014', 'VT-2025-000002'], ['FF-77', null], ['VIR-88', 'BQ-2025-000003']]);
    await expect.poll(() => p.locator('#view').innerText(), { timeout: 15_000 }).toMatch(/FF-77/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-reprise-v10-fait.png') });
    // Le relevé repris se lit dans la banque du dossier, avec son rapprochement.
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${dossier}/comptabilite/banque/2025`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(1500);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-reprise-v10-banque.png') });
    const releve = await p.locator('#view').innerText();
    expect(releve).toMatch(/532 · 02\/04\/2025 → 30\/04\/2025 · BIAT/);
    expect(releve).toMatch(/VIR HOTEL DU LAC\s+VIR-88\s+1\s191,001\sDT\s+Rapproché\s+auto\s+BQ VIR-88/);
    expect(releve).toMatch(/FRAIS TENUE DE COMPTE\s+[−-]12,500\sDT\s+Sans réponse/);

    // ── 2026, dont la lettre A est déjà prise par 2025 : elle devient B, et l'écran le dit ─────────
    await expect.poll(async () => (await p.locator('#lv-annee option').allInnerTexts()).includes('2026'), { timeout: 15_000 }).toBe(true);
    await p.locator('#lv-annee').selectOption('2026');
    m = await choisir(fichier2026);
    await m.locator('#ok').click();
    const lettresChangees = p.locator('#modal-root .modal', { hasText: 'Des lettres ont changé' });
    await lettresChangees.waitFor({ timeout: 15_000 });
    expect(await lettresChangees.innerText()).toMatch(/A s'appelle maintenant B\. Les lignes restent lettrées ensemble\./);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-reprise-v10-lettres.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('les immobilisations reprises : le bien reporté ne se propose pas comme une acquisition, celui né de sa facture non plus, leurs dotations sont passées', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const dossier = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Boulangerie Ennour' })).corps.entreprise);
    // Le livre de 2025 de la v10 : le pétrin (mis en service en 2023) arrive par les à-nouveaux ; le four
    // est acheté en mars et sa fiche est née de sa facture ; les deux dotations sont passées.
    const L = KC.livreVide('D', 2025, {});
    const poser = (e: Record<string, unknown>) => { const x = KC.ajouterEcriture(L, e, 'Leila', Date.UTC(2025, 11, 30)); expect(KC.validerEcriture(L, x.id, 'Leila', Date.UTC(2025, 11, 31)).ok).toBe(true); return x.id; };
    poser({ date: '2025-01-01', journal: 'AN', piece: 'AN', libelle: 'À-nouveaux', source: 'an', lignes: [{ compte: '2234', debit: 6000.5 }, { compte: '532', debit: 20000 }, { compte: '101', credit: 26000.5 }] });
    const acq = poser({ date: '2025-03-01', journal: 'AC', piece: 'FAC-FOUR', libelle: 'Four à sole', lignes: [{ compte: '2234', debit: 12000 }, { compte: '4366', debit: 2280 }, { compte: '401', credit: 14280 }] });
    const commun = { compte: '2234', compteAmort: '28234', compteDotation: '6811', residuelle: 0, tva: 0, methode: 'lineaire', duree: 5 };
    expect(KC.ajouterImmobilisation(L, { ...commun, id: 'i-petrin', libelle: 'Pétrin', dateAcquisition: '2023-06-01', dateMiseEnService: '2023-06-01', valeur: 6000.5, reporteDe: 2024 }, 'Leila', 1).ok).toBe(true);
    expect(KC.ajouterImmobilisation(L, { ...commun, id: 'i-four', libelle: 'Four à sole', dateAcquisition: '2025-03-01', dateMiseEnService: '2025-03-01', valeur: 12000,
      origine: { source: 'ecriture', docId: `${acq}#0`, mois: '' } }, 'Leila', 2).ok).toBe(true);
    for (const x of KC.ecrituresImmobilisations(L, 2025)) expect(KC.noterEcritureImmo(L, x.immoId, 2025, poser(x)).ok).toBe(true);
    const r = await api('POST', `/cabinets/${cabinet}/reprise/livre`, associe, { dossier, livre: JSON.parse(JSON.stringify(L)) });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${dossier}/comptabilite/immobilisations/2025`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(1500);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    await expect.poll(async () => (await p.locator('#view').innerText()).includes('Pétrin'), { timeout: 15_000 }).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-reprise-v10-immobilisations.png'), fullPage: true });
    const vue = await p.locator('#view').innerText();
    expect(vue).toMatch(/Pétrin\s+repris de 2024\s+écrite\s+01\/06\/2023/);
    expect(vue).toMatch(/Four à sole\s+écrite\s+01\/03\/2025/);
    expect(vue).toMatch(/celles de 2025 sont passées/);
    // Ni le pétrin (ses à-nouveaux) ni le four (sa facture) ne se proposent comme une acquisition à créer.
    expect(await p.locator('[data-creer]').count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
