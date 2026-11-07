// La liste des devis (1.260.0), faite sur le modèle de celle des factures (Skander, 03/11/2026 : « fais-la comme celle de
// facture et adapte-la »), à la souris et au clavier, sur sept devis qui couvrent chaque statut :
//   - pas de tuiles au-dessus de la liste (Skander, 03/11/2026 : « enlève les kpi […] on le laissera dans statistique ») ;
//   - le statut dit où en est le devis : Brouillon, Envoyé, Expiré, Accepté (à facturer ou facturé en partie), Facturé,
//     Refusé ; « Valable jusqu'au » dit le temps qui reste, l'expiration ou la date de la réponse ;
//   - « Facturé par » nomme les factures tirées du devis (l'acompte, le solde à faire) ou le motif d'un refus ;
//   - le bouton rapide de la ligne est l'étape suivante : « Le client a accepté ? », « Facturer », « Facturer le solde » ;
//   - le filtre « Accepté, à facturer » garde aussi le devis facturé en partie ; les filtres se lisent en puces ;
//   - le menu ⋯ nomme son devis et range ses gestes (la réponse du client, envoyer, la pièce) ; « Prolonger » un expiré ;
//   - on choisit plusieurs devis : « Relancer » ne vaut que pour un seul devis qui attend sa réponse ;
//   - ↓ passe d'un devis à l'autre, Entrée l'ouvre.

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

describe('la liste des devis, à la souris et au clavier', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-liste-devis-'));
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
  const jm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const plusTard = async (p: Page) => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  it('chaque statut se dit, « Facturé par » nomme les factures, le bouton rapide est l\'étape suivante, on filtre, on choisit, au clavier', async () => {
    const email = `devis-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Sarra Mansour', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const auj = jour(0);
    // Des prix qui discriminent : 283,517 HT × qty, TVA 19 %.
    const ligne = (qty: number) => [{ label: 'Maintenance', description: '', qty, unit: '', unitPrice: { '~n': '283.517' }, vatRate: 19 }];
    const devis = (id: string, number: string, rang: number, extra: Record<string, unknown>) => ({ collection: 'documents', cle: id, rang, revision: null, contenu: {
      id, type: 'devis', number, status: 'envoyé', date: auj, dueDate: jour(20), clientId: rang % 2 ? 'c-lac' : 'c-pins', createdAt: rang, subject: `Objet ${id}`,
      lines: ligne(rang), discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [], emails: [{ date: auj, to: 'compta@lac.exemple.tn', kind: 'devis' }], ...extra } });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'clients', cle: 'c-lac', rang: 20, revision: null, contenu: { id: 'c-lac', name: 'Hôtel du Lac', email: 'compta@lac.exemple.tn' } },
      { collection: 'clients', cle: 'c-pins', rang: 21, revision: null, contenu: { id: 'c-pins', name: 'École Les Pins', email: 'direction@pins.exemple.tn' } },
      devis('q1', '', 1, { status: 'brouillon', emails: [] }),
      devis('q2', 'DEV-2026-002', 2, {}),
      devis('q3', 'DEV-2026-003', 3, { dueDate: jour(-5) }),
      devis('q4', 'DEV-2026-004', 4, { status: 'accepté', reponse: { statut: 'accepté', le: jour(-2), comment: 'oral', par: 'Sarra Mansour' } }),
      devis('q5', 'DEV-2026-005', 5, { status: 'accepté', reponse: { statut: 'accepté', le: jour(-3), comment: 'écrit', par: 'Sarra Mansour' } }),
      devis('q6', 'DEV-2026-006', 6, { status: 'accepté', reponse: { statut: 'accepté', le: jour(-4), comment: 'écrit', par: 'Sarra Mansour' } }),
      devis('q7', 'DEV-2026-007', 7, { status: 'refusé', reponse: { statut: 'refusé', le: jour(-1), motif: 'Trop cher', par: 'Sarra Mansour' } }),
    ] })).statut ?? 200).toBeTruthy();
    // q5 facturé en entier, q6 par un acompte émis (le solde reste à faire).
    const factures: [string, number, Record<string, unknown>, string][] = [
      ['f5', 5, { fromQuoteId: 'q5', fromQuoteNumber: 'DEV-2026-005' }, '1686.926'],
      ['a6', 1, { deposit: { percent: 30, quoteId: 'q6', quoteNumber: 'DEV-2026-006' } }, '337.385'],
    ];
    const numeros: Record<string, string> = {};
    for (const [i, [id, qty, lien, netAPayer]] of factures.entries()) {
      const e = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: { id, type: 'facture', number: '', status: 'brouillon', date: auj, dueDate: jour(30), clientId: id === 'f5' ? 'c-lac' : 'c-pins', createdAt: 30 + i,
        subject: `Facture ${id}`, lines: ligne(qty), discountRate: 0, withholdingRate: 0, applyStamp: false, currency: 'DT', payments: [], ...lien },
        client: { id: id === 'f5' ? 'c-lac' : 'c-pins', name: id === 'f5' ? 'Hôtel du Lac' : 'École Les Pins' }, revision: null, rang: 40 + i, netAPayer });
      numeros[id] = String((e.contenu as Record<string, unknown> | undefined)?.number ?? e.motif);
      expect(numeros[id]).toMatch(/^FAC-/);
    }

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const e = new URLSearchParams(location.search).get('e'); if (e) sessionStorage.setItem('skanfact.essai_tel_quel', e); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/devis`);
    await p.locator('#list-wrap tr[data-id="q7"]').waitFor({ timeout: 20_000 });
    await plusTard(p);
    const td = (id: string, cl: string) => p.locator(`#list-wrap tr[data-id="${id}"] td.${cl}`).innerText().then(net);

    // 1. Pas de tuiles : la liste vient tout de suite sous ses filtres.
    expect(await p.locator('#lf-haut, #lf .tuiles, #lf [data-tuile]:not(.t-puce)').count()).toBe(0);
    expect(net(await p.locator('#f-note').innerText())).toBe('7 devis');

    // 2. Le statut, la validité, ce que le devis a donné.
    const statuts = await Promise.all(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'].map((id) => td(id, 'st')));
    expect(statuts).toEqual(['Brouillon', 'Envoyé', 'Expiré', 'Accepté', 'Facturé', 'Accepté', 'Refusé']);
    expect(await td('q1', 'ech')).toBe(`${jm(jour(20))} pas encore envoyé`);
    expect(await td('q2', 'ech')).toBe(`${jm(jour(20))} encore 20 jours`);
    expect(await td('q3', 'ech')).toBe(`${jm(jour(-5))} expiré depuis 5 jours`);
    expect(await td('q4', 'ech')).toBe(`accepté le ${jm(jour(-2))}`);
    expect(await td('q7', 'ech')).toBe(`refusé le ${jm(jour(-1))}`);
    expect(await td('q4', 'ld-suite')).toBe('à facturer');
    expect(await td('q5', 'ld-suite')).toBe(numeros.f5);
    expect(await td('q6', 'ld-suite')).toBe(`${numeros.a6} (acompte) · solde à facturer`);
    expect(await td('q7', 'ld-suite')).toBe('Trop cher');
    expect(await td('q2', 'ld-suite')).toBe('');

    // 3. Le bouton rapide est l'étape suivante, et rien quand il n'y en a pas.
    const vite = (id: string) => p.locator(`#list-wrap tr[data-id="${id}"] [data-vite]`).getAttribute('aria-label').then((t) => (t === null ? null : net(t))).catch(() => null);
    expect(await vite('q2')).toBe('Le client a accepté DEV-2026-002 ?');
    expect(await vite('q3')).toBe('Le client a accepté DEV-2026-003 ?');
    expect(await vite('q4')).toBe('Facturer DEV-2026-004 · 1 349,541 DT');
    expect(await vite('q6')).toBe('Facturer le solde de DEV-2026-006');
    expect(await p.locator('#list-wrap tr[data-id="q5"] [data-vite], #list-wrap tr[data-id="q7"] [data-vite], #list-wrap tr[data-id="q1"] [data-vite]').count()).toBe(0);
    await p.screenshot({ path: path.join(PHOTOS, 'liste-devis-1.png') });

    // 4. « Accepté, à facturer » garde le devis facturé en partie ; la puce le dit ; « Tout effacer » rend tout.
    const lignes = () => p.locator('#list-wrap tbody tr[data-id]').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.id).sort());
    await p.locator('#st').selectOption('à facturer');
    await expect.poll(lignes).toEqual(['q4', 'q6']);
    expect(net(await p.locator('#lf-barre .puces-f').innerText())).toBe('Accepté, à facturer Tout effacer');
    expect(net(await p.locator('#f-note').innerText())).toBe('2 sur 7 devis');
    await p.locator('#reset-f').click();
    await expect.poll(() => lignes().then((l) => l.length)).toBe(7);
    // Le montant se cherche : 674,77 (2 × 337,385) trouve q2, et le dit.
    await p.locator('#q').fill('674,77');
    await expect.poll(lignes).toEqual(['q2']);
    expect(net(await p.locator('#list-wrap tr[data-id="q2"] .trouve').innerText())).toBe('trouvé par son montant');
    await p.locator('#reset-f').click();
    await expect.poll(() => lignes().then((l) => l.length)).toBe(7);

    // 5. Le menu ⋯ d'un expiré : il nomme son devis, la réponse du client vient d'abord, « Prolonger » est là.
    await p.locator('#list-wrap tr[data-id="q3"] .row-menu-btn').click();
    const menu = p.locator('.row-menu');
    await expect.poll(() => menu.locator('.rm-tete').innerText().catch(() => '')).toBe('DEV-2026-003 · Hôtel du Lac');
    const titres = await menu.locator('.rm-titre').allInnerTexts().then((l) => l.map((x) => x.toLowerCase()));
    expect(titres[0]).toBe('la réponse du client');
    expect(titres).toContain('la pièce');
    expect(titres).not.toContain('facturer');
    await menu.getByRole('menuitem', { name: /Prolonger sa validité/ }).click();
    // (1.306.0) Le champ de date de la plateforme, à la française.
    const valable = p.locator('#modal-root .datefield').filter({ has: p.locator('input[name="pr-le"]') }).locator('.d-txt');
    await valable.fill(jour(15).split('-').reverse().join('/'));
    await valable.press('Tab');
    await p.locator('#modal-root #pr-ok').click();
    await expect.poll(() => td('q3', 'st')).toBe('Envoyé');
    expect(await td('q3', 'ech')).toBe(`${jm(jour(15))} encore 15 jours`);

    // 6. Choisir : « Relancer » ne vaut que pour un seul devis qui attend sa réponse.
    await p.locator('#list-wrap input[data-x="q2"]').check();
    await p.locator('#list-wrap input[data-x="q4"]').check();
    const barre = p.locator('.barre-choix');
    await expect.poll(() => barre.innerText().then(net).catch(() => '')).toBe('2 devis choisis 2 024,311 DT TTC Télécharger les PDF 2 Relancer 1 Ne plus rien choisir');
    expect(await p.locator('#bc-relancer').isEnabled()).toBe(true);
    await p.locator('#list-wrap input[data-x="q3"]').check();
    await expect.poll(() => p.locator('#bc-relancer').isEnabled()).toBe(false);
    await p.locator('#bc-rien').click();
    await expect.poll(() => barre.count()).toBe(0);

    // 7. Au clavier : ↓ passe d'un devis à l'autre, Entrée ouvre celui qu'on montre.
    await p.locator('body').click({ position: { x: 1300, y: 880 } });
    await p.keyboard.press('ArrowDown');
    const premier = await p.locator('#list-wrap tr.kb').getAttribute('data-id');
    const num = premier === 'q1' ? 'Nouveau devis|Devis' : `Devis ${['q2', 'q3', 'q4', 'q5', 'q6', 'q7'].includes(String(premier)) ? `DEV-2026-00${String(premier).slice(1)}` : ''}`;
    await p.keyboard.press('Enter');
    await expect.poll(() => p.locator('#view h1').first().innerText()).toMatch(new RegExp(`^(${num})`));
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
