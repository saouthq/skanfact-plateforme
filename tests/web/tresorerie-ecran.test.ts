// La trésorerie dans la nouvelle DA (1.266.0, Skander 03/11/2026 : « go faire tout ») : à la souris, sur une entreprise neuve.
//   - les comptes en cartes, le bouton principal calculé (pointer le relevé, puis « Voir ce qui arrive » sous le seuil) ;
//   - les onglets en noir, les filtres en gris (Skander : « pour que l'œil se repère ») ;
//   - une dépense qui revient (le loyer) projetée dans la prévision ; le seuil réglé dans la page allume le bandeau rouge ;
//   - l'essai « et si je décale ? » ne change rien en base, et s'annule ;
//   - le relevé importé : la ligne retrouvée se pointe, la ligne absente se dit absente ;
//   - une traite reçue : le paiement est daté de son échéance, la date de réception gardée, l'effet en portefeuille.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'tests/web/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

describe('la trésorerie : cartes, seuil, essai, relevé importé, effets', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-treso-'));
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
    return (texte ? JSON.parse(texte) : {}) as Record<string, unknown>;
  };
  const jour = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });
  const fr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const plusTard = async (p: Page) => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  const lireDate = async (p: Page, racine: string, iso: string) => {
    const c = p.locator(`${racine} .datefield input[type=text]`).first();
    await c.fill(fr(iso)); await c.press('Tab');
  };

  it('cartes, bouton principal, filtres gris, loyer projeté, seuil, essai, relevé, traite', async () => {
    const email = `treso-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra Mansour', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    // Des montants qui ne tombent pas ronds : 1 000,437 au départ, un loyer de 150,250 qui revient chaque mois.
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'accounts', cle: 'a-biat', rang: 20, revision: null, contenu: { id: 'a-biat', name: 'BIAT courant', kind: 'banque', bank: 'BIAT', opening: { '~n': '1000.437' }, openingDate: jour(-60), isDefault: true, statementBalance: '' } },
      { collection: 'clients', cle: 'c-lac', rang: 21, revision: null, contenu: { id: 'c-lac', name: 'Hôtel du Lac' } },
      { collection: 'movements', cle: 'm-loyer', rang: 22, revision: null, contenu: { id: 'm-loyer', date: jour(-20), kind: 'autre-sortie', amount: { '~n': '150.25' }, accountId: 'a-biat', label: 'Loyer du dépôt', reference: '', method: 'virement', repete: 'mois' } },
    ] });
    const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: { id: 'f1', type: 'facture', number: '', status: 'brouillon', date: jour(0), dueDate: jour(10), clientId: 'c-lac', createdAt: 10,
      subject: 'Câblage', lines: [{ label: 'Câblage', description: '', qty: 1, unit: '', unitPrice: { '~n': '283.517' }, vatRate: 19 }], discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [] },
    client: { id: 'c-lac', name: 'Hôtel du Lac' }, revision: null, rang: 30, netAPayer: '337.385' });
    expect(String((e.contenu as Record<string, unknown> | undefined)?.number ?? e.motif)).toMatch(/^FAC-/);
    const objet = async (collection: string, cle: string) => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).objets as { collection: string; cle: string; contenu: Record<string, unknown> }[])
      .find((o) => o.collection === collection && o.cle === cle)?.contenu;

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/tresorerie`);
    await p.locator('#tr-comptes .tr-compte').first().waitFor({ timeout: 20_000 });
    await plusTard(p);

    // 1. La carte du compte : son solde (1 000,437 − 150,250), un mouvement à pointer ; le bouton principal le propose.
    const carte = p.locator('#tr-comptes .tr-compte', { hasText: 'BIAT courant' });
    expect(net(await carte.locator('.tr-c-solde > b').innerText())).toBe('850,187 DT');
    expect(net(await carte.locator('.tr-c-pied').innerText())).toBe('Relevé jamais pointé 1 mouvement à pointer');
    expect(await p.locator('.lf-tete .btn-primary').evaluateAll((l) => l.map((b) => (b as HTMLElement).innerText.trim()))).toEqual(['Pointer le relevé']);

    // 2. Ce qui arrive : les onglets en noir, les filtres en gris ; le loyer revient le mois suivant.
    await p.locator('#t-tabs [data-tab="prevision"]').click();
    await p.locator('#t-prev').waitFor({ timeout: 10_000 });
    expect(await p.locator('#t-tabs').getAttribute('class')).toBe('pa-seg');
    expect([await p.locator('#t-days').getAttribute('class'), await p.locator('#t-mode').getAttribute('class')]).toEqual(['pa-seg filtre', 'pa-seg filtre']);
    const fond = (sel: string) => p.locator(sel).evaluate((x) => getComputedStyle(x).backgroundColor);
    expect(await fond('#t-tabs button.active')).not.toBe(await fond('#t-days button.active'));
    const loyers = p.locator('#t-prev tbody tr', { hasText: 'Loyer du dépôt' });
    expect(net(await loyers.first().innerText())).toMatch(/^\d\d\/\d\d\/\d{4} Dépense qui revient Loyer du dépôt − 150,250 DT /);
    expect(await loyers.count()).toBeGreaterThanOrEqual(2);

    // 3. Le seuil réglé dans la page (2 000) : le solde est déjà dessous, le bandeau rouge le dit, le bouton principal change.
    await p.locator('#t-seuil').click();
    await p.locator('#modal-root [name=seuil]').fill('2000');
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => net(await p.locator('.bandeau.rouge.tr-trou').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Ton solde passe sous ton seuil \(2 000,000 DT\) le /);
    expect(await p.locator('.lf-tete .btn-primary').innerText()).toBe('Voir ce qui arrive');
    await p.locator('#tr-voir-trou').click();
    await p.locator('#t-prev').waitFor({ timeout: 10_000 });
    expect(await p.locator('svg.tr-graphe .tr-seuil-l').count()).toBe(1);

    // 4. L'essai « et si je décale ? » : le loyer repoussé au-delà de l'horizon sort de la prévision ; rien ne bouge en base.
    const avantEssai = await loyers.count();
    await loyers.first().locator('[data-rowmenu]').click();
    await p.getByRole('menuitem', { name: /Décaler/ }).click();
    await lireDate(p, '#modal-root #dcf', jour(400));
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => net(await p.locator('.tr-essai').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/^Essai : 1 échéance décalée, rien n'est enregistré/);
    expect(await loyers.count()).toBe(avantEssai - 1);
    expect((await objet('movements', 'm-loyer'))?.date).toBe(jour(-20));
    await p.locator('#t-essai-fin').click();
    await expect.poll(() => p.locator('.tr-essai').count(), { timeout: 5_000 }).toBe(0);
    expect(await loyers.count()).toBe(avantEssai);
    await p.screenshot({ path: path.join(PHOTOS, 'tresorerie-prevision.png') });

    // 5. Le relevé importé : la ligne du loyer (un jour plus tard) se retrouve, les frais sont absents de SkanFact.
    await p.locator('#t-tabs [data-tab="rapprochement"]').click();
    await p.locator('#t-import').waitFor({ timeout: 10_000 });
    const csv = path.join(dossier, 'releve.csv');
    fs.writeFileSync(csv, `Date;Libellé;Débit;Crédit\n${fr(jour(-19))};PRLV LOYER DEPOT;150,250;\n${fr(jour(-18))};FRAIS TENUE DE COMPTE;12,500;\n`);
    const [choix] = await Promise.all([p.waitForEvent('filechooser', { timeout: 8_000 }), p.locator('#t-import').click()]);
    await choix.setFiles(csv);
    const revue = p.locator('#modal-root .modal', { hasText: 'Le relevé de' });
    await revue.waitFor({ timeout: 10_000 });
    expect(net(await revue.locator('.tr-imp-res').innerText())).toBe('1 retrouvée dans SkanFact 1 absente de SkanFact 0 mouvement de SkanFact pas sur ce relevé');
    expect(net(await revue.locator('#imp-absentes').innerText())).toMatch(/FRAIS TENUE DE COMPTE − 12,500 DT Créer le mouvement$/);
    await revue.locator('#ok').click();
    await expect.poll(async () => (await objet('movements', 'm-loyer'))?.reconciled, { timeout: 10_000 }).toBe(true);

    // 6. Une traite reçue aujourd'hui, à échéance dans quarante jours : le paiement est daté de l'échéance, la réception gardée.
    await p.evaluate(() => { location.hash = '#/doc/f1'; });
    await p.locator('button', { hasText: 'Enregistrer un paiement' }).first().click();
    const pf = p.locator('#modal-root .modal', { hasText: 'Enregistrer un paiement' });
    expect(await pf.locator('[data-effet]').evaluate((x) => getComputedStyle(x).visibility)).toBe('hidden');
    await pf.locator('[data-mode="traite"]').click();
    // La case de l'échéance paraît au dessin qui suit le choix (1.272.0 : lue trop tôt sur GitHub).
    await expect.poll(() => pf.locator('[data-effet]').evaluate((x) => getComputedStyle(x).visibility), { timeout: 5_000 }).toBe('visible');
    await lireDate(p, '#modal-root [data-effet]', jour(40));
    await pf.locator('[name=reference]').fill('TR-0042');
    await pf.locator('#ok').click();
    await expect.poll(async () => ((await objet('documents', 'f1'))?.payments as Record<string, unknown>[] | undefined)?.map((x) => [x.date, (x.effet as Record<string, unknown> | undefined)?.recuLe, x.method]), { timeout: 10_000 })
      .toEqual([[jour(40), jour(0), 'traite']]);
    await p.evaluate(() => { location.hash = '#/tresorerie'; });
    await p.locator('#t-tabs [data-tab="position"]').click();
    const effet = p.locator('#tr-effets tbody tr').first();
    await effet.waitFor({ timeout: 10_000 });
    expect(net(await effet.innerText())).toBe(`${fr(jour(40))} dans 40 jours Traite n° TR-0042 reçu le ${fr(jour(0))} Hôtel du Lac ${String((e.contenu as Record<string, unknown>).number)} + 337,385 DT`);
    await p.screenshot({ path: path.join(PHOTOS, 'tresorerie-position.png'), fullPage: true });

    await cx.close();
    expect(erreurs).toEqual([]);
  }, 180_000);
});
