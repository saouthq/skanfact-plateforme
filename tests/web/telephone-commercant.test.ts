// Le lot téléphone (06/10/2026 ; docs/telephone.md) : le parcours d'un commerçant tunisien au téléphone (390 × 844, au
// doigt), puis la caisse sur la tablette du comptoir (1 180 × 820) et sur un écran tactile de 1 024 × 768. Chaque point
// avait été vu sur le serveur d'essai ; on le refait au doigt :
//   - les listes (factures, accueil) : une carte par ligne, chaque case sous le titre de sa colonne ; le montant et le
//     reste dû dans l'écran, sans faire glisser un tableau ; « Actions » dans sa carte ; les titres trient encore ;
//   - une fenêtre longue (un nouveau client) garde « Enregistrer » au bas de l'écran pendant qu'on la parcourt ;
//   - « Plus ▾ » s'ouvre au bas de l'écran, sur toute sa largeur (accroché à son bouton, il sortait par la gauche) ;
//   - sur une pièce : l'étape suivante en tête, sur toute la largeur ; « WhatsApp » à côté d'« Email », qui envoie ;
//   - une bulle « i » reste avec son bouton ou sa case, et celle d'un bouton caché se cache avec lui ;
//   - les lignes d'un achat et d'une photo relue se rangent comme celles d'une facture : prix, TVA et total visibles ;
//   - une pièce émise : le bandeau tient en quelques lignes ; la première émission : « Je facturais déjà » tient ;
//   - « Documents récents » se dit au singulier ; « Ctrl K » ne se montre pas au doigt ;
//   - la caisse : la pastille « Ouverte » jamais tranchée à 1 180 points, « billets » / « pièces » jamais tranchés, et à
//     1 024 × 768 le comptage tient au-dessus de « Fermer la caisse et faire le Z ».
// Sur un ordinateur (1 440), rien de cela ne change : les listes restent des tableaux, « WhatsApp » reste dans « Plus ».

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const PHOTO_ACHAT = path.join(RACINE, 'tests/donnees/lecture/quincaillerie-photo.jpg');

describe('le lot téléphone : un commerçant au téléphone, la caisse sur la tablette', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-telephone-'));
  let n = 0;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: inject('pgAdmin') });
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await admin.end();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => (await (await fetch(`${serveur.adresse}/v1${chemin}`, {
    method: methode, headers: { ...(corps === undefined ? {} : { 'content-type': 'application/json' }), ...(jeton ? { authorization: `Bearer ${jeton}` } : {}) },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(30_000),
  })).json()) as Record<string, unknown>;
  const net = (t: string) => t.replace(/[\s\u202f]+/g, ' ').trim();
  const aujourdhui = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
  const ligne = { label: 'Ciment gris 50 kg — livraison sur chantier', description: '', qty: 12, unit: 'sac', unitPrice: 25, vatRate: 19, itemId: 'ciment' };
  const clients = [
    { id: 'c-smmc', name: 'Société Méditerranéenne de Matériaux de Construction', address: 'Zone industrielle, Sfax', matricule: '1234567A/M/A/000' },
    { id: 'c-pins', name: 'Hôtel Les Pins', address: 'Route touristique, Hammamet' },
  ];

  // Une commerçante, son entreprise d'essai (le code du téléphone posé) ; `pieces` : les clients, un article, un devis, un
  // fournisseur et son achat ; `factures` : combien de factures émises par le serveur ; `caisse` : la caisse ouverte sur
  // l'appareil de la commerçante.
  async function commercante(o: { pieces?: boolean; factures?: number; caisse?: boolean } = {}) {
    const email = `telephone-${++n}-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia Ben Salah', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Téléphone', type: 'navigateur' } })).jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const changements = [
      ...clients.map((c, i) => ({ collection: 'clients', cle: c.id, rang: 20 + i, revision: null, contenu: c })),
      ...(o.pieces ? [
        { collection: 'catalog', cle: 'ciment', rang: 0, revision: null, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', unitPrice: 25, vatRate: 19, tracked: true, initialQty: 100 } },
        { collection: 'documents', cle: 'dv1', rang: 0, revision: null, contenu: { id: 'dv1', type: 'devis', number: 'DEV-2026-001', status: 'envoyé', date: aujourdhui, clientId: 'c-pins', createdAt: 1, lines: [ligne], discountRate: 0, withholdingRate: 0, payments: [] } },
        { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Les Ciments de Bizerte' } },
        { collection: 'purchases', cle: 'p1', rang: 0, revision: null, contenu: { id: 'p1', kind: 'facture', number: 'CB-2026-0457', supplierId: 's1', date: aujourdhui, createdAt: 1, lines: [{ ...ligne, unitPrice: 18, destination: 'stock' }], payments: [] } },
      ] : []),
    ];
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
    for (let i = 1; i <= (o.factures ?? 0); i++) {
      const c = clients[(i - 1) % clients.length];
      if (!c) throw new Error('aucun client');
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: { id: `f${i}`, type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: c.id, createdAt: 10 + i,
        lines: [{ ...ligne, qty: 12 * i }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] }, client: c, revision: null, rang: i, netAPayer: (12 * i * 25 * 1.19).toFixed(3) });
      expect(String((e.contenu as Record<string, unknown> | undefined)?.number ?? e.motif)).toMatch(/^FAC-/);
    }
    if (o.caisse) expect((await api('POST', `/entreprises/${ent}/caisse/ouvrir`, jeton, { fond: '53.4' })).fond).toBe('53.400');
    return { jeton, ent };
  }
  type Ecran = { largeur: number; hauteur: number; doigt: boolean };
  const TELEPHONE: Ecran = { largeur: 390, hauteur: 844, doigt: true };
  const ORDINATEUR: Ecran = { largeur: 1440, hauteur: 900, doigt: false };
  async function ouvrir(c: { jeton: string; ent: string }, hash: string, e: Ecran) {
    const cx = await navigateur.newContext({ viewport: { width: e.largeur, height: e.hauteur }, deviceScaleFactor: 1, locale: 'fr-FR', timezoneId: 'Africa/Tunis', isMobile: e.doigt, hasTouch: e.doigt });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, c.jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${c.ent}${hash}`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    return { cx, p, erreurs };
  }
  const plusTard = async (p: Page) => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  const aller = async (p: Page, hash: string, titre: RegExp) => {
    await p.evaluate((h) => { location.hash = h; }, hash);
    await p.locator('#view h1').filter({ hasText: titre }).first().waitFor({ timeout: 15_000 });
    await plusTard(p);
  };
  const rect = (p: Page, sel: string) => p.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; });

  it('les listes au téléphone : une carte par ligne, chaque case sous le titre de sa colonne ; à l\'ordinateur, un tableau', async () => {
    const c = await commercante({ factures: 2 });
    const { cx, p, erreurs } = await ouvrir(c, '#/factures', TELEPHONE);
    await p.locator('table.list tbody tr').first().waitFor();
    // Chaque carte : le numéro qui la nomme, puis « Net à payer » et « Reste » sous leur titre, dans l'écran.
    const cartes = await p.locator('table.list > tbody > tr').evaluateAll((trs) => trs.map((tr) => {
      const r = tr.getBoundingClientRect();
      const cases = [...tr.children].map((td) => ({ titre: getComputedStyle(td, '::before').content, texte: (td.textContent ?? '').replace(/\s+/g, ' ').trim(), r: td.getBoundingClientRect(), role: td.getAttribute('data-tel') }));
      const actions = tr.querySelector('.row-menu-btn')?.getBoundingClientRect();
      return {
        carte: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
        titre: cases.find((x) => x.role === 'titre')?.texte,
        montants: cases.filter((x) => /Net à payer|Reste/.test(x.titre)).map((x) => ({ titre: x.titre, texte: x.texte, left: x.r.left, right: x.r.right })),
        actions: actions && { left: actions.left, right: actions.right, top: actions.top, bottom: actions.bottom },
      };
    }));
    expect(cartes.map((x) => x.titre)).toEqual(['FAC-2026-002', 'FAC-2026-001']);
    for (const x of cartes) {
      expect(x.montants.map((m) => m.titre)).toEqual(['"Net à payer"', '"Reste"']);
      for (const m of x.montants) { expect(m.left).toBeGreaterThanOrEqual(x.carte.left); expect(m.right).toBeLessThanOrEqual(Math.min(x.carte.right, 390) + 0.5); }
      // « Actions » dans sa carte, en haut à droite.
      const a = x.actions;
      if (!a) throw new Error('« Actions » absent de la carte');
      expect(a.left).toBeGreaterThanOrEqual(x.carte.left);
      expect(a.right).toBeLessThanOrEqual(x.carte.right + 0.5);
      expect(a.top).toBeGreaterThanOrEqual(x.carte.top);
    }
    expect(cartes[0]?.montants.map((m) => m.texte)).toEqual(['714,000 DT', '714,000 DT']);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await p.screenshot({ path: path.join(PHOTOS, 'telephone-factures-cartes.png'), fullPage: true });
    // Les titres qui trient restent : « Client » trie, et la liste redessinée garde ses titres.
    await p.locator('table.list th.sortable-h[data-sort=client]').click();
    await expect.poll(() => p.locator('table.list > tbody > tr [data-tel=titre]').allInnerTexts()).toEqual(['FAC-2026-002', 'FAC-2026-001']);
    await p.locator('table.list th.sortable-h[data-sort=client]').click();
    await expect.poll(() => p.locator('table.list > tbody > tr [data-tel=titre]').allInnerTexts()).toEqual(['FAC-2026-001', 'FAC-2026-002']);
    expect(await p.locator('table.list > tbody > tr:first-child td[data-label="Net à payer"]').innerText()).toMatch(/357,000/);
    // Une carte se touche : la facture s'ouvre.
    await p.locator('table.list > tbody > tr').first().locator('[data-tel=titre]').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/doc/f1');
    // L'accueil : « Documents récents », aussi en cartes, et sa phrase sans redite.
    await aller(p, '#/dashboard', /./);
    expect(net(await p.locator('#view h2', { hasText: 'Documents récents' }).innerText())).toBe('Documents récents — tes 2 pièces');
    expect(await p.locator('#view h2:has-text("Documents récents") ~ table.list[data-cartes] > tbody > tr, #view h2:has-text("Documents récents") ~ * table.list[data-cartes] > tbody > tr').count()).toBe(2);
    expect(erreurs).toEqual([]);
    await cx.close();

    // À l'ordinateur : la même liste reste un tableau (ses titres en tête, aucune case titrée).
    const o = await ouvrir(c, '#/factures', ORDINATEUR);
    await o.p.locator('table.list tbody tr').first().waitFor();
    expect(await o.p.locator('table.list thead th[data-sort=amount]').isVisible()).toBe(true);
    expect(await o.p.locator('table.list > tbody > tr > td').first().evaluate((td) => [getComputedStyle(td).display, getComputedStyle(td, '::before').content])).toEqual(['table-cell', 'none']);
    await o.cx.close();
  }, 180_000);

  it('une fenêtre longue garde ses boutons au bas de l\'écran ; « Plus ▾ » s\'ouvre au bas de l\'écran, sur toute sa largeur', async () => {
    const c = await commercante({ factures: 1 });
    const { cx, p, erreurs } = await ouvrir(c, '#/clients', TELEPHONE);
    await p.getByRole('button', { name: '+ Nouveau client' }).click();
    await p.locator('#modal-root #cf').waitFor();
    // À l'ouverture comme au milieu de la fenêtre : « Enregistrer » dans l'écran, sans rien faire défiler.
    for (const defile of [0, 400]) {
      await p.locator('#modal-root .modal').evaluate((m, d) => { m.scrollTop = d; }, defile);
      await p.waitForTimeout(150);
      const r = await rect(p, '#modal-root #ok');
      expect(r.top).toBeGreaterThanOrEqual(0);
      expect(r.bottom).toBeLessThanOrEqual(844);
      expect(await p.locator('#modal-root #ok').evaluate((b) => { const q = b.getBoundingClientRect(); return document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2) === b; })).toBe(true);
    }
    await p.screenshot({ path: path.join(PHOTOS, 'telephone-fenetre-client.png') });
    await p.locator('#modal-root [name=name]').fill('Café Bleu');
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    await expect.poll(() => p.locator('table.list > tbody > tr [data-tel=titre]').allInnerTexts()).toContain('Café Bleu');

    // « Plus ▾ » d'une facture émise : une feuille au bas de l'écran, sur toute sa largeur ; ses gestes y sont.
    await aller(p, '#/doc/f1', /^Facture FAC-2026-001/);
    await p.getByRole('button', { name: 'Autres actions' }).click();
    const l = await rect(p, '#more-list');
    expect(l.left).toBeGreaterThanOrEqual(0);
    expect(l.right).toBeLessThanOrEqual(390);
    expect(l.width).toBeGreaterThanOrEqual(360);
    expect(l.bottom).toBeGreaterThanOrEqual(844 - 24);
    expect(l.bottom).toBeLessThanOrEqual(844);
    await p.screenshot({ path: path.join(PHOTOS, 'telephone-plus.png') });
    await p.locator('#more-list #wa').click();
    await expect.poll(() => p.locator('#modal-root h2').allInnerTexts()).toEqual(['Envoyer Facture FAC-2026-001 par WhatsApp']);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);

  it('une pièce au téléphone : l\'étape suivante en tête, « WhatsApp » à côté d\'« Email », chaque bulle avec son bouton ; le bandeau d\'une pièce émise tient', async () => {
    const c = await commercante({ pieces: true, factures: 1 });
    const { cx, p, erreurs } = await ouvrir(c, '#/doc/f1', TELEPHONE);
    // La barre : le premier bouton (en haut à gauche) est l'étape suivante, sur toute la largeur.
    const barre = await rect(p, '#view .page-head .actions');
    const premier = await p.locator('#view .page-head .actions').evaluate((a) => {
      const vus = [...a.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0 && !b.closest('.more-list'));
      vus.sort((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top || x.getBoundingClientRect().left - y.getBoundingClientRect().left);
      return { texte: (vus[0]?.textContent ?? '').trim(), largeur: vus[0]?.getBoundingClientRect().width ?? 0 };
    });
    expect(premier.texte).toBe('Enregistrer un paiement');
    expect(premier.largeur).toBeGreaterThanOrEqual(barre.width * 0.9);
    // « WhatsApp » se voit, et envoie.
    expect(await p.locator('#wa-tel').isVisible()).toBe(true);
    await p.locator('#wa-tel').click();
    await expect.poll(() => p.locator('#modal-root h2').allInnerTexts()).toEqual(['Envoyer Facture FAC-2026-001 par WhatsApp']);
    await p.getByRole('button', { name: 'Annuler', exact: true }).click();
    // Le bandeau : la phrase, sa bulle, « Corriger par un avoir… » ; le pourquoi est dans la bulle.
    const bandeau = await rect(p, '#view .lock-banner');
    expect(bandeau.height).toBeLessThanOrEqual(170);
    expect(await p.locator('#view .lock-banner').getByText('C\'est la règle qui rend une', { exact: false }).isVisible()).toBe(false);
    expect(await p.locator('#view .lock-banner #lock-credit').isVisible()).toBe(true);
    const phrase = await rect(p, '#view .lock-banner b');
    const bulle = await rect(p, '#view .lock-banner [data-info="ed.locked"]');
    expect(Math.abs(bulle.top - phrase.top)).toBeLessThanOrEqual(14);
    await p.screenshot({ path: path.join(PHOTOS, 'telephone-facture-emise.png') });

    // Le devis : « Facturer ce devis », sa bulle et son « ▾ » sur la même rangée, en tête.
    await aller(p, '#/doc/dv1', /^Devis DEV-2026-001/);
    const bouton = await rect(p, '#convert');
    const bulleDevis = await rect(p, '[data-info="ed.convert"]');
    const fleche = await rect(p, '#bill-btn');
    expect(Math.abs((bulleDevis.top + bulleDevis.bottom) / 2 - (bouton.top + bouton.bottom) / 2)).toBeLessThanOrEqual(6);
    expect(Math.abs(fleche.top - bouton.top)).toBeLessThanOrEqual(6);
    expect(bulleDevis.left).toBeGreaterThan(bouton.left);

    // Sous les filtres d'une liste, la bulle est à côté de la case qui la précède, pas seule sur une ligne.
    await aller(p, '#/factures', /^Factures/);
    const filtre = await p.locator('#view .filters button.i').evaluate((b) => { const v = (b.previousElementSibling ?? b).getBoundingClientRect(); const r = b.getBoundingClientRect(); return { case: (v.top + v.bottom) / 2, bulle: (r.top + r.bottom) / 2 }; });
    expect(Math.abs(filtre.case - filtre.bulle)).toBeLessThanOrEqual(6);

    // L'achat : la bulle de « Lire une photo… » se cache avec lui.
    await aller(p, '#/achat/new', /^Nouvelle facture d'achat/);
    await p.locator('#photo').evaluate((b) => { (b as HTMLButtonElement).hidden = true; });
    expect(await p.locator('[data-info="ocr.photo"]').isVisible()).toBe(false);
    // Sa case non plus ne garde pas sa place dans la barre (sans la règle : 80 points vides à côté des autres boutons).
    expect((await rect(p, '.colle-bouton:has(> #photo)')).width).toBe(0);
    await p.locator('#photo').evaluate((b) => { (b as HTMLButtonElement).hidden = false; });
    expect(await p.locator('[data-info="ocr.photo"]').isVisible()).toBe(true);
    expect(erreurs).toEqual([]);
    await cx.close();

    // À l'ordinateur : « WhatsApp » reste dans « Plus », le bandeau dit son pourquoi.
    const o = await ouvrir(c, '#/doc/f1', ORDINATEUR);
    expect(await o.p.locator('#wa-tel').isVisible()).toBe(false);
    expect(await o.p.locator('#view .lock-banner').getByText('C\'est la règle qui rend une', { exact: false }).isVisible()).toBe(true);
    await o.cx.close();
  }, 180_000);

  it('les lignes d\'un achat et d\'une photo relue au téléphone : la désignation, puis prix, TVA et total dans l\'écran', async () => {
    const c = await commercante({ pieces: true });
    const { cx, p, erreurs } = await ouvrir(c, '#/achat/p1', TELEPHONE);
    await p.locator('#b-lines tr').first().waitFor();
    const dansLecran = async (sel: string) => { const r = await rect(p, sel); return r.left >= 0 && r.right <= 390.5 && r.width > 40; };
    for (const sel of ['#b-lines tr:first-child [data-k=label]', '#b-lines tr:first-child [data-k=unitPrice]', '#b-lines tr:first-child [data-k=vatRate]', '#b-lines tr:first-child [data-total]', '#b-lines tr:first-child [data-k=destination]']) expect(await dansLecran(sel), sel).toBe(true);
    expect(await p.locator('table.buy-lines:has(#b-lines)').evaluate((t) => t.scrollWidth <= t.clientWidth + 1)).toBe(true);
    expect(net(await p.locator('#b-lines tr:first-child [data-total]').innerText())).toBe('216,000');

    // Une photo relue : ses lignes aussi, et « Utiliser ces informations » au bas de l'écran.
    await aller(p, '#/achat/new', /^Nouvelle facture d'achat/);
    await p.locator('#photo:not([hidden])').waitFor({ timeout: 15_000 });
    const choix = p.waitForEvent('filechooser');
    await p.locator('#photo').click();
    await (await choix).setFiles(PHOTO_ACHAT);
    await p.locator('#modal-root h2', { hasText: 'Ce que SkanFact a lu' }).waitFor({ timeout: 90_000 });
    await p.locator('#orf-lines tr').first().waitFor();
    for (const sel of ['#orf-lines tr:first-child select', '#orf-lines tr:first-child td:nth-child(3) input', '#orf-lines tr:first-child td:nth-child(5)']) {
      await p.locator(sel).first().scrollIntoViewIfNeeded();
      expect(await dansLecran(sel), sel).toBe(true);
    }
    const ok = await rect(p, '#modal-root #ok');
    expect(ok.bottom).toBeLessThanOrEqual(844);
    await p.screenshot({ path: path.join(PHOTOS, 'telephone-photo-relue.png') });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);

  it('la première émission au téléphone : « Je facturais déjà » tient dans sa fenêtre ; « Ctrl K » ne se montre qu\'à l\'ordinateur ; « ta seule pièce »', async () => {
    const c = await commercante();
    const { cx, p, erreurs } = await ouvrir(c, '#/doc/new/facture', TELEPHONE);
    await p.locator('.combo-btn').first().click();
    await p.locator('.combo-pop').getByText('Hôtel Les Pins', { exact: true }).click();
    await p.locator('.lines-edit input').first().fill('Nuitée chambre double');
    await p.locator('.lines-edit input[type=number]').nth(1).fill('145.5');
    await p.locator('#issue').click();
    await p.locator('#modal-root #num-suite').waitFor();
    const fenetre = await rect(p, '#modal-root .modal');
    const suite = await rect(p, '#modal-root #num-suite');
    expect(suite.left).toBeGreaterThanOrEqual(fenetre.left);
    expect(suite.right).toBeLessThanOrEqual(fenetre.right);
    expect(await p.locator('#modal-root #num-suite').evaluate((b) => b.scrollWidth <= b.clientWidth + 1)).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'telephone-emission.png') });
    await p.getByRole('button', { name: /^Émettre/ }).last().click();
    await expect.poll(() => p.locator('#view h1').first().innerText(), { timeout: 15_000 }).toMatch(/^Facture FAC-2026-001/);
    await aller(p, '#/dashboard', /./);
    expect(net(await p.locator('#view h2', { hasText: 'Documents récents' }).innerText())).toBe('Documents récents — ta seule pièce');
    // Au doigt, la recherche du menu ne montre pas de raccourci de clavier.
    await p.getByRole('button', { name: 'Menu', exact: true }).click();
    expect(await p.locator('#nav-search').isVisible()).toBe(true);
    expect(await p.locator('#nav-search-k').isVisible()).toBe(false);
    expect(erreurs).toEqual([]);
    await cx.close();
    const o = await ouvrir(c, '#/dashboard', ORDINATEUR);
    expect(await o.p.locator('#nav-search-k').isVisible()).toBe(true);
    expect(await o.p.locator('#nav-search-k').innerText()).toBe('Ctrl K');
    await o.cx.close();
  }, 180_000);

  it('la caisse sur la tablette (1 180 × 820) et sur un écran de 1 024 × 768 : rien n\'est tranché, le comptage tient', async () => {
    const c = await commercante({ pieces: true, caisse: true });
    const TABLETTE: Ecran = { largeur: 1180, hauteur: 820, doigt: true };
    const COMPTOIR: Ecran = { largeur: 1024, hauteur: 768, doigt: true };
    const comptage = async (p: Page) => {
      await p.locator('#cs-menu-bouton').click();
      await p.locator('#cs-menu').getByText(/^Fermer la caisse \(Z\)/).click();
      await p.locator('.ct-compte-defile').waitFor();
    };
    const pastille = (p: Page) => p.locator('#cs-ouverte .ct-puce-texte').evaluate((t) => ({ texte: (t as HTMLElement).innerText.replace(/\s+/g, ' ').trim(), entier: t.scrollWidth <= t.clientWidth + 1 }));
    {
      const { cx, p, erreurs } = await ouvrir(c, '#/caisse', TABLETTE);
      await p.locator('#cs-ouverte').waitFor({ timeout: 20_000 });
      expect(await pastille(p)).toEqual({ texte: 'Ouverte · fond 53,400 DT', entier: true });
      await comptage(p);
      expect(await pastille(p)).toEqual({ texte: 'Ouverte · fond 53,400 DT', entier: true });
      // « billets » / « pièces » : dits en entier, ou tus quand la colonne est trop étroite ; jamais tranchés.
      const sortes = await p.locator('.ct-coupure-sorte').evaluateAll((xs) => xs.map((x) => ({ vu: getComputedStyle(x).display !== 'none', entier: x.scrollWidth <= x.clientWidth + 1 })));
      expect(sortes.length).toBe(12);
      expect(sortes.filter((s) => s.vu && !s.entier)).toEqual([]);
      await p.screenshot({ path: path.join(PHOTOS, 'tablette-comptage.png') });
      expect(erreurs).toEqual([]);
      await cx.close();
    }
    {
      const { cx, p, erreurs } = await ouvrir(c, '#/caisse', COMPTOIR);
      await p.locator('#cs-ouverte').waitFor({ timeout: 20_000 });
      await comptage(p);
      const d = await p.locator('.ct-compte-defile').evaluate((x) => ({ deborde: x.scrollHeight > x.clientHeight + 1 }));
      expect(d).toEqual({ deborde: false });
      const aide = await rect(p, '.ct-compte-defile .ct-aide');
      const z = await rect(p, '.ct-compte > .ct-principal');
      expect(aide.bottom).toBeLessThanOrEqual(z.top);
      await p.screenshot({ path: path.join(PHOTOS, 'comptoir-1024-comptage.png') });
      expect(erreurs).toEqual([]);
      await cx.close();
    }
    {
      const { cx, p } = await ouvrir(c, '#/caisse', ORDINATEUR);
      await p.locator('#cs-ouverte').waitFor({ timeout: 20_000 });
      expect((await pastille(p)).texte).toMatch(/^Ouverte par Nadia Ben Salah le \d\d\/\d\d \d\d:\d\d · fond 53,400 DT$/);
      await cx.close();
    }
  }, 180_000);
});
