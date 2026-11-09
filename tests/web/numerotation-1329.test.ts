// (1.329.0) « Je facturais déjà », à la souris et à deux (docs/revue-modules.md ; serveur/v10/numerotation.ts). La boulangerie
// facturait sur un carnet jusqu'à FAC-…-047 :
//   - Karim, commercial, voit que sa facture serait la toute première, et à qui demander de continuer la numérotation : le
//     bouton n'est pas pour lui (le serveur refuserait ce réglage fiscal) ;
//   - Sarra, propriétaire, continue sa numérotation depuis la fenêtre d'émission : le titre annonce FAC-…-048, et la facture
//     émise PORTE FAC-…-048 (le serveur donnait FAC-…-001 sous un récapitulatif qui annonçait 048) ;
//   - la facture suivante de Karim annonce et porte FAC-…-049, le numéro que le serveur donnera.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { poserMouchard, retirerMouchard } from '../cliquer.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('« Je facturais déjà », jusqu\'au numéro émis (1.329.0)', () => {
    let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-numeros-'));
  beforeAll(async () => {
    await admin.connect();
    await poserMouchard(admin);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await retirerMouchard(admin).catch(() => undefined); await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

  const api = async (methode: string, chemin: string, jeton?: string, corps?: unknown) => {
    const r = await fetch(`${serveur.adresse}/v1${chemin}`, {
      method: methode, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(corps === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const an = aujourdhui.slice(0, 4);

  // La boulangerie : Sarra, propriétaire (avec son code), et Karim, commercial.
  const boulangerie = async () => {
        const email = `sarra-numeros-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
        const karimEmail = `karim-numeros-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: karimEmail, nom: 'Karim', motDePasse: 'Un-bon-mot-de-passe' });
    const karim = String((await api('POST', '/connexion', undefined, { email: karimEmail, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } })).corps.jeton);
    const invitation = String((await api('POST', `/entreprises/${ent}/invitations`, jeton, { email: karimEmail, roles: ['commercial'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', karim, { jeton: invitation })).statut).toBe(200);
    return { jeton, ent, karim };
  };

  it('Karim ne voit pas le réglage mais à qui le demander ; Sarra continue son carnet : annoncée FAC-048, émise FAC-048, puis Karim FAC-049', async () => {
    const { jeton, ent, karim } = await boulangerie();
    const pain = (id: string) => ({ id, type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: 'c1', createdAt: 1,
      lines: [{ label: 'Pain de campagne', description: '', qty: 10, unit: 'pièce', unitPrice: 10, vatRate: 7 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Hôtel Le Belvédère', address: 'Avenue Mohamed V, Tunis' } },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: pain('f1') },
      { collection: 'documents', cle: 'f2', rang: 1, revision: null, contenu: pain('f2') },
    ] })).statut).toBe(200);
    const numeroServeur = async (cle: string) => String(((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { cle: string; contenu: Record<string, unknown> }[])
      .find((o) => o.cle === cle)?.contenu.number ?? '');
    const erreurs: string[] = [];
    const ouvrir = async (j: string): Promise<[BrowserContext, Page]> => {
      const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
      await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, j);
      const pg1 = await cx.newPage();
      pg1.on('pageerror', (e) => erreurs.push(e.message));
      return [cx, pg1];
    };
    const [ck, k] = await ouvrir(karim);
    const [cs, s] = await ouvrir(jeton);
    const titreEmission = (p: Page) => p.locator('#em-titre').innerText().then(net).catch(() => '');

    // 1. Karim ouvre la première facture de l'année : la fenêtre la dit « toute première », et à qui demander de continuer.
    await k.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f2`);
    await expect.poll(() => k.locator('#issue').count(), { timeout: 20_000 }).toBe(1);
    await plusTard(k);
    await k.locator('#issue').click();
    await expect.poll(() => titreEmission(k), { timeout: 10_000 }).toBe(`Émettre la facture FAC-${an}-001 ?`);
    expect(await k.locator('#num-suite').count()).toBe(0);
    expect(net(await k.locator('#num-suite-qui').innerText())).toContain('le propriétaire ou un administrateur continue sa numérotation');
    await k.screenshot({ path: path.join(PHOTOS, 'numerotation-1329-karim.png') });
    await k.locator('.modal [data-close]').last().click();
    await expect.poll(() => k.locator('#em-titre').count()).toBe(0);

    // 2. Sarra : « Je facturais déjà », sa dernière était la 47 ; la fenêtre annonce puis émet FAC-048.
    await s.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
    await expect.poll(() => s.locator('#issue').count(), { timeout: 20_000 }).toBe(1);
    await plusTard(s);
    await s.locator('#issue').click();
    await expect.poll(() => titreEmission(s), { timeout: 10_000 }).toBe(`Émettre la facture FAC-${an}-001 ?`);
    await s.locator('#num-suite').click();
    await s.locator('#nf [name=derniere]').click();
    await s.keyboard.type('47');
    await expect.poll(() => s.locator('#nf-prochaine').innerText().then(net)).toBe(`FAC-${an}-048`);
    await s.locator('#nf-ok').click();
    await expect.poll(() => titreEmission(s), { timeout: 10_000 }).toBe(`Émettre la facture FAC-${an}-048 ?`);
    await s.screenshot({ path: path.join(PHOTOS, 'numerotation-1329-sarra.png') });
    await s.locator('.modal #ok').click();
    await expect.poll(() => numeroServeur('f1'), { timeout: 15_000 }).toBe(`FAC-${an}-048`);
    await expect.poll(() => s.locator('#view').innerText().then(net), { timeout: 10_000 }).toContain(`FAC-${an}-048`);

    // 3. Karim, la page relue : sa facture annonce et porte le numéro que le serveur donnera, FAC-049.
    await k.reload();
    await expect.poll(() => k.locator('#issue').count(), { timeout: 20_000 }).toBe(1);
    await plusTard(k);
    await k.locator('#issue').click();
    await expect.poll(() => titreEmission(k), { timeout: 10_000 }).toBe(`Émettre la facture FAC-${an}-049 ?`);
    await k.locator('.modal #ok').click();
    await expect.poll(() => numeroServeur('f2'), { timeout: 15_000 }).toBe(`FAC-${an}-049`);
    expect(erreurs).toEqual([]);
    await ck.close(); await cs.close();
  }, 120_000);

  it('une année déjà commencée au serveur : la fenêtre annonce le numéro qu\'il donnera, pas la suite du dossier', async () => {
    const { jeton, ent } = await boulangerie();
    const pain = (id: string) => ({ id, type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: 'c1', createdAt: 1,
      lines: [{ label: 'Pain de campagne', description: '', qty: 10, unit: 'pièce', unitPrice: 10, vatRate: 7 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] });
    const client = { id: 'c1', name: 'Hôtel Le Belvédère', address: 'Avenue Mohamed V, Tunis' };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: client },
      { collection: 'documents', cle: 'f2', rang: 1, revision: null, contenu: pain('f2') },
    ] })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: pain('f1'), client, revision: null, rang: 0, netAPayer: '107.000' })).statut).toBe(200);
    // Une suite posée avant la 1.329.0, quand le serveur l'ignorait : le dossier dit 47, le serveur a déjà donné 001.
    await admin.query(`insert into socle.dossier_v10 (entreprise, collection, cle, contenu) values ($1, '_racine', 'counters', $2::jsonb)
      on conflict (entreprise, collection, cle) do update set contenu = excluded.contenu`, [ent, JSON.stringify({ [`facture-${an}`]: 47 })]);
    const erreurs: string[] = [];
    const ouvrir = async (j: string): Promise<[BrowserContext, Page]> => {
      const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
      await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, j);
      const pg1 = await cx.newPage();
      pg1.on('pageerror', (e) => erreurs.push(e.message));
      return [cx, pg1];
    };
    const [cx, s] = await ouvrir(jeton);
    await s.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f2`);
    await expect.poll(() => s.locator('#issue').count(), { timeout: 20_000 }).toBe(1);
    await plusTard(s);
    await s.locator('#issue').click();
    await expect.poll(() => s.locator('#em-titre').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toBe(`Émettre la facture FAC-${an}-002 ?`);
    await s.locator('.modal #ok').click();
    await expect.poll(async () => String(((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { cle: string; contenu: Record<string, unknown> }[])
      .find((o) => o.cle === 'f2')?.contenu.number ?? ''), { timeout: 15_000 }).toBe(`FAC-${an}-002`);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
