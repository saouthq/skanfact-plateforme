// 1.295.0 — Les garanties jouées comme un installateur (docs/revue-modules.md, « Les garanties ») : Karim voit ce qui
// finit chez ses clients, propose UN contrat de maintenance à l'Hôtel Le Golfe pour trois de ses quatre climatiseurs,
// l'enregistre ; le lendemain, la page et l'accueil ne les redemandent plus. Un client qui appelle : la recherche dit si
// son appareil est encore garanti. La fiche du client propose le même geste.

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

describe('les garanties : proposer la maintenance une fois, et la retrouver', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-garanties-'));
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
  const net = (t: string) => t.replace(/[\s\u00a0\u202f]+/g, ' ').trim();
  // Une date de livraison, comptée depuis aujourd'hui : il y a `mois` mois, plus `jours` jours.
  const livre = (mois: number, jours: number) => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth() - mois, d.getDate() + jours)).toISOString().slice(0, 10); };

  it('proposer un contrat pour trois climatiseurs ; la page, l\'accueil et la fiche le savent ; la recherche répond', async () => {
    const email = `karim-gar-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Karim', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Bureau', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Clim et Info Jlassi' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const o = (collection: string, cle: string, rang: number | null, contenu: Record<string, unknown>) => ({ collection, cle, rang, revision: null, contenu: { id: cle, ...contenu } });
    const ser = (id: string, itemId: string, serial: string, clientId: string, outDate: string, warrantyMonths: number) =>
      o('serials', id, null, { itemId, serial, status: outDate ? 'vendu' : 'stock', inDate: '2024-01-02', inPurchaseId: '', clientId, outDate, outDocId: '', warrantyMonths, notes: '' });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      o('clients', 'golfe', 0, { name: 'Hôtel Le Golfe' }), o('clients', 'pins', 1, { name: 'Clinique Les Pins' }), o('clients', 'ezz', 2, { name: 'Bâtiments Ezzahra' }), o('clients', 'trab', 3, { name: 'Mme Trabelsi' }),
      o('catalog', 'clim', 0, { label: 'Climatiseur split 12000 BTU', unit: 'pièce', unitPrice: { '~n': '1450.5' }, vatRate: 19, tracked: true, serialized: true, warrantyMonths: 24 }),
      o('catalog', 'ond', 1, { label: 'Onduleur 1500 VA', unit: 'pièce', unitPrice: { '~n': '389.9' }, vatRate: 19, tracked: true, serialized: true, warrantyMonths: 12 }),
      // Trois climatiseurs finissent dans 13 jours, un quatrième dans 38 ; un onduleur chez la clinique, un autre sans fiche
      // client (dans 9 jours : la première ligne) ; un PC hors garantie ; un climatiseur garanti jusqu'en 2028 ; deux en stock.
      ser('s1', 'clim', 'CL-24-0117', 'golfe', livre(24, 14), 24), ser('s2', 'clim', 'CL-24-0118', 'golfe', livre(24, 14), 24), ser('s3', 'clim', 'CL-24-0119', 'golfe', livre(24, 14), 24),
      ser('s4', 'clim', 'CL-24-0144', 'golfe', livre(24, 39), 24), ser('s5', 'ond', 'UPS-25-8812', 'pins', livre(12, 25), 12), ser('s8', 'ond', 'UPS-25-8890', '', livre(12, 10), 12),
      // Un onduleur chez Mme Trabelsi finit dans 75 jours : hors de la fenêtre de 60 jours (celle de l'accueil).
      ser('s11', 'ond', 'UPS-25-9001', 'trab', livre(12, 76), 12),
      ser('s6', 'clim', 'PC-25-0310', 'ezz', livre(20, 0), 12), ser('s7', 'clim', 'CL-26-0502', 'trab', livre(5, 0), 24),
      ser('s9', 'clim', 'CL-26-0611', '', '', 24), ser('s10', 'clim', 'CL-26-0612', '', '', 24),
    ] })).statut).toBe(200);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const plusTard = async () => { for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined); };
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/garanties`);
    await plusTard();
    const chiffres = async () => (await p.locator('#gar-resume .mg-chiffre').evaluateAll((els) => els.map((e) => `${e.querySelector('span')?.textContent?.trim()} ${e.querySelector('b')?.textContent}`)));
    await expect.poll(chiffres, { timeout: 20_000 }).toEqual(['À proposer 6', 'Déjà proposées 0', 'Sous garantie 8', 'Hors garantie 1']);
    // Un seul bouton principal : le premier client à qui l'on peut proposer (l'onduleur sans fiche n'en a pas).
    expect(await p.locator('#g-aproposer .btn-primary').count()).toBe(1);
    expect(await p.locator('#g-aproposer .btn-primary').getAttribute('data-proposer')).toBe('golfe');
    expect(net(await p.locator('#g-aproposer tr[data-groupe]').nth(0).innerText())).toMatch(/^sans client Onduleur 1500 VA n° UPS-25-8890 .* Rattacher un client…$/);

    // UN contrat pour ses climatiseurs : le quatrième (38 jours) attendra.
    await p.locator('#g-aproposer [data-proposer=golfe]').click();
    await expect.poll(() => p.locator('#modal-root [data-gar]').count()).toBe(4);
    await p.locator('#modal-root [data-gar=s4]').uncheck();
    await p.locator('#modal-root #gar-ok').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toBe('#/doc/new/contrat/client/golfe/garantie/s1,s2,s3');
    // Les lignes sont des champs : on lit ce qu'ils contiennent.
    const champs = async () => net((await p.locator('#view input, #view textarea').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).join(' | '));
    await expect.poll(champs, { timeout: 10_000 }).toContain('N° de série CL-24-0118');
    const texte = await champs();
    expect(texte).toContain('Maintenance : Climatiseur split 12000 BTU');
    for (const n of ['CL-24-0117', 'CL-24-0119']) expect(texte).toContain(`N° de série ${n}`);
    expect(texte).not.toContain('CL-24-0144');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'garanties-2-contrat.png') });
    await p.locator('#ed-geste .btn-primary').click();
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Enregistré : CTR-\d{4}-001/);

    // Le lendemain : ce qui est proposé se voit et ne se redemande plus.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/garanties`);
    await plusTard();
    await expect.poll(chiffres, { timeout: 20_000 }).toEqual(['À proposer 3', 'Déjà proposées 3', 'Sous garantie 8', 'Hors garantie 1']);
    expect(net(await p.locator('#gar-resume .mg-chiffre').nth(1).locator('small').innerText())).toBe('en 1 pièce : 1 en attente de réponse');
    expect(await p.locator('#g-proposees tbody tr').evaluateAll((trs) => trs.map((tr) => (tr.textContent || '').includes('CTR-')))).toEqual([true, true, true]);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'garanties-1-page.png') });

    // Un client appelle avec une panne : la recherche dit si c'est encore garanti.
    await p.locator('#g-q').fill('CL-26');
    await expect.poll(() => p.locator('#g-trouves tbody tr').count(), { timeout: 10_000 }).toBe(3);
    expect(net(await p.locator('#g-trouves tbody tr', { hasText: 'CL-26-0502' }).innerText())).toMatch(/Mme Trabelsi .* Garantie jusqu'au \d{2}\/\d{2}\/2028/);
    expect(net(await p.locator('#g-trouves tbody tr', { hasText: 'CL-26-0611' }).innerText())).toContain('En stock');

    // L'accueil compte la même chose que la page.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await plusTard();
    await expect.poll(async () => net(await p.locator('#view').innerText()), { timeout: 20_000 }).toContain('3 garanties se terminent dans moins de deux mois');

    // La fiche de la clinique propose le même geste ; celle de l'hôtel dit le contrat proposé.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/client/pins`);
    await plusTard();
    await p.locator('#view [data-onglet=materiel]').click();
    await expect.poll(() => p.locator('#cl-proposer').count(), { timeout: 10_000 }).toBe(1);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/client/golfe`);
    await plusTard();
    await p.locator('#view [data-onglet=materiel]').click();
    await expect.poll(async () => net(await p.locator('#view').innerText()), { timeout: 10_000 }).toMatch(/maintenance proposée : CTR-\d{4}-001 \(brouillon\)/);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);
});
