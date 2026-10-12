// Le lot débutant (2), à la souris (12/10/2026 ; docs/debutant.md). Les gênants du parcours d'un commerçant qui débute,
// refaits sur une quincaillerie ; ce parcours tient ce qu'il a trouvé :
//   - le catalogue dit « article » à qui vend des marchandises, « prestation » aux autres ; le coût du stock de départ
//     suit le coût de revient tant qu'on n'y a pas touché (laissé à 0, dix marteaux entraient au stock pour 0 DT) ;
//   - les visites : une étape à lire posée sur une case de texte y met le curseur ; choisir dans la case qu'elle éclaire
//     n'ouvre pas l'« essai » (la bulle partait dans un coin au moment où l'on faisait ce qu'elle demandait) ;
//   - l'avoir neuf qui choisit sa facture en reprend les lignes, sans écraser ce qu'on a déjà tapé ;
//   - une dépense sans fournisseur (un ticket, un reçu) se range sous « Dépenses diverses », une seule fiche ;
//   - le bandeau d'une facture émise passe à la ligne au lieu de sortir de l'écran.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const AUJOURDHUI = new Date().toISOString().slice(0, 10);

describe('le lot débutant (2), à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-debutant-2-'));
  beforeAll(async () => {
    await admin.connect();
    // Le timbre d'une facture est une règle fiscale du serveur (la base des tests n'en a pas d'elle-même).
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
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  type Objet = { collection: string; cle: string; revision: number; contenu: Record<string, unknown> };
  type Donnees = { catalog: Record<string, unknown>[]; suppliers: { id: string; name: string; divers?: boolean }[]; purchases: { id: string; kind: string; supplierId: string }[] };
  const donnees = (p: Page) => p.evaluate(() => (window as unknown as { __data: unknown }).__data) as Promise<Donnees>;

  // Une personne, son code en place, et son jeton ; `essai` lui ouvre l'entreprise d'essai (ses clients).
  async function personne(essai: boolean) {
    const email = `debutant2-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Amine', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const essaiId = essai ? String((await api('POST', '/entreprises-essai', premier)).corps.id) : '';
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = essaiId || String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Quincaillerie Gharbi SARL' })).corps.id);
    return { jeton, ent };
  }
  async function poser(jeton: string, ent: string, changements: unknown[]) {
    const r = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
  }
  async function fiche(jeton: string, ent: string) {
    return ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[]).find((o) => o.collection === '_racine' && o.cle === 'company');
  }
  // La fiche d'une quincaillerie : elle vend des marchandises (le métier « commerce »).
  async function commercant(jeton: string, ent: string) {
    const f = await fiche(jeton, ent);
    await poser(jeton, ent, [{ collection: '_racine', cle: 'company', rang: null, revision: f?.revision ?? null,
      contenu: { ...f?.contenu, name: 'Quincaillerie Gharbi SARL', activity: 'commerce', address: '12 rue de Marseille\n1000 Tunis' } }]);
  }
  async function ouvrir(jeton: string, ent: string, route: string, largeur = 1440, hauteur = 900) {
    const cn = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}${route}`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 }).catch(async (x) => { await p.screenshot({ path: path.join(PHOTOS, 'debutant-2-echec.png') }); throw new Error(`${String(x)} — ${erreurs.join(' | ')} — ${(await p.locator('body').innerText()).slice(0, 600)}`); });
    await p.waitForTimeout(600);
    await plusTard(p);
    return { p, erreurs, fermer: () => cn.close() };
  }
  // Une facture émise par le serveur, pour un client de l'entreprise d'essai (deux tables en chêne).
  async function factureEmise(jeton: string, ent: string) {
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
    const menuiserie = objets.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    if (!menuiserie) throw new Error('client d\'exemple absent');
    const doc = {
      id: 'f1', type: 'facture', number: '', date: AUJOURDHUI, dueDate: AUJOURDHUI, clientId: menuiserie.cle, subject: 'Mobilier', status: 'brouillon',
      lines: [{ label: 'Table en chêne massif', description: '', qty: 2, unit: '', unitPrice: { '~n': '450.5' }, unitCost: 300, vatRate: 19 }],
      discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
    };
    await poser(jeton, ent, [{ collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: doc }]);
    const emise = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: doc, client: menuiserie.contenu, revision: 1, rang: 0, netAPayer: '1073.190' });
    expect(emise.statut, JSON.stringify(emise.corps)).toBe(200);
    return String((emise.corps.contenu as Record<string, unknown>).number);
  }

  it('Catalogue : le mot suit le métier (« article » chez un commerçant) ; le coût du stock de départ suit le coût de revient tant qu\'on n\'y a pas touché', async () => {
    const { jeton, ent } = await personne(false);
    // Sans métier qui vende des marchandises, le catalogue parle de prestations.
    const avant = await ouvrir(jeton, ent, '#/catalogue');
    expect(net(await avant.p.locator('#view h1').first().innerText())).toMatch(/^Prestations( i)?$/);
    expect(net(await avant.p.locator('#new').innerText())).toBe('+ Nouvelle prestation');
    await avant.fermer();

    await commercant(jeton, ent);
    await poser(jeton, ent, [{ collection: 'catalog', cle: 'marteau', rang: 0, revision: null, contenu: { id: 'marteau', label: 'Marteau 500 g', unit: 'u', unitPrice: { '~n': '20' }, vatRate: 19, tracked: true,
      initialQty: 9, initialCost: { '~n': '12' }, initialDate: AUJOURDHUI } }]);
    const { p, erreurs, fermer } = await ouvrir(jeton, ent, '#/catalogue');
    expect(net(await p.locator('#view h1').first().innerText())).toMatch(/^Articles( i)?$/);
    expect(net(await p.locator('#new').innerText())).toBe('+ Nouvel article');
    expect(await p.locator('#list-wrap input.q').getAttribute('placeholder')).toBe('Rechercher un article…');
    expect(net(await p.locator('#view table.list tfoot').innerText())).toMatch(/^1 article · 1 suivi en stock/);

    await p.locator('#new').click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Nouvel article');
    await fenetre.locator('input[name=label]').fill('Pince coupante');
    await fenetre.locator('input[name=tracked]').check();
    // Le coût de revient tapé : le coût du départ le suit.
    await fenetre.locator('input[name=unitCost]').fill('9');
    await expect.poll(async () => Number(await fenetre.locator('input[name=initialCost]').inputValue())).toBe(9);
    // Le coût du départ tapé à la main : il ne suit plus.
    await fenetre.locator('input[name=initialCost]').fill('7');
    await fenetre.locator('input[name=unitCost]').fill('10');
    expect(Number(await fenetre.locator('input[name=initialCost]').inputValue())).toBe(7);
    await fenetre.locator('input[name=initialQty]').fill('5');
    await p.screenshot({ path: path.join(PHOTOS, 'debutant-2-catalogue.png') });
    await fenetre.locator('.modal-actions .btn-primary').click();
    await expect.poll(async () => (await donnees(p)).catalog.find((c) => c.label === 'Pince coupante')?.initialCost).toEqual(7);
    expect(erreurs).toEqual([]);
    await fermer();
  }, 120_000);

  it('Visites : une étape à lire posée sur une case de texte y met le curseur ; choisir dans la case qu\'elle éclaire n\'ouvre pas l\'essai', async () => {
    const { jeton, ent } = await personne(false);
    await commercant(jeton, ent);
    const { p, erreurs, fermer } = await ouvrir(jeton, ent, '#/guide');
    const etape = () => p.evaluate(() => (window as unknown as { Visite: { etapeCourante: () => { titre?: string } | null } }).Visite.etapeCourante()?.titre ?? '');
    const bulle = p.locator('#visite-bulle');
    const suivant = async (titre: string) => { await bulle.locator('.vb-suiv').click(); await expect.poll(etape).toBe(titre); };
    // « Ajouter au catalogue ce que tu vends », lancée depuis « Me guider ».
    await p.locator('#view li').filter({ hasText: 'Ajouter au catalogue ce que tu vends' }).locator('button').last().click();
    await expect.poll(etape).toBe('Ajouter au catalogue');
    // La visite ouvre la page et son onglet avant de poser sa bulle : on clique quand elle attend le geste, comme un humain
    // qui lit la bulle avant d'agir.
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/catalogue');
    await expect.poll(async () => net(await bulle.innerText())).toContain('J\'attends ton geste');
    await p.locator('#new').click();
    await expect.poll(etape).toBe('Son nom');
    await p.locator('#modal-root .modal input[name=label]').fill('Pince coupante');
    await suivant('Sa description');
    // Une étape à lire sur une case de texte : le curseur y est, la frappe ne part pas dans le vide.
    await expect.poll(() => p.evaluate(() => (document.activeElement as HTMLTextAreaElement | null)?.name ?? '')).toBe('description');
    await p.keyboard.type('Isolée 1000 V');
    expect(await p.locator('#modal-root .modal textarea[name=description]').inputValue()).toBe('Isolée 1000 V');
    await suivant('Son prix');
    await p.locator('#modal-root .modal #cat-ttc').fill('11.9');
    await expect.poll(() => p.locator('#modal-root .modal input[name=unitPrice]').inputValue()).toMatch(/^10(\.0+)?$/);
    await suivant('Ce que ça te coûte');
    await p.locator('#modal-root .modal input[name=unitCost]').fill('6');
    await suivant('Sa TVA et son unité');
    // La liste de l'unité, éclairée par l'étape : l'ouvrir et y choisir est le geste demandé, pas un essai.
    await p.locator('#modal-root .modal select[name=unit]').click();
    await p.locator('.lm-pop .combo-it').filter({ hasText: 'unité (u)' }).click();
    expect(await p.locator('#modal-root .modal select[name=unit]').inputValue()).toBe('u');
    await p.waitForTimeout(300);
    expect(await etape()).toBe('Sa TVA et son unité');
    expect(net(await bulle.innerText())).not.toMatch(/Vas-y, essaie|C'est fait/);
    expect(await bulle.getAttribute('class')).not.toMatch(/\bmini\b/);
    await suivant('Suivi en stock');
    // La case à cocher qu'elle éclaire, de même.
    await p.locator('#modal-root .modal input[name=tracked]').check();
    await p.waitForTimeout(300);
    expect(await etape()).toBe('Suivi en stock');
    expect(net(await bulle.innerText())).not.toMatch(/Vas-y, essaie|C'est fait/);
    await p.screenshot({ path: path.join(PHOTOS, 'debutant-2-visite.png') });
    expect(erreurs).toEqual([]);
    await fermer();
  }, 120_000);

  it('Avoir : choisir sa facture en reprend les lignes, sans écraser ce qu\'on a déjà tapé ; le bandeau d\'une facture émise passe à la ligne', async () => {
    const { jeton, ent } = await personne(true);
    const numero = await factureEmise(jeton, ent);
    // Le bandeau de la facture émise tient dans l'écran, sur un portable comme sur un grand écran.
    for (const [largeur, hauteur] of [[1280, 800], [1440, 900]]) {
      const { p, fermer } = await ouvrir(jeton, ent, '#/doc/f1', largeur, hauteur);
      const bandeau = p.locator('.lock-banner').first();
      await bandeau.waitFor();
      const mesure = await bandeau.evaluate((b) => {
        const vue = document.querySelector('#view') as HTMLElement;
        return { droite: b.getBoundingClientRect().right, vue: vue.getBoundingClientRect().right, deborde: vue.scrollWidth - vue.clientWidth };
      });
      expect(mesure.droite, `${largeur} px`).toBeLessThanOrEqual(mesure.vue);
      expect(mesure.deborde, `${largeur} px`).toBeLessThanOrEqual(0);
      if (largeur === 1440) await p.screenshot({ path: path.join(PHOTOS, 'debutant-2-bandeau.png') });
      await fermer();
    }

    const { p, erreurs, fermer } = await ouvrir(jeton, ent, '#/doc/new/avoir');
    const choisirFacture = async () => {
      await p.locator('[data-combo=creditOf] .combo-btn').click();
      await p.locator('[data-combo=creditOf] .combo-it').filter({ hasText: numero }).first().click();
    };
    const libelles = () => p.locator('#lines input[data-k=label]').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value));
    await choisirFacture();
    await expect.poll(libelles).toEqual(['Table en chêne massif']);
    expect(await p.locator('#lines input[data-k=qty]').first().inputValue()).toBe('2');
    expect(await p.locator('input[name=subject]').inputValue()).toBe(`Avoir sur facture ${numero} — Mobilier`);
    await expect.poll(async () => net(await p.locator('#toast').innerText())).toBe(`Les lignes de ${numero} sont reprises : retire ou baisse ce que cet avoir n'annule pas.`);
    await p.screenshot({ path: path.join(PHOTOS, 'debutant-2-avoir.png') });
    await fermer();

    // Une ligne déjà tapée : choisir la facture ne l'écrase pas.
    const autre = await ouvrir(jeton, ent, '#/doc/new/avoir');
    await autre.p.locator('#lines input[data-k=label]').first().fill('Geste commercial');
    await autre.p.locator('[data-combo=creditOf] .combo-btn').click();
    await autre.p.locator('[data-combo=creditOf] .combo-it').filter({ hasText: numero }).first().click();
    await autre.p.waitForTimeout(400);
    expect(await autre.p.locator('#lines input[data-k=label]').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value))).toEqual(['Geste commercial']);
    expect(erreurs).toEqual([]);
    await autre.fermer();
  }, 120_000);

  it('Dépense : sans fournisseur, elle se range sous « Dépenses diverses », une seule fiche pour toutes ; une facture d\'achat le demande toujours', async () => {
    const { jeton, ent } = await personne(false);
    const { p, erreurs, fermer } = await ouvrir(jeton, ent, '#/achat/new/-/depense');
    expect(net(await p.locator('[data-combo=supplierId] .combo-val').innerText())).toBe('— Aucun : dépenses diverses —');
    // Une pièce neuve : la page d'avant est partie quand le titre de la neuve est là (pas le premier titre venu).
    const nouvelle = async (route: string, titre: string) => {
      await p.evaluate((r) => { location.hash = r; }, route);
      await expect.poll(() => p.locator('#b-titre').innerText().catch(() => ''), { timeout: 15_000 }).toBe(titre);
    };
    // Enregistrée, la dépense quitte la page de création pour sa propre page.
    const ticket = async (libelle: string, montant: string) => {
      await p.locator('input[data-k=label]').first().fill(libelle);
      await p.locator('#b-ttc').fill(montant);
      await p.locator('#save').click();
      await expect.poll(() => p.evaluate(() => location.hash), { timeout: 15_000 }).toMatch(/^#\/achat\/(?!new)/);
    };
    await ticket('Ticket station-service', '45');
    await expect.poll(async () => (await donnees(p)).purchases.length).toBe(1);
    await p.screenshot({ path: path.join(PHOTOS, 'debutant-2-depense.png') });
    // Une seconde dépense sans fournisseur : la même fiche.
    await nouvelle('#/achat/new/-/depense', 'Nouvelle dépense');
    await ticket('Café pour le chantier', '6');
    await expect.poll(async () => (await donnees(p)).purchases.length).toBe(2);
    const d = await donnees(p);
    const divers = d.suppliers.filter((s) => s.name === 'Dépenses diverses');
    expect(divers.length).toBe(1);
    expect(divers[0]?.divers).toBe(true);
    expect(d.purchases.map((x) => x.supplierId)).toEqual([divers[0]?.id, divers[0]?.id]);

    // Une facture d'achat sans fournisseur est toujours refusée : la facture vient de quelqu'un.
    await nouvelle('#/achat/new/-/facture', 'Nouvelle facture d\'achat');
    expect(net(await p.locator('[data-combo=supplierId] .combo-val').innerText())).toBe('— Choisir un fournisseur —');
    await p.locator('input[data-k=label]').first().fill('Facture sans fournisseur');
    await p.locator('#save').click();
    await expect.poll(async () => net(await p.locator('#toast').innerText())).toBe('Choisis un fournisseur.');
    expect((await donnees(p)).purchases.length).toBe(2);
    expect(erreurs).toEqual([]);
    await fermer();
  }, 120_000);
});
