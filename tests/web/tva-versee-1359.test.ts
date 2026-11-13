// Bout en bout 17 (1.357.9) : la boulangerie paie à l'État la TVA que son cabinet a déclarée. Octobre déposé par Leila
// (Cabinet Jlassi) le 10/11 ; chez Sarra, la TVA d'octobre disait « Déposée par ton cabinet » et rien d'autre — ni le
// montant à verser, ni la date limite, ni où noter le virement. Elle dit maintenant « À verser au Trésor », « Noter le
// paiement… » ouvre le mouvement déjà rempli (Impôts et taxes, contre le 4365), le versement arrive au brouillard de la
// banque du cabinet, et l'étape de la déclaration le dit au Cabinet ; « Marquer payée » prend sa date. Deux chemins, un chiffre.

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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'tva-versee-1359.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
const C = ecranDeLaPlateforme('core.js') as Obj;

describe('bout en bout 17 : la TVA déclarée par le cabinet, versée par l\'entreprise (1.357.9)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-tva-versee-1359-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'tva-versee-1359.txt'), '');
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
  const co = { ...C.DEFAULT_COMPANY, currency: 'DT', stampFee: 1 };
  it('Sarra verse la TVA d\'octobre déclarée par Leila : le montant, le geste, le mouvement, l\'écriture du cabinet et son étape', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Jlassi' });
    const cabinet = String(cab.corps.id);
    const sarra = await personne('sarra');
    const ent = String((await api('POST', '/entreprises-essai', sarra)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, sarra);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, leila, { annee: 2026, ouverture: [] })).statut).toBe(201);

    // Octobre : une vente de 1 000 DT HT (190 de TVA, un timbre) et un achat de 500 DT HT (95 de TVA déductible) ; la BIAT.
    // À verser : 190 − 95 + 1 = 96,000 DT (calculé à la main).
    await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: 'accounts', cle: 'biat', rang: 0, revision: null, contenu: { id: 'biat', name: 'BIAT', kind: 'banque', bank: 'BIAT', rib: '', opening: n('5000'), openingDate: '2026-01-01', isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Minoterie du Sahel', paymentTermsDays: 30 } },
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Hôtel Marhaba', city: 'Sousse' } },
      { collection: 'purchases', cle: 'a1', rang: 0, revision: null, contenu: { id: 'a1', kind: 'facture', number: 'MS-2610-14', date: '2026-10-14', dueDate: '2026-10-14', supplierId: 's1', currency: 'DT', fees: 0, withholdingRate: 0,
        category: 'Matières premières', createdAt: 5, attachments: [], payments: [], lines: [{ label: 'Farine T55, 20 sacs', qty: n('1'), unitPrice: n('500.000'), vatRate: 19, destination: 'charge' }] } },
    ] });
    const doc: Obj = { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: '2026-10-20', dueDate: '2026-10-20', clientId: 'c1', createdAt: 10, subject: 'Viennoiseries',
      lines: [{ label: 'Viennoiseries, octobre', description: '', qty: n('1'), unit: '', unitPrice: n('1000.000'), vatRate: 19 }],
      discountRate: 0, withholdingRate: 0, applyStamp: true, stampFee: 1, exchangeRate: '', notes: '', currency: 'DT', regimeTva: 'reel', payments: [] };
    const em = (await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, sarra, { document: doc, client: { id: 'c1', name: 'Hôtel Marhaba' }, revision: null, rang: 30, netAPayer: '1191.000' })).corps;
    expect(String((em.contenu as Obj | undefined)?.number ?? JSON.stringify(em))).toMatch(/^FAC-/);
    // Leila dépose octobre le 10/11 : 190 collectée, 95 déductible, 95 nets, 1 de timbre, 96 à décaisser.
    expect((await api('PUT', `/entreprises/${ent}/compta/declarations/2026-10`, leila, { cases: { tvaCollectee: '190,000', tvaDeductible: '95,000', netAPayer: '95,000', timbre: '1,000', aDecaisser: '96,000' } })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/declarations/2026-10/pointer`, leila, { quoi: 'deposee', le: '2026-11-10', reference: 'TEJ-2026-1110' })).statut).toBe(200);
    // Une écriture de déclaration au journal OD porte la MÊME pièce (celle d'un client sur SkanFact, ou saisie ainsi) : ce n'est
    // pas un versement, et le Cabinet ne doit jamais la compter comme tel.
    expect((await api('POST', `/entreprises/${ent}/compta/ecritures`, leila, { date: '2026-10-31', journal: 'OD', piece: 'TVA-2026-10', libelle: 'TVA d\'octobre 2026',
      lignes: [{ compte: '4367', debit: '190,000' }, { compte: '4366', credit: '95,000' }, { compte: '4365', credit: '95,000' }] })).statut).toBeLessThan(300);

    const erreurs: string[] = [];
    const cx = await contexte(sarra);
    // Le 13 novembre : octobre est terminé et déposé, novembre en cours (la date limite du 28 se lit telle quelle).
    await cx.clock.setFixedTime(new Date('2026-11-13T10:00:00+01:00'));
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    p.on('pageerror', (x) => erreurs.push(x.message));
    p.on('dialog', (d) => { erreurs.push(`fenêtre du navigateur : ${d.message()}`); void d.dismiss(); });
    const photo = (q: Page, nom: string) => q.screenshot({ path: path.join(PHOTOS, `tva-versee-1359-${nom}.png`), fullPage: true });
    const aujourdhui = '13/11/2026';
    const onglet = async (q: Page, t: string) => { await q.locator(`#c-tabs [data-tab="${t}"]`).click(); await q.waitForTimeout(300); };
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/compta`);
    await p.locator('#c-tabs').waitFor({ timeout: 30_000 });
    await plusTard(p);
    // L'onglet s'ouvre de lui-même sur octobre (règle U-12) : novembre n'est pas terminé, octobre se déclare et se paie.
    await onglet(p, 'tva');
    await expect.poll(async () => p.locator('#c-month').inputValue(), { timeout: 10_000 }).toBe('10');
    expect(net(await p.locator('#c-body .panel h2').first().innerText())).toMatch(/^Déclaration de TVA — octobre 2026/);

    // 1. Ce que le dépôt fait verser, et sa date limite — le geste est le bouton principal.
    await expect.poll(async () => net(await p.locator('#vat-verse').innerText().catch(() => '')), { timeout: 15_000 })
      .toMatch(/^À verser au Trésor : 96,000 DT \(95,000 DT de TVA \+ 1,000 DT de timbres\), avant le 28\/11\/2026\./);
    expect(net(await p.locator('#vat-cabinet').innerText())).toMatch(/^Déposée par ton cabinet le 10\/11\/2026 \(réf\. TEJ-2026-1110\)\./);
    expect(await p.locator('#vat-verser').innerText()).toBe('Noter le paiement…');
    expect(await p.locator('#vat-verser').evaluate((b) => b.classList.contains('btn-primary'))).toBe(true);
    await photo(p, '1-a-verser');

    // 2. « Noter le paiement… » : le mouvement déjà rempli, qu'on enregistre tel quel.
    await p.locator('#vat-verser').click();
    const f = p.locator('.modal').filter({ has: p.locator('#mf2') });
    await f.waitFor({ timeout: 10_000 });
    expect(await f.locator('[name=kind]').inputValue()).toBe('impot');
    expect(await f.locator('[name=compte]').inputValue()).toBe('4365');
    expect(await f.locator('[name=amount]').inputValue()).toMatch(/^96([,.]0+)?$/);
    expect(await f.locator('[name=label]').inputValue()).toBe('TVA d\'octobre 2026');
    expect(await f.locator('[name=reference]').inputValue()).toBe('TVA-2026-10');
    expect(await f.locator('[name=accountId] option:checked').innerText()).toBe('BIAT');
    await photo(p, '2-mouvement');
    await f.locator('#ok').click();
    await expect.poll(async () => net(await p.locator('#vat-verse').innerText().catch(() => '')), { timeout: 15_000 })
      .toMatch(new RegExp(`^Versée au Trésor le ${aujourdhui.replace(/\//g, '\\/')} : 96,000 DT, depuis BIAT\\.`));
    expect(await p.locator('#vat-verser').count()).toBe(0);
    await photo(p, '3-versee');

    // Le mouvement sur le serveur porte le mois, la nature, le compte et le montant.
    const mvt = async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets as Obj[]).filter((o) => o.collection === 'movements').map((o) => o.contenu as Obj);
    await expect.poll(async () => (await mvt()).length, { timeout: 15_000 }).toBe(1);
    const m = (await mvt())[0] as Obj;
    expect([m.tvaPeriode, m.kind, m.compte, m.reference, m.accountId]).toEqual(['2026-10', 'impot', '4365', 'TVA-2026-10', 'biat']);
    expect(Number(String((m.amount as Obj)?.['~n'] ?? m.amount))).toBe(96);

    // 3. L'écriture du cabinet : au brouillard de la banque, 4365 au débit, la banque au crédit, 96,000 de chaque côté.
    const lireVersement = async () => (((await api('GET', `/entreprises/${ent}/compta/ecritures?piece=TVA-2026-10`, leila)).corps.ecritures as Obj[]) ?? []).filter((x) => x.journal !== 'OD');
    await expect.poll(async () => (await lireVersement()).length, { timeout: 20_000 }).toBe(1);
    const e = (await lireVersement())[0] as Obj;
    noter('ÉCRITURE', e);
    expect(e.journal).toBe('BQ');
    const lignes = (e.lignes as Obj[]).map((l) => [String(l.compte), Number(String(l.debit).replace(',', '.')), Number(String(l.credit).replace(',', '.'))]);
    expect(lignes.find((l) => l[0] === '4365')).toEqual(['4365', 96, 0]);
    expect(lignes.find((l) => l[0] !== '4365')?.slice(1)).toEqual([0, 96]);

    // 4. Les échéances : la ligne d'octobre dit le versement.
    await onglet(p, 'calendrier');
    await expect.poll(async () => net(await p.locator('#decl-cabinet tr[data-periode="2026-10"]').innerText().catch(() => '')), { timeout: 15_000 })
      .toContain(`versée le ${aujourdhui}`);

    // 5. Le Cabinet : l'étape de la déclaration dit le versement de Sarra, et « Marquer payée » prend sa date.
    const kx = await contexte(leila);
    await kx.clock.setFixedTime(new Date('2026-11-13T10:00:00+01:00'));
    const q = await kx.newPage();
    q.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await q.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/declaration`);
    await q.locator('#dc-mois').waitFor({ timeout: 20_000 });
    await plusTard(q);
    await q.locator('#dc-mois').selectOption('2026-10');
    await expect.poll(async () => net(await q.locator('#dc-client-tva').innerText().catch(() => '')), { timeout: 15_000 })
      .toMatch(new RegExp(`a versé la TVA du mois le ${aujourdhui.replace(/\//g, '\\/')} : 96,000( DT)? — son versement attend au brouillard de la banque\\. « Marquer payée » le note à cette date\\.$`));
    await photo(q, '4-cabinet');
    await q.locator('#dc-payee').click();
    await expect.poll(async () => net(await q.locator('#dc-payee').innerText()), { timeout: 15_000 }).toContain(`Payée le ${aujourdhui}`);
    expect(await q.locator('#dc-client-tva').count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 240_000);

  it('la TVA payée par le cabinet sans versement noté, et le reste d\'un versement partiel : ce que la page dit', () => {
    const data: Obj = { ...C.DEFAULT_DATA, movements: [], fiscalDeadlines: [] };
    const decl = (cases: Obj, payee = '') => [{ type: 'mensuelle', periode: '2026-10', cases, deposee: { le: '2026-11-10', reference: '' }, payee: { le: payee } }];
    // Rien de noté, payée d'après le cabinet : rien ne reste à verser, et le versement est vide.
    let x = C.declarationsDuCabinet(data, co, '2026', decl({ aDecaisser: '96.000' }, '2026-11-25'), '2026-12-01').find((d: Obj) => d.periode === '2026-10');
    expect([x.aDecaisser, x.payeeCabinet, x.resteAVerser, x.verse.montant]).toEqual([96, '2026-11-25', 0, 0]);
    // Un versement de 60 sur 96 : il en reste 36 ; un second de 36, rien.
    data.movements = [{ id: 'v1', date: '2026-11-20', kind: 'impot', amount: 60, tvaPeriode: '2026-10' }];
    x = C.declarationsDuCabinet(data, co, '2026', decl({ aDecaisser: '96.000' }), '2026-12-01').find((d: Obj) => d.periode === '2026-10');
    expect([x.verse.montant, x.verse.date, x.resteAVerser]).toEqual([60, '2026-11-20', 36]);
    data.movements.push({ id: 'v2', date: '2026-11-27', kind: 'impot', amount: 36, tvaPeriode: '2026-10' }, { id: 'autre', date: '2026-11-27', kind: 'impot', amount: 500, tvaPeriode: '2026-09' });
    x = C.declarationsDuCabinet(data, co, '2026', decl({ aDecaisser: '96.000' }), '2026-12-01').find((d: Obj) => d.periode === '2026-10');
    expect([x.verse.montant, x.verse.date, x.resteAVerser]).toEqual([96, '2026-11-27', 0]);
    // La composition ne se dit que quand les cases refont le total au millime.
    x = C.declarationsDuCabinet(data, co, '2026', decl({ aDecaisser: '96.000', netAPayer: '95.000', timbre: '1.000', retenuesOperees: '0.000' }), '2026-12-01').find((d: Obj) => d.periode === '2026-10');
    expect(x.composition).toEqual([{ quoi: 'tva', montant: 95 }, { quoi: 'timbres', montant: 1 }]);
    x = C.declarationsDuCabinet(data, co, '2026', decl({ aDecaisser: '96.000', netAPayer: '95.000' }), '2026-12-01').find((d: Obj) => d.periode === '2026-10');
    expect(x.composition).toBe(null);
    // Une case vide ne réclame rien.
    x = C.declarationsDuCabinet(data, co, '2026', decl({ aDecaisser: null }), '2026-12-01').find((d: Obj) => d.periode === '2026-10');
    expect([x.aDecaisser, x.resteAVerser]).toEqual([null, 0]);
  });
});
