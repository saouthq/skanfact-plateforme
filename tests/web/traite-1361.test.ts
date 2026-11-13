// La traite (1.361.0, bout en bout 24). L'Hôtel Mouradi règle une facture de 477 DT par une traite reçue le 13 novembre, à
// échéance du 15 janvier 2027. L'entreprise la disait réglée ce jour-là ; le serveur ne gardait que l'échéance, et le
// comptable voyait l'hôtel devoir la facture jusqu'en janvier — et au bilan de 2026. Le règlement garde maintenant le
// jour de la traite : ce jour-là la créance passe du 411 au 413, et la banque solde le 413 à l'échéance. Côté achats, la
// traite remise à la minoterie passe du 401 au 403. L'écran dit quand la banque bougera, et ne propose pas « revenu
// impayé » avant l'échéance (le serveur le refuse aussi).

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

describe('la traite reçue d\'un client, et la traite remise à un fournisseur (1.361.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-traite-1361-'));
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

  it('la traite de l\'hôtel : le 411 soldé le jour de la traite, le 413 jusqu\'à l\'échéance ; la traite à la minoterie : le 403', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Jlassi' });
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises-essai', nour)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nour);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, nour, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${String(cab.corps.id)}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, leila, { annee: 2026, ouverture: [] })).statut).toBe(201);
    const client = { id: 'c1', name: 'Hôtel Mouradi Gammarth', city: 'La Marsa', email: 'compta@mouradi.tn', paymentTermsDays: 30, withholdingRate: 0 };
    // La minoterie : une facture de farine de 1 000 DT HT (190 de TVA), réglée par une traite remise le 10 novembre.
    const farine = { id: 'a1', kind: 'facture', number: 'MS-2026-0871', date: '2026-11-05', dueDate: '2026-12-05', supplierId: 's1', currency: 'DT', fees: 0, withholdingRate: 0,
      createdAt: Date.parse('2026-11-05T09:00:00+01:00'), attachments: [],
      payments: [{ id: 'ta1', date: '2027-01-31', amount: n('1190'), method: 'traite', reference: 'LCN 0091 BIAT', accountId: 'biat', note: '', effet: { recuLe: '2026-11-10' } }],
      lines: [{ label: 'Farine de blé tendre, 20 sacs', qty: 20, unitPrice: n('50'), vatRate: 19, destination: 'charge' }] };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [
      { collection: 'accounts', cle: 'biat', rang: 0, revision: null, contenu: { id: 'biat', name: 'BIAT', kind: 'banque', bank: 'BIAT', rib: '', opening: n('8000'), openingDate: '2026-01-01', isDefault: true, statementBalance: '' } },
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: client },
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Minoterie du Sahel', paymentTermsDays: 30, withholdingRate: 0 } },
      { collection: 'purchases', cle: 'a1', rang: 0, revision: null, contenu: farine },
    ] })).statut).toBe(200);
    // 400 DT HT, 76 de TVA, un timbre : 477 DT (refait à la main).
    const f1 = { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: '2026-11-02', dueDate: '2026-12-02', clientId: 'c1', createdAt: 10, subject: 'Pause-café séminaire',
      lines: [{ label: 'Pause-café séminaire, 40 personnes', description: '', qty: n('1'), unit: '', unitPrice: n('400.000'), vatRate: 19 }],
      discountRate: 0, withholdingRate: 0, applyStamp: true, stampFee: 1, exchangeRate: '', notes: '', currency: 'DT', regimeTva: 'reel', payments: [] };
    const em = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, nour, { document: f1, client, revision: null, rang: 30, netAPayer: '477.000' });
    expect(em.statut, JSON.stringify(em.corps)).toBe(200);
    const objet = async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, nour)).corps.objets as Obj[]).find((o) => o.collection === 'documents' && o.cle === 'f1') as Obj;
    const traite = { id: 'tr1', date: '2027-01-15', amount: 477, method: 'traite', reference: 'LCN 0048217 STB', accountId: 'biat', note: '', effet: { recuLe: '2026-11-13' } };
    // La gérante note d'abord la traite sans le jour où elle l'a reçue, puis le complète : le serveur suit.
    const sansJour = { ...traite, effet: undefined };
    const lu = async () => (await admin.query('select date_reglement::text echeance, effet_recu_le::text recue from ventes.reglement where entreprise = $1 and ref_v10 = $2', [ent, 'tr1'])).rows[0];
    const o0 = await objet();
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [{ collection: 'documents', cle: 'f1', rang: o0.rang, revision: o0.revision, contenu: { ...o0.contenu, payments: [sansJour] } }] })).statut).toBe(200);
    expect(await lu()).toEqual({ echeance: '2027-01-15', recue: null });
    const o1 = await objet();
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [{ collection: 'documents', cle: 'f1', rang: o1.rang, revision: o1.revision, contenu: { ...o1.contenu, payments: [traite] } }] })).statut).toBe(200);
    // Le serveur garde le jour de la traite.
    expect(await lu()).toEqual({ echeance: '2027-01-15', recue: '2026-11-13' });
    // Un « revenu impayé » daté avant l'échéance de la traite est refusé : elle n'a pas encore été présentée.
    const o2 = await objet();
    const tot = { ...traite, id: 'rj1', date: '2026-11-20', amount: -477, rejetDe: 'tr1' };
    const refus = await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [{ collection: 'documents', cle: 'f1', rang: o2.rang, revision: o2.revision, contenu: { ...o2.contenu, payments: [traite, tot] } }] });
    expect(refus.statut).toBe(403);
    expect(JSON.stringify(refus.corps)).toContain('est daté avant lui');

    // Les écritures, telles que le comptable les lit.
    type Ecr = { date: string; journal: string; origine_type: string; libelle: string; lignes: string };
    const ecritures = async (): Promise<Ecr[]> => (await admin.query(`select e.date_ecriture::text date, e.journal, e.origine_type, e.libelle,
        (select string_agg(l.compte || ' ' || l.debit || '/' || l.credit, ' ; ' order by l.rang) from compta.ligne l where l.ecriture = e.id) lignes
      from compta.ecriture e where e.entreprise = $1 and e.origine_type in ('effet', 'encaissement', 'reglement_fournisseur') order by e.date_ecriture, e.libelle`, [ent])).rows as Ecr[];
    await expect.poll(async () => (await ecritures()).length, { timeout: 20_000 }).toBe(4);
    expect((await ecritures()).map((e) => [e.date, e.journal, e.origine_type, e.libelle, e.lignes])).toEqual([
      ['2026-11-10', 'OD', 'effet', 'Effet remis MS-2026-0871 — Minoterie du Sahel, échéance 31/01/2027', '401 1190000/0 ; 403 0/1190000'],
      ['2026-11-13', 'OD', 'effet', 'Effet reçu FAC-2026-001 — Hôtel Mouradi Gammarth, échéance 15/01/2027', '413 477000/0 ; 411 0/477000'],
      ['2027-01-15', 'BQ', 'encaissement', 'Effet encaissé FAC-2026-001 — Hôtel Mouradi Gammarth', '532 477000/0 ; 413 0/477000'],
      ['2027-01-31', 'BQ', 'reglement_fournisseur', 'Effet payé MS-2026-0871 — Minoterie du Sahel', '403 1190000/0 ; 532 0/1190000'],
    ]);
    // Au 31 décembre 2026 : l'hôtel ne doit plus rien au 411, la traite attend au 413 ; la minoterie, au 403.
    const solde = async (compte: string) => String((await admin.query(`select coalesce(sum(l.debit - l.credit), 0)::text s from compta.ligne l join compta.ecriture e on e.id = l.ecriture
      where e.entreprise = $1 and l.compte = $2 and e.date_ecriture <= '2026-12-31'`, [ent, compte])).rows[0].s);
    expect([await solde('411'), await solde('413'), await solde('401'), await solde('403')]).toEqual(['0', '477000', '0', '-1190000']);

    // L'écran de la facture le 13 novembre : réglée par traite, la banque l'encaisse le 15 janvier.
    const erreurs: string[] = [];
    const cx = await contexte(nour);
    await cx.clock.setFixedTime(new Date('2026-11-13T10:00:00+01:00'));
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
    await p.locator('#pay-body').waitFor({ timeout: 30_000 });
    await plusTard(p);
    await expect.poll(async () => net(await p.locator('#ed-geste').innerText().catch(() => '')), { timeout: 10_000 }).toContain('Réglée par traite : la banque l\'encaisse le 15/01/2027.');
    expect(net(await p.locator('#ed-frise').innerText())).toContain('par traite · à la banque le 15/01/2027');
    const ligne = p.locator('#pay-body tr').filter({ hasText: 'LCN 0048217 STB' }).first();
    expect(net(await ligne.innerText())).toContain('13/11/2026 à la banque le 15/01/2027');
    await ligne.locator('[data-rowmenu]').click();
    await p.getByRole('menuitem', { name: /Modifier ce paiement/ }).waitFor({ timeout: 5_000 });
    expect(await p.getByRole('menuitem', { name: /revenu impayé/ }).count()).toBe(0);
    // La fenêtre du paiement nomme ses deux dates : le jour où la traite a été reçue, et son échéance.
    await p.getByRole('menuitem', { name: /Modifier ce paiement/ }).click();
    const fen = p.locator('#modal-root .modal').last();
    await expect.poll(async () => net(await fen.innerText().catch(() => '')), { timeout: 10_000 }).toContain('Reçue le');
    expect(net(await fen.innerText())).toContain('Échéance de l\'effet');
    await fen.getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(async () => p.locator('#modal-root .modal').count(), { timeout: 5_000 }).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'traite-1361-facture.png') });

    // La facture de la minoterie : la traite remise, à la banque le 31 janvier.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/achat/a1`);
    await expect.poll(async () => net(await p.locator('#view').innerText().catch(() => '')), { timeout: 20_000 }).toContain('10/11/2026 à la banque le 31/01/2027');
    // L'étape « Réglée » de la frise dit quand l'argent sortira, et non l'échéance seule comme si la pièce avait été réglée ce jour-là.
    expect(net(await p.locator('#ed-frise').innerText())).toContain('par traite · à la banque le 31/01/2027');
    // La fenêtre du règlement nomme la date de la traite, et ne compte pas deux fois le règlement qu'on modifie.
    await p.locator('#view tr').filter({ hasText: 'LCN 0091 BIAT' }).first().locator('[data-rowmenu]').click();
    await p.getByRole('menuitem', { name: /Modifier ce règlement/ }).click();
    const fenA = p.locator('#modal-root .modal').last();
    await expect.poll(async () => net(await fenA.innerText().catch(() => '')), { timeout: 10_000 }).toContain('Remise le');
    expect(net(await fenA.innerText())).toContain('déjà réglé 0,000 DT · reste 1 190,000 DT');
    await fenA.getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(async () => p.locator('#modal-root .modal').count(), { timeout: 5_000 }).toBe(0);
    // Les listes : « traite au 31/01 », et non « payée le 31/01 », une date à venir.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/achats`);
    await expect.poll(async () => net(await p.locator('#view').innerText().catch(() => '')), { timeout: 20_000 }).toContain('traite au 31/01');
    expect(net(await p.locator('#view').innerText())).not.toContain('payée le 31/01');
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/factures`);
    await expect.poll(async () => net(await p.locator('#view').innerText().catch(() => '')), { timeout: 20_000 }).toContain('traite au 15/01');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
