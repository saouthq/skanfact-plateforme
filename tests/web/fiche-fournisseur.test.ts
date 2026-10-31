// La fiche d'un fournisseur de la maquette (1.205.0 ; docs/maquettes/achats-fournisseurs.html, validée le 30/10/2026), à la
// souris et au téléphone, sur trois fournisseurs : le meunier (retenue 1 %, une facture en retard, une facture payée dont
// l'attestation de retenue reste à remettre, une commande envoyée), le fournisseur d'emballages (deux factures en retard,
// un avoir déduit de rien, ni matricule, ni RIB, ni e-mail), l'imprimerie (aucun achat, exonérée de retenue pour 30 jours).
//   - l'en-tête dit l'état (pastille), la ville, depuis quand, ce que tu lui dois et ce qui est en retard ; le bouton
//     principal est calculé : régler LA pièce en retard, régler ses pièces en retard d'un virement, ou le prochain achat ;
//   - les bandeaux disent ce qui presse et donnent le geste (retard, avoir, exonération qui finit, attestations, matricule, RIB) ;
//   - les onglets Achats, Règlements, Commandes, Retenues ; le fil de la relation ; la colonne de droite ; le menu ⋯ ;
//   - sans réseau, on ne règle pas (pour ne jamais payer deux fois) ; au téléphone et à la tablette, rien ne déborde.

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

describe('la fiche d\'un fournisseur, à la souris et au téléphone', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-fiche-fournisseur-'));
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
  const fr = (iso: string) => iso.split('-').reverse().join('/');
  const plusTard = async (p: Page) => {
    await p.waitForTimeout(300);
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };

  it('l\'en-tête, le bouton calculé, les bandeaux, les onglets, le fil, la colonne de droite, le menu, sans réseau, le téléphone', async () => {
    const email = `fiche-fournisseur-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia Ben Youssef', motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).jeton);
    const ent = String((await api('POST', '/entreprises-essai', jeton)).id);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    const depart = (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).objets as { collection: string; cle: string; revision: number }[];
    const exemples = depart.filter((o) => o.collection === 'purchases' || o.collection === 'suppliers' || o.collection === 'supplierOrders');
    if (exemples.length) await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: exemples.map((o) => ({ collection: o.collection, cle: o.cle, rang: null, revision: o.revision, contenu: null })) });
    const piece = (id: string, rang: number, contenu: Record<string, unknown>) => ({ collection: 'purchases', cle: id, rang, revision: null,
      contenu: { id, kind: 'facture', currency: 'DT', fees: 0, withholdingRate: 0, createdAt: 10 + rang, payments: [], attachments: [], category: 'Achats', ...contenu } });
    const finExo = jour(30);
    const pose = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'suppliers', cle: 's-moulins', rang: 0, revision: null, contenu: { id: 's-moulins', name: 'Les Grands Moulins de Tunis', contact: 'Sami Gharbi', city: 'Ben Arous', matricule: '0876543B/A/M/000',
        phone: '71 234 567', email: 'commandes@grands-moulins.example', bank: 'BIAT', rib: '10 405 0012345678901 23', withholdingRate: 1, paymentTermsDays: 30, notes: 'Livraison le mardi matin.' } },
      { collection: 'suppliers', cle: 's-sahel', rang: 1, revision: null, contenu: { id: 's-sahel', name: 'Emballages du Sahel', contact: 'Hela Mansour', city: 'Sfax', phone: '74 862 004', paymentTermsDays: 45 } },
      { collection: 'suppliers', cle: 's-neuf', rang: 2, revision: null, contenu: { id: 's-neuf', name: 'Imprimerie Al Amal', city: 'Tunis', matricule: '1366201T/A/M/000', phone: '71 300 120', email: 'contact@alamal.example',
        paymentTermsDays: 15, withholdingRate: n('1.5'), exonerationsRS: [{ numero: 'EX-2026-118', du: '2026-01-01', au: finExo }] } },
      // Le meunier : 10 sacs à 38,750 HT à 7 % (414,625 TTC), retenue de 1 % (4,146) au règlement ; échue depuis 12 jours.
      piece('p-farine', 0, { number: 'FA-2026/0812', date: '2026-09-20', dueDate: jour(-12), supplierId: 's-moulins', withholdingRate: 1,
        lines: [{ label: 'Farine T55', qty: 10, unitPrice: n('38.75'), vatRate: 7, destination: 'charge' }] }),
      // 8 sacs (331,700 TTC), payés le 05/09 : 328,383 versés, 3,317 gardés pour l'État ; l'attestation n'est pas remise.
      piece('p-ble', 1, { number: 'FA-2026/0700', date: '2026-08-10', dueDate: '2026-09-09', supplierId: 's-moulins', withholdingRate: 1,
        payments: [{ id: 'r-ble', date: '2026-09-05', amount: n('328.383'), method: 'virement', reference: 'VIR-0905' }],
        lines: [{ label: 'Farine de blé dur', qty: 8, unitPrice: n('38.75'), vatRate: 7, destination: 'charge' }] }),
      { collection: 'supplierOrders', cle: 'o-moulins', rang: 0, revision: null, contenu: { id: 'o-moulins', type: 'commandeFournisseur', number: 'BCF-2026-004', status: 'envoyée', date: '2026-10-02', dueDate: '2026-10-15',
        supplierId: 's-moulins', reference: 'Semaine 42', currency: 'DT', exchangeRate: '', discountRate: 0, notes: '', createdAt: 1, lines: [{ label: 'Farine T55', description: '', qty: 20, unit: '__autre__', unitPrice: n('38.75'), vatRate: 7 }] } },
      // Les emballages : 91,630 échue depuis 20 jours, 45,815 depuis 5 jours, et un avoir de 9,163 déduit de rien.
      piece('p-boites', 2, { number: 'ES-4471', date: '2026-09-10', dueDate: jour(-20), supplierId: 's-sahel', lines: [{ label: 'Boîtes', qty: 200, unitPrice: n('0.385'), vatRate: 19, destination: 'charge' }] }),
      piece('p-sachets', 3, { number: 'ES-4502', date: '2026-09-25', dueDate: jour(-5), supplierId: 's-sahel', lines: [{ label: 'Sachets', qty: 100, unitPrice: n('0.385'), vatRate: 19, destination: 'charge' }] }),
      piece('p-avoir', 4, { kind: 'avoir', number: 'AV-ES-09', date: '2026-09-28', supplierId: 's-sahel', lines: [{ label: 'Boîtes abîmées', qty: 20, unitPrice: n('0.385'), vatRate: 19, destination: 'charge' }] }),
    ] });
    expect(pose.motif, JSON.stringify(pose)).toBeUndefined();

    const cx = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const e = new URLSearchParams(location.search).get('e'); if (e) sessionStorage.setItem('skanfact.essai_tel_quel', e); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    const ouvrir = async (id: string) => {
      await p.evaluate((x) => { location.hash = '#/fournisseur/' + x; }, id);
      await p.locator(`#view .ff-tete [data-rowmenu="FF:${id}"]`).waitFor({ timeout: 20_000 });
    };
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/fournisseur/s-moulins`);
    await p.locator('#view .ff-tete').waitFor({ timeout: 20_000 });
    await plusTard(p);
    const texte = async (sel: string) => net(await p.locator(sel).innerText());
    const primaires = () => p.locator('#view .btn-primary').evaluateAll((bs) => bs.filter((b) => (b as HTMLElement).offsetParent).map((b) => (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
    const onglets = () => p.locator('#view .cf-onglets button').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));

    // 1. Le meunier : l'en-tête, la pastille, ce que tu lui dois, et UN bouton principal : régler la pièce en retard.
    expect(await texte('#view .ff-tete .chemin')).toBe('Accueil Fournisseurs Les Grands Moulins de Tunis');
    expect(await texte('#view .ff-tete h1')).toBe('Les Grands Moulins de Tunis En retard');
    expect(await texte('#view .ff-tete .sous')).toMatch(/^Ben Arous · fournisseur depuis août 2026 · tu lui dois 410,479 DT, tout en retard$/);
    expect(await primaires()).toEqual(['Régler FA-2026/0812']);
    expect(await texte('#view .ff-tete .actions #buy')).toBe('Enregistrer un achat');
    // Les bandeaux : le retard (et ce qu'on garde pour l'État), l'attestation de la facture payée ; ni matricule ni RIB ne manquent.
    expect(await texte('#ff-retard')).toBe(`410,479 DT en retard depuis 12 jours — 1 pièce : FA-2026/0812 (échue le ${fr(jour(-12)).slice(0, 5)}). En payant, tu garderas 4,146 DT de retenue pour l'État. Le prévenir`);
    expect(await texte('#ff-attest')).toBe('1 attestation de retenue à lui remettre — FA-2026/0700 · 3,317 DT retenus. Il en a besoin pour déduire cette retenue de ses impôts. Les préparer');
    expect(await p.locator('#ff-mf, #ff-rib, #ff-avoir, #ff-exo, #ff-hors-ligne').count()).toBe(0);
    expect(await onglets()).toEqual(['Achats 2', 'Règlements 1', 'Commandes 1', 'Retenues 1']);
    // L'onglet Achats : ses deux pièces, la plus récente d'abord, et leur reste.
    expect(await p.locator('#sup-docs tbody tr').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).dataset.id))).toEqual(['p-farine', 'p-ble']);
    // L'objet d'une pièce sans objet se lit dans ses lignes.
    expect(await p.locator('#sup-docs tbody tr td:nth-child(3)').allInnerTexts()).toEqual(['Farine T55', 'Farine de blé dur']);
    expect(await texte('#ff-rib-v')).toBe('10 405 0012345678901 23');
    // Le RIB se lit d'une traite : une seule ligne, rien ne dépasse de sa carte.
    expect(await p.locator('#ff-rib-v').evaluate((d) => (d as HTMLElement).offsetHeight < 26 && d.scrollWidth <= (d as HTMLElement).offsetWidth)).toBe(true);
    // Le fil de la relation, du plus récent au plus ancien.
    expect(await p.locator('.ff-fil-l li').evaluateAll((ls) => ls.map((l) => (l as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))).toEqual([
      'Commande BCF-2026-004 envoyée Semaine 42 02/10/2026',
      'Facture FA-2026/0812 reçue Farine T55 · 410,479 DT 20/09/2026',
      'Réglé FA-2026/0700 328,383 DT par virement · 3,317 DT gardés pour l\'État 05/09/2026',
      'Facture FA-2026/0700 reçue Farine de blé dur · 328,383 DT 10/08/2026']);
    // La colonne de droite : ses coordonnées, ses conditions (reprises sur chaque achat), de quoi le payer, les notes.
    expect(await texte('#ff-delai')).toBe('30 jours l\'échéance de ses factures');
    expect(await texte('#ff-rs')).toBe('1 % que tu gardes au règlement, pour l\'État');
    expect(await p.locator('#sup-notes').inputValue()).toBe('Livraison le mardi matin.');
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
    await p.screenshot({ path: path.join(PHOTOS, 'fiche-fournisseur-1.png') });

    // 2. Les onglets Règlements, Commandes, Retenues ; « Les préparer » mène aux retenues.
    await p.locator('#view .cf-onglets [data-onglet="reglements"]').click();
    expect(await texte('#ff-onglet .cf-o-t')).toBe('1 règlement · 328,383 DT versés · 3,317 DT gardés pour l\'État (retenue à la source)');
    expect(await texte('#ff-onglet tbody tr')).toBe('05/09/2026 FA-2026/0700 Farine de blé dur Virement VIR-0905 328,383 DT 3,317 DT');
    await p.locator('#view .cf-onglets [data-onglet="commandes"]').click();
    expect(await texte('#ff-onglet tbody tr')).toMatch(/^BCF-2026-004 Semaine 42 02\/10\/2026 15\/10\/2026 .+ 775,000 DT$/);
    await p.locator('#ff-attest [data-onglet="retenues"]').click();
    expect(await p.locator('#view .cf-onglets [aria-selected="true"]').getAttribute('data-onglet')).toBe('retenues');
    expect(await p.locator('#ff-onglet tbody tr').evaluateAll((trs) => trs.map((tr) => (tr as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))).toEqual([
      'FA-2026/0812 Farine T55 pas encore payée 414,625 DT 4,146 DT à venir au règlement',
      'FA-2026/0700 Farine de blé dur 05/09/2026 331,700 DT 3,317 DT Imprimer l\'attestation']);
    await p.screenshot({ path: path.join(PHOTOS, 'fiche-fournisseur-2-retenues.png') });

    // 3. Sans réseau : la fiche le dit, et le règlement attend le réseau.
    await cx.setOffline(true);
    await expect.poll(() => p.locator('#ff-hors-ligne').count()).toBe(1);
    expect(await p.locator('#ff-regler').count()).toBe(0);
    await cx.setOffline(false);
    await expect.poll(() => p.locator('#ff-regler').count()).toBe(1);

    // 4. « Régler FA-2026/0812 » : la pièce est payée, le retard s'efface, une seconde attestation est à remettre, et le
    //    bouton principal redevient le prochain achat.
    await p.locator('#ff-regler').click();
    const fen = p.locator('#modal-root .modal');
    await fen.waitFor();
    expect(await fen.locator('[name=amount]').inputValue()).toBe('410.479');
    await fen.locator('#ok').click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    await expect.poll(() => p.locator('#ff-retard').count()).toBe(0);
    expect(await texte('#view .ff-tete h1')).toBe('Les Grands Moulins de Tunis À jour');
    expect(await texte('#view .ff-tete .sous')).toBe('Ben Arous · fournisseur depuis août 2026 · tu ne lui dois rien');
    expect(await primaires()).toEqual(['Enregistrer un achat']);
    expect(await texte('#ff-attest')).toMatch(/^2 attestations de retenue à lui remettre — FA-2026\/0700 · 3,317 DT retenus ; FA-2026\/0812 · 4,146 DT retenus\./);

    // 5. Les emballages : deux pièces en retard, réglées d'un virement ; l'avoir, le matricule et le RIB qui manquent.
    await ouvrir('s-sahel');
    expect(await texte('#view .ff-tete h1')).toBe('Emballages du Sahel En retard');
    // L'avoir de 9,163 est déduit de ce que tu lui dois : le retard (137,445) le dépasse, c'est donc « tout en retard ».
    expect(await texte('#view .ff-tete .sous')).toBe('Sfax · fournisseur depuis septembre 2026 · tu lui dois 128,282 DT, tout en retard');
    expect(await primaires()).toEqual(['Régler ses 2 pièces en retard · 137,445 DT']);
    expect(await texte('#ff-retard')).toMatch(/^137,445 DT en retard depuis 20 jours — 2 pièces : ES-4471 \(échue le .+\), ES-4502 \(échue le .+\)\.$/);
    expect(await texte('#ff-avoir')).toBe('9,163 DT sont à toi : l\'avoir AV-ES-09 n\'est déduit de rien — déduis-le de sa prochaine facture ou demande-lui le remboursement ; jusque-là, son compte le compte en ta faveur. Ouvrir AV-ES-09');
    expect(await p.locator('#ff-mf').count()).toBe(1);
    // Au fil, un avoir se lit en moins, avec son icône rouge.
    expect(net(await p.locator('.ff-fil-l li').first().innerText())).toBe('Avoir AV-ES-09 reçue Boîtes abîmées · − 9,163 DT 28/09/2026');
    expect(await p.locator('.ff-fil-l li').first().locator('.ff-fil-ic.r').count()).toBe(1);
    expect(await texte('#ff-rib')).toMatch(/^Son RIB manque : tu lui dois 128,282 DT — /);
    expect(await texte('#ff-rib-v')).toBe('à renseigner 20 chiffres, contrôlés à la saisie');
    // Le menu ⋯ : sans e-mail, « Par e-mail » est éteint, et dit pourquoi ; il a des achats : on ne le supprime pas.
    await p.locator('#view .ff-tete [data-rowmenu]').click();
    const menu = p.locator('.row-menu');
    await menu.waitFor();
    expect(net(await menu.innerText())).toBe('Emballages du Sahel Modifier la fiche Coordonnées, délai, retenue, RIB LUI ÉCRIRE Par e-mail pas d\'e-mail sur sa fiche Par WhatsApp 74 862 004 CRÉER CHEZ LUI Enregistrer un achat Il reprend sa fiche Noter une dépense Un ticket, un petit achat Nouvelle commande Un bon de commande, à lui envoyer Demande de prix Le prix avant de commander SES DOCUMENTS Exporter ses pièces 3 lignes dans un tableur Supprimer ce fournisseur impossible : 3 achats liés');
    await p.keyboard.press('Escape');
    await p.screenshot({ path: path.join(PHOTOS, 'fiche-fournisseur-3-retards.png') });
    await p.locator('#ff-regler').click();
    await fen.waitFor();
    expect(net(await fen.locator('h2').innerText())).toBe('Régler 2 pièces de Emballages du Sahel en un seul virement');
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);

    // 6. L'imprimerie : nouvelle, exonérée pour 30 jours encore ; l'état vide offre le premier achat sans second bouton principal.
    await ouvrir('s-neuf');
    expect(await texte('#view .ff-tete h1')).toBe('Imprimerie Al Amal Nouveau');
    expect(await texte('#view .ff-tete .sous')).toBe('Tunis · aucun achat pour l\'instant');
    expect(await primaires()).toEqual(['Enregistrer un achat']);
    expect(await texte('#view .ff-tete .actions #ff-commande')).toBe('Nouvelle commande');
    expect(await texte('#ff-exo')).toBe(`Son attestation d'exonération de retenue finit le ${fr(finExo)}, dans 30 jours — n° EX-2026-118. Après cette date, la retenue de 1,5 % revient sur ses factures. Demande-lui la nouvelle attestation et note-la sur sa fiche. Noter la nouvelle`);
    expect(await texte('#ff-rs')).toBe(`aucune jusqu'au ${fr(finExo)} attestation EX-2026-118 · ensuite 1,5 %`);
    expect(await texte('#sup-docs .cf-vide')).toBe('Aucun achat chez ce fournisseur Sa première facture reprendra sa fiche : délai, retenue, RIB. Enregistrer un achat Lui passer commande');
    expect(await p.locator('.ff-fil').count()).toBe(0);
    await p.locator('#ff-commande-p').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/commandef/new/s-neuf');

    // 7. Au téléphone : le bouton principal en tête, les onglets se touchent, rien ne déborde.
    await p.setViewportSize({ width: 390, height: 844 });
    await ouvrir('s-sahel');
    expect(await p.locator('#ff-regler').isVisible()).toBe(true);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const [bouton, titre] = [await p.locator('#ff-regler').boundingBox(), await p.locator('#view .ff-tete h1').boundingBox()];
    expect(bouton && titre && bouton.width > 300).toBe(true);
    expect(await p.locator('#view .cf-onglets button').evaluateAll((bs) => bs.every((b) => (b as HTMLElement).getBoundingClientRect().height >= 44))).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'fiche-fournisseur-4-telephone.png'), fullPage: true });

    // 8. À la tablette : la colonne de droite passe dessous, ses achats tiennent dans leur carte.
    await p.setViewportSize({ width: 1024, height: 768 });
    await ouvrir('s-moulins');
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
    const [gauche, droite] = [await p.locator('#view .cf-gauche').boundingBox(), await p.locator('#view .cf-droite').boundingBox()];
    expect(gauche && droite && droite.y >= gauche.y + gauche.height - 1).toBe(true);
    const reste = await p.locator('#sup-docs thead th').filter({ hasText: 'Reste' }).boundingBox();
    expect(reste && gauche && reste.x + reste.width <= gauche.x + gauche.width + 1).toBe(true);
    await p.screenshot({ path: path.join(PHOTOS, 'fiche-fournisseur-5-tablette.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
