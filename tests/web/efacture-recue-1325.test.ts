// 1.325.0 — La facture électronique reçue, jouée par Hédi Ben Salah (Quincaillerie Ben Salah, Sfax) : son grossiste lui
// envoie le fichier El Fatoora de sa facture (deux taux de TVA, une remise sur une ligne, le timbre), puis l'avoir d'une
// perceuse rendue ; le même fichier glissé deux fois ; une facture en euros d'un fournisseur étranger. Puis sa comptable,
// au Cabinet : l'achat et son fichier arrivent par le pont, et un fichier El Fatoora envoyé par la messagerie se lit sans
// l'IA, au millime, face à sa fiche de saisie.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { problemes } from '../instrument-rendu.ts';
import { compact, teifDe } from '../teif-recu.ts';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const net = (t: string) => t.replace(/\s+/g, ' ').trim();
describe('la facture électronique reçue 1.325.0 : le fichier El Fatoora du fournisseur, jusqu\'au comptable', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-efr-1325-'));
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
    fs.writeFileSync(path.join(PHOTOS, 'efacture-recue-1325.txt'), '');
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
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) } : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);
  const jourDe = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' });

  const sansVisite = () => { if (location.protocol.startsWith('http')) localStorage.setItem('skanfact.visites', JSON.stringify({ proposer: false })); };
  // Un matricule tiré au sort (l'unicité des matricules actifs vaut pour toute la base de test).
  const matricule = () => `${1000000 + Math.floor(Math.random() * 8999999)}${'ABCDEFGHJKLMNPQRSTVWXYZ'[Math.floor(Math.random() * 23)]}/A/M/000`;
  const cellules = (p: Page, sel: string) => p.locator(sel).evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim())));
  const deposer = (p: Page, xml: string, nom: string) => p.evaluate(([x, n]) => {
    const dt = new DataTransfer(); dt.items.add(new File([x ?? ''], n ?? 'f.xml', { type: 'text/xml' }));
    document.querySelector('#ac-zone')?.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [xml, nom]);
  const ligneLue = (p: Page, nom: string) => p.locator('#ac-lecture .ac-lec-l').filter({ has: p.locator('.n', { hasText: nom }) });
  const noter = (t: string) => fs.appendFileSync(path.join(PHOTOS, 'efacture-recue-1325.txt'), `${t}\n`);

  const nouvelAchatDe = (p: Page, url: string) => async () => { await p.goto('about:blank'); await p.goto(url); await p.locator('#ac-zone').waitFor({ timeout: 30_000 }); };
  it('Hédi reçoit les fichiers El Fatoora de ses fournisseurs : deux taux et une remise, l\'avoir, le même fichier deux fois, une facture en euros', async () => {
    const hedi = await personne('hedi');
    const MQ = matricule(), MW = matricule(), MB = matricule();
    const r = await api('POST', '/entreprises', hedi, { raisonSociale: 'Quincaillerie Ben Salah', matriculeFiscal: MQ });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const q = String(r.corps.id);
    const objets = async () => (await api('GET', `/entreprises/${q}/dossier-v10`, hedi)).corps.objets as Obj[];
    const auj = jourDe(0);
    // Le 1er du mois (aujourd'hui, si c'est le 1er) : une date du mois, jamais dans l'avenir.
    const dateFa = `${auj.slice(0, 8)}01`;
    const fiche = (await objets()).find((x) => x.collection === '_racine' && x.cle === 'company');
    const ok = await api('POST', `/entreprises/${q}/dossier-v10`, hedi, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche ? fiche.revision : null,
        contenu: { ...(fiche ? fiche.contenu : {}), setupDone: true, managerName: 'Hédi Ben Salah', name: 'Quincaillerie Ben Salah', city: 'Sfax', matricule: MQ } },
      // Le grossiste est déjà dans ses fournisseurs, noté sans les barres de son matricule.
      { collection: 'suppliers', cle: 'wafa', rang: 0, revision: null, contenu: { id: 'wafa', name: 'Grossiste El Wafa', matricule: compact(MW), city: 'Sfax' } },
      // Une autre facture du grossiste, saisie à la main d'après le papier, sans fichier : le fichier signé arrive après.
      { collection: 'purchases', cle: 'papier', rang: 0, revision: null, contenu: enc({ id: 'papier', kind: 'facture', number: 'FA-2026-1203', date: dateFa, dueDate: jourDe(30),
        supplierId: 'wafa', category: 'Achats de marchandises', currency: 'DT', exchangeRate: '', fees: 1, withholdingRate: 0, attachments: [], payments: [], notes: 'Saisie d\'après la facture papier',
        lines: [{ label: 'Perceuse à percussion 850 W', qty: 3, unit: '', unitPrice: 76.5, vatRate: 19, destination: 'charge', deductible: true }] }) },
    ] });
    expect(ok.statut, JSON.stringify(ok.corps)).toBe(200);
    const nous = { mf: MQ, nom: 'Quincaillerie Ben Salah' };
    const wafa = { mf: MW, nom: 'GROSSISTE EL WAFA SARL' };
    const fa = teifDe({ numero: 'FA-2026-1187', date: dateFa, echeance: jourDe(30), fournisseur: wafa, acheteur: nous, timbre: 1, lignes: [
      { code: 'PER-850', nom: 'Perceuse à percussion 850 W', qte: 10, pu: 85, taux: 19, remise: 10 },
      { code: 'RAL-10', nom: 'Rallonge 10 m', qte: 4, pu: 12.5, taux: 19 },
      { code: 'LIV-BR', nom: 'Guide du bricolage (livre)', qte: 2, pu: 15, taux: 7 },
    ] });
    noter(`Hédi ${q} ; FA ${fa.ht} HT ${fa.ttc} TTC ${JSON.stringify(fa.bases)}`);
    expect([fa.ht, fa.ttc]).toEqual([845, 1002.95]);

    const erreurs: string[] = [];
    const cx = await contexte(hedi);
    await cx.addInitScript(sansVisite);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    const nouvelAchat = nouvelAchatDe(p, `${serveur.adresse}/v10/?e=${q}#/achat/new`);
    await nouvelAchat();
    await plusTard(p);
    // A. La facture du grossiste : deux taux, une remise, le timbre.
    await deposer(p, fa.xml, 'TEIF_FA-2026-1187.xml');
    const page = p.locator('#ac-lecture');
    await page.getByText('Ce que dit le fichier El Fatoora').waitFor({ timeout: 15_000 });
    noter(`A page : ${net(await page.innerText())}`);
    await p.waitForTimeout(600);
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-a-lecture.png'), fullPage: true });
    // La catégorie vient de sa dernière facture (la facture papier) ; rien d'autre à trancher.
    expect(await p.locator('#view .ed-pill').innerText()).toBe('Vérifiée');
    await page.getByRole('button', { name: /^Remplir la pièce/ }).click();
    await expect.poll(() => p.locator('#ac-lecture').count(), { timeout: 10_000 }).toBe(0);
    await p.waitForTimeout(600);
    noter(`A pièce : ${net(await p.locator('#view').innerText())}`);
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-a-remplie.png'), fullPage: true });
    await p.locator('#save').click();
    await expect.poll(async () => (await objets()).filter((x) => x.collection === 'purchases').length, { timeout: 15_000 }).toBe(2);
    const achatFa = (await objets()).find((x) => x.collection === 'purchases' && x.contenu.number === 'FA-2026-1187')?.contenu as Obj;
    noter(`A achat : ${JSON.stringify(achatFa).slice(0, 1500)}`);
    await p.waitForTimeout(800);
    noter(`A enregistré : ${net(await p.locator('#view').innerText())}`);
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-a-enregistree.png'), fullPage: true });

    // B. Le même fichier, glissé une seconde fois (le grossiste l'a renvoyé par courriel).
    await nouvelAchat();
    await deposer(p, fa.xml, 'TEIF_FA-2026-1187 (1).xml');
    await page.getByText('Ce que dit le fichier El Fatoora').waitFor({ timeout: 15_000 });
    await p.waitForTimeout(600);
    noter(`B page : ${net(await p.locator('#view').innerText())}`);
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-b-doublon.png'), fullPage: true });
    noter(`B bouton : ${await page.locator('.ac-lec-geste').innerText().catch(() => '')}`);
    await page.locator('#tf-ouvrir').click();
    await expect.poll(() => p.evaluate(() => location.hash)).toBe(`#/achat/${String(achatFa.id)}`);

    // B2. La facture papier saisie à la main ; son fichier signé arrive ensuite.
    const fb = teifDe({ numero: 'FA-2026-1203', date: dateFa, echeance: jourDe(30), fournisseur: wafa, acheteur: nous, timbre: 1, lignes: [
      { code: 'PER-850', nom: 'Perceuse à percussion 850 W', qte: 3, pu: 85, taux: 19, remise: 10 },
    ] });
    noter(`B2 ${fb.ht} HT ${fb.ttc} TTC`);
    await nouvelAchat();
    await deposer(p, fb.xml, 'TEIF_FA-2026-1203.xml');
    await page.getByText('Ce que dit le fichier El Fatoora').waitFor({ timeout: 15_000 });
    await p.waitForTimeout(600);
    noter(`B2 page : ${net(await p.locator('#view').innerText())}`);
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-b2-papier.png'), fullPage: true });
    await page.locator('#tf-joindre').click();
    await expect.poll(() => p.evaluate(() => location.hash), { timeout: 15_000 }).toBe('#/achat/papier');
    await expect.poll(async () => ((await objets()).find((x) => x.collection === 'purchases' && x.cle === 'papier')?.contenu.attachments as Obj[] | undefined)?.map((a) => a.name), { timeout: 15_000 })
      .toEqual(['TEIF_FA-2026-1203.xml']);
    await p.waitForTimeout(800);
    noter(`B2 achat : ${net(await p.locator('#view').innerText())}`);
    // Sa référence TTN rejoint ses notes, sous ce qu'elles disaient déjà.
    await expect.poll(async () => String((await objets()).find((x) => x.collection === 'purchases' && x.cle === 'papier')?.contenu.notes), { timeout: 15_000 })
      .toBe('Saisie d\'après la facture papier\nRéférence TTN : TTN-2026-FA-2026-1203');
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-b2-jointe.png'), fullPage: true });

    // C. L'avoir : une perceuse rendue.
    const av = teifDe({ numero: 'AV-2026-0042', avoir: 'FA-2026-1187', date: auj, fournisseur: wafa, acheteur: nous, lignes: [
      { code: 'PER-850', nom: 'Perceuse à percussion 850 W (retour)', qte: 1, pu: 85, taux: 19, remise: 10 },
    ] });
    noter(`C avoir ${av.ht} HT ${av.ttc} TTC`);
    await nouvelAchat();
    await deposer(p, av.xml, 'TEIF_AV-2026-0042.xml');
    await page.getByText('Ce que dit le fichier El Fatoora').waitFor({ timeout: 15_000 });
    await p.waitForTimeout(600);
    noter(`C page : ${net(await p.locator('#view').innerText())}`);
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-c-avoir.png'), fullPage: true });
    if (await page.getByRole('button', { name: /^Remplir la pièce/ }).count()) {
      if (await ligneLue(p, 'Catégorie').locator('.combo-btn').count()) {
        await ligneLue(p, 'Catégorie').locator('.combo-btn').click();
        await ligneLue(p, 'Catégorie').locator('.combo-pop').getByText('Achats de marchandises', { exact: true }).click().catch(() => undefined);
      }
      await page.getByRole('button', { name: /^Remplir la pièce/ }).click();
      await expect.poll(() => p.locator('#ac-lecture').count(), { timeout: 10_000 }).toBe(0);
      await p.waitForTimeout(600);
      noter(`C pièce : ${net(await p.locator('#view').innerText())}`);
      await p.locator('#save').click();
      await expect.poll(async () => (await objets()).filter((x) => x.collection === 'purchases').length, { timeout: 15_000 }).toBe(3);
      await p.waitForTimeout(800);
      noter(`C enregistré : ${net(await p.locator('#view').innerText())}`);
      // Un avoir ne se règle pas, il s'impute : son en-tête dit le mot de la liste.
      expect(await p.locator('#view .ed-pill').innerText()).toBe('Imputé');
      await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-c-avoir-enregistre.png'), fullPage: true });
    }
    // La facture du grossiste, après l'avoir.
    await p.goto(`${serveur.adresse}/v10/?e=${q}#/achat/${String(achatFa.id)}`);
    await p.waitForTimeout(1500);
    noter(`C facture après avoir : ${net(await p.locator('#view').innerText())}`);
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-c-facture-apres.png'), fullPage: true });

    // D. Une facture en euros d'un fournisseur étranger (pas encore dans ses fournisseurs).
    const bosch = teifDe({ numero: 'INV-77310', date: auj, devise: 'EUR', fournisseur: { mf: MB, nom: 'Outillage Europe GmbH', ville: 'Stuttgart' }, acheteur: nous, lignes: [
      { code: 'MEU-125', nom: 'Meuleuse 125 mm', qte: 6, pu: 41.5, taux: 0 },
    ] });
    await nouvelAchat();
    await deposer(p, bosch.xml, 'INV-77310.xml');
    await page.getByText('Ce que dit le fichier El Fatoora').waitFor({ timeout: 15_000 });
    await p.waitForTimeout(600);
    noter(`D page : ${net(await p.locator('#view').innerText())}`);
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-d-euros.png'), fullPage: true });
    // La liste des achats.
    await p.goto(`${serveur.adresse}/v10/?e=${q}#/achats`);
    await p.waitForTimeout(1500);
    noter(`Liste : ${net(await p.locator('#view').innerText())}`);
    // La facture que l'avoir diminue, sans rien de payé : elle reste à payer (un avoir n'est pas un paiement).
    const ligneFa = net(await p.locator('#view table tbody tr').filter({ hasText: 'FA-2026-1187' }).last().innerText());
    noter(`Ligne FA : ${ligneFa}`);
    expect(ligneFa).toContain('À payer');
    expect(ligneFa).not.toContain('Partiel');
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-e-liste.png'), fullPage: true });
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);

  // Leïla Trabelsi (Cabinet Trabelsi) tient le Café des Arts de Rim Gharbi, qui ne saisit pas ses achats : Rim lui
  // envoie par la messagerie les fichiers El Fatoora que son grossiste lui a transmis par courriel.
  it('Leïla, au Cabinet : les fichiers El Fatoora envoyés par la messagerie se lisent sans l\'IA, au millime, et s\'écrivent avec chaque taux du fichier', async () => {
    const leila = await personne('leila'), rim = await personne('rim');
    const cab = (await api('POST', '/cabinets', leila, { nom: 'Cabinet Trabelsi' })).corps as { id: string; code: string };
    const MC = matricule(), MW = matricule(), MA = matricule();
    const r = await api('POST', '/entreprises', rim, { raisonSociale: 'Café des Arts', matriculeFiscal: MC });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const ent = String(r.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, rim, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    const auj = jourDe(0), mois = auj.slice(0, 7), annee = auj.slice(0, 4), dateFa = `${mois}-01`;
    // Le dossier commence ce mois-ci : les pièces de ce mois s'y rangent (le mois d'avant n'est pas à elle).
    expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, leila, { contenu: { contact: 'Rim', from: mois }, revision: null })).statut).toBeLessThan(300);
    await api('GET', `/entreprises/${ent}/dossier-v10`, rim);
    const nous = { mf: MC, nom: 'Café des Arts' };
    const wafa = { mf: MW, nom: 'GROSSISTE EL WAFA SARL' };
    const fa = teifDe({ numero: 'FA-2026-1187', date: dateFa, echeance: jourDe(30), fournisseur: wafa, acheteur: nous, timbre: 1, lignes: [
      { code: 'PER-850', nom: 'Perceuse à percussion 850 W', qte: 10, pu: 85, taux: 19, remise: 10 },
      { code: 'RAL-10', nom: 'Rallonge 10 m', qte: 4, pu: 12.5, taux: 19 },
      { code: 'LIV-BR', nom: 'Guide du bricolage (livre)', qte: 2, pu: 15, taux: 7 },
    ] });
    const av = teifDe({ numero: 'AV-2026-0042', avoir: 'FA-2026-1187', date: auj, fournisseur: wafa, acheteur: nous, lignes: [
      { code: 'PER-850', nom: 'Perceuse à percussion 850 W (retour)', qte: 1, pu: 85, taux: 19, remise: 10 },
    ] });
    // Le grossiste s'est trompé de client : la facture d'une clinique, sans signature.
    const autre = teifDe({ numero: 'FA-2026-1290', date: dateFa, fournisseur: wafa, acheteur: { mf: MA, nom: 'Clinique El Amen' }, signe: false, lignes: [
      { code: 'GAN-100', nom: 'Gants nitrile (boîte de 100)', qte: 20, pu: 9.8, taux: 19 },
    ] });
    const vide = `<?xml version="1.0" encoding="UTF-8"?><TEIF version="1.8.8"><InvoiceHeader><MessageSenderIdentifier type="I-01">${compact(MW)}</MessageSenderIdentifier></InvoiceHeader></TEIF>`;
    expect([fa.ttc, av.ttc]).toEqual([1002.95, 91.035]);
    const envoyer = async (nom: string, xml: string) => {
      const f = await api('POST', `/entreprises/${ent}/messages/fichiers`, rim, { cote: 'entreprise', nom, contenu: Buffer.from(xml, 'utf8').toString('base64') });
      expect(f.statut, JSON.stringify(f.corps)).toBeLessThan(300);
      const m = await api('POST', `/entreprises/${ent}/messages`, rim, { cote: 'entreprise', texte: '', fichier: f.corps.id });
      expect(m.statut, JSON.stringify(m.corps)).toBeLessThan(300);
      return String(m.corps.id);
    };
    const ids: Record<string, string> = {};
    for (const [nom, xml] of [['TEIF_FA-2026-1187', fa.xml], ['TEIF_AV-2026-0042', av.xml], ['TEIF_FA-2026-1290', autre.xml], ['TEIF_vide', vide]] as const) ids[nom] = await envoyer(`${nom}.xml`, xml);

    const erreurs: string[] = [];
    const cx = await contexte(leila);
    await cx.addInitScript(sansVisite);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    // La messagerie dit ce qu'est le fichier : une facture électronique, pas une photo.
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/messages/${ent}`);
    await p.getByText('TEIF_FA-2026-1187.xml').first().waitFor({ timeout: 25_000 });
    await plusTard(p);
    noter(`Cabinet messagerie : ${net(await p.locator('#view').innerText())}`);
    expect(net(await p.locator('.msg-fichier, .msg-vig').filter({ hasText: 'TEIF_FA-2026-1187.xml' }).first().innerText())).toMatch(/^(XML TEIF_FA-2026-1187\.xml|.*Facture électronique \(XML\))/);
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-e2-cabinet-messages.png'), fullPage: true });
    // Leïla commence le livre de l'année du client (sans balance d'ouverture : il démarre), comme « Commencer le livre ».
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, leila, { annee: Number(annee), ouverture: [] })).statut).toBeLessThan(300);

    // La Saisie, face à la pièce : le fichier se lit tout seul, sur le serveur, sans l'IA.
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossier/${ent}/comptabilite/saisie/${annee}`);
    await p.locator(`[data-cp-mois="${mois}"]`).waitFor({ timeout: 25_000 }).catch(async (x) => {
      noter(`Saisie introuvable : ${net(await p.locator('body').innerText())}`); await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-x-saisie.png'), fullPage: true }); throw x;
    });
    await plusTard(p);
    await p.locator(`[data-cp-mois="${mois}"]`).click();
    await p.locator('#sx-rang').waitFor({ timeout: 20_000 });
    expect(await p.locator('#sx-rang').innerText()).toBe('Pièce 1 sur 4');
    // Une pièce de la bande, par son message (lue, elle prend le nom du fournisseur).
    const puce = (t: string) => p.locator(`[data-sx-k="p:${ids[t]}"]`);
    const fiche = p.locator('#sx-fiche'), feuille = p.locator('#sx-papier .ef-f');
    await puce('TEIF_FA-2026-1187').click();
    await expect.poll(() => feuille.getAttribute('data-ef'), { timeout: 15_000 }).toBe('lu');
    await expect.poll(() => fiche.innerText().then(net), { timeout: 10_000 }).toContain('lue dans le fichier El Fatoora');
    await p.waitForTimeout(500);
    noter(`Saisie FA : ${net(await p.locator('#sx-zone').innerText())}`);
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-f-cabinet-fa.png'), fullPage: true });
    // La feuille : chaque montant du fichier, au millime.
    const f1 = net(await feuille.innerText());
    for (const t of ['GROSSISTE EL WAFA SARL', 'Facture FA-2026-1187', 'remise 10 % sur 85,000', 'TVA 19 % sur 815,000', '154,850', 'TVA 7 % sur 30,000', '2,100', 'Timbre fiscal', 'rien n\'est passé par l\'IA', 'réf. TTN TTN-2026-FA-2026-1187']) expect(f1).toContain(t);
    expect(f1.replace(/[\s\u202f\u00a0]/g, '')).toContain('TotalTTC1002,950DT');
    // La fiche : le total, le timbre et les taux du fichier.
    const sans = (v: string) => v.replace(/[\s\u202f\u00a0]/g, '');
    expect(sans(await p.locator('#sx-ttc').inputValue())).toBe('1002,950');
    expect(await p.locator('#sx-timbre').inputValue()).toBe('1,000');
    expect(await p.locator('#sx-tva').inputValue()).toBe('fichier');
    expect(net(await p.locator('#sx-tva option[value="fichier"]').innerText())).toBe('Celles du fichier : 19 % et 7 %');
    expect(net(await p.locator('#sx-ef-ck').innerText())).toContain('Fichier signé · réf. TTN TTN-2026-FA-2026-1187');
    // Le total changé n'est plus celui du fichier : la fiche le dit, et n'écrit rien.
    await p.locator('#sx-ttc').fill('1000,000');
    await expect.poll(() => p.locator('#sx-refus').innerText().then(net)).toBe('Le total n\'est plus celui du fichier (1 002,950) : remets-le, ou choisis un taux.');
    await p.locator('#sx-ttc').fill('1002,950');
    await p.locator('#sx-compte').fill('6071');
    await p.keyboard.press('Escape');
    await expect.poll(() => cellules(p, '#sx-ec-l tr').then((l) => l.map((c) => [c[0], sans(c[2] ?? ''), sans(c[3] ?? '')]))).toEqual([
      ['6071', '846,000', ''], ['4366', '154,850', ''], ['4366', '2,100', ''], ['401', '', '1002,950'],
    ]);
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-g-cabinet-fiche.png'), fullPage: true });
    await p.locator('#sx-ok-valider').click();
    const ecritures = async () => ((await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, leila)).corps.ecritures ?? []) as Obj[];
    const millimes = (v: unknown) => Math.round(Number(String(v ?? 0)) * 1000);
    const lignesDe = (e: Obj) => (e.lignes as Obj[]).map((l) => [String(l.compte), millimes(l.debit), millimes(l.credit)]);
    // « Enregistrer et valider » écrit au brouillard, joint la pièce, puis valide : on attend la validation, pas l'écriture seule.
    await expect.poll(async () => (await ecritures()).filter((e) => /FA-2026-1187/.test(String(e.libelle))).map((e) => String(e.statut)), { timeout: 20_000 }).toEqual(['validee']);
    const eFa = (await ecritures()).find((e) => /FA-2026-1187/.test(String(e.libelle))) as Obj;
    noter(`Écriture FA : ${JSON.stringify(eFa).slice(0, 1200)}`);
    expect(lignesDe(eFa)).toEqual([['6071', 846000, 0], ['4366', 154850, 0], ['4366', 2100, 0], ['401', 0, 1002950]]);
    // Deux chemins, un chiffre : la TVA écrite est celle que le fichier dit, taux par taux.
    expect(lignesDe(eFa).filter((l) => l[0] === '4366').reduce((t, l) => t + Number(l[1]), 0)).toBe(Math.round(fa.bases.reduce((t, b) => t + b.tva, 0) * 1000));
    expect(String(eFa.statut)).toBe('validee');

    // L'avoir : à l'envers, la charge de sa dernière facture reprise.
    await expect.poll(() => p.locator('#sx-rang').innerText().catch(() => ''), { timeout: 20_000 }).toBe('Pièce 1 sur 3');
    await puce('TEIF_AV-2026-0042').click().catch(() => undefined);
    await expect.poll(() => feuille.getAttribute('data-ef'), { timeout: 15_000 }).toBe('lu');
    await expect.poll(() => fiche.innerText().then(net), { timeout: 10_000 }).toContain('avoir AV-2026-0042');
    await p.waitForTimeout(500);
    noter(`Saisie AV : ${net(await p.locator('#sx-zone').innerText())}`);
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-h-cabinet-avoir.png'), fullPage: true });
    expect(net(await p.locator('#sx-ef-ck').innerText())).toContain('Un avoir : l\'écriture est à l\'envers');
    expect(await p.locator('#sx-compte').inputValue()).toBe('6071');
    // Une facture à deux taux n'en a pas UN : aucun « 18,6 % » ne se propose (le rapport de ses totaux n'est aucun taux).
    expect(await p.locator('#sx-tva option').allInnerTexts()).toEqual(['Celles du fichier : 19 %', 'À choisir', 'Sans TVA récupérable', 'Autre taux…']);
    expect(net(await p.locator('#sx-suivent').innerText())).toBe('Le compte reprend sa dernière facture (la TVA, elle, vient du fichier) : changé ici, les prochaines factures de GROSSISTE EL WAFA SARL le reprendront.');
    await expect.poll(() => cellules(p, '#sx-ec-l tr').then((l) => l.map((c) => [c[0], sans(c[2] ?? ''), sans(c[3] ?? '')]))).toEqual([
      ['6071', '', '76,500'], ['4366', '', '14,535'], ['401', '91,035', ''],
    ]);
    await p.locator('#sx-ok-valider').click();
    await expect.poll(async () => (await ecritures()).filter((e) => /AV-2026-0042/.test(String(e.libelle))).map((e) => String(e.statut)), { timeout: 20_000 }).toEqual(['validee']);
    const eAv = (await ecritures()).find((e) => /AV-2026-0042/.test(String(e.libelle))) as Obj;
    expect(lignesDe(eAv)).toEqual([['6071', 0, 76500], ['4366', 0, 14535], ['401', 91035, 0]]);

    // La facture d'une autre société : la fiche le dit avant tout geste.
    await expect.poll(() => p.locator('#sx-rang').innerText().catch(() => ''), { timeout: 20_000 }).toBe('Pièce 1 sur 2');
    await puce('TEIF_FA-2026-1290').click().catch(() => undefined);
    await expect.poll(() => p.locator('#sx-ef-ck li.ko > span').innerText().then(net).catch(() => ''), { timeout: 15_000 }).toBe(`Adressée à Clinique El Amen (${MA}), pas à Café des Arts le fichier nomme un autre acheteur : à demander avant de la saisir`);
    expect(net(await p.locator('#sx-ef-ck').innerText())).toContain('Le fichier n\'est pas signé');
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-i-cabinet-ailleurs.png'), fullPage: true });
    // Le fichier incomplet : la feuille dit pourquoi il ne se lit pas ; la pièce se saisit encore à l'œil.
    await puce('TEIF_vide').click();
    await expect.poll(() => feuille.getAttribute('data-ef'), { timeout: 15_000 }).toBe('refus');
    expect(net(await feuille.innerText())).toContain('« TEIF_vide.xml » ne se lit pas : Cette facture électronique n\'a pas de corps (InvoiceBody) : le fichier est incomplet.');
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-j-cabinet-incomplet.png'), fullPage: true });
    // Aucune lecture n'est partie chez l'IA : chacune vient du fichier.
    const lus = (await api('GET', `/cabinets/${cab.id}/classeur/${ent}/lectures`, leila)).corps.lectures as Obj[];
    expect(lus.map((l) => l.source).sort()).toEqual(['teif', 'teif', 'teif']);
    expect(await p.evaluate(problemes, [false, 1440] as [boolean, number])).toEqual([]);

    // Au téléphone : la feuille tient dans l'écran.
    const tel = await cx.newPage();
    await tel.setViewportSize({ width: 390, height: 844 });
    await tel.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossier/${ent}/comptabilite/saisie/${annee}`);
    await tel.locator(`[data-cp-mois="${mois}"]`).waitFor({ timeout: 25_000 });
    await plusTard(tel);
    await tel.locator(`[data-cp-mois="${mois}"]`).click();
    await tel.locator('#sx-rang').waitFor({ timeout: 20_000 });
    await tel.locator(`[data-sx-k="p:${ids['TEIF_FA-2026-1290']}"]`).click().catch(() => undefined);
    await tel.waitForTimeout(800);
    await tel.screenshot({ path: path.join(PHOTOS, 'efr-1325-k-cabinet-tel.png'), fullPage: true });
    expect(await tel.evaluate(problemes, [true, 390] as [boolean, number])).toEqual([]);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 240_000);

  it('(1.325.1) Leïla ouvre, depuis son écriture, le fichier El Fatoora que Rim a joint à son achat : la facture en feuille, le XML à un clic', async () => {
    const leila = await personne('leila'), rim = await personne('rim');
    const cab = (await api('POST', '/cabinets', leila, { nom: 'Cabinet Trabelsi' })).corps as { id: string; code: string };
    const MC = matricule(), MW = matricule();
    const r = await api('POST', '/entreprises', rim, { raisonSociale: 'Café des Arts', matriculeFiscal: MC });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const ent = String(r.corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, rim, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, leila)).statut).toBe(200);
    const auj = jourDe(0), annee = auj.slice(0, 4), dateFa = `${auj.slice(0, 8)}01`;
    // Le dossier commence ce mois-ci : le classeur s'ouvre sur lui.
    expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, leila, { contenu: { contact: 'Rim', from: auj.slice(0, 7) }, revision: null })).statut).toBeLessThan(300);
    await api('GET', `/entreprises/${ent}/dossier-v10`, rim);
    const fa = teifDe({ numero: 'FA-2026-1187', date: dateFa, echeance: jourDe(30), fournisseur: { mf: MW, nom: 'GROSSISTE EL WAFA SARL' }, acheteur: { mf: MC, nom: 'Café des Arts' }, timbre: 1, lignes: [
      { code: 'PER-850', nom: 'Perceuse à percussion 850 W', qte: 10, pu: 85, taux: 19, remise: 10 },
      { code: 'RAL-10', nom: 'Rallonge 10 m', qte: 4, pu: 12.5, taux: 19 },
      { code: 'LIV-BR', nom: 'Guide du bricolage (livre)', qte: 2, pu: 15, taux: 7 },
    ] });
    // Rim joint le fichier El Fatoora à son achat (comme « Joindre », à l'écran de l'achat).
    const j = await api('POST', `/entreprises/${ent}/pieces-jointes`, rim, { nom: 'TEIF_FA-2026-1187.xml', contenu: Buffer.from(fa.xml, 'utf8').toString('base64') });
    expect(j.statut, JSON.stringify(j.corps)).toBe(201);
    const ok = await api('POST', `/entreprises/${ent}/dossier-v10`, rim, { changements: [
      { collection: 'suppliers', cle: 'wafa', rang: 0, revision: null, contenu: { id: 'wafa', name: 'Grossiste El Wafa', matricule: compact(MW) } },
      { collection: 'purchases', cle: 'fa', rang: 0, revision: null, contenu: enc({ id: 'fa', kind: 'facture', number: 'FA-2026-1187', date: dateFa, dueDate: jourDe(30),
        supplierId: 'wafa', category: 'Achats de marchandises', currency: 'DT', exchangeRate: '', fees: 1, withholdingRate: 0, tvaRecuperable: true, payments: [],
        attachments: [{ name: j.corps.name, file: j.corps.file, size: j.corps.size, date: j.corps.date }],
        lines: [
          { label: 'Perceuse à percussion 850 W', qty: 10, unit: '', unitPrice: 76.5, vatRate: 19, destination: 'charge', deductible: true },
          { label: 'Rallonge 10 m', qty: 4, unit: '', unitPrice: 12.5, vatRate: 19, destination: 'charge', deductible: true },
          { label: 'Guide du bricolage (livre)', qty: 2, unit: '', unitPrice: 15, vatRate: 7, destination: 'charge', deductible: true },
        ] }) },
    ] });
    expect(ok.statut, JSON.stringify(ok.corps)).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/exercices`, leila, { annee: Number(annee), ouverture: [] })).statut).toBeLessThan(300);

    const erreurs: string[] = [];
    const cx = await contexte(leila);
    await cx.addInitScript(sansVisite);
    const p = await cx.newPage();
    p.on('pageerror', (e) => erreurs.push(e.message));
    const onglets: string[] = [];
    cx.on('page', (o) => { onglets.push(o.url()); });
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossier/${ent}/comptabilite/journal/${annee}`);
    const brouillard = p.locator('label').filter({ hasText: /Compter \d+ écritures? en brouillard/ }).locator('input');
    await brouillard.waitFor({ timeout: 25_000 });
    await plusTard(p);
    if (!(await brouillard.isChecked())) await brouillard.click();
    const ligne = p.locator('#c-livres tbody tr').filter({ hasText: 'FA-2026-1187' }).first();
    await ligne.waitFor({ timeout: 15_000 });
    await ligne.getByRole('button', { name: /^Actions/ }).click();
    await p.getByText('Ouvrir le justificatif du client', { exact: true }).click();
    // La feuille, au lieu d'un onglet de XML brut : lue sur le serveur, sans l'IA, au millime, chaque taux.
    const feuille = p.locator('.pc-grand .ef-f');
    await expect.poll(() => feuille.getAttribute('data-ef'), { timeout: 15_000 }).toBe('lu');
    const f = net(await feuille.innerText());
    noter(`Cabinet justificatif en feuille : ${f}`);
    for (const t of ['GROSSISTE EL WAFA SARL', 'Facture FA-2026-1187', 'remise 10 % sur 85,000', 'TVA 19 % sur 815,000', '154,850', 'TVA 7 % sur 30,000', '2,100', 'Timbre fiscal', 'rien n\'est passé par l\'IA']) expect(f).toContain(t);
    expect(f).toMatch(/Total TTC 1 002,950 DT/);
    expect(onglets).toEqual([]);
    expect(await p.locator('.pc-grand-t b').innerText()).toBe('TEIF_FA-2026-1187.xml');
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-l-cabinet-justificatif.png'), fullPage: true });
    expect(await p.evaluate(problemes, [false, 1440] as [boolean, number])).toEqual([]);
    // Le fichier lui-même reste à un clic : il s'ouvre dans un onglet.
    const [onglet] = await Promise.all([cx.waitForEvent('page', { timeout: 15_000 }), p.getByRole('button', { name: 'Le fichier XML', exact: true }).click()]);
    await expect.poll(() => onglet.url(), { timeout: 15_000 }).toMatch(/^blob:/);
    await onglet.close();
    // Échap referme la feuille ; le journal est là, inchangé.
    await p.bringToFront();
    await p.keyboard.press('Escape');
    await expect.poll(() => p.locator('.pc-grand').count()).toBe(0);
    expect(await ligne.isVisible()).toBe(true);
    // Le même fichier, depuis le classeur (« Son justificatif », sur l'achat du mois) : la même feuille.
    await p.goto('about:blank');
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cab.id}#/dossier/${ent}/classeur`);
    // Le classeur s'ouvre sur le mois d'avant ; l'achat est du mois en cours.
    await p.locator('.cl-a-m').filter({ hasText: /en cours/ }).first().click({ timeout: 25_000 });
    const achat = p.locator('li[data-cl-k]').filter({ hasText: 'FA-2026-1187' }).first();
    await achat.waitFor({ timeout: 25_000 }).catch(async (x) => {
      noter(`Classeur : ${net(await p.locator('#view').innerText())}`); await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-x-classeur.png'), fullPage: true }); throw x;
    });
    await plusTard(p);
    await achat.click();
    await p.locator('[data-cl-just="0"]').click({ timeout: 20_000 });
    await expect.poll(() => feuille.getAttribute('data-ef'), { timeout: 15_000 }).toBe('lu');
    expect(net(await feuille.innerText())).toMatch(/Total TTC 1 002,950 DT/);
    await p.screenshot({ path: path.join(PHOTOS, 'efr-1325-m-cabinet-classeur-justificatif.png'), fullPage: true });
    await p.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect.poll(() => p.locator('.pc-grand').count()).toBe(0);
    expect(onglets.length).toBe(1);
    expect(erreurs).toEqual([]);
    await cx.close();
  }, 180_000);
});
