// Les remises (docs/abonnement.md C17 ; 0106), par l'API et la base. Ce que le serveur garantit :
//   - deux remises se règlent dans la console comme un prix (datées, avec le préavis, retirables avant leur date, jamais
//     changées une fois en vigueur) : celle du groupe et celle du cabinet (avec sa durée en mois) ;
//   - un groupe se déclare par la direction, avec son motif ; une société n'est que dans un groupe à la fois ; la
//     PREMIÈRE ABONNÉE du groupe (la plus ancienne première période payée) paie le prix normal, les autres ont la remise,
//     pour les périodes qui commencent pendant qu'elles y sont ;
//   - un client venu par son cabinet (un mandat qui commence avant son premier paiement) a la remise du cabinet pour
//     chaque période qui commence dans les mois de la règle depuis sa première période payée ;
//   - jamais additionnées : la plus forte s'applique (à égalité, celle du groupe), l'autre se dit ;
//   - la facture d'une période porte la remise de son premier jour, sur tout son hors taxes ; la base la rejoue en
//     notant la facture ; le client lit sa remise dans « Ton abonnement », sans le nom d'une autre société.
// Les changements de règle préparés ici sont à venir : ils s'effacent à la fin, pour les fichiers de test qui suivent.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { plusJours, plusMois } from '../../serveur/abonnement/etat.ts';
import { routesAbonnement } from '../../serveur/abonnement/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'remises-')), 'veille.json');
const jour = aujourdhuiATunis();
const enFrancais = (j: string) => `${j.slice(8, 10)}/${j.slice(5, 7)}/${j.slice(0, 4)}`;
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function inscrire(qui: string) {
  const email = `remises-${qui}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${qui} ${n}`, motDePasse: MDP });
  return { email, jeton: String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton) };
}
async function membre(prenom: string, role: 'direction' | 'support') {
  const { email, jeton: appli } = await inscrire(prenom);
  const qui = await quiEst(ctx, appli);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) });
  return { appli, console: String(k.corps.jeton), nom: `${prenom} ${n}`, email };
}
let amira: Awaited<ReturnType<typeof membre>>;
let karim: Awaited<ReturnType<typeof membre>>;
const preparer = (corps: Corps, jeton = amira.console) => appeler('POST', '/console/reglages/remise', jeton, corps);
const retirer = (corps: Corps) => appeler('POST', '/console/reglages/remise/retirer', amira.console, corps);
const dernierGeste = async (geste: string, entreprise?: string) => (await admin.query(
  `select avant, apres, motif from plateforme.geste_console where geste = $1 and ($2::uuid is null or entreprise = $2) order by le desc, id desc limit 1`,
  [geste, entreprise ?? null])).rows[0] as { avant: Corps | null; apres: Corps; motif: string } | undefined;
// La remise d'une période, telle que la base la décide.
const remiseDe = async (ent: string, debut: string) => (await admin.query('select plateforme.remise_de($1, $2::date) r', [ent, debut])).rows[0].r as Corps | null;
// Un paiement passé : la période qu'il a payée, et le jour où il est arrivé (les événements ne s'écrivent qu'en plus).
const paye = (ent: string, debut: string, le: string) => admin.query(
  `insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, apres, le) values ($1, 'paye', 'exploitation', 'paiement des essais', $2, $3::date + time '10:00')`,
  [ent, { debut }, le]);
const nouvelle = async (jeton: string, nom: string) => String((await appeler('POST', '/entreprises', jeton, { raisonSociale: nom })).corps.id);
const effacerLesRemisesAVenir = () => admin.query('delete from plateforme.regle_remise where a_partir_du > (now() at time zone \'Africa/Tunis\')::date');

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  await effacerLesRemisesAVenir();
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx), ...routesConsole(ctx, { veille }), ...routesAbonnement(ctx)]);
  await app.ready();
  amira = await membre('amira', 'direction');
  karim = await membre('karim', 'support');
});
afterAll(async () => {
  await effacerLesRemisesAVenir();
  await app.close(); await admin.end(); await pool.end();
});

describe('les remises, réglées dans la console', () => {
  it('la direction prépare un changement de remise après le préavis ; il se retire avant sa date ; une remise en vigueur ne bouge jamais', async () => {
    const plusTot = plusJours(jour, 30);
    // Les remises de départ, lues par le support, qui ne les change pas.
    const lues = (await appeler('GET', '/console/reglages', karim.console)).corps.remises as { duJour: Record<string, Corps>; aVenir: Corps[] };
    expect(lues.duJour.groupe).toMatchObject({ taux: 20, mois: null, aPartirDu: '2000-01-01' });
    expect(lues.duJour.cabinet).toMatchObject({ taux: 20, mois: 12, aPartirDu: '2000-01-01' });
    expect(lues.aVenir).toEqual([]);
    expect((await preparer({ code: 'groupe', taux: 15, mois: null, aPartirDu: plusTot, motif: 'Quinze pour cent' }, karim.console)).statut).toBe(403);
    // Refusé, avec la raison.
    const refus = async (corps: Corps) => { const r = await preparer(corps); expect(r.statut, JSON.stringify(r.corps)).toBe(403); return String(r.corps.motif); };
    expect(await refus({ code: 'groupe', taux: 15, mois: null, aPartirDu: plusJours(jour, 29), motif: 'Trop tôt' }))
      .toBe(`Une nouvelle remise commence au plus tôt le ${enFrancais(plusTot)} : c'est le préavis en vigueur.`);
    expect(await refus({ code: 'groupe', taux: 20, mois: null, aPartirDu: plusTot, motif: 'La même' })).toBe('C\'est déjà la remise en vigueur : rien ne changerait.');
    expect(await refus({ code: 'cabinet', taux: 20, mois: null, aPartirDu: plusTot, motif: 'Sans durée' })).toBe('La remise du cabinet dure de 1 à 60 mois ; celle du groupe, toujours.');
    expect(await refus({ code: 'groupe', taux: 15, mois: 6, aPartirDu: plusTot, motif: 'Une durée au groupe' })).toBe('La remise du cabinet dure de 1 à 60 mois ; celle du groupe, toujours.');
    // Le cabinet : la même remise, plus longue, est un changement.
    expect((await preparer({ code: 'cabinet', taux: 20, mois: 18, aPartirDu: plusTot, motif: 'Dix-huit mois pour les cabinets' })).statut).toBe(201);
    expect(await dernierGeste('reglages.remise_preparee')).toMatchObject({ motif: 'Dix-huit mois pour les cabinets',
      avant: { code: 'cabinet', taux: 20, mois: 12 }, apres: { code: 'cabinet', taux: 20, mois: 18, aPartirDu: plusTot } });
    expect(await refus({ code: 'cabinet', taux: 25, mois: 12, aPartirDu: plusJours(jour, 60), motif: 'Une autre' })).toMatch(/^Un changement de cette remise est déjà préparé/);
    // La console le montre à venir, avec qui l'a préparé ; aujourd'hui ne change pas, ni la remise d'une période d'avant.
    const r = (await appeler('GET', '/console/reglages', amira.console)).corps.remises as { duJour: Record<string, Corps>; aVenir: Corps[] };
    expect(r.duJour.cabinet).toMatchObject({ taux: 20, mois: 12 });
    expect(r.aVenir).toEqual([{ code: 'cabinet', taux: 20, mois: 18, aPartirDu: plusTot, motif: 'Dix-huit mois pour les cabinets', par: amira.nom, le: expect.any(String) }]);
    expect((await admin.query('select plateforme.regle_remise_du_jour(\'cabinet\', $1::date) r', [plusTot])).rows[0].r).toMatchObject({ taux: 20, mois: 18 });
    expect((await admin.query('select plateforme.regle_remise_du_jour(\'cabinet\', $1::date) r', [plusJours(plusTot, -1)])).rows[0].r).toMatchObject({ taux: 20, mois: 12 });
    // Retiré avant sa date : le journal garde le changement retiré et ce qui reste.
    expect((await retirer({ code: 'cabinet', aPartirDu: plusTot, motif: 'Pas encore' })).statut).toBe(200);
    expect(await dernierGeste('reglages.remise_retiree')).toMatchObject({ motif: 'Pas encore',
      avant: { code: 'cabinet', taux: 20, mois: 18, aPartirDu: plusTot }, apres: { code: 'cabinet', taux: 20, mois: 12 } });
    expect(String((await retirer({ code: 'cabinet', aPartirDu: plusTot, motif: 'Encore' })).corps.motif)).toMatch(/^Ce changement de remise n'existe pas/);
    // Une remise en vigueur ne se retire pas ; la base refuse de l'effacer ou de la changer.
    expect(String((await retirer({ code: 'groupe', aPartirDu: '2000-01-01', motif: 'Essai' })).corps.motif)).toMatch(/^Cette remise est déjà en vigueur/);
    await expect(admin.query("delete from plateforme.regle_remise where code = 'groupe' and a_partir_du = '2000-01-01'")).rejects.toThrow(/ne s'efface/);
    await expect(admin.query("update plateforme.regle_remise set taux = 50 where code = 'groupe'")).rejects.toThrow(/ne se modifie/);
  });
});

describe('les groupes : la première abonnée paie le prix normal, les autres ont la remise', () => {
  it('la direction déclare le groupe ; la remise suit la première période payée, pas la création ; une société entre et sort à son jour', async () => {
    const p = await inscrire('yasmine');
    // La Boulangerie est créée la première, mais l'Épicerie a payé avant elle : c'est l'Épicerie qui paie le prix normal.
    const boulangerie = await nouvelle(p.jeton, 'Boulangerie du Groupe');
    const epicerie = await nouvelle(p.jeton, 'Épicerie du Groupe');
    const traiteur = await nouvelle(p.jeton, 'Traiteur du Groupe');
    await paye(epicerie, '2026-01-01', '2025-12-28');
    await paye(boulangerie, '2026-03-01', '2026-02-27');
    const prochaine = plusJours(jour, 40);
    // Avant le groupe : aucune remise ; la fiche propose les deux autres sociétés de la même propriétaire.
    expect(await remiseDe(boulangerie, prochaine)).toBeNull();
    const lue = await appeler('GET', `/console/entreprises/${boulangerie}`, amira.console);
    expect(lue.statut, JSON.stringify(lue.corps)).toBe(200);
    const avant = lue.corps.groupe as Corps;
    expect(avant).toMatchObject({ groupe: null, tauxGroupe: 20, remise: null,
      voisines: [{ entreprise: epicerie, raisonSociale: 'Épicerie du Groupe' }, { entreprise: traiteur, raisonSociale: 'Traiteur du Groupe' }] });
    // Le support lit, ne déclare pas ; un groupe d'une seule société n'en est pas un.
    expect((await appeler('POST', '/console/groupes', karim.console, { nom: 'Famille', entreprises: [boulangerie, epicerie], motif: 'Même famille' })).statut).toBe(403);
    expect((await appeler('POST', '/console/groupes', amira.console, { nom: 'Famille', entreprises: [boulangerie], motif: 'Seule' })).statut).toBe(400);
    // L'aperçu, sans rien écrire : la première abonnée d'abord.
    const ap = await appeler('POST', '/console/groupes/apercu', amira.console, { groupe: null, entrent: [boulangerie, epicerie], sort: null });
    expect(ap.statut, JSON.stringify(ap.corps)).toBe(200);
    expect(ap.corps).toEqual({ taux: 20, membres: [
      { entreprise: epicerie, raisonSociale: 'Épicerie du Groupe', premierePeriode: '2026-01-01' },
      { entreprise: boulangerie, raisonSociale: 'Boulangerie du Groupe', premierePeriode: '2026-03-01' }] });
    expect((await admin.query('select count(*)::int n from plateforme.groupe_membre where entreprise = any($1::uuid[])', [[boulangerie, epicerie]])).rows[0].n).toBe(0);
    // Déclaré : chaque société entre au journal, sur sa fiche.
    const cree = await appeler('POST', '/console/groupes', amira.console, { nom: 'Famille Ben Salah', entreprises: [boulangerie, epicerie], motif: 'Même propriétaire, même famille' });
    expect(cree.statut, JSON.stringify(cree.corps)).toBe(201);
    const groupe = String(cree.corps.id);
    expect(await dernierGeste('groupes.entree', boulangerie)).toMatchObject({ motif: 'Même propriétaire, même famille', avant: null,
      apres: { groupe, nom: 'Famille Ben Salah', depuis: jour, cree: true } });
    // La Boulangerie a la remise ; l'Épicerie, première abonnée, paie le prix normal.
    expect(await remiseDe(boulangerie, prochaine)).toEqual({ nature: 'groupe', taux: 20, groupe: 'Famille Ben Salah', premiere: 'Épicerie du Groupe' });
    expect(await remiseDe(epicerie, prochaine)).toBeNull();
    // Une période qui a commencé avant l'entrée dans le groupe ne l'a pas.
    expect(await remiseDe(boulangerie, plusJours(jour, -1))).toBeNull();
    const fiche = (await appeler('GET', `/console/entreprises/${boulangerie}`, karim.console)).corps.groupe as Corps;
    expect(fiche).toMatchObject({ groupe: { id: groupe, nom: 'Famille Ben Salah', depuis: jour, motif: 'Même propriétaire, même famille',
      membres: [{ entreprise: epicerie, premierePeriode: '2026-01-01' }, { entreprise: boulangerie, premierePeriode: '2026-03-01' }] },
    voisines: [{ entreprise: traiteur }], remise: { nature: 'groupe', taux: 20, premiere: 'Épicerie du Groupe' } });
    expect(fiche.groupes).toContainEqual({ id: groupe, nom: 'Famille Ben Salah', membres: 2 });
    // Le Traiteur n'a jamais payé : il entre, et sa prochaine période a la remise (une autre a payé avant lui).
    expect((await appeler('POST', `/console/entreprises/${traiteur}/groupe`, amira.console, { groupe, motif: 'Le traiteur de la famille' })).statut).toBe(200);
    expect(await remiseDe(traiteur, prochaine)).toMatchObject({ nature: 'groupe', premiere: 'Épicerie du Groupe' });
    expect(await dernierGeste('groupes.entree', traiteur)).toMatchObject({ apres: { groupe, nom: 'Famille Ben Salah', depuis: jour } });
    // Une société n'est que dans un groupe à la fois.
    const deux = await appeler('POST', `/console/entreprises/${traiteur}/groupe`, amira.console, { groupe, motif: 'Une seconde fois' });
    expect(deux.statut).toBe(403);
    expect(String(deux.corps.motif)).toMatch(/^Cette société est déjà dans un groupe/);
    // Le client lit sa remise et pourquoi, sans le nom de l'autre société.
    const abo = (await appeler('GET', `/entreprises/${boulangerie}/abonnement`, p.jeton)).corps;
    expect(abo.remise).toEqual({ nature: 'groupe', taux: 20, groupe: 'Famille Ben Salah', cabinet: null, jusquAu: null });
    // L'Épicerie sort : la Boulangerie devient la première abonnée, et paie le prix normal à sa prochaine période.
    expect((await appeler('POST', `/console/entreprises/${epicerie}/groupe/sortir`, amira.console, { motif: 'Vendue à un autre propriétaire' })).statut).toBe(200);
    expect(await dernierGeste('groupes.sortie', epicerie)).toMatchObject({ motif: 'Vendue à un autre propriétaire', apres: { groupe: null } });
    expect(await remiseDe(boulangerie, prochaine)).toBeNull();
    expect(await remiseDe(traiteur, prochaine)).toMatchObject({ nature: 'groupe', premiere: 'Boulangerie du Groupe' });
    expect(String((await appeler('POST', `/console/entreprises/${epicerie}/groupe/sortir`, amira.console, { motif: 'Encore' })).corps.motif))
      .toBe('Cette société n\'est dans aucun groupe.');
  });
});

describe('le cabinet : la remise de la première année, jamais additionnée à celle du groupe', () => {
  it('un mandat d\'avant le premier paiement donne la remise pour les périodes qui commencent dans les mois de la règle ; d\'après, rien', async () => {
    const p = await inscrire('walid');
    const venue = await nouvelle(p.jeton, 'Garage Venu par son Cabinet');
    const tard = await nouvelle(p.jeton, 'Garage Venu Tard');
    const cabinet = (await admin.query(`insert into socle.organisation (type, nom, code_cabinet) values ('cabinet', 'Cabinet Remise', $1) returning id`,
      [`CAB${String(200000 + Math.floor(Math.random() * 99999))}`])).rows[0].id as string;
    const proprio = (await admin.query('select id from socle.utilisateur where email = $1', [p.email])).rows[0].id as string;
    const mandat = (ent: string, debut: string, statut: string) => admin.query(
      'insert into socle.mandat (cabinet, entreprise, accorde_par, debut, statut) values ($1, $2, $3, $4, $5)', [cabinet, ent, proprio, debut, statut]);
    // Venu par son cabinet : le mandat commence avant le premier paiement ; arrêté depuis, il compte encore.
    await mandat(venue, '2026-02-01', 'termine');
    await paye(venue, '2026-03-01', '2026-02-20');
    // Venu tard : le cabinet est arrivé après le premier paiement.
    await paye(tard, '2026-03-01', '2026-02-20');
    await mandat(tard, '2026-04-01', 'actif');
    // Douze mois depuis la première période payée : la dernière période remisée commence le 28/02/2027 au plus tard.
    expect(await remiseDe(venue, '2026-09-01')).toEqual({ nature: 'cabinet', taux: 20, cabinet: 'Cabinet Remise', jusquAu: '2027-02-28' });
    expect(await remiseDe(venue, '2027-02-28')).toMatchObject({ nature: 'cabinet' });
    expect(await remiseDe(venue, '2027-03-01')).toBeNull();
    expect(await remiseDe(tard, '2026-09-01')).toBeNull();
    // Un mandat seulement proposé ne compte pas.
    const propose = await nouvelle(p.jeton, 'Garage au Mandat Proposé');
    await mandat(propose, '2026-01-01', 'propose');
    await paye(propose, '2026-03-01', '2026-02-20');
    expect(await remiseDe(propose, '2026-09-01')).toBeNull();
    // La liste des clients les voit par la même règle : la vue « venus par un cabinet » (0107) garde le garage venu par
    // son cabinet, jamais celui que le cabinet a rejoint après son premier paiement, ni celui d'un mandat seulement proposé.
    // Une ligne par organisation (0110) : une entreprise seule porte son id, et sa société dit par qui elle est venue.
    const venus = (await appeler('GET', '/console/entreprises?vue=cabinet&limite=200', karim.console)).corps as { lignes: { id: string; societes: { venuePar: Corps | null }[] }[]; vues: Corps };
    expect(venus.lignes.find((l) => l.id === venue)?.societes[0]?.venuePar).toEqual({ cabinet: 'Cabinet Remise', depuis: '2026-02-01' });
    expect(venus.lignes.map((l) => l.id)).not.toContain(tard);
    expect(venus.lignes.map((l) => l.id)).not.toContain(propose);
    expect(venus.vues.cabinet).toBe(venus.lignes.length);
    // Dans un groupe aussi : jamais additionnées. À égalité, celle du groupe ; l'autre se dit.
    const tete = await nouvelle(p.jeton, 'Garage Tête du Groupe');
    await paye(tete, '2025-06-01', '2025-05-30');
    const garages = await appeler('POST', '/console/groupes', amira.console, { nom: 'Garages Réunis', entreprises: [tete, venue], motif: 'Les garages de Walid' });
    expect(garages.statut, JSON.stringify(garages.corps)).toBe(201);
    expect(await remiseDe(venue, plusJours(jour, 10))).toEqual({ nature: 'groupe', taux: 20, groupe: 'Garages Réunis', premiere: 'Garage Tête du Groupe',
      aussi: { nature: 'cabinet', taux: 20, cabinet: 'Cabinet Remise', jusquAu: '2027-02-28' } });
    // La plus forte s'applique : celle du cabinet, quand elle dépasse celle du groupe à la date de la période.
    const date = plusJours(jour, 30);
    expect((await preparer({ code: 'cabinet', taux: 25, mois: 12, aPartirDu: date, motif: 'Vingt-cinq pour les cabinets' })).statut).toBe(201);
    expect(await remiseDe(venue, date)).toMatchObject({ nature: 'cabinet', taux: 25, aussi: { nature: 'groupe', taux: 20 } });
    expect(await remiseDe(venue, plusJours(date, -1))).toMatchObject({ nature: 'groupe', taux: 20, aussi: { nature: 'cabinet', taux: 20 } });
    expect((await retirer({ code: 'cabinet', aPartirDu: date, motif: 'Fin de l\'essai' })).statut).toBe(200);
    // Le client lit celle qui s'applique, sans le nom de la société de tête, ni l'autre remise.
    const ent = await admin.query('update plateforme.abonnement set paye_jusqu_au = $2, offre = \'essentiel\', periodicite = \'annuel\' where entreprise = $1', [venue, plusJours(jour, 9)]);
    expect(ent.rowCount).toBe(1);
    expect((await appeler('GET', `/entreprises/${venue}/abonnement`, p.jeton)).corps.remise).toEqual({ nature: 'groupe', taux: 20, groupe: 'Garages Réunis', cabinet: null, jusquAu: null });
  });
});

describe('la facture d\'une période porte la remise de son premier jour, sur tout son hors taxes', () => {
  it('l\'aperçu dit la remise et son montant ; le brouillon la porte (taux, note) ; la base la rejoue et la garde', async () => {
    await admin.query('delete from plateforme.facture_abonnement');
    await admin.query('delete from plateforme.editeur');
    const editeur = await nouvelle(amira.appli, 'SkanFact Éditions SARL');
    expect((await appeler('POST', '/console/reglages/factures/editeur', amira.console, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
    await appeler('GET', `/entreprises/${editeur}/dossier-v10`, amira.appli);
    const p = await inscrire('nadia');
    const tete = await nouvelle(p.jeton, 'Pharmacie Mère');
    const fille = await nouvelle(p.jeton, 'Pharmacie Fille');
    await paye(tete, '2025-09-01', '2025-08-30');
    expect((await appeler('POST', '/console/groupes', amira.console, { nom: 'Pharmacies Nadia', entreprises: [tete, fille], motif: 'Les deux pharmacies de Nadia' })).statut).toBe(201);
    // La fille sort de son essai dans dix jours : sa période commence le onzième, au prix de Complet, 690 HT à l'année.
    await admin.query('update plateforme.abonnement set essai_jusqu_au = $2 where entreprise = $1', [fille, plusJours(jour, 10)]);
    const chemin = `/console/entreprises/${fille}/factures`;
    const a = await appeler('POST', chemin, amira.console, { offre: 'complet', periodicite: 'annuel', motif: '', apercu: true });
    expect(a.statut, JSON.stringify(a.corps)).toBe(200);
    // 690 − 20 % = 552 HT ; TVA 19 % : 104,880 ; le timbre : 657,880.
    expect(a.corps.facture).toMatchObject({ debut: plusJours(jour, 11), brutHt: '690.000', montantHt: '552.000',
      remise: { nature: 'groupe', taux: 20, groupe: 'Pharmacies Nadia', montantHt: '138.000' },
      ceQueDira: { ht: '552.000', tva: '104.880', timbre: '1.000', net: '657.880' } });
    const r = await appeler('POST', chemin, amira.console, { offre: 'complet', periodicite: 'annuel', motif: 'Première année de la fille' });
    expect(r.statut, JSON.stringify(r.corps)).toBe(201);
    const debut = plusJours(jour, 11);
    const piece = (await admin.query('select contenu from socle.dossier_v10 where entreprise = $1 and collection = \'documents\' and cle = $2', [editeur, `abonnement-${fille}-${debut}`])).rows[0]?.contenu as Corps;
    expect(piece).toMatchObject({ discountRate: 20, notes: 'Remise de groupe de 20 % (Pharmacies Nadia) : la première société abonnée du groupe paie le prix normal.' });
    expect((await admin.query('select montant_ht::text, remise_nature, remise_taux, remise_ht::text from plateforme.facture_abonnement where entreprise = $1', [fille])).rows)
      .toEqual([{ montant_ht: '552000', remise_nature: 'groupe', remise_taux: 20, remise_ht: '138000' }]);
    expect(await dernierGeste('factures.preparer', fille)).toMatchObject({ apres: { montantHt: '552.000', remise: { nature: 'groupe', taux: 20, montantHt: '138.000' } } });
    // La base rejoue le total, au nom d'Amira dans sa session de la console : un montant qui oublierait la remise est
    // refusé ; le bon passe.
    const session = (await admin.query(`select s.id, s.utilisateur from plateforme.session_console s join socle.utilisateur u on u.id = s.utilisateur
      where u.email = $1 and s.fermee_le is null order by s.ouverte_le desc limit 1`, [amira.email])).rows[0] as { id: string; utilisateur: string };
    const noter = async (montant: number) => {
      const k = await pool.connect();
      try {
        await k.query('begin');
        await k.query("select set_config('app.utilisateur', $1, true), set_config('app.session_console', $2, true)", [session.utilisateur, session.id]);
        await k.query(`select plateforme.console_noter_facture($1, $2, $3, 'complet', 'annuel', $4::date, $5::date, $6, 'Rejouer la facture', $7::date)`,
          [fille, `abonnement-${fille}-${debut}`, String(piece.clientId), debut, plusJours(plusMois(debut, 12), -1), montant, jour]);
      } finally { await k.query('rollback'); k.release(); }
    };
    await expect(noter(690000)).rejects.toThrow(/le total n'est pas celui de la grille au premier jour de la période/);
    await expect(noter(552000)).resolves.toBeUndefined();
    // La tête du groupe paie le prix normal.
    await admin.query('update plateforme.abonnement set essai_jusqu_au = $2 where entreprise = $1', [tete, plusJours(jour, 10)]);
    const t = await appeler('POST', `/console/entreprises/${tete}/factures`, amira.console, { offre: 'complet', periodicite: 'annuel', motif: '', apercu: true });
    expect(t.corps.facture).toMatchObject({ brutHt: '690.000', montantHt: '690.000', remise: null });
  });
});
