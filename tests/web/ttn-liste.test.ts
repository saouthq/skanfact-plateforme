// L'état El Fatoora dans la liste des factures, à la souris (brique 139 ; docs/facture-electronique.md, L), contre
// une TTN et un DigiGo simulés. L'entreprise de Nadia est soumise à la facture électronique : trois factures émises,
// la deuxième signée avant que le compte El Fatoora soit posé. Ce que le parcours vérifie :
//   - sous le statut de chaque facture émise, la liste dit où en est son fichier El Fatoora : à signer, retenue (et
//     pourquoi, au survol), acceptée (sa référence), refusée (pourquoi) ;
//   - un seul appel pour toute la page, et la liste redessinée à chaque frappe ne redemande rien ; une pièce signée
//     ou renvoyée depuis sa fenêtre change d'état dans la liste aussitôt ; une coupure du réseau ne casse rien ;
//   - la place est gardée : la ligne ne grandit pas quand l'état arrive (rien ne bouge sous le curseur) ;
//   - une entreprise qui n'est pas soumise n'en montre rien, et ne demande rien.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page, type Route } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { digigoSimule } from '../digigo-simule.ts';
import { v10, type DocV10 } from '../moteur/v10.ts';
import { ttnSimulee } from '../ttn-simule.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');

describe('l\'état El Fatoora dans la liste des factures', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  let digigo: Awaited<ReturnType<typeof digigoSimule>>;
  let ttn: Awaited<ReturnType<typeof ttnSimulee>>;
  const admin = new pg.Client({ connectionString: inject('pgAdmin') });
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-ttn-liste-'));
  beforeAll(async () => {
    await admin.connect();
    await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
      select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
    digigo = await digigoSimule();
    ttn = await ttnSimulee();
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test', SKANFACT_DIGIGO: digigo.base, SKANFACT_DIGIGO_CLE: digigo.cleIntegrateur,
      SKANFACT_TTN: ttn.base, SKANFACT_TTN_MS: '250' }), port: 0, web: dossier, livreurMs: 60_000 });
    navigateur = await chromium.launch();
    fs.mkdirSync(PHOTOS, { recursive: true });
  }, 120_000);
  afterAll(async () => { await navigateur?.close(); await serveur?.arreter(); await digigo?.fermer(); await ttn?.fermer(); await admin.end(); fs.rmSync(dossier, { recursive: true, force: true }); });

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
  const net = (t: string) => t.replace(/\s+/g, ' ').trim();
  const enc = (v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? { '~n': String(v) }
    : Array.isArray(v) ? v.map(enc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v);

  // L'entreprise de Nadia, soumise, avec trois factures émises et sa signataire désignée.
  const atelier = async () => {
    const email = `nadia-ttn-liste-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Nadia', motDePasse: 'Un-bon-mot-de-passe' });
    const premier = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Premier', type: 'navigateur' } })).corps.jeton);
    const modele = String((await api('POST', '/entreprises-essai', premier)).corps.id);
    const secret = /secret=([A-Z2-7]+)/.exec(String((await api('POST', '/moi/code', premier, { methode: 'application' })).corps.adresseApplication))?.[1] ?? '';
    const r = await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Chrome sur Linux', type: 'navigateur' } });
    const jeton = String((await api('POST', '/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret), Date.now()) })).corps.jeton);
    type Objet = { collection: string; cle: string; revision: number; rang: number | null; contenu: Record<string, unknown> };
    const objets = async (e: string) => (await api('GET', `/entreprises/${e}/dossier-v10`, jeton)).corps.objets as Objet[];
    const deModele = await objets(modele);
    const fiche = deModele.find((o) => o.collection === '_racine' && o.cle === 'company');
    const menuiserie = deModele.find((o) => o.collection === 'clients' && String(o.contenu.name).startsWith('Menuiserie'));
    if (!fiche || !menuiserie) throw new Error('entreprise d\'essai incomplète');
    const ent = String((await api('POST', '/entreprises', jeton, { raisonSociale: 'Atelier Nadia' })).corps.id);
    const ici = await objets(ent);
    const societe = ici.find((o) => o.collection === '_racine' && o.cle === 'company');
    const client = { ...menuiserie.contenu, matricule: '1234567A/A/M/000' };
    await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: societe?.revision ?? null, contenu: { ...fiche.contenu, ...societe?.contenu, name: 'Atelier Nadia', matricule: '7654321B/A/M/000', efacture: true } },
      { collection: 'clients', cle: menuiserie.cle, rang: 0, revision: null, contenu: client },
    ] });
    for (const [k, id] of ['f1', 'f2', 'f3'].entries()) {
      const d: Record<string, unknown> = {
        id, type: 'facture', number: '', date: '2026-10-01', dueDate: '2026-10-31', clientId: menuiserie.cle, subject: 'Mobilier', status: 'brouillon',
        lines: [{ label: 'Table en chêne massif', description: '', qty: 2 + k, unit: '', unitPrice: 450.5, vatRate: 19 }],
        discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [], stampFee: 1,
      };
      await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [{ collection: 'documents', cle: id, rang: k, revision: null, contenu: enc(d) }] });
      expect((await api('POST', `/entreprises/${ent}/dossier-v10/emettre`, jeton, { document: enc(d), client, revision: 1, rang: k,
        netAPayer: v10.computeTotals(d as DocV10, { currency: 'DT', stampFee: 1 }).netToPay.toFixed(3) })).statut).toBe(200);
    }
    await api('PUT', `/entreprises/${ent}/efacture/signataire`, jeton, { identifiant: '09876543' });
    const signer = async (cle: string) => {
      const demande = await api('POST', `/entreprises/${ent}/efacture/signatures`, jeton, { pieces: [cle] });
      expect((await api('POST', `/entreprises/${ent}/efacture/signatures/${String(demande.corps.id)}/code`, jeton, { code: String(digigo.codeDe('09876543')) })).statut).toBe(200);
    };
    const envoi = async (cle: string) => (await api('GET', `/entreprises/${ent}/dossier-v10/${cle}/teif`, jeton)).corps.envoi as { statut: string; motifCle: string | null } | null;
    return { jeton, ent, objets, signer, envoi };
  };

  it('chaque facture émise dit où en est son fichier El Fatoora, en un appel pour la page, sans rien pousser', async () => {
    const { jeton, ent, objets, signer, envoi } = await atelier();
    // FAC-2026-002 signée ; le facteur est passé : sans compte, elle est retenue.
    await signer('f2');
    await expect.poll(async () => (await envoi('f2'))?.motifCle, { timeout: 10_000 }).toBe('ttn.sans_compte');

    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const nadia = await cn.newPage();
    const erreurs: string[] = [];
    nadia.on('pageerror', (e) => erreurs.push(e.message));
    // Les demandes d'états ; la première est retenue tant que le test ne la lâche pas (pour mesurer la ligne avant) ;
    // `couper` fait tomber le réseau pour les suivantes.
    const demandes: string[] = [];
    let lacher: () => void = () => {};
    const retenue = new Promise<void>((ok) => { lacher = ok; });
    let couper = 0;
    await nadia.route('**/efacture/etats?**', async (route: Route) => {
      demandes.push(route.request().url());
      if (demandes.length === 1) await retenue;
      if (couper > 0) { couper--; await route.abort('internetdisconnected'); return; }
      await route.continue();
    });
    const etatDe = (cle: string) => nadia.locator(`tr[data-id="${cle}"] .ttn-etat`);
    await nadia.goto(`${serveur.adresse}/v10/?e=${ent}#/factures`);
    await expect.poll(() => nadia.locator(`tr[data-id="f3"]`).count(), { timeout: 20_000 }).toBe(1);
    await plusTard(nadia);
    // L'état n'est pas encore là : la ligne garde déjà sa place.
    await expect.poll(() => demandes.length).toBe(1);
    const hauteur = () => nadia.locator('tr[data-id="f2"]').evaluate((tr) => tr.getBoundingClientRect().height);
    const avant = await hauteur();
    expect(await etatDe('f2').innerText()).toBe('');
    lacher();
    await expect.poll(async () => net(await etatDe('f2').innerText()), { timeout: 10_000 }).toBe('El Fatoora : retenue');
    expect(await hauteur()).toBe(avant);
    expect(net(await etatDe('f1').innerText())).toBe('El Fatoora : à signer');
    expect(net(await etatDe('f3').innerText())).toBe('El Fatoora : à signer');
    // Retenue : pourquoi, au survol.
    expect(await etatDe('f2').locator('span').getAttribute('title')).toBe('Le compte El Fatoora de l\'entreprise n\'est pas posé : branche-le dans Paramètres → Documents, et la pièce partira.');
    // Un seul appel, pour les trois pièces de la page.
    expect(demandes).toHaveLength(1);
    expect(new URL(demandes[0] ?? '').searchParams.get('cles')?.split(',').sort()).toEqual(['f1', 'f2', 'f3']);
    await nadia.screenshot({ path: path.join(PHOTOS, 'ttn-liste-1.png') });
    // La liste redessinée à chaque frappe ne redemande rien.
    await nadia.locator('#q').pressSequentially('FAC-2026', { delay: 30 });
    await expect.poll(() => nadia.locator('tbody tr[data-id]').count()).toBe(3);
    expect(net(await etatDe('f2').innerText())).toBe('El Fatoora : retenue');
    expect(demandes).toHaveLength(1);

    // Le compte posé : FAC-2026-002 est acceptée ; FAC-2026-003, signée, est refusée au dépôt.
    expect((await api('PUT', `/entreprises/${ent}/efacture/ttn`, jeton, { identifiant: 'nadia-el-fatoora', motDePasse: 'Mot-de-passe-TTN-7' })).statut).toBe(200);
    // (Déposée, puis acceptée au tour suivant, avancé ici ; une machine lente peut la voir déjà acceptée.)
    await expect.poll(async () => (await envoi('f2'))?.statut, { timeout: 10_000 }).toMatch(/^(deposee|acceptee)$/);
    await admin.query(`update ventes.envoi_ttn set prochain_essai = now() where entreprise = $1`, [ent]);
    await expect.poll(async () => (await envoi('f2'))?.statut, { timeout: 10_000 }).toBe('acceptee');
    ttn.reglage.fauteAuDepot = 'Signature du fournisseur invalide';
    try {
      await signer('f3');
      await expect.poll(async () => (await envoi('f3'))?.statut, { timeout: 10_000 }).toBe('refusee');
    } finally {
      ttn.reglage.fauteAuDepot = null;
    }
    const reference = String((await admin.query(`select reference from ventes.envoi_ttn where entreprise = $1 and statut = 'acceptee'`, [ent])).rows[0].reference);
    // Le réseau tombe pendant la demande : la place reste vide, sans erreur ; la liste redessinée redemande.
    couper = 1;
    const avantCoupure = demandes.length;
    await nadia.reload();
    await expect.poll(() => demandes.length, { timeout: 20_000 }).toBeGreaterThan(avantCoupure);
    await plusTard(nadia);
    await nadia.locator('#q').fill('FAC');
    await expect.poll(async () => net(await etatDe('f2').innerText().catch(() => '')), { timeout: 20_000 }).toBe('El Fatoora : acceptée');
    expect(await etatDe('f2').locator('span').getAttribute('title')).toBe(`Référence de la TTN : ${reference}`);
    expect(net(await etatDe('f3').innerText())).toBe('El Fatoora : refusée');
    // Ce qui demande d'agir se voit : refusée (ou retenue) en couleur d'alerte ; le reste, discret.
    expect(await etatDe('f3').locator('span').getAttribute('class')).toBe('small warn-text');
    expect(await etatDe('f2').locator('span').getAttribute('class')).toBe('small muted');
    expect(await etatDe('f3').locator('span').getAttribute('title')).toBe('La TTN a refusé la pièce au dépôt : « Signature du fournisseur invalide ».');
    expect(net(await etatDe('f1').innerText())).toBe('El Fatoora : à signer');
    await nadia.screenshot({ path: path.join(PHOTOS, 'ttn-liste-2.png') });

    // Signée depuis sa fenêtre, FAC-2026-001 n'est plus « à signer » quand Nadia revient à la liste (sans recharger).
    const versLaListe = async () => {
      await nadia.evaluate(() => { location.hash = '#/factures'; });
      await expect.poll(() => nadia.locator('tr[data-id="f1"]').count(), { timeout: 10_000 }).toBe(1);
    };
    await nadia.locator('tr[data-id="f1"] td').first().click();
    await expect.poll(() => nadia.locator('#view h1').first().innerText(), { timeout: 20_000 }).toMatch(/^Facture FAC-2026-001/);
    await nadia.locator('#more-btn').click();
    await nadia.getByRole('button', { name: 'Signer (DigiGo)…', exact: true }).click();
    const fenetre = nadia.locator('#modal-root .modal').last();
    await fenetre.getByRole('button', { name: 'Envoyer le code au signataire', exact: true }).click();
    // (Le code se lit une fois parti : le champ paraît quand DigiGo l'a envoyé.)
    await fenetre.getByLabel('Code reçu par le signataire').waitFor();
    await fenetre.getByLabel('Code reçu par le signataire').fill(String(digigo.codeDe('09876543')));
    await fenetre.getByRole('button', { name: 'Signer', exact: true }).click();
    await expect.poll(() => fenetre.locator('#sg-fait').count(), { timeout: 10_000 }).toBe(1);
    await fenetre.getByRole('button', { name: 'Fermer', exact: true }).click();
    await versLaListe();
    await expect.poll(async () => net(await etatDe('f1').innerText()), { timeout: 10_000 }).toMatch(/^El Fatoora : (en route|déposée, en attente)$/);
    // Renvoyée depuis sa fenêtre, FAC-2026-003 n'est plus « refusée » dans la liste.
    await nadia.locator('tr[data-id="f3"] td').first().click();
    await expect.poll(() => nadia.locator('#view h1').first().innerText(), { timeout: 20_000 }).toMatch(/^Facture FAC-2026-003/);
    await nadia.locator('#more-btn').click();
    await nadia.getByRole('button', { name: 'Fichier pour El Fatoora (TEIF)…', exact: true }).click();
    const pret = nadia.locator('#modal-root .modal').last();
    await pret.getByRole('button', { name: 'Renvoyer à la TTN', exact: true }).click();
    await expect.poll(async () => net(await pret.locator('#ttn-piece').innerText())).toMatch(/^Elle repart à la TTN/);
    await pret.getByRole('button', { name: 'Fermer', exact: true }).click();
    await versLaListe();
    await expect.poll(async () => net(await etatDe('f3').innerText()), { timeout: 10_000 }).toMatch(/^El Fatoora : (en route|déposée, en attente)$/);

    // Une entreprise qui n'est pas soumise à la facture électronique : sa liste n'en dit rien, et ne demande rien.
    const fiche2 = (await objets(ent)).find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche2?.revision ?? null, contenu: { ...fiche2?.contenu, efacture: false } }] })).statut).toBe(200);
    const avantNonSoumise = demandes.length;
    await nadia.reload();
    await expect.poll(() => nadia.locator('tr[data-id="f3"]').count(), { timeout: 20_000 }).toBe(1);
    await nadia.waitForTimeout(500);
    expect(await nadia.locator('.ttn-etat').count()).toBe(0);
    expect(demandes.length).toBe(avantNonSoumise);
    expect(erreurs).toEqual([]);
    await cn.close();
  }, 180_000);

  it('« Signer les 3 pièces en attente… » : un seul code les signe toutes, sans rien pousser à l\'écran (brique 140)', async () => {
    const { jeton, ent } = await atelier();
    const cn = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await cn.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    const nadia = await cn.newPage();
    const erreurs: string[] = [];
    nadia.on('pageerror', (e) => erreurs.push(e.message));
    // La demande des pièces en attente est retenue : on mesure le titre et le bouton principal avant le bouton.
    let lacher: () => void = () => {};
    const retenue = new Promise<void>((ok) => { lacher = ok; });
    let premiere = true;
    await nadia.route('**/efacture/a-signer', async (route: Route) => {
      if (premiere) { premiere = false; await retenue; }
      await route.continue();
    });
    await nadia.goto(`${serveur.adresse}/v10/?e=${ent}#/factures`);
    await expect.poll(() => nadia.locator('tr[data-id="f3"]').count(), { timeout: 20_000 }).toBe(1);
    await plusTard(nadia);
    const ou = () => nadia.evaluate(() => [document.querySelector('#view h1'), document.getElementById('new')].map((x) => { const b = x?.getBoundingClientRect(); return b ? [b.left, b.top] : null; }));
    const avant = await ou();
    lacher();
    const bouton = nadia.getByRole('button', { name: 'Signer les 3 pièces en attente…', exact: true });
    await expect.poll(() => bouton.count(), { timeout: 10_000 }).toBe(1);
    // Il paraît juste à côté du titre ; ni le titre ni le bouton principal n'ont bougé.
    expect(await ou()).toEqual(avant);
    const ecart = await nadia.evaluate(() => (document.getElementById('sg-lot')?.getBoundingClientRect().left ?? 0) - (document.querySelector('#view h1')?.getBoundingClientRect().right ?? 0));
    expect(ecart).toBeGreaterThan(0);
    expect(ecart).toBeLessThan(40);
    await nadia.screenshot({ path: path.join(PHOTOS, 'ttn-lot-1.png') });
    await bouton.click();
    const fenetre = nadia.locator('#modal-root .modal').last();
    await expect.poll(() => fenetre.locator('h2').innerText()).toBe('Signer 3 pièces avec DigiGo');
    expect(net(await fenetre.locator('p.small').first().innerText())).toBe('Les fichiers El Fatoora de FAC-2026-001, FAC-2026-002, FAC-2026-003, écrits par SkanFact à l\'émission, sont signés par DigiGo (TunTrust) avec le certificat de ton signataire. Un code arrive sur SON téléphone : c\'est lui qui te le donne, et ce seul code les signe toutes.');
    await fenetre.getByRole('button', { name: 'Envoyer le code au signataire (3 pièces)', exact: true }).click();
    await fenetre.getByLabel('Code reçu par le signataire').waitFor();
    await fenetre.getByLabel('Code reçu par le signataire').fill(String(digigo.codeDe('09876543')));
    await fenetre.getByRole('button', { name: 'Signer', exact: true }).click();
    await expect.poll(async () => net(await fenetre.locator('#sg-fait').innerText().catch(() => '')), { timeout: 10_000 })
      .toMatch(/^Les pièces FAC-2026-001, FAC-2026-002, FAC-2026-003 sont signées par Nadia Ben Salah, le \d\d\/\d\d\/\d{4} à \d+ h \d\d\. Elles partent d'elles-mêmes à la TTN : la liste dit où chacune en est\.$/);
    await nadia.screenshot({ path: path.join(PHOTOS, 'ttn-lot-2.png') });
    // Un seul code, une seule demande, pour les trois.
    expect((await admin.query(`select count(*)::int n, sum(cardinality(pieces))::int p from ventes.signature_demande where entreprise = $1`, [ent])).rows[0]).toEqual({ n: 1, p: 3 });
    await fenetre.getByRole('button', { name: 'Fermer', exact: true }).click();
    // La liste redessinée : plus de bouton, et aucune n'est plus « à signer ».
    await expect.poll(() => nadia.locator('#sg-lot').count(), { timeout: 10_000 }).toBe(0);
    for (const cle of ['f1', 'f2', 'f3']) {
      await expect.poll(async () => net(await nadia.locator(`tr[data-id="${cle}"] .ttn-etat`).innerText()), { timeout: 10_000 }).toMatch(/^El Fatoora : (en route|retenue)$/);
    }
    await nadia.screenshot({ path: path.join(PHOTOS, 'ttn-lot-3.png') });

    // Le bouton dit ce qu'il signera : une seule pièce ; ou les 100 premières quand il y en a plus (une demande n'en
    // prend pas plus). (Ce que dit le serveur est remplacé ici, pour ne pas émettre 150 factures.)
    const dire = async (corps: unknown) => {
      await nadia.unroute('**/efacture/a-signer');
      await nadia.route('**/efacture/a-signer', (route: Route) => route.fulfill({ json: corps }));
      await nadia.reload();
      await expect.poll(() => nadia.locator('#sg-lot').count(), { timeout: 20_000 }).toBe(1);
      return net(await nadia.locator('#sg-lot').innerText());
    };
    expect(await dire({ total: 1, pieces: [{ cle: 'f1', numero: 'FAC-2026-001' }] })).toBe('Signer la pièce en attente…');
    expect(await dire({ total: 150, pieces: Array.from({ length: 100 }, (_, i) => ({ cle: `g${i}`, numero: `FAC-2026-${String(i + 1).padStart(3, '0')}` })) }))
      .toBe('Signer les 100 premières pièces en attente (sur 150)…');
    // Pas sur la liste des devis.
    await nadia.evaluate(() => { location.hash = '#/devis'; });
    await expect.poll(() => nadia.locator('#view h1').first().innerText()).toBe('Devis');
    await nadia.waitForTimeout(300);
    expect(await nadia.locator('#sg-lot').count()).toBe(0);

    // Karim, commercial, ne signe pas : sa liste ne propose rien, sans erreur.
    const email = `karim-ttn-lot-${Date.now()}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom: 'Karim', motDePasse: 'Un-bon-mot-de-passe' });
    const karim = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const inv = String((await api('POST', `/entreprises/${ent}/invitations`, jeton, { email, roles: ['commercial'] })).corps.jeton);
    expect((await api('POST', '/invitations/accepter', karim, { jeton: inv })).statut).toBe(200);
    const ck = await navigateur.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
    await ck.addInitScript((j) => { if (location.protocol.startsWith('http')) sessionStorage.setItem('skanfact.jeton', j); }, karim);
    const k = await ck.newPage();
    k.on('pageerror', (e) => erreurs.push(e.message));
    const demandes: number[] = [];
    k.on('response', (r) => { if (r.url().includes('/efacture/a-signer')) demandes.push(r.status()); });
    await k.goto(`${serveur.adresse}/v10/?e=${ent}#/factures`);
    await expect.poll(() => k.locator('tr[data-id="f3"]').count(), { timeout: 20_000 }).toBe(1);
    await expect.poll(() => demandes, { timeout: 10_000 }).toEqual([403]);
    expect(await k.locator('#sg-lot').count()).toBe(0);
    // Une entreprise qui n'est pas soumise : pas de bouton.
    const fiche = ((await api('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string; revision: number; contenu: Record<string, unknown> }[])
      .find((o) => o.collection === '_racine' && o.cle === 'company');
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, jeton, { changements: [
      { collection: '_racine', cle: 'company', rang: null, revision: fiche?.revision ?? null, contenu: { ...fiche?.contenu, efacture: false } }] })).statut).toBe(200);
    // (Le même document, rechargé : la fiche de l'entreprise se relit.)
    await nadia.goto(`${serveur.adresse}/v10/?e=${ent}#/factures`);
    await nadia.reload();
    await expect.poll(() => nadia.locator('tr[data-id="f3"]').count(), { timeout: 20_000 }).toBe(1);
    await nadia.waitForTimeout(300);
    expect(await nadia.locator('#sg-lot').count()).toBe(0);
    expect(erreurs).toEqual([]);
    await ck.close();
    await cn.close();
  }, 180_000);
});
