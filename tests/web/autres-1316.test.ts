// Les autres pièces, 1.316.0, jouées par un négoce de matériaux de Sousse (« Matériaux du Sahel ») : une commande de chantier
// livrée en deux bons, le stock qui sort au bon et pas une seconde fois à la facture, une ligne ajoutée sur la facture des
// bons, une proforma pour la banque d'un particulier, un contrat d'approvisionnement ; puis le comptable qui lit la vente.
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'autres-1316.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('les autres pièces 1.316.0 : le négoce de matériaux, du bon de commande au comptable', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-autres-1316-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'autres-1316.txt'), '');
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

  it('le négoce livre une commande en deux bons, facture les bons avec un sac de plâtre en plus, fait une proforma et un contrat, et le comptable lit la vente', async () => {
    const amira = await personne('amira');
    const cab = await api('POST', '/cabinets', amira, { nom: 'Cabinet Sahel Conseil' });
    const cabinet = String(cab.corps.id);
    const lotfi = await personne('lotfi');
    const ent = String((await api('POST', '/entreprises-essai', lotfi)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, lotfi, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, amira)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, lotfi)).corps.objets as Obj[];
    await objets();
    const auj = jourDe(0);
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Lotfi Ben Salem', name: 'Matériaux du Sahel SARL', city: 'Sousse', paymentTermsDays: 30 };
    const article = (id: string, label: string, unit: string, prix: number, qte: number, cout: number) => ({ collection: 'catalog', cle: id, rang: 0, revision: null,
      contenu: enc({ id, label, unit, unitPrice: prix, vatRate: 19, tracked: true, initialQty: qte, initialCost: cout, initialDate: '2026-01-01' }) });
    const ligne = (itemId: string | null, label: string, qty: number, unit: string, prix: number) => ({ ...(itemId ? { itemId } : {}), label, description: '', qty, unit, unitPrice: prix, vatRate: 19 });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, lotfi, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'clients', cle: 'c-batir', rang: 0, revision: null, contenu: { id: 'c-batir', name: 'Société Bâtir Plus', matricule: '1234567A/A/M/000', city: 'Sousse' } },
      { collection: 'clients', cle: 'c-mehdi', rang: 0, revision: null, contenu: { id: 'c-mehdi', name: 'Mehdi Gharbi', city: 'Msaken' } },
      { collection: 'clients', cle: 'c-hotel', rang: 0, revision: null, contenu: { id: 'c-hotel', name: 'Hôtel Palmeraie', matricule: '7654321B/A/M/000', city: 'Hammam Sousse' } },
      article('a-ciment', 'Ciment gris 50 kg', 'sac', 18.5, 100, 14.2),
      article('a-fer', 'Fer à béton 12 mm', 't', 2350.75, 3, 1900),
      article('a-platre', 'Plâtre 25 kg', 'sac', 8.4, 30, 6.1),
      { collection: 'documents', cle: 'bc1', rang: 0, revision: null, contenu: enc({ id: 'bc1', type: 'commande', number: 'BC-2026-001', status: 'reçue', date: auj, clientId: 'c-batir',
        subject: 'Villa Khezama', createdAt: Date.now(), discountRate: 0, withholdingRate: 0, payments: [],
        lines: [ligne('a-ciment', 'Ciment gris 50 kg', 100, 'sac', 18.5), ligne('a-fer', 'Fer à béton 12 mm', 2.5, 't', 2350.75), ligne(null, 'Transport', 1, 'course', 60)] }) },
      { collection: 'documents', cle: 'pf1', rang: 0, revision: null, contenu: enc({ id: 'pf1', type: 'proforma', number: 'PRO-2026-001', status: 'envoyée', date: auj, clientId: 'c-mehdi',
        subject: 'Matériaux pour la maison de Msaken (dossier de crédit)', createdAt: Date.now(), discountRate: 0, withholdingRate: 0, payments: [],
        lines: [ligne('a-ciment', 'Ciment gris 50 kg', 150, 'sac', 18.5), ligne('a-platre', 'Plâtre 25 kg', 40, 'sac', 8.4)] }) },
      { collection: 'documents', cle: 'ct1', rang: 0, revision: null, contenu: enc({ id: 'ct1', type: 'contrat', number: 'CT-2026-001', status: 'envoyé', date: auj, clientId: 'c-hotel',
        subject: 'Approvisionnement en matériaux pour la rénovation', createdAt: Date.now(), discountRate: 0, withholdingRate: 0, payments: [],
        lines: [ligne('a-platre', 'Plâtre 25 kg', 20, 'sac', 8.4)] }) },
    ] })).statut).toBe(200);

    const cx = await contexte(lotfi);
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
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `autres-1316-${nom}.png`), fullPage: true });
    const vue = async () => net(await p.locator('#view').innerText());
    const quantites = () => p.locator('#lines tr').evaluateAll((trs) => trs.map((tr) => [
      (tr.querySelector('[data-k=label]') as HTMLInputElement | null)?.value ?? '', (tr.querySelector('[data-k=qty]') as HTMLInputElement | null)?.value ?? '']));
    const taperQuantite = async (rang: number, q: string) => {
      const champ = p.locator('#lines tr').nth(rang).locator('[data-k=qty]');
      await champ.fill(q);
      await champ.dispatchEvent('change');
    };
    const emettreLeBon = async () => {
      await p.locator('#f-head [data-etq=statut]').click();
      await p.locator('.ed-pop [data-st="émis"]').click();
      await p.locator('#save').click();
      await expect.poll(async () => net(await p.locator('#view h1').first().innerText()), { timeout: 10_000 }).toMatch(/^Bon de livraison BL-/);
      return net(await p.locator('#view h1').first().innerText()).replace(/^Bon de livraison /, '').replace(/ .*$/, '');
    };
    // Ce que l'état du stock dit en rayon, article par article (la colonne « En stock »).
    const enRayon = async () => {
      await aller('#/stock');
      const lignes = await p.locator('#view table tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())));
      return Object.fromEntries(lignes.filter((l) => l.length > 3).map((l) => [l[0], l[2]]));
    };

    // A. Au départ : 100 sacs de ciment, 3 t de fer, 30 sacs de plâtre.
    expect(await enRayon()).toEqual({ 'Ciment gris 50 kg': '100 sacs', 'Fer à béton 12 mm': '3 t', 'Plâtre 25 kg': '30 sacs' });
    await p.waitForTimeout(1500);
    // B. Le premier bon : 60 sacs et 1,25 t (le reste suit).
    await aller('#/autres/commande');
    await p.waitForTimeout(1500);
    // La page du stock a complété les fiches (seuil, série, garantie) et les a enregistrées ; relues du serveur dans un
    // autre ordre, ce sont les mêmes fiches : rien n'est « modifié des deux côtés » (la fenêtre dépend d'un temps de
    // réponse ; la règle se prouve sur la fusion elle-même, tests/moteur/bons-1316.test.ts).
    expect(net(await p.locator('#modal-root').innerText().catch(() => ''))).not.toContain('Modifications des deux côtés');
    await p.locator('[data-rowmenu="bc1"]:visible').first().click();
    await p.getByRole('menuitem').filter({ hasText: 'Établir le bon de livraison' }).first().click();
    await expect.poll(async () => net(await p.locator('#view h1').first().innerText()), { timeout: 10_000 }).toMatch(/^Bon de livraison/);
    noter('==== B bon tiré', await quantites());
    await taperQuantite(0, '60');
    await taperQuantite(1, '1.25');
    const bl1 = await emettreLeBon();
    noter('==== B bon 1', bl1, (await vue()).slice(0, 1500));
    await photo('b-bon1');
    // B. Le bon sort le stock : 40 sacs et 1,75 t restent.
    expect(await enRayon()).toMatchObject({ 'Ciment gris 50 kg': '40 sacs', 'Fer à béton 12 mm': '1,75 t' });
    await aller('#/doc/bc1');
    await p.locator('#livraisons-panel').getByRole('button', { name: 'Livrer le reste', exact: true }).click();
    await expect.poll(async () => net(await p.locator('#view h1').first().innerText()), { timeout: 10_000 }).toMatch(/^Bon de livraison/);
    const bl2 = await emettreLeBon();
    noter('==== C bon 2', bl2, await quantites());
    expect(await enRayon()).toMatchObject({ 'Ciment gris 50 kg': '0 sac', 'Fer à béton 12 mm': '0,5 t' });
    // D. Facturer les deux bons.
    await aller('#/autres/livraison');
    await p.getByRole('button', { name: 'Facturer des bons…', exact: true }).click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(async () => net(await fenetre.locator('#fb-ok').innerText())).toBe('Facturer 2 bons');
    noter('==== D fenêtre', net(await fenetre.innerText()).slice(0, 1200));
    await fenetre.locator('#fb-ok').click();
    await expect.poll(async () => net(await p.locator('#view h1').first().innerText()), { timeout: 10_000 }).toMatch(/^Facture/);
    await p.waitForTimeout(800);
    noter('==== D facture des bons', await quantites(), net(await p.locator('#ed-avant').innerText().catch(() => '')));
    noter('==== D lignes', net(await p.locator('#lines').innerText()).slice(0, 1500));
    // D. La facture des deux bons ne ressort rien : chaque ligne dit le bon avec lequel elle est partie, aucune ne manque.
    const lignesFacture = net(await p.locator('#lines').innerText());
    expect(lignesFacture).toContain(`${bl1}, ${bl2} · déjà sorti du stock`);
    expect(lignesFacture).toContain(`livré avec ${bl1}`);
    expect(lignesFacture).not.toContain('il en manque');
    expect(net(await p.locator('#ed-avant').innerText())).not.toContain('Stock : il manque');
    await photo('d-facture');
    // E. Le chef de chantier a pris 10 sacs de plâtre au comptoir : on les ajoute sur la facture.
    const fac = (await objets()).find((o) => o.collection === 'documents' && o.contenu.type === 'facture') as Obj;
    expect(fac.contenu.lines.map((l: Obj) => l.fromBon)).toEqual([`${bl1}, ${bl2}`, `${bl1}, ${bl2}`, bl1]);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, lotfi, { changements: [{ collection: 'documents', cle: fac.cle, rang: fac.rang, revision: fac.revision,
      contenu: { ...fac.contenu, lines: [...fac.contenu.lines, enc(ligne('a-platre', 'Plâtre 25 kg', 10, 'sac', 8.4))] } }] })).statut).toBe(200);
    await aller(`#/doc/${fac.cle}`);
    await p.waitForTimeout(800);
    noter('==== E avant d\'émettre', net(await p.locator('#ed-avant').innerText().catch(() => '')));
    noter('==== E lignes', net(await p.locator('#lines').innerText()).slice(0, 1500));
    await p.locator('#ed-geste #issue').click();
    await p.locator('#modal-root #ok').waitFor({ timeout: 10_000 });
    noter('==== E fenêtre d\'émission', net(await p.locator('#modal-root').innerText()).slice(0, 1500));
    // Le plâtre ajouté sort du stock (il y en a) ; le ciment et le fer sont partis avec les bons : pas d'alerte.
    expect(net(await p.locator('#modal-root').innerText())).not.toContain('Stock insuffisant');
    await p.locator('#modal-root [data-apres]:checked').evaluateAll((l) => l.forEach((x) => { (x as HTMLInputElement).checked = false; x.dispatchEvent(new Event('change', { bubbles: true })); }));
    await p.locator('#modal-root #ok').click();
    await p.waitForTimeout(3000);
    noter('==== E émise', (await vue()).slice(0, 1500));
    // E. Après la facture : les 10 sacs de plâtre sortent, le ciment et le fer ne sortent pas une seconde fois.
    expect(await enRayon()).toEqual({ 'Ciment gris 50 kg': '0 sac', 'Fer à béton 12 mm': '0,5 t', 'Plâtre 25 kg': '20 sacs' });
    // Sa copie (« Dupliquer ») est une autre vente : elle ne garde pas la marque des bons, elle sortira son stock.
    await aller(`#/doc/${fac.cle}`);
    await p.locator('#more-btn').click();
    await p.getByRole('menuitem', { name: /^Dupliquer/ }).click();
    await expect.poll(async () => net(await p.locator('#view h1').first().innerText()), { timeout: 10_000 }).toBe('Nouvelle facture');
    await expect.poll(async () => (await objets()).filter((o) => o.collection === 'documents' && o.contenu.type === 'facture' && !o.contenu.number)
      .map((o) => (o.contenu.lines as Obj[]).map((l) => l.fromBon ?? null)), { timeout: 10_000 }).toEqual([[null, null, null, null]]);
    // F. La proforma de Mehdi (pour sa banque), puis sa facture.
    await aller('#/doc/pf1');
    noter('==== F proforma', (await vue()).slice(0, 2000));
    await p.locator('#ed-geste .btn-primary[data-conv=facture]').click();
    await expect.poll(async () => net(await p.locator('#view h1').first().innerText()), { timeout: 10_000 }).toMatch(/^Facture/);
    await p.waitForTimeout(800);
    // F. La facture de la proforma reprend ses lignes ; la proforma, elle, le dit.
    expect(await quantites()).toEqual([['Ciment gris 50 kg', '150'], ['Plâtre 25 kg', '40']]);
    await aller('#/doc/pf1');
    expect(await vue()).toContain('Facturée en brouillon');
    // G. Le contrat de l'hôtel, envoyé.
    await aller('#/doc/ct1');
    noter('==== G contrat', (await vue()).slice(0, 2000));
    await photo('g-contrat');
    await aller('#/autres/proforma');
    noter('==== H liste proforma', (await vue()).slice(0, 1500));
    // K. Au Cabinet : la vente des bons.
    const cxC = await contexte(amira);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/journal/${auj.slice(0, 4)}`);
    await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(c);
    await c.locator('#lv-brouillard').check().catch(() => undefined);
    await c.waitForTimeout(3000);
    // K. Le comptable lit la facture des bons avec le plâtre : 7 870,875 HT, 9 367,341 au client.
    const livre = await c.evaluate(() => [...document.querySelectorAll('#c-livres tbody tr')].map((tr) => (tr.textContent ?? '').replace(/\s+/g, ' ').trim()));
    const FAC = `FAC-${auj.slice(0, 4)}-001`;
    expect(livre.some((x) => x.startsWith(`brouillard ${auj.slice(8, 10)}/${auj.slice(5, 7)}/${auj.slice(0, 4)} VT ${FAC} 411 Société Bâtir Plus Facture ${FAC} — Société Bâtir Plus 9 367,341 DT`))).toBe(true);
    expect(livre).toContain(`706 Société Bâtir Plus Facture ${FAC} — Société Bâtir Plus (HT 19 %) 7 870,875 DT`);
    await c.screenshot({ path: path.join(PHOTOS, 'autres-1316-k-cabinet.png'), fullPage: true });
    await cxC.close();
    expect(erreurs).toEqual([]);
    void toast;
  }, 300_000);
});
