// Le paiement en ligne, à la souris (brique 78 ; docs/paiement-en-ligne.md ; 14 § 2.2), avec un Konnect
// simulé (tests/konnect-simule.ts). Nadia a émis une facture à la Menuiserie du Lac, qui en a payé 200.
// Ce que le parcours vérifie, écran ET serveur :
//   - Paramètres → Documents → « Paiement en ligne » : Nadia branche son compte Konnect (portefeuille et
//     clé) ; la clé ne se relit pas, seules ses dernières lettres s'affichent ;
//   - le client ouvre le lien de son compte, la facture, et « Payer 873,190 DT en ligne » l'emmène chez
//     Konnect, pour ce montant, sur le portefeuille de Nadia ; il paie ;
//   - il revient : « Paiement reçu », puis son espace dit « Rien à payer » ;
//   - chez Nadia, la facture porte le paiement (« Paiement en ligne », sur le compte « Konnect ») et le
//     panneau le dit « Reçu ».

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { konnectSimule } from '../konnect-simule.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le paiement en ligne, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  let konnect: Awaited<ReturnType<typeof konnectSimule>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-paiement-'));
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    konnect = await konnectSimule();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_KONNECT: konnect.base }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await konnect?.fermer(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

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
  // Le texte d'un écran, sans ses espaces insécables ni ses retours à la ligne.
  const net = (t: string) => t.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();

  it('Nadia branche Konnect ; son client paie sa facture en ligne ; le paiement arrive sur la facture', async () => {
    const email = `nadia-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const ent = String((await api('POST', '/entreprises-essai', premier)).corps.id);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    type Objet = { collection: string; cle: string; revision: number; contenu: Record<string, unknown> };
    const objets = async () => (await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
    const menuiserie = (await objets()).find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    if (!menuiserie) throw new Error('client d\'exemple absent');
    const doc = {
      id: 'f1', type: 'facture', number: '', date: '2026-10-01', dueDate: '2026-10-31', clientId: menuiserie.cle, subject: 'Mobilier', status: 'brouillon',
      lines: [{ label: 'Table en chêne massif', description: '', qty: 2, unit: '', unitPrice: { '~n': '450.5' }, vatRate: 19 }],
      discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
    };
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: 'f1', rang: 0, revision: null, contenu: doc }] });
    const emise = await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: doc, client: menuiserie.contenu, revision: 1, rang: 0, netAPayer: '1073.190' });
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: 'f1', rang: 0, revision: Number(emise.corps.revision),
      contenu: { ...(emise.corps.contenu as Record<string, unknown>), payments: [{ id: 'p1', date: '2026-10-05', amount: 200, method: 'virement', reference: 'VIR-77' }] } }] });

    // Nadia : Paramètres → Documents → Paiement en ligne. Un champ vide se refuse, et se montre.
    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const nadia = await cn.newPage();
    const erreurs: string[] = [];
    nadia.on('pageerror', (e) => erreurs.push(e.message));
    await nadia.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await nadia.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await nadia.waitForTimeout(800);
    await plusTard(nadia);
    await nadia.getByRole('tab', { name: 'Documents', exact: true }).click();
    const panneau = nadia.locator('#p-paiement');
    await expect.poll(async () => net(await panneau.locator('#pl-etat').innerText()), { timeout: 15_000 }).toBe('Pas branché : tes clients ne voient pas « Payer en ligne ».');
    await panneau.getByLabel('Identifiant de ton portefeuille Konnect').fill('portefeuille-nadia-7');
    await panneau.getByRole('button', { name: 'Brancher', exact: true }).click();
    await expect.poll(async () => net(await panneau.getByRole('alert').innerText())).toBe('Colle la clé de l\'API Konnect.');
    expect(await nadia.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.champ)).toBe('cle');
    // Le navigateur n'y pose pas le mot de passe SkanFact enregistré (« off » ne l'en empêche pas).
    expect(await panneau.getByLabel('Clé de l\'API Konnect').getAttribute('autocomplete')).toBe('new-password');
    await panneau.getByLabel('Clé de l\'API Konnect').fill('sk_test_nadia-cle-secrete-b3f2');
    // La clé n'est pas un réglage de la fiche : taper ne propose pas d'enregistrer les Paramètres.
    expect(await nadia.locator('#save-bar').isHidden()).toBe(true);
    // Et si Nadia enregistre ses Paramètres (le slogan changé) pendant que la clé est tapée, pas encore
    // branchée, la fiche de l'entreprise (que l'équipe et le cabinet lisent) ne l'emporte pas.
    await nadia.getByRole('tab', { name: 'Mon entreprise', exact: true }).click();
    await nadia.locator('#pf [name=tagline]').fill('Mobilier sur mesure');
    await nadia.locator('#save-bar').getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(async () => JSON.stringify((await objets()).find((o) => o.collection === '_racine' && o.cle === 'company')?.contenu), { timeout: 15_000 }).toContain('Mobilier sur mesure');
    expect(JSON.stringify(await objets())).not.toContain('nadia-cle-secrete');
    await nadia.getByRole('tab', { name: 'Documents', exact: true }).click();
    await panneau.getByLabel('Identifiant de ton portefeuille Konnect').fill('portefeuille-nadia-7');
    await panneau.getByLabel('Clé de l\'API Konnect').fill('sk_test_nadia-cle-secrete-b3f2');
    await panneau.getByRole('button', { name: 'Brancher', exact: true }).click();
    await expect.poll(async () => net(await panneau.locator('#pl-etat').innerText()), { timeout: 15_000 })
      .toMatch(/^Branché le \d\d\/\d\d\/\d{4} à \d+ h \d\d par Nadia : portefeuille portefeuille-nadia-7, clé qui finit par « b3f2 »\.$/);
    expect(await panneau.innerText()).not.toContain('nadia-cle-secrete');
    expect(JSON.stringify(await objets())).not.toContain('nadia-cle-secrete');
    await nadia.screenshot({ path: path.join(PHOTOS, 'paiement-1-reglage.png') });

    // Le client : le lien de son compte, la facture, « Payer 873,190 DT en ligne ».
    const lien = `${serveur.adresse}/espace/#${String((await api('POST', `/entreprises/${ent}/espace/liens`, jeton, { client: menuiserie.cle })).corps.jeton)}`;
    const cc = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR' });
    const client = await cc.newPage();
    const erreursClient: string[] = [];
    client.on('pageerror', (e) => erreursClient.push(e.message));
    await client.goto(lien);
    await expect.poll(async () => net(await client.locator('.carte.du').innerText()), { timeout: 15_000 }).toBe('Tu dois 873,190 DT Pour payer en ligne, ouvre la facture (« Voir »).');
    await client.getByRole('button', { name: 'Voir', exact: true }).click();
    const payer = client.getByRole('button', { name: /^Payer 873,190\sDT en ligne$/ });
    await payer.waitFor({ timeout: 10_000 });
    expect(await client.locator('button.principal').allInnerTexts()).toEqual([await payer.innerText()]);
    await client.screenshot({ path: path.join(PHOTOS, 'paiement-2-facture.png') });
    await payer.click();

    // Chez Konnect : ce montant, sur le portefeuille de Nadia ; il paie.
    await client.waitForURL(/\/payer\/[0-9a-f]+$/, { timeout: 15_000 });
    expect(await client.locator('#montant').innerText()).toBe('873190 millimes pour le portefeuille portefeuille-nadia-7');
    await client.screenshot({ path: path.join(PHOTOS, 'paiement-3-konnect.png') });
    await client.getByRole('button', { name: 'Payer (simulation)', exact: true }).click();

    // De retour : « Paiement reçu », puis son espace ne doit plus rien.
    await client.waitForURL(/\/espace\/retour\.html/, { timeout: 15_000 });
    await expect.poll(async () => net(await client.locator('#retour').innerText()), { timeout: 15_000 })
      .toBe('Paiement reçu 873,190 DT pour la facture FAC-2026-001. Merci ! Revenir à ton espace');
    await client.screenshot({ path: path.join(PHOTOS, 'paiement-4-recu.png') });
    await client.getByRole('link', { name: 'Revenir à ton espace', exact: true }).click();
    await expect.poll(async () => net(await client.locator('.carte.du').innerText()), { timeout: 15_000 }).toBe('Rien à payer Merci !');
    expect(net(await client.locator('table.pieces tbody').innerText())).toBe('Facture FAC-2026-001 Payée Payé : 1 073,190 DT 01/10/2026 31/10/2026 1 073,190 DT 0,000 DT Voir');
    await client.screenshot({ path: path.join(PHOTOS, 'paiement-5-releve.png') });

    // Chez Nadia : le paiement est sur la facture, au compte « Konnect », et le panneau le dit reçu.
    const f1 = (await objets()).find((o) => o.collection === 'documents' && o.cle === 'f1');
    const konnectCompte = (await objets()).find((o) => o.collection === 'accounts')?.cle;
    expect((f1?.contenu.payments as Record<string, unknown>[])[1]).toMatchObject({ method: 'en_ligne', amount: { '~n': '873.19' }, accountId: konnectCompte });
    const nadia2 = await cn.newPage();
    nadia2.on('pageerror', (e) => erreurs.push(e.message));
    await nadia2.goto(`${serveur.adresse}/v10/?e=${ent}#/doc/f1`);
    await nadia2.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await nadia2.waitForTimeout(600);
    await plusTard(nadia2);
    await expect.poll(async () => net(await nadia2.locator('#view').innerText()), { timeout: 15_000 }).toMatch(/Paiement en ligne/);
    await nadia2.screenshot({ path: path.join(PHOTOS, 'paiement-6-facture-nadia.png') });
    await nadia2.goto(`${serveur.adresse}/v10/?e=${ent}#/parametres`);
    await nadia2.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await nadia2.getByRole('tab', { name: 'Documents', exact: true }).click();
    await expect.poll(async () => net(await nadia2.locator('#pl-demandes').innerText()), { timeout: 15_000 })
      .toMatch(/^\d\d\/\d\d\/\d{4} à \d+ h \d\d FAC-2026-001 873,190 DT Reçu le \d\d\/\d\d\/\d{4} à \d+ h \d\d$/);
    await nadia2.locator('#p-paiement').scrollIntoViewIfNeeded();
    await nadia2.screenshot({ path: path.join(PHOTOS, 'paiement-7-panneau.png') });
    // Arrêter se demande d'abord ; arrêté, le client ne voit plus « Payer en ligne ».
    const p2 = nadia2.locator('#p-paiement');
    await p2.getByRole('button', { name: 'Arrêter le paiement en ligne…', exact: true }).click();
    await expect.poll(async () => net(await p2.getByRole('alert').innerText()))
      .toBe('Tes clients ne verront plus « Payer en ligne ». Les paiements déjà reçus restent sur leurs factures.');
    expect((await api('GET', `/entreprises/${ent}/paiement-en-ligne`, jeton)).corps.branche).not.toBe(null);
    await p2.getByRole('button', { name: 'Oui, arrêter le paiement en ligne', exact: true }).click();
    await expect.poll(async () => net(await p2.locator('#pl-etat').innerText()), { timeout: 15_000 }).toBe('Pas branché : tes clients ne voient pas « Payer en ligne ».');
    expect((await api('GET', `/entreprises/${ent}/paiement-en-ligne`, jeton)).corps.branche).toBe(null);
    expect(erreurs).toEqual([]);
    expect(erreursClient).toEqual([]);
  }, 180_000);
});
