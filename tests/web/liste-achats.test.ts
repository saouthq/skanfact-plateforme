// La liste des achats et dépenses de la maquette (1.202.0 ; docs/maquettes/achats-fournisseurs.html, passe 3 validée le
// 30/10/2026), à la souris et au téléphone, sur cinq pièces : une facture du meunier en retard de 12 jours, une facture
// d'emballages à payer dans 3 jours, un avoir sur cette facture, une dépense d'électricité payée, et une facture de
// transport sans échéance ni justificatif.
//   - en tête, « À payer » : les pièces qui restent à payer, la plus en retard d'abord, « Régler » sur chacune, et la
//     somme « dont … en retard » ; « tout voir » au-delà de cinq ; pas de tuiles ;
//   - le tableau rangé par mois, chaque colonne comme la maquette (n° et référence, fournisseur et objet, échéance dite en
//     jours, net signé pour l'avoir, reste), le pied qui additionne toute la sélection (HT, TVA, net, reste, dont en retard) ;
//   - les filtres (sorte, statut, recherche sur le montant) en puces qu'on retire ; « Régler » enregistre un règlement ;
//   - au téléphone, une carte par pièce, deux puces (En retard, À justifier), rien ne déborde.

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
const n = (x: string) => ({ '~n': x });

describe('la liste des achats et dépenses, à la souris et au téléphone', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-liste-achats-'));
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

  it('« À payer » en tête, le tableau par mois, son pied, les filtres, « Régler », le téléphone', async () => {
    const email = `achats-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia Ben Youssef', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    // L'entreprise d'essai arrive avec des exemples : ses achats et ses fournisseurs s'en vont, la liste est celle du test.
    const depart = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).objets as { collection: string; cle: string; revision: number }[];
    const exemples = depart.filter((o) => o.collection === 'purchases' || o.collection === 'suppliers');
    if (exemples.length) await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: exemples.map((o) => ({ collection: o.collection, cle: o.cle, rang: null, revision: o.revision, contenu: null })) });
    const piece = (id: string, rang: number, contenu: Record<string, unknown>) => ({ collection: 'purchases', cle: id, rang, revision: null,
      contenu: { id, currency: 'DT', fees: 0, withholdingRate: 0, createdAt: 10 + rang, payments: [], attachments: [{ name: `${id}.pdf`, file: `f-${id}`, size: 2000, date: '2026-09-01' }], ...contenu } });
    const pose = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'suppliers', cle: 's-moulins', rang: 0, revision: null, contenu: { id: 's-moulins', name: 'Les Grands Moulins de Tunis', paymentTermsDays: 30 } },
      { collection: 'suppliers', cle: 's-sahel', rang: 1, revision: null, contenu: { id: 's-sahel', name: 'Emballages du Sahel', paymentTermsDays: 45 } },
      { collection: 'suppliers', cle: 's-steg', rang: 2, revision: null, contenu: { id: 's-steg', name: 'STEG' } },
      { collection: 'suppliers', cle: 's-trans', rang: 3, revision: null, contenu: { id: 's-trans', name: 'Transports Ben Salah' } },
      // 10 sacs à 38,750 HT à 7 % : 387,500 HT, 27,125 de TVA, 414,625 à payer, échue depuis 12 jours.
      piece('p-farine', 0, { kind: 'facture', number: 'FA-2026/0812', date: '2026-08-20', dueDate: jour(-12), supplierId: 's-moulins', category: 'Achats de marchandises', subject: 'Farine T55',
        lines: [{ label: 'Farine T55, sac 25 kg', qty: 10, unitPrice: n('38.75'), vatRate: 7, destination: 'charge' }] }),
      // 200 boîtes à 0,385 HT à 19 % : 77,000 HT, 14,630 de TVA, 91,630 à payer dans 3 jours.
      piece('p-boites', 1, { kind: 'facture', number: 'ES-4471', date: '2026-09-24', dueDate: jour(3), supplierId: 's-sahel', category: 'Emballages', subject: 'Boîtes à gâteaux',
        lines: [{ label: 'Boîtes à gâteaux 30 × 30', qty: 200, unitPrice: n('0.385'), vatRate: 19, destination: 'charge' }] }),
      // L'avoir sur ces boîtes : 10 boîtes abîmées, 3,850 HT, 0,732 de TVA (0,7315 arrondi), 4,582 en moins.
      piece('p-avoir', 2, { kind: 'avoir', number: 'AV-ES-0090', date: '2026-09-25', supplierId: 's-sahel', category: 'Emballages', subject: 'Boîtes abîmées',
        lines: [{ label: 'Boîtes abîmées', qty: 10, unitPrice: n('0.385'), vatRate: 19, destination: 'charge' }] }),
      // L'électricité du mois, payée : 123,457 HT, 23,457 de TVA, 146,914.
      piece('p-steg', 3, { kind: 'depense', number: 'STEG-0926', date: '2026-09-26', dueDate: '2026-10-10', supplierId: 's-steg', category: 'Électricité',
        payments: [{ id: 'r-steg', date: '2026-10-05', amount: n('146.914'), method: 'virement' }],
        lines: [{ label: 'Électricité septembre', qty: 1, unitPrice: n('123.457'), vatRate: 19, destination: 'charge' }] }),
      // Un transport sans échéance ni justificatif : 250,000 HT à 7 %, 267,500.
      piece('p-trans', 4, { kind: 'facture', number: 'TBS-118', date: '2026-09-28', supplierId: 's-trans', category: 'Transport', subject: 'Livraison farine', attachments: [],
        lines: [{ label: 'Transport Tunis → Sfax', qty: 1, unitPrice: n('250'), vatRate: 7, destination: 'charge' }] }),
    ] });
    expect(pose.statut ?? 200, JSON.stringify(pose)).toBe(200);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const e = new URLSearchParams(location.search).get('e'); if (e) sessionStorage.setItem('skanfact.essai_tel_quel', e); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/achats`);
    await p.locator('#list-wrap tr[data-id="p-trans"]').waitFor({ timeout: 20_000 });
    await plusTard(p);
    const ids = () => p.locator('#list-wrap tbody tr[data-id]').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.id));
    const cellules = async (id: string) => (await p.locator(`#list-wrap tr[data-id="${id}"] td`).evaluateAll((tds) => tds.map((td) => (td as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))).slice(1, 8);

    // 1. L'en-tête : un bouton principal, « Facture d'achat » ; pas de tuiles.
    expect(net(await p.locator('#view .la-tete').innerText())).toBe('Accueil Achats et dépenses Achats et dépenses Ce que tu achètes, ce que tu dois, la TVA que tu récupères Guide-moi Dépense Facture d\'achat');
    expect(await p.locator('#view .la-tete .btn-primary').innerText()).toBe('Facture d\'achat');
    expect(await p.locator('#view .tuile').count()).toBe(0);

    // 2. « À payer » : trois pièces, la plus en retard d'abord, puis l'échéance ; l'avoir et la dépense payée n'y sont pas.
    expect(net(await p.locator('#payables .la-ap-t').innerText())).toBe('À payer i 3 pièces · 773,755 DT · dont 414,625 DT en retard 1 pièce sans justificatif pour ton comptable');
    expect(await p.locator('#payables li').evaluateAll((lis) => lis.map((li) => (li as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))).toEqual([
      'GM Les Grands Moulins de Tunis FA-2026/0812 · Farine T55 en retard de 12 jours 414,625 DT Régler',
      'ES Emballages du Sahel ES-4471 · Boîtes à gâteaux dans 3 jours 91,630 DT Régler',
      'TB Transports Ben Salah TBS-118 · Livraison farine sans échéance 267,500 DT Régler',
    ]);
    expect(await p.locator('#la-tout').count()).toBe(0);

    // 3. Le tableau, rangé par mois (le plus récent d'abord), chaque colonne comme la maquette.
    expect(await p.locator('#list-wrap tr.mois').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))).toEqual([
      'Septembre 2026 4 pièces · 501,462 DT', 'Août 2026 1 pièce · 414,625 DT']);
    expect(await ids()).toEqual(['p-trans', 'p-steg', 'p-avoir', 'p-boites', 'p-farine']);
    expect(await cellules('p-farine')).toEqual(['20/08/2026', 'FA-2026/0812 📎', 'GM Les Grands Moulins de Tunis Farine T55 · Achats de marchandises',
      `${new Date(Date.now() - 12 * 86_400_000).toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis' })} 12 jours de retard`, 'En retard', '414,625', '414,625']);
    expect((await cellules('p-boites')).slice(3)).toEqual([`${new Date(Date.now() + 3 * 86_400_000).toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis' })} dans 3 jours`, 'À payer', '91,630', '91,630']);
    // L'avoir se lit en moins ; la dépense payée dit quand.
    // Pas encore imputé sur une facture, l'avoir est ce que le fournisseur te doit : « pour toi », hors du reste à payer.
    expect((await cellules('p-avoir')).slice(2)).toEqual(['ES Emballages du Sahel Boîtes abîmées · avoir fournisseur · Emballages', '—', 'À imputer', '− 4,582', '4,582 pour toi']);
    expect((await cellules('p-steg')).slice(3)).toEqual(['payée le 05/10', 'Payée', '146,914', '—']);
    // Le transport n'a pas de justificatif : la ligne le dit (la référence interne, égale au numéro, ne se répète pas).
    expect((await cellules('p-trans'))[1]).toBe('TBS-118 sans justificatif');
    // Le pied additionne toute la sélection, l'avoir en moins.
    expect(net(await p.locator('#list-wrap tfoot').innerText())).toBe('Total de la sélection 5 pièces · 834,107 DT HT · TVA 81,980 DT 916,087 DT 773,755 dont 414,625 en retard');
    await p.screenshot({ path: path.join(PHOTOS, 'liste-achats-1.png') });

    // 4. Les filtres : la sorte, le statut, la recherche (qui lit aussi le montant), chacun en puce qu'on retire.
    await p.locator('#lf-barre [data-kind="depense"]').click();
    expect(await ids()).toEqual(['p-steg']);
    expect(net(await p.locator('#lf-barre .f-note').innerText())).toBe('1 sur 5 pièces');
    expect(net(await p.locator('#lf-barre .puces-f').innerText())).toBe('Dépenses Tout effacer');
    await p.locator('#lf-barre [data-ote="kind"]').click();
    await expect.poll(ids).toEqual(['p-trans', 'p-steg', 'p-avoir', 'p-boites', 'p-farine']);
    await p.locator('#st').selectOption('retard');
    expect(await ids()).toEqual(['p-farine']);
    expect(net(await p.locator('#list-wrap tfoot').innerText())).toBe('Total de la sélection 1 pièce · 387,500 DT HT · TVA 27,125 DT 414,625 DT 414,625 dont 414,625 en retard');
    await p.locator('#reset-f').click();
    await p.locator('#q').fill('91,630');
    await expect.poll(ids).toEqual(['p-boites']);
    await p.locator('#q').fill('kerkennah');
    await expect.poll(async () => net(await p.locator('#list-wrap .vide-f').innerText().catch(() => ''))).toBe('Aucune pièce ne correspond à « kerkennah » La recherche lit le numéro, la référence, le fournisseur, l\'objet, la catégorie, le montant et le nom des pièces jointes. Tout revoir');
    await p.locator('#lf-tout-revoir').click();
    await expect.poll(ids).toEqual(['p-trans', 'p-steg', 'p-avoir', 'p-boites', 'p-farine']);
    // Un autre tri que la date défait les mois.
    await p.locator('#list-wrap th[data-sort="net"]').click();
    expect(await p.locator('#list-wrap tr.mois').count()).toBe(0);
    await p.locator('#list-wrap th[data-sort="date"]').click();
    await expect.poll(() => p.locator('#list-wrap tr.mois').count()).toBe(2);
    // « 1 pièce sans justificatif » mène à elle.
    await p.locator('#la-justif').click();
    await expect.poll(ids).toEqual(['p-trans']);
    expect(net(await p.locator('#lf-barre .puces-f').innerText())).toBe('Sans justificatif Tout effacer');
    await p.locator('#reset-f').click();

    // 5. Le menu ⋯ d'une facture : ouvrir, régler, l'avoir et l'acompte, dupliquer.
    await p.locator('#list-wrap tr[data-id="p-boites"] [data-rowmenu]').click();
    const menu = p.locator('.row-menu');
    await menu.waitFor();
    expect(net(await menu.innerText())).toBe('ES-4471 · Emballages du Sahel Ouvrir la pièce Lignes, TVA, justificatifs Enregistrer un règlement Reste 91,630 DT SUR CETTE PIÈCE Saisir un avoir sur cette pièce Retour, rabais, erreur du fournisseur Saisir un acompte versé Payé d\'avance, à déduire de cette facture Dupliquer Même fournisseur, mêmes lignes, à la date du jour');
    await p.keyboard.press('Escape');
    // Le clavier : « / » cherche, ↓ ↓ choisit la deuxième pièce, Entrée l'ouvre.
    await p.locator('#view h1').click();
    await p.keyboard.press('/');
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('q');
    await p.keyboard.press('Escape');
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('ArrowDown');
    expect(await p.locator('#list-wrap tr.kb').getAttribute('data-id')).toBe('p-steg');
    await p.keyboard.press('Enter');
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/achat/p-steg');
    await p.evaluate(() => { location.hash = '#/achats'; });
    await p.locator('#list-wrap tr[data-id="p-trans"]').waitFor({ timeout: 20_000 });

    // 6. « Régler » dans « À payer » : la fenêtre du règlement, préremplie du reste ; la pièce sort du bloc.
    await p.locator('#payables li[data-id="p-farine"] [data-payx]').click();
    const fen = p.locator('#modal-root .modal');
    await fen.waitFor();
    expect(net(await fen.innerText())).toContain('414,625');
    await fen.locator('#ok').click();
    await expect.poll(async () => net(await p.locator('#payables .la-ap-t').innerText())).toBe('À payer i 2 pièces · 359,130 DT 1 pièce sans justificatif pour ton comptable');
    expect((await cellules('p-farine')).slice(4)).toEqual(['Payée', '414,625', '—']);
    const surLeServeur = async () => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).objets as { collection: string; cle: string; contenu: Record<string, unknown> }[]);
    await expect.poll(async () => JSON.stringify(((await surLeServeur()).find((o) => o.cle === 'p-farine')?.contenu.payments as unknown[] ?? []).map((x) => (x as { amount: unknown }).amount))).toBe(JSON.stringify([n('414.625')]));

    // 7. Au-delà de cinq pièces à payer, « tout voir » déplie le bloc.
    const objets = await surLeServeur();
    const rev = (cle: string) => (objets.find((o) => o.cle === cle) as unknown as { revision: number } | undefined)?.revision ?? null;
    expect(rev('p-farine')).not.toBeNull();
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [1, 2, 3, 4].map((i) => piece(`p-plus${i}`, 10 + i, { kind: 'facture', number: `PL-${i}`, date: '2026-09-10', dueDate: jour(20 + i), supplierId: 's-trans', category: 'Transport',
      lines: [{ label: 'Course', qty: 1, unitPrice: n(String(10 * i)), vatRate: 7, destination: 'charge' }] })) });
    await p.reload(); await plusTard(p);
    await p.locator('#payables li').first().waitFor({ timeout: 20_000 });
    expect(await p.locator('#payables li').count()).toBe(5);
    expect(net(await p.locator('#la-tout').innerText())).toBe('1 autre pièce à payer · tout voir');
    await p.locator('#la-tout').click();
    await expect.poll(() => p.locator('#payables li').count()).toBe(6);
    expect(net(await p.locator('#la-tout').innerText())).toBe('Replier');
    await p.locator('#la-tout').click();
    await expect.poll(() => p.locator('#payables li').count()).toBe(5);

    // 7 b. Choisir plusieurs pièces : la barre les compte ; « Régler ensemble » ne va qu'à un seul fournisseur.
    const choisir = (id: string) => p.locator(`#list-wrap tr[data-id="${id}"] input[data-x]`).click();
    await choisir('p-trans');
    await expect.poll(async () => net(await p.locator('#la-choix .barre-choix').innerText().catch(() => ''))).toBe('1 pièce choisie reste 267,500 DT Régler ensemble 1 Exporter 1 Ne plus rien choisir');
    expect(await p.locator('#bc-regler').getAttribute('title')).toBe('Choisis au moins deux pièces qui restent à payer');
    await choisir('p-boites');
    await expect.poll(() => p.locator('#bc-regler').getAttribute('title')).toBe('Un règlement va à un seul fournisseur : choisis des pièces du même');
    await choisir('p-boites');
    await choisir('p-plus1');
    await expect.poll(async () => net(await p.locator('#la-choix .barre-choix').innerText())).toBe('2 pièces choisies reste 278,200 DT Régler ensemble 2 Exporter 2 Ne plus rien choisir');
    expect(await p.locator('#bc-regler').isDisabled()).toBe(false);
    // La barre tient sur une ligne, ses boutons à leur taille (la pastille du nombre les étirait de 340 px).
    expect(await p.locator('#bc-regler').evaluate((b) => b.getBoundingClientRect().width)).toBeLessThan(220);
    // Échap défait le choix ; on rechoisit.
    await p.locator('#view h1').click();
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('#la-choix .barre-choix').count()).toBe(0);
    // Au clavier : ↓ choisit la première ligne, Espace la coche (et la ligne reste choisie au clavier).
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press(' ');
    await expect.poll(async () => net(await p.locator('#la-choix .barre-choix').innerText().catch(() => ''))).toMatch(/^1 pièce choisie reste 267,500 DT/);
    expect(await p.locator('#list-wrap tr.kb').getAttribute('data-id')).toBe('p-trans');
    await choisir('p-plus1');
    await p.locator('#bc-regler').click();
    const ens = p.locator('#modal-root .modal');
    await ens.waitFor();
    // 270,000 versés : le transport du 28/09 (sans échéance, la plus ancienne date) reçoit ses 267,500, la course PL-1 le reste.
    await ens.locator('[name=amount]').fill('270');
    await expect.poll(async () => (await ens.locator('#rge-l tbody tr').allInnerTexts()).map(net)).toEqual([
      'TBS-118 Livraison farine — 267,500 DT 267,500 DT', `PL-1 Course ${new Date(Date.now() + 21 * 86_400_000).toLocaleDateString('fr-FR', { timeZone: 'Africa/Tunis' })} 10,700 DT 2,500 DT en partie`]);
    await ens.locator('[name=reference]').fill('VIR-2026-1031');
    await p.screenshot({ path: path.join(PHOTOS, 'liste-achats-4-regler-ensemble.png') });
    await ens.locator('#ok').click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    await expect.poll(async () => JSON.stringify((await surLeServeur()).filter((o) => ['p-trans', 'p-plus1'].includes(o.cle)).sort((a, b) => a.cle.localeCompare(b.cle))
      .map((o) => (o.contenu.payments as { amount: unknown; reference: string }[]).map((x) => [x.amount, x.reference])))).toBe(JSON.stringify([[[n('2.5'), 'VIR-2026-1031']], [[n('267.5'), 'VIR-2026-1031']]]));
    expect(await p.locator('#la-choix .barre-choix').count()).toBe(0);
    expect((await cellules('p-trans')).slice(4)).toEqual(['Payée', '267,500', '—']);
    expect((await cellules('p-plus1')).slice(4)).toEqual(['Partiel', '10,700', '8,200']);

    // 8. Au téléphone : « À payer » en une carte, deux puces, une carte par pièce, rien ne déborde.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate(() => { location.hash = '#/accueil'; location.hash = '#/achats'; });
    await p.locator('.la-carte').first().waitFor({ timeout: 20_000 });
    expect(await p.locator('#list-wrap table').isVisible()).toBe(false);
    expect(await p.locator('#payables li').first().isVisible()).toBe(false);
    expect(await p.locator('#lf-puces button').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))).toEqual(['En retard 0', 'À justifier 1']);
    expect(net(await p.locator('.la-carte[data-id="p-boites"]').innerText())).toBe(`ES Emballages du Sahel ES-4471 · 24/09/2026 À payer Boîtes à gâteaux 91,630 DT échéance le ${jm(jour(3))} reste 91,630 DT`);
    await p.locator('#lf-puces [data-tst="sans justificatif"]').click();
    await expect.poll(() => p.locator('.la-carte').evaluateAll((cs) => cs.map((c) => (c as HTMLElement).dataset.id))).toEqual(['p-trans']);
    await p.locator('#lf-puces [data-tst="sans justificatif"]').click();
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await p.screenshot({ path: path.join(PHOTOS, 'liste-achats-2-telephone.png') });
    await p.locator('.la-carte[data-id="p-boites"]').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/achat/p-boites');

    // 9. À la tablette, l'échéance cède sa place ; aucun texte n'est coupé dans le fournisseur.
    await p.setViewportSize({ width: 1024, height: 768 });
    await p.evaluate(() => { location.hash = '#/achats'; });
    await p.locator('#list-wrap tr[data-id="p-trans"]').waitFor({ timeout: 20_000 });
    expect(await p.locator('#list-wrap thead th').evaluateAll((ths) => ths.filter((t) => (t as HTMLElement).offsetParent).map((t) => (t as HTMLElement).innerText.replace(/[⇅↑↓]/g, '').trim()))).toEqual(['', 'Date', 'N° du fournisseur', 'Fournisseur et objet', 'Statut', 'Net à payer', 'Reste', '']);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
    await p.screenshot({ path: path.join(PHOTOS, 'liste-achats-3-tablette.png') });

    // 10. Sans réseau : le bandeau le dit, et aucun « Régler » (un règlement attend le réseau) ; il revient avec lui.
    await cx.setOffline(true);
    await expect.poll(async () => net(await p.locator('#la-hors-ligne').innerText().catch(() => ''))).toBe('Pas de réseau : la liste est celle que ce poste a gardée — tu notes une dépense, tu joins une photo : elles partiront avec le réseau. Un règlement attend le réseau, pour ne jamais payer deux fois.');
    expect(await p.locator('#view [data-payx]').count()).toBe(0);
    await cx.setOffline(false);
    await expect.poll(() => p.locator('#la-hors-ligne').count()).toBe(0);
    expect(await p.locator('#view [data-payx]').count()).toBeGreaterThan(0);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
