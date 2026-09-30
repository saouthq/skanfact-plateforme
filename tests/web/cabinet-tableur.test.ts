// L'aller-retour par le tableur, à la souris (brique 39 bis ; docs/cabinet.md, C18). Les écrans sont
// ceux du Cabinet v10 ; les fichiers se téléchargent, et le réimport écrit au serveur. Ce que le
// parcours vérifie, écran ET serveur :
//   - « Exporter le livre-journal » télécharge le CSV de la v10 (son BOM, ses colonnes, ses montants) ;
//   - corrigé comme dans un tableur (un brouillard changé, une validée changée, une pièce nouvelle, une
//     pièce qui ne tombe pas juste), il se réimporte : la fenêtre dit AVANT le clic ce que l'import
//     fera — la pièce bancale refusée et nommée, le seul compte nouveau d'une pièce qui entre ; puis la
//     pièce nouvelle et le
//     brouillard corrigé entrent au brouillard, la validée se contre-passe et sa version attend au
//     brouillard, la pièce identique ne bouge pas ;
//   - le fichier des écritures (FEC) se télécharge, sans les brouillards : autant de lignes que les
//     écritures validées du serveur ;
//   - la visite « Commencer le livre d'un client » revient, pour un client hors SkanFact seulement.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('l\'aller-retour par le tableur, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-tableur-'));
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
  type Ecriture = { id: string; journal: string; date: string; piece: string | null; statut: string; numero: string | null;
    origine: { type: string; id: string }; lignes: { compte: string; debit: string; credit: string }[] };
  const livres = async (ent: string, jeton: string) => (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, jeton)).corps.ecritures as Ecriture[];
  const montants = (e: Ecriture | undefined) => e?.lignes.map((l) => [l.compte, l.debit, l.credit]);

  it('le livre-journal s\'exporte en CSV, se corrige dans un tableur et se réimporte : ce qui entre, ce qui se contre-passe, ce qui est refusé ; le FEC se télécharge sans les brouillards', async () => {
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const cafe = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Café des Arts' })).corps.entreprise);
    const saisir = async (date: string, piece: string, libelle: string, lignes: [string, string, string][]) =>
      String((await api('POST', `/entreprises/${cafe}/compta/ecritures`, associe, { date, journal: 'OD', piece, libelle, lignes: lignes.map(([compte, debit, credit]) => ({ compte, debit, credit })) })).corps.id);
    const loyer = await saisir('2026-03-10', 'OD-1', 'Loyer de mars', [['6132', '700', ''], ['532', '', '700']]);
    const honoraires = await saisir('2026-03-15', 'OD-2', 'Honoraires', [['6226', '250,500', ''], ['401', '', '250,500']]);
    const achats = await saisir('2026-04-02', 'OD-3', 'Petits achats', [['6061', '120', ''], ['532', '', '120']]);
    expect((await api('POST', `/entreprises/${cafe}/compta/ecritures/valider`, associe, { ids: [loyer, achats] })).statut).toBe(200);

    const erreurs: string[] = [];
    const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true });
    const p = await contexte.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message + ' ' + (e.stack ?? '').split('\n').slice(0, 3).join(' / ')));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/journal/2026`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();

    // ── L'export : le CSV de la v10, téléchargé — ce que l'écran montre, brouillard compté ──────
    await p.locator('#lv-brouillard').check();
    await expect.poll(() => p.locator('#view').innerText()).toMatch(/OD-2/);
    await p.getByRole('button', { name: /^Exporter/ }).first().click();
    const [csv] = await Promise.all([p.waitForEvent('download'), p.getByRole('menuitem', { name: /Exporter le livre-journal/ }).click()]);
    expect(csv.suggestedFilename()).toBe('livre-journal-Cafe-des-Arts.csv');
    const exporte = fs.readFileSync(await csv.path(), 'utf8');
    expect(exporte.startsWith('\uFEFFN°;Date;Journal;Pièce;Compte;Tiers;Libellé;Débit;Crédit;Lettrage\r\n')).toBe(true);
    const lignesExportees = exporte.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lignesExportees.filter((l) => l.includes(';OD-2;'))).toEqual([';15/03/2026;OD;OD-2;6226;;Honoraires;250,500;0,000;', ';15/03/2026;OD;OD-2;401;;Honoraires;0,000;250,500;']);

    // ── Corrigé comme dans un tableur ────────────────────────────────────────────────────────
    const corrige = lignesExportees.map((l) => (l.includes(';OD-2;') ? l.replaceAll('250,500', '260,750') : l.includes(';OD-1;') ? l.replaceAll('700,000', '710,000') : l))
      .concat([
        ';20/04/2026;OD;OD-4;6135;;Entretien;90,125;;', ';20/04/2026;OD;OD-4;532;;Entretien;;90,125;',
        ';21/04/2026;OD;OD-5;6063;;Fournitures;50,000;;', ';21/04/2026;OD;OD-5;532;;Fournitures;;40,000;',
      ]).join('\r\n') + '\r\n';
    const [fichier] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#lv-reimport').click()]);
    await fichier.setFiles({ name: 'livre-journal-corrige.csv', mimeType: 'text/csv', buffer: Buffer.from(corrige, 'utf8') });

    // La fenêtre dit ce que l'import fera, avant d'écrire quoi que ce soit.
    const fenetre = p.locator('#modal-root .modal').first();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Réimporter depuis un tableur');
    const dit = await fenetre.innerText();
    expect(dit).toMatch(/livre-journal-corrige\.csv — 5 pièces lues\./);
    expect(dit).toMatch(/1 pièce nouvelle — elle entrera en brouillard\./);
    expect(dit).toMatch(/1 brouillard corrigé — ta version remplace celle du livre, sans numéro\./);
    expect(dit).toMatch(/1 écriture validée que ton fichier change/);
    expect(dit).toMatch(/1 pièce identique au livre\s: rien à faire\./);
    expect(dit).toMatch(/1 pièce refusée\s:[\s\S]*OD OD-5 du 21\/04\/2026 \(lignes 10 à 11\) — débit 50,000 ≠ crédit 40,000\s: elle ne tombe pas juste — corrige-la dans ton tableur, puis réimporte-le/);
    // Le compte nouveau d'une pièce qui entre se nomme ; celui de la pièce refusée, non (elle n'ajoute rien).
    expect(dit).toMatch(/Comptes qui entreront au plan de ce dossier\s: 6135\./);
    expect(dit).not.toMatch(/elles? entreron?t quand même en brouillard/);
    const ok = fenetre.locator('#ok');
    expect(await ok.innerText()).toBe('Importer 2 pièces');
    await fenetre.locator('#imp-corriger').check();
    expect(await ok.innerText()).toBe('Importer 2 pièces et corriger 1 validée');
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-tableur-1-reimport.png') });
    await ok.click();

    // Le compte rendu dit la fin de l'import ; puis ce qui est entré, au serveur.
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 10_000 })
      .toMatch(/^Import fait\s: 1 pièce ajoutée, 1 brouillard corrigé, 1 validée corrigée par contre-passation\. Tout est en brouillard\.$/);
    const apres = await livres(cafe, associe);
    expect(apres.find((e) => e.piece === 'OD-4')?.statut).toBe('brouillard');
    expect(montants(apres.find((e) => e.piece === 'OD-4'))).toEqual([['6135', '90.125', '0.000'], ['532', '0.000', '90.125']]);
    expect(montants(apres.find((e) => e.id === honoraires))).toEqual([['6226', '260.750', '0.000'], ['401', '0.000', '260.750']]);
    expect(apres.find((e) => e.id === honoraires)?.statut).toBe('brouillard');
    // La validée ne bouge pas : elle est contre-passée, et sa version attend au brouillard.
    expect(montants(apres.find((e) => e.id === loyer))).toEqual([['6132', '700.000', '0.000'], ['532', '0.000', '700.000']]);
    expect(apres.find((e) => e.origine.type === 'contre_passation' && e.origine.id === loyer)?.statut).toBe('validee');
    expect(montants(apres.find((e) => e.piece === 'OD-1' && e.statut === 'brouillard'))).toEqual([['6132', '710.000', '0.000'], ['532', '0.000', '710.000']]);
    expect(apres.find((e) => e.piece === 'OD-5')).toBeUndefined();
    expect(montants(apres.find((e) => e.id === achats))).toEqual([['6061', '120.000', '0.000'], ['532', '0.000', '120.000']]);
    await expect.poll(() => p.locator('#modal-root').innerText()).toMatch(/Ce qui n.est pas entré[\s\S]*OD OD-5 du 21\/04\/2026 — débit 50,000 ≠ crédit 40,000/);
    await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Fermer' }).click();

    // ── Le FEC : les écritures validées de l'exercice, sans les brouillards ─────────────────────
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${cafe}/comptabilite/journal/2026`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await p.waitForTimeout(800);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
    // L'écran se redessine une fois après son premier dessin : le menu se rouvre tant que la fenêtre
    // d'export n'est pas là (un clic tombé pendant le redessin se perdait, et le téléchargement avec).
    const sansBrouillards = p.getByRole('button', { name: 'Exporter sans les brouillards' });
    await expect.poll(async () => {
      if (!await sansBrouillards.count()) {
        await p.getByRole('button', { name: /^Exporter/ }).first().click({ timeout: 2_000 }).catch(() => undefined);
        await p.getByRole('menuitem', { name: /Fichier FEC/ }).click({ timeout: 2_000 }).catch(() => undefined);
      }
      return sansBrouillards.count();
    }, { timeout: 30_000 }).toBe(1);
    const [fec] = await Promise.all([p.waitForEvent('download'), sansBrouillards.click()]);
    expect(fec.suggestedFilename()).toMatch(/FEC20261231\.txt$/);
    const rangs = fs.readFileSync(await fec.path(), 'utf8').trim().split('\r\n');
    expect(rangs[0]?.startsWith('JournalCode\tJournalLib\tEcritureNum\tEcritureDate')).toBe(true);
    const validees = (await livres(cafe, associe)).filter((e) => e.statut === 'validee').flatMap((e) => e.lignes);
    expect(rangs.length - 1).toBe(validees.length);
    expect(validees.length).toBe(6);

    // ── La visite « Commencer le livre d'un client » revient (sa fin propose le tableur) : pour un
    // client hors SkanFact qui attend son livre, jamais pour un client sur SkanFact ─────────────────
    const visite = async () => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/guide`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      const ligne = p.locator('li.g-ligne', { hasText: 'Commencer le livre d\'un client' });
      await expect.poll(() => ligne.count()).toBe(1);
      return { texte: await ligne.innerText(), commencer: await ligne.getByRole('button', { name: 'Commencer' }).isEnabled().catch(() => false) };
    };
    expect(await visite()).toMatchObject({ texte: expect.stringMatching(/Pas encore\s: il faut un client hors SkanFact/) });
    const client = await personne('client');
    const menuiserie = String((await api('POST', '/entreprises', client, { raisonSociale: 'Menuiserie Ben Salah' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${menuiserie}/mandat`, client, { codeCabinet: String(cab.corps.code) })).corps.mandat);
    await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, associe);
    expect(await visite()).toMatchObject({ texte: expect.stringMatching(/Pas encore\s: il faut un client hors SkanFact/) });
    await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Boulangerie du Port' });
    const prete = await visite();
    expect(prete.texte).not.toMatch(/Pas encore/);
    expect(prete.commencer).toBe(true);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
