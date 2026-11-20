// Le client à l'étranger (1.387.72, issue 15 V-10). Une facture en euros partait à 19 % avec un timbre : l'exportation
// était une case au fond de la puce « Devise ». « Avant d'émettre » pose la question et son geste. Et la fiche d'un client
// en devise ne reproche plus son numéro fiscal étranger.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('le client à l\'étranger (1.387.72)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-etranger-1387-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

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
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  const n = (x: string) => ({ '~n': x });

  it('une facture en euros avec TVA propose l\'exportation avant d\'émettre ; un numéro fiscal étranger ne se reproche pas', async () => {
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises-essai', nour)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nour);
    const olivier = { id: 'c1', name: 'Maison Olivier SARL', address: '12 rue Mercière, 69002', city: 'Lyon', email: '', currency: 'EUR', paymentTermsDays: 30, withholdingRate: 0 };
    const f1 = { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: '2026-11-10', dueDate: '2026-12-10', clientId: 'c1', createdAt: 5, subject: 'Petits-fours',
      lines: [{ label: 'Petits-fours', description: '', qty: n('10'), unit: '', unitPrice: n('100.00'), vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: true,
      exchangeRate: n('3.400'), notes: '', currency: 'EUR', regimeTva: 'reel', payments: [] };
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: olivier },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: f1 },
    ] })).statut).toBe(200);
    const erreurs: string[] = [];
    const cx = await contexte(nour);
    await cx.clock.setFixedTime(new Date('2026-11-13T10:00:00+01:00'));
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    p.on('pageerror', (x) => erreurs.push(x.message));

    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
    await p.locator('#ed-avant li').first().waitFor({ timeout: 30_000 });
    await plusTard(p);
    await expect.poll(async () => net(await p.locator('#ed-avant').innerText()), { timeout: 10_000 }).toContain('Facture en EUR avec de la TVA : une vente à l\'exportation n\'en porte pas');
    await p.locator('#ed-avant [data-avant=export]').click();
    await expect.poll(async () => net(await p.locator('#ed-avant').innerText()), { timeout: 10_000 }).not.toContain('Facture en EUR avec');
    // Le total : 1 000,00 €, sans TVA ni timbre.
    await expect.poll(async () => net(await p.locator('.editor').innerText()), { timeout: 10_000 }).toContain('1 000,00');
    expect(net(await p.locator('.editor').innerText())).not.toContain('1 190');
    await p.screenshot({ path: path.join(PHOTOS, 'etranger-1387-export.png') });

    // La fiche d'un client en devise : « FR 12 345678901 » s'écrit tel quel, sans reproche.
    // (Une page neuve : la facture vient d'être touchée, la quitter poserait la question des modifications.)
    const q = await cx.newPage();
    q.on('pageerror', (x) => erreurs.push(x.message));
    await q.goto(`${serveur.adresse}/v10/?e=${ent}#/clients`);
    await q.locator('#new').waitFor({ timeout: 30_000 });
    await plusTard(q);
    await q.locator('#new').click();
    const mf = q.locator('#cf input[name=matricule]');
    await mf.fill('FR 12 345678901');
    await expect.poll(async () => net(await q.locator('#cf-mf-aide').innerText()), { timeout: 10_000 }).toContain('Ni un matricule');
    // La liste est celle de l'application (le <select> natif est caché) : on la pose comme elle le fait, avec son « change ».
    await q.locator('#cf select[name=currency]').evaluate((e) => { (e as HTMLSelectElement).value = 'EUR'; e.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect.poll(async () => net(await q.locator('#cf-mf-aide').innerText()), { timeout: 10_000 }).toBe('Client à l\'étranger : son numéro fiscal s\'écrit tel quel.');
    // (1.387.73, V-17) L'adresse s'appelle « E-mail » comme sur la fiche, pas « Email ».
    await q.locator('#cf-plus summary').click();
    expect(await q.locator('#cf label.field').evaluateAll((l) => l.map((x) => ((x as HTMLElement).innerText.trim().split('\n')[0] ?? '').replace(/\s+i$/, '')).filter((x) => /mail/i.test(x)))).toEqual(['E-mail']);
    await q.keyboard.press('Escape');

    // (1.387.73, V-17) La fenêtre d'un client qui a une pièce n'offre plus « Supprimer » en rouge (qui refusait) : elle archive.
    const r = await cx.newPage();
    r.on('pageerror', (x) => erreurs.push(x.message));
    await r.goto(`${serveur.adresse}/v10/?e=${ent}#/client/c1`);
    await r.locator('[data-modifier]').first().waitFor({ timeout: 30_000 });
    await plusTard(r);
    await r.locator('[data-modifier]').first().click();
    await r.locator('#arch-client').waitFor({ timeout: 10_000 });
    expect(await r.locator('#del-client').count()).toBe(0);
    expect(await r.locator('#arch-client').getAttribute('title')).toContain('1 document lié');
    await r.locator('#arch-client').click();
    await expect.poll(async () => net(await r.locator('#toast').innerText()), { timeout: 10_000 }).toContain('Maison Olivier SARL est archivé');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
