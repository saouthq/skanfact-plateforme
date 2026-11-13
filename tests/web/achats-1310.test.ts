// Les Achats, 1.310.0, joués par la quincaillerie de Sousse (« Quincaillerie du Sahel ») : son grossiste en carrelage payé en
// deux fois avec sa retenue, un avoir de casse, une facture saisie deux fois, un fournisseur de Milan en euros, la STEG.
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
describe('les achats 1.310.0 : ce qu\'on doit, ce qu\'on garde, ce que lit la comptable', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-achats-1310-'));
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

  it('la quincaillerie de Sousse tient ses achats : le carrelage en retard payé avec sa retenue, l\'avoir de casse, la facture saisie deux fois, Milan en euros, la STEG', async () => {
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
    const fournisseurs = [
      { id: 's1', name: 'Céramique du Sahel SARL', matricule: '1234321B/A/M/000', contact: 'Mme Héla Ben Youssef', email: 'ventes@ceramique-sahel.exemple.tn', phone: '+216 73 300 410', city: 'Sousse', paymentTermsDays: 60, withholdingRate: 1.5 },
      { id: 's2', name: 'Ferramenta Milano S.r.l.', email: 'export@ferramenta-milano.exemple.it', phone: '+39 02 4455 1200', city: 'Milan', address: 'Via Lorenteggio 120\n20146 Milano, Italia', currency: 'EUR', paymentTermsDays: 30 },
      { id: 's3', name: 'STEG', city: 'Sousse', paymentTermsDays: 0 },
      { id: 's4', name: 'Transport Ben Salah', phone: '+216 98 412 330', city: 'Msaken', paymentTermsDays: 30 },
    ];
    const achat = (id: string, supplierId: string, kind: string, number: string, date: string, dueDate: string, category: string, lines: Obj[], extra: Obj = {}) => ({
      id, kind, number, date, dueDate, supplierId, category, currency: 'DT', exchangeRate: '', fees: 0, withholdingRate: 0, createdAt: Date.parse(`${date}T09:00:00+01:00`), attachments: [], payments: [], lines, ...extra });
    const achats = [
      achat('a1', 's1', 'facture', 'CS-26-1104', jourDe(-75), jourDe(-15), 'Marchandises', [ligne('Carrelage grès cérame 60 × 60', 400, 14.2, 19, 'm²'), ligne('Plinthe assortie', 300, 2.85, 19, 'ml')],
        { withholdingRate: 1.5, payments: [{ id: 'r1', date: jourDe(-20), amount: 3000, method: 'cheque', reference: 'Chèque 4471203' }] }),
      achat('a2', 's1', 'facture', 'CS-26-1187', jourDe(-20), jourDe(40), 'Marchandises', [ligne('Faïence murale 25 × 40', 180, 11.65, 19, 'm²')], { withholdingRate: 1.5 }),
      achat('a3', 's1', 'avoir', 'AV-26-0091', jourDe(-10), jourDe(-10), 'Marchandises', [ligne('Carrelage grès cérame 60 × 60, casse au déchargement', 20, 14.2, 19, 'm²')], { withholdingRate: 1.5 }),
      achat('a4', 's2', 'facture', 'FM-2026/0457', jourDe(-30), jourDe(0), 'Marchandises', [ligne('Robinet laiton 1/2"', 250, 3.4, 0), ligne('Raccord rapide 3/4"', 400, 1.0, 0)], { currency: 'EUR', exchangeRate: 3.38 }),
      achat('a5', 's3', 'depense', 'Facture 26-10', jourDe(-6), jourDe(-6), 'Électricité', [ligne('Électricité et gaz, octobre', 1, 322.79)],
        { payments: [{ id: 'r5', date: jourDe(-6), amount: 384.12, method: 'virement' }] }),
      achat('a6', 's4', 'facture', 'BS-778', jourDe(-3), jourDe(27), 'Transport', [ligne('Livraison Sfax → Sousse, 2 rotations', 1, 450, 7)]),
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
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `achats-1310-${nom}.png`) });
    const fen = () => p.locator('#modal-root .modal').last();
    const vue = async () => net(await p.locator('#view').innerText());

    const tete = async () => net(await p.locator('.page-head .sous').first().innerText());
    const txt = async (sel: string) => net(await p.locator(sel).first().innerText().catch(() => ''));
    const noms = async () => (await p.locator('#list-wrap tbody tr[data-id]').allInnerTexts()).map(net);

    // A. Les achats : « À payer » compte le carrelage de Céramique en retard depuis 15 jours, payé en partie ; la puce
    // « En retard » et son filtre disent la même chose (ils la taisaient : son statut est « partiel »).
    await aller('#/achats');
    await p.locator('#list-wrap tbody tr').first().waitFor();
    expect(await vue()).toContain('À payer i 4 pièces · 11 824,499 DT · dont 4 660,000 DT en retard');
    expect(await p.locator('#lf-puces [data-tst="retard"]').evaluate((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())).toBe('En retard 1');
    await p.locator('#lf-filtres select').filter({ has: p.locator('option[value="retard"]') }).first().selectOption('retard');
    await expect.poll(async () => (await noms()).length).toBe(1);
    expect((await noms())[0]).toContain('CS-26-1104');
    expect(net(await p.locator('#list-wrap tfoot').innerText())).toContain('dont 4 660,000 en retard');
    await photo('a-liste');

    // B. Les fournisseurs : « En retard » trouve Céramique.
    await aller('#/fournisseurs');
    await p.locator('#view tbody tr, #view .lc-c').first().waitFor();
    await p.locator('.segment [data-f="retard"]').dispatchEvent('click');
    expect(await txt('.segment [data-f="retard"]')).toBe('En retard 1');
    await expect.poll(async () => net(await p.locator('#view tbody').first().innerText())).toContain('Céramique du Sahel SARL');
    expect(net(await p.locator('#view tbody').first().innerText())).not.toContain('Transport Ben Salah');
    // Sa ligne offre de régler la pièce en retard, d'un geste.
    expect(await p.locator('#view tbody [data-regler="s1"]').getAttribute('title')).toBe('Régler CS-26-1104');

    // C. La fiche de Céramique : ce qu'on lui doit (son avoir de casse déduit), le retard, la retenue qu'on gardera et ce que
    // porte son compte chez la comptable ; le geste qui presse : régler la pièce en retard.
    await aller('#/fournisseur/s1');
    expect(await tete()).toContain('tu lui dois 6 785,108 DT dont 4 660,000 DT en retard');
    expect(await txt('.page-head h1 .badge')).toBe('En retard');
    expect(await txt('#ff-retard')).toMatch(/^4 660,000 DT en retard depuis 15 jours — 1 pièce : CS-26-1104/);
    expect(await txt('#ff-rs-compte')).toBe('En le payant, tu garderas aussi 103,327 DT de retenue à la source pour l\'État : son compte chez ton comptable porte 6 888,435 DT.');
    expect(await txt('.page-head .actions .btn-primary')).toBe('Régler CS-26-1104');
    await photo('b-fiche');

    // D. La pièce en retard dit le même « tu lui dois » que la fiche, et la retenue qui reste à garder (45,685 DT gardés
    // sur le premier chèque, 70,965 DT encore).
    await aller('#/achat/a1');
    expect(await txt('#ac-sup-doit')).toBe('tu lui dois 6 785,108 DT · dont 4 660,000 DT en retard de 15 jours');
    expect(await txt('#ac-phrase-regler')).toMatch(/^Tu paies 4 660,000 DT et tu retiens 70,965 DT · échéance le \d\d\/\d\d\. Un règlement partiel se note aussi\.$/);
    await p.locator('#ed-geste #pay').click();
    await fen().locator('#ok').waitFor({ timeout: 10_000 });
    expect(net(await fen().innerText())).toContain('Ce règlement retient 70,965 DT (1,5 %)');
    await fen().locator('[data-mode="virement"], [data-method="virement"]').first().click().catch(() => undefined);
    await fen().locator('#ok').click();
    await expect.poll(() => toast(p), { timeout: 15_000 }).toContain('Règlement enregistré');

    // E. Après le virement : plus rien en retard ; l'attestation des deux règlements est à lui remettre ; l'avoir de casse
    // dit d'où il peut se déduire.
    await aller('#/fournisseur/s1');
    // (1.347.0) La fiche se redessine une fois le règlement relu : on attend, comme une personne, au lieu de lire à l'instant.
    await expect.poll(() => tete(), { timeout: 15_000 }).toContain('tu lui dois 2 125,108 DT');
    expect(await p.locator('#ff-retard').count()).toBe(0);
    expect(await txt('#ff-rs-compte')).toBe('En le payant, tu garderas aussi 32,362 DT de retenue à la source pour l\'État : son compte chez ton comptable porte 2 157,470 DT.');
    expect(await txt('#ff-attest')).toMatch(/^1 attestation de retenue à lui remettre — CS-26-1104 · 116,650 DT retenus\./);
    await aller('#/achat/a3');
    expect(await txt('#ac-band-rembourse')).toBe('Céramique du Sahel SARL te doit 332,891 DT Il n\'est déduit d\'aucune facture : CS-26-1187 est à payer. Modifie la pièce et choisis-la dans « Facture concernée » pour l\'en déduire, ou enregistre le remboursement quand il te rend l\'argent.');
    await photo('c-avoir');
    // (1.357.0) L'avoir enregistré se lit en résumé : « Facture concernée » est dans son formulaire.
    await p.locator('#ac-modifier').click();
    await p.locator('[data-combo=achatLie] .combo-btn').click();
    await p.locator('[data-combo=achatLie] [role=option]').filter({ hasText: 'CS-26-1187' }).first().click();
    expect(await vue()).toContain('Avoir sur CS-26-1187 · Céramique du Sahel SARL Il retire 53,960 DT de TVA de celle que tu récupères.');
    await p.locator('#save').click();
    await expect.poll(() => toast(p)).toContain('Enregistré');
    // Rattaché, il se déduit de CS-26-1187 : la fiche ne le dit plus « à toi », et ce qu'on lui doit ne bouge pas.
    await aller('#/fournisseur/s1');
    // (rouge GitHub de b0e64c1, Node 22) La fiche peut se dessiner avant que l'enregistrement soit revenu : on attend l'état.
    await expect.poll(() => p.locator('#ff-avoir').count(), { timeout: 10_000 }).toBe(0);
    await expect.poll(tete, { timeout: 10_000 }).toContain('tu lui dois 2 125,108 DT');
    await aller('#/achats');
    await p.locator('#list-wrap tbody tr[data-id]').first().waitFor();
    expect(net(await p.locator('#list-wrap tbody tr[data-id]').filter({ hasText: 'CS-26-1187' }).innerText())).toMatch(/2 457,999.* 2 125,108 Régler$/);

    // F. Le même numéro tapé sur une autre facture : la question vient avant d'enregistrer.
    await aller('#/achat/a2/modifier');
    await p.locator('input[name=number]').fill('CS-26-1104');
    await p.locator('#save').click();
    await fen().waitFor({ timeout: 10_000 });
    expect(net(await fen().innerText())).toMatch(/^Cette facture est déjà saisie La facture n° CS-26-1104 de Céramique du Sahel SARL est déjà dans tes achats : celle du \d\d\/\d\d\/\d{4}, de 7 776,650 DT TTC, réglée le \d\d\/\d\d\./);
    await photo('d-doublon');
    await fen().getByRole('button', { name: 'Ne pas l\'enregistrer' }).click();

    // G. Milan, en euros : ce qu'on lui doit dans sa devise ; ni matricule tunisien ni RIB à 20 chiffres demandés.
    await aller('#/fournisseur/s2');
    expect(await tete()).toContain('tu lui dois 1 250,00 EUR, soit 4 225,000 DT');
    expect(await p.locator('#ff-mf, #ff-rib').count()).toBe(0);
    expect(await p.locator('.cf-dl .manque').count()).toBe(0);
    expect(await txt('#ff-rib-v')).toBe('— à l\'étranger, il se paie sur son IBAN : note-le dans ses notes internes');
    await photo('e-milan');
    // La STEG, tunisienne, payée : son matricule reste demandé.
    await aller('#/fournisseur/s3');
    expect(await tete()).toContain('tu ne lui dois rien');
    expect(await p.locator('#ff-mf').count()).toBe(1);

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
    // Le compte de Céramique est celui que la fiche annonce (2 157,470 DT) ; Milan, en dinars au taux de sa facture.
    expect(aux.find((r) => r[0] === 'Céramique du Sahel SARL')).toEqual(['Céramique du Sahel SARL', '401', '8 114,610 DT', '10 272,080 DT', '', '2 157,470 DT']);
    expect(aux.find((r) => r[0] === 'Ferramenta Milano S.r.l.')).toEqual(['Ferramenta Milano S.r.l.', '401', '0,000 DT', '4 225,000 DT', '', '4 225,000 DT']);
    await c.screenshot({ path: path.join(PHOTOS, 'achats-1310-f-auxiliaire.png') });
    // La balance âgée des fournisseurs range chaque reste selon son échéance : la faïence (à 60 jours, reçue il y a 20 jours)
    // n'est pas échue ; l'avoir de casse, daté d'il y a 10 jours, vient en moins dans « 1 à 30 jours ».
    await c.evaluate((h) => { location.hash = h; }, `#/dossier/${ent}/comptabilite/lettrage/${an}`);
    await c.locator('#lv-compte').waitFor({ timeout: 15_000 });
    await c.locator('#lv-compte').selectOption('401');
    // (1.347.0) Le compte fournisseurs se lit dans son sens : ce qu'on doit est positif, l'avoir de casse vient en moins.
    const agee = c.locator('h2', { hasText: /^Ce qui reste à payer, par ancienneté/ }).locator('xpath=..');
    await agee.waitFor({ timeout: 15_000 });
    const rangee = async (tiers: string) => (await agee.locator('tbody tr').filter({ hasText: tiers }).first().evaluate((tr) => [...tr.children].map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())));
    expect(await rangee('Céramique du Sahel SARL')).toEqual(['Céramique du Sahel SARL', '2 495,430 DT', '−337,960 DT', '', '', '', '2 157,470 DT']);
    await c.screenshot({ path: path.join(PHOTOS, 'achats-1310-g-agee.png') });
    expect(erreurs).toEqual([]);
  }, 300_000);
});
