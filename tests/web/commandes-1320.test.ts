// Les commandes fournisseurs, 1.320.0, jouées par la droguerie de l'Ariana (« Droguerie El Amen ») jusqu'au bilan : 30 pots
// de peinture commandés au Grossiste Sfax, reçus le 28 décembre, dont la facture n'arrive que le 8 janvier ; 12 brosses de la
// Quincaillerie du Nord reçues le 30 sans facture ; une réception de décembre déjà facturée. Hédi envoie l'état du stock au
// 31/12/2025 : ce qui est reçu sans facture part avec lui. La facture des brosses arrive, datée du 31 : la carte dit de
// renvoyer. Inès, au Cabinet, lit ce qui reste reçu sans facture et le passe en facture non parvenue (607 / 408), au
// brouillard, au millime : 1 897,350 (30 × 63,245).
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'commandes-1320.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('les commandes fournisseurs 1.320.0 : la droguerie reçoit sans facture en décembre, sa comptable le passe en facture non parvenue', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-commandes-1320-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'commandes-1320.txt'), '');
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
  const toast = async (p: Page) => net(await p.locator('#toast').innerText().catch(() => ''));
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });


  it('ce qui est reçu sans facture au 31/12 part avec l\'état du stock, et se passe en facture non parvenue au Cabinet', async () => {
    const ines = await personne('ines');
    const cab = await api('POST', '/cabinets', ines, { nom: 'Cabinet Ariana Audit' });
    const cabinet = String(cab.corps.id);
    const hedi = await personne('hedi');
    const ent = String((await api('POST', `/entreprises-essai`, hedi)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, hedi, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, ines)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, hedi)).corps.objets as Obj[];
    await objets();
    const auj = jourDe(0).split('-').reverse().join('/');
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Hédi Trabelsi', name: 'Droguerie El Amen', city: 'Ariana', activity: 'commerce' };
    const ligne = (itemId: string, label: string, qty: number, unitPrice: number) => ({ label, itemId, qty, unit: itemId === 'peint' ? 'pot' : 'pièce', unitPrice, vatRate: 19 });
    const commande = (id: string, number: string, date: string, supplierId: string, l: Obj) => ({ id, number, date, supplierId, status: 'envoyée', currency: 'DT', createdAt: Date.parse(date), lines: [l] });
    const reception = (id: string, number: string, date: string, supplierId: string, orderId: string, orderNumber: string, l: Obj) => ({
      id, number, date, supplierId, orderId, orderNumber, status: 'validée', currency: 'DT', createdAt: Date.parse(date), validatedTs: Date.parse(date), notes: '', lines: [{ ...l, ligneCommande: 0 }] });
    const facture = (id: string, number: string, date: string, supplierId: string, rec: string, l: Obj, stock: boolean) => ({
      id, kind: 'facture', number, date, dueDate: date, supplierId, currency: 'DT', createdAt: Date.parse(date), payments: [], receptions: [{ id: rec }],
      lines: [{ ...l, destination: stock ? 'stock' : 'charge', deductible: true, recue: true }] });
    const peint = (q: number, pu: number) => ligne('peint', 'Peinture murale blanche 10 L', q, pu);
    const brosses = ligne('brosse', 'Brosse plate 50 mm', 12, 4.375);
    const ch = (collection: string, cle: string, rang: number, contenu: Obj) => ({ collection, cle, rang, revision: null, contenu: enc(contenu) });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hedi, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      ch('suppliers', 'f1', 0, { id: 'f1', name: 'Grossiste Sfax' }),
      ch('suppliers', 'f2', 1, { id: 'f2', name: 'Quincaillerie du Nord' }),
      ch('catalog', 'peint', 0, { id: 'peint', label: 'Peinture murale blanche 10 L', code: 'PNT-10', unit: 'pot', unitPrice: 89, vatRate: 19, tracked: true, initialQty: 40, initialCost: 61, initialDate: '2025-01-02' }),
      ch('catalog', 'brosse', 1, { id: 'brosse', label: 'Brosse plate 50 mm', unit: 'pièce', unitPrice: 7, vatRate: 19 }),
      ch('purchases', 'p1', 0, { id: 'p1', kind: 'facture', number: 'GS-2025-031', date: '2025-03-10', dueDate: '2025-04-10', supplierId: 'f1', currency: 'DT',
        createdAt: Date.parse('2025-03-10'), payments: [], lines: [{ ...peint(20, 63), destination: 'stock', deductible: true }] }),
      ch('supplierOrders', 'o1', 0, commande('o1', 'BCF-2025-001', '2025-12-10', 'f1', peint(10, 63.5))),
      ch('supplierOrders', 'o2', 1, commande('o2', 'BCF-2025-002', '2025-12-20', 'f1', peint(30, 63.245))),
      ch('supplierOrders', 'o3', 2, commande('o3', 'BCF-2025-003', '2025-12-22', 'f2', brosses)),
      ch('receptions', 'r1', 0, reception('r1', 'BR-2025-001', '2025-12-15', 'f1', 'o1', 'BCF-2025-001', peint(10, 63.5))),
      ch('receptions', 'r2', 1, reception('r2', 'BR-2025-002', '2025-12-28', 'f1', 'o2', 'BCF-2025-002', peint(30, 63.245))),
      ch('receptions', 'r3', 2, reception('r3', 'BR-2025-003', '2025-12-30', 'f2', 'o3', 'BCF-2025-003', brosses)),
      ch('purchases', 'p2', 1, facture('p2', 'GS-2025-118', '2025-12-20', 'f1', 'r1', peint(10, 63.5), true)),
      ch('purchases', 'p3', 2, facture('p3', 'GS-2026-004', '2026-01-08', 'f1', 'r2', peint(30, 63.245), true)),
      ch('stockAdjustments', 's1', 0, { id: 's1', date: '2025-06-15', itemId: 'peint', qty: -23, note: 'chantier de l\'école' }),
    ] })).statut).toBe(200);

    const cx = await contexte(hedi);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const ouvrirInventaire = async () => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}#/stock`);
      await p.locator('#st-tabs button[data-tab="inventaire"]').waitFor({ timeout: 20_000 });
      await plusTard(p);
      await p.locator('#st-tabs button[data-tab="inventaire"]').click();
      await p.locator('#etat-comptable').waitFor({ timeout: 15_000 });
    };
    const etatsEnvoyes = async () => (await objets()).filter((o) => o.collection === 'etatsStock').map((o) => o.contenu as Obj);
    const nombre = (v: unknown) => (v && typeof v === 'object' ? Number((v as Obj)['~n']) : Number(v));

    // A. Le 31/12/2025 : 77 pots (les 40 et 20 du début, 23 sortis, 10 et 30 reçus en décembre) à 4 814,009 ; reçus sans
    // facture à cette date : les 30 pots du 28 (leur facture est du 8 janvier) et les 12 brosses du 30 ; pas les 10 pots du
    // 15, que la facture du 20 décembre couvre.
    await ouvrirInventaire();
    expect(net(await p.locator('#etat-resume').innerText())).toBe('1 article en stock, 4 814,009 DT au coût moyen');
    expect(net(await p.locator('#etat-sans-facture').innerText())).toBe('Reçu sans facture à cette date : 2 réceptions, 1 949,850 DT HT (BR-2025-002 de Grossiste Sfax, '
      + 'BR-2025-003 de Quincaillerie du Nord). La marchandise est dans ton stock, sa facture n\'est pas encore arrivée : ton comptable la passe en facture non parvenue. Elle part avec l\'état.');
    await p.screenshot({ path: path.join(PHOTOS, 'commandes-1320-a-carte.png'), fullPage: true });
    await p.locator('#etat-envoyer').click();
    await expect.poll(() => toast(p)).toBe('L\'état du stock au 31/12/2025 est chez ton comptable : 1 article, 4 814,009 DT, et 2 réceptions sans facture (1 949,850 DT HT). '
      + 'Il le reprend dans son inventaire. Le dire à mon comptable');
    await expect.poll(async () => (await etatsEnvoyes()).map((e) => [e.date, nombre(e.total), nombre((e.sansFacture as Obj).total)])).toEqual([['2025-12-31', 4814.009, 1949.85]]);
    expect((((await etatsEnvoyes())[0] as Obj).sansFacture as Obj).receptions.map((r: Obj) => [r.numero, r.date, r.fournisseur, r.commande, nombre(r.ht)])).toEqual([
      ['BR-2025-002', '2025-12-28', 'Grossiste Sfax', 'BCF-2025-002', 1897.35], ['BR-2025-003', '2025-12-30', 'Quincaillerie du Nord', 'BCF-2025-003', 52.5]]);
    await expect.poll(async () => net(await p.locator('#etat-deja').innerText())).toBe(`✓ Envoyé le ${auj} : c'est l'état d'aujourd'hui.`);

    // B. La facture des brosses arrive, datée du 31 décembre : le stock n'a pas bougé, ce qui est reçu sans facture si.
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hedi, { changements: [
      ch('purchases', 'p4', 3, facture('p4', 'QN-2025-77', '2025-12-31', 'f2', 'r3', brosses, false)),
    ] })).statut).toBe(200);
    await ouvrirInventaire();
    expect(net(await p.locator('#etat-deja').innerText())).toBe(`Envoyé le ${auj} avec 1 949,850 DT HT reçus sans facture : ce qui est reçu sans facture à cette date a changé depuis. `
      + 'Renvoie-le pour que ton comptable ait le bon.');
    expect(net(await p.locator('#etat-sans-facture').innerText())).toContain('1 réception, 1 897,350 DT HT (BR-2025-002 de Grossiste Sfax)');
    expect(net(await p.locator('#etat-envoyer').innerText())).toBe('Renvoyer l\'état du 31/12/2025');
    await p.locator('#etat-envoyer').click();
    await expect.poll(async () => (await etatsEnvoyes()).map((e) => [nombre(e.total), nombre((e.sansFacture as Obj).total), (e.sansFacture as Obj).receptions.length])).toEqual([[4814.009, 1897.35, 1]]);

    // Au téléphone, la carte tient dans l'écran.
    const tel = await contexte(hedi, 390, 844);
    await tel.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const t = await tel.newPage();
    t.on('pageerror', (e) => erreurs.push(`téléphone : ${e.message}`));
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/stock`);
    await t.locator('#st-tabs button[data-tab="inventaire"]').waitFor({ timeout: 20_000 });
    await plusTard(t);
    await t.locator('#st-tabs button[data-tab="inventaire"]').click();
    await t.locator('#etat-sans-facture').waitFor({ timeout: 15_000 });
    expect(await t.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await t.screenshot({ path: path.join(PHOTOS, 'commandes-1320-b-telephone.png'), fullPage: true });
    await tel.close();

    // C. Au Cabinet, Inès lit ce qui reste reçu sans facture et le passe en facture non parvenue, au brouillard, au millime.
    const cxC = await contexte(ines);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/inventaire/2025`);
    await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(c);
    await c.locator('#iv-sans-facture').waitFor({ timeout: 20_000 });
    // Le « i » de la bulle d'aide suit la phrase.
    expect(net(await c.locator('#iv-sans-facture p').first().innerText())).toBe('Reçu sans facture au 31/12/2025 : 1 réception, 1 897,350 DT HT i');
    expect((await c.locator('#iv-sans-facture tbody tr').allInnerTexts()).map(net)).toEqual(['BR-2025-002 · 28/12/2025 · BCF-2025-002 Grossiste Sfax 1 897,350 DT']);
    // Le seul bouton principal reste celui qui reprend l'état comme inventaire.
    expect(await c.locator('#iv-fnp').getAttribute('class')).not.toContain('btn-primary');
    await c.locator('#iv-fnp').click();
    const fenetre = c.locator('#modal-root .modal').last();
    await fenetre.locator('#fnp-lignes').waitFor({ timeout: 10_000 });
    expect((await fenetre.locator('#fnp-lignes tbody tr').allInnerTexts()).map(net)).toEqual([
      '607 Reçu sans facture au 31/12/2025 1 897,350 DT', '408 Facture non parvenue — Grossiste Sfax 1 897,350 DT']);
    await c.screenshot({ path: path.join(PHOTOS, 'commandes-1320-c-fnp.png'), fullPage: true });
    await fenetre.locator('#ok').click();
    await expect.poll(() => toast(c)).toBe('Factures non parvenues passées au brouillard : 1 897,350 DT au 408.');
    const ecrites = (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, ines)).corps.ecritures as Obj[];
    expect(ecrites.filter((e) => e.piece === 'FNP-2025').map((e) => [e.date, e.journal, e.statut, e.lignes.map((l: Obj) => [l.compte, l.debit, l.credit])])).toEqual([
      ['2025-12-31', 'OD', 'brouillard', [['607', '1897.350', '0.000'], ['408', '0.000', '1897.350']]]]);
    // Passée, la ligne le dit ; le bouton s'en va (la repasser compterait la charge deux fois).
    await expect.poll(async () => net(await c.locator('#iv-fnp-ok').innerText().catch(() => '')))
      .toBe('✓ Passées en factures non parvenues (FNP-2025, au brouillard) : au 1er janvier, « Extourner » sur l\'écriture la retourne.');
    expect(await c.locator('#iv-fnp').count()).toBe(0);
    await c.screenshot({ path: path.join(PHOTOS, 'commandes-1320-d-passee.png'), fullPage: true });
    await cxC.close();
    await cx.close();
    expect(erreurs).toEqual([]);
    void noter;
  }, 300_000);
});
