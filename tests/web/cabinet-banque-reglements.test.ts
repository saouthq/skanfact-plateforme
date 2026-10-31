// La Banque du Cabinet (1.208.0, maquette B7, B12, B13) : une ligne du relevé qui PAIE des factures encore ouvertes.
// La remise de chèques se propose avec ses trois factures cochées, s'écrit ventilée, se rapproche et se lettre d'un geste ;
// le prélèvement de la STEG se propose (« la seule non réglée ») et s'écrit au brouillard (sa facture l'est) ; le virement
// à la Minoterie ne se lit « net de sa retenue » qu'une fois le taux réglé par le cabinet ; un virement qui ne fait pas la
// somme des pièces cochées se refuse en le disant. Écran ET serveur : les écritures, leurs lignes, leurs lettres.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la Banque : ce qu\'une ligne paie', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cab-bq-regl-'));
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
  type Ligne = { compte: string; debit: string; credit: string; tiers: string | null; lettre: string | null; libelle: string };
  type Ecriture = { id: string; journal: string; piece: string; statut: string; lignes: Ligne[] };

  it('la remise se rapproche et se lettre d\'un geste ; le prélèvement s\'écrit au brouillard et s\'annule ; la retenue se lit une fois son taux réglé ; une somme fausse se refuse', async () => {
    const associe = await personne('associe');
    const cab = await api('POST', '/cabinets', associe, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const ent = String((await api('POST', `/cabinets/${cabinet}/dossiers`, associe, { raisonSociale: 'Boulangerie du Port' })).corps.entreprise);
    const ecrire = async (date: string, journal: string, piece: string, lignes: { compte: string; debit?: string; credit?: string; tiers?: string }[]) =>
      String((await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date, journal, piece, libelle: piece, lignes })).corps.id);
    const vente = (date: string, piece: string, tiers: string, ttc: string) => ecrire(date, 'VT', piece, [{ compte: '411', tiers, debit: ttc }, { compte: '7071', credit: ttc }]);
    // Trois factures de juillet (validées) que la remise de septembre paie ; une quatrième que rien ne paie juste.
    const v1 = await vente('2026-07-20', 'FV-0379', 'Café Jasmin', '512,000');
    const v2 = await vente('2026-07-24', 'FV-0391', 'Hôtel Dar Jerba', '610,500');
    const v3 = await vente('2026-07-28', 'FV-0398', 'Épicerie Ennour', '220,000');
    const v4 = await vente('2026-07-29', 'FV-0400', 'Épicerie Ennour', '97,250');
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, associe, { ids: [v1, v2, v3, v4] })).statut).toBe(200);
    // Deux achats de septembre, au brouillard : la farine et l'électricité.
    await ecrire('2026-09-03', 'AC', 'FA-0914', [{ compte: '601', debit: '1846,200' }, { compte: '401', tiers: 'Minoterie du Cap Bon', credit: '1846,200' }]);
    await ecrire('2026-09-30', 'AC', 'FA-0919', [{ compte: '6061', debit: '186,419' }, { compte: '401', tiers: 'STEG', credit: '186,419' }]);
    expect((await api('POST', `/entreprises/${ent}/compta/releves`, associe, { annee: 2026, compte: '532', banque: 'BIAT', fichier: 'septembre.csv', empreinte: 'b'.repeat(64),
      soldeDebut: '0', soldeFin: '-748,845', lignes: [
        { date: '2026-09-08', libelle: 'VIR Minoterie du Cap Bon', reference: '', montant: '-1818,507' },
        { date: '2026-09-22', libelle: 'REMISE CHQ N 0118 · 3 CHQ', reference: '0118', montant: '1342,500' },
        { date: '2026-09-25', libelle: 'VIR RECU 0042', reference: '', montant: '100,000' },
        { date: '2026-09-30', libelle: 'PRLV STEG 0298 4471', reference: '', montant: '-186,419' },
        // Le même prélèvement une seconde fois (une erreur de la banque) : la facture ne se propose pas deux fois.
        { date: '2026-09-30', libelle: 'PRLV STEG 0298 4472', reference: '', montant: '-186,419' }] })).statut).toBe(201);
    const ecritures = async () => (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, associe)).corps.ecritures as Ecriture[];

    const erreurs: string[] = [];
    const p = await (await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })).newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, associe);
    const aller = async () => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/banque/2026`);
      await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
      for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    };
    const ligne = (texte: string) => p.locator('table.bq-t [data-bq-ligne]').filter({ hasText: texte });
    const groupe = (texte: string) => ligne(texte).getAttribute('data-groupe');
    const livre = () => p.locator('.bq-livre').innerText().then((t) => t.replace(/\s+/g, ' '));
    const cochees = () => p.locator('.bq-fo tr.on b.mono').allInnerTexts();
    const principal = () => p.locator('#bq-principal').innerText().catch(() => '');
    const annonce = () => p.locator('#bq-annonce').innerText().catch(() => '');
    const choisir = async (texte: string) => { await ligne(texte).locator('td').nth(1).click(); await expect.poll(() => p.locator(".bq-lh").innerText()).toContain(texte); };

    await aller();
    // ── Ce qui se propose : la remise (trois factures dont la somme fait la ligne), la STEG (la seule non réglée). La
    // Minoterie paie 27,693 de moins que sa facture : sans taux réglé, ce n'est pas une retenue, la ligne est à traiter.
    await expect.poll(() => groupe('REMISE CHQ')).toBe('prop');
    expect(await ligne('REMISE CHQ').innerText()).toMatch(/FV-0379 · FV-0391 · FV-0398 · 3 pièces : leur somme fait la ligne/);
    expect(await groupe('PRLV STEG 0298 4471')).toBe('prop');
    expect(await ligne('PRLV STEG 0298 4471').innerText()).toMatch(/FA-0919 · STEG · même montant · « STEG » · la seule non réglée/);
    expect(await groupe('Minoterie')).toBe('dec');
    expect(await groupe('PRLV STEG 0298 4472')).toBe('dec');

    // ── La remise : trois cochées, l'écriture ventilée, « Rapprocher et lettrer les 3 » dit avant le geste qu'elle se valide.
    await choisir('REMISE CHQ');
    expect(await cochees()).toEqual(['FV-0379', 'FV-0391', 'FV-0398']);
    await expect.poll(livre).toMatch(/La ligne \+?1\s342,500 DT 3 cochées 1\s342,500 DT .*écart 0/);
    expect(await p.locator('.bq-livre table.bq-ec tbody tr').allInnerTexts()).toEqual([
      expect.stringMatching(/^532\s+REMISE CHQ N 0118 · 3 CHQ\s+1\s342,500\s*$/),
      expect.stringMatching(/^411\s+Café Jasmin · lettre FV-0379\s+512,000$/),
      expect.stringMatching(/^411\s+Hôtel Dar Jerba · lettre FV-0391\s+610,500$/),
      expect.stringMatching(/^411\s+Épicerie Ennour · lettre FV-0398\s+220,000$/)]);
    expect(await livre()).toContain('Les 3 pièces se lettrent au 411 avec ce règlement : pour cela, l\'écriture est validée');
    expect(await principal()).toMatch(/^Rapprocher et lettrer les 3/);
    await p.screenshot({ path: path.join(PHOTOS, 'cabinet-banque-remise.png') });
    await p.keyboard.press('Enter');
    await expect.poll(annonce, { timeout: 15_000 }).toMatch(/REMISE CHQ N 0118 · 3 CHQ » : Rapproché : 3 factures sont payées, lettrées au 411/);
    // Validée et lettrée au serveur : la même lettre sur les trois factures et sur les trois lignes du règlement.
    const remise = (await ecritures()).find((e) => e.journal === 'BQ' && e.piece === '0118');
    expect(remise?.statut).toBe('validee');
    const lettres = (await ecritures()).filter((e) => [v1, v2, v3, remise?.id].includes(e.id)).flatMap((e) => e.lignes.filter((l) => l.compte === '411').map((l) => l.lettre));
    expect(lettres).toHaveLength(6);
    expect(new Set(lettres).size).toBe(1);
    expect(lettres[0]).toMatch(/^[A-Z]+$/);
    // Sans « Annuler » : une écriture validée se contre-passe, le message ne promet pas de la défaire.
    expect(await p.locator('#bq-annuler').count()).toBe(0);
    // La ligne quitte les proposées pour les rapprochées (repliées).
    expect(await ligne('REMISE CHQ').count()).toBe(0);
    expect(await p.locator('[data-bq-filtre="ok"]').innerText()).toMatch(/^1\s+Rapprochées$/);
    // (B6) Ouverte, la rapprochée dit ce qu'elle paie, puis qui l'a posée.
    await p.locator('#bq-voir-faites').click();
    await expect.poll(() => ligne('REMISE CHQ').innerText()).toMatch(/avec 0118 · REMISE CHQ N 0118 · 3 CHQ\s*encaissement de FV-0379, FV-0391, FV-0398\s*à la main/);
    await p.locator('#bq-voir-faites').click();

    // ── La STEG : sa facture est au brouillard ; l'écriture se passe au brouillard, se rapproche, et « Annuler » la retire.
    await choisir('PRLV STEG 0298 4471');
    expect(await cochees()).toEqual(['FA-0919']);
    expect(await livre()).toContain('FA-0919 est au brouillard : l\'écriture se passe au brouillard et se rapproche ; le lettrage se fera une fois tout validé.');
    expect(await principal()).toMatch(/^Écrire et rapprocher/);
    await p.locator('#bq-principal').click();
    await expect.poll(annonce, { timeout: 15_000 }).toMatch(/Règlement de FA-0919 écrit au brouillard, et rapproché/);
    await expect.poll(async () => (await ecritures()).filter((e) => e.journal === 'BQ' && e.lignes.some((l) => l.tiers === 'STEG')).map((e) => e.statut)).toEqual(['brouillard']);
    await p.locator('#bq-annuler').click();
    await expect.poll(async () => (await ecritures()).filter((e) => e.journal === 'BQ' && e.lignes.some((l) => l.tiers === 'STEG')).length).toBe(0);
    await expect.poll(() => groupe('PRLV STEG 0298 4471')).toBe('prop');

    // ── Le taux de retenue se règle dans « Les règles de la banque » : un taux faux se refuse sur son champ.
    await p.locator(`[data-rowmenu="F:${ent}"]`).first().click();
    await p.getByRole('menuitem').filter({ hasText: 'Les règles de la banque' }).click();
    // (1.209.0) Les règles sont une page de la Banque ; les taux y sont, sous les règles.
    const regles = p.locator('.bqr-page');
    await regles.locator('#bq-taux').fill('1,5 ; beaucoup');
    await regles.locator('#bq-taux-ok').click();
    await expect.poll(() => p.locator('body').innerText()).toContain('« beaucoup » n\'est pas un taux');
    await regles.locator('#bq-taux').fill('1,5');
    await regles.locator('#bq-taux-ok').click();
    await expect.poll(() => p.locator('#toast').innerText()).toMatch(/1 taux retenu : 1,5 %/);
    await p.locator('#bqr-retour').click();
    // La Minoterie se lit maintenant au net de sa retenue : 1 846,200 − 27,693 = 1 818,507, au 4352 (opérée, une dette).
    await expect.poll(() => groupe('Minoterie')).toBe('prop');
    expect(await ligne('Minoterie').innerText()).toMatch(/FA-0914 · Minoterie du Cap Bon · net de sa retenue 27,693 · certificat à remettre/);
    await choisir('Minoterie');
    expect(await p.locator('.bq-livre table.bq-ec tbody tr').last().innerText()).toMatch(/^4352\s+Retenue à la source opérée \(1,5 %\)\s+27,693$/);
    expect(await livre()).toMatch(/À VÉRIFIER : le taux et l'assiette/);

    // ── « Valider les 2 » : la STEG et la Minoterie s'écrivent au brouillard d'après leur facture, et se rapprochent.
    await p.locator('[data-bq-valider]').first().click();
    await expect.poll(() => p.locator('#toast').innerText(), { timeout: 15_000 }).toMatch(/2 lignes rapprochées : 2 règlements écrits au brouillard d'après leurs factures/);
    const bq = (await ecritures()).filter((e) => e.journal === 'BQ' && e.statut === 'brouillard');
    const n = (x: string) => Number(String(x).replace(',', '.'));
    expect(bq.map((e) => e.lignes.map((l) => `${l.compte} ${n(l.debit)} ${n(l.credit)}`).sort().join(' | ')).sort()).toEqual([
      '401 1846.2 0 | 4352 0 27.693 | 532 0 1818.507', '401 186.419 0 | 532 0 186.419']);

    // ── « Partager entre plusieurs pièces » montre les factures ouvertes ; cochée, une somme fausse se refuse en le disant.
    await choisir('VIR RECU 0042');
    await ligne('VIR RECU 0042').locator('[data-rowmenu^="LIG:"]').click();
    await p.getByRole('menuitem').filter({ hasText: 'Partager entre plusieurs pièces' }).click();
    await p.locator('.bq-fo tr').filter({ hasText: 'FV-0400' }).click();
    await expect.poll(livre).toContain('La pièce cochée fait 97,250 DT, la ligne 100,000 DT (écart 2,750 DT)');
    expect(await p.locator('#bq-principal').count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 240_000);
});
