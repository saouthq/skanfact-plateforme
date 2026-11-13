// Bout en bout 20 (1.358.2) : une facture de décembre 2025 (3 571 DT à l'Hôtel Mouradi Gammarth), les à-nouveaux de 2026
// posés par le Cabinet, le règlement de janvier et un avoir partiel. Quatre défauts trouvés à la souris : (1) au lettrage de
// 2026, le même client en DEUX tiers — la ligne d'à-nouveaux ne portait que son nom, le règlement son identifiant ; (2) la
// grille du Cabinet passée à 2026 proposait encore « 31/12/2025 » ; (3) « rien n'attend au brouillard » au-dessus
// d'AN-2026 ; (4) côté entreprise, « dernière : FAC-2025-001 · 18/12 », lu en janvier, et « Sous 1 000 DT : pas de retenue
// sur l'avoir, comme sur sa facture » pour un client sans retenue.

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

describe('bout en bout 20 : une facture de décembre, son règlement de janvier, et le Cabinet qui change d\'exercice (1.358.2)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-tiers-janvier-13582-'));
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
  it('Nour facture en décembre, l\'hôtel règle en janvier : un seul tiers au lettrage de 2026, la grille dans son exercice, le brouillard compté en entier', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Jlassi' });
    const cabinet = String(cab.corps.id);
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises-essai', nour)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nour);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, nour, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, leila, { annee: 2025, ouverture: [] })).statut).toBe(201);
    // Le seuil de la retenue (1 000 DT, en millimes), règle de cette seule entreprise : c'est lui qui faisait parler l'avoir.
    const proprio = String((await admin.query('select utilisateur from socle.membre where entreprise = $1 limit 1', [ent])).rows[0].utilisateur);
    await admin.query(`insert into socle.regle_entreprise (entreprise, code, valeur, debut, motif, cree_par) values ($1, 'retenue.seuil', '1000000', '2000-01-01', 'Seuil de l''essai', $2)`, [ent, proprio]);
    const client = { id: 'c1', name: 'Hôtel Mouradi Gammarth', city: 'La Marsa', paymentTermsDays: 30, withholdingRate: 0 };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [
      { collection: 'accounts', cle: 'biat', rang: 0, revision: null, contenu: { id: 'biat', name: 'BIAT', kind: 'banque', bank: 'BIAT', rib: '', opening: n('8000'), openingDate: '2025-12-01', isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: client },
    ] })).statut).toBe(200);
    // 3 000 DT HT, 570 de TVA, un timbre : 3 571 DT (refait à la main).
    const f1 = { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: '2025-12-18', dueDate: '2026-01-17', clientId: 'c1', createdAt: 10, subject: 'Buffet du réveillon',
      lines: [{ label: 'Buffet du réveillon, 120 couverts', description: '', qty: n('1'), unit: '', unitPrice: n('3000.000'), vatRate: 19 }],
      discountRate: 0, withholdingRate: 0, applyStamp: true, stampFee: 1, exchangeRate: '', notes: '', currency: 'DT', regimeTva: 'reel', payments: [] };
    const em = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, nour, { document: f1, client, revision: null, rang: 30, netAPayer: '3571.000' });
    expect(em.statut, JSON.stringify(em.corps)).toBe(200);
    type Ligne = { compte: string; debit: string; credit: string; tiers: string | null; tiersId: string | null };
    type Ecriture = { id: string; journal: string; date: string; statut: string; tiers: string | null; lignes: Ligne[] };
    const ecritures = async (du: string, au: string) => (await api('GET', `/entreprises/${ent}/compta/ecritures?du=${du}&au=${au}&limite=200`, leila)).corps.ecritures as Ecriture[] ?? [];
    let vente: Ecriture | undefined;
    await expect.poll(async () => { vente = (await ecritures('2025-01-01', '2025-12-31')).find((e) => e.journal === 'VT'); return !!vente; }, { timeout: 20_000 }).toBe(true);
    expect(vente?.tiers).toMatch(/^[0-9a-f-]{36}$/);
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures/valider`, leila, { ids: (await ecritures('2025-01-01', '2025-12-31')).map((e) => e.id) })).statut).toBe(200);

    const erreurs: string[] = [];
    // 1. Côté entreprise, en janvier : la facture de décembre se date en entier, et l'avoir d'un client sans retenue ne parle
    //    pas du seuil.
    const cx = await contexte(nour);
    await cx.clock.setFixedTime(new Date('2026-01-20T10:00:00+01:00'));
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/new/facture`);
    await p.locator('#ed-pq-q:visible, #ed-client:visible').first().waitFor({ timeout: 30_000 });
    await plusTard(p);
    await p.locator('#ed-pq-q').fill('Mouradi');
    await p.locator('#ed-pq-liste [role=option][data-cl]').first().click();
    const puce = p.locator('.ed-chip').filter({ hasText: /^dernière/ });
    await expect.poll(async () => net(await puce.innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/^dernière : FAC-2025-\d+ · 18\/12\/2025 · 3 571,000 DT/);
    await p.evaluate(() => { location.hash = '#/doc/new/avoir/f1'; });
    await p.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click({ timeout: 10_000 });
    const pu = p.locator('#lines tr[data-i="0"] input[data-k=unitPrice]');
    await pu.waitFor({ timeout: 20_000 });
    await pu.fill('500');
    await pu.press('Tab');
    await expect.poll(async () => net(await p.locator('#totals').innerText().catch(() => '')), { timeout: 10_000 }).toContain('595,000');
    await expect.poll(async () => net(await p.locator('#ed-avant').innerText().catch(() => '')), { timeout: 10_000 }).not.toBe('');
    expect(net(await p.locator('#ed-avant').innerText())).not.toContain('retenue');
    await p.screenshot({ path: path.join(PHOTOS, 'tiers-janvier-13582-1-avoir.png') });
    // Le brouillon s'abandonne : la question le nomme en français (« Supprimer Avoir (brouillon) ? » avant), et rien ne
    // demande ensuite « Quitter sans enregistrer ? » sur la pièce qu'on vient de supprimer (ce poste ne garde rien).
    await p.locator('#more-btn').click();
    await p.getByRole('menuitem', { name: /^(Abandonner ce brouillon|Supprimer le brouillon)/ }).click();
    const question = p.locator('#modal-root .modal').last();
    await expect.poll(async () => net(await question.innerText().catch(() => '')), { timeout: 10_000 }).toContain('Supprimer ce brouillon d\'avoir ?');
    expect(net(await question.innerText())).not.toContain('(brouillon)');
    await question.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect.poll(async () => (await p.locator('#modal-root .modal').count()) ? net(await p.locator('#modal-root .modal').last().innerText()) : '', { timeout: 10_000 }).toBe('');

    // 2. Au Cabinet, le 20 janvier : la grille de 2025 propose son dernier jour ; « Ouvrir 2026 » pose les à-nouveaux et
    //    emmène à la saisie de 2026, dont la grille propose un jour de 2026.
    const cc = await contexte(leila);
    await cc.clock.setFixedTime(new Date('2026-01-20T10:00:00+01:00'));
    await cc.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const c = await cc.newPage();
    c.on('pageerror', (x) => erreurs.push(x.message));
    const aller = async (h: string) => { await c.evaluate((x) => { location.hash = x; }, h); };
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/saisie/2025`);
    await c.locator('#sa-date').waitFor({ timeout: 30_000 });
    await plusTard(c);
    const dateGrille = () => c.locator('#sa-date').inputValue();
    expect(['31/12/2025', '31']).toContain(await dateGrille());
    await aller(`#/dossier/${ent}/comptabilite/exercice/2025`);
    await c.locator('#cl-suivant').click({ timeout: 20_000 });
    await c.getByRole('button', { name: 'Ouvrir 2026', exact: true }).click({ timeout: 20_000 });
    await c.locator('#sa-date').waitFor({ timeout: 20_000 });
    await expect.poll(() => c.url()).toContain('/saisie/2026');
    expect(['20/01/2026', '20']).toContain(await dateGrille());
    // Deux chemins, un chiffre : la ligne d'à-nouveaux du client porte son IDENTIFIANT au serveur, celui de sa facture.
    let an: Ecriture | undefined;
    await expect.poll(async () => { an = (await ecritures('2026-01-01', '2026-12-31')).find((e) => e.journal === 'AN'); return !!an; }, { timeout: 20_000 }).toBe(true);
    const an411 = an?.lignes.filter((l) => l.compte.startsWith('411')) ?? [];
    expect(an411.map((l) => [l.debit, l.tiersId])).toEqual([['3571.000', vente?.tiers]]);

    // 3. L'hôtel règle 2 000 DT le 10 janvier ; la page relue, janvier compte deux écritures au brouillard (AN-2026 et le
    //    règlement), et le lettrage de 2026 un seul tiers, qui doit 1 571 DT.
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, nour)).corps.objets as Obj[];
    const emise = (await objets()).find((o) => o.collection === 'documents' && o.cle === 'f1') as Obj;
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [
      { collection: 'documents', cle: 'f1', rang: 30, revision: emise.revision, contenu: { ...emise.contenu, payments: [{ id: 'p1', date: '2026-01-10', amount: n('2000'), method: 'virement', accountId: 'biat', reference: 'VIR 0110', note: '' }] } },
    ] })).statut).toBe(200);
    await expect.poll(async () => (await ecritures('2026-01-01', '2026-01-31')).some((e) => e.journal !== 'AN'), { timeout: 20_000 }).toBe(true);
    await c.reload();
    await c.locator('#sa-date').waitFor({ timeout: 30_000 });
    // Le mois se choisit dans les livres (le livre-journal), et la saisie le garde.
    await aller(`#/dossier/${ent}/comptabilite/journal/2026`);
    await c.locator('#lv-mode').selectOption('mois', { timeout: 20_000 });
    await c.locator('#lv-mois').selectOption('2026-01');
    await aller(`#/dossier/${ent}/comptabilite/saisie/2026`);
    await expect.poll(async () => net(await c.locator('#view').innerText()), { timeout: 15_000 }).toContain('2 écritures attendent au brouillard');
    const tiersDuLettrage = async () => {
      await aller(`#/dossier/${ent}/comptabilite/lettrage/2026`);
      await c.locator('#lv-brouillard').check({ timeout: 20_000 }).catch(() => undefined);
      const agee = c.locator('h2', { hasText: /^Ce qui reste dû, par ancienneté/ }).locator('xpath=..');
      await agee.waitFor({ timeout: 15_000 });
      return { lignes: (await agee.locator('tbody tr').allInnerTexts()).map(net), pied: net(await agee.locator('tfoot td').first().innerText()) };
    };
    await expect.poll(tiersDuLettrage, { timeout: 20_000 }).toEqual({ lignes: [expect.stringMatching(/^Hôtel Mouradi Gammarth .*1 571,000/)], pied: '1 tiers' });
    await c.screenshot({ path: path.join(PHOTOS, 'tiers-janvier-13582-2-lettrage.png'), fullPage: true });

    // 4. Une ligne saisie avant que la ligne ait sa case (son nom seul) se range sous le seul tiers qui porte ce nom.
    const od = await api('POST', `/entreprises/${ent}/compta/ecritures`, leila, { date: '2026-01-15', journal: 'OD', piece: 'OD-1', libelle: 'Escompte accordé',
      lignes: [{ compte: '411', credit: '100', tiers: 'Hôtel Mouradi Gammarth' }, { compte: '6265', debit: '100' }] });
    expect(od.statut, JSON.stringify(od.corps)).toBe(201);
    await c.reload();
    await c.locator('#view h1').first().waitFor({ timeout: 30_000 });
    await expect.poll(tiersDuLettrage, { timeout: 20_000 }).toEqual({ lignes: [expect.stringMatching(/^Hôtel Mouradi Gammarth .*1 471,000/)], pied: '1 tiers' });
    expect(erreurs).toEqual([]);
    await cx.close();
    await cc.close();
  }, 240_000);
});
