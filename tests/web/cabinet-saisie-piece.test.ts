// La Saisie du Cabinet face à la pièce (1.210.0, maquette « Saisie… », lots S1 à S6), à la souris. Ce que le parcours
// vérifie, le 31/10/2026 :
//   - septembre : la bande « Pièce i sur N », chaque pièce dit ce qu'elle demande (à vérifier, à saisir, déjà saisie ?,
//     à reclasser, en devises) ;
//   - S1 : la facture que Sarra a saisie elle-même, ses contrôles, « Ne plus me faire vérifier » (la fiche du dossier),
//     « Marquer vérifiée » ;
//   - S3 : le ticket lu (fournisseur, date, total), sans TVA (un ticket n'est pas une facture, À VÉRIFIER), payé par carte :
//     Entrée écrit l'achat, joint la pièce, écrit son règlement et le rapproche de sa ligne du relevé ;
//   - la photo STEG déjà au livre : « Joindre à FA-0919 » ;
//   - S2 : la facture du 29/08 saisie au 10/09 : l'effet sur la TVA des deux mois, et la demande à Sarra (l'écriture suit
//     l'achat du client, le cabinet ne la réécrit pas) ;
//   - S5 : la facture en euros, sa contre-valeur en millimes (2 350,00 € × 3,3812 = 7 945,820) ;
//   - S6 : le mois vide, son geste, et la grille dessous ; S4 : le même numéro dans le même journal, dit pendant la frappe.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const LE_28 = new Date('2026-10-28T10:00:00+01:00');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const net = (t: string) => t.replace(/[\u202f\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();

describe('la Saisie du Cabinet face à la pièce, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-saisie-piece-'));
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
  const personne = async (nom: string) => {
    const email = `${(nom.split(' ')[0] ?? '').normalize('NFD').replace(/[^a-z]/gi, '')}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await api('POST', '/inscription', undefined, { email, nom, motDePasse: 'Un-bon-mot-de-passe' });
    const jeton = String((await api('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    await api('POST', '/moi/code', jeton, { methode: 'application' });
    return { jeton, email };
  };
  type Ecriture = { id: string; journal: string; piece: string; date: string; statut: string; lignes: { compte: string; debit: string; credit: string; tiers?: string }[] };

  // La boulangerie de Sarra : ses achats de septembre saisis dans SkanFact (l'électricité sans justificatif), ses pièces
  // envoyées au cabinet, ce que SkanFact y a lu, et le relevé BIAT de septembre.
  async function laBoulangerie() {
    const { jeton: associe, email: courriel } = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const { jeton: sarra } = await personne('Sarra Ben Salah');
    const ent = String((await api('POST', '/entreprises', sarra, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, associe, { contenu: { contact: 'Sarra', from: '2026-09' }, revision: null })).statut).toBeLessThan(300);
    await api('GET', `/entreprises/${ent}/dossier-v10`, sarra);
    const achat = (id: string, fournisseur: string, numero: string, date: string, label: string, prix: string, tva: number, justifie: boolean) => ({
      collection: 'purchases', cle: id, rang: 1, revision: null, contenu: { id, kind: 'facture', number: numero, date, supplierId: fournisseur, currency: 'DT', category: 'Matières premières',
        fees: 0, withholdingRate: 0, createdAt: 1, attachments: justifie ? [] : [], lines: [{ id: `${id}-l`, label, qty: 1, unitPrice: { '~n': prix }, vatRate: tva, destination: 'charge' }] } });
    expect((await api('POST', `/entreprises/${ent}/dossier-v10`, sarra, { changements: [
      ...[['s-min', 'Minoterie du Cap Bon'], ['s-lev', 'Levures du Sahel'], ['s-steg', 'STEG']].map(([id, name], rang) => ({ collection: 'suppliers', cle: id, rang, revision: null, contenu: { id, name } })),
      // Deux factures de farine d'avant : la charge habituelle de la Minoterie.
      achat('p-0701', 's-min', 'FA-0701', '2026-07-03', 'Farine T55', '1200.000', 19, true),
      achat('p-0801', 's-min', 'FA-0801', '2026-08-03', 'Farine T55', '1300.000', 19, true),
      achat('p-0914', 's-min', 'FA-0914', '2026-09-03', 'Farine T55, 40 sacs', '1551.428', 19, true),
      achat('p-0913', 's-lev', 'FA-0913', '2026-09-10', 'Levure fraîche', '380.340', 7, true),
      achat('p-0919', 's-steg', 'FA-0919', '2026-09-30', 'Électricité et gaz', '164.973', 13, false),
    ] })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/compta/releves`, associe, { annee: 2026, compte: '532', banque: 'BIAT', fichier: 'septembre.csv', empreinte: 'c'.repeat(64),
      soldeDebut: '0', soldeFin: '-85,000', lignes: [{ date: '2026-09-24', libelle: 'CARTE TOTAL ENNASR 24/09', reference: '', montant: '-85,000' }] })).statut).toBe(201);
    const envoyer = async (nom: string) => {
      const f = await api('POST', `/entreprises/${ent}/messages/fichiers`, sarra, { cote: 'entreprise', nom, contenu: PNG });
      const m = await api('POST', `/entreprises/${ent}/messages`, sarra, { cote: 'entreprise', texte: '', fichier: f.corps.id });
      expect(m.statut).toBe(201);
      return String(m.corps.id);
    };
    const ticket = await envoyer('ticket-carburant-24-09.png');
    const steg = await envoyer('facture-electricite-septembre.png');
    const farine = await envoyer('facture-farine-0903.png');
    const levure = await envoyer('facture-levure.png');
    const matfer = await envoyer('Matfer-FR-26-118842.png');
    // Sarra range elle-même la farine et la levure dans leurs achats : elles sont « à vérifier ».
    expect((await api('POST', `/entreprises/${ent}/messages/${farine}/achat`, sarra, { achat: 'p-0914', libelle: 'FA-0914 · Minoterie du Cap Bon' })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/messages/${levure}/achat`, sarra, { achat: 'p-0913', libelle: 'FA-0913 · Levures du Sahel' })).statut).toBe(200);
    // Ce que SkanFact a lu (le test ne paie pas l'appel au service de lecture).
    const admin = new pg.Client({ connectionString: inject('pgAdmin') });
    await admin.connect();
    try {
      const lire = (m: string, f: string, n: string | null, d: string, t: string, dv: string) => admin.query(`insert into cabinet.lecture (cabinet, entreprise, message, fournisseur, numero, date_piece, total, devise, lu_par)
        values ($1, $2, $3, $4, $5, $6, $7, $8, (select id from socle.utilisateur where lower(email) = lower($9)))`, [cab.id, ent, m, f, n, d, t, dv, courriel]);
      await lire(ticket, 'Total Ennasr', null, '2026-09-24', '85.000', 'TND');
      await lire(farine, 'Minoterie du Cap Bon', 'F-2026-0903', '2026-09-03', '1846.199', 'TND');
      // La levure : facturée le 29/08, saisie au 10/09 par Sarra.
      await lire(levure, 'Levures du Sahel', 'LS-7702', '2026-08-29', '406.964', 'TND');
      await lire(matfer, 'Matfer Bourgeat', 'FR-26-118842', '2026-09-20', '2350.00', 'EUR');
    } finally { await admin.end(); }
    return { associe, cab, ent, sarra, ticket, steg, farine, levure, matfer };
  }
  async function ouvrir(jeton: string, cabinet: string, ent: string, tel = false) {
    const cx = await navigateur.newContext({ viewport: tel ? { width: 390, height: 844 } : { width: 1440, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', ...(tel ? { isMobile: true, hasTouch: true } : {}) });
    await cx.clock.setFixedTime(LE_28);
    const p = await cx.newPage();
    const erreurs: string[] = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript((j) => { if (location.protocol.startsWith('http') && !sessionStorage.getItem('skanfact.jeton')) sessionStorage.setItem('skanfact.jeton', j); }, jeton);
    await p.goto(`${serveur.adresse}/v10/cabinet/?c=${cabinet}#/dossier/${ent}/comptabilite/saisie/2026`);
    await p.locator('[data-cp-mois="2026-09"]').waitFor({ timeout: 25_000 });
    for (let i = 0; i < 3 && await p.getByRole('button', { name: 'Plus tard', exact: true }).count(); i++) await p.getByRole('button', { name: 'Plus tard', exact: true }).first().click();
    await p.locator('[data-cp-mois="2026-09"]').click();
    await p.locator('#sx-rang').waitFor({ timeout: 20_000 });
    return { p, erreurs };
  }
  const puce = (p: Page, texte: string) => p.locator('[data-sx-k]').filter({ hasText: texte });
  const fiche = (p: Page) => p.locator('#sx-fiche');

  it('septembre, pièce par pièce : vérifier, saisir payée par carte, joindre, le mauvais mois, les euros, le mois vide', async () => {
    const { associe, cab, ent, ticket, steg, farine } = await laBoulangerie();
    const { p, erreurs } = await ouvrir(associe, cab.id, ent);
    // La bande : cinq pièces, chacune dit ce qu'elle demande.
    expect(await p.locator('#sx-rang').innerText()).toBe('Pièce 1 sur 5');
    const titres = (await p.locator('[data-sx-k]').evaluateAll((l) => l.map((b) => b.getAttribute('title') ?? ''))).sort();
    expect(titres).toEqual(['Levures du Sahel · à reclasser', 'Matfer Bourgeat · en devises', 'Minoterie du Cap Bon · à vérifier', 'Total Ennasr · à saisir', 'facture-electricite-septembre.png · déjà saisie ?'].sort());
    // La grille est là, cachée : « Au kilomètre » la montre.
    expect(await p.locator('.sx-km').isHidden()).toBe(true);

    // S1 : la farine, saisie par Sarra. Ses contrôles, et la charge « comme ses 2 factures d'avant ».
    await puce(p, 'Minoterie').click();
    await expect.poll(() => fiche(p).innerText().then(net)).toMatch(/Sarra l'a saisie elle-même/);
    const ck = net(await p.locator('#sx-fiche .sx-ck').innerText());
    expect(ck).toMatch(/Le fournisseur et son compte Minoterie du Cap Bon · 401/);
    expect(ck).toMatch(/La charge, comme ses 2 factures d'avant/);
    expect(ck).toMatch(/Le total lu = le total écrit 1 846,199 DT/);
    expect(ck).toMatch(/Le numéro F-2026-0903 n'est saisi qu'une fois/);
    await p.screenshot({ path: path.join(PHOTOS, 'saisie-piece-verifier.png') });
    // « Ne plus me faire vérifier » : un réglage de la fiche du dossier, gardé au serveur.
    await p.locator('#sx-conf-oui').click();
    await expect.poll(async () => ((await api('GET', `/cabinets/${cab.id}/fiches`, associe)).corps.fiches as { entreprise: string; contenu: { sansVerifier?: string[] } }[])
      .find((f) => f.entreprise === ent)?.contenu.sansVerifier).toEqual(['Minoterie du Cap Bon']);
    await expect.poll(() => puce(p, 'Minoterie').getAttribute('title')).toBe('Minoterie du Cap Bon · de confiance');
    await puce(p, 'Minoterie').click();
    await p.locator('#sx-verifiee').click();
    const raison = async (m: string) => {
      const admin = new pg.Client({ connectionString: inject('pgAdmin') });
      await admin.connect();
      try { return (await admin.query('select classee_raison r, jointe_ecriture j from messagerie.message where id = $1', [m])).rows[0] as { r: string | null; j: string | null }; } finally { await admin.end(); }
    };
    await expect.poll(async () => (await raison(farine)).r, { timeout: 10_000 }).toBe('verifiee');
    await expect.poll(() => p.locator('#sx-rang').innerText()).toMatch(/sur 4$/);

    // S3 : le ticket lu. Fournisseur, date et total « lus » ; sans TVA (un ticket) ; payé par carte le 24/09.
    await puce(p, 'Total Ennasr').click();
    await expect.poll(() => p.locator('#sx-four').inputValue()).toBe('Total Ennasr');
    expect(await p.locator('#sx-date').inputValue()).toBe('24/09/2026');
    expect(net(await p.locator('#sx-ttc').inputValue())).toBe('85,000');
    expect(await p.locator('#sx-tva').inputValue()).toBe('sans');
    expect(net(await fiche(p).innerText())).toMatch(/Payée par carte le 24\/09 « CARTE TOTAL ENNASR 24\/09 85,000 » est sur le relevé BIAT/);
    // Sans compte, le refus nomme le champ et y met le curseur.
    await p.locator('#sx-ok').click();
    expect(await p.locator('#sx-refus').innerText()).toBe('Le compte de la charge manque : son numéro (6061, 6066…).');
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('sx-compte');
    await p.locator('#sx-compte').fill('6066');
    await p.locator('#sx-compte').press('Escape');
    expect(net(await p.locator('#sx-ec-l').innerText())).toMatch(/^6066 .* 85,000 401 Total Ennasr 85,000 401 Règlement du 24\/09 · rapproché 85,000 532 BIAT 85,000$/);
    await p.screenshot({ path: path.join(PHOTOS, 'saisie-piece-ticket.png') });
    await p.locator('#sx-four').focus();
    await p.keyboard.press('Enter');
    await expect.poll(() => p.locator('#toast').innerText().then(net), { timeout: 15_000 }).toBe('Total Ennasr · 85,000 DT : au brouillard, la pièce jointe, son règlement du 24/09 rapproché.');
    const ecritures = (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, associe)).corps.ecritures as Ecriture[];
    const ac = ecritures.find((e) => e.journal === 'AC' && e.lignes.some((l) => l.compte === '6066'));
    expect(ac?.lignes.map((l) => [l.compte, l.debit, l.credit, l.tiers ?? ''])).toEqual([['6066', '85.000', '0.000', ''], ['401', '0.000', '85.000', 'Total Ennasr']]);
    const bq = ecritures.find((e) => e.journal === 'BQ' && e.date === '2026-09-24');
    expect(bq?.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual([['401', '85.000', '0.000'], ['532', '0.000', '85.000']]);
    expect((await raison(ticket)).j).toBe(ac?.id);
    const R = (await api('GET', `/entreprises/${ent}/compta/releves?annee=2026`, associe)).corps.releves as { lignes: { rapprochement: { ecriture: string } | null }[] }[];
    expect(R[0]?.lignes[0]?.rapprochement?.ecriture).toBeTruthy();

    // La photo STEG : FA-0919 l'attend (sans justificatif) ; « Joindre à FA-0919 ».
    await puce(p, 'STEG').click();
    await expect.poll(() => fiche(p).innerText().then(net)).toMatch(/Peut-être déjà au livre : FA-0919, sans justificatif/);
    expect(net(await p.locator('.sx-cmp').innerText())).toMatch(/Total TTC à lire sur la pièce 186,419/);
    await p.locator('#sx-joindre').click();
    const fa0919 = ecritures.find((e) => e.piece === 'FA-0919');
    await expect.poll(async () => (await raison(steg)).j, { timeout: 10_000 }).toBe(fa0919?.id);

    // S2 : la levure, facturée le 29/08 et saisie au 10/09. L'effet sur la TVA des deux mois, avant le geste.
    await puce(p, 'Levures').click();
    await expect.poll(() => fiche(p).innerText().then(net)).toMatch(/La facture est du 29\/08, l'écriture du 10\/09/);
    const mv = net(await p.locator('.sx-mv').innerText());
    expect(mv).toMatch(/^Septembre TVA déductible ([\d ]+,\d{3}) → ([\d ]+,\d{3}) .* Août TVA déductible ([\d ]+,\d{3}) → ([\d ]+,\d{3})/);
    const [, s1, s2, a1, a2] = mv.match(/^Septembre TVA déductible ([\d ]+,\d{3}) → ([\d ]+,\d{3}) .* Août TVA déductible ([\d ]+,\d{3}) → ([\d ]+,\d{3})/) ?? [];
    const millimes = (t?: string) => Math.round(Number(String(t).replace(/ /g, '').replace(',', '.')) * 1000);
    // La TVA de la levure (380,340 à 7 % : 26,624) quitte septembre et arrive en août, au millime.
    expect(millimes(s1) - millimes(s2)).toBe(26_624);
    expect(millimes(a2) - millimes(a1)).toBe(26_624);
    expect(net(await fiche(p).innerText())).toMatch(/FA-0913 suit l'achat de Sarra elle ne se change pas dans les livres/);
    await p.screenshot({ path: path.join(PHOTOS, 'saisie-piece-mois.png') });
    await p.locator('#sx-demander-date').click();
    await expect.poll(() => p.locator('#modal-root textarea').inputValue().catch(() => '')).toMatch(/^Bonjour Sarra, ton achat FA-0913 \(Levures du Sahel, 406,964 DT\) est daté du 10\/09, mais la facture est du 29\/08\./);
    await p.keyboard.press('Escape');

    // S5 : la facture en euros. Le taux tapé, la contre-valeur en millimes, l'écriture sans TVA (payée à la douane).
    await puce(p, 'Matfer').click();
    await expect.poll(() => fiche(p).innerText().then(net)).toMatch(/Matfer Bourgeat · facture en euros/);
    expect(net(await p.locator('#sx-mdev-v').innerText())).toBe('2 350,00 EUR');
    await p.locator('#sx-taux').fill('3,3812');
    expect(net(await p.locator('#sx-cv').innerText())).toBe('7 945,820 DT');
    await p.locator('#sx-compte').fill('6063');
    await p.locator('#sx-compte').press('Escape');
    expect(net(await p.locator('#sx-ec-l').innerText())).toMatch(/^6063 .* 7 945,820 401 Matfer Bourgeat 7 945,820$/);
    await p.screenshot({ path: path.join(PHOTOS, 'saisie-piece-euros.png') });

    // S4 : au kilomètre, le même numéro dans le même journal se dit pendant la frappe.
    await p.locator('[data-sx-mode="km"]').click();
    await p.locator('#sa-piece').waitFor();
    expect(await p.locator('#sa-journal').inputValue()).toBe('AC');
    await p.locator('#sa-piece').fill('FA-0919');
    expect(net(await p.locator('#sa-double').innerText())).toMatch(/^Déjà au livre : AC FA-0919 du 30\/09\/2026/);
    await p.locator('#sa-piece').fill('FA-0999');
    expect(await p.locator('#sa-double').isHidden()).toBe(true);

    // S6 : octobre n'a rien reçu. La phrase, le geste, et la grille dessous.
    await p.locator('[data-cp-mois="2026-10"]').click();
    await expect.poll(() => p.locator('#sx-vide').innerText().then(net).catch(() => '')).toMatch(/^Octobre : aucune pièce à saisir pour l'instant/);
    expect(await p.locator('#sx-demander-mois').innerText()).toBe('Demander les pièces d\'octobre à Sarra');
    expect(await p.locator('#sa-lignes').isVisible()).toBe(true);
    expect(erreurs).toEqual([]);
  }, 240_000);

  it('au téléphone : la pièce puis sa fiche, sur toute la largeur, sans rien qui déborde', async () => {
    const { associe, cab, ent } = await laBoulangerie();
    const { p, erreurs } = await ouvrir(associe, cab.id, ent, true);
    await puce(p, 'Total Ennasr').evaluate((b: HTMLElement) => b.click());
    await expect.poll(() => p.locator('#sx-four').inputValue()).toBe('Total Ennasr');
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const [dv, fi] = await Promise.all([p.locator('.sx-dv').boundingBox(), p.locator('#sx-fiche').boundingBox()]);
    expect((fi?.y ?? 0)).toBeGreaterThan((dv?.y ?? 0) + (dv?.height ?? 0) - 1);
    for (const b of await p.locator('#sx-fiche .sx-gestes .btn').all()) expect((await b.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await p.locator('#sx-fiche').scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(PHOTOS, 'saisie-piece-tel.png') });
    expect(erreurs).toEqual([]);
  }, 180_000);
});
