// Le jalon J2 (09 : « une entreprise d'essai tient un mois complet en Essentiel : devis, factures signées et
// acceptées par la TTN de test, payées en ligne par son client depuis son espace (Konnect de test), achats reçus et
// lus en photo, banque, déclaration du mois, avec une coupure de réseau jouée au milieu ; refait à la souris, sur un
// ordinateur et sur un téléphone »), joué ici d'un bout à l'autre sur UNE entreprise, contre une TTN, un DigiGo et
// un Konnect simulés (brique 107). Les accès de test réels (El Fatoora, DigiGo) sont des démarches en cours : ce
// parcours est la répétition générale, pas le jalon lui-même.
//
// 1. Vendre : la fiche (soumise à la facture électronique), le signataire, le compte El Fatoora et Konnect posés à
//    la souris ; un client ; un devis, facturé ; la facture émise, signée avec le code reçu, déposée et acceptée par
//    la TTN ; le lien de son espace donné au client, qui la paie en ligne ; le paiement est sur la facture.
// 2. Acheter, la banque, la déclaration : la facture du fournisseur photographiée et lue ; le compte en banque ouvert,
//    l'achat réglé depuis lui ; la TVA du mois à l'écran égale à celle des livres du serveur (deux chemins) ; une
//    coupure du réseau au milieu, sur l'ordinateur de Nadia (rien n'est perdu) ; et la facture relue au téléphone.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { cliquer, poserMouchard, recitObjet } from '../cliquer.ts';
import { digigoSimule } from '../digigo-simule.ts';
import { konnectSimule } from '../konnect-simule.ts';
import { ttnSimulee } from '../ttn-simule.ts';

const PHOTO = path.join(import.meta.dirname, '../donnees/lecture/quincaillerie-photo.jpg');

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('le jalon J2, d\'un bout à l\'autre', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  let digigo: Awaited<ReturnType<typeof digigoSimule>>;
  let ttn: Awaited<ReturnType<typeof ttnSimulee>>;
  let konnect: Awaited<ReturnType<typeof konnectSimule>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-j2-'));
  beforeAll(async () => {
    await admin.connect();
    await poserMouchard(admin);
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    digigo = await digigoSimule();
    ttn = await ttnSimulee();
    konnect = await konnectSimule();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_DIGIGO: digigo.base, SKANFACT_DIGIGO_CLE: digigo.cleIntegrateur,
      SKANFACT_TTN: ttn.base, SKANFACT_TTN_MS: '250', SKANFACT_KONNECT: konnect.base }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => {
    await navigateur?.close(); await serveur?.arreter(); await digigo?.fermer(); await ttn?.fermer(); await konnect?.fermer();
    await admin.end(); fs.rmSync(dossier, { recursive: true, force: true });
  });

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
  const toast = async (p: Page) => net(await p.locator('#toast').innerText().catch(() => ''));
  type Objet = { collection: string; cle: string; revision: number; contenu: Record<string, unknown> };

  // L'entreprise du mois, partagée par les deux moitiés du parcours.
  const m = { jeton: '', ent: '', facture: '' };
  const objets = async () => (await api('GET', `/entreprises/${m.ent}/dossier-v10`, m.jeton)).corps.objets as Objet[];
  const erreurs: string[] = [];
  let cn: BrowserContext;
  let nadia: Page;
  const aller = async (hash: string) => { await nadia.evaluate((x) => { location.hash = x; }, hash); await plusTard(nadia); };

  it('vendre : la fiche et les comptes posés, un devis facturé, la facture signée, acceptée par la TTN, payée en ligne par le client', async () => {
    // Nadia, propriétaire (avec le code de son téléphone), et son entreprise.
    const email = `nadia-j2-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    m.jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    m.ent = String((await api('POST', '/entreprises', m.jeton, { raisonSociale: 'Atelier Nadia' })).corps.id);

    cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, m.jeton);
    nadia = await cn.newPage();
    nadia.on('pageerror', (e) => erreurs.push(e.message));

    // 1. La fiche : matricule, adresse, soumise à la facture électronique.
    await nadia.goto(`${serveur.adresse}/v10/?e=${m.ent}#/parametres`);
    await expect.poll(() => nadia.locator('#pf input[name=name]').count(), { timeout: 20_000 }).toBe(1);
    await plusTard(nadia);
    await nadia.locator('#pf input[name=matricule]').fill('7654321B/A/M/000');
    await nadia.locator('#pf [name=address]').fill('12 rue de l\'Artisanat, Ben Arous');
    await nadia.locator('#save-bar #save').click();
    await nadia.locator('#set-tabs button[data-tab=documents]').click();
    await nadia.locator('#pf input[name=efacture]').check();
    await nadia.locator('#save-bar #save').click();
    await expect.poll(async () => (await objets()).find((o) => o.cle === 'company')?.contenu, { timeout: 10_000 })
      .toMatchObject({ matricule: '7654321B/A/M/000', efacture: true });
    // Le signataire, le compte El Fatoora, Konnect : chacun dans son panneau.
    const sg = nadia.locator('#signataire-panel');
    await sg.getByLabel('Identifiant DigiGo du signataire').fill('09876543');
    await sg.getByRole('button', { name: 'Enregistrer le signataire', exact: true }).click();
    await expect.poll(async () => net(await sg.locator('#sg-etat').innerText()), { timeout: 10_000 }).toMatch(/^Le signataire est 09876543/);
    const tt = nadia.locator('#ttn-panel');
    await tt.getByLabel('Identifiant de ton compte El Fatoora').fill('nadia-el-fatoora');
    await tt.getByLabel('Mot de passe El Fatoora').fill('Mot-de-passe-TTN-7');
    await tt.getByRole('button', { name: 'Brancher', exact: true }).click();
    await expect.poll(async () => net(await tt.locator('#ttn-etat').innerText()), { timeout: 10_000 }).toMatch(/^Branché le /);
    const pl = nadia.locator('#p-paiement');
    await pl.getByLabel('Identifiant de ton portefeuille Konnect').fill('portefeuille-nadia-7');
    await pl.getByLabel('Clé de l\'API Konnect').fill('sk_test_nadia-cle-secrete-b3f2');
    await pl.getByRole('button', { name: 'Brancher', exact: true }).click();
    await expect.poll(async () => net(await pl.locator('#pl-etat').innerText()), { timeout: 15_000 }).toMatch(/^Branché le /);
    await nadia.screenshot({ path: path.join(PHOTOS, 'j2-1-reglages.png') });

    // 2. Le client.
    await aller('#/clients');
    await nadia.locator('#new').click();
    await nadia.locator('#cf input[name=name]').fill('Menuiserie El Amel');
    await nadia.locator('#cf input[name=matricule]').fill('1234567A/A/M/000');
    await nadia.locator('#cf [name=address]').fill('Route de Gabès km 4, Sfax');
    await nadia.locator('#modal-root #ok').click();
    await expect.poll(async () => (await objets()).filter((o) => o.collection === 'clients').map((o) => o.contenu.name), { timeout: 10_000 }).toContain('Menuiserie El Amel');

    // 3. Un devis, puis « Facturer ce devis » ; la facture émise.
    await aller('#/doc/new/devis');
    await expect.poll(() => titre(nadia), { timeout: 10_000 }).toMatch(/^Nouveau devis/);
    await nadia.locator('[data-combo=clientId] .combo-btn').click();
    await nadia.locator('[data-combo=clientId] .combo-q').fill('Amel');
    await nadia.locator('[data-combo=clientId] .combo-list [role=option]').first().click();
    await nadia.locator('[data-k=label]').first().fill('Table en chêne massif');
    await nadia.locator('[data-k=qty]').first().fill('2');
    await nadia.locator('[data-k=unitPrice]').first().fill('450.5');
    await nadia.locator('#save').click();
    await expect.poll(() => toast(nadia), { timeout: 10_000 }).toMatch(/^Enregistré : DEV-\d{4}-001$/);
    // Le client l'accepte : Nadia le marque « Accepté », et « Facturer ce devis » devient l'étape suivante.
    // (Enregistré, le devis prend son adresse : la page se redessine ; on attend qu'elle y soit.)
    await nadia.waitForURL(/#\/doc\/(?!new)/, { timeout: 10_000 });
    await expect.poll(() => titre(nadia)).toMatch(/^Devis DEV-\d{4}-001/);
    await nadia.waitForTimeout(300);
    await nadia.locator('select[name=status]').selectOption('accepté');
    await nadia.locator('#save').click();
    await expect.poll(async () => (await objets()).find((o) => o.collection === 'documents' && o.contenu.type === 'devis')?.contenu.status, { timeout: 10_000 }).toBe('accepté');
    await nadia.getByRole('button', { name: 'Facturer ce devis', exact: true }).click();
    await expect.poll(() => titre(nadia), { timeout: 10_000 }).toMatch(/^Nouvelle facture|^Facture/);
    await plusTard(nadia);
    await nadia.locator('#issue').click();
    await expect.poll(() => nadia.locator('#modal-root #ok').count(), { timeout: 10_000 }).toBe(1);
    await nadia.locator('#modal-root #ok').click();
    await expect.poll(() => titre(nadia), { timeout: 20_000 }).toMatch(/^Facture FAC-\d{4}-001/);
    m.facture = decodeURIComponent(nadia.url().split('#/doc/')[1] ?? '');
    const f = (await objets()).find((o) => o.cle === m.facture)?.contenu;
    expect([f?.number, f?.status]).toEqual([expect.stringMatching(/^FAC-\d{4}-001$/), 'envoyée']);
    await nadia.screenshot({ path: path.join(PHOTOS, 'j2-2-facture.png') });

    // 4. Signée avec le code reçu par le signataire.
    await nadia.locator('#more-btn').click();
    await nadia.getByRole('button', { name: 'Signer (DigiGo)…', exact: true }).click();
    const fen = nadia.locator('#modal-root .modal').last();
    await fen.getByRole('button', { name: 'Envoyer le code au signataire', exact: true }).click();
    await expect.poll(async () => net(await fen.locator('#sg-etape p:not([role=alert])').innerText().catch(() => '')), { timeout: 10_000 })
      .toBe('Un code est parti sur le téléphone de Nadia Ben Salah. Tape-le ici :');
    await fen.getByLabel('Code reçu par le signataire').fill(String(digigo.codeDe('09876543')));
    await fen.getByRole('button', { name: 'Signer', exact: true }).click();
    await expect.poll(async () => net(await fen.locator('#sg-fait').innerText()), { timeout: 10_000 }).toMatch(/^La pièce FAC-\d{4}-001 est signée par Nadia Ben Salah/);
    await fen.getByRole('button', { name: 'Fermer', exact: true }).click().catch(() => nadia.keyboard.press('Escape'));

    // 5. Déposée, puis acceptée par la TTN (le facteur repasse : avancé ici, il attendrait une minute).
    const envoi = async () => (await api('GET', `/entreprises/${m.ent}/dossier-v10/${encodeURIComponent(m.facture)}/teif`, m.jeton)).corps.envoi as { statut: string } | null;
    await expect.poll(async () => (await envoi())?.statut, { timeout: 15_000 }).toBe('deposee');
    await admin.query(`update ventes.envoi_ttn set prochain_essai = now() where entreprise = $1`, [m.ent]);
    await expect.poll(async () => (await envoi())?.statut, { timeout: 15_000 }).toBe('acceptee');

    // 6. Le lien de son espace donné au client ; il paie la facture en ligne.
    await nadia.reload();
    await expect.poll(() => titre(nadia), { timeout: 20_000 }).toMatch(/^Facture FAC-\d{4}-001/);
    await plusTard(nadia);
    await nadia.locator('#more-btn').click();
    await nadia.getByRole('button', { name: 'Lien pour le client…', exact: true }).click();
    const lc = nadia.locator('#modal-root .modal').last();
    await lc.getByRole('button', { name: 'Créer le lien de cette pièce', exact: true }).click();
    const lien = await lc.locator('#lc-adresse').inputValue();
    expect(lien).toMatch(/\/espace\/#[A-Za-z0-9_-]{32}$/);
    // Le lien copié, Nadia ferme la fenêtre.
    await lc.locator('[data-close]').first().click();
    await expect.poll(() => nadia.locator('#modal-root .modal').count()).toBe(0);
    const cc = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR' });
    const client = await cc.newPage();
    client.on('pageerror', (e) => erreurs.push(`client : ${e.message}`));
    await client.goto(lien);
    const payer = client.getByRole('button', { name: /^Payer 1 073,190\sDT en ligne$/ });
    await payer.waitFor({ timeout: 15_000 });
    await client.screenshot({ path: path.join(PHOTOS, 'j2-3-espace-client.png') });
    await payer.click();
    await client.waitForURL(/\/payer\/[0-9a-f]+$/, { timeout: 15_000 });
    await client.getByRole('button', { name: 'Payer (simulation)', exact: true }).click();
    await client.waitForURL(/\/espace\/retour\.html/, { timeout: 15_000 });
    await expect.poll(async () => net(await client.locator('#retour').innerText()), { timeout: 15_000 }).toMatch(/^Paiement reçu 1 073,190 DT pour la facture FAC-\d{4}-001\./);
    await cc.close();

    // Chez Nadia : le paiement est sur la facture, qui ne doit plus rien.
    const payee = (await objets()).find((o) => o.cle === m.facture)?.contenu;
    expect((payee?.payments as Record<string, unknown>[]).map((p) => [p.method, p.amount])).toEqual([['en_ligne', { '~n': '1073.19' }]]);
    expect(erreurs).toEqual([]);
  }, 240_000);
  it('acheter, la banque, la déclaration du mois, une coupure du réseau, et le téléphone', async () => {
    expect(m.facture, 'la première moitié du parcours a joué').not.toBe('');
    // 1. Le fournisseur, puis sa facture photographiée et lue ; enregistrée, elle tombe au millime sur la pièce.
    await aller('#/fournisseurs');
    await nadia.locator('#new').click();
    await nadia.locator('#sf input[name=name]').fill('Quincaillerie Ben Salem');
    await nadia.locator('#sf input[name=matricule]').fill('1234567A/B/M/000');
    await nadia.locator('#modal-root #ok').click();
    await expect.poll(async () => (await objets()).filter((o) => o.collection === 'suppliers').map((o) => o.contenu.name), { timeout: 10_000 }).toEqual(['Quincaillerie Ben Salem']);
    await aller('#/achat/new');
    await expect.poll(() => titre(nadia), { timeout: 10_000 }).toMatch(/achat/i);
    const bouton = nadia.locator('#photo');
    await expect.poll(() => bouton.isVisible(), { timeout: 10_000 }).toBe(true);
    const selecteur = nadia.waitForEvent('filechooser');
    await bouton.click();
    await (await selecteur).setFiles(PHOTO);
    const lu = nadia.locator('#modal-root .modal').last();
    await expect.poll(() => lu.locator('h2').first().innerText(), { timeout: 30_000 }).toBe('Ce que SkanFact a lu');
    await lu.getByRole('button', { name: 'Utiliser ces informations', exact: true }).click();
    await expect.poll(() => nadia.locator('#modal-root .modal').count()).toBe(0);
    await nadia.locator('#save').click();
    await expect.poll(async () => ((await api('GET', `/entreprises/${m.ent}/achats`, m.jeton)).corps.lignes as { numero: string; netAPayer: string }[] | undefined)?.map((l) => [l.numero, l.netAPayer]),
      { timeout: 15_000 }).toEqual([['FV-2026-0412', '332.222']]);
    await nadia.screenshot({ path: path.join(PHOTOS, 'j2-4-achat-lu.png') });

    // 2. La banque : le compte courant ouvert, puis l'achat réglé depuis lui.
    await aller('#/tresorerie');
    await cliquer(nadia.locator('#new-acc'), '', 15_000, () => recitObjet(admin, m.ent, 'accounts'));
    await nadia.locator('#af input[name=name]').fill('BIAT — compte courant');
    await nadia.locator('#af [name=opening]').fill('5000');
    await nadia.locator('#modal-root #ok').click();
    await expect.poll(async () => (await objets()).filter((o) => o.collection === 'accounts').map((o) => o.contenu.name), { timeout: 10_000 }).toContain('BIAT — compte courant');
    const biat = (await objets()).find((o) => o.collection === 'accounts' && o.contenu.name === 'BIAT — compte courant')?.cle;
    const achat = (await objets()).find((o) => o.collection === 'purchases')?.cle ?? '';
    await aller(`#/achat/${achat}`);
    await expect.poll(() => titre(nadia), { timeout: 10_000 }).toMatch(/FV-2026-0412/);
    await nadia.locator('#pay').click();
    await nadia.locator('#spf select[name=accountId]').selectOption(String(biat));
    await nadia.locator('#spf [name=reference]').fill('VIR-0458');
    await nadia.locator('#modal-root #ok').click();
    await expect.poll(async () => ((await objets()).find((o) => o.cle === achat)?.contenu.payments as Record<string, unknown>[] | undefined)?.map((p) => [p.accountId, p.amount, p.reference]),
      { timeout: 10_000 }).toEqual([[biat, { '~n': '332.222' }, 'VIR-0458']]);

    // 3. La déclaration du mois : la TVA que l'écran dit est celle des livres du serveur.
    const mois = new Date().toISOString().slice(0, 7);
    const fin = new Date(Date.UTC(Number(mois.slice(0, 4)), Number(mois.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const balance = (await api('GET', `/entreprises/${m.ent}/compta/balance?du=${mois}-01&au=${fin}`, m.jeton)).corps.comptes as { compte: string; debit: string; credit: string }[];
    const somme = (prefixe: string, cote: 'debit' | 'credit') => balance.filter((c) => c.compte.startsWith(prefixe)).reduce((t, c) => t + Number(c[cote]), 0);
    const lisible = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).replace(/\u202f/g, ' ');
    const collectee = somme('4367', 'credit'), deductible = somme('4366', 'debit');
    expect(collectee).toBe(171.19);
    expect(deductible).toBeGreaterThan(0);
    await aller('#/compta');
    await nadia.locator('#view [data-tab=tva]').click();
    const ecran = net(await nadia.locator('#view').innerText()).replace(/\u202f/g, ' ');
    expect(ecran).toContain(lisible(collectee));
    expect(ecran).toContain(lisible(deductible));
    expect(ecran).toContain(lisible(Math.round((collectee - deductible) * 1000) / 1000));
    await nadia.screenshot({ path: path.join(PHOTOS, 'j2-5-tva-du-mois.png') });

    // 4. Une coupure du réseau, sur l'ordinateur de Nadia (la copie gardée) : un client noté sans réseau part seul
    //    à son retour, et s'annonce seul : l'achat fait plus tôt sur l'autre poste ne compte pas pour un changement
    //    de plus (brique 108).
    const co = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await co.addInitScript(() => { if (navigator.storage) Object.assign(navigator.storage, { persist: async () => true, persisted: async () => true }); });
    await co.addInitScript((j) => {
      if (!location.protocol.startsWith('http') || localStorage.getItem('test.pose')) return;
      localStorage.setItem('test.pose', '1');
      localStorage.setItem('skanfact.jeton', j);
    }, m.jeton);
    const poste = await co.newPage();
    poste.on('pageerror', (e) => erreurs.push(`poste : ${e.message}`));
    await poste.goto(`${serveur.adresse}/v10/?e=${m.ent}#/clients`);
    await poste.locator('#view h1').first().waitFor({ timeout: 20_000 });
    await plusTard(poste);
    await expect.poll(() => poste.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => poste.evaluate(async () => (await indexedDB.databases()).some((b) => b.name === 'skanfact-poste')), { timeout: 15_000 }).toBe(true);
    await co.setOffline(true);
    await poste.locator('#new').click();
    await poste.locator('#cf input[name=name]').fill('Ébénisterie Hors Réseau');
    await poste.locator('#modal-root #ok').click();
    await expect.poll(async () => net(await poste.locator('#poste-bandeau').innerText().catch(() => '')), { timeout: 10_000 }).toMatch(/Un changement attend le réseau/);
    await poste.screenshot({ path: path.join(PHOTOS, 'j2-6-coupure.png') });
    expect((await objets()).filter((o) => o.collection === 'clients').map((o) => o.contenu.name)).not.toContain('Ébénisterie Hors Réseau');
    await co.setOffline(false);
    await expect.poll(async () => (await objets()).filter((o) => o.collection === 'clients').map((o) => o.contenu.name), { timeout: 20_000 }).toContain('Ébénisterie Hors Réseau');
    await expect.poll(async () => net(await poste.locator('#poste-bandeau').innerText().catch(() => '')), { timeout: 15_000 }).toMatch(/^Le réseau est revenu/);
    await co.close();

    // 5. Au téléphone : la facture du mois se relit, payée, sans que rien ne déborde.
    const ct = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR' });
    await ct.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, m.jeton);
    const tel = await ct.newPage();
    tel.on('pageerror', (e) => erreurs.push(`téléphone : ${e.message}`));
    await tel.goto(`${serveur.adresse}/v10/?e=${m.ent}#/factures`);
    await expect.poll(() => titre(tel), { timeout: 20_000 }).toMatch(/^Factures/);
    await plusTard(tel);
    await tel.locator('#view a', { hasText: /^FAC-\d{4}-001$/ }).first().click().catch(async () => { await tel.evaluate((x) => { location.hash = x; }, `#/doc/${m.facture}`); });
    await expect.poll(() => titre(tel), { timeout: 10_000 }).toMatch(/^Facture FAC-\d{4}-001/);
    await plusTard(tel);
    expect(await tel.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(net(await tel.locator('#view').innerText())).toMatch(/Paiement en ligne/);
    await tel.screenshot({ path: path.join(PHOTOS, 'j2-7-telephone.png'), fullPage: true });
    await ct.close();
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 240_000);
});
