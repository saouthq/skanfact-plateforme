// L'accord d'un responsable au-delà de l'encours (brique 100) et d'une remise (brique 103), à la souris et à deux
// (docs/accords.md) :
//   - Nadia, propriétaire, règle l'accord dans les Paramètres ;
//   - Karim, commercial, veut émettre une facture qui ferait dépasser l'encours de Chantier Ennasr : l'avertissement
//     le dit avant, le serveur refuse, l'écran propose « Demander l'accord », et la facture dit où en est la demande ;
//   - Nadia refuse depuis la facture même, avec un mot ; Karim le lit, redemande ;
//   - Nadia voit la demande sur son accueil, l'accorde depuis la page des demandes ; Karim le voit sur son accueil,
//     ouvre la facture et l'émet ; la pièce émise porte les deux noms.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('l\'accord d\'un responsable, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-accords-'));
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
  const toast = async (p: Page) => net(await p.locator('#toast').innerText().catch(() => ''));
  const bandeau = async (p: Page) => net(await p.locator('#accord-banner').innerText().catch(() => ''));
  const aujourdhui = new Date().toISOString().slice(0, 10);

  // Nadia, propriétaire (avec son code), son magasin, et Karim, commercial.
  const magasin = async () => {
    // Nadia, propriétaire (avec son code), et son magasin : Chantier Ennasr a 1 000 DT autorisés et doit déjà 799,680 DT livrés.
    const email = `nadia-accords-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Chantier Ennasr', address: 'Ennasr 2, Ariana', creditLimit: 1000 } },
      { collection: 'clients', cle: 'c2', rang: 1, revision: null, contenu: { id: 'c2', name: 'Café El Walima' } },
      { collection: 'documents', cle: 'bl1', rang: 0, revision: null, contenu: { id: 'bl1', type: 'livraison', number: 'BL-2026-001', status: 'émis', date: aujourdhui, clientId: 'c1', createdAt: 1,
        lines: [{ label: 'Ciment gris 50 kg', description: '', qty: 40, unit: 'sac', unitPrice: { '~n': '16.8' }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, payments: [] } },
    ] })).statut).toBe(200);
    // La première facture de l'entreprise (celle qui crée la série) : par Nadia, à un autre client.
    const c2 = ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { cle: string; contenu: unknown }[]).find((o) => o.cle === 'c2')?.contenu;
    expect((await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: { id: 'f0', type: 'facture', number: '', status: 'brouillon', date: aujourdhui, clientId: 'c2', createdAt: 1,
      lines: [{ label: 'Ciment gris 50 kg', description: '', qty: 1, unit: 'sac', unitPrice: 25, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] },
    client: c2, revision: null, rang: 1, netAPayer: '29.750' })).statut).toBe(200);
    // Karim, commercial.
    const karimEmail = `karim-accords-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: karimEmail, nom: 'Karim', motDePasse: 'Un-bon-mot-de-passe' });
    const karim = String((await api('POST', '/connexion', undefined, { email: karimEmail, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } })).corps.jeton);
    const invitation = String((await api('POST', `/entreprises/${ent}/invitations`, jeton, { email: karimEmail, roles: ['commercial'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', karim, { jeton: invitation })).statut).toBe(200);

    return { jeton, ent, karim };
  };

  it('Karim demande, Nadia refuse puis accorde, Karim émet', async () => {
    const { jeton, ent, karim } = await magasin();
    const erreurs: string[] = [];
    const ouvrir = async (j: string): Promise<[BrowserContext, Page]> => {
      const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
      await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, j);
      const pg1 = await cx.newPage();
      pg1.on('pageerror', (e) => erreurs.push(e.message));
      return [cx, pg1];
    };
    const [cn, n] = await ouvrir(jeton);
    const [ck, k] = await ouvrir(karim);
    const aller = async (p: Page, hash: string) => { await p.evaluate((x) => { location.hash = x; }, hash); await plusTard(p); };

    // 1. Nadia règle l'accord : Paramètres → Documents.
    await n.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await expect.poll(() => n.locator('#pf input[name=name]').count(), { timeout: 20_000 }).toBe(1);
    await plusTard(n);
    await n.locator('#set-tabs button[data-tab=documents]').click();
    const caseAccord = n.locator('#pf input[name=encoursAccord]');
    await expect.poll(() => caseAccord.isVisible(), { timeout: 10_000 }).toBe(true);
    expect(await caseAccord.isDisabled()).toBe(false);
    await caseAccord.check();
    await n.locator('#save-bar #save').click();
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { cle: string; contenu: Record<string, unknown> }[])
      .find((o) => o.cle === 'company')?.contenu.encoursAccord, { timeout: 10_000 }).toBe(true);
    await n.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'accords-1-reglage.png') });

    // 2. Karim : une facture de 357 DT pour Chantier Ennasr ; l'avertissement dit l'accord avant le geste.
    await k.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/new/facture`);
    await expect.poll(() => titre(k), { timeout: 20_000 }).toMatch(/^Nouvelle facture|^Facture/);
    await plusTard(k);
    await k.locator('[data-combo=clientId] .combo-btn').click();
    await k.locator('[data-combo=clientId] .combo-q').fill('Ennasr');
    await k.locator('[data-combo=clientId] .combo-list [role=option]').first().click();
    await k.locator('[data-k=label]').first().fill('Ciment gris 50 kg');
    await k.locator('[data-k=qty]').first().fill('12');
    await k.locator('[data-k=unitPrice]').first().fill('25');
    await k.locator('input[name=applyStamp]').uncheck();
    await k.locator('#save').click();
    await expect.poll(() => toast(k), { timeout: 10_000 }).toBe('Brouillon enregistré');
    const emettre = async () => {
      await k.locator('#issue').click();
      await expect.poll(() => k.locator('#modal-root #ok').count(), { timeout: 10_000 }).toBe(1);
      const avertissement = net(await k.locator('#modal-root').innerText());
      await k.locator('#modal-root #ok').click();
      return avertissement;
    };
    expect(await emettre()).toContain('Au-delà, une facture demande l\'accord du propriétaire ou d\'un administrateur : en l\'émettant, tu pourras le lui demander.');
    // Le serveur refuse, avec ses chiffres ; l'écran propose de demander l'accord.
    await expect.poll(() => k.locator('#modal-root #accord-question').count(), { timeout: 10_000 }).toBe(1);
    expect(net(await k.locator('#modal-root').innerText())).toContain('Chantier Ennasr dépasserait son encours autorisé de 156,680 DT (799,680 DT déjà dus, 357,000 DT pour cette facture, 1 000,000 DT autorisés)');
    await k.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'accords-2-demander.png') });
    await k.locator('#modal-root #a').click();
    await expect.poll(() => toast(k), { timeout: 10_000 }).toBe('Accord demandé à Nadia : la facture reste en brouillon, tu l\'émettras dès qu\'il sera donné.');
    await expect.poll(() => bandeau(k), { timeout: 10_000 }).toMatch(/^Accord demandé le .* \(357,000 DT pour cette facture, 799,680 DT déjà dus, 1 000,000 DT autorisés\) : en attente du propriétaire ou d'un administrateur\./);
    const pieceId = decodeURIComponent(k.url().split('#/doc/')[1] ?? '');
    expect(pieceId).not.toBe('');
    await k.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'accords-3-en-attente.png') });

    // 3. Nadia ouvre la facture : la demande et ses deux gestes. Elle refuse, avec un mot.
    // (Nadia ouvre l'application : la facture de Karim, faite depuis, y est.)
    await n.evaluate((x) => { location.hash = x; }, `#/doc/${pieceId}`);
    await n.reload();
    await expect.poll(() => titre(n), { timeout: 20_000 }).toMatch(/^Facture/);
    await plusTard(n);
    await expect.poll(() => bandeau(n), { timeout: 10_000 }).toMatch(/^Karim demande ton accord pour émettre cette facture/);
    await n.locator('#accord-banner [data-accord-refuser]').click();
    await n.locator('#modal-root #ac-motif').fill('Qu\'il règle d\'abord le bon de livraison');
    await n.locator('#modal-root #ac-ok').click();
    await expect.poll(() => toast(n), { timeout: 10_000 }).toBe('Refusé : la facture reste en brouillon.');
    await expect.poll(() => bandeau(n), { timeout: 10_000 }).toMatch(/^Refusé par Nadia le .* : « Qu'il règle d'abord le bon de livraison »\./);

    // 4. Karim le lit sur sa facture, et redemande (le serveur refuse encore : le refus compte).
    await k.reload();
    await expect.poll(() => bandeau(k), { timeout: 20_000 }).toMatch(/^Refusé par Nadia le .* : « Qu'il règle d'abord le bon de livraison »\. La facture reste en brouillon/);
    await plusTard(k);
    await emettre();
    await expect.poll(() => k.locator('#modal-root #accord-question').count(), { timeout: 10_000 }).toBe(1);
    await k.locator('#modal-root #a').click();
    await expect.poll(() => bandeau(k), { timeout: 10_000 }).toMatch(/^Accord demandé le /);

    // 5. Nadia : son accueil le dit ; la page des demandes ; elle accorde.
    await aller(n, '#/dashboard');
    await expect.poll(async () => net(await n.locator('#accords-accueil').innerText()), { timeout: 10_000 })
      .toMatch(/^Une demande d'accord attend ta décision : Karim voudrait émettre une facture de 357,000 DT pour Chantier Ennasr, au-delà de son encours autorisé\./);
    await n.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'accords-4-accueil-responsable.png') });
    await n.locator('#accords-voir').click();
    await expect.poll(() => titre(n), { timeout: 10_000 }).toMatch(/^Demandes d'accord/);
    const enAttente = n.locator('#view tr', { has: n.locator('[data-accord-accorder]') });
    await expect.poll(() => enAttente.count(), { timeout: 10_000 }).toBe(1);
    expect(net(await n.locator('#view tbody').innerText())).toContain('Qu\'il règle d\'abord le bon de livraison');
    await enAttente.locator('[data-accord-accorder]').click();
    await expect.poll(() => toast(n), { timeout: 10_000 }).toBe('Accordé : la facture peut maintenant être émise.');
    await expect.poll(() => n.locator('[data-accord-accorder]').count(), { timeout: 10_000 }).toBe(0);
    expect(net(await n.locator('#view tbody tr').first().innerText())).toMatch(/Accordée par Nadia le /);
    await n.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'accords-5-liste.png') });

    // 6. Karim : son accueil le dit ; il ouvre la facture et l'émet. La pièce porte les deux noms.
    await aller(k, '#/dashboard');
    await expect.poll(async () => net(await k.locator('#accords-accueil').innerText()), { timeout: 10_000 })
      .toMatch(/^Nadia a accordé ta facture pour Chantier Ennasr : tu peux l'émettre\./);
    await k.locator('#accords-ouvrir').click();
    await expect.poll(() => bandeau(k), { timeout: 10_000 }).toMatch(/^Accordé par Nadia le .*, pour 357,000 DT : la facture peut être émise\./);
    expect(await emettre()).toContain('Nadia l\'a accordé : tu peux l\'émettre.');
    await expect.poll(() => titre(k), { timeout: 20_000 }).toMatch(/^Facture FAC-\d{4}-002/);
    await k.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'accords-6-emise.png') });
    const emise = ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { cle: string; contenu: Record<string, unknown> }[]).find((o) => o.cle === pieceId)?.contenu;
    expect(emise?.accordEncours).toMatchObject({ demandePar: 'Karim', accordePar: 'Nadia' });

    expect(erreurs).toEqual([]);
    await cn.close(); await ck.close();
  }, 180_000);
  // La remise au-delà d'un seuil (brique 103).
  it('Nadia règle la remise permise ; Karim remise au-delà, demande, Nadia accorde depuis la facture, Karim émet', async () => {
    const { jeton, ent, karim } = await magasin();
    const erreurs: string[] = [];
    const ouvrir = async (j: string): Promise<[BrowserContext, Page]> => {
      const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
      await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, j);
      const pg1 = await cx.newPage();
      pg1.on('pageerror', (e) => erreurs.push(e.message));
      return [cx, pg1];
    };
    const [cn, n] = await ouvrir(jeton);
    const [ck, k] = await ouvrir(karim);

    // 1. Nadia : 10 % de remise permis sans accord.
    await n.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await expect.poll(() => n.locator('#pf input[name=name]').count(), { timeout: 20_000 }).toBe(1);
    await plusTard(n);
    await n.locator('#set-tabs button[data-tab=documents]').click();
    await n.locator('#pf input[name=remiseAccordAuDela]').fill('10');
    await n.locator('#save-bar #save').click();
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { cle: string; contenu: Record<string, unknown> }[])
      .find((o) => o.cle === 'company')?.contenu.remiseAccordAuDela, { timeout: 10_000 }).toBe(10);

    // 2. Karim : une facture pour Café El Walima, remise de 15 %. L'avertissement le dit, le serveur refuse, il demande.
    await k.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/new/facture`);
    await expect.poll(() => titre(k), { timeout: 20_000 }).toMatch(/^Nouvelle facture|^Facture/);
    await plusTard(k);
    await k.locator('[data-combo=clientId] .combo-btn').click();
    await k.locator('[data-combo=clientId] .combo-q').fill('Walima');
    await k.locator('[data-combo=clientId] .combo-list [role=option]').first().click();
    await k.locator('[data-k=label]').first().fill('Ciment gris 50 kg');
    await k.locator('[data-k=qty]').first().fill('12');
    await k.locator('[data-k=unitPrice]').first().fill('25');
    await k.locator('input[name=discountRate]').fill('15');
    await k.locator('input[name=applyStamp]').uncheck();
    await k.locator('#save').click();
    await expect.poll(() => toast(k), { timeout: 10_000 }).toBe('Brouillon enregistré');
    const emettre = async () => {
      await k.locator('#issue').click();
      await expect.poll(() => k.locator('#modal-root #ok').count(), { timeout: 10_000 }).toBe(1);
      const avertissement = net(await k.locator('#modal-root').innerText());
      await k.locator('#modal-root #ok').click();
      return avertissement;
    };
    expect(await emettre()).toContain('La remise de 15 % dépasse les 10 % permis sans accord : en l\'émettant, tu pourras demander l\'accord du propriétaire ou d\'un administrateur.');
    await expect.poll(() => k.locator('#modal-root #accord-question').count(), { timeout: 10_000 }).toBe(1);
    expect(net(await k.locator('#modal-root').innerText())).toContain('Café El Walima : la remise de 15 % dépasse les 10 % permis sans accord');
    await k.locator('#modal-root #a').click();
    await expect.poll(() => bandeau(k), { timeout: 10_000 }).toMatch(/^Accord demandé le .* \(une remise de 15 % \(10 % permis sans accord\)\) : en attente/);
    const pieceId = decodeURIComponent(k.url().split('#/doc/')[1] ?? '');

    // 3. Nadia ouvre la facture et accorde.
    await n.evaluate((x) => { location.hash = x; }, `#/doc/${pieceId}`);
    await n.reload();
    await expect.poll(() => titre(n), { timeout: 20_000 }).toMatch(/^Facture/);
    await plusTard(n);
    await expect.poll(() => bandeau(n), { timeout: 10_000 }).toMatch(/^Karim demande ton accord pour émettre cette facture avec une remise de 15 % \(10 % permis sans accord\)\./);
    await n.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'accords-7-remise-demandee.png') });
    await n.locator('#accord-banner [data-accord-accorder]').click();
    await expect.poll(() => bandeau(n), { timeout: 10_000 }).toMatch(/^Remise accordée par Nadia le .*, jusqu'à 15 % : la facture peut être émise\./);

    // 4. Karim émet : l'avertissement le dit accordé ; la pièce porte les deux noms.
    await k.reload();
    await expect.poll(() => bandeau(k), { timeout: 20_000 }).toMatch(/^Remise accordée par Nadia/);
    await plusTard(k);
    expect(await emettre()).toContain('Nadia a accordé cette remise de 15 % : tu peux l\'émettre.');
    await expect.poll(() => titre(k), { timeout: 20_000 }).toMatch(/^Facture FAC-\d{4}-002/);
    await k.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'accords-8-remise-emise.png') });
    const emise = ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { cle: string; contenu: Record<string, unknown> }[]).find((o) => o.cle === pieceId)?.contenu;
    expect(emise?.accordRemise).toMatchObject({ demandePar: 'Karim', accordePar: 'Nadia', taux: 15 });

    // 5. Un prix baissé sous le catalogue est une remise aussi (brique 104) : l'avertissement le dit, par la ligne.
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'catalog', cle: 'ciment', rang: 0, revision: null,
      contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', unitPrice: 25, vatRate: 19 } }] })).statut).toBe(200);
    await k.evaluate(() => { location.hash = '#/doc/new/facture'; });
    await k.reload();
    await expect.poll(() => titre(k), { timeout: 20_000 }).toMatch(/^Nouvelle facture|^Facture/);
    await plusTard(k);
    await k.locator('[data-combo=clientId] .combo-btn').click();
    await k.locator('[data-combo=clientId] .combo-q').fill('Walima');
    await k.locator('[data-combo=clientId] .combo-list [role=option]').first().click();
    await k.locator('#cat-pick .combo-btn').click();
    await k.locator('#cat-pick .combo-q').fill('Ciment');
    await k.locator('#cat-pick .combo-list [role=option]').first().click();
    await expect.poll(async () => k.locator('[data-k=unitPrice]').count(), { timeout: 5_000 }).toBeGreaterThan(0);
    const prix = k.locator('[data-k=unitPrice]');
    const n0 = await prix.count();
    await prix.nth(n0 - 1).fill('20');
    await k.locator('[data-k=qty]').nth(n0 - 1).fill('12');
    await k.locator('input[name=applyStamp]').uncheck();
    await k.locator('#save').click();
    await expect.poll(() => toast(k), { timeout: 10_000 }).toBe('Brouillon enregistré');
    await k.locator('#issue').click();
    await expect.poll(() => k.locator('#modal-root #ok').count(), { timeout: 10_000 }).toBe(1);
    expect(net(await k.locator('#modal-root').innerText())).toContain('« Ciment gris 50 kg » est vendu 20 % sous son prix, au-delà des 10 % permis sans accord : en l\'émettant, tu pourras demander l\'accord du propriétaire ou d\'un administrateur.');
    expect(erreurs).toEqual([]);
    await cn.close(); await ck.close();
  }, 180_000);
});
