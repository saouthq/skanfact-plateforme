// Bout en bout 21 (1.359.0) : l'Hôtel Mouradi Gammarth règle sa facture de 3 571 DT par chèque ; la banque le rend
// impayé quatre jours plus tard et prélève 15 DT de frais. Le seul geste offert était « Supprimer ce paiement » : la trace du
// chèque disparaissait, la relance n'en disait rien, et le relevé de la banque (la remise ET son rejet) ne s'accordait plus.
// Le rejet est une ligne en face du paiement (`rejetDe`) : la facture redevient due, la Trésorerie et l'écriture du
// comptable disent « Chèque impayé », la relance le dit d'abord, et le rejet se retire si le chèque était bon.

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

describe('bout en bout 21 : un chèque client revenu impayé (1.359.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cheque-impaye-1359-'));
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
  it('le chèque de l\'hôtel revient impayé : la facture redevient due, « Chèque impayé » partout, la relance le dit, le rejet se retire', async () => {
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
    // 3 000 DT HT, 570 de TVA, un timbre : 3 571 DT (refait à la main).
    const f1 = { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: '2026-10-01', dueDate: '2026-10-31', clientId: 'c1', createdAt: 10, subject: 'Séminaire',
      lines: [{ label: 'Séminaire, 60 couverts', description: '', qty: n('1'), unit: '', unitPrice: n('3000.000'), vatRate: 19 }],
      discountRate: 0, withholdingRate: 0, applyStamp: true, stampFee: 1, exchangeRate: '', notes: '', currency: 'DT', regimeTva: 'reel', payments: [] };
    const em = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, nour, { document: f1, client, revision: null, rang: 30, netAPayer: '3571.000' });
    expect(em.statut, JSON.stringify(em.corps)).toBe(200);
    // Le chèque, remis le 2 novembre.
    const objet = async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, nour)).corps.objets as Obj[]).find((o) => o.collection === 'documents' && o.cle === 'f1') as Obj;
    const o1 = await objet();
    const cheque = { id: 'chq1', date: '2026-11-02', amount: 3571, method: 'cheque', reference: 'CHQ 4521873 ATB', accountId: 'biat', note: '' };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [{ collection: 'documents', cle: 'f1', rang: o1.rang, revision: o1.revision, contenu: { ...o1.contenu, payments: [cheque] } }] })).statut).toBe(200);
    // Un rejet qui ne reprend pas le montant du paiement, ou qui désigne un paiement absent, est refusé par le serveur.
    const o2 = await objet();
    for (const faux of [{ ...cheque, id: 'r0', date: '2026-11-06', amount: -100, rejetDe: 'chq1' }, { ...cheque, id: 'r0', date: '2026-11-06', amount: -3571, rejetDe: 'absent' }]) {
      const r = await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [{ collection: 'documents', cle: 'f1', rang: o2.rang, revision: o2.revision, contenu: { ...o2.contenu, payments: [cheque, faux] } }] });
      expect(r.statut).toBe(403);
      expect(JSON.stringify(r.corps)).toContain('ne désigne aucun paiement reçu');
    }

    const erreurs: string[] = [];
    const cx = await contexte(nour);
    await cx.clock.setFixedTime(new Date('2026-11-13T10:00:00+01:00'));
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
    await p.locator('#pay-body').waitFor({ timeout: 30_000 });
    await plusTard(p);
    // Le virement n'a pas ce geste ; le chèque, si.
    const ligneCheque = p.locator('#pay-body tr').filter({ hasText: 'CHQ 4521873 ATB' });
    await ligneCheque.locator('[data-rowmenu]').click();
    await p.getByRole('menuitem', { name: /Le chèque est revenu impayé/ }).click();
    const fen = p.locator('#modal-root .modal').last();
    await expect.poll(async () => net(await fen.innerText().catch(() => '')), { timeout: 10_000 }).toContain('Le chèque est revenu impayé');
    expect(net(await fen.innerText())).toContain('redeviendra due de 3 571,000');
    await fen.locator('.datefield .d-txt').fill('06/11/2026');
    await fen.locator('.datefield .d-txt').press('Tab');
    await fen.locator('[name=frais]').fill('15');
    await p.screenshot({ path: path.join(PHOTOS, 'cheque-impaye-1359-1-fenetre.png') });
    await fen.getByRole('button', { name: 'Enregistrer le rejet', exact: true }).click();
    await expect.poll(async () => p.locator('#modal-root .modal').count(), { timeout: 10_000 }).toBe(0);
    // La facture redevient due ; le paiement reste, marqué ; le rejet vient en face.
    await expect.poll(async () => net(await p.locator('#pay-body').innerText().catch(() => '')), { timeout: 10_000 }).toContain('revenu impayé le 06/11/2026');
    const corpsPay = net(await p.locator('#pay-body').innerText());
    expect(corpsPay).toContain('Chèque impayé');
    expect(corpsPay).toContain('Rejet CHQ 4521873 ATB');
    expect(corpsPay).toMatch(/Reste 3 571,000/i);
    // L'encart dit le chèque avant la relance, et la relance le dit d'abord au client.
    await expect.poll(async () => net(await p.locator('#ed-geste').innerText().catch(() => '')), { timeout: 10_000 }).toContain('Le chèque CHQ 4521873 ATB de 3 571,000 DT est revenu impayé le 06/11');
    expect(net(await p.locator('#ed-geste').innerText())).not.toMatch(/Le (dernière )?relance est prêt /);
    await p.screenshot({ path: path.join(PHOTOS, 'cheque-impaye-1359-2-facture.png'), fullPage: true });
    await p.locator('#ed-relancer').click();
    const rel = p.locator('#modal-root .modal').last();
    await expect.poll(async () => (await rel.locator('textarea').first().inputValue().catch(() => '')).replace(/\s/g, ' '), { timeout: 10_000 })
      .toContain('Votre chèque CHQ 4521873 ATB du 02/11/2026 (3 571,000 DT) nous est revenu impayé le 06/11/2026.');
    await rel.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect.poll(async () => p.locator('#modal-root .modal').count(), { timeout: 10_000 }).toBe(0);

    // Le serveur garde le lien ; l'écriture du comptable s'appelle « Chèque impayé », et les frais vont au 627.
    await expect.poll(async () => (await admin.query('select count(*)::int as n from ventes.reglement where entreprise = $1 and rejet_de is not null and montant = -3571000', [ent])).rows[0].n, { timeout: 20_000 }).toBe(1);
    type Ligne = { compte: string; debit: string; credit: string };
    type Ecriture = { libelle: string; date: string; lignes: Ligne[] };
    const ecritures = async () => (await api('GET', `/entreprises/${ent}/compta/ecritures?du=2026-11-01&au=2026-11-30&limite=200`, leila)).corps.ecritures as Ecriture[] ?? [];
    await expect.poll(async () => (await ecritures()).map((e) => e.libelle).sort(), { timeout: 20_000 })
      .toEqual(['Chèque impayé FAC-2026-001 — Hôtel Mouradi Gammarth', 'Frais de rejet CHQ 4521873 ATB', 'Règlement FAC-2026-001 — Hôtel Mouradi Gammarth'].sort());
    const impaye = (await ecritures()).find((e) => e.libelle.startsWith('Chèque impayé')) as Ecriture;
    expect(impaye.date).toBe('2026-11-06');
    expect(impaye.lignes.find((l) => l.compte.startsWith('411'))?.debit).toBe('3571.000');
    const frais = (await ecritures()).find((e) => e.libelle.startsWith('Frais de rejet')) as Ecriture;
    expect(frais.lignes.find((l) => l.compte.startsWith('627'))?.debit).toBe('15.000');

    // La Trésorerie les nomme ; puis le chèque était bon : « Retirer ce rejet », la facture redevient réglée.
    await p.evaluate(() => { location.hash = '#/doc/f1'; });
    const ligneRejet = p.locator('#pay-body tr').filter({ hasText: 'Rejet CHQ 4521873 ATB' });
    await ligneRejet.locator('[data-rowmenu]').click();
    await p.getByRole('menuitem', { name: /Retirer ce rejet/ }).click();
    const q = p.locator('#modal-root .modal').last();
    await expect.poll(async () => net(await q.innerText().catch(() => '')), { timeout: 10_000 }).toContain('comptera de nouveau comme reçu');
    await q.getByRole('button', { name: 'Retirer le rejet', exact: true }).click();
    await expect.poll(async () => net(await p.locator('#pay-body').innerText().catch(() => '')), { timeout: 10_000 }).not.toContain('revenu impayé');
    await expect.poll(async () => (await admin.query('select count(*)::int as n from ventes.reglement where entreprise = $1 and rejet_de is not null', [ent])).rows[0].n, { timeout: 20_000 }).toBe(0);
    // Rejeté de nouveau, puis le chèque lui-même supprimé : son rejet part avec lui (sans quoi le serveur refuserait un
    // rejet qui ne désigne plus rien, et l'enregistrement tomberait).
    await ligneCheque.locator('[data-rowmenu]').click();
    await p.getByRole('menuitem', { name: /Le chèque est revenu impayé/ }).click();
    const fen2 = p.locator('#modal-root .modal').last();
    await fen2.locator('.datefield .d-txt').fill('06/11/2026');
    await fen2.locator('.datefield .d-txt').press('Tab');
    await fen2.getByRole('button', { name: 'Enregistrer le rejet', exact: true }).click();
    await expect.poll(async () => (await admin.query('select count(*)::int as n from ventes.reglement where entreprise = $1 and rejet_de is not null', [ent])).rows[0].n, { timeout: 20_000 }).toBe(1);
    await ligneCheque.filter({ hasNotText: 'Rejet' }).locator('[data-rowmenu]').click();
    await p.getByRole('menuitem', { name: /Supprimer ce paiement/ }).click();
    const q2 = p.locator('#modal-root .modal').last();
    await expect.poll(async () => net(await q2.innerText().catch(() => '')), { timeout: 10_000 }).toContain('Son rejet du 06/11/2026 part avec lui');
    await q2.getByRole('button', { name: 'Supprimer le paiement', exact: true }).click();
    await expect.poll(async () => (await admin.query('select count(*)::int as n from ventes.reglement where entreprise = $1', [ent])).rows[0].n, { timeout: 20_000 }).toBe(0);
    expect(net(await p.locator('#pay-body').innerText())).not.toContain('Rejet CHQ');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
