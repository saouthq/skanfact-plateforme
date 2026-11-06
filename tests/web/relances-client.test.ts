// 1.293.0 — Les relances jouées comme une gérante : un client qui doit trois factures reçoit UN message qui les nomme, au
// ton du plus grand retard ; une facture relancée attend sa réponse une semaine hors de « À relancer » ; le chiffre du
// menu suit la page.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'tests/web/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('les relances par client et l\'attente d\'une réponse', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-relances-client-'));
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
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const plusTard = async (p: Page) => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  it('relancer un client pour toutes ses factures d\'un message, puis attendre sa réponse une semaine ; le menu dit le même chiffre', async () => {
    const email = `relances-cl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Hédi Ben Salah', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Ascenseurs Ben Salah' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http')) return;
      sessionStorage.setItem('skanfact.jeton', j);
      localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false }));
    }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/relances`);
    await expect.poll(async () => net(await p.locator('#view').innerText().catch(() => '')), { timeout: 20_000 }).toContain('Relancer tes impayés');
    await p.waitForTimeout(1500);
    const auj = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
    const jour = (n: number) => new Date(Date.parse(auj) + n * 86_400_000).toISOString().slice(0, 10);
    const fr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
    // Bâtiments Ezzahra doit trois factures (60, 30 et 10 jours de retard) ; l'Hôtel Le Golfe une, relancée il y a 3 jours.
    const clients = [{ id: 'c1', name: 'Bâtiments Ezzahra', email: 'compta@ezzahra.exemple.tn' }, { id: 'c2', name: 'Hôtel Le Golfe', email: 'direction@golfe.exemple.tn' }];
    const prix = (x: number) => (Number.isInteger(x) ? x : { '~n': String(x) });
    const facture = (id: string, clientId: string, jEch: number, p0: number, extra: Record<string, unknown> = {}) => ({ id, type: 'facture', number: '', date: jour(jEch - 30), dueDate: jour(jEch), clientId, subject: 'Travaux',
      status: 'brouillon', lines: [{ label: 'Travaux', description: '', qty: 1, unit: '', unitPrice: prix(p0), vatRate: 19 }], discountRate: 0,
      applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 0, regimeTva: 'reel', ...extra });
    const factures = [facture('f1', 'c1', -60, 720), facture('f2', 'c1', -30, 3480.5), facture('f3', 'c1', -10, 1250),
      facture('f4', 'c2', -20, 5584, { reminders: [{ date: jour(-3), level: 2, channel: 'email' }] })];
    const nets = ['856.800', '4141.795', '1487.500', '6644.960'];
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      ...clients.map((c, i) => ({ collection: 'clients', cle: c.id, rang: i, revision: null, contenu: c })),
      ...factures.map((f, i) => ({ collection: 'documents', cle: f.id, rang: i, revision: null, contenu: f }))] })).statut).toBe(200);
    for (const [i, f] of factures.entries()) {
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: f, client: clients.find((c) => c.id === f.clientId), revision: 1, rang: i, netAPayer: nets[i] });
      expect(e.statut, JSON.stringify(e.corps)).toBe(200);
    }
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/relances`);
    await p.locator('#rel-resume .mg-chiffre').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    // Le Golfe, relancé il y a 3 jours, attend sa réponse : il n'est pas à relancer, et l'on dit quand il revient.
    const chiffre1 = async () => net(await p.locator('#rel-resume .mg-chiffre').first().innerText());
    await expect.poll(chiffre1).toBe('À relancer 3 6 486,095 DT à récupérer · 1 attend leur réponse');
    expect(net(await p.locator('#r-attente').innerText())).toContain(`on te la remontre le ${fr(jour(4))}`);
    expect(await p.locator('#r-attente [data-relancer]').count()).toBe(0);
    await expect.poll(async () => net(await p.locator('#nav-relances').innerText())).toBe('3');
    // Par client : une ligne pour Ezzahra, qui nomme ses trois factures.
    await p.locator('[data-rl-vue=client]').click();
    await expect.poll(() => p.locator('#r-wrap table.rl-clients tbody tr').count()).toBe(1);
    expect(net(await p.locator('#r-wrap .banner').first().innerText())).toBe('3 factures à relancer chez 1 client — 6 486,095 DT à récupérer');
    const ligne = net(await p.locator('tr[data-groupe=c1]').innerText());
    expect(ligne).toContain('3 factures : FAC-');
    expect(ligne).toContain('60 j Dernière relance');
    await p.screenshot({ path: path.join(PHOTOS, 'relances-client-1.png') });
    // Un message pour toutes ; on décoche la plus récente : le total suit, et la phrase n'invente pas de relance passée.
    await p.locator('[data-rel-client=c1]').click();
    const fen = p.locator('.modal');
    await expect.poll(() => fen.locator('[data-fac]').count()).toBe(3);
    await fen.locator('[data-fac=f3]').uncheck();
    const corps = async () => (await fen.locator('[name=body]').inputValue()).replace(/[\u00a0\u202f]/g, ' ');
    await expect.poll(corps).toContain('Total dû : 4 998,595 DT.');
    expect(await corps()).not.toContain('précédentes relances');
    expect(await corps()).not.toContain('1 487,500');
    expect(net(await fen.locator('#ok').innerText())).toBe('Envoyer la relance des 2 factures');
    // Le ton se change ; un message retouché à la main ne se refait pas.
    await fen.locator('#rg-ton').selectOption('2');
    await expect.poll(async () => (await fen.locator('[name=subject]').inputValue()).startsWith('Relance : 2 factures')).toBe(true);
    await fen.locator('[name=body]').fill('Bonjour, deux factures restent dues. Merci.');
    await fen.locator('#rg-ton').selectOption('3');
    expect(await fen.locator('[name=body]').inputValue()).toBe('Bonjour, deux factures restent dues. Merci.');
    await fen.locator('#ok').click();
    await fen.locator('#rg-envoye').click();
    // Noté sur les deux factures cochées, pas sur la troisième ; elles attendent leur réponse.
    await expect.poll(chiffre1).toBe('À relancer 1 1 487,500 DT à récupérer · 3 attendent leur réponse');
    await expect.poll(async () => net(await p.locator('#nav-relances').innerText())).toBe('1');
    const notes = await p.evaluate(() => (window as unknown as { __data: { documents: { id: string, reminders?: { level: number, channel: string, groupe?: boolean }[], emails?: unknown[] }[] } }).__data.documents
      .filter((d) => ['f1', 'f2', 'f3'].includes(d.id)).map((d) => [d.id, (d.reminders || []).map((x) => `${x.level}-${x.channel}-${x.groupe ? 'g' : ''}`).join(','), (d.emails || []).length]));
    expect(notes.sort()).toEqual([['f1', '3-email-g', 1], ['f2', '3-email-g', 1], ['f3', '', 0]]);
    expect(net(await p.locator('#r-attente').innerText())).toContain('Dernière relance');
    // « Plus de 45 jours » dit un retard : la facture à 60 jours y reste, relancée.
    expect(net(await p.locator('#rel-resume .mg-chiffre').nth(1).innerText())).toBe('Plus de 45 jours 1 relancée, elle attend sa réponse');
    // Relancer quand même reste possible, par son menu.
    await p.locator('#r-attente tr:has-text("Hôtel Le Golfe") [data-rowmenu]').click();
    await expect.poll(async () => net(await p.locator('.row-menu').last().innerText().catch(() => ''))).toContain('Relancer quand même par e-mail');
    await p.keyboard.press('Escape');
    await p.screenshot({ path: path.join(PHOTOS, 'relances-client-2.png') });

    // Au téléphone : rien ne déborde.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.waitForTimeout(400);
    expect(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 150_000);
});
