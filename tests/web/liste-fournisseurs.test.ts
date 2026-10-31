// La liste des fournisseurs de la maquette (1.204.0 ; docs/maquettes/achats-fournisseurs.html, validée le 30/10/2026), à la
// souris, au clavier et au téléphone, sur cinq fournisseurs : le meunier (retenue 1 %, une facture en retard), le fournisseur
// d'emballages (deux factures en retard, sans e-mail), la STEG (payée, sans matricule), le transporteur (à payer sous 3 jours,
// sans RIB), l'imprimerie (aucun achat).
//   - chaque colonne dit ce que la maquette dit : le matricule et sa retenue, « pas d'e-mail », l'acheté HT et le nombre de
//     pièces, ce que tu lui dois et « dont … en retard » ou « … sous 7 jours », le dernier achat et son délai ;
//   - les filtres comptent comme la liste (Tu leur dois, En retard, À compléter, Sans achat) ; la recherche lit la ville ;
//   - le pied additionne la sélection et dit la retenue qu'on gardera ; « Régler » règle les pièces en retard d'un virement ;
//   - le menu ⋯, le clavier ; au téléphone, une carte par fournisseur ; à la tablette, rien de coupé.

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

describe('la liste des fournisseurs, à la souris, au clavier et au téléphone', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-liste-fournisseurs-'));
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
  const plusTard = async (p: Page) => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  it('les colonnes, les filtres et leurs nombres, la ville, le pied, « Régler », le menu, le clavier, le téléphone', async () => {
    const email = `fournisseurs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia Ben Youssef', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    const depart = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).objets as { collection: string; cle: string; revision: number }[];
    const exemples = depart.filter((o) => o.collection === 'purchases' || o.collection === 'suppliers');
    if (exemples.length) await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: exemples.map((o) => ({ collection: o.collection, cle: o.cle, rang: null, revision: o.revision, contenu: null })) });
    const piece = (id: string, rang: number, contenu: Record<string, unknown>) => ({ collection: 'purchases', cle: id, rang, revision: null,
      contenu: { id, kind: 'facture', currency: 'DT', fees: 0, withholdingRate: 0, createdAt: 10 + rang, payments: [], attachments: [], category: 'Achats', ...contenu } });
    const pose = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'suppliers', cle: 's-moulins', rang: 0, revision: null, contenu: { id: 's-moulins', name: 'Les Grands Moulins de Tunis', contact: 'Sami Gharbi', city: 'Ben Arous', matricule: '0876543B/A/M/000',
        phone: '71 234 567', email: 'commandes@grands-moulins.example', rib: '10 405 0012345678901 23', withholdingRate: 1, paymentTermsDays: 30 } },
      { collection: 'suppliers', cle: 's-sahel', rang: 1, revision: null, contenu: { id: 's-sahel', name: 'Emballages du Sahel', contact: 'Hela Mansour', city: 'Sfax', matricule: '1520034M/A/M/000', phone: '74 862 004', rib: '08 701 0001234567890 12', paymentTermsDays: 45 } },
      { collection: 'suppliers', cle: 's-steg', rang: 2, revision: null, contenu: { id: 's-steg', name: 'STEG', phone: '71 341 311', email: 'clients@steg.example', paymentTermsDays: 0 } },
      { collection: 'suppliers', cle: 's-trans', rang: 3, revision: null, contenu: { id: 's-trans', name: 'Transports Ben Salah', contact: 'Karim Ben Salah', city: 'Sousse', matricule: '1187455R/A/M/000', phone: '73 455 210', email: 'kbs@transports.example' } },
      { collection: 'suppliers', cle: 's-neuf', rang: 4, revision: null, contenu: { id: 's-neuf', name: 'Imprimerie Al Amal', city: 'Tunis', matricule: '1366201T/A/M/000', phone: '71 300 120', email: 'contact@alamal.example', paymentTermsDays: 15 } },
      // Le meunier : 10 sacs à 38,750 HT à 7 % (414,625 TTC), retenue de 1 % à opérer au règlement ; échue depuis 12 jours.
      piece('p-farine', 0, { number: 'FA-2026/0812', date: '2026-09-20', dueDate: jour(-12), supplierId: 's-moulins', withholdingRate: 1,
        lines: [{ label: 'Farine T55', qty: 10, unitPrice: n('38.75'), vatRate: 7, destination: 'charge' }] }),
      // Les emballages : 91,630 échue depuis 20 jours, 45,815 depuis 5 jours.
      piece('p-boites', 1, { number: 'ES-4471', date: '2026-09-10', dueDate: jour(-20), supplierId: 's-sahel', lines: [{ label: 'Boîtes', qty: 200, unitPrice: n('0.385'), vatRate: 19, destination: 'charge' }] }),
      piece('p-sachets', 2, { number: 'ES-4502', date: '2026-09-25', dueDate: jour(-5), supplierId: 's-sahel', lines: [{ label: 'Sachets', qty: 100, unitPrice: n('0.385'), vatRate: 19, destination: 'charge' }] }),
      // La STEG : 146,914, payée.
      piece('p-steg', 3, { kind: 'depense', number: 'STEG-0926', date: '2026-09-26', dueDate: '2026-10-10', supplierId: 's-steg',
        payments: [{ id: 'r-steg', date: '2026-10-05', amount: n('146.914'), method: 'virement' }], lines: [{ label: 'Électricité', qty: 1, unitPrice: n('123.457'), vatRate: 19, destination: 'charge' }] }),
      // Le transport : 267,500 à payer dans 3 jours.
      piece('p-trans', 4, { number: 'TBS-118', date: '2026-09-28', dueDate: jour(3), supplierId: 's-trans', lines: [{ label: 'Transport', qty: 1, unitPrice: n('250'), vatRate: 7, destination: 'charge' }] }),
    ] });
    expect(pose.statut ?? 200, JSON.stringify(pose)).toBe(200);

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const e = new URLSearchParams(location.search).get('e'); if (e) sessionStorage.setItem('skanfact.essai_tel_quel', e); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/fournisseurs`);
    await p.locator('#list-wrap tr[data-sid="s-neuf"]').waitFor({ timeout: 20_000 });
    await plusTard(p);
    const ids = () => p.locator('#list-wrap tbody tr[data-sid]').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.sid));
    const cellules = async (id: string) => (await p.locator(`#list-wrap tr[data-sid="${id}"] td`).evaluateAll((tds) => tds.map((td) => (td as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))).slice(0, 7);

    // 1. L'en-tête ; la liste rangée par nom.
    expect(net(await p.locator('#view .lfo-tete').innerText())).toMatch(/^Accueil Fournisseurs Fournisseurs Chez qui tu achètes, ce que tu leur dois .*Importer… Nouveau fournisseur$/);
    expect(await p.locator('#view .lfo-tete .btn-primary').innerText()).toBe('Nouveau fournisseur');
    expect(await ids()).toEqual(['s-sahel', 's-neuf', 's-moulins', 's-steg', 's-trans']);
    // 2. Chaque colonne, comme la maquette.
    expect(await cellules('s-moulins')).toEqual(['GM Les Grands Moulins de Tunis Sami Gharbi · Ben Arous', '0876543B/A/M/000 RS 1 %', '71 234 567 commandes@grands-moulins.example',
      '387,500 1 pièce', '410,479 dont 410,479 en retard', '20/09/2026 paie à 30 jours', 'Régler']);
    expect(await cellules('s-sahel')).toEqual(['ES Emballages du Sahel Hela Mansour · Sfax', '1520034M/A/M/000 sans retenue', '74 862 004 pas d\'e-mail',
      '115,500 2 pièces', '137,445 dont 137,445 en retard', '25/09/2026 paie à 45 jours', 'Régler']);
    expect((await cellules('s-steg')).slice(1, 6)).toEqual(['à renseigner sa retenue s\'écrit avec lui', '71 341 311 clients@steg.example', '123,457 1 pièce', '—', '26/09/2026 paie à réception']);
    expect((await cellules('s-trans')).slice(4, 6)).toEqual(['267,500 267,500 sous 7 jours', '28/09/2026 délai non précisé']);
    expect((await cellules('s-neuf')).slice(3, 7)).toEqual(['aucun achat', '—', 'paie à 15 jours', '']);
    // Le pied additionne la sélection, et dit la retenue que les règlements garderont (1 % de 414,625).
    expect(net(await p.locator('#list-wrap tfoot').innerText())).toBe('Total de la sélection 5 fournisseurs · tu garderas 4,146 DT de retenue pour l\'État en les payant 876,457 DT 815,424 dont 547,924 en retard');
    await p.screenshot({ path: path.join(PHOTOS, 'liste-fournisseurs-1.png') });

    // 3. Les filtres comptent comme la liste ; la recherche lit la ville.
    expect(await p.locator('#lf-barre .segment button').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))).toEqual(['Tous', 'Tu leur dois 3', 'En retard 2', 'À compléter 3', 'Sans achat 1']);
    await p.locator('#lf-barre [data-f="completer"]').click();
    expect(await ids()).toEqual(['s-sahel', 's-steg', 's-trans']);
    await p.locator('#lf-barre [data-f="retard"]').click();
    expect(await ids()).toEqual(['s-sahel', 's-moulins']);
    expect(net(await p.locator('#lf-barre .puces-f').innerText())).toBe('En retard Tout effacer');
    await p.locator('#reset-f').click();
    await p.locator('#q').fill('sfax');
    await expect.poll(ids).toEqual(['s-sahel']);
    await p.locator('#q').fill('kerkennah');
    await expect.poll(async () => net(await p.locator('#list-wrap .vide-f').innerText().catch(() => ''))).toBe('Aucun fournisseur ne correspond à « kerkennah » La recherche lit le nom, le contact, le matricule, l\'e-mail, le téléphone et la ville. Créer « Kerkennah » Tout revoir');
    await p.locator('#lf-tout-revoir').click();
    await expect.poll(() => p.locator('#list-wrap tbody tr').count()).toBe(5);

    // 4. Le menu ⋯ du meunier.
    await p.locator('#list-wrap tr[data-sid="s-moulins"] [data-rowmenu]').click();
    const menu = p.locator('.row-menu');
    await menu.waitFor();
    expect(net(await menu.innerText())).toBe('Les Grands Moulins de Tunis Ouvrir la fiche Ses achats, ses règlements, ce que tu lui dois LUI ACHETER Enregistrer un achat Chez Les Grands Moulins de Tunis Nouvelle commande Un bon de commande, à lui envoyer SON COMPTE Régler FA-2026/0812 410,479 DT · 12 jours de retard SA FICHE Modifier le fournisseur Coordonnées, délai, retenue, RIB');
    await menu.getByText('Nouvelle commande', { exact: true }).click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/commandef/new/s-moulins');
    await p.evaluate(() => { location.hash = '#/fournisseurs'; });
    await p.locator('#list-wrap tr[data-sid="s-sahel"]').waitFor({ timeout: 20_000 });

    // 5. « Régler » sur les emballages : leurs deux pièces en retard, d'un seul virement.
    await p.locator('#list-wrap tr[data-sid="s-sahel"] [data-regler]').click();
    const ens = p.locator('#modal-root .modal');
    await ens.waitFor();
    expect(net(await ens.locator('h2').innerText())).toBe('Régler 2 pièces de Emballages du Sahel en un seul virement');
    expect(await ens.locator('[name=amount]').inputValue()).toBe('137.445');
    await ens.locator('#ok').click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    await expect.poll(async () => (await cellules('s-sahel'))[4]).toBe('—');
    expect(await p.locator('#list-wrap tr[data-sid="s-sahel"] [data-regler]').count()).toBe(0);
    expect(net(await p.locator('#list-wrap tfoot').innerText())).toBe('Total de la sélection 5 fournisseurs · tu garderas 4,146 DT de retenue pour l\'État en les payant 876,457 DT 677,979 dont 410,479 en retard');

    // 6. Le clavier : ↓ ↓ choisit l'imprimerie, Entrée ouvre sa fiche.
    await p.locator('#view h1').click();
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('ArrowDown');
    expect(await p.locator('#list-wrap tr.kb').getAttribute('data-sid')).toBe('s-neuf');
    await p.keyboard.press('Enter');
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/fournisseur/s-neuf');

    // 7. Au téléphone : trois puces, une carte par fournisseur, rien ne déborde, « Nouveau fournisseur » reste à portée.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate(() => { location.hash = '#/fournisseurs'; });
    await p.locator('.lc-carte').first().waitFor({ timeout: 20_000 });
    expect(await p.locator('#list-wrap table').isVisible()).toBe(false);
    expect(await p.locator('#lf-puces button').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))).toEqual(['Tu leur dois 2', 'En retard 1', 'À compléter 3']);
    expect(net(await p.locator('.lc-carte[data-sid="s-moulins"]').innerText())).toBe('GM Les Grands Moulins de Tunis Sami Gharbi · Ben Arous 410,479 en retard · 12 jours tu lui dois 410,479 DT');
    expect(await p.locator('#view .lfo-tete #new').isVisible()).toBe(true);
    // La bulle des filtres ne reste pas seule sous la recherche : les sélecteurs qu'elle explique sont des puces ici.
    expect(await p.locator('#lf-filtres button.i').isVisible()).toBe(false);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await p.screenshot({ path: path.join(PHOTOS, 'liste-fournisseurs-2-telephone.png') });

    // 8. À la tablette : le téléphone et le dernier achat cèdent leur place, « Régler » reste, aucun nom coupé.
    await p.setViewportSize({ width: 1024, height: 768 });
    await p.evaluate(() => { location.hash = '#/accueil'; location.hash = '#/fournisseurs'; });
    await p.locator('#list-wrap tr[data-sid="s-neuf"]').waitFor({ timeout: 20_000 });
    // (1.208.0) Les titres se lisent une fois la liste redessinée à la nouvelle largeur : lus aussitôt la ligne trouvée, ils
    // étaient encore cachés sur une machine lente (rouge GitHub de b71c73d, Node 24 : « [] »).
    await expect.poll(() => p.locator('#list-wrap thead th').evaluateAll((ths) => ths.filter((t) => (t as HTMLElement).offsetParent).length), { timeout: 10_000 }).toBeGreaterThan(0);
    expect(await p.locator('#list-wrap thead th').evaluateAll((ths) => ths.filter((t) => (t as HTMLElement).offsetParent).map((t) => (t as HTMLElement).innerText.replace(/[⇅↑↓]/g, '').trim()))).toEqual(['Fournisseur', 'Matricule et retenue', 'Acheté HT', 'Tu lui dois', 'Actions']);
    expect(await p.locator('#list-wrap tr[data-sid="s-moulins"] [data-regler]').isVisible()).toBe(true);
    expect(await p.locator('#list-wrap td.cl b').evaluateAll((bs) => bs.filter((b) => b.scrollWidth > b.clientWidth + 1).length)).toBe(0);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
    await p.screenshot({ path: path.join(PHOTOS, 'liste-fournisseurs-3-tablette.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
