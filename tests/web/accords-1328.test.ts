// (1.328.0) L'accord qui suit la pièce, à la souris et à deux (docs/accords.md ; docs/revue-modules.md) :
//   - Karim, commercial : une facture au-delà de l'encours de son client. Le bouton vert DEMANDE l'accord, en une question,
//     sans confirmer d'abord une émission qui ne peut pas avoir lieu ;
//   - il fait grossir la facture APRÈS sa demande : pendant la frappe, le bouton, la pastille et le bandeau disent que
//     l'accord ne couvrirait que l'ancien montant ; Nadia, propriétaire, ne peut pas accorder l'ancien ;
//   - il redemande : le serveur ne montre que la dernière demande, et refuse qu'on décide la remplacée ;
//   - la facture redescend sous le plafond : elle s'émet sans accord, la demande n'a plus d'objet nulle part.

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

describe('l\'accord qui suit la pièce (1.328.0)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-accords-'));
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

  it('Karim fait grossir sa facture après sa demande : l\'écran le dit, il redemande en une question ; Nadia ne peut pas accorder l\'ancien montant ; la facture redescendue s\'émet sans accord', async () => {
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
    const geste = async () => net(await k.locator('#issue').innerText().catch(() => ''));
    const pastille = async () => net(await k.locator('#view .ed-pill').innerText().catch(() => ''));
    const demandes = async () => ((await api('GET', `/entreprises/${ent}/accords`, jeton)).corps.accords as { id: string; statut: string; montant: number; piece: string }[]);
    const pieceServeur = async (cle: string) => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { cle: string; contenu: Record<string, unknown> }[])
      .find((o) => o.cle === cle)?.contenu;

    // 1. Nadia règle l'accord au-delà de l'encours.
    await n.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await expect.poll(() => n.locator('#pf input[name=name]').count(), { timeout: 20_000 }).toBe(1);
    await plusTard(n);
    await n.locator('#set-tabs button[data-tab=documents]').click();
    await n.locator('#pf input[name=encoursAccord]').check();
    await n.locator('#save-bar #save').click();
    await expect.poll(async () => (await pieceServeur('company'))?.encoursAccord, { timeout: 10_000 }).toBe(true);

    // 2. Karim : 12 sacs à 25 DT pour Chantier Ennasr (357 DT), qui doit déjà 799,680 DT pour 1 000 DT autorisés. Le bouton
    //    vert DEMANDE l'accord, la pastille le dit, et la demande se fait en une question.
    await k.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/new/facture`);
    await expect.poll(() => titre(k), { timeout: 20_000 }).toMatch(/^Nouvelle facture|^Facture/);
    await plusTard(k);
    await k.locator('#ed-pq-q:visible, #ed-client:visible').first().waitFor({ timeout: 20_000 });
    if (await k.locator('#ed-pq-q').isVisible()) {
      await k.locator('#ed-pq-q').fill('Ennasr');
      await k.locator('#ed-pq-liste [role=option][data-cl]').first().click();
    }
    if (!(await k.locator('[data-k=label]').count()) && await k.locator('#ed-ajout').count()) await k.locator('#ed-ajout').press('Enter');
    await k.locator('[data-k=label]').first().fill('Ciment gris 50 kg');
    await k.locator('[data-k=qty]').first().fill('12');
    await k.locator('[data-k=unitPrice]').first().fill('25');
    await k.locator('[data-etq=timbre]').click(); await k.locator('[data-tb="0"]').click();
    await k.locator('#save').click();
    await expect.poll(() => toast(k), { timeout: 10_000 }).toBe('Brouillon enregistré');
    await expect.poll(geste, { timeout: 10_000 }).toBe('Demander l\'accord');
    expect(await pastille()).toBe('Brouillon · accord à demander');
    await k.locator('#issue').click();
    await expect.poll(() => k.locator('#modal-root #accord-question').count(), { timeout: 10_000 }).toBe(1);
    expect(await k.locator('#modal-root #ok').count()).toBe(0);
    expect(net(await k.locator('#modal-root').innerText())).toContain('Chantier Ennasr dépasserait son encours autorisé de 156,680 DT (799,680 DT déjà dus, 357,000 DT pour cette facture, 1 000,000 DT autorisés)');
    await k.locator('#modal-root #a').click();
    await expect.poll(() => bandeau(k), { timeout: 10_000 }).toMatch(/^Accord demandé le .* \(357,000 DT pour cette facture/);
    await expect.poll(geste, { timeout: 10_000 }).toBe('Accord demandé');
    expect(await pastille()).toBe('Brouillon · accord demandé');
    const pieceId = decodeURIComponent(k.url().split('#/doc/')[1] ?? '');
    expect(pieceId).not.toBe('');
    // La demande attendait la pièce sur le serveur : elle se lit tout de suite (une pièce pas encore écrite la cachait).
    const premiere = (await demandes()).filter((a) => a.statut === 'en_attente');
    expect(premiere.map((a) => a.montant)).toEqual([357000]);

    // 3. Karim passe à 20 sacs (595 DT) APRÈS sa demande : pendant la frappe, le bouton devient « Redemander l'accord », la
    //    pastille et le bandeau disent que l'accord ne couvrirait que l'ancien montant. Le curseur reste dans la quantité.
    await k.locator('[data-k=qty]').first().fill('20');
    await expect.poll(geste, { timeout: 10_000 }).toBe('Redemander l\'accord');
    expect(await k.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.k)).toBe('qty');
    expect(await pastille()).toBe('Brouillon · accord à redemander');
    expect(await bandeau(k)).toMatch(/la facture a changé depuis \(595,000 DT aujourd'hui\), l'accord n'en couvrirait que l'ancien montant\. Redemande-le\./);
    expect(net(await k.locator('#ed-geste').innerText())).toContain('elle demandait 357,000 DT, elle en fait 595,000 DT');
    await expect.poll(async () => JSON.stringify(((await pieceServeur(pieceId))?.lines as { qty: unknown }[] | undefined)?.map((l) => l.qty)), { timeout: 10_000 }).toBe('[20]');

    // 4. Nadia, qui ouvre l'application ensuite : la fenêtre de la demande dit le montant d'aujourd'hui, et ne propose PAS
    //    d'accorder l'ancien (la facture ne s'émettrait pas) : « Ouvrir la facture » passe devant.
    await n.evaluate(() => { location.hash = '#/dashboard'; });
    await n.reload();
    await plusTard(n);
    await expect.poll(() => n.locator('#accords-decider').count(), { timeout: 20_000 }).toBe(1);
    await n.locator('#accords-decider').click();
    const fen = n.locator('.modal').filter({ hasText: 'Karim demande ton accord' });
    await expect.poll(async () => net(await fen.innerText().catch(() => '')), { timeout: 10_000 }).toContain('Aujourd\'hui 595,000 DT : elle a changé depuis sa demande');
    expect(await fen.locator('#fa-accorder').count()).toBe(0);
    expect(net(await fen.locator('.btn-primary').innerText())).toBe('Ouvrir la facture');
    await fen.getByRole('button', { name: 'Plus tard' }).click();

    // 5. Karim redemande, en une question : la nouvelle demande remplace l'ancienne. Le serveur n'en montre qu'une, et refuse
    //    qu'on décide l'ancienne.
    await k.locator('#issue').click();
    await expect.poll(() => k.locator('#modal-root #accord-question').count(), { timeout: 10_000 }).toBe(1);
    expect(net(await k.locator('#modal-root').innerText())).toContain('Ta facture a changé depuis ta demande du');
    await k.locator('#modal-root #a').click();
    await expect.poll(() => bandeau(k), { timeout: 10_000 }).toMatch(/^Accord demandé le .* \(595,000 DT pour cette facture/);
    await expect.poll(async () => (await demandes()).filter((a) => a.statut === 'en_attente').map((a) => a.montant), { timeout: 10_000 }).toEqual([595000]);
    const derniere = (await demandes()).find((a) => a.statut === 'en_attente');
    const ancienne = await api('POST', `/entreprises/${ent}/accords/${premiere[0]?.id}/decider`, jeton, { decision: 'accorder' });
    expect(ancienne.statut).toBe(403);
    expect(String(ancienne.corps.motif)).toContain('remplacée par une plus récente');

    // 6. Karim redescend à 6 sacs (178,500 DT) : sous les 1 000 DT, plus d'accord à attendre. Le bouton redevient « Émettre »,
    //    le bandeau le dit ; Nadia ne voit plus de décision à prendre.
    await k.locator('[data-k=qty]').first().fill('6');
    await expect.poll(geste, { timeout: 10_000 }).toBe('Émettre la facture');
    expect(await bandeau(k)).toMatch(/^Plus d'accord à attendre : la facture est revenue dans l'encours autorisé du client, elle s'émet sans lui\./);
    await expect.poll(async () => JSON.stringify(((await pieceServeur(pieceId))?.lines as { qty: unknown }[] | undefined)?.map((l) => l.qty)), { timeout: 10_000 }).toBe('[6]');
    await n.reload();
    await plusTard(n);
    await aller(n, '#/dashboard');
    await expect.poll(() => n.locator('#view h1').count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await n.waitForTimeout(1_500);
    expect(await n.locator('#accords-attente').count()).toBe(0);

    // 7. Karim l'émet : le récapitulatif ne parle plus d'encours. Émise, la demande n'a plus d'objet : le serveur ne la montre
    //    plus, et refuse qu'on la décide.
    await k.locator('#issue').click();
    await expect.poll(() => k.locator('#modal-root #ok').count(), { timeout: 10_000 }).toBe(1);
    expect(net(await k.locator('#modal-root').innerText())).not.toContain('encours');
    await k.locator('#modal-root #ok').click();
    await expect.poll(() => titre(k), { timeout: 20_000 }).toMatch(/^FAC-\d{4}-002/);
    const restantes = (await demandes()).filter((a) => a.statut === 'en_attente');
    expect(restantes).toEqual([]);
    const sansObjet = await api('POST', `/entreprises/${ent}/accords/${derniere?.id}/decider`, jeton, { decision: 'refuser' });
    expect(sansObjet.statut).toBe(403);
    expect(String(sansObjet.corps.motif)).toContain('n\'a plus d\'objet');

    expect(erreurs).toEqual([]);
    await cn.close(); await ck.close();
  }, 180_000);
});
