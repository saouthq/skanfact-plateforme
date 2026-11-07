// La Caisse, 1.313.0, jouée par l'épicerie de Sfax (« Épicerie El Wafa ») un samedi : la caisse ouverte avec 50 DT de fond,
// des tickets en espèces, par carte et par chèque, un pain rendu, le tiroir compté le soir avec un manque. Chaque chiffre de
// la journée doit se retrouver ailleurs : l'accueil, la comptabilité, la trésorerie, le stock, et le Cabinet.
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'caisse-1313.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('la caisse 1.313.0 : la journée d\'une épicerie, vue de partout', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-caisse-1313-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'caisse-1313.txt'), '');
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

  it('l\'épicerie de Sfax tient sa caisse un samedi : trois tickets, un pain rendu, le tiroir compté, et la journée se retrouve partout', async () => {
    const sonia = await personne('sonia');
    const cab = await api('POST', '/cabinets', sonia, { nom: 'Cabinet Sfax Expertise' });
    const cabinet = String(cab.corps.id);
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises-essai', nour)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, nour, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, sonia)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, nour)).corps.objets as Obj[];
    await objets();
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Nour Chaabane', name: 'Épicerie El Wafa', city: 'Sfax' };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: false, statementBalance: '', notes: '' } },
      { collection: 'accounts', cle: 'k-banque', rang: 1, revision: null, contenu: { id: 'k-banque', name: 'Banque de l\'Habitat', kind: 'banque', bank: 'BH', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: true, statementBalance: '', notes: '' } },
      { collection: 'catalog', cle: 'lait', rang: 0, revision: null, contenu: enc({ id: 'lait', label: 'Lait demi-écrémé 1 L', code: '6191234567890', famille: 'Crèmerie', unit: 'u', unitPrice: 2.35, vatRate: 19 }) },
      { collection: 'catalog', cle: 'pain', rang: 1, revision: null, contenu: enc({ id: 'pain', label: 'Pain de mie', famille: 'Boulangerie', unit: 'u', unitPrice: 1.2, vatRate: 7 }) },
      { collection: 'catalog', cle: 'huile', rang: 2, revision: null, contenu: enc({ id: 'huile', label: 'Huile d\'olive 1 L', famille: 'Épicerie', unit: 'u', unitPrice: 12.5, vatRate: 19, tracked: true }) },
    ] })).statut).toBe(200);

    const cx = await contexte(nour);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const aller = async (hash: string, attendre = '#view h1') => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
      await p.locator(attendre).first().waitFor({ timeout: 20_000 });
      await plusTard(p);
    };
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `caisse-1313-${nom}.png`), fullPage: true });
    const vue = async () => net(await p.locator('#view').innerText());
    const an = jourDe(0).slice(0, 4);

    // A. Le code de responsable de Nour (un retour le demande à un caissier), puis la caisse ouverte avec 50 DT de monnaie
    // qu'elle apporte de chez elle : la Trésorerie n'a rien dans la caisse, l'écran le dit avant le geste.
    await aller('#/caisse', '#cs-menu-bouton');
    await p.locator('#cs-menu-bouton').click();
    await p.locator('#cs-code-responsable').click();
    await p.locator('#modal-root #cs-nouveau').fill('2580');
    await p.locator('#modal-root #cs-nouveau-bis').fill('2580');
    await p.locator('#modal-root #cs-code-ok').click();
    await expect.poll(() => toast(p), { timeout: 10_000 }).toBe('Ton code de responsable est enregistré.');
    await expect.poll(() => p.locator('#cs-fond').count(), { timeout: 15_000 }).toBe(1);
    expect(net(await p.locator('#cs-fond-ecart').innerText())).toBe('');
    await p.locator('#cs-fond').fill('50');
    await expect.poll(async () => net(await p.locator('#cs-fond-ecart p').innerText().catch(() => ''))).toBe('Ta caisse, dans la Trésorerie, a 0,000 DT : les 50,000 DT de plus y entrent à l\'ouverture.');
    expect(await p.locator('#cs-fond-origine option:checked').innerText()).toBe('apportés par le gérant');
    expect((await p.locator('#cs-fond-origine option').allInnerTexts()).map(net)).toEqual(['apportés par le gérant', 'retirés de « Banque de l\'Habitat »']);
    await photo('a-ouverture');
    await p.locator('#cs-ouvrir').click();
    await expect.poll(() => toast(p), { timeout: 10_000 }).toBe('Caisse ouverte, fond de caisse 50,000 DT ; fond de caisse apporté par le gérant : 50,000 DT, noté dans la Trésorerie');
    await expect.poll(async () => net(await p.locator('#cs-ouverte').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Ouverte par/);
    const art = (nom: string) => p.locator('#cs-articles .cs-art', { hasText: nom });
    // B. Trois tickets : deux pains et une huile en espèces (un billet de 20), trois laits par carte, deux huiles par chèque.
    await art('Pain de mie').click(); await art('Pain de mie').click(); await art('Huile d\'olive').click();
    await p.locator('#cs-encaisser').click();
    await p.locator('#cs-billets [data-billet="20"]').click();
    expect(net(await p.locator('#cs-valider').innerText())).toBe('Valider · rendre 2,557 DT');
    await p.locator('#cs-valider').click();
    await expect.poll(() => toast(p), { timeout: 10_000 }).toBe(`Ticket TIC-${an}-001 encaissé — à rendre 2,557 DT`);
    await p.locator('#cs-nouvelle').click();
    for (let i = 0; i < 3; i++) await art('Lait demi').click();
    await p.locator('#cs-encaisser').click();
    await p.locator('#cs-paiement [data-mode=carte]').click();
    await p.locator('#cs-valider').click();
    await expect.poll(() => toast(p), { timeout: 10_000 }).toBe(`Ticket TIC-${an}-002 encaissé`);
    await p.locator('#cs-nouvelle').click();
    await art('Huile d\'olive').click(); await art('Huile d\'olive').click();
    await p.locator('#cs-encaisser').click();
    await p.locator('#cs-paiement [data-mode=cheque]').click();
    expect(net(await p.locator('#cs-paiement').innerText())).toContain('Le chèque se remet ensuite en banque : il ne va pas dans le tiroir.');
    await p.locator('#cs-valider').click();
    await expect.poll(() => toast(p), { timeout: 10_000 }).toBe(`Ticket TIC-${an}-003 encaissé`);
    await p.locator('#cs-nouvelle').click();
    // C. Un pain rendu sur le premier ticket, rendu en espèces.
    await p.locator('#cs-tabs [data-tab=tickets]').click();
    await p.locator('#cs-liste [data-tk]', { hasText: `TIC-${an}-001` }).click();
    await p.locator('#modal-root #tk-rendre').click();
    await p.locator('#modal-root [data-rd]').first().fill('1');
    await expect.poll(async () => net(await p.locator('#modal-root #rd-annonce').innerText())).toBe('À rendre au client : 1,284 DT.');
    if (await p.locator('#modal-root #rd-code').isVisible()) await p.locator('#modal-root #rd-code').fill('2580');
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => toast(p), { timeout: 10_000 }).toBe(`Avoir AVO-${an}-001 : 1,284 DT rendus.`);
    await p.locator('#cs-tabs [data-tab=tickets]').click();
    const ventes = p.locator('#cs-ventes');
    await expect.poll(async () => net(await ventes.innerText().catch(() => '')), { timeout: 10_000 }).toBe(`Ventes du jour, retours déduits i 54,300 DT 55,584 DT vendus en 3 tickets − 1,284 DT en 1 retour (AVO-${an}-001)`);
    await photo('b-tickets');
    // D. Le soir : 66 DT dans le tiroir (un billet de 50, un de 10, une pièce de 5, une de 1) ; il manque 159 millimes.
    await p.locator('#cs-tabs [data-tab=vendre]').click();
    await p.locator('#cs-menu-bouton').click();
    await p.locator('#cs-fermer').click();
    const compter = async (i: number, n: string) => { await p.locator(`[data-coupure="${i}"]`).click(); for (const k of n) await p.locator(`#cs-pave-compte [data-touche="${k}"]`).click(); };
    await compter(0, '1'); await compter(2, '1'); await compter(3, '1'); await compter(5, '1');
    expect(net(await p.locator('#cs-compte-total').innerText())).toBe('66,000 DT');
    await p.locator('#cs-z').click();
    await expect.poll(async () => net(await p.locator('#modal-root #cs-z-table').innerText().catch(() => '')), { timeout: 10_000 })
      .toContain('Fond de caisse 50,000 DT Le tiroir devait contenir 66,159 DT Espèces comptées 66,000 DT');
    expect(net(await p.locator('#modal-root #cs-z-table').innerText())).toContain('Écart − 0,159 DT');
    await photo('c-z');
    await p.locator('#modal-root #cs-z-ok').click();
    await expect.poll(async () => net(await p.locator('#cs-fermee h2').innerText().catch(() => '')), { timeout: 10_000 }).toBe('La caisse est fermée.');

    // E. Deux chemins, un chiffre : la caisse de la Trésorerie est le tiroir compté (le fond apporté y est entré).
    await aller('#/tresorerie');
    const solde = (nom: string) => p.locator('#tr-comptes .tr-compte', { hasText: nom }).first().locator('.tr-c-solde > b');
    await expect.poll(async () => net(await solde('Caisse espèces').innerText().catch(() => '')), { timeout: 10_000 }).toBe('66,000 DT');
    expect(net(await solde('Banque de l\'Habitat').innerText())).toBe('38,141 DT');

    // F. Le soir même, Nour rouvre pour une course tardive : le fond proposé est le tiroir compté ; elle garde 6 DT pour
    // elle et ouvre avec 60 : l'écran le dit, et les 6 DT sortent de la caisse comme un retrait du gérant.
    await aller('#/caisse', '#cs-fond');
    expect(await p.locator('#cs-fond').inputValue()).toBe('66,000');
    expect(net(await p.locator('#cs-fond-ecart').innerText())).toBe('');
    await p.locator('#cs-fond').fill('60');
    await expect.poll(async () => net(await p.locator('#cs-fond-ecart p').innerText().catch(() => ''))).toBe('Ta caisse, dans la Trésorerie, a 66,000 DT : les 6,000 DT qui manquent en sortent à l\'ouverture.');
    expect((await p.locator('#cs-fond-origine option').allInnerTexts()).map(net)).toEqual(['versés à « Banque de l\'Habitat »', 'pris par le gérant', 'un manque : sortis sans être notés']);
    await p.locator('#cs-fond-origine').selectOption('retrait');
    await p.locator('#cs-ouvrir').click();
    await expect.poll(() => toast(p), { timeout: 10_000 }).toBe('Caisse ouverte, fond de caisse 60,000 DT ; espèces du tiroir prises par le gérant : 6,000 DT, noté dans la Trésorerie');
    await aller('#/tresorerie');
    await expect.poll(async () => net(await solde('Caisse espèces').innerText().catch(() => '')), { timeout: 10_000 }).toBe('60,000 DT');

    // G. L'accueil et la comptabilité : les tickets du jour, le retour déduit, nommés « Vente au comptoir ».
    await aller('#/dashboard', '[data-stat]');
    const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    const mois = MOIS[Number(jourDe(0).slice(5, 7)) - 1] ?? '';
    expect(net(await p.locator('[data-stat="ca-mois"] .val').innerText())).toBe('45,751');
    expect(net(await p.locator('[data-stat="ca-mois"] .sub').innerText())).toBe('DT HT · 54,300 TTC');
    expect(net(await p.locator('.a-der').innerText())).toContain(`AVO-${an}-001 Vente au comptoir ·`);
    await aller('#/compta');
    await expect.poll(vue).toContain(`CA HT — ${mois} ${an}`);
    expect(await vue()).toContain('45,751 DT 4 documents, avoirs déduits');
    expect(await vue()).toContain(`AVO-${an}-001 avoir · TIC-${an}-001 Vente au comptoir`);
    await aller('#/factures');
    expect(net(await p.locator('#list-wrap tbody tr.clickable').first().innerText())).toContain('Vente au comptoir');

    // H. Au Cabinet, Sonia : le chiffre d'affaires du mois est celui de l'accueil, et la caisse de ses livres est le tiroir.
    const cxC = await contexte(sonia);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}`);
    await c.locator('.fd-ch[role="group"]').waitFor({ timeout: 30_000 });
    expect(await c.locator('.fd-m-ca').evaluateAll((l) => l.map((x) => (x.getAttribute('title') || '').replace(/\s+/g, ' ')))).toContain(`Chiffre d'affaires HT ${/^[aeiouéèêh]/.test(mois) ? 'd\'' : 'de '}${mois} : 45,751 DT`);
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/balance/${an}`);
    await c.locator('#lv-brouillard').waitFor({ timeout: 30_000 });
    await c.locator('#lv-brouillard').check();
    const cellules = (sel: string) => c.locator(sel).evaluateAll((l) => l.map((tr) => [...tr.children].map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())));
    await expect.poll(async () => (await cellules('#c-livres tbody tr')).some((r) => r[0] === '54'), { timeout: 15_000 }).toBe(true);
    const bal = await cellules('#c-livres tbody tr');
    noter('balance', bal);
    expect(bal.find((r) => r[0] === '54')?.[4]).toBe('60,000 DT');
    await c.screenshot({ path: path.join(PHOTOS, 'caisse-1313-d-balance.png'), fullPage: true });
    expect(erreurs).toEqual([]);
  }, 300_000);
});
