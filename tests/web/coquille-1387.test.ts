// La coquille (1.387.75, issue 14). L'accueil écrivait un devis de 800 € « 800,000 » et une facture par son TTC quand la
// liste et la recherche disent son net ; la recherche ne trouvait ni une pièce par son montant ni un compte par son nom ;
// les Paramètres enregistraient une adresse « pas-un-email » ; « Tous les modules » promettait Relances dans le menu.

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

describe('la coquille : accueil, recherche, paramètres, modules (1.387.75)', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-coquille-1387-'));
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

  it('le même montant sur l\'accueil et dans la recherche, qui trouve un montant et un compte ; une adresse fausse ne s\'enregistre pas', async () => {
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises-essai', nour)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, nour);
    const olivier = { id: 'c1', name: 'Maison Olivier SARL', city: 'Lyon', email: '', currency: 'EUR', paymentTermsDays: 30, withholdingRate: 0 };
    const hotel = { id: 'c2', name: 'Hôtel du Lac', city: 'Sfax', email: '', paymentTermsDays: 30, withholdingRate: n('1.5') };
    const devis = { id: 'd1', type: 'devis', number: '', status: 'brouillon', date: '2026-11-10', dueDate: '2026-12-10', clientId: 'c1', createdAt: 5, subject: 'Petits-fours',
      lines: [{ label: 'Petits-fours', description: '', qty: n('8'), unit: '', unitPrice: n('100.00'), vatRate: 0 }], discountRate: 0, withholdingRate: 0, applyStamp: false,
      exchangeRate: n('3.350'), export: true, notes: '', currency: 'EUR', regimeTva: 'reel', payments: [] };
    // 2 000 HT + 19 % = 2 380 ; timbre 1 ; retenue 1,5 % de 2 380 = 35,700 ; net 2 345,300 (le TTC dit 2 381,000).
    const facture = { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: '2026-11-11', dueDate: '2026-12-11', clientId: 'c2', createdAt: 6, subject: 'Séminaire',
      lines: [{ label: 'Séminaire', description: '', qty: n('1'), unit: '', unitPrice: n('2000.000'), vatRate: 19 }], discountRate: 0, withholdingRate: n('1.5'), applyStamp: true, stampFee: 1,
      notes: '', currency: 'DT', regimeTva: 'reel', payments: [] };
    const pose = await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [
      { collection: 'accounts', cle: 'biat', rang: 0, revision: null, contenu: { id: 'biat', name: 'BIAT', kind: 'banque', bank: 'BIAT', rib: '', opening: n('8000'), openingDate: '2026-01-01', isDefault: true, statementBalance: '' } },
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: olivier },
      { collection: 'clients', cle: 'c2', rang: 1, revision: null, contenu: hotel },
      { collection: 'documents', cle: 'd1', rang: 0, revision: null, contenu: devis },
      { collection: 'documents', cle: 'f1', rang: 1, revision: null, contenu: facture },
    ] });
    expect(pose.statut, JSON.stringify(pose.corps)).toBe(200);
    const erreurs: string[] = [];
    const cx = await contexte(nour);
    await cx.clock.setFixedTime(new Date('2026-11-13T10:00:00+01:00'));
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    p.on('pageerror', (x) => erreurs.push(x.message));

    // L'accueil : le devis en euros porte son signe, la facture son net à payer (pas son TTC).
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await p.locator('.a-der .der-l').first().waitFor({ timeout: 30_000 });
    await plusTard(p);
    const der = net(await p.locator('.a-der').innerText());
    expect(der).toContain('800,00 €');
    expect(der).toContain('2 345,300');
    expect(der).not.toContain('2 381,000');
    expect(der).not.toContain('800,000');
    await p.screenshot({ path: path.join(PHOTOS, 'coquille-1387-accueil.png') });

    // La recherche : le montant reçu trouve la facture ; « biat » trouve le compte ; l'euro s'écrit « € ».
    await p.keyboard.press('Control+k');
    await p.locator('#pal-q').waitFor({ timeout: 10_000 });
    await p.locator('#pal-q').fill('2345,300');
    await expect.poll(async () => net(await p.locator('#pal-res').innerText()), { timeout: 10_000 }).toContain('Hôtel du Lac');
    await p.locator('#pal-q').fill('2345');
    await expect.poll(async () => net(await p.locator('#pal-res').innerText()), { timeout: 10_000 }).toContain('Hôtel du Lac');
    await p.locator('#pal-q').fill('biat');
    await expect.poll(async () => net(await p.locator('#pal-res').innerText()), { timeout: 10_000 }).toMatch(/BIAT.*Compte|Compte.*BIAT/);
    await p.locator('#pal-q').fill('olivier');
    await expect.poll(async () => net(await p.locator('#pal-res').innerText()), { timeout: 10_000 }).toContain('800,00 €');
    expect(net(await p.locator('#pal-res').innerText())).not.toContain('EUR');
    await p.locator('#pal-q').fill('abonnement');
    await expect.poll(async () => (net(await p.locator('#pal-res').innerText()).match(/Paramètres → Ton abonnement/g) || []).length, { timeout: 10_000 }).toBeLessThanOrEqual(1);
    await p.keyboard.press('Escape');

    // « Tous les modules » dit où est Relances : dans Factures, pas dans le menu.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/modules`);
    await expect.poll(async () => net(await p.locator('#view').innerText()), { timeout: 15_000 }).toContain('Relances (dans Factures)');

    // Les Paramètres : une adresse fausse, un téléphone en lettres ne s'enregistrent pas.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    const email = p.locator('#pf [name="email"]');
    await email.waitFor({ timeout: 30_000 });
    await email.fill('pas-un-email');
    await p.locator('#save').click();
    await expect.poll(async () => net(await p.locator('#toast').innerText()), { timeout: 10_000 }).toContain('n\'a pas la forme d\'une adresse e-mail');
    await email.fill('contact@exemple.tn');
    await p.locator('#pf [name="phone"]').fill('abc');
    await p.locator('#save').click();
    await expect.poll(async () => net(await p.locator('#toast').innerText()), { timeout: 10_000 }).toContain('n\'est pas un numéro de téléphone');
    const societe = (await admin.query('select contenu from socle.dossier_v10 where entreprise = $1 and collection = \'company\'', [ent])).rows.map((x) => JSON.stringify(x.contenu)).join(' ');
    expect(societe).not.toContain('pas-un-email');
    // (1.387.76) La cloche dit « en retard » : son clic ouvre ce qui est en retard — les relances pour les factures, les
    // achats filtrés sur « En retard » pour les achats — et plus la liste entière. Et les cases de la numérotation se nomment.
    expect(String(await p.locator('#pf input[data-num="facture"]').getAttribute('aria-label'))).toContain('Dernière facture émise');
    expect(String(await p.locator('#pf input[data-num="devis"]').getAttribute('aria-label'))).toContain('Dernier devis émis');
    const p2 = await cx.newPage();
    await p2.goto(`${serveur.adresse}/v10/?e=${ent}#/`);
    await p2.waitForFunction(() => typeof (window as unknown as { __versRetard?: unknown }).__versRetard === 'function', undefined, { timeout: 30_000 });
    await plusTard(p2);
    await p2.evaluate(() => (window as unknown as { __versRetard: (id: string) => void }).__versRetard('achats'));
    await expect.poll(() => p2.evaluate(() => location.hash), { timeout: 10_000 }).toBe('#/achats');
    await expect.poll(() => p2.locator('[data-tst="retard"]').getAttribute('aria-pressed'), { timeout: 10_000 }).toBe('true');
    await p2.evaluate(() => (window as unknown as { __versRetard: (id: string) => void }).__versRetard('factures'));
    await expect.poll(() => p2.evaluate(() => location.hash), { timeout: 10_000 }).toBe('#/relances');
    const barre = fs.readFileSync(path.join(RACINE, 'web/public/plateforme/barre.js'), 'utf8');
    expect(barre).toContain("w.__versRetard(id)");
    // (1.387.77, ENTSOCLE-14) Chercher un client n'est pas modifier la facture : on quitte sans question ni brouillon gardé.
    await p2.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/new/facture`);
    const qui = p2.locator('#ed-pq-q');
    await qui.waitFor({ timeout: 30_000 });
    await qui.pressSequentially('z', { delay: 30 });
    await p2.evaluate(() => (window as unknown as { __naviguer: (h: string) => void }).__naviguer('#/dashboard'));
    await expect.poll(() => p2.evaluate(() => location.hash), { timeout: 10_000 }).toBe('#/dashboard');
    expect(await p2.locator('#modal-root .modal').count()).toBe(0);
    expect(net(await p2.locator('#toast').innerText().catch(() => ''))).not.toContain('Rouvrir');
    // (1.387.77, ENTSOCLE-12) Une page de « Tout le reste » allume sa famille dans la barre.
    const ailleurs = await p2.evaluate(() => { const a = document.querySelector('#nav .nav-fam .volet a.pl-l[data-route]') as HTMLElement | null; return a ? { route: String(a.dataset.route), famille: String((a.closest('.nav-fam') as HTMLElement).dataset.famille) } : null; });
    expect(ailleurs).not.toBeNull();
    await p2.evaluate((r) => (window as unknown as { __naviguer: (h: string) => void }).__naviguer(`#/${r}`), ailleurs!.route);
    await expect.poll(() => p2.evaluate((f) => [...document.querySelectorAll('#nav .nav-volet.ici')].map((b) => (b as HTMLElement).dataset.famille).join('|') === f, ailleurs!.famille), { timeout: 10_000 }).toBe(true);
    // (1.387.77, ENTSOCLE-13) Recharger garde l'onglet des Paramètres où l'on était.
    await p2.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await p2.locator('#set-tabs [data-tab="app"]').click();
    await expect.poll(() => p2.locator('#set-tabs [data-tab="app"]').getAttribute('class'), { timeout: 10_000 }).toContain('active');
    await p2.reload();
    await p2.locator('#set-tabs').waitFor({ timeout: 30_000 });
    await expect.poll(() => p2.locator('#set-tabs [data-tab="app"]').getAttribute('class'), { timeout: 10_000 }).toContain('active');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 150_000);
});
