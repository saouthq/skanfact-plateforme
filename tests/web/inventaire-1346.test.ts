// L'Inventaire d'un dossier au Cabinet, joué comme un comptable (1.346.0 ; docs/revue-modules.md). L'épicerie de la Marsa
// (« Épicerie Ennour ») suit son stock dans SkanFact ; Inès, au Cabinet, lui DEMANDE son état au lieu de recompter : la demande
// part dans leur conversation avec le chemin du geste, le client la lit sur une carte qui mène à sa page Stock (rien à
// photographier), et l'envoi de l'état à la date demandée RÉPOND à la demande. Au Cabinet, la fenêtre annonce la variation
// avant d'enregistrer, et un inventaire dont la variation est déjà écrite dit son refus à l'ouverture, pas au clic.
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
const noter = (...x: unknown[]) => fs.appendFileSync(path.join(PHOTOS, 'inventaire-1346.txt'), `${x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y, null, 1))).join(' ')}\n`);
describe('l\'inventaire d\'un dossier au Cabinet, et le pont (1.346.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-inventaire-1346-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'inventaire-1346.txt'), '');
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

  it('(1.346.0) l\'état du stock se demande au client, sa demande mène à la page Stock et l\'envoi y répond ; la variation se dit avant', async () => {
    const ines = await personne('ines');
    const cab = await api('POST', '/cabinets', ines, { nom: 'Cabinet La Marsa Conseil' });
    const cabinet = String(cab.corps.id);
    const hela = await personne('hela');
    const ent = String((await api('POST', `/entreprises-essai`, hela)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, hela, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, ines)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, hela)).corps.objets as Obj[];
    await objets();
    const auj = jourDe(0);
    const annee = auj.slice(0, 4);
    const fr = (j: string) => j.split('-').reverse().join('/');
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hela, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null,
        contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Héla Mansouri', name: 'Épicerie Ennour', city: 'La Marsa', activity: 'commerce' } },
      // Son loyer du mois : son livre existe au Cabinet (une charge, rien au stock).
      { collection: 'suppliers', cle: 'f1', rang: 0, revision: null, contenu: { id: 'f1', name: 'Immobilière du Golfe' } },
      { collection: 'purchases', cle: 'p1', rang: 0, revision: null, contenu: enc({ id: 'p1', kind: 'facture', number: 'LOY-0412', date: `${annee}-${auj.slice(5, 7)}-01`, dueDate: auj, supplierId: 'f1', currency: 'DT',
        createdAt: Date.now(), payments: [], lines: [{ label: 'Loyer du local', qty: 1, unitPrice: 900, vatRate: 19, destination: 'charge', deductible: true }] }) },
    ] })).statut).toBe(200);
    const erreurs: string[] = [];

    // A. Au Cabinet : le client est relié, rien n'est arrivé ; le geste vert est de le DEMANDER (« Saisir l'inventaire… » reste
    // là, sans couleur). La demande dit le chemin chez lui, et ce qui arrive sans stock suivi ; avant la fin de l'exercice, elle
    // est pour le premier jour ouvré après le 1er janvier.
    const cxC = await contexte(ines);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    const ouvrirInv = async () => {
      await c.goto('about:blank');
      await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/inventaire/${annee}`);
      await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
      await plusTard(c);
    };
    await ouvrirInv();
    await c.locator('#iv-demander').waitFor({ timeout: 20_000 });
    expect(await c.locator('#iv-demander-b').getAttribute('class')).toContain('btn-primary');
    expect(await c.locator('#iv-saisir2').getAttribute('class')).not.toContain('btn-primary');
    await c.screenshot({ path: path.join(PHOTOS, 'inventaire-1346-a-demander.png'), fullPage: true });
    await c.locator('#iv-demander-b').click();
    const dm = c.locator('#modal-root .modal').last();
    await dm.locator('#dm-texte').waitFor({ timeout: 10_000 });
    const texte = net(await dm.locator('#dm-texte').inputValue());
    expect(texte).toContain(`peux-tu m'envoyer l'état de ton stock au 31/12/${annee}`);
    expect(texte).toContain('Dans SkanFact : Stock, onglet Inventaire, « L\'état du stock pour ton comptable », puis « Envoyer »');
    expect(texte).toContain('Si tu ne suis pas ton stock dans SkanFact, envoie-moi ta liste comptée');
    expect(net(await dm.locator('#dm-aide').innerText())).toContain(`il arrive ici, dans l'Inventaire de ${annee}, prêt à reprendre.`);
    const ouvre = (() => { const x = new Date(`${Number(annee) + 1}-01-02T12:00:00Z`); while ([0, 6].includes(x.getUTCDay())) x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); })();
    if (`${annee}-12-31` >= auj) expect(await dm.locator('#dm-pour button[aria-pressed="true"]').getAttribute('data-j')).toBe(ouvre);
    await dm.locator('#ok').click();
    await expect.poll(() => toast(c)).toContain('Demande envoyée');
    // Demandé : on le dit, au lieu de proposer de redemander.
    await expect.poll(async () => net(await c.locator('#iv-demande').innerText().catch(() => '')), { timeout: 15_000 }).toMatch(new RegExp(`^✓ Demandé le ${fr(auj)}`));
    expect(await c.locator('#iv-demander-b').count()).toBe(0);

    // B. Chez le client, sans article suivi : rien à envoyer de sa page Stock, la demande se répond comme une pièce.
    const cx = await contexte(hela);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    const ouvrirComptable = async () => {
      await p.goto('about:blank');
      await p.goto(`${serveur.adresse}/v10/?e=${ent}#/comptable`);
      await p.locator('.msg-demande-carte').first().waitFor({ timeout: 20_000 });
      await plusTard(p);
    };
    await ouvrirComptable();
    const carteDem = (date: string) => p.locator('.msg-demande-carte').filter({ hasText: `au ${date}` });
    expect(await carteDem(`31/12/${annee}`).locator('[data-msg-etat-stock]').count()).toBe(0);
    expect(await carteDem(`31/12/${annee}`).getByRole('button', { name: 'Envoyer la pièce…', exact: true }).count()).toBe(1);

    // C. Il suit sa semoule : la carte mène à sa page Stock, onglet Inventaire, à la date demandée. Le 31/12 n'est pas encore
    // passé : la carte le dit, et n'envoie pas un stock qui bouge encore.
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, hela, { changements: [
      { collection: 'catalog', cle: 'sem', rang: 0, revision: null, contenu: enc({ id: 'sem', label: 'Semoule fine 25 kg', unit: 'sac', unitPrice: 48, vatRate: 7, tracked: true, initialQty: 12, initialCost: 37.5, initialDate: `${annee}-01-02` }) },
    ] })).statut).toBe(200);
    await ouvrirComptable();
    await carteDem(`31/12/${annee}`).locator('[data-msg-etat-stock]').click();
    await p.locator('#etat-comptable').waitFor({ timeout: 15_000 });
    expect(p.url()).toContain('#/stock');
    expect(net(await p.locator('#etat-demande').innerText())).toBe('Ton comptable te demande cet état : l\'envoyer répond à sa demande.');
    if (`${annee}-12-31` > auj) {
      expect(net(await p.locator('#etat-avenir').innerText())).toBe(`Le 31/12/${annee} n'est pas encore passé : ton stock peut encore bouger d'ici là. Envoie l'état de cette date à partir du lendemain.`);
      expect(await p.locator('#etat-envoyer').isDisabled()).toBe(true);
    }
    await p.screenshot({ path: path.join(PHOTOS, 'inventaire-1346-c-client.png'), fullPage: true });

    // D. Le cabinet demande l'état d'aujourd'hui : le client l'envoie en un vert, et l'envoi répond à la demande (reçue).
    expect((await api('POST', `/entreprises/${ent}/messages`, ines, { cote: 'cabinet', texte: 'Le compte d\'aujourd\'hui, pour la revue.', demande: `ton état du stock au ${fr(auj)}` })).statut).toBe(201);
    await ouvrirComptable();
    await carteDem(fr(auj)).locator('[data-msg-etat-stock]').click();
    await p.locator('#etat-comptable').waitFor({ timeout: 15_000 });
    expect(await p.locator('#etat-envoyer').getAttribute('class')).toContain('btn-primary');
    expect(net(await p.locator('#etat-envoyer').innerText())).toBe(`Envoyer l'état du ${fr(auj)}`);
    await p.locator('#etat-envoyer').click();
    await expect.poll(() => toast(p)).toBe(`L'état du stock au ${fr(auj)} est chez ton comptable : 1 article, 450,000 DT. Sa demande est marquée reçue.`);
    const msgs = (await api('GET', `/entreprises/${ent}/messages?cote=entreprise`, hela)).corps.messages as Obj[];
    const dems = msgs.filter((m) => m.demande).map((m) => [m.demande.texte, !!m.demande.recueLe]);
    expect(dems).toEqual(expect.arrayContaining([[`ton état du stock au ${fr(auj)}`, true], [`ton état du stock au 31/12/${annee}`, false]]));
    await cx.close();

    // E. Au Cabinet : l'état arrive ; la fenêtre annonce la variation avant d'enregistrer, par le moteur qui l'écrira ensuite.
    await ouvrirInv();
    await c.locator('#iv-client').waitFor({ timeout: 20_000 });
    expect(await c.locator('#iv-demander').count()).toBe(0);
    await c.locator('#iv-reprendre-client').click();
    const fen = c.locator('#modal-root .modal').last();
    await fen.locator('#iv-lignes').waitFor({ timeout: 10_000 });
    expect(await fen.locator('#iv-bloque').count()).toBe(0);
    await expect.poll(async () => net(await fen.locator('#iv-apercu').innerText()))
      .toBe('1 ligne — total 450,000 DT. Les comptes portent 0,000 DT au 37 : variation de +450,000 DT, à écrire ensuite depuis l\'onglet.');
    await fen.locator('#ok').click();
    await expect.poll(() => toast(c)).toBe('Inventaire enregistré.');
    await expect.poll(() => c.locator('#iv-ecrire').isEnabled(), { timeout: 15_000 }).toBe(true);
    await c.locator('#iv-ecrire').click();
    await expect.poll(() => toast(c)).toBe('Variation de stock passée en brouillard.');

    // F. La variation est écrite : refaire l'inventaire est refusé À L'OUVERTURE, avec le geste qui débloque (le moteur le dit).
    await expect.poll(() => c.locator('#iv-saisir').isVisible(), { timeout: 15_000 }).toBe(true);
    await c.locator('#iv-saisir').click();
    const f2 = c.locator('#modal-root .modal').last();
    await f2.locator('#iv-bloque').waitFor({ timeout: 10_000 });
    expect(net(await f2.locator('#iv-bloque').innerText()))
      .toBe(`L'inventaire de ${annee} est déjà passé en écriture (la variation de stock) : elle est encore au brouillard : supprime-la d'abord dans la Saisie, puis refais-le.`);
    expect(await f2.locator('#ok').isDisabled()).toBe(true);
    await c.screenshot({ path: path.join(PHOTOS, 'inventaire-1346-f-bloque.png'), fullPage: true });
    await cxC.close();
    expect(erreurs).toEqual([]);
    void noter;
  }, 300_000);
});
