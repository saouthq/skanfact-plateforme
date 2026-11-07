// Les Fournisseurs, 1.311.0, joués par la quincaillerie de Sousse (« Quincaillerie du Sahel ») : un matricule déjà connu, le
// dépôt de Sfax d'un même grossiste, le fournisseur de Milan qui facture en euros, le transporteur qu'on ne prend plus.
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
describe('les fournisseurs 1.311.0 : un seul compte par fournisseur, sa devise, ceux qu\'on ne prend plus', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-fournisseurs-1311-'));
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
  const toast = async (p: Page) => net(await p.locator('#toast').innerText().catch(() => ''));
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

  it('la quincaillerie de Sousse tient ses fournisseurs : le matricule déjà connu, le dépôt de Sfax, Milan en euros, le transporteur archivé', async () => {
    const sonia = await personne('sonia');
    const cab = await api('POST', '/cabinets', sonia, { nom: 'Cabinet Sahel Conseil' });
    const cabinet = String(cab.corps.id);
    const mourad = await personne('mourad');
    const ent = String((await api('POST', '/entreprises-essai', mourad)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, mourad, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, sonia)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, mourad)).corps.objets as Obj[];
    await objets();
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Mourad Gharbi', name: 'Quincaillerie du Sahel', city: 'Sousse' };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, mourad, { changements: [{ collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe }] })).statut).toBe(200);
    const ligne = (label: string, qty: number, prix: number, vatRate = 19, unit = '') => ({ label, description: '', qty, unit, unitPrice: prix, vatRate, destination: 'charge' });
    // Milan n'a pas encore de devise sur sa fiche : elle vient d'un import d'avant, et Mourad la pose lui-même.
    const fournisseurs = [
      { id: 's1', name: 'Céramique du Sahel SARL', matricule: '1234321B/A/M/000', contact: 'Mme Héla Ben Youssef', email: 'ventes@ceramique-sahel.exemple.tn', phone: '+216 73 300 410', city: 'Sousse', paymentTermsDays: 60, withholdingRate: 1.5, rib: '08 006 0123456789012 27' },
      { id: 's2', name: 'Ferramenta Milano S.r.l.', email: 'export@ferramenta-milano.exemple.it', phone: '+39 02 4455 1200', city: 'Milan', address: 'Via Lorenteggio 120\n20146 Milano, Italia', paymentTermsDays: 30 },
      { id: 's3', name: 'Transport Ben Salah', matricule: '0765432P/A/C/000', phone: '+216 98 412 330', city: 'Msaken', paymentTermsDays: 30 },
    ];
    const achat = (id: string, supplierId: string, number: string, date: string, dueDate: string, category: string, lines: Obj[], extra: Obj = {}) => ({
      id, kind: 'facture', number, date, dueDate, supplierId, category, currency: 'DT', exchangeRate: '', fees: 0, withholdingRate: 0, createdAt: Date.parse(`${date}T09:00:00+01:00`), attachments: [], payments: [], lines, ...extra });
    const achats = [
      achat('a1', 's1', 'CS-26-1187', jourDe(-20), jourDe(40), 'Marchandises', [ligne('Faïence murale 25 × 40', 180, 11.65, 19, 'm²')], { withholdingRate: 1.5 }),
      achat('a2', 's2', 'FM-2026/0457', jourDe(-12), jourDe(18), 'Marchandises', [ligne('Robinet laiton 1/2"', 250, 3.4, 0), ligne('Raccord rapide 3/4"', 400, 1.0, 0)], { currency: 'EUR', exchangeRate: 3.38 }),
      achat('a3', 's3', 'BS-641', jourDe(-130), jourDe(-100), 'Transport', [ligne('Livraison Sfax → Sousse, 2 rotations', 1, 450, 7)],
        { payments: [{ id: 'r3', date: jourDe(-105), amount: 481.5, method: 'virement', reference: 'Virement 3307' }] }),
    ];
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, mourad, { changements: [
      ...fournisseurs.map((s, i) => ({ collection: 'suppliers', cle: s.id, rang: i, revision: null, contenu: enc(s) })),
      ...achats.map((a, i) => ({ collection: 'purchases', cle: a.id, rang: i, revision: null, contenu: enc(a) })),
    ] })).statut).toBe(200);

    const cx = await contexte(mourad);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const aller = async (hash: string, attendre = '#view h1') => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
      await p.locator(attendre).first().waitFor({ timeout: 20_000 });
      await plusTard(p);
    };
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `fournisseurs-1311-${nom}.png`) });
    const fen = () => p.locator('#modal-root .modal').last();
    const tete = async () => net(await p.locator('.page-head .sous').first().innerText());
    const txt = async (sel: string) => net(await p.locator(sel).first().innerText().catch(() => ''));
    const lignes = async () => (await p.locator('#view tbody tr[data-sid]').allInnerTexts()).map(net);
    const menu = async (ouvrir: string) => { await p.locator(ouvrir).first().click(); await p.locator('.row-menu').last().waitFor({ timeout: 5_000 }); return p.locator('.row-menu').last(); };

    // A. Un nouveau fournisseur au matricule de Céramique : la fiche le dit pendant la frappe, et l'enregistrement est refusé.
    await aller('#/fournisseurs');
    await p.locator('#new').click();
    await fen().locator('#sf input[name=name]').fill('Céramique Sahel Gros');
    await fen().locator('#sf input[name=matricule]').fill('1234321 B/A/M/000');
    expect(await txt('#sf-mf-aide')).toBe('Déjà la fiche de « Céramique du Sahel SARL » · ouvrir sa fiche');
    await fen().locator('#ok').click();
    await expect.poll(() => toast(p)).toContain('« Céramique du Sahel SARL » a déjà ce matricule : c\'est sans doute le même fournisseur.');
    expect(await p.locator('#sf').count()).toBe(1);
    // Son dépôt de Sfax (un autre établissement) : dit, sans bloquer ; une forme fausse aussi.
    await fen().locator('#sf input[name=matricule]').fill('1234321B');
    expect(await txt('#sf-mf-aide')).toBe('Même société que « Céramique du Sahel SARL » (1234321B/A/M/000), et il manque la fin du matricule : un autre de ses établissements ? Sinon, ouvrir sa fiche.');
    await fen().locator('#sf input[name=matricule]').fill('123432');
    expect(await txt('#sf-mf-aide')).toBe('Ni un matricule (7 chiffres, une lettre, puis /A/M/000) ni un CIN (8 chiffres) : vérifie-le.');
    await fen().locator('#sf input[name=matricule]').fill('1234321B/B/M/001');
    expect(await txt('#sf-mf-aide')).toMatch(/^Même société que « Céramique du Sahel SARL » \(1234321B\/A\/M\/000\) : un autre de ses établissements \? Sinon, ouvrir sa fiche\.$/);
    await photo('a-meme-societe');
    await fen().locator('#sf input[name=name]').fill('Céramique du Sahel — dépôt de Sfax');
    await fen().locator('#ok').click();
    await expect.poll(async () => (await lignes()).some((l) => l.includes('Céramique du Sahel — dépôt de Sfax'))).toBe(true);

    // B. Milan : sa fiche demande un matricule tunisien et un RIB ; Mourad pose la devise de ses factures, et plus rien
    // ne lui est demandé ; sa fiche dit ce qu'on lui doit en euros.
    await aller('#/fournisseur/s2');
    expect(await p.locator('#ff-mf').count()).toBe(1);
    await p.locator('.cf-droite [data-modifier]').first().click();
    await fen().locator('#sf select[name=currency]').selectOption('EUR');
    await fen().locator('#ok').click();
    await expect.poll(() => p.locator('#ff-mf, #ff-rib').count()).toBe(0);
    expect(await tete()).toContain('tu lui dois 1 250,00 EUR, soit 4 225,000 DT');
    // Un achat neuf chez lui est en euros, le taux à saisir.
    // Chez un fournisseur déjà choisi, la pièce s'ouvre droit sur la saisie.
    await p.locator('#buy').click();
    await p.locator('#b-head select[name=currency]').waitFor({ state: 'attached', timeout: 15_000 });
    await expect.poll(() => p.locator('#b-head select[name=currency]').inputValue()).toBe('EUR');
    expect(await p.locator('#b-rate-field').isHidden()).toBe(false);
    // « Avant d'enregistrer » ne lui reproche plus de ne pas avoir de matricule tunisien ; sa carte dit « à l'étranger ».
    await expect.poll(() => txt('#ac-avant')).toContain('Fournisseur à l\'étranger : pas de matricule tunisien');
    expect(await txt('#ac-avant')).not.toContain('n\'a pas de matricule');
    expect(await txt('#ac-sup')).toContain('Ferramenta Milano S.r.l. à l\'étranger · 20146 Milano, Italia');
    await p.waitForTimeout(600);
    await photo('b-milan-euros');

    // C. Le transporteur qu'on ne prend plus : archivé depuis la liste, il en sort ; « Archivés » le montre.
    await aller('#/fournisseurs');
    await p.locator('#view tbody tr[data-sid]').first().waitFor();
    await (await menu('[data-rowmenu="s3"]')).getByRole('menuitem').filter({ hasText: 'Archiver' }).click();
    await expect.poll(() => toast(p)).toContain('Transport Ben Salah est archivé : il sort de la liste et des choix d\'un achat ; ses pièces restent.');
    expect(await toast(p)).not.toContain('Tu lui dois encore');
    await expect.poll(async () => (await lignes()).some((l) => l.includes('Transport Ben Salah'))).toBe(false);
    expect(await txt('#f-note')).toBe('3 fournisseurs');
    await p.locator('.segment [data-f="archives"]').dispatchEvent('click');
    await expect.poll(async () => (await lignes()).length).toBe(1);
    expect((await lignes())[0]).toMatch(/Transport Ben Salah Msaken · archivé le \d\d\/\d\d\/\d{4}/);
    await photo('c-archives');
    // Il sort des choix d'un achat ; sa pièce d'avant le garde.
    await aller('#/fournisseur/s1');
    // Chez un fournisseur déjà choisi, la pièce s'ouvre droit sur la saisie.
    await p.locator('#buy').click();
    await p.locator('#b-head select[name=currency]').waitFor({ state: 'attached', timeout: 15_000 });
    await p.locator('#sup-changer').click();
    const choix = async () => (await p.locator('[data-combo=supplierId] [role=option]').allInnerTexts()).map(net);
    await expect.poll(async () => (await choix()).length).toBeGreaterThan(1);
    expect((await choix()).some((x) => x.includes('Transport Ben Salah'))).toBe(false);
    // Choisir Milan met la pièce en euros.
    await p.locator('[data-combo=supplierId] [role=option]').filter({ hasText: 'Ferramenta Milano' }).first().click();
    await expect.poll(() => p.locator('#b-head select[name=currency]').inputValue()).toBe('EUR');
    await aller('#/achat/a3');
    expect(await txt('#ac-sup')).toContain('Transport Ben Salah');
    // Sa fiche le dit, et le remet d'un geste.
    await aller('#/fournisseur/s3');
    expect(await txt('.page-head h1 .badge')).toBe('Archivé');
    expect(await txt('#ff-archive')).toMatch(/^Fournisseur archivé le \d\d\/\d\d\/\d{4} — il n'est plus dans la liste ni dans les choix d'un achat ; ses pièces restent\. Le remettre dans la liste$/);
    await p.locator('#ff-desarchiver').click();
    await expect.poll(() => toast(p)).toContain('Transport Ben Salah revient dans la liste et dans les choix d\'un achat.');
    await expect.poll(() => p.locator('#ff-archive').count()).toBe(0);

    // D. Céramique, à qui on doit la faïence : l'archiver le dit (ce qu'on lui doit reste dans « À payer »), et « Annuler » le remet.
    await aller('#/fournisseur/s1');
    const supprimer = (await menu('.page-head [data-rowmenu="FF:s1"]')).getByRole('menuitem').filter({ hasText: 'Supprimer ce fournisseur' });
    expect(net(await supprimer.innerText())).toContain('impossible : 1 achat lié ; archive-le plutôt');
    await p.locator('.row-menu').last().getByRole('menuitem').filter({ hasText: 'Il sort de la liste et des choix ; ses pièces restent' }).click();
    await expect.poll(() => toast(p)).toMatch(/^Céramique du Sahel SARL est archivé : il sort de la liste et des choix d'un achat ; ses pièces restent\. Tu lui dois encore 2 457,999 DT : ses pièces restent dans « À payer »\./);
    expect(await txt('#ff-archive')).toContain('et ce que tu lui dois reste dans « À payer »');
    await p.locator('#toast').getByRole('button', { name: 'Annuler' }).click();
    await expect.poll(() => p.locator('#ff-archive').count()).toBe(0);

    // E. Au Cabinet, rien ne change : le compte du transporteur (archivé un moment) reste dans les livres, Milan en dinars.
    const cxC = await contexte(sonia);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    const an = jourDe(0).slice(0, 4);
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/balance/${an}`);
    await c.locator('#lv-brouillard').waitFor({ timeout: 30_000 });
    await c.locator('#lv-brouillard').check();
    await c.locator('button').filter({ hasText: /^Balance auxiliaire$/ }).first().click();
    await c.waitForTimeout(1500);
    await c.locator('select').filter({ has: c.locator('option[value="fournisseurs"]') }).first().selectOption('fournisseurs');
    const cellules = (sel: string) => c.locator(sel).evaluateAll((l) => l.map((tr) => [...tr.children].map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())));
    await expect.poll(async () => (await cellules('#c-livres tbody tr')).some((r) => r[0] === 'Céramique du Sahel SARL'), { timeout: 15_000 }).toBe(true);
    const aux = await cellules('#c-livres tbody tr');
    expect(aux.find((r) => r[0] === 'Ferramenta Milano S.r.l.')).toEqual(['Ferramenta Milano S.r.l.', '401', '0,000 DT', '4 225,000 DT', '', '4 225,000 DT']);
    expect(aux.find((r) => r[0] === 'Transport Ben Salah')).toBeTruthy();
    await c.screenshot({ path: path.join(PHOTOS, 'fournisseurs-1311-d-auxiliaire.png') });
    expect(erreurs).toEqual([]);
  }, 300_000);
});
