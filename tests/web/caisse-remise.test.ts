// La remise à la caisse, à l'écran (brique 125 ; 03 § 2.1 ; docs/caisse.md, M1 à M4). Au comptoir, Sami remise trois
// pains de 10 % : la ligne de remise se lit, le total suit ; une remise de 120 % ne s'encaisse pas, et le dit. Au-delà du
// plafond (0 % par défaut), « Encaisser » demande d'abord le code d'un responsable présent : tant qu'aucun n'a posé le
// sien, la fenêtre le dit et « Approuver » reste gris ; ensuite un code faux ne vend rien, celui de Nadia, si, et le
// ticket imprimé dit sa remise. Puis Nadia règle 15 % dans Paramètres → Caisse : Sami remise 10 % sans code.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('la remise à la caisse, à l\'écran', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-remise-'));
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
  const plusTard = async (p: Page) => { for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined); };
  const ouvrir = async (jeton: string, ent: string) => {
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/caisse`);
    await expect.poll(() => p.locator('#cs-articles .cs-art').count(), { timeout: 20_000 }).toBe(1);
    await plusTard(p);
    return { cx, p, erreurs };
  };

  it('Sami remise 10 % avec le code de Nadia ; sous le plafond qu\'elle règle, sans code', async () => {
    const email = `nadia-remise-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Bureau de Nadia', type: 'navigateur' } });
    const nadia = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', nadia, { raisonSociale: 'Boulangerie Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nadia);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nadia, { changements: [
      { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 0, openingDate: '2026-01-01', isDefault: false, statementBalance: '', notes: '' } },
      { collection: 'catalog', cle: 'pain', rang: 0, revision: null, contenu: { id: 'pain', label: 'Pain de mie', unit: 'u', unitPrice: { '~n': '1.2' }, vatRate: 7 } },
    ] })).statut).toBe(200);
    const emailSami = `sami-remise-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: emailSami, nom: 'Sami', motDePasse: 'Un-bon-mot-de-passe' });
    const sami = String((await api('POST', '/connexion', undefined, { email: emailSami, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Caisse du comptoir', type: 'navigateur' } })).corps.jeton);
    const inv = String((await api('POST', `/entreprises/${ent}/invitations`, nadia, { email: emailSami, roles: ['caissier'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', sami, { jeton: inv })).statut).toBe(200);

    // Sami ouvre la caisse et met trois pains dans le panier.
    const comptoir = await ouvrir(sami, ent);
    const p = comptoir.p;
    await expect.poll(async () => net(await p.locator('#cs-fermee').innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/^La caisse est fermée\./);
    await p.locator('#cs-fond').fill('20');
    await p.locator('#cs-ouvrir').click();
    await expect.poll(async () => net(await p.locator('#cs-ouverte').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Caisse ouverte par Sami/);
    for (let i = 0; i < 3; i++) await p.locator('#cs-articles .cs-art', { hasText: 'Pain de mie' }).click();
    const totaux = async () => net(await p.locator('#cs-ticket .cs-totaux').innerText());
    const toast = async () => net(await p.locator('#toast').innerText().catch(() => ''));
    // Sans remise, la place de sa ligne est gardée : « Encaisser » ne bougera pas quand elle apparaîtra.
    const avant = await p.locator('#cs-encaisser').boundingBox();
    // 120 % : refusé avant le geste, et dit.
    await p.locator('#cs-remise').fill('120');
    await p.locator('#cs-remise').press('Tab');
    await expect.poll(async () => net(await p.locator('#cs-motif').innerText()), { timeout: 5_000 }).toBe('La remise est un pourcentage entre 0 et 100 : tape-la comme 10 ou 7,5.');
    expect(await p.locator('#cs-encaisser').isDisabled()).toBe(true);
    // 10 % : la remise se lit en TTC, comme les lignes (3,852 − 0,385 = 3,467 TTC ; 3,240 HT), « Encaisser » n'a pas bougé.
    // Le champ de la remise ne colle pas à celui du reçu.
    const recu = await p.locator('#cs-ticket .cs-recu').boundingBox(), champ = await p.locator('#cs-ticket .cs-remise').boundingBox();
    expect((champ?.y ?? 0) - ((recu?.y ?? 0) + (recu?.height ?? 0))).toBeGreaterThanOrEqual(8);
    await p.locator('#cs-remise').fill('10');
    await p.locator('#cs-remise').press('Tab');
    await expect.poll(totaux, { timeout: 5_000 }).toMatch(/^Remise 10 % − 0,385 DT Total HT 3,240 DT TVA 0,227 DT Total TTC 3,467 DT$/);
    expect((await p.locator('#cs-encaisser').boundingBox())?.y).toBe(avant?.y);
    // « Encaisser » : au-delà de 0 %, le code d'un responsable présent, demandé AVANT. Aucun n'a posé le sien : la
    // fenêtre le dit, « Approuver » reste gris.
    await p.locator('#cs-encaisser').click();
    await expect.poll(async () => net(await p.locator('#modal-root #rd-sans-responsable').innerText().catch(() => '')), { timeout: 10_000 })
      .toBe('Une remise au-delà de celle permise sans code se fait avec le code d\'un responsable présent, et aucun n\'a encore posé le sien : le propriétaire ou un administrateur le pose depuis la page Caisse, avec « Mon code de responsable… ».');
    expect(await p.locator('#modal-root #rs-ok').isDisabled()).toBe(true);
    await p.locator('#modal-root [data-close]').click();
    // Nadia pose son code : seule responsable, elle est déjà choisie.
    expect((await api('PUT', `/entreprises/${ent}/caisse/code-responsable`, nadia, { code: '1357' })).statut).toBe(200);
    await p.locator('#cs-encaisser').click();
    await expect.poll(() => p.locator('#modal-root #rd-resp option').count(), { timeout: 10_000 }).toBe(1);
    expect(net(await p.locator('#modal-root h2').innerText())).toBe('Remise de 10 %');
    expect(await p.locator('#modal-root #rd-resp option:checked').innerText()).toBe('Nadia');
    // Le curseur attend dans la case du code : Nadia tape, sans cliquer.
    await expect.poll(() => p.evaluate(() => document.activeElement?.id), { timeout: 5_000 }).toBe('rd-code');
    await p.keyboard.type('1358');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'remise-1-responsable.png') });
    await p.locator('#modal-root #rs-ok').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe('Ce code de responsable ne correspond pas : rien n\'a été vendu.');
    // Le panier attend ; avec le bon code, le ticket part.
    await p.locator('#cs-encaisser').click();
    await expect.poll(() => p.locator('#modal-root #rd-resp option').count(), { timeout: 10_000 }).toBe(1);
    await p.locator('#modal-root #rd-code').fill('1357');
    await p.locator('#modal-root #rs-ok').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-001 encaissé`);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'remise-2-encaisse.png') });
    const tickets = async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, nadia)).corps.objets as { collection: string; contenu: Record<string, unknown> }[])
      .filter((o) => o.collection === 'documents').map((o) => [o.contenu.number, o.contenu.discountRate, o.contenu.remiseCaisse ?? null]);
    expect(await tickets()).toEqual([[`TIC-${annee}-001`, 10, { taux: '10', approuvePar: 'Nadia' }]]);
    // Le ticket imprimé dit sa remise : 3,852 de lignes, − 0,385, font 3,467.
    await p.locator('#cs-tabs [data-tab=tickets]').click();
    await p.locator('#cs-liste [data-tk]', { hasText: `TIC-${annee}-001` }).click();
    await expect.poll(async () => net(await p.frameLocator('#modal-root iframe.cs-apercu').locator('body').innerText().catch(() => '')), { timeout: 10_000 })
      .toMatch(/Pain de mie 3 × 1,284 DT 3,852 DT Remise 10 % − 0,385 DT Total HT 3,240 DT TVA 7 % sur 3,240 DT 0,227 DT TOTAL TTC 3,467 DT/);
    await p.locator('#modal-root [data-close]').click();
    await p.locator('#cs-tabs [data-tab=vendre]').click();

    // Nadia règle 15 % sans code, dans Paramètres → Caisse.
    const bureau = await ouvrir(nadia, ent);
    const b = bureau.p;
    await b.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await expect.poll(() => b.locator('#pf input[name=name]').count(), { timeout: 20_000 }).toBe(1);
    await plusTard(b);
    await b.locator('#set-tabs button[data-tab=documents]').click();
    await b.locator('#pf input[name=remiseCaisseAuDela]').fill('15');
    await b.locator('#save-bar #save').click();
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, nadia)).corps.objets as { cle: string; contenu: Record<string, unknown> }[])
      .find((o) => o.cle === 'company')?.contenu.remiseCaisseAuDela, { timeout: 10_000 }).toBe(15);
    await bureau.cx.close();
    expect(bureau.erreurs).toEqual([]);

    // Sami, page rouverte : 10 % passe sans code.
    await p.reload();
    await expect.poll(() => p.locator('#cs-articles .cs-art').count(), { timeout: 20_000 }).toBe(1);
    await plusTard(p);
    await p.locator('#cs-articles .cs-art', { hasText: 'Pain de mie' }).click();
    await p.locator('#cs-remise').fill('10');
    await p.locator('#cs-remise').press('Tab');
    await p.locator('#cs-encaisser').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-002 encaissé`);
    expect(await p.locator('#modal-root #rd-resp').count()).toBe(0);
    await comptoir.cx.close();
    expect(comptoir.erreurs).toEqual([]);
  }, 180_000);
});
