// Le retour à la caisse, à l'écran (brique 124 ; 03 § 2.1 ; docs/caisse.md, T1 à T5). Nadia, la propriétaire, pose son
// code de responsable depuis son bureau. Au comptoir, Sami vend trois pains ; une cliente en rapporte un : « Rendre un
// article… », un pain, Nadia comme responsable présente ; un code faux ne rend rien, le bon établit l'avoir AVO-…-001.
// Le bilan du jour dit l'argent rendu, la page rouverte aussi, et le Z le compte : le tiroir tombe juste.

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

describe('le retour à la caisse, à l\'écran', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-retour-'));
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
    // Le navigateur d'un commerçant est à l'heure de Tunis, comme le serveur : entre 23 h et minuit (UTC), un navigateur
    // à l'heure UTC daterait la caisse de la veille (CI rouge du 01/10/2026 sur 6bf2b1b).
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/caisse`);
    // L'état de la caisse, lu au serveur, se dit dans la barre du haut.
    await expect.poll(() => p.locator('#cs-puce, #cs-ouverte').count(), { timeout: 20_000 }).toBe(1);
    await plusTard(p);
    return { cx, p, erreurs };
  };

  it('Sami rend un pain avec le code de Nadia ; le bilan et le Z comptent l\'argent rendu', async () => {
    const email = `nadia-retour-${Date.now()}@exemple.tn`;
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
    const emailSami = `sami-retour-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email: emailSami, nom: 'Sami', motDePasse: 'Un-bon-mot-de-passe' });
    const sami = String((await api('POST', '/connexion', undefined, { email: emailSami, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Caisse du comptoir', type: 'navigateur' } })).corps.jeton);
    const inv = String((await api('POST', `/entreprises/${ent}/invitations`, nadia, { email: emailSami, roles: ['caissier'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', sami, { jeton: inv })).statut).toBe(200);

    // Nadia, à son bureau : « Mon code de responsable… », dans le menu de la caisse. Un caissier n'a pas ce geste.
    const bureau = await ouvrir(nadia, ent);
    const b = bureau.p;
    await b.locator('#cs-menu-bouton').click();
    await b.locator('#cs-code-responsable').click();
    await b.locator('#modal-root #cs-nouveau').fill('1357');
    await b.locator('#modal-root #cs-nouveau-bis').fill('1357');
    await b.locator('#modal-root #cs-code-ok').click();
    await expect.poll(async () => net(await b.locator('#toast').innerText().catch(() => '')), { timeout: 10_000 }).toBe('Ton code de responsable est enregistré.');
    await bureau.cx.close();
    expect(bureau.erreurs).toEqual([]);

    // Au comptoir, Sami ouvre la caisse (20 DT) et vend trois pains.
    const comptoir = await ouvrir(sami, ent);
    const p = comptoir.p;
    expect(await p.locator('#cs-code-responsable').count()).toBe(0);
    await expect.poll(async () => net(await p.locator('#cs-fermee').innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/^La caisse est fermée\./);
    await p.locator('#cs-fond').fill('20');
    await p.locator('#cs-ouvrir').click();
    await expect.poll(async () => net(await p.locator('#cs-ouverte').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Ouverte par Sami/);
    for (let i = 0; i < 3; i++) await p.locator('#cs-articles .cs-art', { hasText: 'Pain de mie' }).click();
    await p.locator('#cs-encaisser').click();
    await p.locator('#cs-valider').click();
    const toast = async () => net(await p.locator('#toast').innerText().catch(() => ''));
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-001 encaissé`);

    // Une cliente rapporte un pain : le ticket, « Rendre un article… », un pain, Nadia présente.
    await plusTard(p);
    await p.locator('#cs-tabs [data-tab=tickets]').click();
    await p.locator('#cs-liste [data-tk]', { hasText: `TIC-${annee}-001` }).click();
    await p.locator('#modal-root #tk-rendre').click();
    await p.locator('#modal-root [data-rd]').first().fill('1');
    await expect.poll(async () => net(await p.locator('#modal-root #rd-annonce').innerText()), { timeout: 5_000 }).toBe('À rendre au client : 1,284 DT.');
    // Nadia, seule responsable, est déjà choisie.
    await expect.poll(() => p.locator('#modal-root #rd-resp option').count(), { timeout: 10_000 }).toBe(1);
    expect(await p.locator('#modal-root #rd-resp option:checked').innerText()).toBe('Nadia');
    // Un code faux : rien n'est rendu, et la fenêtre reste ouverte.
    await p.locator('#modal-root #rd-code').fill('1358');
    await p.locator('#modal-root #ok').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe('Ce code de responsable ne correspond pas : rien n\'a été rendu.');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'retour-1-code-faux.png') });
    // Le bon code : l'avoir du serveur.
    await p.locator('#modal-root #rd-code').fill('1357');
    await p.locator('#modal-root #ok').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Avoir AVO-${annee}-001 : 1,284 DT rendus.`);
    await plusTard(p);
    await p.locator('#cs-tabs [data-tab=tickets]').click();
    // Le bilan du jour dit le net, et le retour qui le fait (vu sur le serveur d'essai le 05/10/2026 : « Ventes TTC »
    // restait brut après un retour).
    const ventes = p.locator('#cs-ventes');
    const bilan = async () => `${net((await ventes.locator('.lbl').textContent().catch(() => '')) ?? '')} | ${net(await ventes.locator('.val').innerText().catch(() => ''))} | ${net(await ventes.locator('.sub').innerText().catch(() => ''))}`;
    const attendu = `Ventes du jour, retours déduits i | 2,568 DT | 3,852 DT vendus en 1 ticket − 1,284 DT en 1 retour (AVO-${annee}-001)`;
    await expect.poll(bilan, { timeout: 10_000 }).toBe(attendu);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'retour-2-bilan.png') });
    // Rouverte, la page a toujours le retour (Sami voit les retours faits sur ses tickets).
    await p.reload();
    await plusTard(p);
    await p.locator('#cs-tabs [data-tab=tickets]').click();
    await expect.poll(bilan, { timeout: 15_000 }).toBe(attendu);
    // Le bilan imprimé le dit aussi. (La bande s'imprime par une fenêtre du navigateur : on la lit.)
    const lireBande = async (bouton: string) => {
      await p.evaluate(() => { const w = window as unknown as { __imprime?: string; open: unknown };
        w.__imprime = ''; w.open = () => ({ document: { write: (html: string) => { w.__imprime = html; }, close: () => undefined }, print: () => undefined }); });
      await p.locator(bouton).click();
      await expect.poll(() => p.evaluate(() => (window as unknown as { __imprime?: string }).__imprime ?? ''), { timeout: 5_000 }).not.toBe('');
      return net((await p.evaluate(() => (window as unknown as { __imprime?: string }).__imprime ?? '')).replace(/<[^>]+>/g, ' '));
    };
    expect(await lireBande('#cs-bilan-print')).toContain(`Ventes TTC 3,852 DT Retours (AVO-${annee}-001) − 1,284 DT Net du jour 2,568 DT`);

    // Le soir, le Z : 20 + 3,852 encaissés − 1,284 rendus = 22,568 dans le tiroir. Il cite le retour et dit le net.
    await p.locator('#cs-menu-bouton').click();
    await p.locator('#cs-fermer').click();
    await p.locator('#cs-tape summary').click();
    await p.locator('#cs-compte').fill('22.568');
    await p.locator('#cs-z').click();
    await expect.poll(async () => net(await p.locator('#modal-root #cs-z-table').innerText().catch(() => '')), { timeout: 10_000 }).toContain('Rendu (espèces) − 1,284 DT');
    expect(net(await p.locator('#modal-root #cs-z-table').innerText())).toContain(`Retours : AVO-${annee}-001 (ticket TIC-${annee}-001) − 1,284 DT Net des ventes 2,568 DT`);
    expect(net(await p.locator('#modal-root #cs-z-table').innerText())).toContain('Écart 0,000 DT');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'retour-3-z.png') });
    expect(await lireBande('#modal-root #cs-z-imprimer')).toContain(`Ventes TTC 3,852 DT Retours : AVO-${annee}-001 − 1,284 DT Net des ventes 2,568 DT`);
    await comptoir.cx.close();
    expect(comptoir.erreurs).toEqual([]);
  }, 180_000);
});
