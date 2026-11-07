// Les relances, 1.321.0, jouées par une société d'ascenseurs (« Ascenseurs du Sahel ») jusqu'au bilan de 2025 : Bâtiments
// Ezzahra doit le reste de sa facture de septembre (1 976 sur 2 976, payé 1 000) et la conteste (8 cabines reçues sur 10) ; l'Hôtel Le
// Golfe doit celle de novembre (1 001,195). Nadia note le litige : la facture sort des relances ; elle envoie l'état de ses
// impayés à sa comptable ; le litige réglé puis renoté, la carte dit juste. Inès, au Cabinet, lit l'état dans l'onglet
// Inventaire et provisionne la facture contestée : 1 200,500 HT au 6817 et au 491, au 31/12/2025, au brouillard.
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'relances-1321.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('les relances 1.321.0 : une facture contestée ne se relance plus, et le comptable la provisionne', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-relances-1321-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'relances-1321.txt'), '');
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



  it('une facture contestée sort des relances, part avec l\'état des impayés, et se provisionne au Cabinet', async () => {
    const ines = await personne('ines');
    const cab = await api('POST', '/cabinets', ines, { nom: 'Cabinet Sahel Conseil' });
    const cabinet = String(cab.corps.id);
    const nadia = await personne('nadia');
    const ent = String((await api('POST', `/entreprises-essai`, nadia)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, nadia, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, ines)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, nadia)).corps.objets as Obj[];
    await objets();
    const auj = jourDe(0);
    const retardDe = (echeance: string) => Math.round((Date.parse(auj) - Date.parse(echeance)) / 86_400_000);
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Nadia Ben Salah', name: 'Ascenseurs du Sahel', city: 'Sousse', activity: 'services' };
    const facture = (id: string, number: string, date: string, dueDate: string, clientId: string, unitPrice: number, extra: Obj = {}) => ({
      id, type: 'facture', number, status: 'brouillon', date, dueDate, clientId, currency: 'DT', exchangeRate: '', applyStamp: true, stampFee: 1, discountRate: 0, withholdingRate: 0,
      payments: [], notes: '', createdAt: Date.parse(date),
      lines: [{ label: 'Maintenance d\'ascenseur', qty: 1, unitPrice, vatRate: 19 }], ...extra });
    const ch = (collection: string, cle: string, rang: number, contenu: Obj) => ({ collection, cle, rang, revision: null, contenu: enc(contenu) });
    const clients = [{ id: 'c1', name: 'Bâtiments Ezzahra' }, { id: 'c2', name: 'Hôtel Le Golfe' }];
    const factures = [
      facture('f1', '', '2025-09-01', '2025-10-01', 'c1', 2500),
      facture('f2', '', '2025-11-20', '2025-12-20', 'c2', 840.5),
    ];
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, nadia, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      ...clients.map((x, i) => ch('clients', x.id, i, x)),
      ...factures.map((x, i) => ch('documents', String(x.id), i, x)),
    ] });
    expect(ecrit.statut, JSON.stringify(ecrit.corps)).toBe(200);
    // Les factures s'émettent par le serveur (le numéro naît là) : 2 500 + 475 + 1 = 2 976 ; 840,500 + 159,695 + 1 = 1 001,195.
    for (const [i, x] of factures.entries()) {
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, nadia, { document: enc(x), client: enc(clients.find((y) => y.id === x.clientId)), revision: 1, rang: i,
        netAPayer: ['2976.000', '1001.195'][i] });
      expect(e.statut, JSON.stringify(e.corps)).toBe(200);
    }
    // Puis, sur la facture émise, ce que la vie y a mis : 1 000 versés le 15 octobre, deux relances (e-mail, téléphone).
    const f1 = (await objets()).find((o) => o.collection === 'documents' && o.cle === 'f1') as Obj;
    const vie = await api('POST', `/entreprises/${ent}/dossier-v10`, nadia, { changements: [{ collection: 'documents', cle: 'f1', rang: 0, revision: f1.revision, contenu: { ...(f1.contenu as Obj),
      payments: [{ id: 'p1', date: '2025-10-15', amount: 1000, method: 'virement' }],
      reminders: [{ date: '2025-10-10', level: 1, channel: 'email' }, { date: '2025-11-05', level: 2, channel: 'tel', note: 'il parle de deux cabines' }] } }] });
    expect(vie.statut, JSON.stringify(vie.corps)).toBe(200);
    const numeroDe = async (id: string) => String(((await objets()).find((o) => o.collection === 'documents' && o.cle === id) as Obj).contenu.number);
    const n1 = await numeroDe('f1'), n2 = await numeroDe('f2');
    noter('numéros', n1, n2);

    const cx = await contexte(nadia);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const ouvrirRelances = async () => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}#/relances`);
      await p.locator('#r-wrap').waitFor({ timeout: 20_000 });
      await plusTard(p);
      await p.locator('#ei-comptable').waitFor({ timeout: 15_000 });
    };
    const etatsEnvoyes = async () => (await objets()).filter((o) => o.collection === 'etatsImpayes').map((o) => o.contenu as Obj);
    const nombre = (v: unknown) => (v && typeof v === 'object' ? Number((v as Obj)['~n']) : Number(v));
    const conteste = async (note: string) => {
      await p.locator('[data-rowmenu="f1"]').first().click();
      await p.locator('.row-menu').last().getByText('Le client conteste…').click();
      const f = p.locator('#modal-root .modal').last();
      await f.locator('[name=note]').waitFor({ timeout: 10_000 });
      await f.locator('#ok').click();
      // Sans un mot de ce que dit le client, rien ne se note : le champ le dit.
      await expect.poll(() => f.locator('[name=note]').evaluate((x) => !!x.closest('.champ-faute'))).toBe(true);
      await f.locator('[name=note]').fill(note);
      await f.locator('#ok').click();
      await expect.poll(() => toast(p)).toContain(`${n1} : facture contestée. Elle ne se relance plus.`);
    };

    // A. Deux factures en retard ; Nadia note que Bâtiments Ezzahra conteste la sienne : elle sort de « À relancer » et se
    // range dans « Contestées par le client », avec ce que dit le client.
    await ouvrirRelances();
    expect(await p.locator('[data-relancer="f1"]').count()).toBe(1);
    await conteste('Il dit n\'avoir reçu que 8 cabines sur 10');
    await expect.poll(() => p.locator('[data-relancer="f1"]').count()).toBe(0);
    expect(await p.locator('[data-relancer="f2"]').count()).toBe(1);
    expect((await p.locator('#litiges-t tbody tr').allInnerTexts()).map(net))
      .toEqual([`${n1} Bâtiments Ezzahra ${retardDe('2025-10-01')} jours 1 976,000 DT Il dit n'avoir reçu que 8 cabines sur 10 depuis le ${auj.split('-').reverse().join('/')} Le litige est réglé`]);
    // La tuile des retards anciens compte la contestée (c'est un retard) sans lui promettre une relance.
    expect(net(await p.locator('#rel-resume').innerText())).toContain('Plus de 45 jours 2 au ton « Dernière relance » · dont 1 contestée');
    // L'état pour la comptable : les deux factures, la contestée dite.
    expect(net(await p.locator('#ei-resume').innerText())).toBe('2 factures en retard, 2 977,195 DT, dont 1 contestée par le client. À la clôture, ton comptable juge s\'il faut une '
      + 'provision pour ce qui risque de ne pas être payé : envoie-lui où tu en es (relances, litiges).');
    await p.screenshot({ path: path.join(PHOTOS, 'relances-1321-a-contestee.png'), fullPage: true });
    await p.locator('#ei-envoyer').click();
    await expect.poll(() => toast(p)).toContain('L\'état des impayés est chez ton comptable : 2 factures en retard, 2 977,195 DT, dont 1 contestée.');
    await expect.poll(async () => (await etatsEnvoyes()).map((e) => [nombre(e.total), nombre(e.contestees), (e.lignes as Obj[]).length])).toEqual([[2977.195, 1, 2]]);
    expect((((await etatsEnvoyes())[0] as Obj).lignes as Obj[]).map((l) => [l.numero, l.client, nombre(l.resteTTC), nombre(l.resteHT), nombre(l.relances), l.litige])).toEqual([
      [n1, 'Bâtiments Ezzahra', 1976, 1659.946, 2, 'Il dit n\'avoir reçu que 8 cabines sur 10'],
      [n2, 'Hôtel Le Golfe', 1001.195, 840.5, 0, '']]);
    await expect.poll(async () => net(await p.locator('#ei-deja').innerText())).toBe(`✓ Envoyé le ${auj.split('-').reverse().join('/')} : c'est l'état d'aujourd'hui.`);

    // B. Le litige réglé, la facture revient aux relances et l'état envoyé n'est plus celui d'aujourd'hui ; renoté, il l'est.
    await p.locator('[data-litige-regle="f1"]').click();
    await expect.poll(() => p.locator('[data-relancer="f1"]').count()).toBe(1);
    expect(await p.locator('#r-litiges').count()).toBe(0);
    expect(net(await p.locator('#ei-deja').innerText())).toContain('depuis, un paiement, une relance ou un litige l\'a changé. Renvoie-le');
    await conteste('Il dit n\'avoir reçu que 8 cabines sur 10');
    await expect.poll(async () => net(await p.locator('#ei-deja').innerText())).toContain('c\'est l\'état d\'aujourd\'hui');

    // Au téléphone, la page tient dans l'écran.
    const tel = await contexte(nadia, 390, 844);
    await tel.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const t = await tel.newPage();
    t.on('pageerror', (e) => erreurs.push(`téléphone : ${e.message}`));
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/relances`);
    await t.locator('#ei-comptable').waitFor({ timeout: 20_000 });
    await plusTard(t);
    expect(await t.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await t.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    await t.screenshot({ path: path.join(PHOTOS, 'relances-1321-b-telephone.png'), fullPage: true });
    await tel.close();

    // C. Au Cabinet, Inès lit l'état dans l'onglet Inventaire et provisionne la facture contestée, au 31/12/2025.
    const cxC = await contexte(ines);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/inventaire/2025`);
    await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(c);
    await c.locator('#iv-impayes').waitFor({ timeout: 20_000 });
    expect(net(await c.locator('#iv-impayes p').first().innerText()))
      .toBe(`2 factures en retard, 2 977,195 DT toutes taxes, dont 1 contestée par son client · envoyé le ${auj.split('-').reverse().join('/')}.`);
    expect((await c.locator('#iv-impayes-t tbody tr').allInnerTexts()).map(net)).toEqual([
      `${n1} · échue le 01/10/2025 Bâtiments Ezzahra Contestée : Il dit n'avoir reçu que 8 cabines sur 10 ${retardDe('2025-10-01')} jours 1 976,000 DT 1 659,946 DT 2 · la dernière le 05/11/2025 Provisionner…`,
      `${n2} · échue le 20/12/2025 Hôtel Le Golfe ${retardDe('2025-12-20')} jours 1 001,195 DT 840,500 DT aucune Provisionner…`]);
    await c.locator(`[data-provision="${n1}"]`).click();
    const f = c.locator('#modal-root .modal').last();
    await f.locator('[name=montant]').waitFor({ timeout: 10_000 });
    expect((await f.locator('[name=montant]').inputValue()).replace(/[\u202f\u00a0]/g, ' ')).toBe('1 659,946');
    // Plus que le reste hors taxes : refusé, en le disant, et le bouton s'éteint.
    await f.locator('[name=montant]').fill('2000');
    await expect.poll(async () => net(await f.locator('#pv-motif').innerText())).toBe('Une provision ne dépasse pas ce qui reste dû hors taxes (1 659,946).');
    expect(await f.locator('#ok').isDisabled()).toBe(true);
    await f.locator('[name=montant]').fill('1 200,500');
    await expect.poll(async () => (await f.locator('#pv-lignes tbody tr').allInnerTexts()).map(net)).toEqual([
      `6817 Provision — ${n1} (Bâtiments Ezzahra) 1 200,500 DT`, `491 Provision — ${n1} (Bâtiments Ezzahra) 1 200,500 DT`]);
    await c.screenshot({ path: path.join(PHOTOS, 'relances-1321-c-provision.png'), fullPage: true });
    await f.locator('#ok').click();
    await expect.poll(() => toast(c)).toBe(`Provision de ${n1} passée au brouillard : 1 200,500 DT au 491.`);
    const ecrites = (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, ines)).corps.ecritures as Obj[];
    expect(ecrites.filter((e) => e.piece === `PROV-${n1}`).map((e) => [e.date, e.journal, e.statut, e.lignes.map((l: Obj) => [l.compte, l.debit, l.credit])])).toEqual([
      ['2025-12-31', 'OD', 'brouillard', [['6817', '1200.500', '0.000'], ['491', '0.000', '1200.500']]]]);
    await expect.poll(async () => net(await c.locator(`tr[data-impaye="${n1}"]`).innerText())).toContain(`✓ provisionnée (PROV-${n1})`);
    expect(await c.locator(`[data-provision="${n1}"]`).count()).toBe(0);
    await c.screenshot({ path: path.join(PHOTOS, 'relances-1321-d-provisionnee.png'), fullPage: true });
    await cxC.close();
    await cx.close();
    expect(erreurs).toEqual([]);
    void noter;
  }, 300_000);
});
