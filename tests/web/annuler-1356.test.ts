// 1.356.7 (bout en bout 10, la peinture de la boutique) : on change le numéro d'une facture d'achat enregistrée, puis « Annuler »
// (↶, Ctrl Z) la ramène exactement à ce qui est enregistré. L'en-tête disait encore « Modifications non enregistrées »,
// « Enregistrer les modifications » restait vert et quitter la page posait la question — pour une pièce qui n'avait plus rien
// à enregistrer. Même chose sur l'éditeur de devis, qui a son propre « Annuler ». « Rétablir » la remarque modifiée.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
describe('1.356.7 : « Annuler » qui ramène la pièce à ce qui est enregistré ne laisse rien à enregistrer', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-annuler-1356-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
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
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const texte = await r.text();
    return { statut: r.status, corps: (texte ? JSON.parse(texte) : {}) as Obj };
  };
  const personne = async (qui: string) => {
    const email = `${qui}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: qui, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return jeton;
  };
  const contexte = async (jeton: string, largeur = 1440, hauteur = 900): Promise<BrowserContext> => {
    const cx = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, locale: 'fr-FR', timezoneId: 'Africa/Tunis' });
    await cx.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await cx.addInitScript(() => { const x = new URLSearchParams(location.search).get('e'); if (x) sessionStorage.setItem('skanfact.essai_tel_quel', x); });
    return cx;
  };
  const plusTard = async (p: Page) => {
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click().catch(() => undefined);
  };
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

  it('annuler jusqu\'à ce qui est enregistré : plus rien à enregistrer ; rétablir : de nouveau', async () => {
    const sarra = await personne('sarra');
    const ent = String((await api('POST', '/entreprises-essai', sarra)).corps.id);
    const auj = jourDe(0);
    const fiche = (await api('GET', `/entreprises/${ent}/dossier-v10`, sarra)).corps.objets.find((o: Obj) => o.collection === '_racine' && o.cle === 'company');
    const societe = { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Sarra Mansour', name: 'Boulangerie El Amal', city: 'Sfax',
      address: '12 rue de la Liberté, Sfax', matricule: '1234567A/A/M/000', rib: '08001000000001234538', bank: 'BIAT', activity: 'artisanat' };
    const n = (x: string) => ({ '~n': x });
    const pose = await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null, contenu: societe },
      { collection: 'clients', cle: 'c-hotel', rang: 0, revision: null, contenu: { id: 'c-hotel', name: 'Hôtel Les Palmiers SA', matricule: '1472583B/A/M/000', city: 'Hammamet' } },
      { collection: 'documents', cle: 'd-1', rang: 0, revision: null, contenu: { id: 'd-1', type: 'devis', number: 'DEV-2026-001', date: auj, validUntil: jourDe(30),
        clientId: 'c-hotel', subject: 'Petits-déjeuners du séminaire', status: 'envoyé', discountRate: 0, currency: 'DT', exchangeRate: '', regimeTva: 'reel',
        lines: [{ label: 'Croissants au beurre', description: '', qty: 900, unit: '', unitPrice: n('1.2'), vatRate: 19 }] } },
      { collection: 'documents', cle: 'f-1', rang: 1, revision: null, contenu: { id: 'f-1', type: 'facture', date: auj, dueDate: jourDe(30), clientId: 'c-hotel',
        subject: 'Viennoiseries', status: 'brouillon', discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], regimeTva: 'reel',
        lines: [{ label: 'Croissants au beurre', description: '', qty: 100, unit: '', unitPrice: n('0.65'), vatRate: 19 }] } },
      { collection: 'suppliers', cle: 's-peintre', rang: 0, revision: null, contenu: { id: 's-peintre', name: 'Peinture Ksibi', matricule: '0912345B/A/M/000', paymentTermsDays: 30, withholdingRate: n('1.5') } },
      { collection: 'purchases', cle: 'a-1', rang: 0, revision: null, contenu: { id: 'a-1', kind: 'facture', number: 'PK-2611-07', date: auj, dueDate: jourDe(30), supplierId: 's-peintre',
        currency: 'DT', fees: 1, withholdingRate: n('1.5'), createdAt: Date.now(), lines: [{ label: 'Peinture de la boutique et du laboratoire', qty: 1, unitPrice: n('2400'), vatRate: 19, destination: 'charge' }] } },
    ] });
    expect(pose.statut, JSON.stringify(pose.corps)).toBe(200);

    const cx = await contexte(sarra);
    await cx.addInitScript(() => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); });
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (x) => erreurs.push(x.message));
    const verts = () => p.locator('#view .btn-primary').evaluateAll((l) => l.filter((b) => (b as HTMLElement).offsetParent).map((b) => (b as HTMLElement).innerText.trim()));
    const marque = () => p.locator('#dirty-dot').isVisible();
    const enregistre = () => p.locator('#ed-enreg').isVisible();

    // 1. Le devis : l'objet changé, puis ↶ — l'en-tête redevient celui de l'ouverture.
    await p.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/d-1`);
    const objet = p.locator('[name=subject]');
    await objet.waitFor({ timeout: 20_000 });
    await plusTard(p);
    const vertsDevis = await verts();
    expect(await marque()).toBe(false);
    expect(await enregistre()).toBe(true);
    await objet.click();
    await objet.press('End');
    await objet.pressSequentially(', avec boissons');
    await p.locator('#view h1').first().click();
    await expect.poll(marque).toBe(true);
    expect(await verts()).toEqual(['Enregistrer les modifications']);
    await expect.poll(() => p.locator('#ed-annuler').isDisabled()).toBe(false);
    await p.locator('#ed-annuler').click();
    await expect.poll(() => objet.inputValue()).toBe('Petits-déjeuners du séminaire');
    expect(await marque()).toBe(false);
    expect(await enregistre()).toBe(true);
    expect(await verts()).toEqual(vertsDevis);
    // Rétablie, la modification est de nouveau à enregistrer ; annulée encore, plus rien.
    await p.locator('#view h1').first().click();
    await p.keyboard.press('Control+Shift+z');
    await expect.poll(() => objet.inputValue()).toBe('Petits-déjeuners du séminaire, avec boissons');
    expect(await marque()).toBe(true);
    expect(await verts()).toEqual(['Enregistrer les modifications']);
    await p.keyboard.press('Control+z');
    await expect.poll(marque).toBe(false);
    expect(await verts()).toEqual(vertsDevis);
    // Ce qui est enregistré suit le dernier enregistrement : enregistré avec « avec jus », puis modifié et annulé, le devis
    // revient à « avec jus » sans rien à enregistrer.
    await objet.click();
    await objet.press('End');
    await objet.pressSequentially(', avec jus');
    await p.locator('#view h1').first().click();
    await expect.poll(marque).toBe(true);
    await p.locator('#save').click();
    await expect.poll(marque, { timeout: 10_000 }).toBe(false);
    await objet.click();
    await objet.press('End');
    await objet.pressSequentially(' frais');
    await p.locator('#view h1').first().click();
    await expect.poll(marque).toBe(true);
    await p.locator('#ed-annuler').click();
    await expect.poll(() => objet.inputValue()).toBe('Petits-déjeuners du séminaire, avec jus');
    await expect.poll(marque).toBe(false);

    // 2. Une facture en brouillon s'enregistre toute seule (sans redessiner la page) : ce qui est enregistré suit. La seconde
    //    modification vide la désignation — la pièce n'est alors plus enregistrable, rien ne se réenregistre derrière le test —
    //    et ↶ la ramène à ce qui vient d'être enregistré : plus rien à enregistrer, tout de suite.
    await p.evaluate(() => { location.hash = '#/doc/f-1'; });
    const objetF = p.locator('[name=subject]');
    await expect.poll(() => objetF.inputValue(), { timeout: 20_000 }).toBe('Viennoiseries');
    await objetF.click();
    await objetF.press('End');
    await objetF.pressSequentially(', livrées le matin');
    await p.locator('#view h1').first().click();
    await expect.poll(marque).toBe(true);
    await expect.poll(marque, { timeout: 15_000 }).toBe(false);
    expect(await enregistre()).toBe(true);
    const designation = p.locator('#lines tr[data-i="0"] input[data-k=label]');
    await designation.fill('');
    await p.locator('#view h1').first().click();
    await expect.poll(marque).toBe(true);
    await p.locator('#ed-annuler').click();
    await expect.poll(() => designation.inputValue()).toBe('Croissants au beurre');
    expect(await objetF.inputValue()).toBe('Viennoiseries, livrées le matin');
    // Dans le même geste que l'annulation, pas après un nouvel enregistrement automatique (qui la ferait tomber 1,5 s plus tard).
    expect(await marque()).toBe(false);
    expect(await enregistre()).toBe(true);

    // 3. La facture d'achat du peintre : le numéro changé, puis ↶ — « ✓ enregistrée », et le vert revient au règlement.
    await p.evaluate(() => { location.hash = '#/achat/a-1/modifier'; });
    const numero = p.locator('#b-head input[name=number]');
    await numero.waitFor({ timeout: 20_000 });
    expect(await marque()).toBe(false);
    const vertsAchat = await verts();
    expect(vertsAchat).toEqual(['Enregistrer un règlement']);
    await numero.fill('PK-2611-08');
    await p.locator('#view h1').first().click();
    await expect.poll(marque).toBe(true);
    expect(await verts()).toEqual(['Enregistrer les modifications']);
    await p.locator('#ac-annuler').click();
    await expect.poll(() => p.locator('#b-head input[name=number]').inputValue()).toBe('PK-2611-07');
    await expect.poll(marque).toBe(false);
    expect(await enregistre()).toBe(true);
    expect(await verts()).toEqual(vertsAchat);
    await p.locator('#view h1').first().click();
    await p.keyboard.press('Control+Shift+z');
    await expect.poll(() => p.locator('#b-head input[name=number]').inputValue()).toBe('PK-2611-08');
    await expect.poll(marque).toBe(true);
    await p.locator('#view h1').first().click();
    await p.keyboard.press('Control+z');
    await expect.poll(() => p.locator('#b-head input[name=number]').inputValue()).toBe('PK-2611-07');
    await expect.poll(marque).toBe(false);
    // Rien à enregistrer : on quitte sans question.
    await p.evaluate(() => { location.hash = '#/achats'; });
    await expect.poll(async () => net(await p.locator('#view h1').first().innerText()), { timeout: 20_000 }).toBe('Achats et dépenses');
    expect(await p.locator('#modal-root .modal').count()).toBe(0);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
