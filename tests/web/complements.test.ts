// Les compléments dessinés le 27/10/2026 (docs/maquettes/complements.html), à la souris :
//   - « Retour à la liste » : une facture, un devis, un achat ont le bouton qui ramène à leur liste, au bureau ; au
//     téléphone, c'est le lien du chemin (« ‹ Achats et dépenses ») qui le fait, et le bouton se range ;
//   - « Facture électronique reçue » : le fichier El Fatoora d'un fournisseur se lit dans une PAGE, plus une fenêtre où la
//     liste des catégories débordait sur les lignes. Case par case, d'où vient chaque case, ce qui reste à trancher ; la
//     catégorie se choisit sous sa case, le fournisseur se crée avec ce que dit le fichier ; « Remplir la pièce » remplit
//     l'achat, la référence TTN dans ses notes. Adressée à une autre société, pas signée, un total qui ne tombe pas juste :
//     chacun son bandeau, et la case marquée ;
//   - « Mon comptable », sans cabinet : la page dessinée (ce qu'il fait ici, les deux chemins, ce qu'il ne fait jamais),
//     une adresse fausse refusée sous sa case, l'invitation qui attend avec ses étapes, annulée d'un geste.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { libererMatricule } from '../matricule-libre.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const NOUS = '7654321C/A/M/000';
const net = (t: string) => t.replace(/\s+/g, ' ').trim();

// Le fichier El Fatoora de la Clinique Les Jasmins : 4 × 150,000 de formation à 7 %, 600,000 HT, 643,000 TTC (timbre 1,000).
// `qte` fausse la ligne (5 × 150 = 750) sans toucher aux totaux du fichier ; `acheteur` est la société à qui il est adressé.
function teif(o: { acheteur: string; nomAcheteur: string; qte?: number; signe?: boolean }) {
  const qte = o.qte ?? 4;
  return `<?xml version="1.0" encoding="UTF-8"?>
<TEIF version="1.8.8" controlingAgency="TTN"><InvoiceHeader><MessageSenderIdentifier type="I-01">1234567AAM000</MessageSenderIdentifier></InvoiceHeader>
<InvoiceBody><Bgm><DocumentIdentifier>FAC-2026-027</DocumentIdentifier><DocumentType code="I-11">Facture</DocumentType></Bgm>
<Dtm><DateText format="ddMMyy" functionCode="I-31">231026</DateText><DateText format="ddMMyy" functionCode="I-32">221126</DateText></Dtm>
<PartnerSection><PartnerDetails functionCode="I-62"><Nad><PartnerIdentifier type="I-01">1234567AAM000</PartnerIdentifier><PartnerName nameType="Qualification">Clinique Les Jasmins</PartnerName>
<PartnerAdresses lang="fr"><AdressDescription>12 rue des Jasmins</AdressDescription><CityName>Tunis</CityName><PostalCode>1002</PostalCode></PartnerAdresses></Nad>
<CtaSection><Contact functionCode="I-94"></Contact><Communication><ComMeansType>I-101</ComMeansType><ComAdress>71 000 111</ComAdress></Communication></CtaSection></PartnerDetails>
<PartnerDetails functionCode="I-64"><Nad><PartnerIdentifier type="I-01">${o.acheteur}</PartnerIdentifier><PartnerName nameType="Qualification">${o.nomAcheteur}</PartnerName></Nad></PartnerDetails></PartnerSection>
<LinSection><Lin><ItemIdentifier>1</ItemIdentifier><LinImd lang="fr"><ItemCode>F1</ItemCode><ItemDescription>Formation sensibilisation cybersécurité</ItemDescription></LinImd>
<LinQty><Quantity measurementUnit="UNIT">${qte}</Quantity></LinQty><LinTax><TaxTypeName code="I-1602">TVA</TaxTypeName><TaxDetails><TaxRate>7</TaxRate></TaxDetails></LinTax>
<LinMoa><MoaDetails><Moa amountTypeCode="I-183"><Amount currencyIdentifier="TND">150.000</Amount></Moa></MoaDetails><MoaDetails><Moa amountTypeCode="I-171"><Amount currencyIdentifier="TND">${(qte * 150).toFixed(3)}</Amount></Moa></MoaDetails></LinMoa></Lin></LinSection>
<InvoiceMoa><AmountDetails><Moa amountTypeCode="I-176"><Amount currencyIdentifier="TND">600.000</Amount></Moa></AmountDetails><AmountDetails><Moa amountTypeCode="I-180"><Amount currencyIdentifier="TND">643.000</Amount></Moa></AmountDetails></InvoiceMoa>
<InvoiceTax><InvoiceTaxDetails><Tax><TaxTypeName code="I-1601">droit de timbre</TaxTypeName><TaxDetails><TaxRate>0</TaxRate></TaxDetails></Tax><AmountDetails><Moa amountTypeCode="I-178"><Amount currencyIdentifier="TND">1.000</Amount></Moa></AmountDetails></InvoiceTaxDetails>
<InvoiceTaxDetails><Tax><TaxTypeName code="I-1602">TVA</TaxTypeName><TaxDetails><TaxRate>7</TaxRate></TaxDetails></Tax><AmountDetails><Moa amountTypeCode="I-177"><Amount currencyIdentifier="TND">600.000</Amount></Moa></AmountDetails><AmountDetails><Moa amountTypeCode="I-178"><Amount currencyIdentifier="TND">42.000</Amount></Moa></AmountDetails></InvoiceTaxDetails></InvoiceTax>
<Ftx><FreeTextDetail subjectCode="I-41"><FreeTexts>Formation sensibilisation, session de rentrée</FreeTexts></FreeTextDetail></Ftx></InvoiceBody>
${o.signe === false ? '' : '<RefTtnVal>TTN-2026-10-004812</RefTtnVal><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignatureValue>AAAA</ds:SignatureValue></ds:Signature>'}</TEIF>`;
}

describe('les compléments dessinés le 27/10/2026, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-complements-'));
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
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };

  // Nadia, son atelier (son matricule), un achat de Bureau Plus Sfax, une facture et un devis émis.
  async function nadia() {
    const email = `nadia-cpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Atelier Nadia' })).corps.id);
    type Objet = { collection: string; cle: string; revision: number; contenu: Record<string, unknown> };
    const fiche = ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[]).find((o) => o.collection === '_racine' && o.cle === 'company');
    await libererMatricule(inject('pgAdmin'), NOUS);
    const ligne = { label: 'Ramettes A4', qty: 20, unit: '', unitPrice: { '~n': '12.5' }, vatRate: 19, destination: 'charge', deductible: true };
    const ok = await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche?.revision ?? null, contenu: { ...fiche?.contenu, name: 'Atelier Nadia', matricule: NOUS } },
      { collection: 'suppliers', cle: 'bureau', rang: 0, revision: null, contenu: { id: 'bureau', name: 'Bureau Plus Sfax', matricule: '1390022T/A/M/000' } },
      { collection: 'purchases', cle: 'achat1', rang: 0, revision: null, contenu: { id: 'achat1', kind: 'facture', supplierId: 'bureau', number: 'BP-8812', date: '2026-10-20', dueDate: '2026-11-19', currency: 'DT', category: 'Fournitures de bureau', fees: 0, withholdingRate: 0, createdAt: 1, lines: [ligne], payments: [] } },
    ] });
    expect(ok.statut, JSON.stringify(ok.corps)).toBe(200);
    return { jeton, ent };
  }
  async function ouvrir(jeton: string, ent: string, ici: string, viewport = { width: 1440, height: 900 }) {
    const cn = await navigateur.newContext({ viewport, locale: 'fr-FR', ...(viewport.width < 700 ? { isMobile: true, hasTouch: true } : {}) });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cn.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}${ici}`);
    await expect.poll(() => p.locator('#view h1').first().innerText().catch(() => ''), { timeout: 20_000 }).not.toBe('');
    await plusTard(p);
    return { p, erreurs, fermer: () => cn.close() };
  }
  const aller = (p: Page, h: string) => p.evaluate((x) => { location.hash = x; }, h);
  const deposer = (p: Page, xml: string) => p.evaluate((x) => {
    const f = new File([x], 'TEIF_FAC-2026-027.xml', { type: 'text/xml' });
    const dt = new DataTransfer(); dt.items.add(f);
    document.querySelector('#ac-zone')?.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, xml);
  const ligneLue = (p: Page, nom: string) => p.locator('#ac-lecture .ac-lec-l').filter({ has: p.locator('.n', { hasText: nom }) });

  it('retour à la liste : la facture, le devis et l\'achat ramènent à leur liste ; au téléphone, par le chemin', async () => {
    const { jeton, ent } = await nadia();
    const { p, erreurs, fermer } = await ouvrir(jeton, ent, '#/achats');
    for (const [liste, piece, nom] of [['#/achats', '#/achat/achat1', 'achats'], ['#/factures', '#/doc/new/facture', 'factures'], ['#/devis', '#/doc/new/devis', 'devis']] as const) {
      await aller(p, liste); await p.waitForTimeout(800);
      await aller(p, piece);
      const b = p.locator('#view .ed-retour-btn');
      await b.waitFor({ timeout: 15_000 });
      expect(await b.getAttribute('aria-label')).toBe(`Revenir aux ${nom}`);
      await b.click();
      await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toBe(liste);
    }
    expect(erreurs).toEqual([]);
    await fermer();
    // Au téléphone, le bouton se range : le chemin le fait (« ‹ Achats et dépenses »).
    const t = await ouvrir(jeton, ent, '#/achats', { width: 390, height: 844 });
    await aller(t.p, '#/achat/achat1');
    await t.p.locator('#view .ed-chemin .ed-retour').waitFor({ timeout: 15_000 });
    expect(await t.p.locator('#view .ed-retour-btn').isVisible()).toBe(false);
    await t.p.locator('#view .ed-chemin .ed-retour').click();
    await expect.poll(() => t.p.evaluate(() => location.hash), { timeout: 10_000 }).toBe('#/achats');
    expect(t.erreurs).toEqual([]);
    await t.fermer();
  }, 120_000);

  it('la facture électronique reçue : une page, la catégorie sous sa case, le fournisseur créé du fichier, la pièce remplie avec sa référence TTN', async () => {
    const { jeton, ent } = await nadia();
    const { p, erreurs, fermer } = await ouvrir(jeton, ent, '#/achat/new');
    await p.locator('#ac-zone').waitFor({ timeout: 15_000 });
    await deposer(p, teif({ acheteur: '7654321CAM000', nomAcheteur: 'Atelier Nadia' }));
    const page = p.locator('#ac-lecture');
    await page.getByText('Ce que dit le fichier El Fatoora').waitFor({ timeout: 15_000 });
    // Une page, pas une fenêtre ; son titre, son chemin, ce qui reste.
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    expect(await p.locator('#view .ed-tete h1').innerText()).toBe('Facture électronique FAC-2026-027');
    expect(await p.locator('#view .ed-chemin [aria-current]').innerText()).toBe('Facture électronique reçue');
    expect(await p.locator('#view .ed-pill').innerText()).toBe('2 cases à vérifier');
    expect(net(await ligneLue(p, 'Fournisseur').innerText())).toMatch(/« Clinique Les Jasmins » n'est pas dans tes fournisseurs : ?\+ Créer « Clinique Les Jasmins ».*matricule 1234567A\/A\/M\/000, adresse et téléphone repris du fichier$/);
    expect(net(await ligneLue(p, 'Adressée à').innerText())).toMatch(/ta société · 7654321C\/A\/M\/000 ton matricule, lu dans le fichier$/);
    expect(net(await ligneLue(p, 'Total').innerText())).toMatch(/recompté 643,000 = total du fichier 643,000 TTC, au millime HT 600,000 · TVA 7 % 42,000 · timbre 1,000$/);
    expect(net(await ligneLue(p, 'Signature').innerText())).toMatch(/signature électronique présente · réf\. TTN TTN-2026-10-004812/);
    expect(await page.locator('.bandeau').count()).toBe(0);
    // Sur la plateforme, le XML ne se joint pas : la page le dit, au lieu de promettre qu'il se joint.
    expect(net(await page.locator('.ed-avant').innerText())).toMatch(/Sa référence TTN se garde dans les notes de l'achat Garde le fichier XML : SkanFact ne le joint pas encore à l'achat$/);
    await p.screenshot({ path: path.join(PHOTOS, 'complements-1-efacture.png'), fullPage: true });
    // La catégorie : la liste s'ouvre sous sa case, dans la page.
    await ligneLue(p, 'Catégorie').locator('.combo-btn').click();
    const liste = ligneLue(p, 'Catégorie').locator('.combo-pop');
    await expect.poll(() => liste.isVisible()).toBe(true);
    await liste.getByText('Sous-traitance', { exact: true }).click();
    await expect.poll(() => p.locator('#view .ed-pill').innerText()).toBe('1 case à vérifier');
    // Le fournisseur : sa fiche naît de ce que dit le fichier.
    await ligneLue(p, 'Fournisseur').locator('.combo-btn').click();
    await ligneLue(p, 'Fournisseur').locator('.combo-pop').getByText('+ Créer « Clinique Les Jasmins »').click();
    const fiche = p.locator('#modal-root .modal').filter({ hasText: 'Nouveau fournisseur' });
    await fiche.waitFor({ timeout: 10_000 });
    expect(await fiche.locator('[name=matricule]').inputValue()).toBe('1234567A/A/M/000');
    expect(await fiche.locator('[name=phone]').inputValue()).toBe('71 000 111');
    expect(await fiche.locator('[name=address]').inputValue()).toContain('12 rue des Jasmins');
    await fiche.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(() => p.locator('#view .ed-pill').innerText(), { timeout: 10_000 }).toBe('Vérifiée');
    expect(net(await ligneLue(p, 'Fournisseur').innerText())).toMatch(/Clinique Les Jasmins reconnu par son matricule 1234567A\/A\/M\/000, lu dans le fichier/);
    // « Vérifier case par case » s'ouvre PAR-DESSUS la page : la catégorie choisie y est, sa liste s'ouvre vers le haut (vers le
    // bas, elle sortait de la fenêtre et couvrait ses boutons), et « Annuler » revient à la page, intacte.
    await page.getByRole('button', { name: 'Vérifier case par case', exact: true }).click();
    const verif = p.locator('#modal-root .modal').filter({ hasText: 'La facture électronique FAC-2026-027' });
    await verif.waitFor({ timeout: 10_000 });
    expect(await p.locator('#ac-lecture').isVisible()).toBe(true);
    expect(await verif.locator('[name=category]').inputValue()).toBe('Sous-traitance');
    await verif.locator('[data-combo=category] .combo-btn').click();
    await expect.poll(() => verif.locator('[data-combo=category]').getAttribute('class')).toContain('up');
    const liste2 = await verif.locator('[data-combo=category] .combo-pop').boundingBox(), cadre = await verif.boundingBox();
    expect((liste2?.y ?? Infinity) + (liste2?.height ?? 0)).toBeLessThanOrEqual((cadre?.y ?? 0) + (cadre?.height ?? 0));
    await p.keyboard.press('Escape');
    await verif.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    expect(await p.locator('#view .ed-pill').innerText()).toBe('Vérifiée');
    // Remplir : la pièce, sa catégorie, sa référence TTN ; aucune erreur de pièce jointe (un toast d'erreur aussitôt
    // recouvert par celui de la réussite se note ici, au passage).
    await p.evaluate(() => {
      const w = window as unknown as { __erreurs: string[] }, t = document.querySelector('#toast');
      w.__erreurs = [];
      if (t) new MutationObserver(() => { if (t.classList.contains('error')) w.__erreurs.push(t.textContent ?? ''); }).observe(t, { attributes: true, childList: true, subtree: true });
    });
    await page.getByRole('button', { name: /^Remplir la pièce/ }).click();
    await expect.poll(() => p.locator('#ac-lecture').count(), { timeout: 10_000 }).toBe(0);
    // Le toast dit d'où vient la pièce et le geste qui suit ; le XML, qui ne se joint pas ici, ne s'annonce pas joint.
    await expect.poll(() => p.locator('#toast .toast-txt').innerText().then(net), { timeout: 10_000 }).toBe('Pièce remplie depuis la facture électronique : vérifie, puis « Enregistrer l\'achat ».');
    expect(await p.evaluate(() => (window as unknown as { __erreurs: string[] }).__erreurs)).toEqual([]);
    expect(await p.locator('#b-head input[name=number]').inputValue()).toBe('FAC-2026-027');
    expect(net(await p.locator('#view').innerText())).toContain('Sous-traitance');
    expect(await p.locator('#b-notes').inputValue()).toBe('Référence TTN : TTN-2026-10-004812');
    expect(erreurs).toEqual([]);
    await fermer();
  }, 120_000);

  it('la facture électronique adressée à une autre société, pas signée, dont la ligne ne tombe pas juste : trois bandeaux, trois cases', async () => {
    const { jeton, ent } = await nadia();
    const { p, erreurs, fermer } = await ouvrir(jeton, ent, '#/achat/new');
    await p.locator('#ac-zone').waitFor({ timeout: 15_000 });
    // D'abord un XML qui n'est pas une facture : le refus dit lequel, en mots simples, et offre les deux suites.
    await p.evaluate(() => {
      const dt = new DataTransfer(); dt.items.add(new File(['<?xml version="1.0"?><Commande><Numero>12</Numero></Commande>'], 'commande.xml', { type: 'text/xml' }));
      document.querySelector('#ac-zone')?.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    const refus = p.locator('#modal-root .modal').filter({ hasText: 'n\'est pas une facture électronique' });
    await refus.waitFor({ timeout: 10_000 });
    expect(await refus.locator('h2').innerText()).toBe('« commande.xml » n\'est pas une facture électronique');
    expect(net(await refus.innerText())).toMatch(/SkanFact y cherche une facture El Fatoora et n'en trouve pas\. Choisis le fichier XML que ton fournisseur ou la plateforme El Fatoora t'a envoyé, ou saisis la pièce à la main\./);
    expect(await refus.locator('.modal-actions button').allInnerTexts()).toEqual(['Saisir à la main', 'Choisir un autre fichier']);
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('#modal-root .modal').count()).toBe(0);
    await deposer(p, teif({ acheteur: '7654321BAM000', nomAcheteur: 'Clinique El Amen', qte: 5, signe: false }));
    const page = p.locator('#ac-lecture');
    await page.getByText('Ce que dit le fichier El Fatoora').waitFor({ timeout: 15_000 });
    expect((await page.locator('.bandeau b').allInnerTexts()).map(net)).toEqual([
      'Cette facture est adressée à « Clinique El Amen » (7654321B/A/M/000), pas à ta société',
      'Ce fichier n\'est pas signé : ce n\'est pas encore la facture validée par la TTN',
      'Le total recompté ne tombe pas sur celui du fichier',
    ]);
    // Le fournisseur et la catégorie, plus ces trois-là.
    expect(await p.locator('#view .ed-pill').innerText()).toBe('5 cases à vérifier');
    expect(await ligneLue(p, 'Adressée à').getAttribute('class')).toContain('douteux');
    expect(await ligneLue(p, 'Signature').getAttribute('class')).toContain('douteux');
    expect(net(await ligneLue(p, 'Formation').innerText())).toMatch(/5 × 150,000 = 750,000 · TVA 7 % les lignes font 750,000 HT, le fichier annonce 600,000 HT$/);
    expect(net(await ligneLue(p, 'Total').innerText())).toMatch(/recompté 803,500, le fichier dit 643,000 TTC écart de 160,500 : corrige la ligne marquée$/);
    expect(net(await page.locator('.ac-tf-fich').innerText())).toMatch(/Pas encore signée par la TTN garde aussi la facture signée qu'El Fatoora t'enverra$/);
    await p.screenshot({ path: path.join(PHOTOS, 'complements-2-efacture-ecarts.png'), fullPage: true });
    // « Saisir à la main », en haut : la page se ferme, la pièce se saisit.
    await p.locator('#tf-main').click();
    await expect.poll(() => p.locator('#ac-lecture').count()).toBe(0);
    expect(await p.locator('#tf-main').count()).toBe(0);
    expect(erreurs).toEqual([]);
    await fermer();
  }, 120_000);

  it('« Mon comptable » sans cabinet : la page dessinée, l\'adresse fausse refusée sous sa case, l\'invitation et ses étapes, annulée', async () => {
    const { jeton, ent } = await nadia();
    const { p, erreurs, fermer } = await ouvrir(jeton, ent, '#/dashboard');
    await p.locator('#b-inviter-comptable').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe('#/comptable');
    await expect.poll(() => p.evaluate(() => document.activeElement?.id), { timeout: 15_000 }).toBe('mandat-email');
    const page = p.locator('.cpt-page');
    expect(net(await page.locator('.cpt-hero').innerText())).toMatch(/^Ton comptable travaille dans tes pièces, sans que tu lui envoies rien Il voit tes pièces/);
    expect(net(await page.locator('.cpt-garde').innerText())).toMatch(/Ce qu'il ne fait jamais Modifier une facture que tu as émise Écrire dans ton dossier sans ton accord/);
    expect(await page.locator('[data-perimetre]:checked').count()).toBe(3);
    await p.screenshot({ path: path.join(PHOTOS, 'complements-3-comptable.png'), fullPage: true });
    await page.locator('#mandat-email').fill('karim');
    await page.locator('#mandat-inviter-envoyer').click();
    await expect.poll(() => page.locator('#mandat-refus-email').innerText().then(net)).toMatch(/par exemple nom@cabinet\.tn : rien n'a été envoyé\.$/);
    expect((await api('GET', `/entreprises/${ent}/mandat/invitation`, jeton)).corps.invitation).toBeNull();
    await page.locator('#mandat-email').fill('karim@fiduciaire-essai.tn');
    await page.locator('#mandat-email').press('Enter');
    await expect.poll(() => page.locator('.cpt-tete span').innerText(), { timeout: 15_000 }).toBe('Invitation envoyée : elle attend ton comptable');
    expect(net(await page.locator('.cpt-etapes').innerText())).toMatch(/^Invité son lien vaut jusqu'au \d\d\/\d\d\/\d{4} 2 Il crée son cabinet avec le lien reçu par e-mail 3 Il accepte ton dossier la messagerie s'ouvre$/);
    expect(await page.locator('.cpt-puce').allInnerTexts()).toEqual(['La comptabilité', 'Les déclarations', 'La saisie des achats']);
    // Ce serveur n'envoie pas d'e-mails : le lien, à copier, et le curseur dessus.
    await expect.poll(() => p.evaluate(() => document.activeElement?.id)).toBe('mandat-lien-copier');
    expect(await page.locator('#mandat-lien').inputValue()).toMatch(/\?comptable=[A-Za-z0-9_-]{20,}$/);
    await p.screenshot({ path: path.join(PHOTOS, 'complements-4-comptable-invite.png'), fullPage: true });
    await page.locator('#mandat-annuler-invitation').click();
    await expect.poll(() => p.locator('#toast .toast-txt').innerText().then(net), { timeout: 10_000 }).toBe('Invitation annulée : le lien envoyé à karim@fiduciaire-essai.tn ne marche plus.');
    await expect.poll(() => page.locator('.cpt-tete span').innerText(), { timeout: 15_000 }).toBe('Ton cabinet, dans les mêmes données que toi');
    await expect.poll(() => p.evaluate(() => document.activeElement?.id)).toBe('mandat-email');
    expect((await api('GET', `/entreprises/${ent}/mandat/invitation`, jeton)).corps.invitation).toBeNull();
    expect(erreurs).toEqual([]);
    await fermer();
  }, 120_000);
});
