// Le lot achats, à l'écran (05/10/2026 ; docs/achats.md, « Le parcours du 05/10/2026 » ; web/v10/achats-lot.txt,
// ecrans.css). Nadia tient une boulangerie ; sur son ordinateur portable (1366 × 768), elle commande sa farine et ses
// sacs, reçoit en deux fois, saisit la facture, la règle, en tire un avoir, lit une facture en photo, demande un prix.
// Ce que le parcours du commerçant avait trouvé, et que ce test tient :
//   - l'unité « Autre… » d'une commande : cherchée (« ballot »), elle reste proposée avec ce qu'on a tapé, la saisie
//     libre arrive préremplie, et la ligne garde « ballot » (elle gardait « __autre__ », imprimé sur le bon) ;
//   - « Recevoir » une commande en brouillon la fait partir ; une commande qui a reçu ne se remet pas en brouillon ;
//   - ce qu'une réception fait entrer en stock se compte (rien, ou une ligne), au message comme au bandeau de la facture ;
//   - les boutons retour de la réception, de la commande et d'une liste de prix répondent ;
//   - la catégorie : « Mati » propose d'abord ce qui commence par « Mati », et une catégorie créée paraît dans le champ ;
//   - le règlement dit « la déclaration d'août », et où s'établit l'attestation de retenue (TEJ) ;
//   - un avoir rattaché depuis la liste reprend la facture ; sans échéance ; « Modifications non enregistrées » le nomme ;
//   - une lecture sans échéance prend le délai du fournisseur ; « Joindre un justificatif » n'est pas proposé en ligne ;
//   - « Enregistrer » suit la saisie en bas d'un long achat ; l'invitation « Première fois sur cette page ? » se pose
//     dans un coin, sans rien couvrir du premier champ ;
//   - la demande de prix : pas de total à zéro, le PDF d'abord, et le message la nomme ;
//   - la fiche du fournisseur ne défile pas de côté.
// Les données discriminent : 500 sacs à 0,095 et 12 sacs de farine à 38,750 (7 %) ; 45 jours chez le fournisseur
// d'emballages (le délai par défaut est 30) ; août (élision).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le lot achats, à l\'écran', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-achats-lot-'));
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
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }), signal: AbortSignal.timeout(20_000),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Record<string, unknown> };
  };
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  const titre = (p: Page) => p.locator('#view h1').first().innerText().then(net);
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) {
      await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click({ timeout: 3_000 }).catch(() => undefined);
    }
  };
  const choisir = async (p: Page, conteneur: string, cherche: string) => {
    await p.locator(`${conteneur} .combo-btn`).click();
    await p.locator(`${conteneur} .combo-q`).fill(cherche);
    await p.locator(`${conteneur} .combo-list [role=option]`).first().click();
  };
  const toast = (p: Page) => p.locator('#toast').innerText().then(net).catch(() => '');
  const aller = async (p: Page, h: string) => { await p.evaluate((x) => { location.hash = x; }, h); };

  // La boulangerie de Nadia : son meunier (retenue 1 %, 30 jours), son fournisseur d'emballages (45 jours), la farine
  // suivie en stock. Connectée sur son ordinateur portable, à l'heure de Tunis.
  async function boulangerie() {
    const email = `nadia-achats-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Portable', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Boulangerie Ben Youssef' })).corps.id);
    await api('GET', `/entreprises/${ent}/dossier-v10`, jeton);
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: 'suppliers', cle: 's1', rang: 0, revision: null, contenu: { id: 's1', name: 'Les Grands Moulins de Tunis', matricule: '0876543B/A/M/000', phone: '71 234 567',
        email: 'commandes@grands-moulins.example', address: 'Zone industrielle, 2013 Ben Arous', withholdingRate: 1, paymentTermsDays: 30 } },
      { collection: 'suppliers', cle: 's2', rang: 1, revision: null, contenu: { id: 's2', name: 'Emballages du Sahel', paymentTermsDays: 45 } },
      { collection: 'catalog', cle: 'farine', rang: 0, revision: null, contenu: { id: 'farine', label: 'Farine T55, sac 25 kg', unit: 'sac', unitPrice: { '~n': '42.5' }, unitCost: { '~n': '38.75' }, vatRate: 7, tracked: true } },
      // Sa catégorie à elle, rangée après celles de départ : « Mati » doit la proposer d'abord.
      { collection: '_racine', cle: 'expenseCategories', rang: null, revision: null, contenu: ['Matières premières'] },
      // Deux factures du meunier dont les numéros se ressemblent : « 118 » doit choisir la 118, pas la 1187 (plus récente).
      ...[['p118', 'FA-2026/118', '2026-03-02'], ['p1187', 'FA-2026/1187', '2026-09-20']].map(([id, numero, date], i) => ({ collection: 'purchases', cle: id, rang: i, revision: null, contenu: {
        id, kind: 'facture', number: numero, date, supplierId: 's1', currency: 'DT', category: 'Achats de marchandises', fees: 0, withholdingRate: 0, createdAt: 1 + i,
        lines: [{ label: 'Farine T55, sac 25 kg', qty: 10, unit: 'sac', unitPrice: { '~n': '38.75' }, vatRate: 7, destination: 'charge', deductible: true }], payments: [] } })),
    ] })).statut).toBe(200);
    const surLeServeur = async (collection: string) => ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string; contenu: Record<string, unknown> }[])
      .filter((o) => o.collection === collection).map((o) => o.contenu);
    return { jeton, ent, surLeServeur };
  }
  async function ouvrir(jeton: string, ent: string, hash: string) {
    const cx = await navigateur.newContext({ viewport: { width: 1366, height: 768 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(`${serveur.adresse}/v10/?e=${ent}${hash}`);
    await p.locator('#view h1').first().waitFor({ timeout: 20_000 });
    return { cx, p, erreurs };
  }

  it('Nadia commande, reçoit en deux fois, saisit et règle la facture, en tire un avoir, lit une facture en photo', async () => {
    const b = await boulangerie();
    const { cx, p, erreurs } = await ouvrir(b.jeton, b.ent, '#/commandef/new/s1');
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Nouvelle commande fournisseur/);
    await plusTard(p);

    // 1. La commande : la farine du catalogue (12 sacs), et 500 sacs kraft, une unité que la liste n'a pas.
    // La date et la référence de la commande portent leur bulle « i ».
    expect(await p.locator('#cf-head [data-info="cf.date"]').count()).toBe(1);
    expect(await p.locator('#cf-head [data-info="cf.reference"]').count()).toBe(1);
    await choisir(p, '#cf-cat', 'Farine');
    const ligne = (i: number, k: string) => p.locator(`#cf-lines [data-k=${k}][data-i="${i}"]`);
    // La désignation prend la place que les autres colonnes laissent.
    expect(await ligne(0, 'label').evaluate((x) => x.getBoundingClientRect().width)).toBeGreaterThan(250);
    await ligne(0, 'qty').fill('12');
    await p.locator('#cf-add').click();
    await ligne(1, 'label').fill('Sacs kraft 2 kg');
    await ligne(1, 'qty').fill('500');
    await ligne(1, 'unitPrice').fill('0.095');
    // « ballot » cherché dans la liste des unités : « Autre… » reste là, avec ce qu'on a tapé ; la saisie arrive préremplie.
    await ligne(1, 'unit').click();
    // La recherche range ce qui commence par la frappe d'abord : « m » propose « mois » avant « demi-journée ».
    await p.locator('.lm-pop .lm-q').fill('m');
    await expect.poll(async () => net((await p.locator('.lm-pop .combo-it').allInnerTexts())[0] ?? '')).toBe('mois');
    await p.locator('.lm-pop .lm-q').fill('ballot');
    await expect.poll(async () => (await p.locator('.lm-pop .combo-it').allInnerTexts()).map(net)).toEqual(['Autre : « ballot »']);
    await p.locator('.lm-pop .lm-q').press('Enter');
    await expect.poll(() => p.locator('#modal-root input[name=v]').inputValue(), { timeout: 5_000 }).toBe('ballot');
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => ligne(1, 'unit').inputValue()).toBe('ballot');
    // Une unité tapée rejoint la liste des autres lignes.
    expect(await ligne(0, 'unit').locator('option[value="ballot"]').count()).toBe(1);
    await p.locator('#save').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Commande BCF-\d{4}-001/);
    const [cmd] = await b.surLeServeur('supplierOrders');
    expect((cmd?.lines as { unit: string }[]).map((l) => l.unit)).toEqual(['sac', 'ballot']);
    expect(cmd?.status).toBe('brouillon');

    // 2. « Recevoir » une commande en brouillon : elle part (le serveur refuserait sinon la réception validée).
    await p.locator('#cf-recevoir').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Réception \(brouillon\)/);
    expect((await b.surLeServeur('supplierOrders'))[0]?.status).toBe('envoyée');
    // Les sacs arrivent, la farine pas encore : rien de suivi n'entre en stock, et le message le dit.
    await p.locator('[data-rq="0"]').fill('0');
    await p.locator('[data-rq="1"]').fill('500');
    await p.locator('#rec-valider').click();
    await expect.poll(() => toast(p), { timeout: 10_000 }).toMatch(/^Réception BR-\d{4}-001 validée : aucune de ses lignes n'est un article suivi en stock, donc le stock ne bouge pas\. Pour suivre un article, coche « Suivi en stock » sur sa fiche, dans le Catalogue\.$/);
    // Le bouton retour de la réception répond.
    const ici = await p.evaluate(() => location.hash);
    await p.locator('#back').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 5_000 }).not.toBe(ici);
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Commande BCF-/);
    // Une commande qui a reçu ne se remet ni en brouillon ni en demande de prix.
    expect(await p.locator('#cf-head select[name=status] option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).toEqual(['envoyée', 'soldée', 'annulée']);

    // 3. Le reste : la farine, suivie en stock ; le message compte la ligne entrée.
    await p.locator('#cf-recevoir').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Réception \(brouillon\)/);
    await p.locator('#rec-valider').click();
    await expect.poll(() => toast(p), { timeout: 10_000 }).toMatch(/^Réception BR-\d{4}-002 validée : sa ligne est entrée en stock\.$/);
    await p.locator('#back').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Commande BCF-/);
    // Le bouton retour de la commande répond aussi.
    const surCommande = await p.evaluate(() => location.hash);
    await p.locator('#back').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 5_000 }).not.toBe(surCommande);
    await aller(p, surCommande);
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Commande BCF-/);

    // 4. La facture du fournisseur, depuis ses réceptions. L'invitation de la page se pose dans un coin : elle ne couvre
    // pas le premier champ, et « Guide-moi » s'allume.
    await p.locator('#cf-facturer').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Nouvelle facture d'achat/);
    await p.locator('#guide-appel').waitFor({ timeout: 5_000 });
    expect(await p.locator('#guide-appel').getAttribute('class')).toContain('ga-coin');
    expect(await p.locator('#guide-moi').getAttribute('class')).toContain('guide-moi-signale');
    const invite = await p.locator('#guide-appel').boundingBox();
    const champ = await p.locator('[data-combo=supplierId]').boundingBox();
    expect(invite && champ && (invite.x > champ.x + champ.width || invite.y > champ.y + champ.height || invite.x + invite.width < champ.x || invite.y + invite.height < champ.y)).toBe(true);
    // Dans le coin bas droit de l'écran.
    expect(invite && invite.x + invite.width > 1366 - 40 && invite.y + invite.height > 768 - 40).toBe(true);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'achats-lot-1-invitation.png') });
    await plusTard(p);
    expect(await p.locator('#guide-moi').getAttribute('class')).not.toContain('guide-moi-signale');
    // Le bandeau compte ce que les réceptions ont fait entrer : la farine, suivie.
    expect(net(await p.locator('#b-receptions').innerText())).toMatch(/: sa marchandise suivie est déjà entrée en stock par elles, ces lignes ne l'y font pas entrer une seconde fois\./);
    // Sans pièces jointes en ligne, « Joindre un justificatif » n'est pas proposé.
    expect(await p.locator('#attach-top').count()).toBe(0);
    // La catégorie : « Mati » propose d'abord ce qui commence par la frappe (sa catégorie à elle, pourtant la dernière de
    // la liste), puis ce dont un mot commence par elle ; « Formation » (forMATIon) passe après.
    await p.locator('[data-combo=category] .combo-btn').click();
    await p.locator('[data-combo=category] .combo-q').fill('Mati');
    expect((await p.locator('[data-combo=category] .combo-list [role=option]').allInnerTexts()).map(net)).toEqual(['Matières premières', 'Achats de matières premières', 'Formation']);
    // Une catégorie neuve : la fenêtre la reprend, et le champ la montre.
    await p.locator('[data-combo=category] .combo-q').fill('Emballages');
    await p.locator('[data-combo=category] .combo-add').click();
    await expect.poll(() => p.locator('#modal-root input[name=v]').inputValue(), { timeout: 5_000 }).toBe('Emballages');
    await p.locator('#modal-root #ok').click();
    await expect.poll(async () => net(await p.locator('[data-combo=category] .combo-val').innerText())).toBe('Emballages');
    await p.locator('#view input[name=number]').fill('GMT-2026-0412');
    // « Enregistrer » suit la saisie en bas de la page, quand celui du haut n'est plus à l'écran.
    expect(await p.locator('#b-save-bar').isVisible()).toBe(false);
    await p.locator('#b-notes').scrollIntoViewIfNeeded();
    await p.locator('#view').evaluate((v) => { v.scrollTop = v.scrollHeight; });
    await expect.poll(() => p.locator('#b-save-bar').isVisible(), { timeout: 5_000 }).toBe(true);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'achats-lot-2-enregistrer-en-bas.png') });
    await p.locator('#b-save-bas').click();
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Facture d'achat GMT-2026-0412/);

    // 5. Le règlement d'août : la retenue se reverse avec « la déclaration d'août », et l'attestation s'établit sur TEJ.
    await p.locator('#pay').click();
    await p.locator('#spf .datefield .d-txt').first().fill('15/08/2026');
    await p.locator('#spf .datefield .d-txt').first().press('Tab');
    await expect.poll(async () => net(await p.locator('#spf-rs').innerText())).toMatch(/de retenue à la source : tu la reverses à l'État avec la déclaration d'août 2026, et tu en remets l'attestation au fournisseur ; elle s'établit sur TEJ, la plateforme du ministère des Finances\. À VÉRIFIER avec ton comptable\./);
    // On ne l'enregistre pas : la fenêtre garde la date tapée, et demande avant de la jeter.
    await p.locator('#modal-root').getByRole('button', { name: 'Annuler', exact: true }).click();
    await p.getByRole('button', { name: 'Abandonner la saisie', exact: true }).click();
    await expect.poll(() => p.locator('#modal-root .modal-bg').count(), { timeout: 5_000 }).toBe(0);

    // 6. Un avoir, rattaché depuis la liste : il reprend la facture ; sans échéance ; son objet parle d'un avoir.
    await aller(p, '#/achat/new');
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Nouvelle facture d'achat/);
    await p.locator('#b-head select[name=kind]').selectOption('avoir');
    await expect.poll(() => p.locator('#b-head input[name=dueDate]').evaluate((x) => (x.closest('.field') as HTMLElement).hidden)).toBe(true);
    expect(await p.locator('#b-head input[name=subject]').getAttribute('placeholder')).toBe('Ce que l\'avoir corrige : retour, remise, erreur de prix…');
    await choisir(p, '[data-combo=supplierId]', 'Moulins');
    // « 118 » propose d'abord FA-2026/118 : un numéro tapé en entier passe devant celui qui le contient (FA-2026/1187).
    await p.locator('[data-combo=achatLie] .combo-btn').click();
    await p.locator('[data-combo=achatLie] .combo-q').fill('118');
    expect(net(await p.locator('[data-combo=achatLie] .combo-list [role=option]').first().innerText())).toMatch(/^FA-2026\/118(?!7)/);
    await p.locator('[data-combo=achatLie] .combo-q').fill('GMT-2026-0412');
    await p.locator('[data-combo=achatLie] .combo-list [role=option]').first().click();
    await expect.poll(() => p.locator('#b-head input[name=subject]').inputValue(), { timeout: 5_000 }).toBe('Avoir sur GMT-2026-0412');
    expect(net(await p.locator('[data-combo=category] .combo-val').innerText())).toBe('Emballages');
    // Les lignes de la facture, dans l'ordre de ses réceptions : les sacs d'abord, la farine ensuite.
    expect(await p.locator('#b-lines input[data-k=label]').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value))).toEqual(['Sacs kraft 2 kg', 'Farine T55, sac 25 kg']);
    // On le quitte sans l'enregistrer : la question le nomme.
    await p.locator('#back').click();
    await expect.poll(async () => net(await p.locator('#modal-root').innerText()), { timeout: 5_000 }).toContain('Tu as modifié cet avoir sans enregistrer.');
    await p.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click();

    // 7. Une facture lue en photo, sans échéance écrite : elle prend le délai du fournisseur (45 jours, pas 30).
    await aller(p, '#/achat/new');
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Nouvelle facture d'achat/);
    await p.evaluate(() => {
      (window as unknown as { __ocrDemo: unknown }).__ocrDemo = { supplier: 'Emballages du Sahel', number: 'ES-2026-0077', date: '12/09/2026',
        lines: [{ label: 'Boîtes à gâteaux 30 × 30', qty: 200, unitPrice: 0.385, vatRate: 19 }], totalHT: 77 };
      document.dispatchEvent(new Event('skanfact:ocr-demo'));
    });
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#b-head input[name=dueDate]').inputValue(), { timeout: 10_000 }).toBe('2026-10-27');

    await p.locator('#back').click();
    if (await p.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).count()) await p.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click();

    // 8. La liste des achats ne propose pas de filtrer « Sans justificatif » (on ne peut pas en joindre en ligne) ; la
    // visite « Saisir une facture d'achat » saute l'étape du justificatif et passe au fournisseur, sans se perdre.
    await aller(p, '#/achats');
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Achats/);
    await plusTard(p);
    expect((await p.locator('#view option').allInnerTexts()).map(net)).not.toContain('Sans justificatif');
    await p.locator('#guide-moi').click();
    await p.locator('.guide-menu').getByText('Saisir une facture d\'achat', { exact: true }).click();
    await expect.poll(async () => net(await p.locator('#visite-titre').innerText()), { timeout: 5_000 }).toBe('Nouvelle facture d\'achat');
    await p.locator('.page-head #new').click();
    await expect.poll(async () => net(await p.locator('#visite-titre').innerText()), { timeout: 8_000 }).toBe('Le fournisseur');
    expect(await p.locator('#visite-bulle').getAttribute('class')).not.toContain('perdu');
    await p.keyboard.press('Escape');
    // La clôture du mois ne réclame pas les justificatifs qu'on ne peut pas joindre en ligne (FA-2026/118, en mars, n'en
    // a pas).
    await aller(p, '#/compta');
    await plusTard(p);
    await p.locator('#c-tabs [data-tab=clotures]').click();
    await expect.poll(async () => net(await p.locator('#c-body').innerText()), { timeout: 10_000 }).toMatch(/État/);
    expect(net(await p.locator('#c-body').innerText())).not.toContain('sans justificatif');

    // 9. La fiche du fournisseur, à 1366 px : rien ne défile de côté, et le reste à payer se lit.
    await aller(p, '#/fournisseur/s1');
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Les Grands Moulins de Tunis/);
    await plusTard(p);
    const [large, visible] = await p.locator('#view').evaluate((v) => [v.scrollWidth, v.clientWidth] as const);
    expect(large).toBeLessThanOrEqual(visible + 1);
    const reste = await p.locator('#sup-docs thead th').filter({ hasText: 'Reste' }).boundingBox();
    expect(reste && reste.x + reste.width <= 1366).toBe(true);
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'achats-lot-3-fiche-fournisseur.png') });

    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);

  it('une demande de prix sans prix s\'envoie d\'abord ; le retour d\'une liste de prix répond', async () => {
    const b = await boulangerie();
    // Une commande de l'an dernier, enregistrée avec l'unité « __autre__ » (le défaut d'avant ce lot).
    expect((await api('POST', `/entreprises/${b.ent}/dossier-v10`, b.jeton, { changements: [{ collection: 'supplierOrders', cle: 'o-ancienne', rang: 0, revision: null, contenu: {
      id: 'o-ancienne', type: 'commandeFournisseur', number: 'BCF-2025-014', status: 'envoyée', date: '2025-11-20', dueDate: '', supplierId: 's1', reference: '', currency: 'DT',
      exchangeRate: '', discountRate: 0, notes: '', createdAt: 1, lines: [{ label: 'Sacs kraft 2 kg', description: '', qty: 40, unit: '__autre__', unitPrice: { '~n': '0.095' }, vatRate: 19 }] } }] })).statut).toBe(200);
    const { cx, p, erreurs } = await ouvrir(b.jeton, b.ent, '#/commandef/new/demande');
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Nouvelle demande de prix/);
    await plusTard(p);
    await choisir(p, '[data-combo=supplierId]', 'Moulins');
    await p.locator('#cf-lines [data-k=label][data-i="0"]').fill('Levure fraîche 500 g');
    await p.locator('#cf-lines [data-k=qty][data-i="0"]').fill('100');
    // Pas de « Total TTC 0,000 » : les prix se saisissent à la réponse du fournisseur, dans la colonne qui le dit.
    await expect.poll(() => p.locator('#cf-sans-prix').count()).toBe(1);
    expect(await p.locator('#cf-totals table').count()).toBe(0);
    expect(await p.locator('table:has(#cf-lines) thead').textContent()).toContain('Prix répondu HT');
    await p.locator('#save').click();
    await expect.poll(() => toast(p), { timeout: 10_000 }).toMatch(/^Demande de prix BCF-\d{4}-001 enregistrée$/);
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Demande de prix BCF-/);
    // L'étape suivante est d'envoyer la demande (PDF) ; « Commander » le devient quand les prix sont là.
    expect(await p.locator('#cf-pdf').getAttribute('class')).toContain('btn-primary');
    expect(await p.locator('#cf-commander').getAttribute('class')).not.toContain('btn-primary');
    await p.screenshot({ animations: 'disabled', path: path.join(PHOTOS, 'achats-lot-4-demande-de-prix.png') });

    // La commande de l'an dernier se relit sans unité, plutôt qu'avec « __autre__ ».
    await aller(p, '#/commandef/o-ancienne');
    await expect.poll(() => titre(p), { timeout: 10_000 }).toMatch(/^Commande BCF-2025-014/);
    expect(await p.locator('#cf-lines select[data-k=unit][data-i="0"]').evaluate((s) => (s as HTMLSelectElement).selectedOptions[0]?.textContent)).toBe('—');

    // Le bouton retour d'une liste de prix répond.
    await aller(p, '#/listeprix/new');
    await p.locator('#back').waitFor({ timeout: 10_000 });
    await plusTard(p);
    await p.locator('#back').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 5_000 }).not.toBe('#/listeprix/new');
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 120_000);
});
