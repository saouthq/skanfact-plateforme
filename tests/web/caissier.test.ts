// Le caissier à l'écran (brique 121 ; 03 § 2.1 « Caisse » : le caissier voit sa session). Sami, caissier de l'épicerie
// de Nadia, se connecte sur la caisse du comptoir : son menu propose la Caisse (pas les Factures) ; il ouvre la caisse,
// vend une huile ; la page « Tickets et bilan du jour » montre SON ticket, jamais celui que Nadia avait encaissé avant
// lui ni ses factures ; il ferme la caisse.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le caissier à l\'écran', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-caissier-'));
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
  const net = (t: string) => t.replace(/[\s\u202f]+/g, ' ').trim();
  const annee = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' }).slice(0, 4);
  const jour = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

  it('Sami ouvre la caisse, vend, voit son ticket et pas ceux de Nadia, et ferme la caisse', async () => {
    const email = `nadia-caissier-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Bureau de Nadia', type: 'navigateur' } });
    const nadia = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', nadia, { raisonSociale: 'Épicerie Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nadia);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nadia, { changements: [
      { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 100, openingDate: '2026-01-01', isDefault: false, statementBalance: '', notes: '' } },
      { collection: 'catalog', cle: 'lait', rang: 0, revision: null, contenu: { id: 'lait', label: 'Lait demi-écrémé 1 L', unit: 'u', unitPrice: { '~n': '2.35' }, vatRate: 19 } },
      { collection: 'catalog', cle: 'huile', rang: 1, revision: null, contenu: { id: 'huile', label: 'Huile d\'olive 1 L', unit: 'u', unitPrice: { '~n': '12.5' }, vatRate: 19 } },
    ] })).statut).toBe(200);
    // Nadia avait encaissé un lait sur son bureau (une session à elle, fermée).
    const ticket = (id: string, pu: string, paye: string) => ({ id, type: 'facture', ticket: true, number: '', date: jour, clientId: '',
      lines: [{ itemId: 'lait', label: 'Lait demi-écrémé 1 L', unit: 'u', qty: 1, unitPrice: { '~n': pu }, vatRate: 19 }], discountRate: 0, applyStamp: false, stampFee: 0,
      status: 'envoyée', withholdingRate: 0, currency: 'DT', caisse: { mode: 'especes', recu: null, rendu: null },
      payments: [{ id: `p-${id}`, date: jour, amount: { '~n': paye }, method: 'especes', accountId: 'k-caisse', reference: '', note: '' }] });
    expect((await api('POST', `/entreprises/${ent}/caisse/ouvrir`, nadia, { fond: '0' })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10/ticket`, nadia, { document: ticket('t-nadia', '2.35', '2.797'), rang: 0, netAPayer: '2.797' })).corps.numero).toBe(`TIC-${annee}-001`);
    expect((await api('POST', `/entreprises/${ent}/caisse/fermer`, nadia, { compte: '2.797' })).statut).toBe(200);

    // Sami, caissier, sur la caisse du comptoir.
    const emailSami = `sami-caissier-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: emailSami, nom: 'Sami', motDePasse: 'Un-bon-mot-de-passe' });
    const sami = String((await api('POST', '/connexion', undefined, { email: emailSami, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Caisse du comptoir', type: 'navigateur' } })).corps.jeton);
    const inv = String((await api('POST', `/entreprises/${ent}/invitations`, nadia, { email: emailSami, roles: ['caissier'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', sami, { jeton: inv })).statut).toBe(200);

    // Le navigateur d'un commerçant est à l'heure de Tunis, comme le serveur : entre 23 h et minuit (UTC), un navigateur
    // à l'heure UTC daterait la caisse de la veille (CI rouge du 01/10/2026 sur 6bf2b1b).
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, sami);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
    // Son menu propose la Caisse ; pas les Factures.
    await expect.poll(() => p.locator('#nav a[data-route="caisse"]').count(), { timeout: 10_000 }).toBe(1);
    expect(await p.locator('#nav a[data-route="factures"]').count()).toBe(0);
    await p.locator('#nav a[data-route="caisse"]').click();
    await expect.poll(() => p.locator('#cs-puce, #cs-ouverte').count(), { timeout: 20_000 }).toBe(1);
    // Il vend : la page ne lui dit pas « Lecture seule ».
    expect(await p.locator('#bandeau-lecture').count()).toBe(0);
    const toast = async () => net(await p.locator('#toast').innerText().catch(() => ''));

    // Il ouvre la caisse et vend une huile.
    await expect.poll(async () => net(await p.locator('#cs-fermee').innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/^La caisse est fermée\./);
    await p.locator('#cs-fond').fill('30');
    await p.locator('#cs-ouvrir').click();
    await expect.poll(async () => net(await p.locator('#cs-ouverte').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Ouverte par Sami/);
    await p.locator('#cs-articles .cs-art', { hasText: 'Huile d\'olive' }).click();
    await p.locator('#cs-encaisser').click();
    await p.locator('#cs-valider').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-002 encaissé`);

    // Ses tickets du jour : le sien, pas celui de Nadia.
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
    await p.locator('#cs-tabs [data-tab=tickets]').click();
    await expect.poll(async () => net(await p.locator('#cs-body').innerText()), { timeout: 10_000 }).toContain(`TIC-${annee}-002`);
    expect(net(await p.locator('#cs-body').innerText())).not.toContain(`TIC-${annee}-001`);
    expect(net(await p.locator('#cs-body .stat').first().innerText())).toContain('1 ticket');
    // La session est ouverte : le bilan ne dit pas ce que le tiroir devrait contenir (il se compte à l'aveugle au Z).
    await expect.poll(async () => net(await p.locator('#cs-tiroir').innerText()), { timeout: 10_000 })
      .toBe('Le tiroir se compte à la fermeture (Z), sans voir ce qu\'il devrait contenir.');
    // Le bilan imprimé non plus.
    // (La bande s'imprime par une fenêtre du navigateur : on la lit au lieu de l'imprimer.)
    await p.evaluate(() => { const w = window as unknown as { __imprime?: string; open: unknown };
      w.open = () => ({ document: { write: (html: string) => { w.__imprime = html; }, close: () => undefined }, print: () => undefined }); });
    await p.locator('#cs-bilan-print').click();
    const imprime = await p.evaluate(() => (window as unknown as { __imprime?: string }).__imprime ?? '');
    expect(imprime).toContain('Espèces du jour');
    expect(imprime).not.toContain('Le tiroir doit contenir');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'caissier-1-ses-tickets.png') });
    // Rechargée, la page garde son ticket (il vient du serveur).
    await p.reload();
    await p.locator('#cs-tabs [data-tab=tickets]').click();
    await expect.poll(async () => net(await p.locator('#cs-body').innerText()), { timeout: 15_000 }).toContain(`TIC-${annee}-002`);
    expect(net(await p.locator('#cs-body').innerText())).not.toContain(`TIC-${annee}-001`);

    // Le soir, il ferme : 30 + 14,875 = 44,875 attendus.
    await p.locator('#cs-menu-bouton').click();
    await p.locator('#cs-fermer').click();
    await p.locator('#cs-tape summary').click();
    await p.locator('#cs-compte').fill('44.875');
    await p.locator('#cs-z').click();
    await expect.poll(async () => net(await p.locator('#modal-root #cs-z-table').innerText().catch(() => '')), { timeout: 10_000 }).toContain('Écart 0,000 DT');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'caissier-2-z.png') });
    // Après le Z, le bilan du jour redit ses chiffres : les mêmes que le Z (le fond de la session, pas le solde du compte).
    await p.locator('#modal-root #cs-z-ok').click();
    await p.locator('#cs-tabs [data-tab=tickets]').click();
    await expect.poll(async () => net(await p.locator('#cs-tiroir').innerText().catch(() => '')), { timeout: 10_000 })
      .toBe('Au Z, le tiroir devait contenir 44,875 DT ; compté : 44,875 DT.');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'caissier-3-bilan-apres-z.png') });
    // Sur une connexion lente, le bilan se dessine avant que l'état de la caisse n'arrive : il se redit ensuite.
    await p.route('**/v1/entreprises/*/caisse', async (route) => { await new Promise((ok) => setTimeout(ok, 1_500)); await route.continue(); });
    await p.reload();
    await p.locator('#cs-tabs [data-tab=tickets]').click();
    await expect.poll(async () => net(await p.locator('#cs-tiroir').innerText().catch(() => '')), { timeout: 15_000 })
      .toBe('Au Z, le tiroir devait contenir 44,875 DT ; compté : 44,875 DT.');
    await p.unroute('**/v1/entreprises/*/caisse');
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);
});
