// La page Écritures, à la souris (brique 41 bis ; docs/cabinet.md, C25). Plus de paquets : la page lit
// les mois où chaque client a des écritures dans ses livres du serveur, et l'export les regroupe en un
// fichier, avec le client, son matricule et le mois devant chaque ligne. Ce que le parcours vérifie :
//   - les mois proposés, les clients, le mois à valider (une écriture au brouillard), le client sans
//     écriture, nommés avant le clic ;
//   - le fichier téléchargé : ses colonnes, chaque ligne des livres du serveur de la période, et rien
//     d'autre (ni un autre mois, ni un client qui n'y est pas) ;
//   - la visite « Exporter les écritures » revient dans « Me guider ».

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la page Écritures, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-ecr-'));
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

  it('les mois qui ont des écritures, le mois à valider et le client sans écriture nommés ; le fichier regroupe les livres du serveur, rien d\'autre', async () => {
    const associe = await personne('associe');
    const cabinet = String((await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' })).corps.id);
    const client = async (raisonSociale: string, matriculeFiscal?: string) =>
      String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale, ...(matriculeFiscal ? { matriculeFiscal } : {}) })).corps.entreprise);
    const cafe = await client('Café des Arts', '7654321B/A/M/000');
    const garage = await client('Garage du Port');
    await client('Librairie Sans Rien');
    const saisir = async (ent: string, date: string, piece: string, lignes: [string, string, string][]) =>
      String((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date, journal: 'OD', piece, libelle: `Pièce ${piece}`, lignes: lignes.map(([compte, debit, credit]) => ({ compte, debit, credit })) })).corps.id);
    // Mars : le café, validé ; le garage, une écriture au brouillard. Avril : le café, hors de la période exportée.
    const c1 = await saisir(cafe, '2026-03-12', 'OD-1', [['6226', '250,500', ''], ['401', '', '250,500']]);
    expect((await api('POST', `/entreprises/${cafe}/compta/ecritures/valider`, associe, { ids: [c1] })).statut).toBe(200);
    await saisir(garage, '2026-03-20', 'OD-7', [['6061', '85,125', ''], ['401', '', '85,125']]);
    await saisir(cafe, '2026-04-02', 'OD-2', [['6226', '10', ''], ['401', '', '10']]);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/ecritures`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await p.locator('#e-from').waitFor({ timeout: 15_000 });
    expect(await p.locator('#e-from option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).toEqual(['2026-03', '2026-04']);
    await p.locator('#e-from').selectOption('2026-03');
    await p.locator('#e-to').selectOption('2026-03');
    const vue = () => p.locator('#view').innerText();
    await expect.poll(vue).toMatch(/1\smois est à valider[\s\S]*Garage du Port[\s\S]*Des écritures y sont encore au brouillard/);
    expect(await vue()).toMatch(/1\sclient n'a aucune écriture sur cette période\s:\s+Librairie Sans Rien/);
    expect(await p.locator('.stat', { hasText: 'Mois de livres' }).locator('.val').innerText()).toBe('2');
    expect(await vue()).not.toMatch(/paquet/i);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-ecritures-1-page.png') });

    const [fichier] = await Promise.all([p.waitForEvent('download'), p.locator('#e-go').click()]);
    expect(fichier.suggestedFilename()).toBe('ecritures-Cabinet-Ennour-2026-03.csv');
    const lignes = fs.readFileSync(await fichier.path(), 'utf8').replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lignes).toEqual([
      'Client;Matricule;Mois;N°;Date;Journal;Pièce;Compte;Tiers;Libellé;Débit;Crédit;Lettrage;État',
      'Café des Arts;7654321B/A/M/000;2026-03;1;12/03/2026;OD;OD-1;6226;;Pièce OD-1;250,500;0,000;;validée',
      'Café des Arts;7654321B/A/M/000;2026-03;1;12/03/2026;OD;OD-1;401;;Pièce OD-1;0,000;250,500;;validée',
      'Garage du Port;;2026-03;;20/03/2026;OD;OD-7;6061;;Pièce OD-7;85,125;0,000;;brouillard',
      'Garage du Port;;2026-03;;20/03/2026;OD;OD-7;401;;Pièce OD-7;0,000;85,125;;brouillard',
    ]);
    const fenetre = p.locator('#modal-root .modal').first();
    await expect.poll(() => fenetre.innerText()).toMatch(/^4 lignes d'écriture regroupées/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-ecritures-2-fichier.png') });
    await fenetre.getByRole('button', { name: 'Fermer' }).click();
    // Deux mois : chaque ligne sous son mois, aucune deux fois.
    await p.locator('#e-to').selectOption('2026-04');
    await expect.poll(() => p.locator('.stat', { hasText: 'Mois de livres' }).locator('.val').innerText()).toBe('3');
    const [deux] = await Promise.all([p.waitForEvent('download'), p.locator('#e-go').click()]);
    expect(deux.suggestedFilename()).toBe('ecritures-Cabinet-Ennour-2026-03_2026-04.csv');
    const parMois = fs.readFileSync(await deux.path(), 'utf8').replace(/^\uFEFF/, '').trim().split('\r\n').slice(1).map((l) => l.split(';').slice(0, 3).concat(l.split(';')[6] ?? '').join(';'));
    expect(parMois).toEqual([
      'Café des Arts;7654321B/A/M/000;2026-03;OD-1', 'Café des Arts;7654321B/A/M/000;2026-03;OD-1',
      'Garage du Port;;2026-03;OD-7', 'Garage du Port;;2026-03;OD-7',
      'Café des Arts;7654321B/A/M/000;2026-04;OD-2', 'Café des Arts;7654321B/A/M/000;2026-04;OD-2',
    ]);
    await p.locator('#modal-root .modal').first().getByRole('button', { name: 'Fermer' }).click();

    // La visite revient dans « Me guider ».
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/guide`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    const ligne = p.locator('li.g-ligne', { hasText: 'Exporter les écritures vers mon logiciel' });
    await expect.poll(() => ligne.count()).toBe(1);
    expect(await ligne.innerText()).toMatch(/Les écritures de tous tes clients sur une période, en un seul fichier/);
    expect(await ligne.getByRole('button', { name: 'Commencer' }).isEnabled()).toBe(true);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
