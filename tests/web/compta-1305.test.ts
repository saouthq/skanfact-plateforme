// La Paie de l'entreprise, 1.305.0 : la période validée par le cabinet dite aussi dans la paie. Joué comme le grossiste de
// 1.301.0 à 1.304.0 (« Hygiène Plus Sahel », Sousse) qui fait sa paie lui-même, et sa comptable au Cabinet Ennour qui tient sa
// comptabilité, septembre validé jusqu'au 30/09 : début novembre, on découvre que le bulletin de septembre d'Amel, entrée le
// 01/09, n'a jamais été établi. On l'établit, on corrige sa prime, on le paie au 30/09 ; puis l'avance de Karim notée deux fois
// le 15/09 se supprime. Chaque fois la phrase avant, « Le dire à mon comptable » après, et chez la comptable la paie de
// septembre réécrite au 1er octobre, jamais dans le mois validé.


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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'compta-1305.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
const C = ecranDeLaPlateforme('core.js') as Obj;

describe('la paie 1.305.0 : la période validée par le cabinet dite dans la paie', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-compta-1305-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'compta-1305.txt'), '');
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
  // La date d'un formulaire (le champ à la française, puis Tab) : celle de la fenêtre ou de la page qu'on nomme.
  const dater = async (p: Page, conteneur: string, jour: string) => {
    const champ = p.locator(`${conteneur} .datefield`).filter({ has: p.locator('input[name=date]') }).locator('.d-txt');
    await champ.fill(jour);
    await champ.press('Tab');
  };
  // Ce que la comptable lit d'une pièce dans ses livres (sa page de journal filtrée par le numéro).
  const ecrituresDe = async (ent: string, jeton: string, piece: string) => ((await api('GET', `/entreprises/${ent}/compta/ecritures?piece=${encodeURIComponent(piece)}`, jeton)).corps.ecritures as Obj[] ?? [])
    .map((e) => ({ journal: e.journal, date: e.date, statut: e.statut, type: e.origine.type, lignes: (e.lignes as Obj[]).map((l) => `${l.compte} ${l.debit} ${l.credit}`) }));
  const toast = async (p: Page) => net(await p.locator('#toast').innerText().catch(() => ''));
  const message = async (p: Page) => {
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toBe('#/comptable');
    await expect.poll(async () => net(await p.locator('#msg-racine textarea').first().inputValue().catch(() => '')), { timeout: 15_000 }).not.toBe('');
    return net(await p.locator('#msg-racine textarea').first().inputValue());
  };

  // La fenêtre du dessus (une question posée par-dessus la fenêtre d'un mouvement).
  const dessus = (q: Page) => q.locator('#modal-root > .modal-bg').last();
  const PHRASE = 'dans la période que ton cabinet a validée';
  const annulation = (jour: string, sujet: string, fem = false) => `${sujet} est daté${fem ? 'e' : ''} du ${jour}, dans la période que ton cabinet a validée (jusqu'au 30/09/2026) : chez lui, son annulation s'écrira au 01/10/2026, le premier jour encore ouvert.`;
  const dit = (quoi: string, fem = false) => `Bonjour, je viens de supprimer ${quoi} : ${fem ? 'elle' : 'il'} tombait dans la période que tu as validée jusqu'au 30/09/2026, son annulation s'écrit donc chez toi au 01/10/2026. Peux-tu en tenir compte ?`;

  // Ce qui suit est propre à la paie : le moteur de la paie (le bulletin calculé comme l'écran le calcule), les nombres encodés
  // du dossier, ce qu'on y relit (les bulletins, leurs nets).
  const compta = ecranDeLaPlateforme('compta.js') as Obj;
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const nombre = (x: unknown) => Number(x && typeof x === 'object' && '~n' in (x as Obj) ? (x as Obj)['~n'] : x);
  const ordre = (l: Obj[]) => [...l].sort((a, b) => `${a.date} ${a.type} ${a.statut}`.localeCompare(`${b.date} ${b.type} ${b.statut}`));
  const RIB_A = '08100123456789012359', RIB_K = '08100987654321098714';

  it('début novembre, le bulletin de septembre d\'une nouvelle n\'avait jamais été établi : chaque geste de la paie le dit avant, et la comptable lit septembre réécrit au 1er octobre', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const cabinet = String(cab.corps.id);
    const mourad = await personne('mourad');
    const ent = String((await api('POST', '/entreprises-essai', mourad)).corps.id);
    const objets = async (qui: string, e: string) => (await api('GET', `/entreprises/${e}/dossier-v10`, qui)).corps.objets as Obj[];
    await objets(mourad, ent);
    // Le grossiste fait sa paie lui-même : son cabinet tient la comptabilité et les déclarations, pas la paie.
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, mourad, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);

    // Septembre, tel que le cabinet l'a validé : Karim, au magasin depuis 2025, payé le 30/09 ; son avance du 15/09 notée deux
    // fois. Amel (vendeuse) et Sami (livreur) sont entrés le 01/09 : leurs bulletins n'ont jamais été établis.
    const sal = (id: string, name: string, grossSalary: number, hireDate: string, x: Obj = {}) => ({ id, name, grossSalary, hireDate, contract: 'cdi', headOfFamily: false,
      children: 0, active: true, method: 'virement', iban: '', cnss: '', position: 'Magasinier', cin: '', gender: 'm', ...x });
    const karim = sal('k', 'Karim Mansouri', 1450, '2025-03-01', { iban: RIB_K, headOfFamily: true, children: 1 });
    const amel = sal('a', 'Amel Jaziri', 980.25, '2026-09-01', { position: 'Vendeuse', gender: 'f', iban: RIB_A });
    const sami = sal('s', 'Sami Ferchichi', 905.5, '2026-09-01', { position: 'Livreur' });
    const saisieK = { gross: 1450, workedDays: 26, absentDays: 0, bonuses: [], deductions: [] };
    const bulletinK = { id: 'p-k-2026-9', employeeId: 'k', year: 2026, month: 9, ...saisieK, computed: compta.computePayslip(karim, saisieK, compta.baremesPaie({})),
      paidDate: '2026-09-30', accountId: 'k-banque', method: 'virement', reference: '', issuedAt: '2026-09-28', remisLe: '2026-09-30' };
    const avance = (id: string, note: string) => ({ id, employeeId: 'k', date: '2026-09-15', amount: 300, monthly: 100, method: 'virement', accountId: 'k-banque', note });
    const poser = (collection: string, cle: string, contenu: unknown) => ({ collection, cle, rang: null, revision: null, contenu: enc(contenu) });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, mourad, { changements: [
      poser('accounts', 'k-banque', { id: 'k-banque', name: 'BIAT Sousse', kind: 'banque', bank: 'BIAT', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: true, statementBalance: '', notes: '' }),
      poser('employees', 'k', karim), poser('employees', 'a', amel), poser('employees', 's', sami),
      poser('payslips', bulletinK.id, bulletinK),
      poser('advances', 'av1', avance('av1', 'Avance de la rentrée')), poser('advances', 'av2', avance('av2', 'Avance de la rentrée (notée deux fois)')),
    ] })).statut).toBe(200);
    const fiche = (await objets(mourad, ent)).find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, mourad, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null,
      contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Mourad Ben Salah', paieMode: 'sans' } }] })).statut).toBe(200);
    // La comptable valide septembre : la paie de Karim, son salaire versé, les deux avances (un seul total, 600 DT) y sont validés.
    expect((await api('POST', `/entreprises/${ent}/compta/valider`, leila, { jusqua: '2026-09-30' })).statut).toBe(200);
    const valideesPaie = ordre(await ecrituresDe(ent, leila, 'PAIE-2026-09'));
    expect(valideesPaie).toEqual([expect.objectContaining({ date: '2026-09-30', statut: 'validee', type: 'paie' }), expect.objectContaining({ date: '2026-09-30', statut: 'validee', type: 'salaires' })]);
    const valideesAvance = await ecrituresDe(ent, leila, 'AVANCE-2026-09-15');
    expect(valideesAvance).toEqual([expect.objectContaining({ date: '2026-09-15', statut: 'validee', type: 'avance' })]);
    expect(JSON.stringify(valideesAvance)).toContain('600.000');
    // Ce que la comptable lit après coup : septembre tel qu'elle l'a validé, et ce qui a changé, au brouillard du 1er octobre.
    const septembreIntact = (l: Obj[], valide: Obj[]) => expect(ordre(l.filter((e) => e.date <= '2026-09-30'))).toEqual(valide);
    const auPremierOctobre = (l: Obj[]) => l.filter((e) => e.date > '2026-09-30').map((e) => `${e.date} ${e.statut} ${e.type}`).sort();
    // Les bulletins de septembre du dossier (ce que l'écran a rangé), et la somme de leurs nets.
    const bulletinsDe = async (ids: string[]) => (await objets(mourad, ent)).filter((o) => o.collection === 'payslips' && ids.includes(String(o.contenu.employeeId))
      && Number(o.contenu.year) === 2026 && Number(o.contenu.month) === 9).map((o) => o.contenu);
    const netDe = (l: Obj[]) => Math.round(l.reduce((a, b) => a + nombre((b.computed as Obj).net), 0) * 1000) / 1000;

    const cx = await contexte(mourad);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    p.on('dialog', (d) => { erreurs.push(`fenêtre du navigateur : ${d.message()}`); void d.dismiss(); });
    const photo = (q: Page, nom: string) => q.screenshot({ path: path.join(PHOTOS, `compta-1305-${nom}.png`), fullPage: true });
    const fenetre = '#modal-root';
    // « Le mois » de septembre, à l'étape des bulletins ; ce qui reste à régler du pointage se règle d'abord (un vrai patron le fait).
    const septembre = async (q: Page = p) => {
      await q.evaluate(() => { location.hash = '#/paie'; });
      await q.locator('#p-tabs').waitFor({ timeout: 20_000 });
      await plusTard(q);
      await q.locator('#p-tabs [data-tab="bulletins"]').click();
      await q.locator('#p-mois [data-p-mois="9"]').click();
      await q.waitForTimeout(400);
      await q.locator('#p-sous [data-sous="bulletins"]').click();
      await q.waitForTimeout(400);
      if (await q.locator('#p-regler').count()) {
        await q.locator('#p-regler').click();
        await q.waitForTimeout(400);
        noter('POINTAGE À RÉGLER', net(await q.locator('#p-body').innerText()).slice(0, 1200));
        await photo(q, 'pointage');
        if (await q.locator('#pt-jav').count()) { await q.locator('#pt-jav').click(); await q.locator(`${fenetre} #jav-ok`).click(); }
        await q.locator('#p-sous [data-sous="bulletins"]').click();
        await q.waitForTimeout(400);
      }
    };
    const menuDuBulletin = async (employe: string, choix: RegExp) => {
      const b = (await bulletinsDe([employe]))[0];
      await p.locator(`#p-body tr[data-bul="${String(b.id)}"] .row-menu-btn`).click({ timeout: 15_000 });
      await p.getByRole('menuitem', { name: choix }).click();
      return b;
    };

    // ── A. Les deux bulletins oubliés : « Établir » le dit avant, le message après ; chez la comptable, la paie de septembre
    //       est réécrite au 1er octobre, celle qu'elle a validée reste à sa date ──
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/paie`);
    await p.locator('#p-tabs').waitFor({ timeout: 30_000 });
    await plusTard(p);
    // Le temps de lire jusqu'où le cabinet a validé : rien ne se bloque en attendant.
    await p.waitForTimeout(1500);
    await septembre();
    await photo(p, 'mois');
    await expect.poll(async () => net(await p.locator('#p-gen').innerText().catch(() => '')), { timeout: 15_000 }).toBe('Établir les 2 bulletins');
    await p.locator('#p-gen').click();
    await p.locator(`${fenetre} #p-etab-valide`).waitFor({ timeout: 10_000 });
    const avertEtablir = net(await p.locator(`${fenetre} #p-etab-valide`).innerText());
    noter('ÉTABLIR', avertEtablir);
    expect(avertEtablir).toBe('Ces bulletins sont datés du 30/09/2026, dans la période que ton cabinet a validée (jusqu\'au 30/09/2026) : chez lui, ils s\'écriront au 01/10/2026, le premier jour encore ouvert. En les établissant, tu pourras le lui dire.');
    await photo(p, 'etablir');
    await dessus(p).locator('#ok').click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toBe(`2 bulletins établis — ${PHRASE} Le dire à mon comptable`);
    await expect.poll(async () => (await bulletinsDe(['a', 's'])).length, { timeout: 15_000 }).toBe(2);
    const netAS = netDe(await bulletinsDe(['a', 's']));
    await p.locator('#toast-undo').click();
    const texteEtablir = await message(p);
    noter('MESSAGE ÉTABLIR', texteEtablir);
    expect(texteEtablir).toBe(`Bonjour, je viens d'établir les 2 bulletins de septembre 2026 (Amel Jaziri, Sami Ferchichi), datés du 30/09/2026 (net ${net(C.money(netAS, 'DT'))}) : ils tombent dans la période que tu as validée jusqu'au 30/09/2026, ils s'écrivent donc chez toi au 01/10/2026. Peux-tu en tenir compte ?`);
    await expect.poll(async () => auPremierOctobre(await ecrituresDe(ent, leila, 'PAIE-2026-09')), { timeout: 15_000 })
      .toEqual(['2026-10-01 brouillard contre_passation', '2026-10-01 brouillard paie']);
    septembreIntact(await ecrituresDe(ent, leila, 'PAIE-2026-09'), valideesPaie);

    // ── D. Rouvert sans rien changer : rien ; la prime de rendement d'Amel ajoutée : la correction se dit ──
    await septembre();
    await menuDuBulletin('a', /Modifier le bulletin/);
    await p.locator(`${fenetre} #bf`).waitFor({ timeout: 10_000 });
    await p.waitForTimeout(600);
    expect(await p.locator(`${fenetre} #bf-valide`).isVisible()).toBe(false);
    // Une ligne de prime encore vide ne change rien de ce qui s'écrit : rien encore.
    await p.locator(`${fenetre} #add-bon`).click();
    await p.waitForTimeout(300);
    expect(await p.locator(`${fenetre} #bf-valide`).isVisible()).toBe(false);
    await p.locator(`${fenetre} #bf-bon [data-f=label]`).fill('Prime de rendement');
    await p.locator(`${fenetre} #bf-bon [data-f=amount]`).fill('85.500');
    await expect.poll(async () => p.locator(`${fenetre} #bf-valide`).isVisible(), { timeout: 5_000 }).toBe(true);
    const avertBulletin = net(await p.locator(`${fenetre} #bf-valide`).innerText());
    noter('BULLETIN', avertBulletin);
    expect(avertBulletin).toBe('Ce bulletin est daté du 30/09/2026, dans la période que ton cabinet a validée (jusqu\'au 30/09/2026) : chez lui, la correction s\'écrira au 01/10/2026, le premier jour encore ouvert. En l\'enregistrant, tu pourras le lui dire.');
    await photo(p, 'bulletin');
    await dessus(p).locator('#ok').click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toBe(`Bulletin modifié — ${PHRASE} Le dire à mon comptable`);
    await expect.poll(async () => ((await bulletinsDe(['a']))[0]?.bonuses as Obj[] | undefined)?.length, { timeout: 15_000 }).toBe(1);
    const bulletinA = (await bulletinsDe(['a']))[0];
    await p.locator('#toast-undo').click();
    const texteAmel = await message(p);
    noter('MESSAGE AMEL', texteAmel);
    expect(texteAmel).toBe(`Bonjour, je viens de modifier le bulletin d'Amel Jaziri de septembre 2026, daté du 30/09/2026 (net ${net(C.money(netDe([bulletinA]), 'DT'))}) : il tombe dans la période que tu as validée jusqu'au 30/09/2026, il s'écrit donc chez toi au 01/10/2026. Peux-tu en tenir compte ?`);
    // La paie réécrite au 1er octobre porte le brut des bulletins du mois (Karim, Amel avec sa prime, Sami).
    const brutDuMois = [bulletinK, bulletinA, ...(await bulletinsDe(['s']))].reduce((x, y) => x + nombre((y.computed as Obj).gross), 0).toFixed(3);
    await expect.poll(async () => JSON.stringify((await ecrituresDe(ent, leila, 'PAIE-2026-09')).filter((e) => e.type === 'paie' && e.statut === 'brouillard')), { timeout: 15_000 }).toContain(` ${brutDuMois} `);

    // ── B. Les deux salaires marqués payés au 30/09 : la fenêtre le dit pendant la saisie de la date, le message après ──
    await septembre();
    await p.locator('#p-payer').click({ timeout: 15_000 });
    await p.locator(`${fenetre} #ps`).waitFor({ timeout: 10_000 });
    await p.waitForTimeout(600);
    // Payés aujourd'hui (novembre) : rien à dire.
    expect(await p.locator(`${fenetre} #ps-valide`).isVisible()).toBe(false);
    await dater(p, `${fenetre} #ps`, '30/09/2026');
    await expect.poll(async () => p.locator(`${fenetre} #ps-valide`).isVisible(), { timeout: 10_000 }).toBe(true);
    const avertPayer = net(await p.locator(`${fenetre} #ps-valide`).innerText());
    noter('PAYER', avertPayer);
    expect(avertPayer).toBe('Ce paiement est daté du 30/09/2026, dans la période que ton cabinet a validée (jusqu\'au 30/09/2026) : chez lui, il s\'écrira au 01/10/2026, le premier jour encore ouvert. En le marquant payé, tu pourras le lui dire.');
    await photo(p, 'payer');
    await p.locator(`${fenetre} #ps-payer`).click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toBe(`2 salaires de septembre 2026 marqués payés — ${PHRASE} Le dire à mon comptable`);
    const netPayes = netDe(await bulletinsDe(['a', 's']));
    await p.locator('#toast-undo').click();
    const textePayer = await message(p);
    noter('MESSAGE PAYER', textePayer);
    expect(textePayer).toBe(`Bonjour, je viens d'enregistrer le paiement des salaires de septembre 2026, daté du 30/09/2026 (2 salariés, ${net(C.money(netPayes, 'DT'))}) : il tombe dans la période que tu as validée jusqu'au 30/09/2026, il s'écrit donc chez toi au 01/10/2026. Peux-tu en tenir compte ?`);
    await p.getByRole('button', { name: 'Envoyer', exact: true }).click();
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/messages?cote=cabinet`, leila)).corps.messages as Obj[] ?? []).map((x) => net(String(x.texte))).includes(textePayer),
      { timeout: 15_000 }).toBe(true);
    // Chez la comptable : la paie et les salaires de septembre restent à leur date ; l'un et l'autre réécrits au 1er octobre.
    await expect.poll(async () => auPremierOctobre(await ecrituresDe(ent, leila, 'PAIE-2026-09')), { timeout: 15_000 })
      .toEqual(['2026-10-01 brouillard contre_passation', '2026-10-01 brouillard contre_passation', '2026-10-01 brouillard paie', '2026-10-01 brouillard salaires']);
    septembreIntact(await ecrituresDe(ent, leila, 'PAIE-2026-09'), valideesPaie);

    // ── E. Sami n'est jamais venu : son paiement s'annule, puis son bulletin se supprime ; la question le dit, le message après ──
    await septembre();
    const bulletinS = await menuDuBulletin('s', /Annuler le paiement/);
    await p.locator(`${fenetre} #ap`).waitFor({ timeout: 10_000 });
    expect(net(await p.locator(`${fenetre} #ap-valide`).innerText())).toBe(annulation('30/09/2026', 'Il'));
    await p.locator(`${fenetre} #ap select[name=raison]`).selectOption('Payé par erreur');
    await photo(p, 'annuler-paiement');
    await p.locator(`${fenetre} #ap-ok`).click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toBe(`Paiement de Sami Ferchichi annulé — ${PHRASE} Le dire à mon comptable`);
    await p.locator('#toast-undo').click();
    const texteAnnule = await message(p);
    noter('MESSAGE ANNULÉ', texteAnnule);
    expect(texteAnnule).toBe(dit(`le paiement du salaire de Sami Ferchichi de septembre 2026, daté du 30/09/2026 (${net(C.money(netDe([bulletinS]), 'DT'))})`).replace('je viens de supprimer', 'je viens d\'annuler'));
    await expect.poll(async () => (await bulletinsDe(['s']))[0]?.paidDate, { timeout: 15_000 }).toBe('');
    await septembre();
    await menuDuBulletin('s', /Supprimer le bulletin/);
    await expect.poll(async () => net(await dessus(p).innerText()), { timeout: 10_000 }).toContain(annulation('30/09/2026', 'Il'));
    await photo(p, 'supprimer-bulletin');
    await dessus(p).locator('#ok').click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toBe(`Bulletin de Sami Ferchichi supprimé — ${PHRASE} Le dire à mon comptable`);
    await p.locator('#toast-undo').click();
    const texteSami = await message(p);
    noter('MESSAGE SAMI', texteSami);
    expect(texteSami).toBe(dit('le bulletin de Sami Ferchichi de septembre 2026, daté du 30/09/2026'));
    await expect.poll(async () => (await bulletinsDe(['s'])).length, { timeout: 15_000 }).toBe(0);
    // Chez la comptable : la paie et les salaires de septembre restent à leur date ; au 1er octobre, ce qu'ils sont devenus.
    await expect.poll(async () => JSON.stringify((await ecrituresDe(ent, leila, 'PAIE-2026-09')).filter((e) => e.type === 'salaires' && e.statut === 'brouillard')), { timeout: 15_000 })
      .toContain(` ${(nombre((bulletinK.computed as Obj).net) + netDe([bulletinA])).toFixed(3)} `);
    septembreIntact(await ecrituresDe(ent, leila, 'PAIE-2026-09'), valideesPaie);

    // ── C. L'avance de Karim notée deux fois le 15/09 : rouverte sans rien changer, rien ; supprimée, la question le dit ──
    await p.evaluate(() => { location.hash = '#/paie'; });
    await p.locator('#p-tabs [data-tab="salaries"]').click({ timeout: 20_000 });
    await p.locator('#p-sous [data-sous="avances"]').click();
    await p.locator('#cg-avances [data-av="av2"]').click({ timeout: 15_000 });
    await expect.poll(() => p.locator(`${fenetre} .modal`).last().locator('h2').innerText(), { timeout: 10_000 }).toBe('Modifier l\'avance');
    await p.waitForTimeout(600);
    expect(await p.locator(`${fenetre} #af2-valide`).isVisible()).toBe(false);
    await p.locator(`${fenetre} #del-av`).click();
    await expect.poll(async () => net(await dessus(p).innerText()), { timeout: 10_000 }).toContain(`Supprimer cette avance ? ${annulation('15/09/2026', 'Elle', true)}`);
    await photo(p, 'supprimer-avance');
    await dessus(p).locator('#ok').click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toBe(`Avance supprimée — ${PHRASE} Le dire à mon comptable`);
    await p.locator('#toast-undo').click();
    const texteAvance = await message(p);
    noter('MESSAGE AVANCE', texteAvance);
    expect(texteAvance).toBe(dit(`une avance sur salaire versée le 15/09/2026 à Karim Mansouri (${net(C.money(300, 'DT'))})`, true));
    // Chez la comptable : les 600 DT validés restent au 15/09 ; leur contre-passation et les 300 DT qui restent, au 1er octobre.
    await expect.poll(async () => auPremierOctobre(await ecrituresDe(ent, leila, 'AVANCE-2026-09-15')), { timeout: 15_000 })
      .toEqual(['2026-10-01 brouillard avance', '2026-10-01 brouillard contre_passation']);
    const avances = await ecrituresDe(ent, leila, 'AVANCE-2026-09-15');
    septembreIntact(avances, valideesAvance);
    expect(JSON.stringify(avances.filter((e) => e.type === 'avance' && e.statut === 'brouillard'))).toContain(' 300.000 ');

    // ── C bis. Une autre avance : datée d'octobre, rien ; ramenée au 25/09, la fenêtre le dit ; on renonce ──
    await p.evaluate(() => { location.hash = '#/paie'; });
    await p.locator('#p-tabs [data-tab="salaries"]').click({ timeout: 20_000 });
    await p.locator('#p-sous [data-sous="avances"]').click();
    await p.locator('#cg-new-av').click({ timeout: 15_000 });
    await expect.poll(() => p.locator(`${fenetre} .modal`).last().locator('h2').innerText(), { timeout: 10_000 }).toBe('Une avance ou un prêt');
    await p.locator(`${fenetre} [data-combo=employeeId] .combo-btn`).click();
    await p.locator(`${fenetre} [data-combo=employeeId] .combo-q`).fill('Karim');
    await p.locator(`${fenetre} [data-combo=employeeId] .combo-list [role=option]`).first().click();
    await p.locator(`${fenetre} [name=amount]`).fill('200');
    await p.locator(`${fenetre} [name=monthly]`).fill('100');
    await dater(p, `${fenetre} #af2`, '05/10/2026');
    await p.waitForTimeout(500);
    expect(await p.locator(`${fenetre} #af2-valide`).isVisible()).toBe(false);
    await dater(p, `${fenetre} #af2`, '25/09/2026');
    await expect.poll(async () => p.locator(`${fenetre} #af2-valide`).isVisible(), { timeout: 10_000 }).toBe(true);
    expect(net(await p.locator(`${fenetre} #af2-valide`).innerText())).toBe('Cette avance est datée du 25/09/2026, dans la période que ton cabinet a validée (jusqu\'au 30/09/2026) : chez lui, elle s\'écrira au 01/10/2026, le premier jour encore ouvert. En l\'enregistrant, tu pourras le lui dire.');
    await p.keyboard.press('Escape');
    for (let i = 0; i < 2 && await p.getByRole('button', { name: 'Abandonner la saisie', exact: true }).count(); i++) await p.getByRole('button', { name: 'Abandonner la saisie', exact: true }).click();
    await expect.poll(() => p.locator(`${fenetre} .modal`).count(), { timeout: 10_000 }).toBe(0);
    expect((await objets(mourad, ent)).filter((o) => o.collection === 'advances').map((o) => o.cle)).toEqual(['av1']);

    // ── Au Cabinet : septembre tel qu'elle l'a validé, et la paie de septembre réécrite au 1er octobre, au brouillard ──
    const cxC = await contexte(leila);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/journal/2026`);
    await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(c);
    await c.locator('#lv-brouillard').check();
    const lignesDe = (piece: string) => c.evaluate((x) => [...document.querySelectorAll('#c-livres tbody tr')]
      .filter((tr) => (tr.textContent ?? '').includes(x)).map((tr) => (tr.textContent ?? '').replace(/\s+/g, ' ').trim()), piece);
    await expect.poll(async () => (await lignesDe('PAIE-2026-09')).some((x) => x.includes('01/10/2026')), { timeout: 15_000 }).toBe(true);
    const vues = await lignesDe('PAIE-2026-09');
    noter('CABINET PAIE', vues);
    expect(vues.some((x) => x.includes('30/09/2026'))).toBe(true);
    await c.screenshot({ path: path.join(PHOTOS, 'compta-1305-cabinet-journal.png'), fullPage: true });

    // ── F. Une entreprise sans cabinet : établir le bulletin de septembre ne dit rien ──
    const nadia = await personne('nadia');
    const ent2 = String((await api('POST', '/entreprises-essai', nadia)).corps.id);
    await objets(nadia, ent2);
    expect((await api('POST', `/entreprises/${ent2}/dossier-v10`, nadia, { changements: [poser('employees', 'h', sal('h', 'Hela Gharbi', 1010.75, '2026-09-01', { gender: 'f' }))] })).statut).toBe(200);
    const fiche2 = (await objets(nadia, ent2)).find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent2}/dossier-v10`, nadia, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: fiche2 ? fiche2.revision : null,
      contenu: { ...(fiche2 ? fiche2.contenu : {}), setupDone: true, managerName: 'Nadia Trabelsi' } }] })).statut).toBe(200);
    const sx = await contexte(nadia);
    const s = await sx.newPage();
    s.on('pageerror', (x) => erreurs.push(`sans cabinet : ${x.message}`));
    await s.goto(`${serveur.adresse}/v10/?e=${ent2}#/paie`);
    await s.locator('#p-tabs').waitFor({ timeout: 30_000 });
    await plusTard(s);
    await septembre(s);
    await s.locator('#p-gen').click({ timeout: 15_000 });
    await s.locator(`${fenetre} #ok`).waitFor({ timeout: 10_000 });
    await s.waitForTimeout(800);
    expect(await s.locator(`${fenetre} #p-etab-valide`).count()).toBe(0);
    expect(net(await s.locator(`${fenetre}`).innerText())).not.toContain('période que ton cabinet');

    expect(erreurs).toEqual([]);
    await cx.close(); await cxC.close(); await sx.close();
  }, 300_000);
});
