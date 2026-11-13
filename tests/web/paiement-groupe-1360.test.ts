// Un client règle plusieurs factures d'un seul virement (1.360.0, bout en bout 22). Avant, le montant reçu sur une facture
// dépassait son reste : SkanFact proposait un trop-perçu sur cette facture, et les autres restaient « en retard » à côté.
// Le surplus peut maintenant les régler, la plus ancienne d'abord ; la fiche du client propose le même geste. Chez le
// comptable, un règlement par facture ; et le lettrage automatique dit ce qui attend au brouillard.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('un client règle plusieurs factures d\'un seul virement (1.360.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paiement-groupe-1360-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Obj };
  };
  const personne = async (qui: string) => {
    const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const contexte = async (jeton: string, largeur = 1440, hauteur = 900): Promise<BrowserContext> => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
    return cx;
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  const n = (x: string) => ({ '~n': x });

  it('le virement de l\'hôtel règle deux factures : la plus ancienne d\'abord, un règlement par facture, et le lettrage du Cabinet', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Jlassi' });
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises-essai', nour)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nour);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, nour, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${String(cab.corps.id)}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, leila, { annee: 2026, ouverture: [] })).statut).toBe(201);
    const client = { id: 'c1', name: 'Hôtel Mouradi Gammarth', city: 'La Marsa', email: 'compta@mouradi.tn', paymentTermsDays: 30, withholdingRate: 0 };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [
      { collection: 'accounts', cle: 'biat', rang: 0, revision: null, contenu: { id: 'biat', name: 'BIAT', kind: 'banque', bank: 'BIAT', rib: '', opening: n('8000'), openingDate: '2026-01-01', isDefault: true, statementBalance: '' } },
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: client },
    ] })).statut).toBe(200);
    // Trois factures, refaites à la main : 1 000 HT + 190 + 1 = 1 191 ; 500 + 95 + 1 = 596 ; 200 + 38 + 1 = 239. En tout 2 026.
    const facture = (id: string, date: string, dueDate: string, ht: string, objet: string) => ({ id, type: 'facture', number: '', status: 'brouillon', date, dueDate, clientId: 'c1', createdAt: 10, subject: objet,
      lines: [{ label: objet, description: '', qty: n('1'), unit: '', unitPrice: n(ht), vatRate: 19 }],
      discountRate: 0, withholdingRate: 0, applyStamp: true, stampFee: 1, exchangeRate: '', notes: '', currency: 'DT', regimeTva: 'reel', payments: [] });
    for (const [doc, rang, net] of [[facture('f1', '2026-09-01', '2026-10-01', '1000.000', 'Séminaire de septembre'), 30, '1191.000'], [facture('f2', '2026-10-01', '2026-10-31', '500.000', 'Pause-café d\'octobre'), 31, '596.000'], [facture('f3', '2026-11-05', '2026-12-05', '200.000', 'Petits-fours de novembre'), 32, '239.000']] as const) {
      const em = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, nour, { document: doc, client, revision: null, rang, netAPayer: net });
      expect(em.statut, JSON.stringify(em.corps)).toBe(200);
    }

    const erreurs: string[] = [];
    const cx = await contexte(nour);
    await cx.clock.setFixedTime(new Date('2026-11-13T10:00:00+01:00'));
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    p.on('pageerror', (x) => erreurs.push(x.message));
    const fenetre = () => p.locator('#modal-root .modal').last();
    const fermerFenetres = async () => {
      for (let i = 0; i < 4 && await p.locator('#modal-root .modal').count(); i++) {
        const abandon = p.locator('#modal-root .modal').last().getByRole('button', { name: 'Abandonner la saisie', exact: true });
        if (await abandon.count()) await abandon.click(); else await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Annuler', exact: true }).click();
      }
      await expect.poll(async () => p.locator('#modal-root .modal').count(), { timeout: 10_000 }).toBe(0);
    };

    // La fiche du client propose le geste ; un montant au-dessus de ce que doivent les factures cochées est refusé.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/client/c1`);
    await expect.poll(() => p.locator('#view h1').first().innerText(), { timeout: 30_000 }).toMatch(/^Hôtel Mouradi/);
    await plusTard(p);
    await p.locator('#view .cf-tete [data-rowmenu]').click();
    const entree = p.getByRole('menuitem', { name: /^Un paiement pour plusieurs factures…/ });
    expect(net(await entree.innerText())).toBe('Un paiement pour plusieurs factures… 3 factures à encaisser, 2 026,000 DT');
    await entree.click();
    await expect.poll(async () => net(await fenetre().locator('h2').innerText().catch(() => '')), { timeout: 10_000 }).toBe('Hôtel Mouradi Gammarth règle plusieurs factures en un paiement');
    expect(await fenetre().locator('#ee-l tbody tr').evaluateAll((l) => l.map((x) => (x.querySelector('b') as HTMLElement).innerText))).toEqual(['FAC-2026-001', 'FAC-2026-002', 'FAC-2026-003']);
    expect(net(await fenetre().locator('[name=amount]').inputValue())).toBe('2 026,000');
    expect(net(await fenetre().locator('#ok').innerText())).toBe('Enregistrer sur 3 factures · toutes soldées');
    await fenetre().locator('[name=amount]').fill('3000');
    await fenetre().locator('#ok').click();
    await expect.poll(async () => net(await p.locator('body').innerText()), { timeout: 10_000 }).toContain('Les factures cochées ne doivent plus que 2 026,000 DT');
    expect(await p.locator('#modal-root .modal').count()).toBe(1);
    await fermerFenetres();

    // Depuis la facture d'octobre : 1 787 reçus, plus que ses 596. Le surplus va à la plus ancienne.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f2`);
    await p.locator('#pay').waitFor({ timeout: 30_000 });
    await plusTard(p);
    await p.locator('#pay').click();
    await fenetre().locator('[name=amount]').waitFor({ timeout: 10_000 });
    await fenetre().locator('[data-mode="virement"]').click();
    await fenetre().locator('[name=amount]').fill('1787');
    await fenetre().locator('[name=reference]').fill('VIR 88213');
    // Au-dessus du reste, ni « Tout le reste » ni « Une partie » ne s'allume : le montant n'est ni l'un ni l'autre.
    await expect.poll(async () => fenetre().locator('[data-vite].on').count(), { timeout: 5_000 }).toBe(0);
    await fenetre().locator('#ok').click();
    await expect.poll(async () => net(await fenetre().innerText().catch(() => '')), { timeout: 10_000 })
      .toContain('Le montant (1 787,000 DT) dépasse le reste de FAC-2026-002 (596,000 DT). Hôtel Mouradi Gammarth doit encore 1 430,000 DT sur 2 autres factures : le surplus peut les régler, la plus ancienne d\'abord.');
    await fenetre().getByRole('button', { name: 'Répartir sur ses factures', exact: true }).click();
    await expect.poll(async () => net(await fenetre().locator('h2').innerText().catch(() => '')), { timeout: 10_000 }).toBe('Hôtel Mouradi Gammarth règle plusieurs factures en un paiement');
    const ens = fenetre();
    expect(net(await ens.locator('[name=amount]').inputValue())).toBe('1 787,000');
    expect(await ens.locator('[name=reference]').inputValue()).toBe('VIR 88213');
    expect(await ens.locator('[data-mode="virement"]').getAttribute('class')).toContain('on');
    // La facture d'où l'on vient reste comptée ; les parts suivent l'ancienneté.
    expect(await ens.locator('[data-coche="f2"]').isDisabled()).toBe(true);
    expect(await ens.locator('[data-coche="f2"]').isChecked()).toBe(true);
    const parts = async () => ens.locator('#ee-l tbody tr').evaluateAll((l) => l.map((x) => (x.querySelector('[data-part]') as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
    expect(await parts()).toEqual(['1 191,000 DT', '596,000 DT', '—']);
    expect(net(await ens.locator('#ok').innerText())).toBe('Enregistrer sur 2 factures · reste dû 239,000 DT');
    await p.screenshot({ path: path.join(PHOTOS, 'paiement-groupe-1360-1-fenetre.png') });
    await ens.locator('#ok').click();
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => '')), { timeout: 10_000 }).toContain('Paiement de 1 787,000 DT enregistré sur 2 factures · toutes soldées');
    await expect.poll(async () => p.locator('#modal-root .modal').count(), { timeout: 10_000 }).toBe(0);

    // Le serveur : un règlement par facture, la même référence, et une note qui dit le virement entier.
    await expect.poll(async () => (await admin.query('select montant::text as m from ventes.reglement where entreprise = $1 order by montant desc', [ent])).rows.map((r) => r.m), { timeout: 20_000 })
      .toEqual(['1191000', '596000']);
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, nour)).corps.objets as Obj[];
    const doc = (id: string) => (objets.find((o) => o.collection === 'documents' && o.cle === id) as Obj).contenu as Obj;
    for (const [id, montant] of [['f1', 1191], ['f2', 596]] as const) {
      const pays = doc(id).payments as Obj[];
      expect(pays.length).toBe(1);
      expect(pays[0]).toMatchObject({ amount: montant, method: 'virement', reference: 'VIR 88213', date: '2026-11-13' });
      expect(net(String(pays[0]?.note))).toBe('Un virement de 1 787,000 DT pour 2 factures : FAC-2026-001, FAC-2026-002');
    }
    expect(doc('f3').payments).toEqual([]);
    // La fiche du client : il ne reste qu'une facture, le geste groupé disparaît.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/client/c1`);
    await expect.poll(() => p.locator('#view h1').first().innerText(), { timeout: 30_000 }).toMatch(/^Hôtel Mouradi/);
    await p.locator('#view .cf-tete [data-rowmenu]').click();
    await expect.poll(async () => net(await p.locator('.row-menu').innerText().catch(() => '')), { timeout: 10_000 }).toContain('Relevé de compte… 239,000 DT encore dû');
    expect(net(await p.locator('.row-menu').innerText())).not.toContain('Un paiement pour plusieurs factures');
    expect(erreurs).toEqual([]);
    await cx.close();

    // Chez le comptable : deux règlements, chacun sur sa facture, au brouillard. Le lettrage automatique le dit, puis lettre
    // les deux paires une fois validées ; la facture de novembre reste ouverte de 239, comme chez le client.
    type Ligne = { compte: string; debit: string; credit: string; lettre?: string };
    type Ecriture = { id: string; libelle: string; statut: string; date: string; lignes: Ligne[] };
    const ecritures = async () => (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, leila)).corps.ecritures as Ecriture[] ?? [];
    const reglements = async () => (await ecritures()).filter((e) => e.libelle.startsWith('Règlement'));
    await expect.poll(async () => (await reglements()).map((e) => e.libelle).sort(), { timeout: 20_000 })
      .toEqual(['Règlement FAC-2026-001 — Hôtel Mouradi Gammarth', 'Règlement FAC-2026-002 — Hôtel Mouradi Gammarth']);
    const credit411 = (e: Ecriture) => e.lignes.find((l) => l.compte.startsWith('411'))?.credit;
    expect((await reglements()).map(credit411).sort()).toEqual(['1191.000', '596.000']);
    expect((await reglements()).map((e) => e.statut)).toEqual(['brouillard', 'brouillard']);
    const factures = (await ecritures()).filter((e) => e.lignes.some((l) => l.compte.startsWith('411') && Number(l.debit) > 0));
    expect(factures.length).toBe(3);
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, leila, { ids: factures.filter((e) => e.statut === 'brouillard').map((e) => e.id) })).statut).toBe(200);
    const cc = await contexte(leila);
    await cc.clock.setFixedTime(new Date('2026-11-13T10:00:00+01:00'));
    await cc.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const q = await cc.newPage();
    q.on('pageerror', (x) => erreurs.push(x.message));
    const lettrage = async () => {
      await q.goto(`${serveur.adresse}/v10/cabinet/?c=${String(cab.corps.id)}#/dossier/${ent}/comptabilite/lettrage/2026`);
      await q.locator('#lv-auto').waitFor({ timeout: 30_000 });
      for (let i = 0; i < 3 && await q.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await q.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
      await q.locator('#lv-auto').click();
    };
    await lettrage();
    await expect.poll(async () => net(await q.locator('#toast').innerText().catch(() => '')), { timeout: 15_000 })
      .toBe('Rien à lettrer d\'office : 3 lignes validées ouvertes, aucune paire qui se solde sans ambiguïté. 2 lignes au brouillard ne se lettrent qu\'une fois validées.');
    await q.screenshot({ path: path.join(PHOTOS, 'paiement-groupe-1360-2-lettrage.png') });
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, leila, { ids: (await reglements()).map((e) => e.id) })).statut).toBe(200);
    await lettrage();
    await expect.poll(async () => net(await q.locator('#toast').innerText().catch(() => '')), { timeout: 15_000 })
      .toBe('2 lettres posées ; 1 ligne validée reste ouverte.');
    const ouvertes = (await ecritures()).flatMap((e) => e.lignes).filter((l) => l.compte.startsWith('411') && !l.lettre);
    expect(ouvertes.map((l) => l.debit)).toEqual(['239.000']);
    expect(erreurs).toEqual([]);
    await cc.close();
  }, 180_000);
});
