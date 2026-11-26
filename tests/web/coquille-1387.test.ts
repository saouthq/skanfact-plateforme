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
    // (1.388.91) Exactement une ligne : « au plus une » passait sur la liste encore vide, avant même la recherche.
    await p.locator('#pal-q').fill('abonnement');
    await expect.poll(async () => (net(await p.locator('#pal-res').innerText()).match(/Paramètres → Ton abonnement/g) || []).length, { timeout: 10_000 }).toBe(1);
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
    // (1.388.26, DIR-3) La fiche d'un client refuse aussi une adresse fausse, en la nommant ; la fenêtre reste ouverte.
    await p.evaluate(() => { location.hash = '#/clients'; });
    // Le téléphone en lettres n'a pas été enregistré : la page pose sa question, on quitte sans enregistrer.
    const quitter = p.getByRole('button', { name: 'Quitter sans enregistrer', exact: true });
    await quitter.waitFor({ timeout: 5_000 }).then(() => quitter.click()).catch(() => undefined);
    await p.locator('#vide-client, #new').first().click();
    await p.locator('#cf input[name=name]').fill('Café du Port');
    await p.locator('#cf-plus summary').click();
    await p.locator('#cf input[name=email]').fill('pas-un-email');
    await p.locator('#modal-root .modal').last().locator('#ok').click();
    await expect.poll(async () => net(await p.locator('#modal-root .modal').last().innerText()), { timeout: 10_000 }).toContain('n\'a pas la forme d\'une adresse e-mail');
    expect(await p.locator('#cf').isVisible()).toBe(true);
    await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Annuler', exact: true }).click();
    const abandon = p.getByRole('button', { name: /Abandonner/ });
    await abandon.waitFor({ timeout: 3_000 }).then(() => abandon.click()).catch(() => undefined);
    await expect.poll(() => p.locator('#modal-root .modal').count(), { timeout: 5_000 }).toBe(0);
    await p.evaluate(() => { location.hash = '#/parametres'; });
    await p.locator('#pf').waitFor({ timeout: 30_000 });
    // (1.387.76) La cloche dit « en retard » : son clic ouvre ce qui est en retard — les relances pour les factures, les
    // achats filtrés sur « En retard » pour les achats — et plus la liste entière. Et les cases de la numérotation se nomment.
    expect(String(await p.locator('#pf input[data-num="facture"]').getAttribute('aria-label'))).toContain('Dernière facture émise');
    expect(String(await p.locator('#pf input[data-num="devis"]').getAttribute('aria-label'))).toContain('Dernier devis émis');
    // (ENTSOCLE-22) « -3 » ne devient pas 3 en silence : la ligne le refuse, et le dit.
    await p.evaluate(() => { const el = document.querySelector('#pf input[data-num="devis"]') as HTMLInputElement; el.value = '-3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await expect.poll(() => p.evaluate(() => (document.querySelector('#num-motif') as HTMLElement).textContent || ''), { timeout: 10_000 }).toContain('nombre entier');
    await p.evaluate(() => { const el = document.querySelector('#pf input[data-num="devis"]') as HTMLInputElement; el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
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
    await p2.evaluate((r) => (window as unknown as { __naviguer: (h: string) => void }).__naviguer(`#/${r}`), ailleurs?.route ?? '');
    await expect.poll(() => p2.evaluate((f) => [...document.querySelectorAll('#nav .nav-volet.ici')].map((b) => (b as HTMLElement).dataset.famille).join('|') === f, ailleurs?.famille ?? ''), { timeout: 10_000 }).toBe(true);
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

  it('deux onglets sur le même brouillon : le bandeau nomme ce que l\'autre a changé, et rien ne dit « enregistré » avant le choix (ENTSOCLE-6)', async () => {
    const amira = await personne('amira');
    const ent = String((await api('POST', '/entreprises-essai', amira)).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, amira);
    const client = { id: 'c1', name: 'Mohamed Trabelsi', city: 'Tunis', email: '', paymentTermsDays: 30, withholdingRate: 0 };
    const facture = { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: '2026-11-11', dueDate: '2026-12-11', clientId: 'c1', createdAt: 6, subject: 'Entretien',
      lines: [{ label: 'Entretien', description: '', qty: n('1'), unit: '', unitPrice: n('100.000'), vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: true, stampFee: 1,
      notes: '', currency: 'DT', regimeTva: 'reel', payments: [] };
    const pose = await api('POST', `/entreprises/${ent}/dossier-v10`, amira, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: client },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: facture },
    ] });
    expect(pose.statut, JSON.stringify(pose.corps)).toBe(200);
    const cx = await contexte(amira);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const a = await cx.newPage();
    const b = await cx.newPage();
    for (const p of [a, b]) { await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`); await p.locator('#save').waitFor({ timeout: 30_000 }); await plusTard(p); }
    // B change la quantité et enregistre ; A, resté sur l'ancienne version, change l'objet et enregistre.
    const qte = b.locator('#lines tr[data-i="0"] input[data-k="qty"], [data-i="0"] [data-k="qty"]').first();
    await qte.fill('2'); await qte.press('Tab');
    await b.locator('#save').click();
    await expect.poll(async () => net(await b.locator('#toast').innerText().catch(() => '')), { timeout: 10_000 }).toContain('enregistré');
    const objet = a.locator('[name="subject"]').first();
    await objet.fill('Entretien urgent'); await objet.press('Tab');
    await a.locator('#save').click();
    const bandeau = a.locator('#ed-conflit');
    await bandeau.waitFor({ timeout: 15_000 });
    const texte = net(await bandeau.innerText());
    expect(texte).toContain('a changé la quantité');
    expect(texte).not.toMatch(/a changé l'objet/);
    expect(texte).toMatch(/\(et (1 autre valeur|\d+ autres valeurs)\)/);
    await expect.poll(async () => net(await a.locator('#toast').innerText().catch(() => '')), { timeout: 10_000 }).toContain('choisis la version à garder');
    expect(await a.locator('#ed-enreg').isVisible()).toBe(false);
    await cx.close();
  }, 150_000);

  it('l\'accueil d\'une entreprise neuve n\'a qu\'un vert, « Créer » garde quatre gestes, une pièce figée ne promet plus « Émettre » (ENTSOCLE-19, 20, 21)', async () => {
    const sami = await personne('sami');
    const ent = String((await api('POST', '/entreprises', sami, { raisonSociale: 'Quincaillerie du Port de Sfax et de sa Région SARL' })).corps.id);
    const cx = await contexte(sami);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await p.locator('#view .premiers-pas').first().waitFor({ timeout: 30_000 });
    await plusTard(p);
    // Un seul vert : celui des premiers pas ; « À faire » ne le reprend pas pour une ligne « Quand tu peux ».
    await expect.poll(() => p.locator('#view .btn-primary').filter({ visible: true }).count(), { timeout: 10_000 }).toBeLessThanOrEqual(1);
    expect(await p.locator('#view [data-todo].btn-primary').count()).toBe(0);
    // Le nom long de l'entreprise se lit en entier au survol de l'en-tête.
    await expect.poll(async () => String(await p.locator('#brand-btn').getAttribute('title')), { timeout: 10_000 }).toContain('Quincaillerie du Port de Sfax et de sa Région SARL');
    // Un commerce dont la caisse est « à venir » garde quatre gestes dans « Créer », sans deux fois la même touche.
    const creer = await p.evaluate(() => {
      const w = window as unknown as { __data: { company: { activity: string } }; __creer: () => { actions: { page: string; touche: string }[] } };
      const av = window as unknown as { __aVenir?: string[] | undefined };
      const avant = av.__aVenir;
      av.__aVenir = ['caisse'];
      w.__data.company.activity = 'commerce';
      const r = w.__creer().actions;
      w.__data.company.activity = '';
      av.__aVenir = avant;
      return r;
    });
    expect(creer.map((a) => a.page)).not.toContain('caisse');
    expect(creer.length).toBe(4);
    expect(new Set(creer.map((a) => a.touche)).size).toBe(creer.length);
    // Une pièce figée (ici un brouillon d'un mois clôturé) ne se modifie plus : ses raccourcis ne promettent ni « Ajouter un
    // article » ni « Émettre ».
    const pose = await api('POST', `/entreprises/${ent}/dossier-v10`, sami, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Garage Ben Ali', city: 'Sfax', email: '', paymentTermsDays: 30, withholdingRate: 0 } },
      { collection: 'documents', cle: 'f9', rang: 0, revision: null, contenu: { id: 'f9', type: 'facture', number: '', status: 'brouillon', date: '2026-10-11', dueDate: '2026-11-11', clientId: 'c1', createdAt: 6,
        subject: 'Clés', lines: [{ label: 'Clés', description: '', qty: n('1'), unit: '', unitPrice: n('10.000'), vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: true, stampFee: 1,
        notes: '', currency: 'DT', regimeTva: 'reel', payments: [] } },
    ] });
    expect(pose.statut, JSON.stringify(pose.corps)).toBe(200);
    await p.reload();
    await p.locator('#view .premiers-pas').first().waitFor({ timeout: 30_000 });
    await p.evaluate(() => { (window as unknown as { __data: { closedUntil: string } }).__data.closedUntil = '2026-10-31'; location.hash = '#/doc/f9'; });
    await p.waitForFunction(() => typeof (window as unknown as { __raccourcisPiece?: unknown }).__raccourcisPiece === 'function' && location.hash === '#/doc/f9', undefined, { timeout: 30_000 });
    await p.locator('#clos-banner, #view .bandeau').first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    await p.evaluate(() => (window as unknown as { __raccourcisPiece: () => void }).__raccourcisPiece());
    const rac = net(await p.locator('#modal-root .modal').last().innerText());
    expect(rac).toContain('Aperçu en grand');
    expect(rac).not.toContain('Ajouter un article');
    expect(rac).not.toContain('Émettre');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 150_000);

  it('la visite nomme un bouton par ce qui se voit et ne compte que les étapes montrées (ENTSOCLE-9)', async () => {
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises', nour, { raisonSociale: 'Atelier Nour' })).corps.id);
    const cx = await contexte(nour);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await p.locator('#view h1').first().waitFor({ timeout: 30_000 });
    await plusTard(p);
    // Les visites se chargent au premier geste qui les montre : « Me guider ».
    await p.evaluate(() => { location.hash = '#/guide'; });
    await p.waitForFunction(() => typeof (window as unknown as { Visite?: unknown }).Visite !== 'undefined', null, { timeout: 20_000 });
    await p.evaluate(() => { location.hash = '#/dashboard'; });
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    // Le nom : seul ce qui se voit compte.
    expect(await p.evaluate(() => {
      const b = document.createElement('button');
      b.innerHTML = '<span style="display:none">Voir les 11 autres</span><span>Voir les 13 autres</span>';
      document.body.append(b);
      const t = (window as unknown as { Visite: { libelleDe: (e: Element) => string } }).Visite.libelleDe(b);
      b.remove();
      return t;
    })).toBe('Voir les 13 autres');
    // Le compteur : une étape sautée (`si` faux) ne compte pas, et la suivante n'en paraît pas perdue.
    await p.evaluate(() => (window as unknown as { Visite: { lancer: (x: unknown) => boolean } }).Visite.lancer({ id: 't', titre: 'Essai', etapes: [
      { cible: '#view h1', titre: 'A', texte: 'a' }, { si: () => false, cible: '#view h1', titre: 'B', texte: 'b' }, { cible: '#view h1', titre: 'C', texte: 'c' }] }));
    const sur = p.locator('.vb-sur').first();
    await expect.poll(() => sur.textContent(), { timeout: 10_000 }).toBe('Étape 1 sur 2');
    await p.evaluate(() => (window as unknown as { Visite: { suivant: () => void } }).Visite.suivant());
    await expect.poll(() => sur.textContent(), { timeout: 10_000 }).toBe('Étape 2 sur 2');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);

  it('la vignette et le grand aperçu disent le même nombre de pages, quel que soit le zoom (issue 15, V-16)', async () => {
    const lea = await personne('lea');
    const ent = String((await api('POST', '/entreprises', lea, { raisonSociale: 'Atelier Lumière' })).corps.id);
    const cx = await contexte(lea);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/dashboard`);
    await p.locator('#view .premiers-pas').first().waitFor({ timeout: 30_000 });
    await plusTard(p);
    // On cherche, dans la page même et avec le moteur de l'application, une longueur de facture qui se coupe autrement à
    // 50 % qu'au zoom du PDF : c'est elle qui faisait dire « 2 pages » à la vignette et « 1 page » au grand aperçu.
    const desc = 'Pose et raccordement, fourniture du petit matériel, essais en présence du client et nettoyage du chantier';
    const trouve = await p.evaluate(async (texte) => {
      const w = window as unknown as { SkanCore: Obj; __data: Obj };
      const K = w.SkanCore, co = w.__data.company;
      const cl = { id: 'c1', name: 'Hôtel Dar El Marsa', city: 'La Marsa' };
      const compte = (html: string) => new Promise<number>((res) => {
        const f = document.createElement('iframe');
        f.style.cssText = 'position:fixed;left:-5000px;top:0;width:900px;height:1200px';
        f.onload = () => { try { const d = f.contentDocument as Document; d.documentElement.style.zoom = ''; K.fitToPage(d); res(K.paginate(d)); } catch { res(-1); } f.remove(); };
        f.srcdoc = html; document.body.appendChild(f);
      });
      for (let k = 4; k <= 40; k++) {
        const doc = { id: 'x', type: 'facture', number: '', status: 'brouillon', date: '2026-11-10', dueDate: '2026-12-10', clientId: 'c1', subject: 'Éclairage',
          lines: Array.from({ length: k }, (_, i) => ({ label: `Luminaire n° ${i + 1}`, description: texte, qty: 1, unit: '', unitPrice: 10, vatRate: 19 })),
          discountRate: 0, withholdingRate: 0, applyStamp: true, stampFee: 1, notes: '', currency: 'DT', payments: [] };
        const petit = await compte(K.documentHtml(doc, cl, co, { preview: true, zoom: 0.5 }));
        const vrai = await compte(K.documentHtml(doc, cl, co, { preview: true, zoom: 1 }));
        if (petit !== vrai) return { k, petit, vrai };
      }
      return null;
    }, desc);
    expect(trouve, 'aucune longueur ne se coupe autrement à 50 % : la donnée ne discrimine pas').not.toBeNull();
    const k = (trouve as { k: number; vrai: number }).k;
    const vrai = (trouve as { k: number; vrai: number }).vrai;
    const pose = await api('POST', `/entreprises/${ent}/dossier-v10`, lea, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Hôtel Dar El Marsa', city: 'La Marsa', email: '', paymentTermsDays: 30, withholdingRate: 0 } },
      { collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: '2026-11-10', dueDate: '2026-12-10', clientId: 'c1', createdAt: 6,
        subject: 'Éclairage', lines: Array.from({ length: k }, (_, i) => ({ label: `Luminaire n° ${i + 1}`, description: desc, qty: n('1'), unit: '', unitPrice: n('10.000'), vatRate: 19 })),
        discountRate: 0, withholdingRate: 0, applyStamp: true, stampFee: 1, notes: '', currency: 'DT', regimeTva: 'reel', payments: [] } },
    ] });
    expect(pose.statut, JSON.stringify(pose.corps)).toBe(200);
    await p.reload();
    await p.locator('#view .premiers-pas').first().waitFor({ timeout: 30_000 });
    await p.evaluate(() => { location.hash = '#/doc/f1'; });
    const attendu = vrai <= 1 ? /^1 page/ : new RegExp(`^${vrai} pages$`);
    await expect.poll(async () => net(await p.locator('#pv-pages').innerText().catch(() => '')), { timeout: 20_000 }).toMatch(attendu);
    await p.locator('#pv-ouvrir').click();
    await expect.poll(async () => net(await p.locator('#pv-full-pages').innerText().catch(() => '')), { timeout: 20_000 }).toMatch(attendu);
    // À 125 %, toujours le même compte.
    for (let i = 0; i < 4 && !/125 %/.test(await p.locator('#pv-zoom-val').innerText()); i++) await p.locator('#pv-zoom-in').click();
    await expect.poll(async () => net(await p.locator('#pv-full-pages').innerText().catch(() => '')), { timeout: 20_000 }).toMatch(attendu);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 150_000);

  it('le devis sans modèle ni texte prêt propose le geste sur place, « sans coût » dit où le saisir, la vue Avoirs a ses statuts (issue 15, V-18)', async () => {
    const nour = await personne('nour');
    const ent = String((await api('POST', '/entreprises', nour, { raisonSociale: 'Menuiserie Nour' })).corps.id);
    const pose = await api('POST', `/entreprises/${ent}/dossier-v10`, nour, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Hôtel Dar El Marsa', city: 'La Marsa', email: '', paymentTermsDays: 30, withholdingRate: 0 } },
      { collection: 'documents', cle: 'd1', rang: 0, revision: null, contenu: { id: 'd1', type: 'devis', number: '', status: 'brouillon', date: '2026-11-10', dueDate: '2026-12-10', clientId: 'c1', createdAt: 6,
        subject: 'Placards', lines: [{ label: 'Placard chêne', description: '', qty: n('2'), unit: '', unitPrice: n('450.000'), vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, stampFee: 0,
        notes: '', currency: 'DT', regimeTva: 'reel', payments: [] } },
      { collection: 'documents', cle: 'f1', rang: 1, revision: null, contenu: { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: '2026-11-12', dueDate: '2026-12-12', clientId: 'c1', createdAt: 7,
        subject: 'Placards', lines: [{ label: 'Placard chêne', description: '', qty: n('1'), unit: '', unitPrice: n('450.000'), vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: true, stampFee: 1,
        notes: '', currency: 'DT', regimeTva: 'reel', payments: [] } },
    ] });
    expect(pose.statut, JSON.stringify(pose.corps)).toBe(200);
    const cx = await contexte(nour);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/d1`);
    await p.locator('#ed-modele').waitFor({ timeout: 30_000 });
    await plusTard(p);
    // « Modèle » sans aucun modèle : ni recherche, ni « Ajouter à la suite / Remplacer les lignes ».
    await p.locator('#ed-modele').click();
    const bulle = p.locator('.ed-pop').last();
    await expect.poll(async () => net(await bulle.innerText().catch(() => '')), { timeout: 10_000 }).toContain('Aucun modèle');
    expect(await bulle.locator('[data-mode], #pop-tpl-q').count()).toBe(0);
    await p.keyboard.press('Escape');
    // « Texte prêt » vide : le texte s'écrit sur place et part dans les notes.
    await p.locator('#ed-texte2').click();
    const bt = p.locator('.ed-pop #pop-txt-neuf');
    await bt.waitFor({ timeout: 10_000 });
    expect(net(await p.locator('.ed-pop').last().innerText())).not.toContain('Paramètres');
    await bt.click();
    const f = p.locator('#modal-root .modal').last();
    await f.locator('input[name=name]').fill('Garantie');
    await f.locator('textarea[name=text]').fill('Garantie deux ans pièces et main-d\'œuvre.');
    await f.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(() => p.locator('#notes').inputValue(), { timeout: 10_000 }).toContain('Garantie deux ans');
    // « Calculer les prix » sur des lignes sans coût dit où le saisir.
    await p.locator('#calc-prix').first().click();
    const cp = p.locator('#modal-root .modal').last();
    await expect.poll(async () => net(await cp.innerText().catch(() => '')), { timeout: 10_000 }).toContain('se saisit sur la fiche de l\'article');
    await cp.getByRole('button', { name: 'Annuler', exact: true }).click();
    // La vue « Avoirs » des factures : ses statuts sont ceux d'un avoir. (Le texte ajouté aux notes s'enregistre d'abord.)
    await p.locator('#save').click({ timeout: 10_000 });
    await expect.poll(() => p.locator('#save').isVisible(), { timeout: 15_000 }).toBe(false);
    await p.evaluate(() => { location.hash = '#/factures'; });
    await p.locator('#lf-filtres [data-kind="avoir"]').click({ timeout: 30_000 });
    await expect.poll(async () => (await p.locator('#st option').allInnerTexts()).map(net).join(' | '), { timeout: 10_000 }).toContain('Avoir émis');
    expect((await p.locator('#st option').allInnerTexts()).map(net).join(' | ')).not.toContain('Payée en partie');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 150_000);
});
