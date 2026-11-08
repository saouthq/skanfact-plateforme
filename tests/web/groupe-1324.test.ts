// 1.324.0 — Le groupe jusqu'au comptable, joué par Hédi Ben Salah (Sfax) : sa Huilerie vend l'huile à sa Distribution, qui la
// revend aux épiceries ; son Transport livre la Huilerie. La page « Le groupe » dit chaque société, ce qu'elle a avec ses
// sœurs, et le groupe sans compter deux fois ; « Entre tes sociétés » compare les deux livres d'une même dette et dit les
// pièces de l'écart. Hédi ouvre la Distribution, y corrige l'achat mal recopié et note la facture oubliée : les deux livres
// disent le même montant. Sa comptable, au Cabinet, lit la même chose dans l'onglet Inventaire de chaque dossier qu'elle tient.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { ecranDeLaPlateforme } from '../moteur/v10.ts';
import { problemes } from '../instrument-rendu.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const C = ecranDeLaPlateforme('core.js') as Obj;
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
describe('le groupe 1.324.0 : trois sociétés sœurs, sans compter deux fois, et les deux livres d\'une même dette', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-groupe-1324-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'groupe-1324.txt'), '');
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
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

  const sansVisite = () => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); };
  // Un matricule tiré au sort (l'unicité des matricules actifs vaut pour toute la base de test).
  const matricule = () => `${1000000 + Math.floor(Math.random() * 8999999)}${'ABCDEFGHJKLMNPQRSTVWXYZ'[Math.floor(Math.random() * 23)]}/A/M/000`;
  const cellules = (p: Page, sel: string) => p.locator(sel).evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim())));

  it('Hédi voit son groupe sans compter deux fois, corrige l\'écart que la page lui montre ; Leïla lit la même chose au Cabinet', async () => {
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ben Ali Conseil' });
    const cabinet = String(cab.corps.id);
    const hedi = await personne('hedi');
    const MH = matricule(), MD = matricule();
    const creer = async (raisonSociale: string, matriculeFiscal?: string) => {
      const r = await api('POST', '/entreprises', hedi, { raisonSociale, ...(matriculeFiscal ? { matriculeFiscal } : {}) });
      expect(r.statut, JSON.stringify(r.corps)).toBe(201);
      return String(r.corps.id);
    };
    const h = await creer('Huilerie Ben Salah', MH), d = await creer('Distribution Ben Salah', MD), t = await creer('Transport Ben Salah');
    // Leïla tient la Huilerie et la Distribution ; pas le Transport.
    for (const ent of [h, d]) {
      const m = await api('POST', `/entreprises/${ent}/mandat`, hedi, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] });
      expect(m.statut, JSON.stringify(m.corps)).toBe(201);
      expect((await api('POST', `/cabinets/${cabinet}/mandats/${String(m.corps.mandat)}/accepter`, leila)).statut).toBe(200);
    }
    const auj = jourDe(0);
    const an = auj.slice(0, 4);
    const jma = auj.split('-').reverse().join('/');
    const objets = async (ent: string) => (await api('GET', `/entreprises/${ent}/dossier-v10`, hedi)).corps.objets as Obj[];
    const ecrire = async (ent: string, changements: Obj[]) => { const r = await api('POST', `/entreprises/${ent}/dossier-v10`, hedi, { changements }); expect(r.statut, JSON.stringify(r.corps)).toBe(200); };
    const o = (collection: string, cle: string, rang: number | null, contenu: Obj) => ({ collection, cle, rang, revision: null, contenu: enc({ id: cle, ...contenu }) });
    const preparer = async (ent: string, name: string, autres: Obj[]) => {
      const fiche = (await objets(ent)).find((x) => x.collection === '_racine' && x.cle === 'company');
      await ecrire(ent, [{ collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null,
        contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Hédi Ben Salah', name, city: 'Sfax' } }, ...autres]);
    };
    const la = (label: string, qty: number, prix: number, vatRate: number) => ({ label, description: '', qty, unit: 'u', unitPrice: prix, vatRate, destination: 'charge' });
    const achat = (number: string, supplierId: string, lines: Obj[]) => ({ kind: 'facture', number, date: auj, dueDate: auj, supplierId, category: 'Marchandises', currency: 'DT',
      exchangeRate: '', fees: 0, withholdingRate: 0, attachments: [], payments: [], lines });
    const distribution = { id: 'dist', name: 'Distribution Ben Salah', matricule: MD, city: 'Sfax' };
    const ennour = { id: 'ennour', name: 'Épicerie Ennour', matricule: matricule(), city: 'Sfax' };
    const lafayette = { id: 'lafayette', name: 'Supérette Lafayette', matricule: matricule(), city: 'Tunis' };
    await preparer(h, 'Huilerie Ben Salah', [o('clients', 'dist', 0, distribution), o('clients', 'ennour', 1, ennour),
      // La fiche du Transport, sans matricule : elle se reconnaît à son nom.
      o('suppliers', 'transport', 0, { name: 'TRANSPORT BEN SALAH', city: 'Sfax' }),
      o('purchases', 'pa2', 0, achat('TR-118', 'transport', [la('Transport de l\'huile Sfax → Tunis, 2 rotations', 1, 350, 19)]))]);
    await preparer(d, 'Distribution Ben Salah', [o('clients', 'lafayette', 0, lafayette),
      // La Huilerie, notée sous son établissement 001 et sans barres : la même société.
      o('suppliers', 'huilerie', 0, { name: 'Huilerie Ben Salah', matricule: `${MH.slice(0, 8)}AM001`, city: 'Sfax' })]);
    await preparer(t, 'Transport Ben Salah', []);

    const co = { ...C.DEFAULT_COMPANY, currency: 'DT' };
    const lv = (label: string, qty: number, unitPrice: number) => ({ label, description: '', qty, unit: 'u', unitPrice, vatRate: 7 });
    const base = { discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 0, regimeTva: 'reel' };
    let rang = 10;
    const emettre = async (ent: string, id: string, client: Obj, lines: Obj[]) => {
      const doc = { id, type: 'facture', number: '', date: auj, dueDate: auj, clientId: client.id, subject: 'Livraison d\'huile', status: 'brouillon', lines, ...base, createdAt: Date.now() };
      await ecrire(ent, [o('documents', id, rang, doc)]);
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, hedi, { document: enc(doc), client: enc(client), revision: 1, rang: rang++, netAPayer: C.computeTotals(doc, co).netToPay.toFixed(3) });
      expect(e.statut, JSON.stringify(e.corps)).toBe(200);
      return String(e.corps.numero);
    };
    const hf1 = await emettre(h, 'hf1', distribution, [lv('Huile d\'olive extra vierge, bidon 5 L', 120, 41.375)]);
    const hf2 = await emettre(h, 'hf2', distribution, [lv('Huile d\'olive vierge, bidon 20 L', 15, 152.625)]);
    await emettre(h, 'hf3', ennour, [lv('Huile d\'olive extra vierge, bidon 5 L', 40, 41.375)]);
    await emettre(d, 'df1', lafayette, [lv('Huile d\'olive extra vierge, bouteille 1 L', 300, 11.875)]);
    // La Distribution n'a noté que la première facture, avec un prix mal recopié (41,357 au lieu de 41,375).
    await ecrire(d, [o('purchases', 'pa1', 0, achat(hf1, 'huilerie', [la('Huile d\'olive extra vierge, bidon 5 L', 120, 41.357, 7)]))]);
    fs.appendFileSync(path.join(PHOTOS, 'groupe-1324.txt'), `Hédi ${h} ${d} ${t} ; factures ${hf1} ${hf2}\n`);

    // A. La page « Le groupe », depuis le menu des sociétés.
    const erreurs: string[] = [];
    const cx = await contexte(hedi);
    await cx.addInitScript(sansVisite);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${h}#/dashboard`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.locator('#brand-btn').click();
    await p.locator('#dm-groupe').click();
    await expect.poll(async () => net(await p.locator('#groupe-tableau').innerText().catch(() => '')), { timeout: 15_000 }).toContain('Transport Ben Salah');
    expect(net(await p.locator('#view .lf-tete').innerText())).toBe('Accueil Le groupe Le groupe i Tes sociétés côte à côte, sans compter deux fois ce qu\'elles se vendent entre elles Guide-moi');
    expect(await p.locator('#view .gr-resume .mg-chiffre').evaluateAll((xs) => xs.map((x) => [x.querySelector('b')?.textContent, x.querySelector('small')?.textContent].map((v) => (v ?? '').replace(/\s+/g, ' ').trim())))).toEqual([
      ['5 217,500 DT', 'hors taxes, sur l\'exercice, sans les 7 254,375 DT vendus entre tes sociétés'],
      ['5 582,725 DT', 'sans les 7 762,181 DT que tes sociétés se doivent'],
      ['0,000 DT', 'aux fournisseurs du dehors, sans ce que tes sociétés se doivent'],
      ['0,000 DT', 'la banque et la caisse de 3 sociétés']]);
    // Chaque société garde les chiffres de ses livres ; ce qu'elle a avec ses sœurs se lit sous sa ligne.
    expect(await cellules(p, '#groupe-tableau tbody tr')).toEqual([
      ['Distribution Ben Salah', '3 562,500 DT', '3 562,500 DT', '3 811,875 DT', '5 310,239 DT', '0,000 DT'],
      ['dont avec tes sociétés', '—', '—', '—', '5 310,239 DT', '—'],
      ['Huilerie Ben Salah', '8 909,375 DT', '8 909,375 DT', '9 533,031 DT', '416,500 DT', '0,000 DT'],
      ['dont avec tes sociétés', '7 254,375 DT', '7 254,375 DT', '7 762,181 DT', '416,500 DT', '—'],
      ['Transport Ben Salah', '0,000 DT', '0,000 DT', '0,000 DT', '0,000 DT', '0,000 DT']]);
    expect(await cellules(p, '#groupe-tableau tfoot tr')).toEqual([
      ['Total des livres', '12 471,875 DT', '12 471,875 DT', '13 344,906 DT', '5 726,739 DT', '0,000 DT'],
      ['Moins ce qui reste entre tes sociétés', '− 7 254,375 DT', '− 7 254,375 DT', '− 7 762,181 DT', '− 5 726,739 DT', '—'],
      ['Le groupe, sans compter deux fois', '5 217,500 DT', '5 217,500 DT', '5 582,725 DT', '0,000 DT', '0,000 DT']]);
    // Entre tes sociétés : la vente de l'huile, puis les deux livres de chaque dette, et les pièces de l'écart.
    const entre = p.locator('#gr-entre');
    expect(net(await entre.locator('[data-vente]').innerText())).toBe('Huilerie Ben Salah → Distribution Ben Salah : 7 254,375 DT');
    const hd = entre.locator(`[data-paire="${h}:${d}"]`), th = entre.locator(`[data-paire="${t}:${h}"]`);
    expect(net(await hd.innerText())).toBe(`Ce que Distribution Ben Salah doit à Huilerie Ben Salah Selon Huilerie Ben Salah 7 762,181 DT Selon Distribution Ben Salah 5 310,239 DT Écart de 2 451,942 DT : `
      + `La facture ${hf1} : 5 312,550 DT chez Huilerie Ben Salah, 5 310,239 DT dans les achats de Distribution Ben Salah. `
      + `La facture ${hf2} du ${jma} (2 449,631 DT) de Huilerie Ben Salah n'est pas dans les achats de Distribution Ben Salah. Ouvrir Huilerie Ben Salah Ouvrir Distribution Ben Salah`);
    expect(net(await th.innerText())).toBe(`Ce que Huilerie Ben Salah doit à Transport Ben Salah Selon Transport Ben Salah 0,000 DT Selon Huilerie Ben Salah 416,500 DT Écart de 416,500 DT : `
      + `Huilerie Ben Salah a noté l'achat « TR-118 » du ${jma} (416,500 DT) venant de Transport Ben Salah, qui n'a émis aucune facture de ce numéro. Ouvrir Transport Ben Salah Ouvrir Huilerie Ben Salah`);
    await p.mouse.move(1300, 120);
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(PHOTOS, 'groupe-1324-a-ordinateur.png'), fullPage: true });

    // B. Au Cabinet, Leïla lit la même chose dans l'onglet Inventaire de la Distribution ; le Transport, qu'elle ne tient
    // pas, n'y est pas.
    const cc = await contexte(leila);
    await cc.addInitScript(sansVisite);
    const c = await cc.newPage();
    c.on('pageerror', (e) => erreurs.push(`Cabinet : ${e.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${d}/comptabilite/inventaire/${an}`);
    const ivg = c.locator('#iv-groupe');
    await expect.poll(async () => net(await ivg.innerText().catch(() => '')), { timeout: 30_000 }).toContain('Écart de 2 451,942 DT');
    expect(net(await ivg.innerText())).toBe(`Les sociétés du même groupe que Distribution Ben Salah i Au ${jma}, tu tiens aussi Huilerie Ben Salah. `
      + 'Ventes de l\'exercice entre elles (hors taxes, à retirer d\'un chiffre d\'affaires consolidé) : Huilerie Ben Salah → Distribution Ben Salah 7 254,375 DT. '
      + 'Ce que Distribution Ben Salah doit à Huilerie Ben Salah : selon Huilerie Ben Salah, 7 762,181 DT ; selon Distribution Ben Salah, 5 310,239 DT. Écart de 2 451,942 DT : '
      + `La facture ${hf1} : 5 312,550 DT chez Huilerie Ben Salah, 5 310,239 DT dans les achats de Distribution Ben Salah. `
      + `La facture ${hf2} du ${jma} (2 449,631 DT) de Huilerie Ben Salah n'est pas dans les achats de Distribution Ben Salah. Ouvrir Huilerie Ben Salah`);
    await plusTard(c);
    await ivg.scrollIntoViewIfNeeded();
    await c.waitForTimeout(300);
    await c.screenshot({ path: path.join(PHOTOS, 'groupe-1324-b-cabinet.png') });
    // « Ouvrir Huilerie Ben Salah » mène à l'onglet Inventaire de la Huilerie : la même paire, lue de l'autre côté.
    await ivg.getByRole('link', { name: 'Ouvrir Huilerie Ben Salah' }).click();
    await expect.poll(() => c.evaluate(() => location.hash)).toBe(`#/dossier/${h}/comptabilite/inventaire/${an}`);
    await expect.poll(async () => net(await c.locator('#iv-groupe').innerText().catch(() => '')), { timeout: 30_000 }).toContain('Les sociétés du même groupe que Huilerie Ben Salah');
    expect(net(await c.locator('#iv-groupe').innerText())).not.toContain('Transport');

    // C. Hédi ouvre la Distribution depuis la paire, corrige le prix recopié et note la facture oubliée (comme l'écran des
    // Achats l'écrit) : les deux livres disent le même montant ; l'écart du Transport reste, il n'est pas encore facturé.
    await hd.getByRole('button', { name: 'Ouvrir Distribution Ben Salah' }).click();
    await expect.poll(() => p.url(), { timeout: 15_000 }).toContain(`e=${d}`);
    const pa1 = (await objets(d)).find((x) => x.collection === 'purchases' && x.cle === 'pa1');
    await ecrire(d, [{ collection: 'purchases', cle: 'pa1', rang: 0, revision: pa1?.revision ?? null, contenu: enc({ id: 'pa1', ...achat(hf1, 'huilerie', [la('Huile d\'olive extra vierge, bidon 5 L', 120, 41.375, 7)]) }) },
      o('purchases', 'pa3', 1, achat(hf2, 'huilerie', [la('Huile d\'olive vierge, bidon 20 L', 15, 152.625, 7)]))]);
    await p.evaluate(() => { location.hash = '#/groupe'; });
    await expect.poll(async () => net(await p.locator(`#gr-entre [data-paire="${h}:${d}"]`).innerText().catch(() => '')), { timeout: 15_000 })
      .toBe('Ce que Distribution Ben Salah doit à Huilerie Ben Salah Selon Huilerie Ben Salah 7 762,181 DT Selon Distribution Ben Salah 7 762,181 DT ✓ Les deux livres disent le même montant.');
    expect(net(await p.locator(`#gr-entre [data-paire="${t}:${h}"]`).innerText())).toContain('Écart de 416,500 DT');
    expect((await cellules(p, '#groupe-tableau tfoot tr'))[2]).toEqual(['Le groupe, sans compter deux fois', '5 217,500 DT', '5 217,500 DT', '5 582,725 DT', '0,000 DT', '0,000 DT']);
    await p.screenshot({ path: path.join(PHOTOS, 'groupe-1324-c-corrige.png'), fullPage: true });
    // Au Cabinet aussi.
    await c.goto('about:blank');
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${d}/comptabilite/inventaire/${an}`);
    await expect.poll(async () => net(await c.locator('#iv-groupe').innerText().catch(() => '')), { timeout: 30_000 }).toContain('✓ Les deux livres disent le même montant.');

    // D. Au téléphone : la page se lit, rien ne déborde.
    const tx = await contexte(hedi, 390, 844);
    await tx.addInitScript(sansVisite);
    const tel = await tx.newPage();
    tel.on('pageerror', (e) => erreurs.push(`Téléphone : ${e.message}`));
    await tel.goto(`${serveur.adresse}/v10/?e=${h}#/groupe`);
    await expect.poll(async () => net(await tel.locator('#groupe-tableau').innerText().catch(() => '')), { timeout: 20_000 }).toContain('Le groupe, sans compter deux fois');
    await plusTard(tel);
    expect(await tel.evaluate(problemes, [true, 390] as [boolean, number])).toEqual([]);
    // Ce qu'une société a avec ses sœurs se colle sous sa carte (sans l'espace qui sépare deux sociétés).
    expect(await tel.evaluate(() => { const x = document.querySelector('#groupe-tableau tr.gr-dont'); const avant = x?.previousElementSibling;
      return x && avant ? Math.round(x.getBoundingClientRect().top - avant.getBoundingClientRect().bottom) : 99; })).toBeLessThanOrEqual(0);
    await tel.screenshot({ path: path.join(PHOTOS, 'groupe-1324-d-telephone.png'), fullPage: true });
    await Promise.all([cx.close(), cc.close(), tx.close()]);
    expect(erreurs).toEqual([]);
  }, 300_000);
});
