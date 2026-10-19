// Les écritures d'un FEC dans le livre d'une année, à la souris (docs/cabinet.md, C62). Leïla reprend un client en
// cours d'année : son ancien logiciel (comme Odoo) lui donne le FEC de 2026 jusqu'en mars. Ce que le parcours vérifie,
// écran ET serveur :
//   - le bouton du livre-journal dit qu'il lit un FEC ; la fenêtre dit d'abord ce que le fichier devient (les lignes
//     qui entrent, chaque journal et ce qu'il devient, les à-nouveaux et l'autre année qui n'entrent pas) ;
//   - « Importer 3 pièces » : trois brouillards au serveur, dans leur journal, au millime, le client avec son nom ;
//   - le même fichier, repris une seconde fois, ne double rien ; la balance d'ouverture reste la seule écriture AN.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

const TETE = 'JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Debit|Credit|EcritureLet|DateLet|ValidDate|Montantdevise|Idevise';
const ligne = (j: string, jl: string, n: string, d: string, c: string, cl: string, aux: string, auxl: string, piece: string, lib: string, deb: string, cre: string) =>
  [j, jl, n, d, c, cl, aux, auxl, piece, d, lib, deb, cre, '', '', d, '', ''].join('|');
const FEC_2026 = Buffer.from([TETE,
  // Une écriture de 2025, restée dans le fichier : elle n'entre pas dans le livre de 2026.
  ligne('MISC', 'Opérations diverses', 'MISC/2025/0099', '20251231', '6278', 'Frais bancaires', '', '', 'OD-99', 'Agios', '3,333', '0,000'),
  ligne('MISC', 'Opérations diverses', 'MISC/2025/0099', '20251231', '532', 'Banque BIAT', '', '', 'OD-99', 'Agios', '0,000', '3,333'),
  // Les à-nouveaux : ils font la balance d'ouverture, pas l'historique.
  ligne('OUV', 'Ouverture', 'OUVERTURE/2026', '20260101', '532', 'Banque BIAT', '', '', 'OUV-2026', 'Ouverture 2026', '12500,125', '0,000'),
  ligne('OUV', 'Ouverture', 'OUVERTURE/2026', '20260101', '101', 'Capital social', '', '', 'OUV-2026', 'Ouverture 2026', '0,000', '12500,125'),
  ligne('INV', 'Ventes', 'INV/2026/0001', '20260114', '411', 'Clients', 'C002', 'Société Alpha', 'FAC-2026-001', 'Facture Société Alpha', '1191,001', '0,000'),
  ligne('INV', 'Ventes', 'INV/2026/0001', '20260114', '707', 'Ventes de marchandises', '', '', 'FAC-2026-001', 'Facture Société Alpha', '0,000', '1000,001'),
  ligne('INV', 'Ventes', 'INV/2026/0001', '20260114', '4367', 'TVA collectée', '', '', 'FAC-2026-001', 'Facture Société Alpha', '0,000', '191,000'),
  ligne('BNK1', 'Banque', 'BNK1/2026/0003', '20260202', '532', 'Banque BIAT', '', '', 'VIR-12', 'Encaissement Société Alpha', '1191,001', '0,000'),
  ligne('BNK1', 'Banque', 'BNK1/2026/0003', '20260202', '411', 'Clients', 'C002', 'Société Alpha', 'VIR-12', 'Encaissement Société Alpha', '0,000', '1191,001'),
  ligne('BILL', 'Achats', 'BILL/2026/0005', '20260305', '6064', 'Fournitures de bureau', '', '', 'FF-31', 'Papeterie', '84,034', '0,000'),
  ligne('BILL', 'Achats', 'BILL/2026/0005', '20260305', '4366', 'TVA déductible', '', '', 'FF-31', 'Papeterie', '15,966', '0,000'),
  ligne('BILL', 'Achats', 'BILL/2026/0005', '20260305', '401', 'Fournisseurs', 'F001', 'Papeterie du Lac', 'FF-31', 'Papeterie', '0,000', '100,000'),
].join('\r\n') + '\r\n', 'utf8');

describe('les écritures d\'un FEC dans le livre d\'une année, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-fec-livre-'));
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
  type Ecriture = { journal: string; date: string; piece: string | null; statut: string; lignes: { compte: string; tiers: string | null; debit: string; credit: string }[] };
  const choisir = async (p: Page) => {
    const [fichier] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#lv-reimport').click()]);
    await fichier.setFiles({ name: 'FEC-2026.txt', mimeType: 'text/plain', buffer: FEC_2026 });
  };

  it('Leïla reprend les écritures de 2026 d\'un client depuis son FEC : ce que le fichier devient, puis trois brouillards, jamais deux fois', async () => {
    const leila = await personne('leila');
    const cabinet = String((await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' })).corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, leila, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    // Son exercice 2026 est ouvert, avec sa balance d'ouverture (reprise du même FEC de 2025, C61).
    expect((await api('POST', `/entreprises/${cafe}/compta/exercices`, leila, { annee: 2026, ouverture: [
      { compte: '532', libelle: 'Banque BIAT', debit: '12500,125' }, { compte: '101', libelle: 'Capital social', credit: '12500,125' }] })).statut).toBe(201);

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, leila);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/journal/2026`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await expect.poll(() => p.locator('#lv-reimport').innerText(), { timeout: 15_000 }).toBe('Importer un tableur ou un FEC…');

    await choisir(p);
    const fenetre = p.locator('#modal-root .modal').first();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Reprendre les écritures d\'un FEC');
    const net = (t: string) => t.replace(/\s+/g, ' ').trim();
    const fec = net(await fenetre.locator('#fec-livre').innerText());
    expect(fec).toBe('Un FEC : 8 lignes du 01/01/2026 au 31/12/2026 entrent dans ce livre. Ses journaux deviennent ceux de SkanFact : '
      + 'INV « Ventes » → VT BNK1 « Banque » → BQ BILL « Achats » → AC '
      + '2 lignes d\'à-nouveaux ne sont pas reprises ici : elles font la balance d\'ouverture (« Reprendre les soldes d\'ouverture »). '
      + '2 lignes hors de l\'exercice (du 31/12/2025 au 31/12/2025) n\'entrent pas : ouvre le livre de leur année pour les reprendre.');
    expect(net(await fenetre.innerText())).toMatch(/FEC-2026\.txt — 3 pièces lues\. Rien n'est encore écrit/);
    expect(net(await fenetre.innerText())).toMatch(/3 pièces nouvelles — elles entreront en brouillard\./);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-fec-livre-1-fenetre.png') });
    await expect.poll(() => fenetre.locator('#ok').innerText()).toBe('Importer 3 pièces');
    await fenetre.locator('#ok').click();
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 15_000 }).toBe('Import fait : 3 pièces ajoutées. Tout est en brouillard.');

    // Au serveur : trois brouillards, dans leur journal, au millime, le client et le fournisseur avec leur nom.
    const livre = async () => ((await api('GET', `/entreprises/${cafe}/compta/ecritures?limite=500`, leila)).corps.ecritures as Ecriture[])
      .filter((e) => e.journal !== 'AN').map((e) => [e.journal, e.piece, e.date, e.statut, e.lignes.map((l) => [l.compte, l.tiers, l.debit, l.credit])]);
    expect(await livre()).toEqual([
      ['VT', 'FAC-2026-001', '2026-01-14', 'brouillard', [['411', 'Société Alpha', '1191.001', '0.000'], ['707', null, '0.000', '1000.001'], ['4367', null, '0.000', '191.000']]],
      ['BQ', 'VIR-12', '2026-02-02', 'brouillard', [['532', null, '1191.001', '0.000'], ['411', 'Société Alpha', '0.000', '1191.001']]],
      ['AC', 'FF-31', '2026-03-05', 'brouillard', [['6064', null, '84.034', '0.000'], ['4366', null, '15.966', '0.000'], ['401', 'Papeterie du Lac', '0.000', '100.000']]],
    ]);

    // Le même fichier, une seconde fois : rien de neuf, rien de doublé.
    const avant = await livre();
    // L'import ouvre la saisie (l'étape suivante : relire et valider) ; on revient au livre-journal.
    await expect.poll(() => p.locator('#sa-journal').count(), { timeout: 15_000 }).toBe(1);
    await p.evaluate((h) => { location.hash = h; }, `#/dossier/${cafe}/comptabilite/journal/2026`);
    await expect.poll(() => p.locator('#lv-reimport').count(), { timeout: 15_000 }).toBe(1);
    await choisir(p);
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Reprendre les écritures d\'un FEC');
    expect(net(await fenetre.innerText())).toMatch(/3 pièces identiques au livre : rien à faire\./);
    expect(await fenetre.locator('#ok').isDisabled()).toBe(true);
    await fenetre.getByRole('button', { name: 'Annuler' }).click();
    expect(await livre()).toEqual(avant);
    const an = ((await api('GET', `/entreprises/${cafe}/compta/ecritures?limite=500`, leila)).corps.ecritures as Ecriture[]).filter((e) => e.journal === 'AN');
    expect(an.map((e) => e.piece)).toEqual(['OUVERTURE']);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
