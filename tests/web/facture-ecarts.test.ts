// Les écarts des maquettes de la facture et de la liste (docs/maquettes/facture.html, liste.html), revus le 27/10/2026,
// à la souris, sur l'entreprise d'essai :
//   - la liste écrit ses montants en dinars sans « DT » (la colonne le dit) ; une pièce en devise garde son symbole
//     (« 1 100,00 € ») ; le total de la sélection écrit « DT » en petit après le net, le reste sans unité ; la tuile
//     « À encaisser » dit « dont 599,50 € comptés au taux » ; la bulle des filtres est le rond « ? » ;
//   - une facture en euros parle en « € », jamais en « EUR », dans la phrase de son en-tête ;
//   - la carte d'un client en retard porte la puce rouge « doit … dont … en retard » et son « Relancer », qui ouvre les
//     relances sur ce client ;
//   - une pièce neuve sans ligne n'imprime pas encore de timbre ; une pièce émise lit son unité en toutes lettres.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('les écarts des maquettes de la facture et de la liste, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-facture-ecarts-'));
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
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 }).catch(() => undefined);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const net = (s: string) => s.replace(/\s+/g, ' ').trim();
  const jour = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

  it('la liste et la facture parlent comme leurs maquettes : montants, devises, retard du client, timbre, unité', async () => {
    const email = `sarra-ecarts-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra Mansour', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).corps.id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    expect((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).statut).toBe(200);
    // Deux clients : la clinique, en retard de vingt jours sur 12 heures de maintenance ; Nova, qui paie en euros
    // (1 100,00 € au taux 3,350, 500,50 € reçus : reste 599,50 €).
    const clients = [{ id: 'c-jas', name: 'Clinique Les Jasmins' }, { id: 'c-nova', name: 'Nova Digital Ltd' }];
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: clients.map((c, i) => ({ collection: 'clients', cle: c.id, rang: 20 + i, revision: null, contenu: c })) });
    const pieces = [
      { id: 'f1', net: '647.955', clientId: 'c-jas', dueDate: jour(-20), currency: 'DT', lines: [{ label: 'Maintenance du réseau', description: '', qty: 12, unit: 'h', unitPrice: { '~n': '45.375' }, vatRate: 19 }] },
      { id: 'f2', net: '1100.00', clientId: 'c-nova', dueDate: jour(10), currency: 'EUR', exchangeRate: { '~n': '3.35' }, lines: [{ label: 'Web application penetration test', description: '', qty: 1, unit: 'j', unitPrice: 1100, vatRate: 0 }] },
    ];
    for (const [i, { net: netAPayer, ...d }] of pieces.entries()) {
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: { type: 'facture', number: '', status: 'brouillon', date: jour(-30), createdAt: 10 + i,
        subject: `Pièce ${i + 1}`, discountRate: 0, withholdingRate: 0, applyStamp: false, payments: [], ...d }, client: clients.find((c) => c.id === d.clientId), revision: null, rang: i, netAPayer });
      expect(String((e.corps.contenu as Record<string, unknown> | undefined)?.number ?? e.corps.motif)).toMatch(/^FAC-/);
    }
    const objets = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[];
    const f2 = objets.find((o) => o.collection === 'documents' && o.cle === 'f2');
    if (!f2) throw new Error('f2 absente');
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: 'f2', rang: 1, revision: f2.revision,
      contenu: { ...f2.contenu, payments: [{ id: 'pa1', date: jour(-5), amount: { '~n': '500.5' }, method: 'virement' }] } }] });
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));

    // 1. La liste.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/factures`);
    await p.locator('#list-wrap tr[data-id]').first().waitFor({ timeout: 30_000 });
    await plusTard(p);
    const annee = p.locator('#lf-filtres select').filter({ hasText: 'Toutes les années' });
    if (await annee.count()) { await annee.selectOption(''); await p.waitForTimeout(300); }
    const enDevise = p.locator('#list-wrap tr[data-id]:has(small.dv)');
    await expect.poll(() => enDevise.count(), { timeout: 10_000 }).toBeGreaterThan(0);
    const montantDevise = net(await enDevise.first().locator('td.cm').innerText());
    expect(montantDevise).toMatch(/^\d[\d\s]*,\d\d € [\d\s]+,\d{3} DT au taux \d+,\d{3}$/);
    // Les autres lignes, en dinars : le montant seul, la colonne dit l'unité.
    const enDinars = await p.locator('#list-wrap tr[data-id]:not(:has(small.dv)) td.cm').allInnerTexts();
    expect(enDinars.length).toBe(1);
    for (const m of enDinars) expect(net(m)).toMatch(/^[\d\s]+,\d{3}$/);
    // Le total de la sélection : « DT » en petit après le net, le reste sans unité.
    const pied = p.locator('#list-wrap tfoot td.r');
    expect(net(await pied.nth(0).innerText())).toMatch(/^[\d\s]+,\d{3} DT$/);
    expect(await pied.nth(0).locator('small.dv').innerText()).toBe('DT');
    expect(net(await pied.nth(1).innerText())).toMatch(/^[\d\s]+,\d{3}$/);
    // La tuile « À encaisser » : la part en euros dite en « € ».
    const tuile = net(await p.locator('#lf-tuiles .tuile.large .tu-s').innerText());
    expect(tuile).toMatch(/^dont [\d\s]+,\d\d € comptés au taux de la facture/);
    expect(tuile).not.toContain('EUR');
    // La bulle des filtres : le rond « ? » (un dessin, pas la lettre « i »), qui s'ouvre au clic.
    const aide = p.locator('#lf-filtres button.i');
    expect(await aide.getAttribute('class')).toContain('i-b');
    expect(await aide.locator('svg').count()).toBe(1);
    expect(net(await aide.innerText())).toBe('');
    await aide.click();
    await expect.poll(() => p.getByText('La recherche porte sur le numéro').count()).toBeGreaterThan(0);
    await p.keyboard.press('Escape');
    await p.screenshot({ path: path.join(PHOTOS, 'facture-ecarts-1-liste.png') });

    // 2. La facture en euros : sa phrase dit « € reçus, reste … € ».
    await enDevise.first().locator('td.cn').click();
    await expect.poll(() => p.locator('.ed-phrase').first().innerText().then(net).catch(() => ''), { timeout: 20_000 }).toMatch(/,\d\d € reçus, reste [\d\s]+,\d\d €/);
    expect(await p.locator('.ed-phrase').first().innerText()).not.toContain('EUR');
    // Émise, ses lignes lisent leur unité en toutes lettres, sans liste à dérouler.
    expect(await p.locator('#lines select[data-k=unit]').count()).toBe(0);
    const unites = (await p.locator('#lines .unite-lue').allInnerTexts()).map(net);
    expect(unites.length).toBeGreaterThan(0);
    expect(unites).toEqual(['jour']);

    // 3. Une facture neuve : sans ligne, l'aperçu n'imprime pas encore le timbre.
    await p.evaluate(() => { location.hash = '#/doc/new/facture'; });
    await expect.poll(() => p.evaluate(() => document.activeElement?.id), { timeout: 20_000 }).toBe('ed-pq-q');
    const apercu = p.frameLocator('#preview');
    await expect.poll(() => apercu.locator('body').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toContain('Total');

    // 4. Pour un client en retard, sa carte le dit, avec « Relancer » qui ouvre ses relances.
    await p.locator('#ed-pq-q').fill('Jasmins');
    await p.locator('#ed-pq-liste [role=option][data-cl]').first().click();
    const puce = p.locator('.ed-chip.rouge').filter({ hasText: 'en retard de' });
    await expect.poll(() => puce.innerText().then(net).catch(() => ''), { timeout: 10_000 }).toMatch(/^doit [\d\s]+,\d{3} DT · dont [\d\s]+,\d{3} DT en retard de \d+ jours? · Relancer$/);
    await p.screenshot({ path: path.join(PHOTOS, 'facture-ecarts-2-retard.png') });
    // Le client choisi (son timbre coché d'office), toujours sans ligne : l'aperçu ne compte pas encore le timbre.
    await expect.poll(() => apercu.locator('body').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toContain('Clinique Les Jasmins');
    await p.waitForTimeout(500);
    expect(net(await apercu.locator('body').innerText())).not.toMatch(/timbre/i);
    // Une ligne remplie : le timbre revient sur l'aperçu.
    if (!(await p.locator('[data-k=label]').count())) await p.locator('#ed-ajout').press('Enter');
    await p.locator('#lines tr:first-child input[data-k="label"]').fill('Maintenance du réseau');
    await p.locator('#lines tr:first-child input[data-k="unitPrice"]').fill('120');
    await p.locator('#lines tr:first-child input[data-k="unitPrice"]').press('Tab');
    await expect.poll(() => apercu.locator('body').innerText().then(net).catch(() => ''), { timeout: 10_000 }).toMatch(/timbre/i);
    await puce.getByRole('button', { name: 'Relancer', exact: true }).click();
    // Le brouillon commencé : la fenêtre demande avant de partir.
    const quitter = p.locator('#modal-root .modal').last().getByRole('button');
    await expect.poll(() => quitter.count(), { timeout: 5_000 }).toBeGreaterThan(0);
    await p.locator('#modal-root .modal').last().getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click();
    await expect.poll(() => p.locator('#rel-q').inputValue().catch(() => ''), { timeout: 15_000 }).toBe('Clinique Les Jasmins');
    expect(erreurs).toEqual([]);
  }, 180_000);

  // (1.162.0, revue des écarts de la maquette facture) Ce que la revue a corrigé et qu'aucun test ne tenait encore : le
  // mois clôturé (son cadenas, « Refais-la »), l'étape « Envoyée » qui dit « pas encore vue », l'heure dans l'historique,
  // l'encours (« c'est toi qui décides ») et le stock (« dans le dépôt principal ») avec leurs icônes ; puis l'affaire
  // d'une facture émise, qui se choisit encore (maquette « Affaire d'une facture émise »).
  it('la facture émise et son brouillon parlent comme la maquette : mois clôturé, pas encore vue, l\'heure, encours, stock, affaire', async () => {
    const email = `sarra-ecarts162-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra Mansour', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).corps.id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    expect((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).statut).toBe(200);
    // La clinique, plafonnée à 500 DT d'encours ; une caméra suivie en stock, dont il ne reste rien ; une affaire en cours.
    const client = { id: 'c-jas', name: 'Clinique Les Jasmins', email: 'compta@jasmins.tn', creditLimit: 500 };
    const debutMois = (d: number) => `${jour(d).slice(0, 7)}-01`;
    const facture = debutMois(-62);
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: client.id, rang: 20, revision: null, contenu: client },
      { collection: 'catalog', cle: 'cam', rang: 0, revision: null, contenu: { id: 'cam', label: 'Caméra IP extérieure', unit: 'u', unitPrice: { '~n': '245.5' }, unitCost: { '~n': '180' }, vatRate: 19, tracked: true } },
      { collection: 'projects', cle: 'aff', rang: 0, revision: null, contenu: { id: 'aff', name: 'Réseau de la clinique', clientId: client.id, status: 'en cours', startDate: facture } },
    ] });
    const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: facture, dueDate: facture, createdAt: 10,
      subject: 'Maintenance du réseau', discountRate: 0, withholdingRate: 0, applyStamp: false, payments: [], clientId: client.id, currency: 'DT',
      emails: [{ date: facture, to: client.email, kind: 'facture' }],
      lines: [{ label: 'Maintenance du réseau', description: '', qty: 12, unit: 'h', unitPrice: { '~n': '45.375' }, vatRate: 19 }] }, client, revision: null, rang: 0, netAPayer: '647.955' });
    expect(String((e.corps.contenu as Record<string, unknown> | undefined)?.number ?? e.corps.motif)).toMatch(/^FAC-/);
    // Le mois de la facture est clôturé (jusqu'au dernier jour du mois suivant).
    const fin = new Date(Date.UTC(Number(facture.slice(0, 4)), Number(facture.slice(5, 7)) + 1, 0)).toISOString().slice(0, 10);
    const cl = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: '_racine', cle: 'closedUntil', rang: null, revision: null, contenu: fin }] });
    expect(cl.statut).toBe(200);
    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));

    // 1. Un brouillon daté dans le mois clôturé : le cadenas, et le geste qui ne perd rien (une pièce émise, elle, est déjà
    // verrouillée : son bandeau est celui de la pièce émise).
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: 'b0', rang: 2, revision: null, contenu: { id: 'b0', type: 'facture', number: '', status: 'brouillon',
      date: facture, dueDate: facture, createdAt: 5, subject: 'Oubli d\'août', discountRate: 0, withholdingRate: 0, applyStamp: true, payments: [], clientId: client.id, currency: 'DT',
      lines: [{ label: 'Câble réseau', description: '', qty: 1, unit: 'u', unitPrice: { '~n': '12' }, vatRate: 19 }] } }] });
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/b0`);
    await plusTard(p);
    const clos = p.locator('#clos-banner');
    await clos.waitFor({ timeout: 20_000 });
    expect(net(await clos.innerText())).toMatch(/^\S+ est clôturé : ce brouillon daté du \d\d\/\d\d ne se modifie plus Une saisie dans un mois clôturé changerait une TVA déjà déclarée\. Refais-le à la date d'aujourd'hui : rien n'est perdu\. Voir les clôtures$/);
    expect(await clos.locator(':scope > svg').count()).toBe(1);
    // L'étape « Envoyée » d'une facture dont le lien a été donné : sa date, et « pas encore vue » (jamais ouvert).
    expect((await api('POST', `/entreprises/${ent}/espace/liens`, jeton, { client: client.id, piece: 'f1' })).statut).toBe(201);
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
    await plusTard(p);
    await expect.poll(() => p.locator('#ed-frise li.fait[data-k=envoyee]').innerText().then(net).catch(() => ''), { timeout: 15_000 }).toContain('pas encore vue');
    // L'historique dit l'heure de l'émission.
    await p.locator('#more-btn').click();
    await p.getByRole('menuitem', { name: /^Historique/ }).click();
    const histo = p.locator('#ed-histo-p');
    await histo.waitFor();
    expect((await histo.locator('.h-l small').allInnerTexts()).map(net).some((x) => /^\d\d\/\d\d · \d{1,2} h \d\d$/.test(x))).toBe(true);
    await p.keyboard.press('Escape');

    // 2. L'affaire d'une facture émise se choisit encore, depuis le résumé ; elle ne s'imprime pas.
    const ligneAff = p.locator('#lecture-piece .lp-ligne', { hasText: 'Affaire' });
    expect(net(await ligneAff.innerText())).toBe('Affaire Aucune · Ranger dans une affaire · ne s\'imprime pas');
    await ligneAff.getByRole('button', { name: 'Ranger dans une affaire' }).click();
    await p.locator('.pop-o', { hasText: 'Réseau de la clinique' }).click();
    await expect.poll(async () => net(await p.locator('#toast').innerText().catch(() => ''))).toContain('compte désormais dans « Réseau de la clinique »');
    await expect.poll(() => ligneAff.innerText().then(net)).toBe('Affaire Réseau de la clinique · Changer · ne s\'imprime pas');
    await p.screenshot({ path: path.join(PHOTOS, 'facture-ecarts-3-affaire.png') });
    type Objet = { collection: string; cle: string; contenu: Record<string, unknown> };
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[]).find((o) => o.collection === 'documents' && o.cle === 'f1')?.contenu.projectId, { timeout: 10_000 }).toBe('aff');

    // 3. Un brouillon pour la clinique, avec la caméra : l'encours dit qui décide, le stock nomme son dépôt.
    const pb1 = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: 'b1', rang: 1, revision: null, contenu: { id: 'b1', type: 'facture', number: '', status: 'brouillon',
      date: jour(0), dueDate: jour(30), createdAt: 20, subject: 'Caméras', discountRate: 0, withholdingRate: 0, applyStamp: true, payments: [], clientId: client.id, currency: 'DT',
      lines: [{ label: 'Caméra IP extérieure', description: '', qty: 2, unit: 'u', unitPrice: { '~n': '245.5' }, vatRate: 19, itemId: 'cam' }] } }] });
    expect(pb1.statut).toBe(200);
    // La page est déjà ouverte : seul le « # » change, il faut la recharger pour qu'elle lise la pièce neuve.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/b1`);
    await p.reload();
    await plusTard(p);
    const encours = p.locator('.bandeau', { hasText: 'encours autorisé' });
    await encours.waitFor({ timeout: 20_000 });
    expect(net(await encours.innerText())).toMatch(/ou émets quand même : c'est toi qui décides\./);
    expect(await encours.locator(':scope > svg').count()).toBe(1);
    const stock = p.locator('.bandeau', { hasText: 'Stock insuffisant' });
    expect(net(await stock.locator('b').innerText())).toBe('Stock insuffisant sur « Caméra IP extérieure » dans le dépôt principal');
    expect(await stock.locator(':scope > svg').count()).toBe(1);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
