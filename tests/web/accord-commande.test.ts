// L'accord d'un responsable au-delà d'une commande fournisseur (brique 114 ; docs/accords.md), à la souris et à deux :
//   - Nadia, propriétaire, règle le montant permis sans accord (1 000 DT) dans les Paramètres ;
//   - Ines, comptable interne, prépare une commande de 1 025,750 DT HT : la page le dit avant le geste ; « Envoyée »
//     puis Enregistrer : la commande reste en brouillon et l'écran propose « Demander l'accord » ;
//   - Nadia voit la demande sur son accueil, la retrouve dans « Demandes d'accord », ouvre la commande et accorde ;
//   - Ines rouvre sa commande : « Marquer envoyée » la fait partir, et le serveur l'a.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('l\'accord au-delà d\'une commande fournisseur, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-accord-commande-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); fs.rmSync(dossier, { recursive: true, force: true }); });

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

  it('Ines demande, Nadia accorde depuis son accueil, Ines envoie la commande', async () => {
    // Nadia, propriétaire (avec son code), son magasin et son fournisseur.
    const email = `nadia-accord-commande-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Béton du Nord', address: 'Zone industrielle, Bizerte' } },
    ] })).statut).toBe(200);
    // Ines, comptable interne : elle écrit les commandes fournisseurs.
    const inesEmail = `ines-accord-commande-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: inesEmail, nom: 'Ines', motDePasse: 'Un-bon-mot-de-passe' });
    const ines = String((await api('POST', '/connexion', undefined, { email: inesEmail, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } })).corps.jeton);
    const invitation = String((await api('POST', `/entreprises/${ent}/invitations`, jeton, { email: inesEmail, roles: ['comptabilite_interne'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', ines, { jeton: invitation })).statut).toBe(200);
    const commandeDuServeur = async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; contenu: Record<string, unknown> }[])
      .find((o) => o.collection === 'supplierOrders')?.contenu;

    const erreurs: string[] = [];
    const ouvrir = async (j: string): Promise<[BrowserContext, Page]> => {
      const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
      await cx.addInitScript((x) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', x); }, j);
      const p = await cx.newPage();
      p.on('pageerror', (e) => erreurs.push(e.message));
      return [cx, p];
    };
    const [cn, n] = await ouvrir(jeton);
    const [ci, i] = await ouvrir(ines);

    // 1. Nadia règle le montant permis sans accord : Paramètres → Documents.
    await n.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await expect.poll(() => n.locator('#pf input[name=name]').count(), { timeout: 20_000 }).toBe(1);
    await plusTard(n);
    await n.locator('#set-tabs button[data-tab=documents]').click();
    const seuil = n.locator('#pf input[name=commandeAccordAuDela]');
    await expect.poll(() => seuil.isVisible(), { timeout: 10_000 }).toBe(true);
    await seuil.fill('1000');
    await n.locator('#save-bar #save').click();
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { cle: string; contenu: Record<string, unknown> }[])
      .find((o) => o.cle === 'company')?.contenu.commandeAccordAuDela, { timeout: 10_000 }).toBe(1000);
    await seuil.scrollIntoViewIfNeeded();
    await n.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'accord-commande-1-reglage.png') });

    // 2. Ines prépare la commande : 40 sacs à 16,875 et le transport à 350,750 = 1 025,750 DT HT.
    await i.goto(`${serveur.adresse}/v10/?e=${ent}#/commandef/new`);
    await expect.poll(() => titre(i), { timeout: 20_000 }).toMatch(/^Nouvelle commande fournisseur/);
    await plusTard(i);
    await i.locator('[data-combo=supplierId] .combo-btn').click();
    await i.locator('[data-combo=supplierId] .combo-q').fill('Béton');
    await i.locator('[data-combo=supplierId] .combo-list [role=option]').first().click();
    const ligne = (x: number, k: string) => i.locator(`#cf-lines [data-k=${k}][data-i="${x}"]`);
    await ligne(0, 'label').fill('Ciment gris 50 kg');
    await ligne(0, 'qty').fill('40');
    await ligne(0, 'unitPrice').fill('16.875');
    await i.locator('#cf-add').click();
    await ligne(1, 'label').fill('Transport');
    await ligne(1, 'unitPrice').fill('350.75');
    // Avant le geste, la page dit le seuil.
    await expect.poll(async () => net(await i.locator('#cf-accord').innerText()), { timeout: 10_000 })
      .toBe('Cette commande fait 1 025,750 DT hors taxes, au-delà des 1 000,000 DT permis sans accord : elle ne part (« Envoyée ») qu\'avec l\'accord du propriétaire ou d\'un administrateur. En l\'enregistrant, tu pourras le demander. i');
    await i.locator('#cf-head select[name=status]').selectOption('envoyée');
    await i.locator('#save').click();
    // Elle reste en brouillon ; l'écran propose de demander l'accord.
    await expect.poll(() => i.locator('#modal-root #accord-question').count(), { timeout: 10_000 }).toBe(1);
    expect(net(await i.locator('#modal-root').innerText())).toContain('La commande BCF-');
    expect(net(await i.locator('#modal-root').innerText())).toContain('fait 1 025,750 DT hors taxes, au-delà des 1 000,000 DT permis sans accord : elle ne part pas encore.');
    expect((await commandeDuServeur())?.status).toBe('brouillon');
    await i.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'accord-commande-2-demander.png') });
    await i.locator('#modal-root #a').click();
    await expect.poll(() => toast(i), { timeout: 10_000 }).toBe('Accord demandé à Nadia : la commande partira dès qu\'il sera donné.');
    await expect.poll(() => bandeau(i), { timeout: 10_000 }).toMatch(/^Accord demandé le .* \(1 025,750 DT hors taxes, 1 000,000 DT permis sans accord\) : en attente du propriétaire ou d'un administrateur\./);
    const commandeId = String((await commandeDuServeur())?.id ?? '');
    expect(commandeId).not.toBe('');

    // 3. Nadia : son accueil dit la demande ; la page des demandes la montre ; elle ouvre la commande et accorde.
    await n.evaluate(() => { location.hash = '#/dashboard'; });
    await n.reload();
    await plusTard(n);
    await expect.poll(async () => net(await n.locator('#accords-attente').innerText().catch(() => '')), { timeout: 20_000 })
      .toContain('Une demande d\'accord attend ta décision : Ines voudrait envoyer à Béton du Nord une commande de 1 025,750 DT hors taxes (1 000,000 DT permis sans accord).');
    await n.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'accord-commande-3-accueil.png') });
    await n.locator('#accords-voir').click();
    await expect.poll(async () => net(await n.locator(`tr[data-accord]`).first().innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/BCF-\d{4}-001 Béton du Nord 1 025,750 DT HT — 1 000,000 DT sans accord Ines Refuser… Accorder/);
    await n.locator('tr[data-accord] a').first().click();
    await expect.poll(() => titre(n), { timeout: 10_000 }).toMatch(/^Commande BCF-/);
    await expect.poll(() => bandeau(n), { timeout: 10_000 }).toBe('Ines demande ton accord pour envoyer cette commande : 1 025,750 DT hors taxes, 1 000,000 DT permis sans accord. i Refuser… Accorder');
    await n.locator('#accord-banner [data-accord-accorder]').click();
    await expect.poll(() => toast(n), { timeout: 10_000 }).toBe('Accordé : la commande peut maintenant partir.');

    // 4. Ines rouvre sa commande : accordée ; « Marquer envoyée » la fait partir.
    await i.reload();
    await plusTard(i);
    await expect.poll(() => bandeau(i), { timeout: 20_000 }).toMatch(/^Accordée par Nadia le .*, pour 1 025,750 DT hors taxes : la commande peut partir\. Si elle grossit, l'accord est à redemander\. i Marquer envoyée$/);
    // Accordée : l'avertissement sous les totaux se tait (la page a relu les demandes).
    await expect.poll(async () => net(await i.locator('#cf-accord').innerText()), { timeout: 10_000 }).toBe('');
    await i.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'accord-commande-4-accordee.png') });
    await i.locator('#accord-banner #cf-envoyer').click();
    await expect.poll(async () => (await commandeDuServeur())?.status, { timeout: 10_000 }).toBe('envoyée');
    await expect.poll(() => bandeau(i), { timeout: 10_000 }).toMatch(/: la commande est partie\./);
    expect(commandeId).toBe(String((await commandeDuServeur())?.id));
    await cn.close(); await ci.close();
    expect(erreurs).toEqual([]);
  }, 240_000);
});
