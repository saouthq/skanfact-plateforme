// 1.364.0 — bout en bout 31 (Nour) : elle a clôturé le mois dernier, puis enregistre un bien en service depuis ce mois-là.
// Avant : « Période clôturée », avec le conseil de refaire « à la date d'aujourd'hui » (le plan d'amortissement serait
// faux). Ici, à la souris : la question dit que l'entrée se date au premier jour ouvert, le bien s'enregistre avec sa vraie
// mise en service. Puis la comptable reprend sa fiche : le Cabinet dit que le bien n'est entré dans aucune écriture, et un
// clic passe l'entrée (la valeur au compte du bien, le report à nouveau en face) — elle ne devient pas une « ligne sans fiche ».
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('la cession 1.364.0 : un bien d\'avant la clôture s\'enregistre, et le Cabinet le fait entrer dans ses livres', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cession-1364-'));
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
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Obj };
  };
  const personne = async (qui: string) => {
    const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const contexte = async (jeton: string, largeur = 1440, hauteur = 900): Promise<BrowserContext> => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
    return cx;
  };
  const plusTard = async (p: import('playwright-core').Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  it('le bien d\'avant la clôture s\'enregistre chez le client, et son entrée se passe au Cabinet', async () => {
    const erreurs: string[] = [];
    const leila = await personne('leila');
    const cab = await api('POST', '/cabinets', leila, { nom: 'Cabinet Ennour' });
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises-essai', nour)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nour);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, nour, { codeCabinet: String(cab.corps.code), perimetre: ['comptabilite', 'declarations', 'paie'] })).corps.mandat);
    expect((await api('POST', `/cabinets/${String(cab.corps.id)}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);

    // Le mois dernier est clôturé jusqu'à son dernier jour ; le bien est en service depuis son premier jour.
    const jour = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
    const ceMois = `${jour.slice(0, 7)}-01`;
    const fin = new Date(Date.parse(`${ceMois}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const service = `${fin.slice(0, 7)}-01`;
    const fr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
    // Une vente deux mois plus tôt, AVANT de clôturer : le mois dernier, lui, reste sans une écriture (« sans activité »).
    const avant = new Date(Date.parse(`${service}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 7) + '-01';
    const vendre = async (id: string, date: string, rang: number) => {
      const e = (await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, nour, { document: { id, type: 'facture', number: '', status: 'brouillon', date, dueDate: date, clientId: 'c1', createdAt: rang,
        subject: 'Coffrets', lines: [{ label: 'Coffret de chocolats', description: '', qty: 1, unit: '', unitPrice: 100, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', regimeTva: 'reel', payments: [] },
      client: { id: 'c1', name: 'c1' }, revision: null, rang, netAPayer: '119.000' })).corps;
      expect(String((e.contenu as Obj | undefined)?.number ?? e.motif)).toMatch(/^FAC-/);
    };
    await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [{ collection: 'clients', cle: 'c1', rang: 21, revision: null, contenu: { id: 'c1', name: 'Mme Gharbi' } }] });
    await vendre('f0', avant, 30);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [{ collection: '_racine', cle: 'closedUntil', rang: null, revision: null, contenu: fin }] })).statut).toBe(200);

    const cx = await contexte(nour);
    const p = await cx.newPage();
    p.on('pageerror', (x) => erreurs.push(`entreprise : ${x.message}`));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/immos`);
    await p.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await plusTard(p);
    await p.getByRole('button', { name: /Enregistrer mon premier bien/ }).click();
    await p.locator('#imf [name=label]').fill('Camionnette de livraison');
    await p.locator('#imf select[name=category]').selectOption({ label: 'Matériel de transport' });
    await p.locator('#imf .datefield .d-txt').first().fill(fr(service));
    await p.locator('#imf .datefield .d-txt').first().press('Tab');
    await p.locator('#imf [name=amount]').fill('30000');
    await p.locator('.modal').last().locator('#ok').click();
    const question = p.locator('.modal').last();
    await expect.poll(() => question.locator('h2').innerText(), { timeout: 10_000 }).toBe('Un bien d\'avant la clôture');
    expect(net(await question.innerText())).toContain(`Son entrée dans tes livres, elle, se date au ${fr(ceMois)}, le premier jour ouvert`);
    expect(await p.locator('.modal h2', { hasText: 'Période clôturée' }).count()).toBe(0);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'cession-1364-1-question.png') });
    await question.getByRole('button', { name: 'Enregistrer le bien' }).click();
    const bienRange = async () => (((await api('GET', `/entreprises/${ent}/dossier-v10`, nour)).corps.objets as Obj[]).find((o) => o.collection === 'assets')?.contenu ?? null) as Obj | null;
    await expect.poll(async () => (await bienRange())?.entreeLe ?? '', { timeout: 20_000 }).toBe(ceMois);
    expect((await bienRange())?.date).toBe(service);
    // La fiche le redit.
    await p.locator('#view table.list tbody tr').first().click();
    await expect.poll(async () => net(await p.locator('#view').innerText()), { timeout: 10_000 }).toContain(`entré dans tes livres le ${fr(ceMois)}`);

    // Une vente du jour, pour que le livre de l'année existe au Cabinet (100 HT à 19 % = 119,000).
    await vendre('f1', jour, 31);

    // ── Au Cabinet : la fiche se reprend, le bien n'est entré dans aucune écriture, un clic passe son entrée.
    const annee = Number(jour.slice(0, 4));
    const cxC = await contexte(leila);
    const c = await cxC.newPage();
    c.on('pageerror', (x) => erreurs.push(`cabinet : ${x.message}`));
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${String(cab.corps.id)}#/dossier/${ent}/comptabilite/immobilisations/${annee}`);
    await c.locator('#view h1').first().waitFor({ timeout: 15_000 });
    await plusTard(c);
    await c.locator('[data-reprendre]').first().click({ timeout: 15_000 });
    await c.locator('.modal').last().getByRole('button', { name: 'Ajouter', exact: true }).click();
    const alerte = c.locator('#im-entrees');
    await expect.poll(async () => (await alerte.count()) ? net(await alerte.innerText()) : '', { timeout: 15_000 }).toMatch(/Camionnette de livraison n'est entré dans aucune écriture : le compte 22\d* n'a pas reçu ses 30 000,000 DT/);
    await c.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'cession-1364-2-cabinet.png') });
    await alerte.locator('[data-entree]').click();
    // (1.387.1, issue 10, CABPAIE-14) L'entrée se montre avant de s'écrire, contrepartie comprise.
    await expect.poll(async () => (await c.locator('.modal').last().locator('.im-avant tbody tr').count())).toBeGreaterThanOrEqual(2);
    await c.locator('.modal').last().locator('#ok').click();
    await expect.poll(() => alerte.count(), { timeout: 15_000 }).toBe(0);
    type Ecriture = { journal: string; piece: string; date: string; lignes: { compte: string; debit: string; credit: string }[] };
    const entree = ((await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, leila)).corps.ecritures as Ecriture[]).filter((x) => x.piece.startsWith('ENT-'));
    expect(entree.length).toBe(1);
    const ent0 = entree[0] as Ecriture;
    // L'entrée se date du jour où le client l'a fait entrer, pas de la mise en service (un mois qu'il a clôturé).
    expect(ent0.date).toBe(ceMois >= `${annee}-01-01` ? ceMois : `${annee}-01-01`);
    expect(ent0.lignes.filter((l) => l.compte.startsWith('22')).map((l) => l.debit)).toEqual(['30000.000']);
    expect(ent0.lignes.reduce((t, l) => t + Math.round(Number(l.debit) * 1000) - Math.round(Number(l.credit) * 1000), 0)).toBe(0);
    // Elle n'est pas proposée comme une acquisition sans fiche (le bien s'amortirait deux fois).
    expect(await c.getByText(/n'a pas de fiche/).count()).toBe(0);

    // Le mois dernier, clôturé par le client sans une écriture, n'est pas un mois qui manque (1.362.5 le dit « sans activité »).
    await c.goto(`${serveur.adresse}/v10/cabinet/?c=${String(cab.corps.id)}#/dossier/${ent}/comptabilite/journal/${annee}`);
    // (1.374.0) On attend le JOURNAL : l'écran d'avant (les immobilisations) a lui aussi un tableau, et le lire trop tôt
    // rendait l'assertion incapable de tomber (preuve « cession 1.364.0 p » restée verte sur GitHub le 16/11/2026).
    await expect.poll(async () => net(await c.locator('#view').innerText()), { timeout: 15_000 }).toMatch(/Comptabilité › Consulter[\s\S]*Le livre de/);
    const journal = net(await c.locator('#view').innerText());
    expect(journal).toMatch(/Comptabilité › Consulter/);
    expect(journal).not.toMatch(/Il manque/);

    expect(erreurs).toEqual([]);
    await cx.close(); await cxC.close();
  }, 180_000);
});
