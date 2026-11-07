// Le stock, 1.319.0, joué par la droguerie de l'Ariana (« Droguerie El Amen ») à la clôture de 2025 : la peinture qu'elle
// revend (40 pots à 61, puis 20 à 63 ; 23 sortis en juin), le mastic qu'elle fait, le vernis tout parti. Hédi envoie l'état
// du stock au 31/12/2025 à sa comptable ; il regarde celui d'aujourd'hui sans l'envoyer ; une casse de décembre, oubliée,
// arrive le lendemain, et la carte lui dit de renvoyer ; Inès, au Cabinet, reprend l'état comme inventaire d'un geste, et la
// variation de stock s'écrit au millime de la page Stock du client (2 194,325, pas la quantité fois le coût arrondi).
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'stock-1319.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('le stock 1.319.0 : la droguerie envoie l\'état de son stock, sa comptable le reprend comme inventaire', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-stock-1319-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'stock-1319.txt'), '');
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

  it('l\'état du stock au 31/12 part au cabinet, se renvoie quand le stock a changé, et se reprend comme inventaire au millime', async () => {
    const ines = await personne('ines');
    const cab = await api('POST', '/cabinets', ines, { nom: 'Cabinet Ariana Audit' });
    const cabinet = String(cab.corps.id);
    const hedi = await personne('hedi');
    const ent = String((await api('POST', `/entreprises-essai`, hedi)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, hedi, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, ines)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, hedi)).corps.objets as Obj[];
    await objets();
    const auj = jourDe(0);
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Hédi Trabelsi', name: 'Droguerie El Amen', city: 'Ariana', activity: 'commerce' };
    const article = (id: string, label: string, extra: Obj) => ({ id, label, unit: 'pot', unitPrice: 89, vatRate: 19, tracked: true, ...extra });
    const sortie = (id: string, date: string, itemId: string, qty: number, note: string) => ({ id, date, itemId, qty: -qty, note });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hedi, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'suppliers', cle: 'f1', rang: 0, revision: null, contenu: { id: 'f1', name: 'Peintures du Cap Bon' } },
      { collection: 'catalog', cle: 'peint', rang: 0, revision: null, contenu: enc(article('peint', 'Peinture murale blanche 10 L', { code: 'PNT-10', initialQty: 40, initialCost: 61, initialDate: '2025-01-02' })) },
      { collection: 'catalog', cle: 'mastic', rang: 1, revision: null, contenu: enc(article('mastic', 'Mastic de la maison', { unit: 'tube', unitPrice: 3.45, nature: 'produits', initialQty: 20, initialCost: 1.8, initialDate: '2025-01-02' })) },
      { collection: 'catalog', cle: 'vernis', rang: 2, revision: null, contenu: enc(article('vernis', 'Vernis bois 1 L', { initialQty: 5, initialCost: 22, initialDate: '2025-01-02' })) },
      { collection: 'purchases', cle: 'p1', rang: 0, revision: null, contenu: enc({ id: 'p1', kind: 'facture', number: 'PCB-2025-031', date: '2025-03-10', dueDate: '2025-04-10', supplierId: 'f1', currency: 'DT',
        createdAt: Date.parse('2025-03-10'), payments: [], lines: [{ label: 'Peinture murale blanche 10 L', itemId: 'peint', qty: 20, unitPrice: 63, vatRate: 19, destination: 'stock', deductible: true }] }) },
      { collection: 'stockAdjustments', cle: 's1', rang: 0, revision: null, contenu: sortie('s1', '2025-06-15', 'peint', 23, 'chantier de l\'école') },
      { collection: 'stockAdjustments', cle: 's2', rang: 1, revision: null, contenu: sortie('s2', '2025-10-01', 'vernis', 5, 'vendus au comptoir') },
      { collection: 'stockAdjustments', cle: 's3', rang: 2, revision: null, contenu: sortie('s3', '2026-01-12', 'peint', 3, 'après la clôture') },
    ] })).statut).toBe(200);

    const cx = await contexte(hedi);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const ouvrirInventaire = async () => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}#/stock`);
      await p.locator('#st-tabs button[data-tab="inventaire"]').waitFor({ timeout: 20_000 });
      await plusTard(p);
      await p.locator('#st-tabs button[data-tab="inventaire"]').click();
      await p.locator('#etat-comptable').waitFor({ timeout: 15_000 });
    };
    const photo = (nom: string) => p.screenshot({ path: path.join(PHOTOS, `stock-1319-${nom}.png`), fullPage: true });
    const carte = () => p.locator('#etat-comptable');
    const envoyer = () => p.locator('#etat-envoyer');
    const etatsEnvoyes = async () => (await objets()).filter((o) => o.collection === 'etatsStock').map((o) => o.contenu as Obj);
    const nombre = (v: unknown) => (v && typeof v === 'object' ? Number((v as Obj)['~n']) : Number(v));

    // A. Le 31/12/2025, proposé d'office (il y avait du stock) : deux articles (le vernis, à zéro, n'y est pas ; la sortie de
    // janvier 2026 non plus), 2 317,659 DT — la valeur de la page Stock, pas 37 × 61,667.
    await ouvrirInventaire();
    expect(net(await p.locator('#etat-resume').innerText())).toBe('2 articles en stock, 2 317,659 DT au coût moyen');
    expect(net(await envoyer().innerText())).toBe('Envoyer l\'état du 31/12/2025');
    await photo('a-carte');
    await envoyer().click();
    await expect.poll(() => toast(p)).toContain('L\'état du stock au 31/12/2025 est chez ton comptable : 2 articles, 2 317,659 DT. Il le reprend dans son inventaire.');
    await expect.poll(async () => net(await p.locator('#etat-deja').innerText().catch(() => ''))).toBe(`✓ Envoyé le ${auj.split('-').reverse().join('/')} : c'est l'état d'aujourd'hui.`);
    expect(await envoyer().isDisabled()).toBe(true);
    await expect.poll(async () => (await etatsEnvoyes()).map((e) => [e.date, nombre(e.total), (e.lignes as Obj[]).length])).toEqual([['2025-12-31', 2317.659, 2]]);

    // B. Il regarde aujourd'hui, sans l'envoyer : la date est la sienne (34 pots, la sortie de janvier comptée : 2 317,659 −
    // 3 × 61,667).
    await carte().locator('.datefield .d-txt').fill(auj.split('-').reverse().join('/'));
    await carte().locator('.datefield .d-txt').press('Tab');
    await expect.poll(async () => net(await p.locator('#etat-resume').innerText())).toBe('2 articles en stock, 2 132,658 DT au coût moyen');
    expect([net(await envoyer().innerText()), await envoyer().isDisabled()]).toEqual([`Envoyer l'état du ${auj.split('-').reverse().join('/')}`, false]);

    // C. Le lendemain arrive la casse du 20 décembre, oubliée : deux pots tombés. L'état envoyé n'est plus le bon : la carte le
    // dit, et « Renvoyer » remplace l'état du 31/12 chez la comptable (35 pots, 2 158,325 ; total 2 194,325).
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hedi, { changements: [
      { collection: 'stockAdjustments', cle: 's4', rang: 3, revision: null, contenu: { ...sortie('s4', '2025-12-20', 'peint', 2, 'tombés du rayon'), source: 'casse' } },
    ] })).statut).toBe(200);
    await ouvrirInventaire();
    await expect.poll(async () => net(await p.locator('#etat-deja').innerText().catch(() => '')))
      .toBe(`Envoyé le ${auj.split('-').reverse().join('/')} avec 2 317,659 DT : le stock de cette date a changé depuis. Renvoie-le pour que ton comptable ait le bon.`);
    expect(net(await p.locator('#etat-resume').innerText())).toBe('2 articles en stock, 2 194,325 DT au coût moyen');
    await photo('c-a-renvoyer');
    await envoyer().click();
    await expect.poll(async () => (await etatsEnvoyes()).map((e) => [e.date, nombre(e.total)])).toEqual([['2025-12-31', 2194.325]]);
    const envoye = (await etatsEnvoyes())[0] as Obj;
    expect((envoye.lignes as Obj[]).map((l) => [l.ref, l.libelle, nombre(l.quantite), nombre(l.cout), nombre(l.valeur)])).toEqual([
      ['', 'Mastic de la maison', 20, 1.8, 36], ['PNT-10', 'Peinture murale blanche 10 L', 35, 61.666, 2158.325]]);
    await cx.close();

    // D. Au Cabinet, Inès lit l'état envoyé et le reprend comme inventaire : la saisie se remplit, la valeur de chaque ligne
    // est celle du client, le total 2 194,325 ; la variation de stock s'écrit à ce millime (le compte 37 était à zéro).
    const cxC = await contexte(ines);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/inventaire/2025`);
    await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(c);
    await c.locator('#iv-client').waitFor({ timeout: 20_000 });
    expect(net(await c.locator('#iv-client p').first().innerText()))
      .toBe(`Au 31/12/2025 : 2 articles, 2 194,325 DT au coût moyen de son SkanFact · envoyé le ${auj.split('-').reverse().join('/')}.`);
    // Rien n'est encore saisi : le seul bouton principal est celui qui reprend l'état du client.
    expect(await c.locator('#iv-reprendre-client').getAttribute('class')).toContain('btn-primary');
    expect(await c.locator('#iv-saisir2').getAttribute('class')).not.toContain('btn-primary');
    await c.screenshot({ path: path.join(PHOTOS, 'stock-1319-d-cabinet.png'), fullPage: true });
    await c.locator('#iv-reprendre-client').click();
    const fenetre = c.locator('#modal-root .modal').last();
    await fenetre.locator('#iv-lignes').waitFor({ timeout: 10_000 });
    // La référence vide du mastic reste en tête (une tabulation) ; le séparateur des milliers est l'espace fine de l'écran.
    expect((await fenetre.locator('#iv-lignes').inputValue()).replace(/[\u202f\u00a0]/g, ' '))
      .toBe('\tMastic de la maison\t20\t1,800\t36,000\nPNT-10\tPeinture murale blanche 10 L\t35\t61,666\t2 158,325');
    expect(await fenetre.locator('[name=date]').inputValue()).toBe('31/12/2025');
    await expect.poll(async () => net(await fenetre.locator('#iv-apercu').innerText())).toBe('2 lignes — total 2 194,325 DT.');
    await fenetre.locator('#ok').click();
    await expect.poll(() => toast(c)).toBe('Inventaire enregistré.');
    const lu = (await api('GET', `/entreprises/${ent}/compta/inventaires/2025`, ines)).corps.inventaire as Obj;
    expect([lu.total, (lu.lignes as Obj[]).map((l) => l.valeur)]).toEqual(['2194.325', ['36.000', '2158.325']]);
    // La base refait le contrôle : une valeur qui n'est pas la quantité fois le coût, à l'arrondi près, est refusée, et
    // l'inventaire reste celui du client.
    const faux = await api('PUT', `/entreprises/${ent}/compta/inventaires/2025`, ines, { date: '2025-12-31', compte: '37',
      lignes: [{ ref: 'PNT-10', libelle: 'Peinture murale blanche 10 L', quantite: '35.000', cout: '61.666', valeur: '2258.325' }] });
    expect(faux.statut).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(faux.corps)).toContain('la valeur n\'est pas la quantité fois le coût unitaire');
    expect(((await api('GET', `/entreprises/${ent}/compta/inventaires/2025`, ines)).corps.inventaire as Obj).total).toBe('2194.325');
    await expect.poll(async () => net(await c.locator('#iv-client-ok').innerText().catch(() => ''))).toBe('✓ L\'inventaire de 2025 est celui que le client a envoyé.');
    // Relue du serveur, chaque ligne garde sa valeur dite : 2 158,325, pas 35 × 61,666 = 2 158,310.
    expect(net(await c.locator('tr', { hasText: 'PNT-10' }).last().locator('td').last().innerText())).toMatch(/^2 158,325/);
    expect(await c.locator('#iv-reprendre-client').count()).toBe(0);
    await expect.poll(() => c.locator('#iv-ecrire').isEnabled(), { timeout: 15_000 }).toBe(true);
    await c.locator('#iv-ecrire').click();
    await expect.poll(() => toast(c)).toBe('Variation de stock passée en brouillard.');
    const lie = ((await api('GET', `/entreprises/${ent}/compta/inventaires/2025`, ines)).corps.inventaire as Obj).ecriture;
    const ecrites = (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, ines)).corps.ecritures as Obj[];
    expect(ecrites.find((e) => e.id === lie)).toMatchObject({ statut: 'brouillard', lignes: [
      { compte: '37', debit: '2194.325', credit: '0.000' }, { compte: '603', debit: '0.000', credit: '2194.325' }] });
    await c.screenshot({ path: path.join(PHOTOS, 'stock-1319-e-variation.png'), fullPage: true });
    await cxC.close();
    expect(erreurs).toEqual([]);
    void noter;
  }, 300_000);
});
