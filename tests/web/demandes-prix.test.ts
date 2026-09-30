// Une demande de prix à deux fournisseurs, leurs réponses comparées, puis la commande chez le moins cher, à la
// souris (brique 89 ; 14 § 3.2 : « demande de prix, commande fournisseur… » ; web/v10/commandes-fournisseurs.txt).
// Ce que le parcours vérifie :
//   - la demande se crée, prend son numéro et s'imprime SANS prix, avec la demande de les donner ;
//   - « Demander aussi à… » : la même demande chez un autre fournisseur, sans prix ; les deux se comparent ;
//   - commander sans le prix du fournisseur est refusé, et le refus dit quoi saisir ;
//   - le moins cher se lit (en gras), « Commander chez… » en fait la commande et écarte l'autre demande ;
//   - au téléphone, la comparaison tient dans la largeur (son tableau défile dans son cadre).
// Les données discriminent : 17,250 contre 16,900 le sac.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('une demande de prix envoyée à deux fournisseurs, comparée, puis commandée chez le moins cher, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-demandes-prix-'));
  beforeAll(async () => {
    await admin.connect();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

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
  const titre = (p: Page) => p.locator('#view h1').first().innerText().then(net);
  const choisir = async (p: Page, conteneur: string, cherche: string) => {
    await p.locator(`${conteneur} .combo-btn`).click();
    await p.locator(`${conteneur} .combo-q`).fill(cherche);
    await p.locator(`${conteneur} .combo-list [role=option]`).first().click();
  };
  it('Nadia demande ses prix à deux fournisseurs, compare leurs réponses, puis commande chez le moins cher', async () => {
    const email = `nadia-demandes-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Ciments de Bizerte', matricule: '7654321B/A/M/000' } },
      { collection: 'suppliers', cle: 's2', rang: 1, revision: null, contenu: { id: 's2', name: 'Béton du Nord', matricule: '1234567C/A/M/000' } },
      { collection: 'catalog', cle: 'ciment', rang: 0, revision: null, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', unitPrice: 21, unitCost: { '~n': '17.25' }, vatRate: 19, tracked: true } },
    ] });
    expect(ecrit.statut).toBe(200);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/commandesf`);
    await expect.poll(() => titre(p), { timeout: 20_000 }).toBe('Commandes fournisseurs i');
    await plusTard(p);

    // 1. La demande, chez Ciments de Bizerte : 100 sacs (le coût du catalogue, 17,250, en référence).
    await p.locator('#cf-new-demande').click();
    await expect.poll(() => titre(p)).toMatch(/^Nouvelle demande de prix/);
    await plusTard(p);
    await choisir(p, '[data-combo=supplierId]', 'Bizerte');
    await choisir(p, '#cf-cat', 'Ciment');
    await p.locator('#cf-lines [data-k=qty][data-i="0"]').fill('100');
    await p.locator('#save').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Demande de prix BCF-\d{4}-001/);
    expect(net(await p.locator('#view .page-head .small').first().innerText())).toBe('Ciments de Bizerte · demande de prix');
    expect(await p.locator('#cf-recevoir').count()).toBe(0);
    // Elle se nomme comme telle, jusque dans ses titres.
    expect((await p.locator('#view .panel h2').allInnerTexts()).map(net).filter((t) => /^(La|Notes)/.test(t))).toEqual(['La demande i', 'Notes (imprimées sur la demande)']);

    // 2. Elle s'imprime sans prix, avec la demande de les donner.
    const fenetre = p.waitForEvent('popup');
    await p.locator('#cf-pdf').click();
    const imprimee = await fenetre;
    await imprimee.waitForLoadState();
    const texte = net(await imprimee.locator('body').innerText());
    expect(texte).toMatch(/Demande de prix/i);
    expect(texte).toContain('Merci de nous indiquer vos prix unitaires hors taxes et votre délai de livraison pour ces articles.');
    expect(texte).toMatch(/Ciment gris 50 kg 100/);
    expect(texte).not.toMatch(/17,250|Total/i);
    await imprimee.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'demandes-prix-1-imprimee.png') });
    await imprimee.close();

    // 3. « Demander aussi à… » Béton du Nord : la même demande, sans prix ; les deux se comparent.
    await p.locator('#cf-aussi').click();
    await expect.poll(() => p.locator('#aussi-f option').allInnerTexts()).toEqual(['Béton du Nord']);
    await p.locator('#aussi-ok').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Demande de prix BCF-\d{4}-002/);
    expect(net(await p.locator('#view .page-head .small').first().innerText())).toBe('Béton du Nord · demande de prix');
    expect(await p.locator('#cf-lines [data-k=unitPrice][data-i="0"]').inputValue()).toMatch(/^0(\.000)?$/);
    expect(net(await p.locator('#cf-comparer').innerText())).toMatch(/Ciment gris 50 kg 100 sac 17,250 DT sans réponse Total HT 1 725,000 DT incomplète/);

    // 4. Commander sans son prix : refusé, et le refus dit quoi saisir.
    const ici = await p.evaluate(() => location.hash.split('/').pop() ?? '');
    await p.locator(`[data-commander="${ici}"]`).click();
    await expect.poll(() => p.locator('#toast').innerText()).toContain('Saisis d\'abord le prix que Béton du Nord t\'a répondu pour Ciment gris 50 kg');
    expect(await titre(p)).toMatch(/^Demande de prix/);

    // 5. Sa réponse : 16,900 le sac. Le moins cher se lit en gras ; son bouton est le principal.
    await p.locator('#cf-lines [data-k=unitPrice][data-i="0"]').fill('16.9');
    await p.locator('#save').click();
    await expect.poll(async () => net(await p.locator('#cf-comparer').innerText())).toMatch(/Ciment gris 50 kg 100 sac 17,250 DT 16,900 DT Total HT 1 725,000 DT 1 690,000 DT Commander chez Ciments de Bizerte Commander chez Béton du Nord/);
    expect((await p.locator('#cf-comparer b').allInnerTexts()).map(net)).toEqual(['16,900 DT', 'Total HT', '1 690,000 DT']);
    expect(await p.locator('#cf-comparer .btn-primary').innerText()).toBe('Commander chez Béton du Nord');
    await p.locator('#cf-comparer').scrollIntoViewIfNeeded();
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'demandes-prix-2-comparaison.png') });

    // 6. Commander chez Béton du Nord : sa demande devient la commande, l'autre est écartée.
    await p.locator('#cf-comparer .btn-primary').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Commande BCF-\d{4}-002/);
    expect(net(await p.locator('#view .page-head .small').first().innerText())).toBe('Béton du Nord · envoyée');
    expect(await p.locator('#cf-recevoir').innerText()).toBe('Recevoir');
    await p.evaluate(() => { location.hash = '#/commandesf'; });
    await expect.poll(async () => net(await p.locator('#cf-list').innerText()), { timeout: 10_000 })
      .toMatch(/BCF-\d{4}-002 Béton du Nord .* envoyée 1 690,000 DT BCF-\d{4}-001 Ciments de Bizerte .* annulée 1 725,000 DT/);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'demandes-prix-3-liste.png') });
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 180_000);

  it('au téléphone, la comparaison des réponses tient dans la largeur', async () => {
    const email = `nadia-demandes-tel-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Téléphone', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    // Un nombre à virgule s'écrit { '~n': … } dans le dossier (l'argent n'y est jamais un nombre à virgule).
    const ligne = (pu: string) => [{ label: 'Ciment gris 50 kg', qty: 100, unit: 'sac', unitPrice: { '~n': pu }, vatRate: 19 }];
    const demande = (id: string, s: string, n: string, pu: string) => ({ id, type: 'commandeFournisseur', number: n, status: 'demande', date: '2026-10-01', supplierId: s, currency: 'DT', groupe: 'd1', lines: ligne(pu) });
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Ciments de Bizerte' } },
      { collection: 'suppliers', cle: 's2', rang: 1, revision: null, contenu: { id: 's2', name: 'Béton du Nord' } },
      { collection: 'supplierOrders', cle: 'd1', rang: 0, revision: null, contenu: demande('d1', 's1', 'BCF-2026-001', '17.25') },
      { collection: 'supplierOrders', cle: 'd2', rang: 1, revision: null, contenu: demande('d2', 's2', 'BCF-2026-002', '16.9') },
    ] });
    expect(ecrit.statut).toBe(200);
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'fr-FR' });
    await tel.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const t = await tel.newPage();
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/commandef/d1`);
    await expect.poll(() => titre(t), { timeout: 20_000 }).toMatch(/^Demande de prix BCF-2026-001/);
    await plusTard(t);
    await t.locator('#cf-comparer').scrollIntoViewIfNeeded();
    expect(await t.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await t.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'demandes-prix-4-telephone.png') });
    await tel.close();
  }, 120_000);
});
