// La caisse en ligne, à la souris (brique 115 ; la caisse tactile du 05/10/2026 ; docs/caisse.md). Nadia tient son
// épicerie : elle ouvre la caisse, choisit trois laits et encaisse en espèces (10 DT reçus, 1,610 DT à rendre) ; le
// serveur donne le numéro TIC-AAAA-001, scelle le ticket et enregistre son paiement ; puis une huile, TIC-AAAA-002 ; le
// bilan du jour les compte tous les deux ; le soir, elle compte le tiroir et fait le Z.

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

describe('la caisse en ligne, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-caisse-'));
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

  it('Nadia encaisse deux tickets : le serveur les numérote dans leur série, et le bilan les compte', async () => {
    const email = `nadia-caisse-${Date.now()}@exemple.tn`;
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
      .filter((o) => o.collection === 'documents' && o.contenu.ticket === true).map((o) => o.contenu);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/caisse`);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
    const toast = async () => net(await p.locator('#toast').innerText().catch(() => ''));

    // 0. La caisse est fermée : l'écran de vente le dit en grand, sans un article à toucher ; Nadia l'ouvre avec 100 DT
    // de fond (brique 116).
    await expect.poll(async () => net(await p.locator('#cs-fermee').innerText().catch(() => '')), { timeout: 20_000 }).toMatch(/^La caisse est fermée\./);
    expect(await p.locator('#cs-articles').count()).toBe(0);
    expect(net(await p.locator('#cs-puce').innerText())).toBe('Caisse fermée');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'caisse-0-fermee.png') });
    await p.locator('#cs-fond').fill('100');
    await p.locator('#cs-ouvrir').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe('Caisse ouverte, fond de caisse 100,000 DT');
    await expect.poll(async () => net(await p.locator('#cs-ouverte').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Ouverte par Nadia le \d\d\/\d\d \d\d:\d\d · fond 100,000 DT$/);
    await expect.poll(() => p.locator('#cs-articles .cs-art').count(), { timeout: 10_000 }).toBe(2);

    // 1. Trois laits ; « Encaisser » ; 10 DT reçus : 8,390 DT, 1,610 DT à rendre ; la monnaie se dit en grand.
    const lait = p.locator('#cs-articles .cs-art', { hasText: 'Lait demi-écrémé' });
    for (let i = 0; i < 3; i++) await lait.click();
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'caisse-1-panier.png') });
    await p.locator('#cs-encaisser').click();
    await p.locator('#cs-recu').fill('10');
    await expect.poll(async () => net(await p.locator('#cs-rendu').innerText())).toBe('1,610 DT');
    expect(net(await p.locator('#cs-valider').innerText())).toBe('Valider · rendre 1,610 DT');
    await p.locator('#cs-valider').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-001 encaissé — à rendre 1,610 DT`);
    expect(net(await p.locator('#cs-a-rendre').innerText())).toBe('1,610 DT');
    await p.locator('#cs-nouvelle').click();
    // Au serveur : le ticket, son numéro, son paiement.
    await expect.poll(async () => (await tickets()).map((t) => [t.number, (t.payments as Record<string, unknown>[]).map((x) => x.amount)]), { timeout: 10_000 })
      .toEqual([[`TIC-${annee}-001`, [{ '~n': '8.39' }]]]);

    // 2. Une huile, le compte juste (rien de tapé) : le numéro suivant.
    await p.locator('#cs-articles .cs-art', { hasText: 'Huile d\'olive' }).click();
    await p.locator('#cs-encaisser').click();
    await p.locator('#cs-valider').click();
    await expect.poll(toast, { timeout: 10_000 }).toBe(`Ticket TIC-${annee}-002 encaissé`);
    await p.locator('#cs-nouvelle').click();

    // 3. Le bilan du jour : deux tickets, 23,265 DT (8,390 + 14,875).
    await p.locator('#cs-tabs [data-tab=tickets]').click();
    await expect.poll(async () => net(await p.locator('#cs-body .stat').first().innerText()), { timeout: 10_000 }).toContain('23,265 DT');
    expect(net(await p.locator('#cs-body .stat').first().innerText())).toContain('2 tickets');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'caisse-2-bilan.png') });
    // Rouverte, la page a toujours ses deux tickets (ils sont au serveur, pas seulement sur l'écran).
    await p.reload();
    await p.locator('#cs-tabs [data-tab=tickets]').click();
    await expect.poll(async () => net(await p.locator('#cs-body .stat').first().innerText()), { timeout: 15_000 }).toContain('23,265 DT');

    // 4. Le soir : Nadia ferme la caisse (le menu ⋯) ; elle tape le total compté, 123 DT ; le tiroir devait contenir
    // 100 + 8,390 + 14,875 = 123,265.
    await p.locator('#cs-tabs [data-tab=vendre]').click();
    await p.locator('#cs-menu-bouton').click();
    await p.locator('#cs-fermer').click();
    await p.locator('#cs-tape summary').click();
    await p.locator('#cs-compte').fill('123');
    await p.locator('#cs-z').click();
    const zTable = p.locator('#modal-root #cs-z-table');
    await expect.poll(async () => net(await zTable.innerText().catch(() => '')), { timeout: 10_000 })
      .toBe('Ventes TTC 23,265 DT dont TVA 3,715 DT Espèces 23,265 DT Fond de caisse 100,000 DT Le tiroir devait contenir 123,265 DT Espèces comptées 123,000 DT Écart − 0,265 DT');
    expect(net(await p.locator('#modal-root').innerText())).toContain(`2 tickets, du TIC-${annee}-001 au TIC-${annee}-002`);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'caisse-3-z.png') });
    await p.locator('#modal-root #cs-z-ok').click();
    await expect.poll(async () => net(await p.locator('#cs-fermee').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^La caisse est fermée\./);
    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);
});
