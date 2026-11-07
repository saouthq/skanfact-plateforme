// La Comptabilité de l'entreprise, 1.302.0 : l'intérieur des onglets dans la DA, et l'avertissement d'une pièce datée dans
// la période que le cabinet a validée. Joué comme le grossiste de 1.301.0 (« Hygiène Plus Sahel », Sousse) et sa comptable
// au Cabinet Ennour : septembre déposé et validé par la comptable, puis l'achat de septembre oublié, saisi À LA SOURIS cette
// fois (la phrase sous le bouton avant d'enregistrer, « Le dire à mon comptable » après). Au téléphone, la TVA de l'année
// ne fait plus douze cartes. Et une entreprise sans cabinet n'en voit rien.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'compta-1302.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
const C = ecranDeLaPlateforme('core.js') as Obj;

describe('la Comptabilité 1.302.0 : la DA des onglets, la pièce dans une période validée par le cabinet', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-compta-1302-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'compta-1302.txt'), '');
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
  const choisir = async (p: Page, conteneur: string, cherche: string) => {
    await p.locator(`${conteneur} .combo-btn`).click();
    await p.locator(`${conteneur} .combo-q`).fill(cherche);
    await p.locator(`${conteneur} .combo-list [role=option]`).first().click();
  };
  const dater = async (p: Page, jour: string) => {
    const champ = p.locator('#b-head .datefield').filter({ has: p.locator('input[name=date]') }).locator('.d-txt');
    await champ.fill(jour);
    await champ.press('Tab');
  };
  const n = (x: string) => ({ '~n': x });
  const co = { ...C.DEFAULT_COMPANY, currency: 'DT', stampFee: 1 };
  // Ce que la DA demande à l'intérieur de la carte : les chiffres en rangée, sans tuile ni bande de couleur ; les tableaux à
  // pleine largeur de la carte, sans cadre à eux.
  const laDA = (p: Page) => p.evaluate(() => {
    const carte = (document.querySelector('.lf.mg.cpt > .cf-carte') as HTMLElement).getBoundingClientRect();
    const vus = (x: Element) => (x as HTMLElement).getBoundingClientRect().width > 0;
    return {
      rangees: [...document.querySelectorAll('#c-body .stats:not(.rangee), #c-body .pay-grid')].filter(vus).map((s) => getComputedStyle(s).gridTemplateColumns.split(' ').length),
      tuiles: [...document.querySelectorAll('#c-body .stats > .stat, #c-body .pay-grid > div')].filter(vus).map((t) => `${getComputedStyle(t, '::before').content}|${getComputedStyle(t).borderTopLeftRadius}|${getComputedStyle(t).borderLeftWidth}`),
      tableaux: [...document.querySelectorAll('#c-body .panel table.list')].filter(vus).map((t) => {
        const r = t.getBoundingClientRect(), cs = getComputedStyle(t);
        return `${Math.round(r.left - carte.left)}|${Math.round(carte.right - r.right)}|${cs.borderTopLeftRadius}|${cs.borderLeftWidth}`;
      }),
    };
  });

  it('le grossiste lit chaque onglet dans la DA, au bureau et au téléphone, puis saisit l\'achat de septembre oublié', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const mourad = await personne('mourad');
    const ent = String((await api('POST', '/entreprises-essai', mourad)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, mourad);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, mourad, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);

    const achat = (id: string, number: string, date: string, supplierId: string, kind: string, category: string, lignes: [string, number, number][], extra: Obj = {}, payeLe?: string) => {
      const brut = { id, kind, number, date, dueDate: date, supplierId, currency: 'DT', fees: 0, withholdingRate: Number(extra.withholdingRate ?? 0), category,
        lines: lignes.map(([label, qty, prix]) => ({ label, qty, unitPrice: prix, vatRate: 19, destination: 'charge', ...(extra.nonDeductible ? { deductible: false } : {}) })) };
      const t = C.purchaseTotals(brut, co);
      return { collection: 'purchases', cle: id, rang: 0, revision: null, contenu: { ...brut, withholdingRate: brut.withholdingRate ? n(String(brut.withholdingRate)) : 0, createdAt: 5, attachments: [],
        lines: brut.lines.map((l) => ({ ...l, qty: n(String(l.qty)), unitPrice: n(l.unitPrice.toFixed(3)) })),
        payments: payeLe ? [{ id: `p-${id}`, date: payeLe, amount: n(t.netToPay.toFixed(3)), method: 'virement' }] : [] } };
    };
    await api('POST', `/entreprises/${ent}/dossier-v10`, mourad, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Sahel Chimie', matricule: '1234567A/M/A/000', paymentTermsDays: 30, withholdingRate: n('1.5') } },
      { collection: 'suppliers', cle: 's2', rang: 0, revision: null, contenu: { id: 's2', name: 'Emballages du Centre', paymentTermsDays: 30 } },
      { collection: 'suppliers', cle: 's3', rang: 0, revision: null, contenu: { id: 's3', name: 'Station-service El Kantaoui', paymentTermsDays: 0 } },
      ...[['c1', 'Hôtel Marhaba Palace'], ['c2', 'Clinique Les Oliviers'], ['c3', 'Café des Arts']].map(([id, name]) => ({ collection: 'clients', cle: id, rang: 0, revision: null, contenu: { id, name, city: 'Sousse' } })),
      achat('a1', 'SC-26-0903', '2026-09-03', 's1', 'facture', 'Marchandises', [['Détergent industriel 20 L', 400, 21.380], ['Désinfectant surfaces 5 L', 900, 6.940], ['Lessive linge hôtelier 25 kg', 220, 31.455]], { withholdingRate: 1.5 }, '2026-09-25'),
      achat('a2', 'EC-4471', '2026-10-06', 's2', 'facture', 'Emballages', [['Cartons et film', 1, 1846.320]], {}, '2026-10-20'),
      achat('a3', 'TK-1029', '2026-10-12', 's3', 'depense', 'Carburant', [['Gasoil, camionnette', 1, 312.605]], { nonDeductible: true }, '2026-10-12'),
    ] });
    const factures: { id: string; date: string; clientId: string; lignes: [string, number, number][]; rs?: number; paye?: string }[] = [
      { id: 'f1', date: '2026-09-08', clientId: 'c1', lignes: [['Détergent industriel 20 L', 48, 38.450], ['Désinfectant surfaces 5 L', 120, 12.380]], rs: 1.5, paye: '2026-09-30' },
      { id: 'f2', date: '2026-09-19', clientId: 'c2', lignes: [['Gants nitrile, boîte de 100', 85, 14.650], ['Savon antiseptique 1 L', 60, 6.920]], paye: '2026-10-05' },
      { id: 'f3', date: '2026-10-03', clientId: 'c1', lignes: [['Détergent industriel 20 L', 120, 38.450], ['Lessive linge hôtelier 25 kg', 64, 52.780]], rs: 1.5, paye: '2026-10-28' },
      { id: 'f4', date: '2026-10-15', clientId: 'c3', lignes: [['Produits d\'entretien, lot café', 1, 486.350]] },
    ];
    for (const [i, f] of factures.entries()) {
      const doc: Obj = { id: f.id, type: 'facture', number: '', status: 'brouillon', date: f.date, dueDate: f.date, clientId: f.clientId, createdAt: 10 + i,
        subject: 'Produits d\'entretien', lines: f.lignes.map(([label, qty, prix]) => ({ label, description: '', qty: n(String(qty)), unit: '', unitPrice: n(prix.toFixed(3)), vatRate: 19 })),
        discountRate: 0, withholdingRate: f.rs ? n(String(f.rs)) : 0, applyStamp: true, stampFee: 1, exchangeRate: '', notes: '', currency: 'DT', regimeTva: 'reel', payments: [] };
      const t = C.computeTotals({ ...doc, withholdingRate: f.rs ?? 0, lines: f.lignes.map(([label, qty, prix]) => ({ label, qty, unitPrice: prix, vatRate: 19 })) }, co);
      const e = (await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, mourad, { document: doc, client: { id: f.clientId, name: f.clientId }, revision: null, rang: 30 + i, netAPayer: t.netToPay.toFixed(3) })).corps;
      expect(String((e.contenu as Obj | undefined)?.number ?? JSON.stringify(e))).toMatch(/^FAC-/);
      if (f.paye) {
        await api('POST', `/entreprises/${ent}/dossier-v10`, mourad, { changements: [{ collection: 'documents', cle: f.id, rang: 30 + i, revision: Number(e.revision),
          contenu: { ...(e.contenu as Obj), payments: [{ id: `p-${f.id}`, date: f.paye, amount: n(t.netToPay.toFixed(3)), method: 'virement' }] } }] });
      }
    }
    // La comptable dépose la TVA de septembre et valide septembre dans ses livres.
    expect((await api('PUT', `/entreprises/${ent}/compta/declarations/2026-09`, leila, { cases: { tvaCollectee: '948,414', tvaDeductible: '4126,439', creditAReporter: '3178,025' } })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/declarations/2026-09/pointer`, leila, { quoi: 'deposee', le: '2026-10-27', reference: 'TEJ-2026-0927' })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/valider`, leila, { jusqua: '2026-09-30' })).statut).toBe(200);

    // ── Au bureau : chaque onglet dans la DA ──
    const cx = await contexte(mourad);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    p.on('dialog', (d) => { erreurs.push(`fenêtre du navigateur : ${d.message()}`); void d.dismiss(); });
    const photo = (q: Page, nom: string) => q.screenshot({ path: path.join(PHOTOS, `compta-1302-${nom}.png`), fullPage: true });
    const onglet = async (q: Page, t: string) => { await q.locator(`#c-tabs [data-tab="${t}"]`).click(); await q.waitForTimeout(300); };
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/compta`);
    await p.locator('#c-tabs').waitFor({ timeout: 30_000 });
    await plusTard(p);
    await onglet(p, 'ventes');
    await p.locator('#c-month').selectOption('09');
    await p.waitForTimeout(300);
    for (const t of ['ventes', 'achats', 'tva', 'ecritures', 'calendrier', 'clotures']) {
      await onglet(p, t);
      if (t === 'tva') await expect.poll(async () => p.locator('#vat-cabinet').count(), { timeout: 10_000 }).toBe(1);
      const da = await laDA(p);
      noter(`DA ${t}`, da);
      // Quatre chiffres par rangée, sans bande de couleur ni coin arrondi ; chaque tableau touche les deux bords de la carte
      // (son trait d'un pixel), sans cadre à lui.
      for (const c of da.rangees) expect(c, t).toBe(4);
      for (const x of da.tuiles) expect(x, t).toBe('none|0px|0px');
      for (const x of da.tableaux) expect(x, t).toMatch(/^1\|1\|0px\|0px$/);
      await photo(p, `${t}-09`);
    }
    // Les onglets qui portent des chiffres et des tableaux en ont bien : la mesure a atteint l'écran.
    await onglet(p, 'ventes');
    const ventes = await laDA(p);
    expect(ventes.rangees.length).toBeGreaterThanOrEqual(1);
    expect(ventes.tuiles.length).toBe(4);
    expect(ventes.tableaux.length).toBeGreaterThanOrEqual(3);
    // Au bureau, la TVA de l'année montre ses douze mois, et la phrase du téléphone ne se lit pas.
    await onglet(p, 'ventes');
    await p.locator('#c-month').selectOption('');
    await onglet(p, 'tva');
    await expect.poll(async () => p.locator('#c-body tr[data-vm]').count(), { timeout: 10_000 }).toBe(12);
    expect(await p.locator('#c-body tr.cpt-rien').count()).toBe(8);
    expect(await p.locator('#c-body tr.cpt-rien:visible').count()).toBe(8);
    expect(await p.locator('#vat-mois-vides').isVisible()).toBe(false);
    await photo(p, 'tva-annee');

    // ── Au téléphone : la TVA de l'année sans ses huit cartes de zéros ──
    const tx = await contexte(mourad, 390, 844);
    const t = await tx.newPage();
    t.on('pageerror', (x) => erreurs.push(`téléphone : ${x.message}`));
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/compta`);
    await t.locator('#c-tabs').waitFor({ timeout: 30_000 });
    await plusTard(t);
    await onglet(t, 'tva');
    await expect.poll(async () => t.locator('#vat-mois-vides').isVisible(), { timeout: 10_000 }).toBe(true);
    expect(net(await t.locator('#vat-mois-vides').innerText())).toBe('Au téléphone, les mois sans rien ne s\'affichent pas : janvier à août.');
    expect(await t.locator('#c-body tr.cpt-rien:visible').count()).toBe(0);
    expect(await t.locator('#c-body tr[data-vm]:visible').evaluateAll((xs) => xs.map((x) => x.getAttribute('data-vm')))).toEqual(['09', '10', '11', '12']);
    const hauteur = await t.evaluate(() => document.documentElement.scrollHeight);
    noter('HAUTEUR TVA téléphone', hauteur);
    expect(hauteur).toBeLessThan(3600);
    // Les chiffres, deux par rangée ; rien ne déborde de l'écran.
    for (const c of (await laDA(t)).rangees) expect(c).toBe(2);
    expect(await t.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await t.screenshot({ path: path.join(PHOTOS, 'compta-1302-telephone-tva.png'), fullPage: true });

    // ── L'achat de septembre oublié, saisi à la souris ──
    await p.evaluate(() => { location.hash = '#/achat/new'; });
    await p.locator('#ac-main').click({ timeout: 15_000 });
    await choisir(p, '[data-combo=supplierId]', 'Emballages');
    await p.locator('#view input[name=number]').fill('EC-4402');
    await p.locator('#b-lines input[data-k=label]').first().fill('Bidons 5 L vides');
    await p.locator('#b-lines input[data-k=qty]').first().fill('600');
    await p.locator('#b-lines input[data-k=unitPrice]').first().fill('0.845');
    // Daté d'aujourd'hui : rien à dire.
    await p.waitForTimeout(600);
    expect(await p.locator('#ac-cab-valide').isVisible()).toBe(false);
    // Daté du 15 septembre : la phrase sous le bouton le dit avant d'enregistrer.
    await dater(p, '15/09/2026');
    await expect.poll(async () => p.locator('#ac-cab-valide').isVisible(), { timeout: 10_000 }).toBe(true);
    expect(net(await p.locator('#ac-cab-valide').innerText())).toBe('Cette pièce est datée du 15/09/2026, dans la période que ton cabinet a validée (jusqu\'au 30/09/2026) : chez lui, elle s\'écrira au 01/10/2026, le premier jour encore ouvert. En l\'enregistrant, tu pourras le lui dire.');
    await photo(p, 'achat-dans-la-periode');
    // Redatée d'octobre, la phrase s'en va ; remise en septembre, elle revient. Le bouton reste là : rien ne se bloque.
    await dater(p, '05/10/2026');
    await expect.poll(async () => p.locator('#ac-cab-valide').isVisible(), { timeout: 5_000 }).toBe(false);
    await dater(p, '15/09/2026');
    await expect.poll(async () => p.locator('#ac-cab-valide').isVisible(), { timeout: 5_000 }).toBe(true);
    expect(await p.locator('#save').isEnabled()).toBe(true);
    await p.locator('#save').click();
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Enregistré — dans la période que ton cabinet a validée Le dire à mon comptable/);
    await p.locator('#toast-undo').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toBe('#/comptable');
    await expect.poll(async () => net(await p.locator('#msg-racine textarea').first().inputValue().catch(() => '')), { timeout: 15_000 }).not.toBe('');
    const texte = net(await p.locator('#msg-racine textarea').first().inputValue());
    noter('TEXTE AU COMPTABLE', texte);
    expect(texte).toMatch(/^Bonjour, je viens d'enregistrer un achat daté du 15\/09\/2026 \(Emballages du Centre, n° EC-4402, 603,330 DT\) : il tombe dans la période que tu as validée jusqu'au 30\/09\/2026, il s'écrit donc chez toi au 01\/10\/2026\. Peux-tu en tenir compte \?$/);
    await photo(p, 'achat-dit-au-comptable');
    // Rouverte sans rien changer, la pièce ne redit rien ; touchée, elle le redit.
    const achats = (await api('GET', `/entreprises/${ent}/dossier-v10`, mourad)).corps;
    noter('ACHATS', JSON.stringify(achats).length);
    await p.evaluate(() => { location.hash = '#/achats'; });
    await p.locator('#view').getByText('EC-4402').first().click({ timeout: 15_000 });
    await p.locator('#ed-geste').waitFor({ timeout: 15_000 });
    await p.waitForTimeout(600);
    expect(await p.locator('#ac-cab-valide').isVisible()).toBe(false);
    await p.locator('#view input[name=number]').fill('EC-4402 bis');
    await expect.poll(async () => p.locator('#ac-cab-valide').isVisible(), { timeout: 5_000 }).toBe(true);

    // Au téléphone, la phrase se lit aussi sous le bouton (la phrase ordinaire, elle, s'y cache).
    await t.evaluate(() => { location.hash = '#/achat/new'; });
    await t.locator('#ac-main').click({ timeout: 15_000 });
    await dater(t, '20/09/2026');
    await expect.poll(async () => t.locator('#ac-cab-valide').isVisible(), { timeout: 10_000 }).toBe(true);
    await t.screenshot({ path: path.join(PHOTOS, 'compta-1302-telephone-achat.png') });

    // ── Une entreprise sans cabinet : aucun avertissement ──
    const sami = await personne('sami');
    const ent2 = String((await api('POST', '/entreprises-essai', sami)).corps.id);
    const sx = await contexte(sami);
    const s = await sx.newPage();
    s.on('pageerror', (x) => erreurs.push(`sans cabinet : ${x.message}`));
    await s.goto(`${serveur.adresse}/v10/?e=${ent2}#/achat/new`);
    await s.locator('#ac-main').click({ timeout: 30_000 });
    await dater(s, '15/09/2026');
    await s.waitForTimeout(800);
    expect(await s.locator('#ac-cab-valide').count()).toBe(1);
    expect(await s.locator('#ac-cab-valide').isVisible()).toBe(false);

    expect(erreurs).toEqual([]);
    await cx.close(); await tx.close(); await sx.close();
  }, 300_000);
});
