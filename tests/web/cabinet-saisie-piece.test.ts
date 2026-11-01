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
// Puis, le 31/10/2026 (1.211.0, lot S7 « la fiche finie ») :
//   - la direction : « Enregistrer et valider » (l'achat et son règlement validés du même geste) ; « Au brouillard » à côté ;
//   - la photo illisible reste dans la bande, redemandée, avec « Relancer Sarra » ;
//   - « Joindre » dit la TVA justifiée et ce qui attend ; le mauvais mois dit la TVA à payer des deux mois et le dépôt ;
//   - le libellé en euros mis en forme ; un collaborateur en saisie (Rim) : « Leïla valide le brouillard », « Leïla la vérifie ».

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { AppelIA, ReponseIA } from '../../serveur/achats/lecture-ia.ts';
import { demarrer, lireConfiguration } from '../../serveur/principal.ts';
import { pdfTelecharge } from '../pdf-telecharge.ts';

const RACINE = path.join(import.meta.dirname, '../..');
const PHOTOS = path.join(RACINE, 'dist/photos');
const LE_28 = new Date('2026-10-28T10:00:00+01:00');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const net = (t: string) => t.replace(/[\u202f\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
// (1.211.0) Ce que l'IA « lit » sur la photo qu'on croyait illisible (le test ne paie pas l'appel : une réponse écrite ici).
const EL_AMEN: ReponseIA = {
  estUneFacture: true, fournisseur: 'Fournitures El Amen', matricules: [], numero: 'FA-0921', date: '2026-09-22', echeance: null, objet: null, devise: 'TND',
  lignes: [{ designation: 'Fournitures diverses', quantite: '1', prixUnitaire: '92.300', remise: null, tauxTva: '0', totalHT: '92.300' }],
  totalHT: '92.300', totalTVA: '0', timbre: null, fodec: null, retenue: null, totalTTC: '92.300', netAPayer: '92.300', ou: [], doutes: [],
};
const ia: AppelIA = async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(EL_AMEN) }] });

describe('la Saisie du Cabinet face à la pièce, à la souris', () => {
  let navigateur: Browser;
  let serveur: Awaited<ReturnType<typeof demarrer>>;
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'web-saisie-piece-'));
  beforeAll(async () => {
    await build({ configFile: path.join(RACINE, 'web/vite.config.ts'), logLevel: 'silent', build: { outDir: dossier, emptyOutDir: true } });
    serveur = await demarrer({ ...lireConfiguration({ SKANFACT_BASE: inject('pgApp'), SKANFACT_ENVIRONNEMENT: 'test' }), port: 0, web: dossier, livreurMs: 60_000 }, { ia });
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
  async function laBoulangerie(avecRim = false) {
    const { jeton: associe, email: courriel } = await personne('Leïla Jlassi');
    const cab = (await api('POST', '/cabinets', associe, { nom: 'Jlassi Conseil' })).corps as { id: string; code: string };
    const { jeton: sarra } = await personne('Sarra Ben Salah');
    const ent = String((await api('POST', '/entreprises', sarra, { raisonSociale: 'Boulangerie El Amal' })).corps.id);
    const mandat = String((await api('POST', `/entreprises/${ent}/mandat`, sarra, { codeCabinet: cab.code })).corps.mandat);
    expect((await api('POST', `/cabinets/${cab.id}/mandats/${mandat}/accepter`, associe)).statut).toBe(200);
    expect((await api('PUT', `/cabinets/${cab.id}/fiches/${ent}`, associe, { contenu: { contact: 'Sarra', from: '2026-09' }, revision: null })).statut).toBeLessThan(300);
    // Rim, en saisie sur ce dossier : elle saisit, la direction valide.
    let rim = '';
    if (avecRim) {
      const r = await personne('Rim Toumi');
      const inv = await api('POST', `/cabinets/${cab.id}/invitations`, associe, { email: r.email, role: 'saisie' });
      expect((await api('POST', '/invitations/accepter', r.jeton, { jeton: inv.corps.jeton })).statut).toBeLessThan(300);
      const membres = (await api('GET', `/cabinets/${cab.id}/equipe`, associe)).corps.membres as { membre: string; nom: string }[];
      const id = membres.find((m) => m.nom === 'Rim Toumi')?.membre ?? '';
      expect((await api('PUT', `/cabinets/${cab.id}/mandats/${mandat}/affectations/${id}`, associe, { role: 'saisie' })).statut).toBeLessThan(300);
      rim = r.jeton;
    }
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
    // Une photo illisible, redemandée à Sarra : elle reste dans la bande du mois.
    const floue = await envoyer('IMG_8790.png');
    expect((await api('POST', `/entreprises/${ent}/messages/${floue}/classee`, associe, { classee: true, raison: 'illisible', note: 'Peux-tu la reprendre ?' })).statut).toBeLessThan(300);
    // Sarra range elle-même la farine et la levure dans leurs achats : elles sont « à vérifier ».
    expect((await api('POST', `/entreprises/${ent}/messages/${farine}/achat`, sarra, { achat: 'p-0914', libelle: 'FA-0914 · Minoterie du Cap Bon' })).statut).toBe(200);
    expect((await api('POST', `/entreprises/${ent}/messages/${levure}/achat`, sarra, { achat: 'p-0913', libelle: 'FA-0913 · Levures du Sahel' })).statut).toBe(200);
    // Ce que SkanFact a lu (le test ne paie pas l'appel au service de lecture).
    const admin = new pg.Client({ connectionString: inject('pgAdmin') });
    await admin.connect();
    try {
      const lire = (m: string, f: string, n: string | null, d: string, t: string, dv: string) => admin.query(`insert into cabinet.lecture (cabinet, entreprise, message, fournisseur, numero, date_piece, total, devise, lu_par)
        values ($1, $2, $3, $4, $5, $6, $7, $8, (select id from socle.utilisateur where lower(email) = lower($9)))`, [cab.id, ent, m, f, n, d, t, dv, courriel]);
      // Les pièces arrivent la veille du jour de l'essai (le 27/10, fixe) : le mois où elles tombent ne dépend pas de
      // l'heure à laquelle l'essai tourne (le 01/11 à Tunis, elles tombaient en octobre).
      await admin.query(`update messagerie.message set ecrit_le = '2026-10-27T18:12:00+01:00' where entreprise = $1`, [ent]);
      await lire(ticket, 'Total Ennasr', null, '2026-09-24', '85.000', 'TND');
      await lire(farine, 'Minoterie du Cap Bon', 'F-2026-0903', '2026-09-03', '1846.199', 'TND');
      // La levure : facturée le 29/08, saisie au 10/09 par Sarra.
      await lire(levure, 'Levures du Sahel', 'LS-7702', '2026-08-29', '406.964', 'TND');
      await lire(matfer, 'Matfer Bourgeat', 'FR-26-118842', '2026-09-20', '2350.00', 'EUR');
    } finally { await admin.end(); }
    return { associe, cab, ent, sarra, ticket, steg, farine, levure, matfer, floue, rim };
  }
  async function ouvrir(jeton: string, cabinet: string, ent: string, tel = false, largeur = 1440) {
    const cx = await navigateur.newContext({ viewport: tel ? { width: 390, height: 844 } : { width: largeur, height: 900 }, locale: 'fr-FR', timezoneId: 'Africa/Tunis', ...(tel ? { isMobile: true, hasTouch: true } : {}) });
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
    // La bande : six pièces, chacune dit ce qu'elle demande (la photo illisible comprise).
    expect(await p.locator('#sx-rang').innerText()).toBe('Pièce 1 sur 6');
    const titres = (await p.locator('[data-sx-k]').evaluateAll((l) => l.map((b) => b.getAttribute('title') ?? ''))).sort();
    expect(titres).toEqual(['IMG_8790.png · illisible', 'Levures du Sahel · à reclasser', 'Matfer Bourgeat · en devises', 'Minoterie du Cap Bon · à vérifier', 'Total Ennasr · à saisir', 'facture-electricite-septembre.png · déjà saisie ?'].sort());
    // (S7) La photo illisible : redemandée, « Relancer Sarra » ; rien ne s'en saisit.
    await puce(p, 'IMG_8790').click();
    await expect.poll(() => fiche(p).innerText().then(net)).toMatch(/Redemandée à Sarra Marquée illisible par .* et redemandée à Sarra le \d\d\/\d\d\. Rien ne s'en saisit/);
    expect(await p.locator('#sx-relancer').innerText()).toMatch(/^Relancer Sarra/);
    await p.locator('#sx-relancer').click();
    await expect.poll(() => p.locator('#pc-redem').inputValue().catch(() => '')).toMatch(/^Bonjour Sarra, la pièce « IMG_8790\.png »/);
    await p.locator('#pc-redem-non').click();
    // « Elle se lit : la saisir » : pas encore lue, la fiche propose « Lire la pièce » ; lue, elle repart de ce qu'elle dit.
    await p.locator('#sx-lisible').click();
    await expect.poll(() => p.locator('#sx-lire').innerText().catch(() => '')).toBe('Lire la pièce');
    // (1.215.0) Une fiche déjà touchée prend quand même ce que l'IA a lu (avant, la lecture ne se voyait nulle part).
    await p.locator('#sx-four').fill('Un fournisseur tapé avant');
    await p.locator('#sx-lire').click();
    await p.locator('#modal-root #ok').click();
    await expect.poll(() => p.locator('#sx-four').inputValue().catch(() => ''), { timeout: 15_000 }).toBe('Fournitures El Amen');
    expect(net(await p.locator('#sx-ttc').inputValue())).toBe('92,300');
    expect(await p.locator('#sx-date').inputValue()).toBe('22/09/2026');
    // La grille est là, cachée : « Au kilomètre » la montre (1.211.0 : aussi après un geste qui relit les pièces).
    await expect.poll(() => p.locator('.sx-km').isHidden()).toBe(true);

    // S1 : la farine, saisie par Sarra. Ses contrôles, et la charge « comme ses 2 factures d'avant ».
    await puce(p, 'Minoterie').click();
    await expect.poll(() => fiche(p).innerText().then(net)).toMatch(/Sarra l'a saisie elle-même/);
    const ck = net(await p.locator('#sx-fiche .sx-ck').innerText());
    expect(ck).toMatch(/Le fournisseur et son compte Minoterie du Cap Bon · 401/);
    expect(ck).toMatch(/La charge, comme ses 2 factures d'avant/);
    expect(ck).toMatch(/Le total lu = le total écrit 1 846,199 DT/);
    expect(ck).toMatch(/Le numéro F-2026-0903 n'est saisi qu'une fois/);
    await p.screenshot({ path: path.join(PHOTOS, 'saisie-piece-verifier.png') });
    // (S7) « Corriger… » : l'achat de Sarra suit sa pièce ; la demande nomme ce qui reste à regarder, Sarra corrige, l'écriture suit.
    await p.locator('#sx-corriger').click();
    await expect.poll(() => p.locator('#modal-root textarea').first().inputValue().then(net).catch(() => '')).toMatch(/^Bonjour Sarra, sur ton achat FA-0914 \(Minoterie du Cap Bon, 1 846,199 DT, du 03\/09\) : .+Peux-tu le corriger dans SkanFact \? L'écriture suivra\.$/);
    await p.keyboard.press('Escape');
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
    await expect.poll(() => p.locator('#sx-rang').innerText()).toMatch(/sur 5$/);

    // S3 : le ticket lu. Fournisseur, date et total « lus » ; sans TVA (un ticket) ; payé par carte le 24/09.
    await puce(p, 'Total Ennasr').click();
    await expect.poll(() => p.locator('#sx-four').inputValue()).toBe('Total Ennasr');
    expect(await p.locator('#sx-date').inputValue()).toBe('24/09/2026');
    expect(net(await p.locator('#sx-ttc').inputValue())).toBe('85,000');
    expect(await p.locator('#sx-tva').inputValue()).toBe('sans');
    expect(net(await fiche(p).innerText())).toMatch(/Payée par carte le 24\/09 « CARTE TOTAL ENNASR 24\/09 85,000 » est sur le relevé BIAT/);
    // La direction valide du même geste ; « Au brouillard » reste à côté. Sans compte, le refus nomme le champ et y met le curseur.
    expect(await p.locator('#sx-ok-valider').innerText()).toMatch(/^Enregistrer et valider/);
    expect(await p.locator('#sx-ok').innerText()).toBe('Au brouillard');
    expect(await p.locator('#sx-qui-valide').count()).toBe(0);
    await p.locator('#sx-ok').click();
    expect(await p.locator('#sx-refus').innerText()).toBe('Le compte de la charge manque : son numéro (6061, 6066…).');
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('sx-compte');
    await p.locator('#sx-compte').fill('6066');
    await p.locator('#sx-compte').press('Escape');
    expect(net(await p.locator('#sx-ec-l').innerText())).toMatch(/^6066 .* 85,000 401 Total Ennasr 85,000 401 Règlement du 24\/09 · rapproché 85,000 532 BIAT 85,000$/);
    await p.screenshot({ path: path.join(PHOTOS, 'saisie-piece-ticket.png') });
    await p.locator('#sx-four').focus();
    await p.keyboard.press('Enter');
    await expect.poll(() => p.locator('#toast').innerText().then(net), { timeout: 15_000 }).toBe('Total Ennasr · 85,000 DT : validée, la pièce jointe, son règlement du 24/09 rapproché.');
    const ecritures = (await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, associe)).corps.ecritures as Ecriture[];
    const ac = ecritures.find((e) => e.journal === 'AC' && e.lignes.some((l) => l.compte === '6066'));
    expect(ac?.lignes.map((l) => [l.compte, l.debit, l.credit, l.tiers ?? ''])).toEqual([['6066', '85.000', '0.000', ''], ['401', '0.000', '85.000', 'Total Ennasr']]);
    const bq = ecritures.find((e) => e.journal === 'BQ' && e.date === '2026-09-24');
    expect(bq?.lignes.map((l) => [l.compte, l.debit, l.credit])).toEqual([['401', '85.000', '0.000'], ['532', '0.000', '85.000']]);
    // (S7) L'achat et son règlement : validés tous les deux.
    expect([ac?.statut, bq?.statut]).toEqual(['validee', 'validee']);
    expect((await raison(ticket)).j).toBe(ac?.id);
    const R = (await api('GET', `/entreprises/${ent}/compta/releves?annee=2026`, associe)).corps.releves as { lignes: { rapprochement: { ecriture: string } | null }[] }[];
    expect(R[0]?.lignes[0]?.rapprochement?.ecriture).toBeTruthy();

    // La photo STEG : FA-0919 l'attend (sans justificatif) ; « Joindre à FA-0919 ».
    await puce(p, 'STEG').click();
    await expect.poll(() => fiche(p).innerText().then(net)).toMatch(/Peut-être déjà au livre : FA-0919, sans justificatif/);
    // (1.216.0) La photo n'est pas lue : pas de colonne « à lire sur la pièce » répétée, la fiche le dit une fois.
    expect(net(await p.locator('.sx-cmp').innerText())).toMatch(/Total TTC 186,419/);
    expect(net(await fiche(p).innerText())).toContain('La pièce n\'est pas encore lue');
    await p.locator('#sx-joindre').click();
    const fa0919 = ecritures.find((e) => e.piece === 'FA-0919');
    await expect.poll(async () => (await raison(steg)).j, { timeout: 10_000 }).toBe(fa0919?.id);
    // (S7) Le message dit la TVA que la pièce justifie (164,973 à 13 % : 21,446) et ce qui attend encore.
    await expect.poll(() => p.locator('#toast').innerText().then(net)).toMatch(/^La photo est jointe à FA-0919 · 21,446 DT de TVA justifiée · 3 pièces attendent\./);

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
    // (S7) La TVA à payer des deux mois bouge du même montant ; le dépôt d'août est dit (passé le 28/09, À VÉRIFIER).
    const aPayer = async (id: string) => (net(await p.locator(id).innerText()).match(/TVA à payer (?:crédit )?([\d ]+,\d{3}) → (?:crédit )?([\d ]+,\d{3})/) ?? []).slice(1);
    const [pe1, pe2] = await aPayer('#sx-mv-payer-e'), [pp1, pp2] = await aPayer('#sx-mv-payer-p');
    expect(Math.abs(millimes(pe2) - millimes(pe1))).toBe(26_624);
    expect(Math.abs(millimes(pp1) - millimes(pp2))).toBe(26_624);
    expect(net(await p.locator('#sx-mv-depot').innerText())).toBe('Août devait se déposer le 28/09');
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
    // (S7) Au brouillard : le libellé dit le montant en euros mis en forme et le taux.
    await p.locator('#sx-ok').click();
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, associe)).corps.ecritures as (Ecriture & { libelle: string })[])
      .find((e) => e.lignes.some((l) => l.compte === '6063'))?.libelle, { timeout: 15_000 }).toBe('Matfer Bourgeat · FR-26-118842 · 2 350,00 EUR à 3,3812');

    // (S8) Le brouillard de septembre : ce mois seul, qui l'a saisie, et la fenêtre de validation qui liste et vérifie avant.
    await expect.poll(() => p.locator('#sa-brouillard').innerText().then(net)).toMatch(/^Le brouillard de septembre/);
    expect(await p.locator('.sx-bl-t + * th, table.list th').filter({ hasText: /^Par$/ }).count()).toBeGreaterThan(0);
    expect(net(await p.locator('tr.br-ligne').filter({ hasText: 'Matfer' }).innerText())).toMatch(/le cabinet/);
    await p.locator('.sx-bl-t [data-lot-mois]').click();
    const lot = p.locator('#modal-root .modal').last();
    await expect.poll(() => lot.locator('#lot-liste tr').count()).toBeGreaterThan(0);
    expect(net(await lot.locator('#lot-liste').innerText())).toMatch(/Matfer Bourgeat · FR-26-118842 · 2 350,00 EUR à 3,3812 7 945,820/);
    expect(net(await lot.locator('#lot-verif').innerText())).toMatch(/^(Toutes sont équilibrées ; aucune ne tombe sur un mois déposé\.|Elle est équilibrée et ne tombe pas sur un mois déposé\.)$/);
    expect(await lot.getByRole('button', { name: /^Valider (l'écriture|les \d+ écritures)$/ }).count()).toBe(1);
    await lot.getByRole('button', { name: 'Annuler', exact: true }).click();

    // (S9) « Au kilomètre », le journal du mois : une pièce par ligne, sa charge et sa TVA dessous, le justificatif ; la ligne
    // en cours : le fournisseur et le TTC suffisent, la charge et la TVA reprennent sa dernière pièce.
    await p.locator('[data-sx-mode="km"]').click();
    await p.locator('#sx-jm').waitFor();
    expect(net(await p.locator('#sx-jm .sx-jm-l').innerText())).toMatch(/30 FA-0919 401 STEG 186,419 606 .* 164,973 4366 TVA déductible 13 % 21,446/);
    // (1.215.0, la maquette) Débit et crédit, la pièce de la ligne à droite, la grille au clavier derrière « Une écriture à la main ».
    expect(await p.locator('.sx-jm-g #sx-km-d').count()).toBe(1);
    expect(await p.locator('.sx-km').isHidden()).toBe(true);
    // FA-0919 a reçu la photo STEG plus haut : elle porte son justificatif.
    expect(await p.locator('tr.sx-jm-e', { hasText: 'FA-0919' }).locator('.sx-jm-j').count()).toBe(1);
    expect(await p.locator('#sx-jm-refus').isHidden()).toBe(true);
    await p.locator('#sx-jm-jour').fill('26');
    await p.locator('#sx-jm-four').fill('Total Ennasr');
    await p.locator('#sx-jm-ttc').fill('70,000');
    await expect.poll(() => p.locator('#sx-jm-prop').innerText().then(net)).toMatch(/^6066 .* 70,000 · sans TVA · 401 70,000/);
    await p.locator('#sx-jm-ttc').press('Enter');
    await expect.poll(() => p.locator('#toast').innerText().then(net), { timeout: 15_000 }).toBe('Total Ennasr · 70,000 DT : au brouillard.');
    await expect.poll(async () => ((await api('GET', `/entreprises/${ent}/compta/ecritures?limite=500`, associe)).corps.ecritures as Ecriture[])
      .find((e) => e.date === '2026-09-26')?.lignes.map((l) => [l.compte, l.debit, l.credit]), { timeout: 15_000 }).toEqual([['6066', '70.000', '0.000'], ['401', '0.000', '70.000']]);
    await expect.poll(() => p.evaluate(() => document.activeElement?.id)).toBe('sx-jm-four');
    expect(net(await p.locator('#sx-jm-bilan').innerText())).toMatch(/pièces · débit = crédit$/);
    // Un fournisseur sans pièce d'avant : rien ne s'invente, la grille le prend.
    await p.locator('#sx-jm-four').fill('Emballages du Sahel');
    await p.locator('#sx-jm-ttc').fill('50,000');
    await expect.poll(() => p.locator('#sx-jm-refus').innerText().then(net).catch(() => '')).toBe('Emballages du Sahel n\'a pas de pièce d\'avant : rien ne se propose. « Ouvrir en lignes » la saisit dans la grille.');
    await p.locator('#sx-jm-lignes').click();
    await expect.poll(() => p.locator('#sa-libelle').inputValue()).toBe('Emballages du Sahel');
    await p.locator('#sa-libelle').fill('');

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
    // (S8) Sous le mois vide : le mois d'avant, et ce qui arrive seul.
    expect(net(await p.locator('#sx-vide-av').innerText())).toMatch(/^Septembre : \d+ pièces? traitées?.*Ses ventes et sa caisse, saisies dans SkanFact, arrivent seules au livre\.$/);
    expect(await p.locator('#sa-lignes').isVisible()).toBe(true);
    expect(erreurs).toEqual([]);
  }, 240_000);

  it('la farine payée net de sa retenue : le certificat se prépare depuis la pièce', async () => {
    const { associe, cab, ent } = await laBoulangerie();
    // Le règlement de la Minoterie : le TTC de la pièce au fournisseur, 27,693 de retenue opérée, le reste à la banque.
    const r = await api('POST', `/entreprises/${ent}/compta/ecritures`, associe, { date: '2026-09-08', journal: 'BQ', piece: 'BQ-0908', libelle: 'VIR Minoterie du Cap Bon',
      lignes: [{ compte: '401', tiers: 'Minoterie du Cap Bon', debit: '1846,199' }, { compte: '532', credit: '1818,506' }, { compte: '4352', credit: '27,693' }] });
    expect(r.statut).toBe(201);
    const { p, erreurs } = await ouvrir(associe, cab.id, ent);
    // (1.215.0, U11) Le brouillard : des lignes droites, un « ⋯ » par ligne (le menu de toutes les listes, sans le mot).
    const bl = p.locator('table.sx-bl tr.br-ligne').first();
    expect(await bl.locator('.sx-bl-plus').innerText()).toBe('⋯');
    expect(await bl.locator('td').first().evaluate((td) => getComputedStyle(td).fontStyle)).toBe('normal');
    await puce(p, 'Minoterie').click();
    await expect.poll(() => fiche(p).innerText().then(net)).toMatch(/Le certificat de retenue à remettre Sarra a retenu 27,693 DT : Minoterie du Cap Bon attend son certificat/);
    expect(net(await fiche(p).innerText())).toMatch(/Payée le 08\/09 BQ-0908 · net de sa retenue 1 818,506/);
    await p.locator('#sx-certif').click();
    const f = p.locator('#modal-root .modal').last();
    expect(net(await f.locator('#sx-certif-l').innerText())).toMatch(/Payeur Boulangerie El Amal Bénéficiaire Minoterie du Cap Bon Pièce F-2026-0903 du 03\/09\/2026 Montant de la pièce 1 846,199 DT TTC Retenue 27,693 DT · 1,5 % Réglée le 08\/09\/2026/);
    await p.screenshot({ path: path.join(PHOTOS, 'saisie-certificat.png') });
    const pdf = await pdfTelecharge(p, () => f.locator('#sx-certif-pdf').click());
    expect(pdf.nom).toBe('Certificat-retenue_F-2026-0903.pdf');
    expect(pdf.texte).toContain('Certificat de retenue à la source');
    expect(pdf.texte).toContain('Retenue 27,693');
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('Rim, en saisie : elle enregistre au brouillard, la direction valide et vérifie', async () => {
    const { rim, cab, ent } = await laBoulangerie(true);
    const { p, erreurs } = await ouvrir(rim, cab.id, ent);
    await puce(p, 'Total Ennasr').click();
    await expect.poll(() => p.locator('#sx-four').inputValue()).toBe('Total Ennasr');
    expect(await p.locator('#sx-ok-valider').count()).toBe(0);
    expect(await p.locator('#sx-ok').innerText()).toMatch(/^Enregistrer au brouillard/);
    expect(await p.locator('#sx-qui-valide').innerText()).toBe('Leïla valide le brouillard');
    await puce(p, 'Minoterie').click();
    await expect.poll(() => p.locator('#sx-qui-verifie').innerText().catch(() => '')).toBe('Leïla la vérifie');
    expect(await p.locator('#sx-verifiee').count()).toBe(0);
    await puce(p, 'IMG_8790').click();
    await expect.poll(() => fiche(p).innerText().then(net)).toMatch(/Leïla relance Sarra/);
    expect(await p.locator('#sx-relancer').count()).toBe(0);
    // (S8) Le brouillard du mois : la saisie n'a pas de bouton pour valider ; la page dit qui le fait.
    await expect.poll(() => p.locator('#sx-qui-lot').innerText().catch(() => '')).toMatch(/^Leïla (les|la) valide$/);
    expect(await p.locator('[data-lot-mois], .sa-lot button').count()).toBe(0);
    expect(erreurs).toEqual([]);
  }, 180_000);

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
    // (1.214.0) Les douze mois tiennent sur une rangée qui défile, ouverte sur septembre (ils prenaient trois rangées).
    const frise = await p.locator('.cp-an').evaluate((e) => ({ h: e.getBoundingClientRect().height, defile: e.scrollWidth > e.clientWidth }));
    expect(frise.h).toBeLessThan(80);
    expect(frise.defile).toBe(true);
    // Rechargée, sans un clic (un clic fait défiler la frise de lui-même) : elle s'ouvre sur le mois choisi, en retard ou à
    // déposer, pas sur janvier.
    await p.reload();
    await p.locator('.cp-an').waitFor({ timeout: 25_000 });
    await expect.poll(() => p.locator('.cp-an').evaluate((e) => {
      const m = e.querySelector('.cp-mo.on') || e.querySelector('.cp-mo.rouge') || e.querySelector('.cp-mo.ambre'); if (!m) return false;
      const a = e.getBoundingClientRect(), b = m.getBoundingClientRect();
      return b.left >= a.left - 1 && b.right <= a.right + 1;
    }), { timeout: 10_000 }).toBe(true);
    expect(erreurs).toEqual([]);
  }, 180_000);

  it('à 1 024 pixels : la pièce reste face à sa fiche, et rien ne se coupe', async () => {
    const { associe, cab, ent } = await laBoulangerie();
    const { p, erreurs } = await ouvrir(associe, cab.id, ent, false, 1024);
    await puce(p, 'Total Ennasr').click();
    await expect.poll(() => p.locator('#sx-four').inputValue()).toBe('Total Ennasr');
    const [dv, fi] = await Promise.all([p.locator('.sx-dv').boundingBox(), p.locator('#sx-fiche').boundingBox()]);
    expect((fi?.x ?? 0)).toBeGreaterThan((dv?.x ?? 0) + (dv?.width ?? 0) - 1);
    // L'état d'un mois se lit entier (« en retard » devenait « en ret… »).
    expect(await p.locator('.cp-mo small').evaluateAll((l) => l.filter((e) => e.scrollWidth > e.clientWidth + 1).length)).toBe(0);
    // (1.215.0, la maquette) « Face à la pièce · Au kilomètre » sous la bande des pièces, à gauche ; la bande tient sur une ligne.
    const [n, mode, pil] = await Promise.all([p.locator('#sx-rang').boundingBox(), p.locator('.sx-mode').boundingBox(), p.locator('.sx-p').boundingBox()]);
    expect((mode?.y ?? 0)).toBeGreaterThan((n?.y ?? 0) + 20);
    expect(Math.abs((pil?.y ?? 0) - (n?.y ?? 0))).toBeLessThan(12);
    expect((mode?.x ?? 999)).toBeLessThan((n?.x ?? 0) + 60);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(erreurs).toEqual([]);
  }, 180_000);
});
