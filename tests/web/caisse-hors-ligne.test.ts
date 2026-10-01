// La caisse sans réseau, à la souris (brique 120 ; docs/caisse.md, H1 à H4). Nadia tient son épicerie sur « mon
// ordinateur » ; elle ouvre la caisse, encaisse un lait en ligne (TIC-AAAA-001) ; le réseau tombe : elle encaisse encore
// un lait et une huile, que le poste numérote (002, 003) et garde ; la page Caisse dit qu'elle encaisse sans réseau et
// le prochain numéro ; au retour du réseau, les deux tickets partent seuls, dans l'ordre, sous les mêmes numéros, et
// aucune alerte ne naît.

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

describe('la caisse sans réseau, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-caisse-hl-'));
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

  it('sans réseau, le poste numérote et garde ; au retour, les tickets partent dans l\'ordre, sous les mêmes numéros', async () => {
    const email = `nadia-caisse-hl-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Caisse du comptoir', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Épicerie Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'accounts', cle: 'k-caisse', rang: 0, revision: null, contenu: { id: 'k-caisse', name: 'Caisse', kind: 'caisse', bank: '', rib: '', opening: 100, openingDate: '2026-01-01', isDefault: false, statementBalance: '', notes: '' } },
      { collection: 'catalog', cle: 'lait', rang: 0, revision: null, contenu: { id: 'lait', label: 'Lait demi-écrémé 1 L', unit: 'u', unitPrice: { '~n': '2.35' }, vatRate: 19 } },
      { collection: 'catalog', cle: 'huile', rang: 1, revision: null, contenu: { id: 'huile', label: 'Huile d\'olive 1 L', unit: 'u', unitPrice: { '~n': '12.5' }, vatRate: 19 } },
    ] })).statut).toBe(200);
    const tickets = async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; contenu: Record<string, unknown> }[])
      .filter((o) => o.collection === 'documents' && o.contenu.ticket === true).map((o) => [o.contenu.number, o.contenu.numeroPoste ?? null, o.contenu.caisseHorsLigne === true]).sort();

    // « Mon ordinateur » : la session gardée dans le navigateur, et le navigateur qui promet de garder.
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript(() => { if (navigator.storage) Object.assign(navigator.storage, { persist: async () => true, persisted: async () => true }); });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http') || localStorage.getItem('test.pose')) return;
      localStorage.setItem('test.pose', '1');
      localStorage.setItem('skanfact.jeton', j);
    }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/caisse`);
    await expect.poll(() => p.locator('#cs-articles .cs-art').count(), { timeout: 20_000 }).toBe(2);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
    const toast = async () => net(await p.locator('#toast').innerText().catch(() => ''));
    const vendre = async (article: string) => {
      await p.locator('#cs-articles .cs-art', { hasText: article }).click();
      await p.locator('#cs-encaisser').click();
    };

    // La caisse s'ouvre ; un lait en ligne : le serveur le numérote.
    await expect.poll(async () => net(await p.locator('#cs-fermee').innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/^La caisse est fermée\./);
    await p.locator('#cs-fond').fill('20');
    await p.locator('#cs-ouvrir').click();
    await expect.poll(async () => net(await p.locator('#cs-ouverte').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Caisse ouverte par Nadia/);
    await vendre('Lait demi-écrémé');
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-001 encaissé`);

    // Le réseau tombe : un lait et une huile, numérotés par le poste.
    await cx.setOffline(true);
    await vendre('Lait demi-écrémé');
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-002 encaissé sans réseau (il partira au serveur au retour du réseau)`);
    await vendre('Huile d\'olive');
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-003 encaissé sans réseau (il partira au serveur au retour du réseau)`);
    // Rechargée sans réseau (l'application installée s'ouvre sur sa copie), la page Caisse le dit, avec le prochain
    // numéro ; les deux tickets qui attendent se montrent ; le bandeau compte ce qui attend.
    await expect.poll(() => p.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
    await p.reload();
    await expect.poll(async () => net(await p.locator('#cs-hors-ligne').innerText().catch(() => '')), { timeout: 15_000 })
      .toBe(`Sans réseau. Cette caisse encaisse quand même : ses tickets se numérotent sur ce poste (le prochain : TIC-${annee}-004), se gardent chiffrés, et partiront au serveur, dans l'ordre, au retour du réseau. i`);
    await expect.poll(async () => net(await p.locator('#poste-bandeau').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/2 changements/);
    // L'écran enregistre le dossier pendant la coupure : les tickets n'en font pas partie (ils partent par leur file),
    // ils ne se comptent pas deux fois.
    await p.evaluate(() => { const w = window as unknown as { __enregistrerMaintenant?: () => void }; w.__enregistrerMaintenant?.(); });
    await p.waitForTimeout(800);
    expect(net(await p.locator('#poste-bandeau').innerText())).toMatch(/2 changements/);
    await p.locator('#cs-tabs [data-tab=tickets]').click();
    await expect.poll(async () => net(await p.locator('#cs-body').innerText()), { timeout: 10_000 }).toMatch(new RegExp(`3 tickets.*TIC-${annee}-003.*TIC-${annee}-002.*TIC-${annee}-001`));
    // Sans réseau aussi, la session est ouverte : le bilan ne dit pas ce que le tiroir devrait contenir.
    expect(net(await p.locator('#cs-tiroir').innerText())).toBe('Le tiroir se compte à la fermeture (Z), sans voir ce qu\'il devrait contenir.');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'caisse-hl-1-sans-reseau.png') });
    // Le serveur n'a encore que le premier.
    expect(await tickets()).toEqual([[`TIC-${annee}-001`, `TIC-${annee}-001`, false]]);
    // Plus de 7 jours sans contact avec le serveur : la caisse n'encaisse plus sans réseau, et le dit.
    await p.evaluate(() => localStorage.setItem('skanfact.dernier_contact', String(Date.now() - 8 * 24 * 3600 * 1000)));
    await p.locator('#cs-tabs [data-tab=vendre]').click();
    await vendre('Lait demi-écrémé');
    await expect.poll(toast, { timeout: 10_000 }).toBe('Plus de 7 jours sans contact avec le serveur : la caisse n\'encaisse plus sans réseau. Une connexion, même courte, la débloque. Rien n\'a été vendu.');
    await p.evaluate(() => localStorage.setItem('skanfact.dernier_contact', String(Date.now())));

    // Le réseau revient : les deux tickets partent seuls, dans l'ordre, sous les numéros imprimés ; aucune alerte.
    await cx.setOffline(false);
    const remis = [[`TIC-${annee}-001`, `TIC-${annee}-001`, false], [`TIC-${annee}-002`, `TIC-${annee}-002`, false], [`TIC-${annee}-003`, `TIC-${annee}-003`, false]];
    await expect.poll(tickets, { timeout: 30_000 }).toEqual(remis);
    expect((await api('GET', `/entreprises/${ent}/caisse`, jeton)).corps.alertes).toEqual([]);
    await expect.poll(async () => net(await p.locator('#poste-bandeau').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/enregistrés/);
    // Ce que l'écran avait enregistré sans réseau (le panier refusé, l'écran du ticket) ne réécrit pas les tickets remis.
    await p.waitForTimeout(1_500);
    expect(await tickets()).toEqual(remis);
    // La page Caisse ne dit plus « Sans réseau » : la caisse est ouverte, en ligne.
    await expect.poll(async () => net(await p.locator('#cs-ouverte').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Caisse ouverte par Nadia/);
    expect(await p.locator('#cs-hors-ligne').count()).toBe(0);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'caisse-hl-2-remis.png') });
    // Rouverte, la page a ses trois tickets, et le suivant prend le 004.
    await p.reload();
    await expect.poll(async () => net(await p.locator('#cs-ouverte').innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/^Caisse ouverte par Nadia/);
    await vendre('Lait demi-écrémé');
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-004 encaissé`);

    // Un ticket remis par ce poste avec une chaîne cassée (comme si un ticket avait disparu) : enregistré, et la page
    // Caisse le dit à Nadia, la propriétaire, sans rien corriger.
    const etat = (await api('GET', `/entreprises/${ent}/caisse`, jeton)).corps.numerotation as { session: string; chaine: string };
    const jour = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
    const casse = { id: 't-casse', type: 'facture', ticket: true, number: '', date: jour, clientId: '', lines: [{ itemId: 'lait', label: 'Lait demi-écrémé 1 L', unit: 'u', qty: 1, unitPrice: { '~n': '2.35' }, vatRate: 19 }],
      discountRate: 0, applyStamp: false, stampFee: 0, status: 'envoyée', withholdingRate: 0, currency: 'DT', caisse: { mode: 'especes', recu: null, rendu: null },
      payments: [{ id: 'p-casse', date: jour, amount: { '~n': '2.797' }, method: 'especes', accountId: 'k-caisse', reference: '', note: '' }] };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10/ticket`, jeton, { document: casse, rang: 9, netAPayer: '2.797',
      poste: { session: etat.session, numero: `TIC-${annee}-005`, precedente: 'c'.repeat(64), empreinte: 'd'.repeat(64), encaisseLe: new Date().toISOString(), horsLigne: true } })).statut).toBe(200);
    await p.reload();
    await expect.poll(async () => net(await p.locator('#cs-alertes').innerText().catch(() => '')), { timeout: 15_000 })
      .toMatch(new RegExp(`^2 alertes de caisse\\. SkanFact n'a rien corrigé : chaque ticket est enregistré tel qu'il est arrivé\\. i .*Le ticket TIC-${annee}-005 ne suit pas le ticket précédent de cette caisse : la chaîne des tickets est cassée`));
    expect(net(await p.locator('#cs-alertes').innerText())).toContain(`Le ticket TIC-${annee}-005 ne correspond pas à ce que le poste avait scellé`);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'caisse-hl-3-alertes.png') });
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);
});
