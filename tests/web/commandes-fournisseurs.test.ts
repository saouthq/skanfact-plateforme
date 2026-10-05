// Une commande fournisseur reçue en deux fois, puis la facture du fournisseur saisie depuis ses réceptions,
// à la souris (brique 87 ; 14 § 3.2 ; web/v10/commandes-fournisseurs.txt). Ce que le parcours vérifie,
// écran ET serveur :
//   - la commande se crée (fournisseur, articles du catalogue à leur coût d'achat, une ligne libre), prend son
//     numéro, et s'imprime pour le fournisseur ;
//   - « Recevoir » reprend toute la commande, dont les lignes se figent tant que la réception est en
//     préparation ; on ne valide qu'une partie : la commande se dit « reçue en
//     partie », son panneau compte, et la marchandise suivie entre en stock ; « Recevoir le reste » ne reprend
//     QUE le reste ;
//   - « Saisir la facture du fournisseur » : l'achat pré-rempli depuis les deux réceptions (chaque ligne de
//     commande en une ligne), enregistré et tenu par le serveur ; le stock n'entre pas une seconde fois ;
//     une COPIE de cette facture ne couvre aucune réception, et sa marchandise entre en stock.
// Les données discriminent : 2,5 t de fer reçues 1,25 + 1,25 à 2 210,500.

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

describe('une commande fournisseur reçue en deux fois, et sa facture saisie depuis les réceptions, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-commandes-fournisseurs-'));
  beforeAll(async () => {
    await admin.connect();
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
  const titre = (p: Page) => p.locator('#view h1').first().innerText().then(net);
  const choisir = async (p: Page, conteneur: string, cherche: string) => {
    await p.locator(`${conteneur} .combo-btn`).click();
    await p.locator(`${conteneur} .combo-q`).fill(cherche);
    await p.locator(`${conteneur} .combo-list [role=option]`).first().click();
  };
  // Le stock d'un article, lu sur sa fiche (ce que la personne voit).
  const stockDe = async (p: Page, article: string) => {
    await p.evaluate((a) => { location.hash = '#/article/' + a; }, article);
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Ciment gris 50 kg/);
    return net(await p.locator('#view').innerText());
  };

  it('Nadia commande à son fournisseur, reçoit en deux fois, puis saisit sa facture depuis les réceptions', async () => {
    const email = `nadia-commandes-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Matériaux Ben Youssef' })).corps.id);
    // Le fournisseur et deux articles suivis en stock, à leur coût d'achat.
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    const ecrit = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Ciments de Bizerte', matricule: '7654321B/A/M/000', address: 'Zone industrielle, Bizerte' } },
      { collection: 'catalog', cle: 'ciment', rang: 0, revision: null, contenu: { id: 'ciment', label: 'Ciment gris 50 kg', unit: 'sac', unitPrice: 21, unitCost: { '~n': '17.25' }, vatRate: 19, tracked: true } },
      { collection: 'catalog', cle: 'fer', rang: 1, revision: null, contenu: { id: 'fer', label: 'Fer à béton 12 mm', unit: 't', unitPrice: 2600, unitCost: { '~n': '2210.5' }, vatRate: 19, tracked: true } },
    ] });
    expect(ecrit.statut).toBe(200);

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/commandesf`);
    await expect.poll(() => titre(p), { timeout: 20_000 }).toBe('Commandes fournisseurs i');
    await plusTard(p);

    // 1. La commande : le fournisseur, deux articles du catalogue, un transport ; envoyée.
    await p.locator('#cf-vide-new').click();
    await expect.poll(() => titre(p)).toMatch(/^Nouvelle commande fournisseur/);
    await plusTard(p);
    await choisir(p, '[data-combo=supplierId]', 'Bizerte');
    await choisir(p, '#cf-cat', 'Ciment');
    await choisir(p, '#cf-cat', 'Fer');
    await p.locator('#cf-add').click();
    const ligne = (i: number, k: string) => p.locator(`#cf-lines [data-k=${k}][data-i="${i}"]`);
    await ligne(0, 'qty').fill('100');
    await ligne(1, 'qty').fill('2.5');
    await ligne(2, 'label').fill('Transport');
    await ligne(2, 'unitPrice').fill('60');
    await p.locator('#cf-head select[name=status]').selectOption('envoyée');
    // 100 × 17,250 + 2,5 × 2 210,500 + 60 = 7 311,250 HT.
    await expect.poll(async () => net(await p.locator('#cf-totals').innerText())).toMatch(/^Total HT 7 311,250 DT TVA 1 389,138 DT Total TTC 8 700,388 DT$/);
    await p.locator('#save').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Commande BCF-\d{4}-001/);
    const numero = (await titre(p)).replace(/^Commande /, '').replace(/ .*$/, '');
    // Le menu allume « Commandes fournisseurs » ; les quantités restent des quantités (pas « 100.000 »).
    expect(net(await p.locator('nav a.active').innerText())).toBe('Commandes fournisseurs');
    expect([await ligne(0, 'qty').inputValue(), await ligne(1, 'qty').inputValue()]).toEqual(['100', '2.5']);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'commandes-fournisseurs-1-commande.png') });

    // 2. Elle s'imprime pour le fournisseur.
    const fenetre = p.waitForEvent('popup');
    await p.locator('#cf-pdf').click();
    const imprimee = await fenetre;
    await imprimee.waitForLoadState();
    const texte = net(await imprimee.locator('body').innerText());
    expect(texte).toMatch(/Bon de commande/i);
    expect(texte).toContain(numero);
    expect(texte).toMatch(/FOURNISSEUR Ciments de Bizerte/);
    expect(texte).toContain('Merci de nous confirmer cette commande, ses prix et sa date de livraison.');
    await imprimee.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'commandes-fournisseurs-2-imprimee.png') });
    await imprimee.close();

    // 3. Première réception : tout est proposé, 60 sacs et 1,25 t arrivent.
    await p.locator('#cf-recevoir').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Réception \(brouillon\)/);
    const recu = (i: number) => p.locator(`[data-rq="${i}"]`);
    expect([await recu(0).inputValue(), await recu(1).inputValue(), await recu(2).inputValue()]).toEqual(['100', '2.5', '1']);
    // Tant qu'une réception est en préparation, les lignes de la commande ne changent plus (elle s'y rattache
    // par leur rang) ; le message dit comment les débloquer, et rien ne se propose une seconde fois.
    await p.goBack();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Commande BCF-/);
    expect(net(await p.locator('#cf-figee').innerText())).toMatch(/^Cette commande a une réception en préparation : ses lignes ne changent plus .* supprime d'abord cette réception\.$/);
    expect(await p.locator('#cf-lines [data-k=qty]').first().isDisabled()).toBe(true);
    expect(await p.locator('#cf-recevoir').count()).toBe(0);
    await p.goForward();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Réception \(brouillon\)/);
    await recu(0).fill('60');
    await recu(1).fill('1.25');
    await p.locator('#rec-valider').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Réception BR-\d{4}-001/);

    // 4. La commande est reçue en partie ; son panneau compte ; « Recevoir le reste » ne reprend que le reste.
    await p.locator('#view .page-head a').filter({ hasText: numero }).click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Commande BCF-/);
    expect(net(await p.locator('#view .page-head .small').first().innerText())).toBe('Ciments de Bizerte · reçue en partie');
    expect(net(await p.locator('#receptions-panel').innerText())).toMatch(/^Réceptions i DÉSIGNATION COMMANDÉ REÇU RESTE Ciment gris 50 kg \(sac\) 100 60 40 Fer à béton 12 mm \(t\) 2,5 1,25 1,25 Transport 1 1 0 Réception : BR-\d{4}-001 \(validée, /);
    expect(await p.locator('#cf-recevoir').innerText()).toBe('Recevoir le reste');
    await p.locator('#receptions-panel').scrollIntoViewIfNeeded();
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'commandes-fournisseurs-3-recue-en-partie.png') });
    expect(await stockDe(p, 'ciment')).toMatch(/EN STOCK 60 sacs .* Réception BR-\d{4}-001 \+60 17,250 DT 60/);
    await p.goBack();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Commande BCF-/);
    await p.locator('#cf-recevoir').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Réception \(brouillon\)/);
    expect([await recu(0).inputValue(), await recu(1).inputValue()]).toEqual(['40', '1.25']);
    expect(await p.locator('[data-rq]').count()).toBe(2);
    await p.locator('#rec-valider').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Réception BR-\d{4}-002/);

    // 5. La facture du fournisseur, depuis les deux réceptions : chaque ligne de commande en une ligne.
    await p.locator('#rec-facturer').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Nouvelle facture/);
    await plusTard(p);
    // Le ciment et le fer sont suivis en stock : leur marchandise est entrée par les réceptions (lot achats, 05/10/2026 :
    // la phrase se dit d'après les mouvements de stock, et seulement s'il y en a).
    expect(net(await p.locator('#b-receptions').innerText())).toMatch(/^Saisie depuis les réceptions BR-\d{4}-001, BR-\d{4}-002 : sa marchandise suivie est déjà entrée en stock par elles/);
    const lignesAchat = await p.locator('#b-lines tr').evaluateAll((trs) => trs.map((tr) => [
      (tr.querySelector('[data-k=label]') as HTMLInputElement | null)?.value ?? '', (tr.querySelector('[data-k=qty]') as HTMLInputElement | null)?.value ?? '']).filter((x) => x[0]));
    expect(lignesAchat).toEqual([['Ciment gris 50 kg', '100'], ['Fer à béton 12 mm', '2.5'], ['Transport', '1']]);
    // Chaque ligne reçue le dit (« reçue par une réception ») ; sa copie (⧉) n'a été reçue par aucune réception.
    expect(await p.locator('#b-lines [data-recue]').allInnerTexts()).toEqual(['reçue par une réception', 'reçue par une réception', 'reçue par une réception']);
    await p.locator('#b-lines [data-dup="0"]').click();
    await expect.poll(() => p.locator('#b-lines tr[data-i]').count()).toBe(4);
    expect(await p.locator('#b-lines tr[data-i="1"] [data-recue]').count()).toBe(0);
    await p.locator('#b-lines [data-rm="1"]').click();
    await expect.poll(() => p.locator('#b-lines tr[data-i]').count()).toBe(3);
    expect(await p.locator('#b-lines [data-recue]').count()).toBe(3);
    // Un écart avec les réceptions se dit pendant la saisie, sous les lignes : 105 sacs facturés pour 100
    // reçus, puis remis à 100 ; le transport facturé 65 au lieu de 60 (il reste : le fournisseur l'a facturé).
    expect(await p.locator('#b-ecarts').innerText()).toBe('');
    const achatLigne = (i: number, k: string) => p.locator(`#b-lines tr[data-i="${i}"] input[data-k=${k}]`);
    await achatLigne(0, 'qty').fill('105');
    await expect.poll(async () => net(await p.locator('#b-ecarts').innerText())).toMatch(/^Un écart avec les réceptions i Ciment gris 50 kg : 105 sac facturés, 100 reçus \(5 de plus\) La facture s'enregistre telle que le fournisseur l'a émise/);
    await achatLigne(0, 'qty').fill('100');
    await expect.poll(() => p.locator('#b-ecarts').innerText()).toBe('');
    await achatLigne(2, 'unitPrice').fill('65');
    await expect.poll(async () => net(await p.locator('#b-ecarts').innerText())).toMatch(/^Un écart avec les réceptions i Transport : facturé 65,000 DT l'unité, commandé à 60,000 DT /);
    await p.locator('#view input[name=number]').fill('F-8841');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'commandes-fournisseurs-4-facture.png') });
    await p.locator('#b-ecarts').scrollIntoViewIfNeeded();
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'commandes-fournisseurs-4b-ecart.png') });
    await p.locator('#save').click();
    const auServeur = async () => (await admin.query(`select numero_fournisseur, total_ht from achats.piece where entreprise = $1 and nature = 'facture'`, [ent])).rows;
    await expect.poll(auServeur, { timeout: 15_000 }).toEqual([{ numero_fournisseur: 'F-8841', total_ht: 7316250n }]);

    // 6. Le stock n'est entré qu'une fois (100 sacs, par les réceptions) ; la commande est reçue et facturée.
    const fiche = await stockDe(p, 'ciment');
    expect(fiche).toMatch(/EN STOCK 100 sacs/);
    const mouvements = fiche.slice(fiche.indexOf('Historique des mouvements'));
    expect(mouvements).toMatch(/Réception BR-\d{4}-002 \+40 17,250 DT 100 .* Réception BR-\d{4}-001 \+60 17,250 DT 60/);
    expect(mouvements).not.toMatch(/Achat/);
    // La copie de cette facture ne couvre aucune réception : pas de bandeau, et ses lignes font entrer leur
    // marchandise en stock comme n'importe quel achat (100 sacs de plus).
    const idAchat = String((await admin.query(`select cle from socle.dossier_v10 where entreprise = $1 and collection = 'purchases'`, [ent])).rows[0].cle);
    await p.evaluate((id) => { location.hash = '#/achat/' + id; }, idAchat);
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/F-8841/);
    await p.locator('#more-btn').click();
    await p.locator('#dup').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/sans numéro/);
    expect(await p.locator('#b-receptions').count()).toBe(0);
    expect(await stockDe(p, 'ciment')).toMatch(/EN STOCK 200 sacs/);
    await p.evaluate(() => { location.hash = '#/commandesf'; });
    await expect.poll(async () => net(await p.locator('#cf-list').innerText()), { timeout: 10_000 }).toMatch(/BCF-\d{4}-001 Ciments de Bizerte .* reçue 7 311,250 DT/);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'commandes-fournisseurs-5-liste.png') });
    expect(erreurs).toEqual([]);
    await cn.close();

    // 7. Au téléphone : la commande tient dans la largeur (ses tableaux défilent dans leur cadre).
    const tel = await navigateur.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'fr-FR' });
    await tel.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const t = await tel.newPage();
    const id = String((await admin.query(`select cle from socle.dossier_v10 where entreprise = $1 and collection = 'supplierOrders'`, [ent])).rows[0].cle);
    await t.goto(`${serveur.adresse}/v10/?e=${ent}#/commandef/${id}`);
    await expect.poll(() => titre(t), { timeout: 20_000 }).toMatch(/^Commande BCF-/);
    await plusTard(t);
    expect(await t.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // La commande nomme la facture de ses réceptions, et son écart.
    expect(net(await t.locator('#cf-factures').innerText())).toBe('Facture : F-8841 (un écart avec les réceptions)');
    await t.locator('#receptions-panel').scrollIntoViewIfNeeded();
    await t.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'commandes-fournisseurs-6-telephone.png') });
    await tel.close();
  }, 180_000);
});
