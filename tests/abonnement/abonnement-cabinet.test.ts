// L'abonnement des cabinets (1.120.0 ; 0172 ; docs/abonnement.md C22 ; docs/cadrage/07-offres-et-prix.md, décidé avec
// Skander le 23/10/2026), par l'API. Ce que le serveur garantit :
//   - trois dossiers tenus gratuits ; le quatrième fixe l'anniversaire, et sa facture se prépare et s'émet seule, au nom
//     de l'entreprise SkanFact : 60 DT HT par dossier payant ; un second tour n'en fait pas deux ; payée en ligne, elle
//     paie l'année ;
//   - un dossier ajouté en cours d'année se rattrape au prorata de ses jours sur la facture suivante ; le plafond limite
//     la facture ;
//   - sans paiement après l'échéance et la grâce : les dossiers payants en lecture seule (la saisie du cabinet refusée),
//     les gratuits ouverts, la création d'un dossier tenu fermée ; payé, tout se rouvre ;
//   - un dossier que son client a rejoint ne compte plus ; seul un associé lit l'abonnement.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import { CLE_DU_COFFRE_D_ESSAI } from '../../serveur/coffre.ts';
import { plusJours } from '../../serveur/abonnement/etat.ts';
import { facturerLesCabinets, routesAbonnementCabinet } from '../../serveur/abonnement/cabinet.ts';
import { routesAbonnement } from '../../serveur/abonnement/routes.ts';
import { routesCabinet } from '../../serveur/cabinet/routes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { declarerGestesMessagerie } from '../../serveur/messagerie/gestes.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { peut } from '../../serveur/porte/porte.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';
import { konnectSimule } from '../konnect-simule.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'abonnement-cabinet-')), 'veille.json');
const jour = aujourdhuiATunis();
let konnect: Awaited<ReturnType<typeof konnectSimule>>;
let ctx: Contexte;
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
const adresse = (qui: string) => `ab-cabinet-${qui}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
async function personne(qui: string, nom = `Personne ${qui}`) {
  const email = adresse(qui);
  await appeler('POST', '/inscription', undefined, { email, nom, motDePasse: MDP });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const utilisateur = String((await admin.query('select id from socle.utilisateur where email = $1', [email])).rows[0].id);
  return { email, jeton, utilisateur };
}
async function direction() {
  const p = await personne('amira', 'Amira Équipe');
  const qui = await quiEst(ctx, p.jeton);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, p.email, 'direction', 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email: p.email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) });
  expect(k.corps.etat, JSON.stringify(k.corps)).toBe('connecte');
  return { appli: p.jeton, console: String(k.corps.jeton) };
}
// Un cabinet et son associé (le code du téléphone en place : les gestes du cabinet le demandent).
async function cabinet(nom: string) {
  const associe = await personne('associe', `Associé de ${nom}`);
  await appeler('POST', '/moi/code', associe.jeton, { methode: 'application' });
  const c = await appeler('POST', '/cabinets', associe.jeton, { nom });
  expect(c.statut, JSON.stringify(c.corps)).toBe(201);
  return { id: String(c.corps.id), associe };
}
const creer = async (c: { id: string; associe: { jeton: string } }, raisonSociale: string) => {
  const r = await appeler('POST', `/cabinets/${c.id}/dossiers`, c.associe.jeton, { raisonSociale });
  return { statut: r.statut, id: String(r.corps.entreprise ?? ''), motif: String(r.corps.motif ?? '') };
};
type Abo = { etat: Corps; depuis: string | null; payeJusquAu: string | null; dossiers: { id: string; nom: string; payant: boolean }[];
  prochainDossier: Corps; prochaine: Corps | null; factures: { pieces: { type: string; numero: string; net: string; reste: string | null; statut: string; payable: boolean }[] } | null };
const sonAbonnement = async (c: { id: string; associe: { jeton: string } }) => {
  const r = await appeler('GET', `/cabinets/${c.id}/abonnement`, c.associe.jeton);
  expect(r.statut, JSON.stringify(r.corps)).toBe(200);
  return r.corps as unknown as Abo;
};
const sesFactures = async (c: { id: string }) => (await admin.query(
  'select debut::text, fin::text, echeance::text, montant_ht, cardinality(dossiers) n, cardinality(rattrapes) r from plateforme.facture_cabinet where cabinet = $1 order by debut', [c.id])).rows as
  { debut: string; fin: string; echeance: string; montant_ht: bigint; n: number; r: number }[];
async function attendreLaFacture(c: { id: string }, combien = 1) {
  await expect.poll(async () => Number((await admin.query('select count(*) n from plateforme.facture_cabinet where cabinet = $1', [c.id])).rows[0].n),
    { timeout: 15_000, interval: 200 }).toBe(combien);
}
// Payer en ligne une facture : chez Konnect, puis la page de retour de l'espace client.
async function payerEnLigne(c: { id: string; associe: { jeton: string } }, numero: string) {
  const r = await appeler('POST', `/cabinets/${c.id}/abonnement/payer`, c.associe.jeton, { numero });
  expect(r.statut, JSON.stringify(r.corps)).toBe(200);
  const ref = String(r.corps.adresse).split('/').pop() ?? '';
  const retour = new URL(await konnect.payer(ref, { avis: false }));
  const fragment = new URLSearchParams(retour.hash.slice(1));
  expect((await appeler('POST', '/espace/paiement', undefined, { paiement: fragment.get('paiement'), s: fragment.get('s') })).corps).toMatchObject({ etat: 'encaisse', numero });
}

let amira: Awaited<ReturnType<typeof direction>>;
let editeur: string;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  konnect = await konnectSimule();
  ctx = {
    pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} },
    paiement: { konnect: konnect.base, coffre: CLE_DU_COFFRE_D_ESSAI, adresse: () => 'https://skanfact.exemple.tn' },
    factureAuChoix: true,
  };
  declarerGestesVentes(); declarerGestesCompta(); declarerGestesMessagerie();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx), ...routesCabinet(ctx), ...routesConsole(ctx, { veille }),
    ...routesAbonnement(ctx), ...routesAbonnementCabinet(ctx)]);
  await app.ready();
  amira = await direction();
  editeur = String((await appeler('POST', '/entreprises', amira.appli, { raisonSociale: 'SkanFact Éditions SARL' })).corps.id);
  await admin.query('delete from plateforme.facture_abonnement');
  await admin.query('delete from plateforme.facture_cabinet');
  await admin.query('delete from plateforme.editeur');
  expect((await appeler('POST', '/console/reglages/factures/editeur', amira.console, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
  expect((await appeler('GET', `/entreprises/${editeur}/dossier-v10`, amira.appli)).statut).toBe(200);
  expect((await appeler('PUT', `/entreprises/${editeur}/paiement-en-ligne`, amira.appli, { portefeuille: `portefeuille-cab-${Date.now()}`, cle: 'sk_test_cle-de-l-api-konnect-b3f2' })).statut).toBe(200);
});
afterAll(async () => { await app.close(); await konnect.fermer(); await admin.end(); await pool.end(); });

describe('l\'abonnement d\'un cabinet', () => {
  it('trois dossiers tenus gratuits ; le quatrième fixe l\'anniversaire, et sa facture s\'émet seule ; payée en ligne, elle paie l\'année', async () => {
    const c = await cabinet('Cabinet des Gratuits');
    for (const nom of ['Boulangerie Une', 'Épicerie Deux', 'Pressing Trois']) expect((await creer(c, nom)).statut).toBe(201);
    let a = await sonAbonnement(c);
    expect(a.etat).toEqual({ etat: 'gratuit' });
    expect(a.dossiers.map((d) => d.payant)).toEqual([false, false, false]);
    // Avant le quatrième : ce qu'il coûtera.
    expect(a.prochainDossier).toMatchObject({ rang: 4, payant: true, prixHt: '60.000', abonne: false });
    expect(await sesFactures(c)).toEqual([]);
    expect((await creer(c, 'Librairie Quatre')).statut).toBe(201);
    await attendreLaFacture(c);
    // La période : un an depuis aujourd'hui ; quinze jours pour la régler ; un dossier payant, 60 DT HT.
    const fin = plusJours(`${Number(jour.slice(0, 4)) + 1}${jour.slice(4)}`, -1);
    expect(await sesFactures(c)).toEqual([{ debut: jour, fin, echeance: plusJours(jour, 15), montant_ht: 60000n, n: 1, r: 0 }]);
    a = await sonAbonnement(c);
    expect(a.depuis).toBe(jour);
    expect(a.etat).toMatchObject({ etat: 'a_payer', echeance: plusJours(jour, 15) });
    expect(a.dossiers.map((d) => [d.nom, d.payant])).toEqual([['Boulangerie Une', false], ['Épicerie Deux', false], ['Pressing Trois', false], ['Librairie Quatre', true]]);
    // 60 HT + 11,400 de TVA + 1 de timbre : émise, à payer en ligne.
    expect(a.factures?.pieces).toEqual([expect.objectContaining({ type: 'facture', net: '72.400', reste: '72.400', statut: 'a_payer', payable: true })]);
    // Un second tour ne la refait pas.
    expect(await facturerLesCabinets(ctx, { cabinet: c.id })).toEqual({ periodes: 0, emises: 0, vides: 0, refusees: 0 });
    // L'e-mail « facture prête » part à ses associés (C20) : la facture est dans la liste à annoncer, avec leur adresse.
    const id = String((await admin.query('select id from plateforme.facture_cabinet where cabinet = $1', [c.id])).rows[0].id);
    const aAnnoncer = async () => ((await admin.query('select plateforme.factures_a_annoncer() l')).rows[0].l as { facture: string; nature: string; adresses: string[] }[])
      .filter((x) => x.facture === id).map((x) => ({ nature: x.nature, adresses: x.adresses }));
    expect(await aAnnoncer()).toEqual([{ nature: 'emise', adresses: [c.associe.email] }]);
    // Payée en ligne : l'abonnement court jusqu'à la fin de sa période.
    await payerEnLigne(c, a.factures?.pieces[0]?.numero ?? '');
    a = await sonAbonnement(c);
    expect(a.etat).toEqual({ etat: 'actif', jusquAu: fin });
    expect(a.payeJusquAu).toBe(fin);
    // Payée avant d'être annoncée : seul le reçu part (la règle des factures d'abonnement, C20).
    expect(await aAnnoncer()).toEqual([{ nature: 'payee', adresses: [c.associe.email] }]);
  });

  it('un dossier ajouté en cours d\'année se rattrape au prorata de ses jours sur la facture suivante', async () => {
    const c = await cabinet('Cabinet du Rattrapage');
    const ids: string[] = [];
    for (const nom of ['Un', 'Deux', 'Trois', 'Quatre', 'Cinq']) ids.push((await creer(c, `Dossier ${nom}`)).id);
    await attendreLaFacture(c);
    // L'histoire, reculée : l'abonnement a commencé il y a 400 jours avec le quatrième dossier ; le cinquième est arrivé
    // il y a 100 jours ; la facture de la première période ne comptait que le quatrième.
    const depuis = plusJours(jour, -400);
    await admin.query('update plateforme.abonnement_cabinet set depuis = $2 where cabinet = $1', [c.id, depuis]);
    await admin.query("update socle.entreprise set cree_le = ($1::date - 500)::timestamp at time zone 'Africa/Tunis' + (rang * interval '1 minute') from unnest($2::uuid[]) with ordinality u(id, rang) where entreprise.id = u.id",
      [jour, ids.slice(0, 3)]);
    await admin.query("update socle.entreprise set cree_le = $2::date::timestamp at time zone 'Africa/Tunis' + interval '9 hours' where id = $1", [ids[3], depuis]);
    await admin.query("update socle.entreprise set cree_le = $2::date::timestamp at time zone 'Africa/Tunis' + interval '9 hours' where id = $1", [ids[4], plusJours(jour, -100)]);
    await admin.query('update plateforme.facture_cabinet set debut = $2, fin = $3, echeance = $4, dossiers = $5 where cabinet = $1',
      [c.id, depuis, plusJours(`${Number(depuis.slice(0, 4)) + 1}${depuis.slice(4)}`, -1), plusJours(depuis, 15), [ids[3]]]);
    expect(await facturerLesCabinets(ctx, { cabinet: c.id })).toMatchObject({ periodes: 1, emises: 1 });
    const debut = `${Number(depuis.slice(0, 4)) + 1}${depuis.slice(4)}`;
    // Le rattrapage du cinquième : de son jour d'arrivée à la fin de la période d'avant, sur les jours de cette période.
    const sur = Math.round((Date.parse(debut) - Date.parse(depuis)) / 86_400_000);
    const jours = Math.round((Date.parse(debut) - Date.parse(plusJours(jour, -100))) / 86_400_000);
    const rattrapage = (60000n * BigInt(jours) * 2n + BigInt(sur)) / (2n * BigInt(sur));
    const f = (await sesFactures(c)).find((x) => x.debut === debut);
    expect(f).toMatchObject({ n: 2, r: 1, montant_ht: 120000n + rattrapage });
    // Le rattrapage est bien sur la pièce, à sa ligne.
    const piece = (await admin.query("select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'documents' and cle = $2",
      [editeur, `cabinet-${c.id}-${debut}`])).rows[0]?.contenu as { lines: { qty: number; unitPrice: unknown; description: string }[] };
    expect(piece.lines).toHaveLength(2);
    expect(piece.lines[1]?.description).toBe(`Du ${plusJours(jour, -100).split('-').reverse().join('/')} au ${plusJours(debut, -1).split('-').reverse().join('/')} : ${jours} jours sur ${sur}`);
  });

  it('le plafond limite la facture : une seule ligne, au plafond annuel', async () => {
    const c = await cabinet('Cabinet du Plafond');
    // 3 gratuits + 34 payants : 34 × 60 = 2 040 DT, au-delà des 1 990 DT du plafond. Les 36 premiers sont créés sans que
    // la facture parte ; elle part au 37e, et compte tous les payants de ce jour.
    ctx.factureAuChoix = false;
    try {
      for (let i = 1; i <= 36; i++) expect((await creer(c, `Client numéro ${i}`)).statut).toBe(201);
    } finally { ctx.factureAuChoix = true; }
    expect((await creer(c, 'Client numéro 37')).statut).toBe(201);
    await attendreLaFacture(c);
    const calc = (await admin.query('select plateforme.calcul_facture_cabinet($1, $2::date, $2::date) v', [c.id, jour])).rows[0].v as Corps;
    expect(calc).toMatchObject({ brutHt: '2040000', totalHt: '1990000', plafonne: true });
    expect(await sesFactures(c)).toEqual([expect.objectContaining({ montant_ht: 1990000n, n: 34, r: 0 })]);
    const piece = (await admin.query("select contenu from socle.dossier_v10 where entreprise = $1 and collection = 'documents' and cle = $2",
      [editeur, `cabinet-${c.id}-${jour}`])).rows[0]?.contenu as { lines: { qty: number; unitPrice: unknown }[] };
    expect(piece.lines).toEqual([expect.objectContaining({ qty: 1, unitPrice: 1990 })]);
  });

  it('sans paiement après l\'échéance et la grâce : les payants en lecture seule, les gratuits ouverts, la création fermée ; payé, tout se rouvre', async () => {
    const c = await cabinet('Cabinet en Retard');
    const ids: string[] = [];
    for (const nom of ['Gratuit A', 'Gratuit B', 'Gratuit C', 'Payant D']) ids.push((await creer(c, nom)).id);
    await attendreLaFacture(c);
    // L'échéance est passée depuis dix jours (la grâce : sept).
    await admin.query('update plateforme.facture_cabinet set echeance = $2 where cabinet = $1', [c.id, plusJours(jour, -10)]);
    let a = await sonAbonnement(c);
    expect(a.etat).toMatchObject({ etat: 'lecture_seule', depuis: plusJours(jour, -2) });
    const qui = { utilisateur: c.associe.utilisateur };
    const saisir = (ent: string) => enTantQue(pool, c.associe.utilisateur, (tx) => peut(tx, qui, ent, 'compta.ecritures.saisir', true));
    const bloque = await saisir(ids[3] ?? '');
    expect(bloque).toMatchObject({ ok: false, raison: 'condition', bouton: 'compte.cabinet.gerer' });
    expect(JSON.stringify(bloque)).toContain(`en lecture seule depuis le ${plusJours(jour, -2).split('-').reverse().join('/')}`);
    expect((await saisir(ids[0] ?? '')).ok).toBe(true);
    // Parler au client reste ouvert ; lire aussi.
    { const m = await enTantQue(pool, c.associe.utilisateur, (tx) => peut(tx, qui, ids[3] ?? '', 'messagerie.ecrire', true)); expect(m.ok, JSON.stringify(m)).toBe(true); }
    // La création d'un dossier tenu se ferme, et le dit.
    const refus = await creer(c, 'Un de plus');
    expect(refus.statut).toBe(403);
    expect(refus.motif).toMatch(/attend son paiement/);
    // Payé : tout se rouvre.
    await payerEnLigne(c, a.factures?.pieces[0]?.numero ?? '');
    a = await sonAbonnement(c);
    expect(a.etat).toMatchObject({ etat: 'actif' });
    expect((await saisir(ids[3] ?? '')).ok).toBe(true);
    expect((await creer(c, 'Un de plus')).statut).toBe(201);
  });

  it('un dossier que son client rejoint ne compte plus ; seul un associé lit l\'abonnement', async () => {
    const c = await cabinet('Cabinet qui Convertit');
    const ids: string[] = [];
    for (const nom of ['Premier', 'Deuxième', 'Troisième', 'Quatrième']) ids.push((await creer(c, nom)).id);
    await attendreLaFacture(c);
    expect((await sonAbonnement(c)).dossiers.filter((d) => d.payant).map((d) => d.nom)).toEqual(['Quatrième']);
    // Le client du premier rejoint son dossier (0155) : il n'est plus tenu ; le quatrième devient gratuit.
    await admin.query('update socle.entreprise set tenue_par = null where id = $1', [ids[0]]);
    const a = await sonAbonnement(c);
    expect(a.dossiers.map((d) => [d.nom, d.payant])).toEqual([['Deuxième', false], ['Troisième', false], ['Quatrième', false]]);
    expect(a.prochaine).toMatchObject({ dossiers: 0, totalHt: '0.000' });
    // Un collaborateur du cabinet ne lit pas l'abonnement.
    const collab = await personne('collab');
    await appeler('POST', '/moi/code', collab.jeton, { methode: 'application' });
    const inv = await appeler('POST', `/cabinets/${c.id}/invitations`, c.associe.jeton, { email: collab.email, role: 'revision' });
    expect(inv.statut, JSON.stringify(inv.corps)).toBe(201);
    const rej = await appeler('POST', '/invitations/accepter', collab.jeton, { jeton: inv.corps.jeton });
    expect(rej.statut, JSON.stringify(rej.corps)).toBe(200);
    const lu = await appeler('GET', `/cabinets/${c.id}/abonnement`, collab.jeton);
    expect(lu.statut).toBe(403);
  });

  it('la console : les règles des cabinets se préparent et se retirent, la fiche dit l\'abonnement, « À décider » la facture qui ne s\'est pas faite', async () => {
    const c = await cabinet('Cabinet de la Console');
    for (const nom of ['Alpha', 'Bêta', 'Gamma', 'Delta']) expect((await creer(c, `Dossier ${nom}`)).statut).toBe(201);
    await attendreLaFacture(c);
    // Les règles du jour, en millimes.
    let r = await appeler('GET', '/console/reglages', amira.console);
    expect(r.statut).toBe(200);
    const cabinets = () => r.corps.cabinets as { duJour: Record<string, { valeur: string } | null>; aVenir: { code: string; valeur: string; aPartirDu: string }[]; cabinets: number };
    expect(cabinets().duJour.prix_dossier?.valeur).toBe('60000');
    expect(cabinets().duJour.gratuits?.valeur).toBe('3');
    // Un nouveau prix, tapé en dinars, avec le préavis ; la base le date et le note au journal.
    const preavis = (r.corps.preavis as { jours: number } | null)?.jours ?? 0;
    const date = plusJours(jour, preavis);
    expect((await appeler('POST', '/console/reglages/cabinet', amira.console, { code: 'prix_dossier', valeur: '75,500', aPartirDu: date, motif: 'Essai du prix' })).statut).toBe(201);
    expect((await appeler('POST', '/console/reglages/cabinet', amira.console, { code: 'gratuits', valeur: 'trois', aPartirDu: date, motif: 'Essai' })).corps).toMatchObject({ champ: 'valeur' });
    // Un montant rond se lit en dinars aussi (« 2 000 » : deux mille dinars, jamais deux mille millimes).
    expect((await appeler('POST', '/console/reglages/cabinet', amira.console, { code: 'plafond', valeur: '2 000', aPartirDu: date, motif: 'Essai du plafond' })).statut).toBe(201);
    r = await appeler('GET', '/console/reglages', amira.console);
    expect(cabinets().aVenir).toEqual([expect.objectContaining({ code: 'plafond', valeur: '2000000', aPartirDu: date }),
      expect.objectContaining({ code: 'prix_dossier', valeur: '75500', aPartirDu: date })]);
    expect((await appeler('POST', '/console/reglages/cabinet/retirer', amira.console, { code: 'plafond', aPartirDu: date, motif: 'Essai fini' })).statut).toBe(200);
    // La prochaine facture du cabinet le compte déjà (elle commence après la date du nouveau prix).
    expect((await sonAbonnement(c)).prochaine).toMatchObject({ prixHt: '75.500', totalHt: '75.500' });
    expect((await admin.query("select count(*)::int n from plateforme.geste_console where geste = 'reglages.regle_cabinet' and motif = 'Essai du prix'")).rows[0].n).toBe(1);
    expect((await appeler('POST', '/console/reglages/cabinet/retirer', amira.console, { code: 'prix_dossier', aPartirDu: date, motif: 'Essai fini' })).statut).toBe(200);
    r = await appeler('GET', '/console/reglages', amira.console);
    expect(cabinets().aVenir).toEqual([]);
    // La fiche du cabinet : son abonnement, compté.
    const f = await appeler('GET', `/console/cabinets/${c.id}`, amira.console);
    expect(f.corps.abonnement).toMatchObject({ etat: { etat: 'a_payer' }, tenus: 4, payants: 1, factures: [expect.objectContaining({ montantHt: '60000', dossiers: 1 })] });
    // Une période qui ne s'est pas facturée seule : « À décider » la dit, avec son motif.
    const autre = await cabinet('Cabinet du Refus');
    await admin.query('insert into plateforme.facture_cabinet_refus (cabinet, debut, motif) values ($1, $2::date, $3)', [autre.id, jour, 'La fiche de SkanFact est incomplète.']);
    const accueil = await appeler('GET', '/console/accueil', amira.console);
    expect(accueil.corps.decider).toEqual(expect.arrayContaining([expect.objectContaining({ sorte: 'facture_cabinet', cabinet: { id: autre.id, nom: 'Cabinet du Refus' }, debut: jour, motif: 'La fiche de SkanFact est incomplète.' })]));
    await admin.query('delete from plateforme.facture_cabinet_refus where cabinet = $1', [autre.id]);
  });
});
