// Une commande livrée en deux fois, puis ses deux bons facturés en une facture, à la souris (brique 86 ;
// 14 § 3.2 ; web/v10/livraisons.txt). Ce que le parcours vérifie, écran ET serveur :
//   - le bon de livraison tiré de la commande reprend toute la commande ; on n'en livre qu'une partie ;
//   - la commande se dit « livrée en partie », son panneau « Livraisons » compte ligne par ligne, et
//     « Livrer le reste » fait un second bon qui ne reprend QUE le reste ; puis la commande est livrée ;
//   - « Facturer des bons… » : une facture pour les deux bons, chaque ligne de commande en une ligne,
//     égale à la commande au millime ; les bons imprimés sur elle ; émise par le serveur au même net ;
//   - facturés, les bons ne se proposent plus, et le serveur a scellé la facture avec ses bons.
// Les données discriminent : 2,5 t livrées 1,25 + 1,25 à 2 350,750 (deux lignes feraient un millime de plus).

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

describe('une commande livrée en deux fois, et ses bons facturés en une facture, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-livraisons-'));
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
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  // Le menu d'une ligne de liste, et l'une de ses actions (reconnue à ce qu'elle dit).
  const action = async (p: Page, id: string, libelle: string) => {
    await p.locator(`[data-rowmenu="${id}"]`).first().click();
    await p.getByRole('menuitem').filter({ hasText: libelle }).first().click();
  };
  // Les quantités du bon ouvert, et les changer comme on tape.
  const quantites = (p: Page) => p.locator('#lines tr').evaluateAll((trs) => trs.map((tr) => [
    (tr.querySelector('[data-k=label]') as HTMLInputElement | null)?.value ?? '', (tr.querySelector('[data-k=qty]') as HTMLInputElement | null)?.value ?? '']));
  const taperQuantite = async (p: Page, rang: number, q: string) => {
    const champ = p.locator('#lines tr').nth(rang).locator('[data-k=qty]');
    await champ.fill(q);
    await champ.dispatchEvent('change');
  };
  // Émettre (le statut « Émis ») et enregistrer le bon ouvert ; le bon garde son numéro.
  const emettreLeBon = async (p: Page) => {
    await p.locator('#f-head select[name=status]').selectOption('émis');
    await p.locator('#save').click();
    await expect.poll(async () => net(await p.locator('#view h1').first().innerText()), { timeout: 10_000 }).toMatch(/^Bon de livraison BL-/);
    return net(await p.locator('#view h1').first().innerText()).replace(/^Bon de livraison /, '').replace(/ .*$/, '');
  };

  it('Nadia livre la commande en deux fois, puis facture les deux bons en une facture égale à la commande', async () => {
    const email = `nadia-livraisons-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    // Le client et sa commande reçue : 100 sacs de ciment, 2,5 t de fer, un transport.
    const aujourdhui = new Date().toISOString().slice(0, 10);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c1', rang: 0, revision: null, contenu: { id: 'c1', name: 'Entreprise Lac Bâtiment', matricule: '1234567A/A/M/000', address: 'Rue du Lac, Tunis' } },
      { collection: 'documents', cle: 'bc1', rang: 0, revision: null, contenu: {
        id: 'bc1', type: 'commande', number: 'BC-2026-001', status: 'reçue', date: aujourdhui, clientId: 'c1', subject: 'Chantier Lac 2', createdAt: Date.now(),
        lines: [
          { label: 'Ciment gris 50 kg', description: '', qty: 100, unit: 'sac', unitPrice: { '~n': '18.5' }, vatRate: 19 },
          { label: 'Fer à béton 12 mm', description: '', qty: { '~n': '2.5' }, unit: 't', unitPrice: { '~n': '2350.75' }, vatRate: 19 },
          { label: 'Transport', description: '', qty: 1, unit: 'course', unitPrice: 60, vatRate: 19 },
        ], discountRate: 0, withholdingRate: 0, payments: [],
      } },
    ] });
    expect(ecrit.statut).toBe(200);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/autres/commande`);
    await expect.poll(() => p.locator('#view h1').first().innerText(), { timeout: 20_000 }).toBe('Proforma, bons et contrats');
    await plusTard(p);

    // 1. Le premier bon reprend toute la commande ; on ne livre que ce qui est en stock.
    await action(p, 'bc1', 'Établir le bon de livraison');
    await expect.poll(async () => net(await p.locator('#view h1').first().innerText()), { timeout: 10_000 }).toMatch(/^Bon de livraison/);
    expect(await quantites(p)).toEqual([['Ciment gris 50 kg', '100'], ['Fer à béton 12 mm', '2.5'], ['Transport', '1']]);
    await taperQuantite(p, 0, '60');
    await taperQuantite(p, 1, '1.25');
    const bl1 = await emettreLeBon(p);

    // 2. La commande se dit livrée en partie ; son panneau compte ; « Livrer le reste ».
    await p.evaluate(() => { location.hash = '#/doc/bc1'; });
    const panneau = p.locator('#livraisons-panel');
    await expect.poll(async () => net(await panneau.innerText()), { timeout: 10_000 })
      .toBe(`Livraisons i DÉSIGNATION COMMANDÉ LIVRÉ RESTE Ciment gris 50 kg (sac) 100 60 40 Fer à béton 12 mm (t) 2,5 1,25 1,25 Transport (course) 1 1 0 Bon de livraison : ${bl1} (émis, ${aujourdhui.split('-').reverse().join('/')}) Livrer le reste Reste à livrer sur 2 lignes : Ciment gris 50 kg (40 sac), …`);
    await plusTard(p);
    // Livrer le reste est l'étape suivante : « Transformer ▾ » est le bouton principal, et il le dit.
    expect(await p.locator('#conv-btn').getAttribute('class')).toContain('btn-primary');
    expect(net(await p.locator('#conv-list').evaluate((l) => l.textContent ?? ''))).toContain('Livrer le reste');
    await panneau.scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(PHOTOS, 'livraisons-1-commande-en-partie.png') });
    // Le menu de la commande, dans sa liste, propose la même chose.
    await p.evaluate(() => { location.hash = '#/autres/commande'; });
    await expect.poll(async () => net(await p.locator('#list-wrap').innerText()), { timeout: 10_000 }).toMatch(/BC-2026-001 .*livrée en partie/);
    await p.locator('[data-rowmenu="bc1"]').first().click();
    expect(net(await p.getByRole('menu').innerText())).toContain('Livrer le reste Reste à livrer sur 2 lignes');
    await p.keyboard.press('Escape');
    await p.evaluate(() => { location.hash = '#/doc/bc1'; });
    await expect.poll(async () => net(await panneau.innerText()), { timeout: 10_000 }).toContain('Livrer le reste');
    await panneau.getByRole('button', { name: 'Livrer le reste', exact: true }).click();
    await expect.poll(async () => net(await p.locator('#view h1').first().innerText()), { timeout: 10_000 }).toMatch(/^Bon de livraison/);
    expect(await quantites(p)).toEqual([['Ciment gris 50 kg', '40'], ['Fer à béton 12 mm', '1.25']]);
    const bl2 = await emettreLeBon(p);
    expect(bl2).not.toBe(bl1);

    // 3. La commande est livrée : la liste le dit, et son menu ne propose plus de livrer.
    await p.evaluate(() => { location.hash = '#/autres/commande'; });
    await expect.poll(async () => net(await p.locator('#list-wrap').innerText()), { timeout: 10_000 }).toMatch(/BC-2026-001 .*livrée/);
    await p.locator('[data-rowmenu="bc1"]').first().click();
    expect(net(await p.getByRole('menu').innerText())).toContain(`Voir ${bl2}`);
    expect(net(await p.getByRole('menu').innerText())).not.toContain('Livrer le reste');
    await p.keyboard.press('Escape');
    await p.locator('#st').selectOption('livrée');
    await expect.poll(async () => net(await p.locator('#list-wrap').innerText()), { timeout: 10_000 }).toMatch(/^.*BC-2026-001 .*livrée/);
    await p.locator('#st').selectOption('');

    // 4. Les bons attendent leur facture : « Facturer des bons… », les deux cochés, une facture.
    await p.evaluate(() => { location.hash = '#/autres/livraison'; });
    const facturer = p.getByRole('button', { name: 'Facturer des bons…', exact: true });
    await expect.poll(() => facturer.getAttribute('class'), { timeout: 10_000 }).toContain('btn-primary');
    const bons = (await admin.query(`select cle, contenu->>'number' numero from socle.dossier_v10 where entreprise = $1 and collection = 'documents' and contenu->>'type' = 'livraison'`, [ent])).rows as { cle: string; numero: string }[];
    await p.locator(`[data-rowmenu="${bons.find((b) => b.numero === bl1)?.cle}"]`).first().click();
    expect(net(await p.getByRole('menu').innerText())).toContain('Facturer avec d\'autres bons…');
    await p.keyboard.press('Escape');
    await facturer.click();
    const fenetre = p.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').first().innerText()).toMatch(/^Facturer des bons de livraison/);
    await expect.poll(async () => net(await fenetre.locator('#fb-ok').innerText())).toBe('Facturer 2 bons');
    // Le montant de LA facture, et pourquoi il a un millime de moins que la somme des bons (4 108,438 + 3 678,438).
    expect(net(await fenetre.locator('#fb-total').innerText())).toBe('La facture : 7 786,875 DT HT. 0,001 DT de moins que la somme des bons : une ligne de commande livrée en plusieurs fois s\'y facture en une seule ligne, arrondie une fois.');
    await p.screenshot({ path: path.join(PHOTOS, 'livraisons-2-facturer-les-bons.png') });
    await fenetre.locator('#fb-ok').click();
    await expect.poll(async () => net(await p.locator('#view h1').first().innerText()), { timeout: 10_000 }).toMatch(/^Facture/);
    // Chaque ligne de commande en une ligne : la facture égale la commande (1 850 + 5 876,875 + 60 = 7 786,875 HT).
    expect(await quantites(p)).toEqual([['Ciment gris 50 kg', '100'], ['Fer à béton 12 mm', '2.5'], ['Transport', '1']]);
    await expect.poll(async () => net(await p.frameLocator('#preview').locator('body').innerText()), { timeout: 10_000 }).toContain(`BONS DE LIVRAISON ${bl1}, ${bl2} FACTURÉ À Entreprise Lac Bâtiment`);
    await p.screenshot({ path: path.join(PHOTOS, 'livraisons-3-facture.png') });

    // 5. Émise par le serveur, au net de l'écran : 7 786,875 HT, TVA 19 % 1 479,506, timbre 1 : 9 267,381.
    await p.locator('#issue').click();
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => net(await p.locator('#view h1').first().innerText()), { timeout: 20_000 }).toMatch(/^Facture FAC-2026-001/);
    expect((await admin.query(`select numero_texte, net_a_payer from ventes.piece where entreprise = $1 and type = 'facture'`, [ent])).rows)
      .toEqual([{ numero_texte: 'FAC-2026-001', net_a_payer: 9267381n }]);
    const facture = (await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'documents' and contenu->>'type' = 'facture'`, [ent])).rows[0].contenu as { bonsLivraison: { number: string }[] };
    expect(facture.bonsLivraison.map((b) => b.number)).toEqual([bl1, bl2]);
    // Une copie de la facture (« Dupliquer ») est une autre vente : elle ne reprend pas les bons de celle-ci.
    await p.locator('#more-btn').click();
    await p.locator('#more-list #dup').click();
    await expect.poll(async () => net(await p.locator('#view h1').first().innerText()), { timeout: 10_000 }).toBe('Facture (brouillon)');
    const copies = async () => (await admin.query(`select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'documents' and contenu->>'type' = 'facture' and coalesce(contenu->>'number', '') = ''`, [ent])).rows as { contenu: Record<string, unknown> }[];
    await expect.poll(async () => (await copies()).length, { timeout: 10_000 }).toBe(1);
    expect((await copies())[0]?.contenu.bonsLivraison).toBeUndefined();

    // 6. Facturés, les bons ne se proposent plus.
    await p.evaluate(() => { location.hash = '#/autres/livraison'; });
    await expect.poll(async () => net(await p.locator('#view .page-head').innerText()), { timeout: 10_000 }).not.toContain('Facturer des bons');
    await p.screenshot({ path: path.join(PHOTOS, 'livraisons-4-bons-factures.png') });
    expect(erreurs).toEqual([]);
    await cn.close();

    // 7. Au téléphone : le panneau de la commande tient dans la largeur (son tableau défile dans son cadre).
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'fr-FR' });
    await tel.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const t = await tel.newPage();
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/bc1`);
    const panneauTel = t.locator('#livraisons-panel');
    await expect.poll(async () => net(await panneauTel.innerText()), { timeout: 20_000 }).toMatch(/^Livraisons i DÉSIGNATION COMMANDÉ LIVRÉ RESTE Ciment gris 50 kg \(sac\) 100 100 0 /);
    await plusTard(t);
    await panneauTel.scrollIntoViewIfNeeded();
    expect(await t.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await t.screenshot({ path: path.join(PHOTOS, 'livraisons-5-telephone.png') });
    await tel.close();
  }, 180_000);
});
