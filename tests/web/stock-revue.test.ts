// La revue du Stock (1.284.0, docs/revue-modules.md S1-S6) : un article sous son seuil se COMMANDE (un bon de commande
// fournisseur, au fournisseur de son dernier achat, à son dernier prix, pour ce qui ramène au « stock à atteindre »), pas
// une facture d'achat ; « Commander tout ce qui manque » fait un bon par fournisseur ; la fiche d'un article est dans la
// nouvelle DA, dit d'où il vient et combien il se vend, et pagine son historique.

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

describe('la revue du Stock', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-stock-revue-'));
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
  const n = (x: string) => ({ '~n': x });

  it('commander au dernier fournisseur et jusqu\'au stock à atteindre, un bon par fournisseur ; la fiche dit d\'où il vient et combien il se vend', async () => {
    const email = `stock-revue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Hédi Mabrouk', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Mabrouk' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const surLeServeur = async (collection: string) => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; contenu: Record<string, unknown> }[])
      .filter((o) => o.collection === collection).map((o) => o.contenu);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => {
      if (!location.protocol.startsWith('http')) return;
      sessionStorage.setItem('skanfact.jeton', j);
      localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false }));
    }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    // L'application s'ouvre une première fois sur l'entreprise neuve (elle y pose ses réglages de départ) avant qu'on
    // écrive derrière elle.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/stock`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await p.waitForTimeout(1500);
    await p.goto('about:blank');
    const auj = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis' }).format(new Date());
    const jour = (k: number) => new Date(Date.parse(auj) + k * 86_400_000).toISOString().slice(0, 10);
    // Le ciment a été acheté chez Grossiste Sfax il y a 30 jours (6 sacs à 16,800), puis chez Ciments du Nord il y a 5 jours
    // (2 sacs à 17,500) : son dernier fournisseur est Ciments du Nord, à 17,500. Il en reste 8, sous le seuil de 10 ; le
    // stock à atteindre est 40 → 32 à commander (l'ancienne règle disait 10 - 8 = 2). Le sable (acheté chez
    // Grossiste Sfax à 45) : 1 en stock, seuil 5, rien à atteindre → 4. Le gravier, jamais acheté : 0, seuil 3 → 3, sans
    // fournisseur. L'enduit a 30 mouvements : son historique se pagine.
    const o = (collection: string, cle: string, rang: number, contenu: Record<string, unknown>) => ({ collection, cle, rang, revision: null, contenu: { id: cle, ...contenu } });
    const achat = (cle: string, rang: number, supplierId: string, date: string, itemId: string, label: string, qty: number, prix: string) => o('purchases', cle, rang, {
      kind: 'facture', number: `FA-${cle}`, date, dueDate: date, supplierId, currency: 'DT', fees: 0, withholdingRate: 0, createdAt: Date.parse(date), payments: [],
      lines: [{ label, itemId, qty, unitPrice: n(prix), vatRate: 19, destination: 'stock', deductible: true }] });
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      o('suppliers', 's1', 0, { name: 'Grossiste Sfax' }), o('suppliers', 's2', 1, { name: 'Ciments du Nord' }),
      o('catalog', 'a1', 0, { label: 'Ciment gris 50 kg', unit: 'sac', unitPrice: n('25'), unitCost: n('16'), vatRate: 19, tracked: true, minStock: 10, stockCible: 40 }),
      o('catalog', 'a2', 1, { label: 'Sable lavé', unit: 'm³', unitPrice: n('60'), unitCost: n('44'), vatRate: 19, tracked: true, minStock: 5 }),
      o('catalog', 'a3', 2, { label: 'Gravier 15/25', unit: 'm³', unitPrice: n('70'), unitCost: n('52.5'), vatRate: 19, tracked: true, minStock: 3 }),
      o('catalog', 'a4', 3, { label: 'Enduit de façade', unit: 'sac', unitPrice: n('30'), unitCost: n('20'), vatRate: 19, tracked: true, minStock: 0 }),
      achat('p1', 0, 's1', jour(-30), 'a1', 'Ciment gris 50 kg', 6, '16.8'),
      achat('p2', 1, 's2', jour(-5), 'a1', 'Ciment gris 50 kg', 2, '17.5'),
      achat('p3', 2, 's1', jour(-10), 'a2', 'Sable lavé', 1, '45'),
      ...Array.from({ length: 30 }, (_, i) => o('stockAdjustments', `aj${i}`, i, { createdAt: Date.now() + i, date: jour(-40 + i), itemId: 'a4', qty: 1, unitCost: n('20'), source: 'ajustement', reference: '', note: `Réassort ${i + 1}` })),
    ] });
    expect(ecrit.statut, JSON.stringify(ecrit.corps)).toBe(200);
    // Les alertes : « À commander » suit le stock à atteindre ; le geste d'une ligne sous le seuil est « Commander… ».
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/stock`);
    await p.locator('#st-tabs button[data-tab="alertes"]').waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.locator('#st-tabs button[data-tab="alertes"]').click();
    await p.locator('#st-body tr[data-see]').first().waitFor();
    const lignes = await p.locator('#st-body tr[data-see]').evaluateAll((trs) => trs.map((tr) => [tr.querySelector('strong')?.textContent, tr.children[4]?.textContent?.trim(), tr.querySelector('button')?.textContent]));
    expect(lignes.sort()).toEqual([['Ciment gris 50 kg', '32', 'Commander…'], ['Gravier 15/25', '3', 'Commander…'], ['Sable lavé', '4', 'Commander…']]);
    expect(await p.locator('#st-body [data-achat]').count()).toBe(0);
    expect(net(await p.locator('#st-cmd-tout').innerText())).toBe('Commander tout ce qui manque (3 articles, 3 bons)');
    await p.screenshot({ path: path.join(PHOTOS, 'stock-revue-1-alertes.png') });

    // Une ligne : le bon s'ouvre chez Ciments du Nord, 32 sacs à 17,500 (le dernier prix, pas le coût du catalogue).
    await p.locator('#st-body [data-commander="a1"]').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/commandef/new');
    await p.locator('#cf-lines input[data-k=qty]').first().waitFor();
    expect(net(await p.locator('[data-combo=supplierId]').innerText())).toContain('Ciments du Nord');
    expect(await p.locator('#cf-lines input[data-k=label]').evaluateAll((x) => x.map((i) => (i as HTMLInputElement).value))).toEqual(['Ciment gris 50 kg']);
    expect(await p.locator('#cf-lines input[data-k=qty]').inputValue()).toBe('32');
    expect(Number(await p.locator('#cf-lines input[data-k=unitPrice]').inputValue())).toBe(17.5);
    expect(await surLeServeur('supplierOrders')).toEqual([]);

    // Tout ce qui manque : deux bons en brouillon et numérotés (un par fournisseur connu), et le gravier, sans fournisseur,
    // dans un bon ouvert à l'écran.
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/stock`);
    await p.locator('#st-tabs button[data-tab="alertes"]').waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.locator('#st-tabs button[data-tab="alertes"]').click();
    await p.locator('#st-cmd-tout').click();
    await expect.poll(async () => (await surLeServeur('supplierOrders')).length, { timeout: 15_000 }).toBe(2);
    const bons = (await surLeServeur('supplierOrders')).map((b) => ({ f: b.supplierId, statut: b.status, numero: /^BCF/.test(String(b.number)),
      lignes: (b.lines as { itemId: string; qty: number; unitPrice: unknown }[]).map((l) => [l.itemId, l.qty, Number(typeof l.unitPrice === 'object' ? (l.unitPrice as { '~n': string })['~n'] : l.unitPrice)]) }));
    expect(bons.sort((a, b) => String(a.f).localeCompare(String(b.f)))).toEqual([
      { f: 's1', statut: 'brouillon', numero: true, lignes: [['a2', 4, 45]] },
      { f: 's2', statut: 'brouillon', numero: true, lignes: [['a1', 32, 17.5]] },
    ]);
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/commandef/new');
    await p.locator('#cf-lines input[data-k=qty]').first().waitFor();
    expect(await p.locator('#cf-lines input[data-k=label]').inputValue()).toBe('Gravier 15/25');
    expect(await p.locator('#cf-lines input[data-k=qty]').inputValue()).toBe('3');
    expect(net(await p.locator('[data-combo=supplierId]').innerText())).not.toContain('Grossiste');

    // La fiche du ciment : chemin, quatre chiffres, d'où il vient, combien il se vend ; l'étape suivante est de commander.
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/article/a1`);
    await p.locator('#art-resume .mg-chiffre').first().waitFor({ timeout: 20_000 });
    await plusTard(p);
    expect(net(await p.locator('#view .page-head.lf-tete .chemin').innerText())).toBe('Accueil Stock Ciment gris 50 kg');
    expect((await p.locator('#art-resume .mg-chiffre span.mu').allInnerTexts()).map(net)).toEqual(['En stock i', 'Coût moyen pondéré i', 'Valeur du stock', 'Marge unitaire']);
    expect(net(await p.locator('#art-resume .mg-chiffre').first().innerText())).toBe('En stock i 8 sacs seuil 10 — 32 à commander');
    expect(net(await p.locator('#art-dernier-achat').innerText())).toMatch(/Ciments du Nord · 17,500 DT HT l'unité · le \d\d\/\d\d\/\d{4} · FA-p2/);
    expect(net(await p.locator('#art-vendu').innerText())).toBe('Vendu sur 12 mois i Aucune vente facturée depuis un an.');
    expect(await p.locator('#view .page-head .actions .btn-primary').allInnerTexts()).toEqual(['Commander…']);
    await p.screenshot({ path: path.join(PHOTOS, 'stock-revue-2-fiche.png') });
    await p.locator('#art-commander').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/commandef/new');
    await p.locator('#cf-lines input[data-k=qty]').first().waitFor();
    expect(await p.locator('#cf-lines input[data-k=qty]').inputValue()).toBe('32');

    // L'enduit : 30 mouvements, 25 par page ; rien à commander, le bouton principal est « + Mouvement ».
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/article/a4`);
    await p.locator('#art-hist table tbody tr').first().waitFor({ timeout: 20_000 });
    expect(await p.locator('#art-hist table tbody tr').count()).toBe(25);
    expect(net(await p.locator('#art-hist .pg-info').innerText())).toBe('1–25 sur 30 mouvements');
    await p.locator('#art-hist [data-pg=next]').click();
    await expect.poll(() => p.locator('#art-hist table tbody tr').count()).toBe(5);
    expect(await p.locator('#view .page-head .actions .btn-primary').allInnerTexts()).toEqual(['+ Mouvement']);
    expect(net(await p.locator('#art-dernier-achat').innerText())).toContain('Aucun achat ni réception de cet article');

    // L'inventaire appliqué laisse son résumé à l'écran (date, articles comptés, écart en valeur) ; sans cabinet relié, pas
    // de « Prévenir mon comptable » : il n'y a personne à prévenir.
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/stock`);
    await p.locator('#st-tabs button[data-tab="inventaire"]').waitFor({ timeout: 20_000 });
    await plusTard(p);
    await p.locator('#st-tabs button[data-tab="inventaire"]').click();
    await p.locator('#st-body .inv-in[data-iid="a2"]').fill('3');
    await p.locator('#inv-apply').click();
    await p.getByRole('button', { name: 'Enregistrer', exact: true }).last().click();
    await p.locator('#inv-fait').waitFor({ timeout: 10_000 });
    expect(net(await p.locator('#inv-fait p').innerText())).toMatch(/^Inventaire du \d\d\/\d\d\/\d{4} enregistré : 1 article compté, 1 écart pour 90,000 DT au coût moyen\.$/);
    expect(await p.locator('#inv-prevenir').count()).toBe(0);
    await expect.poll(async () => (await surLeServeur('stockAdjustments')).filter((x) => x.source === 'inventaire').length, { timeout: 15_000 }).toBe(1);

    // Au téléphone : rien ne déborde de la fiche.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/article/a1`);
    await p.locator('#art-resume .mg-chiffre').first().waitFor({ timeout: 20_000 });
    await p.waitForTimeout(400);
    const debord = await p.evaluate(() => {
      const largeur = document.documentElement.clientWidth;
      const hors = [...document.querySelectorAll('#art-resume .mg-chiffre, #art-decide')].filter((x) => x.getBoundingClientRect().right > largeur + 0.5).length;
      return { page: document.documentElement.scrollWidth - largeur, hors };
    });
    expect(debord).toEqual({ page: 0, hors: 0 });
    await p.screenshot({ path: path.join(PHOTOS, 'stock-revue-3-telephone.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
