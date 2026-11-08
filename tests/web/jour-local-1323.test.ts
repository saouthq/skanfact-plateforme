// 1.323.1 — Le rouge GitHub de 1.322.0 : le test des relances a tourné à 23 h 30 en temps universel, déjà le 8 novembre à
// Tunis ; la carte disait « Envoyé le 07/11/2026 ». Un instant (l'heure d'un geste) gardé en temps universel se coupait aux dix
// premiers caractères ; il se lit désormais comme le jour local de celui qui l'a fait (`jourDeLInstant`, règle 5.2.3), ici et
// au Cabinet. Les deux navigateurs sont réglés sur 0 h 30 à Tunis : le test ne dépend pas de l'heure où il tourne.
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
describe('le jour d\'un geste est celui de Tunis, même entre minuit et une heure (1.323.1)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-jour-local-1323-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'jour-local-1323.txt'), '');
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
  it('à 0 h 30 le 8 novembre à Tunis, l\'état envoyé se dit du 8, chez l\'entreprise comme au Cabinet', async () => {
    const ines = await personne('ines');
    const cab = await api('POST', '/cabinets', ines, { nom: 'Cabinet Sahel Conseil' });
    const cabinet = String(cab.corps.id);
    const nadia = await personne('nadia');
    const ent = String((await api('POST', `/entreprises-essai`, nadia)).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, nadia, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${cabinet}/mandats/${mandat}/accepter`, ines)).statut).toBe(200);
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, nadia)).corps.objets as Obj[];
    const fiche = (await objets()).find((o) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Nadia Ben Salah', name: 'Ascenseurs du Sahel', city: 'Sousse', activity: 'services' };
    const x = { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: '2026-09-01', dueDate: '2026-10-01', clientId: 'c1', currency: 'DT', exchangeRate: '', applyStamp: true, stampFee: 1,
      discountRate: 0, withholdingRate: 0, payments: [], notes: '', createdAt: Date.parse('2026-09-01'), lines: [{ label: 'Maintenance d\'ascenseur', qty: 1, unitPrice: 2500, vatRate: 19 }] };
    const client = { id: 'c1', name: 'Bâtiments Ezzahra' };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nadia, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: enc(client) },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: enc(x) },
    ] })).statut).toBe(200);
    const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, nadia, { document: enc(x), client: enc(client), revision: 1, rang: 0, netAPayer: '2976.000' });
    expect(e.statut, JSON.stringify(e.corps)).toBe(200);

    // Les deux navigateurs ont 0 h 30 le 8 novembre à Tunis : en temps universel, c'est encore le 7 (23 h 30).
    const minuitTrente = new Date('2026-11-08T00:30:00+01:00');
    const cx = await contexte(nadia);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    await cx.clock.setFixedTime(minuitTrente);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x2) => erreurs.push(x2.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/relances`);
    await p.locator('#r-wrap').waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.locator('#ei-envoyer').click();
    // L'instant gardé est bien celui du 7 en temps universel ; la carte dit le jour de Tunis.
    await expect.poll(async () => (await objets()).filter((o) => o.collection === 'etatsImpayes').map((o) => String((o.contenu as Obj).envoyeLe))).toEqual(['2026-11-07T23:30:00.000Z']);
    await expect.poll(async () => net(await p.locator('#ei-deja').innerText())).toBe('✓ Envoyé le 08/11/2026 : c\'est l\'état d\'aujourd\'hui.');

    const cxC = await contexte(ines);
    await cxC.clock.setFixedTime(minuitTrente);
    const c = await cxC.newPage();
    c.on('pageerror', (x2) => erreurs.push(`cabinet : ${x2.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/inventaire/2026`);
    await c.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(c);
    await c.locator('#iv-impayes').waitFor({ timeout: 20_000 });
    expect(net(await c.locator('#iv-impayes p').first().innerText())).toMatch(/ · envoyé le 08\/11\/2026\.$/);
    expect(erreurs).toEqual([]);
    await cxC.close();
    await cx.close();
  }, 180_000);
});
