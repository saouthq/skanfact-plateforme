// Nos factures, première partie (14b ; docs/abonnement.md B1–B4 ; 0097), par l'API. Ce que le serveur garantit :
//   - l'entreprise SkanFact se désigne par la direction, et seulement une entreprise dont la personne est propriétaire ;
//     désignée, son abonnement passe « offert » ; une fois une facture préparée, elle ne se change plus ;
//   - « Préparer la facture » montre d'abord ce que la facture dira (le calcul de la v10, timbre compris), puis écrit la
//     fiche du client et le brouillon dans le dossier de l'entreprise SkanFact, au nom de la personne ; une seule pièce
//     par abonné et par période, et le prix est celui du jour ;
//   - la facture s'émet dans l'application de SkanFact, comme toute facture ; réglée en entier — et seulement alors —,
//     elle paie l'abonnement jusqu'à la fin de SA période, une fois, par un événement du système qui la nomme ;
//   - l'argent juste (0113) : un mois offert va sur la prochaine facture (le support aussi, un sur douze mois) ; un
//     paiement reçu hors de la plateforme dit sa preuve et compte dans l'encaissé ; un module ouvert en cours se rattrape
//     au prorata, un module retiré part au renouvellement ; le renouvellement dit partout le chiffre de la facture ; une
//     facture payée puis défaite arrive dans « À décider ».

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { plusJours, plusMois } from '../../serveur/abonnement/etat.ts';
import { routesAbonnement } from '../../serveur/abonnement/routes.ts';
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
const horloge = new Date();
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} }, maintenant: () => horloge };
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'factures-')), 'veille.json');
const jour = aujourdhuiATunis(horloge);
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
// Une personne de l'équipe : sa session de l'application (elle peut être propriétaire d'une entreprise) et sa session de
// la console (le même compte).
async function membre(prenom: string, role: 'direction' | 'support') {
  const email = `factures-${prenom.toLowerCase()}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} Équipe`, motDePasse: MDP });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } });
  const appli = String(c.corps.jeton);
  const qui = await quiEst(ctx, appli);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, role, 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), horloge.getTime()) });
  expect(k.corps.etat, JSON.stringify(k.corps)).toBe('connecte');
  return { email, appli, console: String(k.corps.jeton) };
}
async function abonnee(nom: string, essaiDans: number) {
  const email = `factures-proprio${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `Proprio ${n}`, motDePasse: MDP });
  const jeton = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
  const id = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: nom })).corps.id);
  await admin.query('update plateforme.abonnement set essai_jusqu_au = $2::date + $3::int where entreprise = $1', [id, jour, essaiDans]);
  return { id, email };
}
const dossier = async (ent: string, jeton: string) =>
  (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as { collection: string; cle: string; rang: number | null; contenu: Corps; revision: number }[];
const ligneAbonnement = async (ent: string) =>
  (await admin.query('select essai_jusqu_au::text essai, paye_jusqu_au::text paye, offre, periodicite, offert from plateforme.abonnement where entreprise = $1', [ent])).rows[0] as
    { essai: string; paye: string | null; offre: string | null; periodicite: string | null; offert: boolean };

let direction: Awaited<ReturnType<typeof membre>>;
let bilal: Awaited<ReturnType<typeof membre>>;
let support: Awaited<ReturnType<typeof membre>>;
let editeur: string;

beforeAll(async () => {
  await admin.connect();
  // Le timbre fiscal du jour, comme sur le serveur (la règle commune) : sans lui, aucune facture ne s'émet.
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx), ...routesConsole(ctx, { veille }), ...routesAbonnement(ctx)]);
  await app.ready();
  direction = await membre('Amira', 'direction');
  bilal = await membre('Bilal', 'direction');
  support = await membre('Karim', 'support');
  // L'entreprise SkanFact : Amira en est la propriétaire (elle la crée dans l'application).
  editeur = String((await appeler('POST', '/entreprises', direction.appli, { raisonSociale: 'SkanFact Éditions SARL' })).corps.id);
  // Une seule entreprise SkanFact par base : les essais d'avant n'en laissent pas.
  await admin.query('delete from plateforme.facture_abonnement');
  await admin.query('delete from plateforme.editeur');
});
afterAll(async () => { await app.close(); await admin.end(); await pool.end(); });

describe('nos factures', () => {
  it('l\'entreprise SkanFact se désigne une fois, par sa propriétaire de la direction ; son abonnement passe offert', async () => {
    const avant = (await appeler('GET', '/console/reglages', direction.console)).corps.factures as { editeur: unknown; possibles: { entreprise: string }[] };
    expect(avant.editeur).toBeNull();
    expect(avant.possibles.map((p) => p.entreprise)).toContain(editeur);
    // Le support lit les réglages, il ne désigne pas ; une autre personne de la direction n'est pas propriétaire.
    expect((await appeler('POST', '/console/reglages/factures/editeur', support.console, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(403);
    const pasProprio = await appeler('POST', '/console/reglages/factures/editeur', bilal.console, { entreprise: editeur, motif: 'Nos factures naissent ici' });
    expect(pasProprio.statut).toBe(403);
    expect(String(pasProprio.corps.motif)).toMatch(/dont tu es propriétaire/);
    // Sans motif : refusé avant d'aller à la base.
    expect((await appeler('POST', '/console/reglages/factures/editeur', direction.console, { entreprise: editeur, motif: '' })).statut).toBe(400);
    const r = await appeler('POST', '/console/reglages/factures/editeur', direction.console, { entreprise: editeur, motif: 'Nos factures naissent ici' });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    const apres = (await appeler('GET', '/console/reglages', direction.console)).corps.factures as { editeur: { entreprise: string; proprietaire: boolean; factures: number } };
    expect(apres.editeur).toMatchObject({ entreprise: editeur, proprietaire: true, factures: 0 });
    // Elle ne se facture pas à elle-même : offerte, et l'événement le dit.
    expect((await ligneAbonnement(editeur)).offert).toBe(true);
    const ev = (await admin.query("select par, motif from plateforme.evenement_abonnement where entreprise = $1 and nature = 'offert'", [editeur])).rows;
    expect(ev).toEqual([{ par: 'exploitation', motif: 'l\'entreprise de SkanFact : elle ne se facture pas à elle-même' }]);
    const g = (await admin.query("select motif, apres from plateforme.geste_console where geste = 'factures.editeur' and entreprise = $1", [editeur])).rows;
    expect(g).toEqual([{ motif: 'Nos factures naissent ici', apres: { entreprise: editeur, raisonSociale: 'SkanFact Éditions SARL' } }]);
  });

  it('préparer : l\'aperçu dit ce que la facture dira ; le brouillon naît dans le dossier de SkanFact, une fois, au prix du jour', async () => {
    const b = await abonnee('Boulangerie Abonnée', 10);
    const chemin = `/console/entreprises/${b.id}/factures`;
    // Le support ne prépare pas de facture.
    expect((await appeler('POST', chemin, support.console, { offre: 'complet', periodicite: 'annuel', apercu: true, motif: '' })).statut).toBe(403);
    // La direction qui n'est pas propriétaire de l'entreprise SkanFact non plus : la base le dit.
    const autre = await appeler('POST', chemin, bilal.console, { offre: 'complet', periodicite: 'annuel', apercu: true, motif: '' });
    expect(autre.statut).toBe(403);
    expect(String(autre.corps.motif)).toMatch(/propriétaire de l'entreprise SkanFact/);
    // L'aperçu : la période suit l'essai (le lendemain de son dernier jour), elle se règle avant (la veille) ; 690 HT,
    // 19 % de TVA (la règle de l'entreprise SkanFact), le timbre d'un dinar : 822,100.
    const debut = plusJours(jour, 11);
    const fin = plusJours(plusMois(debut, 12), -1);
    const a = await appeler('POST', chemin, direction.console, { offre: 'complet', periodicite: 'annuel', apercu: true, motif: '' });
    expect(a.statut, JSON.stringify(a.corps)).toBe(200);
    expect(a.corps.facture).toMatchObject({ editeur, offre: 'complet', periodicite: 'annuel', debut, fin, echeance: plusJours(jour, 10), montantHt: '690.000',
      ceQueDira: { ht: '690.000', tva: '131.100', timbre: '1.000', ttc: '822.100', net: '822.100' } });
    // L'aperçu n'écrit rien.
    expect((await dossier(editeur, direction.appli)).filter((o) => o.collection === 'documents')).toEqual([]);
    // Sans motif, le geste est refusé.
    expect((await appeler('POST', chemin, direction.console, { offre: 'complet', periodicite: 'annuel', motif: '' })).statut).toBe(400);
    const p = await appeler('POST', chemin, direction.console, { offre: 'complet', periodicite: 'annuel', motif: 'Premier abonnement annuel' });
    expect(p.statut, JSON.stringify(p.corps)).toBe(201);
    const cle = `abonnement-${b.id}-${debut}`;
    const objets = await dossier(editeur, direction.appli);
    const piece = objets.find((o) => o.collection === 'documents' && o.cle === cle)?.contenu;
    const client = objets.find((o) => o.collection === 'clients' && o.cle === piece?.clientId)?.contenu;
    expect(client).toMatchObject({ name: 'Boulangerie Abonnée', email: b.email });
    expect(piece).toMatchObject({ type: 'facture', status: 'brouillon', number: '', date: jour, dueDate: plusJours(jour, 10), applyStamp: true, currency: 'DT',
      lines: [{ label: 'SkanFact Complet — abonnement annuel', qty: 1, unitPrice: 690, vatRate: 19 }] });
    // Une seconde fois : la même période, déjà préparée.
    const encore = await appeler('POST', chemin, direction.console, { offre: 'complet', periodicite: 'annuel', motif: 'Premier abonnement annuel' });
    expect(encore.statut).toBe(403);
    expect(String(encore.corps.motif)).toMatch(/déjà préparée/);
    // Le journal de la console et la fiche : préparée, à émettre ; et l'entreprise SkanFact ne se change plus.
    const g = (await admin.query("select motif, apres from plateforme.geste_console where geste = 'factures.preparer' and entreprise = $1", [b.id])).rows;
    expect(g).toEqual([{ motif: 'Premier abonnement annuel', apres: { offre: 'complet', periodicite: 'annuel', factureDu: debut, factureAu: fin, montantHt: '690.000', enPlus: [] } }]);
    const fiche = (await appeler('GET', `/console/entreprises/${b.id}`, direction.console)).corps.factures as { lignes: { etat: string; piece: string; ecran: string }[]; editeur: object };
    expect(fiche.lignes).toMatchObject([{ etat: 'a_emettre', piece: cle, ecran: `/v10/?e=${editeur}#/doc/${cle}` }]);
    // La liste fermée : une ligne dit la facture (son état, ses montants, où l'ouvrir), l'entreprise SkanFact qui elle est ;
    // jamais rien d'autre du dossier de SkanFact.
    expect(Object.keys(fiche.lignes[0] ?? {}).sort()).toEqual(['debut', 'decimales', 'devise', 'echeance', 'ecran', 'editeur', 'etat', 'fin', 'id',
      'montantHt', 'net', 'numero', 'offre', 'payeeLe', 'periodicite', 'piece', 'prepareLe', 'preparePar', 'reste']);
    expect(Object.keys(fiche.editeur).sort()).toEqual(['entreprise', 'factures', 'matricule', 'poseLe', 'posePar', 'proprietaire', 'raisonSociale']);
    const autreEd = String((await appeler('POST', '/entreprises', direction.appli, { raisonSociale: 'Autre Société SARL' })).corps.id);
    const change = await appeler('POST', '/console/reglages/factures/editeur', direction.console, { entreprise: autreEd, motif: 'Changer d\'avis' });
    expect(change.statut).toBe(403);
    expect(String(change.corps.motif)).toMatch(/ne se change plus/);
  });

  it('émise dans SkanFact puis réglée en entier, la facture paie l\'abonnement jusqu\'à la fin de sa période, une fois', async () => {
    const b = await abonnee('Pharmacie Abonnée', 3);
    expect((await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Abonnement mensuel' })).statut).toBe(201);
    const debut = plusJours(jour, 4);
    const fin = plusJours(plusMois(debut, 1), -1);
    const cle = `abonnement-${b.id}-${debut}`;
    let objets = await dossier(editeur, direction.appli);
    const brouillon = objets.find((o) => o.collection === 'documents' && o.cle === cle);
    const client = objets.find((o) => o.collection === 'clients' && o.cle === brouillon?.contenu.clientId)?.contenu;
    // 39 HT + 7,410 de TVA + 1 de timbre.
    const e = await appeler('POST', `/entreprises/${editeur}/dossier-v10/emettre`, direction.appli, { document: brouillon?.contenu, client, revision: brouillon?.revision, rang: brouillon?.rang ?? null, netAPayer: '47.410' });
    expect(e.statut, JSON.stringify(e.corps)).toBe(200);
    const fiche = async () => ((await appeler('GET', `/console/entreprises/${b.id}`, direction.console)).corps.factures as { lignes: { etat: string; reste: string | null; numero: string | null }[] }).lignes[0];
    expect(await fiche()).toMatchObject({ etat: 'a_payer', reste: '47.410' });
    const regler = async (paiements: unknown[]) => {
      objets = await dossier(editeur, direction.appli);
      const d = objets.find((o) => o.collection === 'documents' && o.cle === cle);
      const r = await appeler('POST', `/entreprises/${editeur}/dossier-v10`, direction.appli,
        { changements: [{ collection: 'documents', cle, rang: d?.rang ?? null, revision: d?.revision, contenu: { ...d?.contenu, payments: paiements } }] });
      expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    };
    // En partie : l'abonnement ne bouge pas.
    const avant = await ligneAbonnement(b.id);
    await regler([{ id: 'p1', date: jour, amount: 20, method: 'virement' }]);
    expect(await ligneAbonnement(b.id)).toEqual(avant);
    expect(await fiche()).toMatchObject({ etat: 'partielle', reste: '27.410' });
    // En entier : payé jusqu'à la fin de la période de la facture, à son offre ; l'événement du système la nomme.
    await regler([{ id: 'p1', date: jour, amount: 20, method: 'virement' }, { id: 'p2', date: jour, amount: { '~n': '27.41' }, method: 'virement' }]);
    expect(await ligneAbonnement(b.id)).toMatchObject({ paye: fin, offre: 'essentiel', periodicite: 'mensuel' });
    const numero = (await fiche())?.numero;
    expect(numero).toMatch(/^FAC-\d{4}-\d{3}$/);
    const ev = (await admin.query("select par, motif, apres->>'debut' debut, apres->>'fin' fin from plateforme.evenement_abonnement where entreprise = $1 and nature = 'paye'", [b.id])).rows;
    expect(ev).toEqual([{ par: 'systeme', motif: `facture ${numero} réglée`, debut, fin }]);
    expect(await fiche()).toMatchObject({ etat: 'payee', reste: '0.000' });
    // Une modification de plus de la pièce (une note de règlement) ne paie pas une seconde fois.
    await regler([{ id: 'p1', date: jour, amount: 20, method: 'virement', note: 'reçu' }, { id: 'p2', date: jour, amount: { '~n': '27.41' }, method: 'virement' }]);
    expect(Number((await admin.query("select count(*) n from plateforme.evenement_abonnement where entreprise = $1 and nature = 'paye'", [b.id])).rows[0].n)).toBe(1);
  });

  it('une facture que son avoir annule ne paie pas l\'abonnement, même réglée : la fiche la dit annulée', async () => {
    const b = await abonnee('Quincaillerie Abonnée', 5);
    expect((await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Abonnement mensuel' })).statut).toBe(201);
    const cle = `abonnement-${b.id}-${plusJours(jour, 6)}`;
    let objets = await dossier(editeur, direction.appli);
    const brouillon = objets.find((o) => o.collection === 'documents' && o.cle === cle);
    const client = objets.find((o) => o.collection === 'clients' && o.cle === brouillon?.contenu.clientId)?.contenu;
    const e = await appeler('POST', `/entreprises/${editeur}/dossier-v10/emettre`, direction.appli, { document: brouillon?.contenu, client, revision: brouillon?.revision, rang: brouillon?.rang ?? null, netAPayer: '47.410' });
    expect(e.statut, JSON.stringify(e.corps)).toBe(200);
    // L'avoir de toute la facture, timbre compris : elle ne doit plus rien.
    const avoir = {
      id: `avoir-${b.id}`, type: 'avoir', number: '', date: jour, clientId: brouillon?.contenu.clientId, creditOf: cle, creditReason: 'Abonnement annulé', status: 'brouillon',
      lines: [{ label: 'SkanFact Essentiel — abonnement mensuel', description: '', qty: 1, unit: '', unitPrice: 39, vatRate: 19 }],
      discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [],
    };
    const pose = await appeler('POST', `/entreprises/${editeur}/dossier-v10`, direction.appli, { changements: [{ collection: 'documents', cle: avoir.id, rang: null, revision: null, contenu: avoir }] });
    expect(pose.statut, JSON.stringify(pose.corps)).toBe(200);
    const ea = await appeler('POST', `/entreprises/${editeur}/dossier-v10/emettre-avoir`, direction.appli, { document: avoir, client, revision: 1, rang: null, netAPayer: '47.410' });
    expect(ea.statut, JSON.stringify(ea.corps)).toBe(200);
    // Le client avait déjà viré : le règlement se note, l'abonnement ne bouge pas.
    const avant = await ligneAbonnement(b.id);
    objets = await dossier(editeur, direction.appli);
    const d = objets.find((o) => o.collection === 'documents' && o.cle === cle);
    const r = await appeler('POST', `/entreprises/${editeur}/dossier-v10`, direction.appli,
      { changements: [{ collection: 'documents', cle, rang: d?.rang ?? null, revision: d?.revision, contenu: { ...d?.contenu, payments: [{ id: `p-${b.id}`, date: jour, amount: { '~n': '47.41' }, method: 'virement' }] } }] });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(await ligneAbonnement(b.id)).toEqual(avant);
    expect(Number((await admin.query("select count(*) n from plateforme.evenement_abonnement where entreprise = $1 and nature = 'paye'", [b.id])).rows[0].n)).toBe(0);
    const ligne = ((await appeler('GET', `/console/entreprises/${b.id}`, direction.console)).corps.factures as { lignes: { etat: string; payeeLe: string | null }[] }).lignes[0];
    expect(ligne).toMatchObject({ etat: 'annulee', payeeLe: null });
  });
});

describe('l\'argent juste (0113)', () => {
  // La preuve d'un paiement reçu hors de la plateforme, telle que la console la tape.
  const recu = (montant: string, moyen = 'cheque') => ({ facture: 'F-2026-118', montant, moyen, le: jour });
  const fiche = async (ent: string, jeton = direction.console) => (await appeler('GET', `/console/entreprises/${ent}`, jeton)).corps;
  const geste = async (ent: string, g: string, corps: Corps, jeton = direction.console) =>
    appeler('POST', `/console/entreprises/${ent}/abonnement/${g}`, jeton, { ligne: (await fiche(ent)).ligne, ...corps });
  const ligne = async (ent: string) => (await fiche(ent)).ligne as Corps;
  // Émettre dans SkanFact la facture préparée d'une période, puis la régler en entier.
  async function emettreEtRegler(ent: string, debut: string, net: string) {
    const cle = `abonnement-${ent}-${debut}`;
    let objets = await dossier(editeur, direction.appli);
    const brouillon = objets.find((o) => o.collection === 'documents' && o.cle === cle);
    const client = objets.find((o) => o.collection === 'clients' && o.cle === brouillon?.contenu.clientId)?.contenu;
    const e = await appeler('POST', `/entreprises/${editeur}/dossier-v10/emettre`, direction.appli, { document: brouillon?.contenu, client, revision: brouillon?.revision, rang: brouillon?.rang ?? null, netAPayer: net });
    expect(e.statut, JSON.stringify(e.corps)).toBe(200);
    objets = await dossier(editeur, direction.appli);
    const d = objets.find((o) => o.collection === 'documents' && o.cle === cle);
    const r = await appeler('POST', `/entreprises/${editeur}/dossier-v10`, direction.appli,
      { changements: [{ collection: 'documents', cle, rang: d?.rang ?? null, revision: d?.revision, contenu: { ...d?.contenu, payments: [{ id: `p-${ent}-${debut}`, date: jour, amount: { '~n': net }, method: 'virement' }] } }] });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    return { cle, client, contenu: d?.contenu };
  }

  it('un mois offert va sur la prochaine facture, qui couvre un mois de plus au même prix et le dit ; le support en offre un sur douze mois', async () => {
    const b = await abonnee('Librairie au Mois Offert', 3);
    // Essentiel au mois, payé d'un chèque : du lendemain de l'essai, pour un mois.
    const debut1 = plusJours(jour, 4);
    const fin1 = plusJours(plusMois(debut1, 1), -1);
    expect((await geste(b.id, 'payer', { motif: 'chèque reçu', offre: 'essentiel', periodicite: 'mensuel', paiement: recu('47,41') })).statut).toBe(200);
    // Le support offre le mois : rien ne s'allonge aujourd'hui, il attend la prochaine facture.
    const offert = await geste(b.id, 'offrir-mois', { motif: 'geste après la panne' }, support.console);
    expect(offert.statut, JSON.stringify(offert.corps)).toBe(200);
    expect(await ligne(b.id)).toMatchObject({ paye_jusqu_au: fin1, mois_offerts: 1 });
    const second = await geste(b.id, 'offrir-mois', { motif: 'encore un' }, support.console);
    expect(second.statut).toBe(403);
    expect(String(second.corps.motif)).toMatch(/un seul à la fois/);
    // La facture suivante le porte : deux mois au prix d'un, et sa période le dit.
    const debut2 = plusJours(fin1, 1);
    const fin2 = plusJours(plusMois(debut2, 2), -1);
    const apercu = await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: '', apercu: true });
    expect(apercu.corps.facture).toMatchObject({ debut: debut2, fin: fin2, moisOffert: true, montantHt: '39.000' });
    expect((await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Le mois suivant' })).statut).toBe(201);
    expect(await ligne(b.id)).toMatchObject({ mois_offerts: 0 });
    const fa = (await admin.query('select client_v10, mois_offert from plateforme.facture_abonnement where entreprise = $1', [b.id])).rows[0] as { client_v10: string; mois_offert: boolean };
    expect(fa.mois_offert).toBe(true);
    // La base garde le mois sur sa facture : la noter de nouveau sans lui est refusé.
    const session = (await admin.query(`select s.id, s.utilisateur from plateforme.session_console s join socle.utilisateur u on u.id = s.utilisateur
      where u.email = $1 and s.fermee_le is null order by s.ouverte_le desc limit 1`, [direction.email])).rows[0] as { id: string; utilisateur: string };
    const k = await pool.connect();
    try {
      await k.query('begin');
      await k.query("select set_config('app.utilisateur', $1, true), set_config('app.session_console', $2, true)", [session.utilisateur, session.id]);
      await expect(k.query('select plateforme.console_noter_facture($1, $2, $3, $4, $5, $6::date, $7::date, $8::bigint, $9, $10::date, false)',
        [b.id, `abonnement-${b.id}-${debut2}`, fa.client_v10, 'essentiel', 'mensuel', debut2, plusJours(plusMois(debut2, 1), -1), '39000', 'sans le mois offert', jour]))
        .rejects.toThrow(/un mois offert attend cette facture/);
    } finally { await k.query('rollback'); k.release(); }
    const { contenu } = await emettreEtRegler(b.id, debut2, '47.410');
    expect(String((contenu?.lines as Corps[])[0]?.description)).toMatch(/dont un mois offert/);
    expect(await ligne(b.id)).toMatchObject({ paye_jusqu_au: fin2, mois_offerts: 0 });
    // Un mois a été offert ces douze derniers mois : le support n'en offre pas un autre ; la direction, si.
    const encore = await geste(b.id, 'offrir-mois', { motif: 'un autre geste' }, support.console);
    expect(encore.statut).toBe(403);
    expect(String(encore.corps.motif)).toMatch(/douze derniers mois/);
    expect((await geste(b.id, 'offrir-mois', { motif: 'la direction l\'accorde' })).statut).toBe(200);
  });

  it('un paiement reçu hors de la plateforme dit sa preuve, case par case ; Paiements le compte dans l\'encaissé de son jour, sous son moyen', async () => {
    const b = await abonnee('Garage Payé Ailleurs', 2);
    const payer = (paiement: unknown) => geste(b.id, 'payer', { motif: 'virement reçu', offre: 'essentiel', periodicite: 'annuel', paiement });
    for (const [paiement, champ] of [[undefined, 'facture'], [{ ...recu('465,1'), facture: ' ' }, 'facture'], [recu('465,1O'), 'montant'], [recu('0'), 'montant'],
      [{ ...recu('465,1'), moyen: 'traite' }, 'moyen'], [{ ...recu('465,1'), le: plusJours(jour, 1) }, 'le'], [{ ...recu('465,1'), le: '2026-02-30' }, 'le']] as const) {
      const r = await payer(paiement);
      expect(r.statut, JSON.stringify(paiement)).toBe(400);
      expect(r.corps.champ).toBe(champ);
    }
    expect((await ligne(b.id)).paye_jusqu_au).toBeNull();
    const avant = (await appeler('GET', '/console/paiements', direction.console)).corps as { encaisse: { parMoyen: Record<string, string> }; horsPlateforme: { total: number } };
    expect((await payer(recu('465,1', 'virement'))).statut).toBe(200);
    const apres = (await appeler('GET', '/console/paiements', direction.console)).corps as { encaisse: { parMoyen: Record<string, string> };
      horsPlateforme: { total: number; lignes: { facture: string; montant: string; moyen: string; date: string; entreprise: { id: string } }[] } };
    expect(apres.horsPlateforme.total).toBe(avant.horsPlateforme.total + 1);
    expect(apres.horsPlateforme.lignes.find((l) => l.entreprise.id === b.id)).toMatchObject({ facture: 'F-2026-118', montant: '465.100', moyen: 'virement', date: jour });
    // 465,100 de plus par virement.
    const enMillimes = (v: string | undefined) => BigInt((v ?? '0').replace('.', ''));
    expect(enMillimes(apres.encaisse.parMoyen.virement) - enMillimes(avant.encaisse.parMoyen.virement)).toBe(465100n);
    // La base, elle aussi : un paiement sans sa preuve ne s'écrit pas, quel que soit le chemin.
    const session = (await admin.query(`select s.id, s.utilisateur from plateforme.session_console s join socle.utilisateur u on u.id = s.utilisateur
      where u.email = $1 and s.fermee_le is null order by s.ouverte_le desc limit 1`, [direction.email])).rows[0] as { id: string; utilisateur: string };
    const l = await ligne(b.id);
    const k = await pool.connect();
    try {
      await k.query('begin');
      await k.query("select set_config('app.utilisateur', $1, true), set_config('app.session_console', $2, true)", [session.utilisateur, session.id]);
      await expect(k.query('select plateforme.console_poser_abonnement($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::date)',
        [b.id, 'payer', 'sans preuve', JSON.stringify(l), JSON.stringify({ ...l, paye_jusqu_au: '2099-01-01' }), JSON.stringify({ debut: jour, fin: '2099-01-01' }), jour]))
        .rejects.toThrow(/rien n'est payé/);
    } finally { await k.query('rollback'); k.release(); }
  });

  it('un module ouvert en cours se rattrape au prorata sur la prochaine facture ; retiré, il part au renouvellement ; l\'échéance dit le chiffre de la facture', async () => {
    const b = await abonnee('Atelier Rattrapé', 3);
    // Essentiel à l'année, une période payée depuis dix jours : du J−10 au J+264, 275 jours (la grille a un prix à son
    // premier jour).
    const debut = plusJours(jour, -10);
    const fin = plusJours(jour, 264);
    await admin.query(`update plateforme.abonnement set essai_jusqu_au = $2::date - 1, paye_jusqu_au = $3, offre = 'essentiel', periodicite = 'annuel' where entreprise = $1`, [b.id, debut, fin]);
    await admin.query(`insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, avant, apres) values ($1, 'paye', 'exploitation', 'virement d''il y a dix jours', null, $2)`,
      [b.id, JSON.stringify({ debut, fin })]);
    expect((await geste(b.id, 'ouvrir-module', { motif: 'il lance sa paie', module: 'compta' })).statut).toBe(200);
    const facture = async () => ((await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'annuel', motif: '', apercu: true })).corps.facture as
      { montantHt: string; enPlus: { option: string; compte: number; inclus: number; prixHt: string; du?: string; au?: string }[] });
    // Ouvert aujourd'hui : 265 jours servis sur 275, au prix de l'année (150 DT) : 144,545 DT, une fois ; l'année suivante
    // le compte en entier.
    let f = await facture();
    expect(f.enPlus).toEqual(expect.arrayContaining([
      expect.objectContaining({ option: 'module_compta', prixHt: '150.000' }),
      expect.objectContaining({ option: 'rattrapage_compta', compte: 265, inclus: 275, prixHt: '144.545', du: jour, au: fin })]));
    expect(f.montantHt).toBe('684.545');
    // Deux chemins, un chiffre : l'échéance dit la prochaine facture ; « par an » de la liste, sans le rattrapage.
    const echeances = (await appeler('GET', '/console/abonnements?vue=actif&limite=200', direction.console)).corps as { lignes: { entreprise: { id: string }; montantHt: string | null }[] };
    expect(echeances.lignes.find((l) => l.entreprise.id === b.id)?.montantHt).toBe('684.545');
    const liste = (await appeler('GET', `/console/entreprises?q=${encodeURIComponent('Atelier Rattrapé')}&limite=50`, direction.console)).corps as { lignes: { societes: { id: string; parAn: { montantHt: string } | null }[] }[] };
    expect(liste.lignes.flatMap((o) => o.societes).find((e) => e.id === b.id)?.parAn?.montantHt).toBe('540.000');
    // Retiré : il reste ouvert jusqu'au J+264 ; la prochaine facture ne le compte plus, le rattrapage de cette année reste.
    expect((await geste(b.id, 'fermer-module', { motif: 'la paie attendra', module: 'compta' })).statut).toBe(200);
    expect(await ligne(b.id)).toMatchObject({ modules: ['compta'], modules_a_retirer: ['compta'] });
    f = await facture();
    expect(f.enPlus.map((l) => l.option)).toEqual(['rattrapage_compta']);
    expect(f.montantHt).toBe('534.545');
    // Rouvert avant de partir : le retrait s'annule ; ce n'est pas un second achat.
    expect((await geste(b.id, 'ouvrir-module', { motif: 'finalement oui', module: 'compta' })).statut).toBe(200);
    expect(await ligne(b.id)).toMatchObject({ modules: ['compta'], modules_a_retirer: [] });
    expect((await facture()).montantHt).toBe('684.545');
  });

  it('payée avant son premier jour, la période attend son jour : celle qui court va au bout avec ce qu\'elle avait (l\'audit C01)', async () => {
    const b = await abonnee('Garage Payé d\'Avance', 2);
    // Essentiel au mois, la Comptabilité achetée seule, payé jusqu'au J+2 ; la Comptabilité part au renouvellement.
    const fin = plusJours(jour, 2);
    await admin.query(`update plateforme.abonnement set essai_jusqu_au = $2::date - 40, paye_jusqu_au = $2, offre = 'essentiel', periodicite = 'mensuel',
      modules = '{compta}', modules_a_retirer = '{compta}' where entreprise = $1`, [b.id, fin]);
    const debut = plusJours(fin, 1);
    expect((await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Le mois qui vient' })).statut).toBe(201);
    await emettreEtRegler(b.id, debut, '47.410');
    // Réglée aujourd'hui pour une période qui commence au J+3 : la Comptabilité sert jusqu'au J+2 inclus.
    expect(await ligne(b.id)).toMatchObject({ paye_jusqu_au: plusJours(plusMois(debut, 1), -1), offre: 'essentiel', modules: ['compta'], modules_a_retirer: [],
      a_venir_le: debut, a_venir_offre: 'essentiel', a_venir_periodicite: 'mensuel', a_venir_retraits: ['compta'] });
    // Elle ne se rouvre pas d'ici là : la période payée l'a comptée sans elle.
    const rouvrir = await geste(b.id, 'ouvrir-module', { motif: 'finalement oui', module: 'compta' });
    expect([rouvrir.statut, rouvrir.corps.motif]).toEqual([403, expect.stringMatching(/part le .* avec la période déjà payée/)]);
    // La veille du premier jour, rien ne bascule ; le jour même, la Comptabilité part, et l'histoire le dit.
    expect((await admin.query('select plateforme.basculer_abonnement($1, $2::date) b', [b.id, fin])).rows[0]?.b).toBe(false);
    expect((await admin.query('select plateforme.basculer_abonnements($1::date) n', [fin])).rows[0]?.n).toBe(0);
    expect(await ligne(b.id)).toMatchObject({ modules: ['compta'] });
    await admin.query('select plateforme.basculer_abonnements($1::date) n', [debut]);
    expect(await ligne(b.id)).toMatchObject({ modules: [], a_venir_le: null, a_venir_offre: null, a_venir_retraits: [] });
    expect((await admin.query(`select count(*)::int n from plateforme.evenement_abonnement where entreprise = $1 and nature = 'periode_commencee'`, [b.id])).rows[0]?.n).toBe(1);
  });

  it('deux périodes payées d\'avance (l\'audit 1.42.0, A01) : un second changement ne se prépare pas ; arrivé quand même, le premier attend seul', async () => {
    const b = await abonnee('Quincaillerie Deux Avances', 2);
    // Complet au mois, payé jusqu'au J+2 ; le mois qui vient, payé d'avance en Essentiel : Essentiel attend le J+3.
    const fin = plusJours(jour, 2);
    await admin.query(`update plateforme.abonnement set essai_jusqu_au = $2::date - 40, paye_jusqu_au = $2, offre = 'complet', periodicite = 'mensuel' where entreprise = $1`, [b.id, fin]);
    const debut = plusJours(fin, 1);
    expect((await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Le mois qui vient' })).statut).toBe(201);
    await emettreEtRegler(b.id, debut, '47.410');
    const suivant = plusMois(debut, 1);
    expect(await ligne(b.id)).toMatchObject({ offre: 'complet', paye_jusqu_au: plusJours(suivant, -1), a_venir_le: debut, a_venir_offre: 'essentiel' });
    // Le mois d'après en Complet : un second changement, à une autre date — la facture ne se prépare pas.
    const refus = await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'complet', periodicite: 'mensuel', motif: 'Le mois d\'après' });
    expect([refus.statut, refus.corps.motif]).toEqual([403, expect.stringMatching(/^Une période déjà payée attend son premier jour, le .*, en Essentiel/)]);
    expect((await admin.query('select count(*)::int n from plateforme.facture_abonnement where entreprise = $1', [b.id])).rows[0]?.n).toBe(1);
    // En Essentiel, elle se prépare : le même changement, qui garde son jour.
    expect((await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Le mois d\'après' })).statut).toBe(201);
    // Ce qui attend change entre la préparation et le règlement (deux personnes, deux gestes) : réglée quand même, la
    // facture paie sa période ; le premier changement attend seul, à son jour, et l'histoire dit qu'il reste à régler.
    await admin.query(`update plateforme.abonnement set a_venir_offre = 'complet', a_venir_periodicite = 'annuel' where entreprise = $1`, [b.id]);
    await emettreEtRegler(b.id, suivant, '47.410');
    expect(await ligne(b.id)).toMatchObject({ paye_jusqu_au: plusJours(plusMois(suivant, 1), -1), a_venir_le: debut, a_venir_offre: 'complet', a_venir_periodicite: 'annuel' });
    const dernier = (await admin.query(`select apres from plateforme.evenement_abonnement where entreprise = $1 and nature = 'paye' order by le desc, id desc limit 1`, [b.id])).rows[0]?.apres;
    expect(dernier).toMatchObject({ aRegler: 'deux_changements', offrePayee: 'essentiel', periodicitePayee: 'mensuel' });
  });

  it('une période payée d\'avance qui ne change rien, puis une autre qui change l\'offre, par leurs factures : le changement attend le jour de la seconde (l\'audit 1.42.0, A01)', async () => {
    const b = await abonnee('Boulangerie Deux Mois', 2);
    const fin = plusJours(jour, 2);
    await admin.query(`update plateforme.abonnement set essai_jusqu_au = $2::date - 40, paye_jusqu_au = $2, offre = 'essentiel', periodicite = 'mensuel' where entreprise = $1`, [b.id, fin]);
    const debut = plusJours(fin, 1);
    expect((await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Le mois qui vient' })).statut).toBe(201);
    await emettreEtRegler(b.id, debut, '47.410');
    const suivant = plusMois(debut, 1);
    // Le mois d'après en Complet, par sa facture : son net, celui que la facture dira (le hors-taxes, la TVA à 19 %, le timbre).
    const apercu = (await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'complet', periodicite: 'mensuel', motif: '', apercu: true })).corps.facture as { montantHt: string };
    const net = ((Math.round(Number(apercu.montantHt) * 1000 * 1.19) + 1000) / 1000).toFixed(3);
    expect((await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'complet', periodicite: 'mensuel', motif: 'Le mois d\'après' })).statut).toBe(201);
    await emettreEtRegler(b.id, suivant, net);
    // Le mois qui vient reste en Essentiel : Complet attend SON premier jour, jamais celui d'avant.
    expect(await ligne(b.id)).toMatchObject({ offre: 'essentiel', a_venir_le: suivant, a_venir_offre: 'complet', a_venir_periodicite: 'mensuel' });
  });

  it('un paiement reçu ailleurs pour la période qui vient : l\'offre payée attend son jour ; la même facture ne paie pas deux fois', async () => {
    const b = await abonnee('Librairie Payée d\'Avance', 2);
    // Complet à l'année jusqu'au J+5 ; le client passe à Essentiel pour l'année qui vient, et paie dès aujourd'hui.
    await admin.query(`update plateforme.abonnement set essai_jusqu_au = $2::date - 400, paye_jusqu_au = $2, offre = 'complet', periodicite = 'annuel' where entreprise = $1`,
      [b.id, plusJours(jour, 5)]);
    const r = await geste(b.id, 'payer', { motif: 'virement pour l\'année qui vient', offre: 'essentiel', periodicite: 'annuel', paiement: { facture: 'F-2026-201', montant: '464,100', moyen: 'virement', le: jour } });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    expect(await ligne(b.id)).toMatchObject({ offre: 'complet', a_venir_le: plusJours(jour, 6), a_venir_offre: 'essentiel', a_venir_periodicite: 'annuel' });
    expect((await fiche(b.id)).etat).toMatchObject({ etat: 'actif', offre: 'complet' });
    const encore = await geste(b.id, 'payer', { motif: 'noté une seconde fois', offre: 'essentiel', periodicite: 'annuel', paiement: { facture: 'f-2026-201 ', montant: '464,100', moyen: 'virement', le: jour } });
    expect([encore.statut, encore.corps.motif]).toEqual([403, expect.stringMatching(/déjà noté/)]);
  });

  it('une facture payée puis défaite par son avoir arrive dans « À décider » et dans Paiements : l\'abonnement a couru sur elle', async () => {
    const b = await abonnee('Pharmacie Défaite', 2);
    const debut = plusJours(jour, 3);
    expect((await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Abonnement mensuel' })).statut).toBe(201);
    const { cle, client } = await emettreEtRegler(b.id, debut, '47.410');
    expect((await ligne(b.id)).paye_jusqu_au).toBe(plusJours(plusMois(debut, 1), -1));
    const accueil = async () => ((await appeler('GET', '/console/accueil', direction.console)).corps.decider as { sorte: string; entreprise?: { id: string } }[])
      .filter((l) => l.entreprise?.id === b.id).map((l) => l.sorte);
    expect(await accueil()).not.toContain('facture_defaite');
    const avoir = {
      id: `avoir-${b.id}`, type: 'avoir', number: '', date: jour, clientId: (client as Corps).id, creditOf: cle, creditReason: 'Abonnement annulé', status: 'brouillon',
      lines: [{ label: 'SkanFact Essentiel — abonnement mensuel', description: '', qty: 1, unit: '', unitPrice: 39, vatRate: 19 }],
      discountRate: 0, applyStamp: true, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [],
    };
    expect((await appeler('POST', `/entreprises/${editeur}/dossier-v10`, direction.appli, { changements: [{ collection: 'documents', cle: avoir.id, rang: null, revision: null, contenu: avoir }] })).statut).toBe(200);
    const ea = await appeler('POST', `/entreprises/${editeur}/dossier-v10/emettre-avoir`, direction.appli, { document: avoir, client, revision: 1, rang: null, netAPayer: '47.410' });
    expect(ea.statut, JSON.stringify(ea.corps)).toBe(200);
    // Une seule ligne : la facture défaite par son avoir, qui dit ce qui est à rendre — pas un trop-perçu à part.
    expect(await accueil()).toEqual(['facture_defaite']);
    const p = (await appeler('GET', '/console/paiements', direction.console)).corps as { defaites: { entreprise: { id: string }; fin: string; cause: string }[] };
    expect(p.defaites.find((d) => d.entreprise.id === b.id)).toMatchObject({ fin: plusJours(plusMois(debut, 1), -1), cause: 'avoir' });
    // Le support ne lit pas l'argent de SkanFact.
    const auSupport = ((await appeler('GET', '/console/accueil', support.console)).corps.decider as { sorte: string }[]).map((l) => l.sorte);
    expect(auSupport).not.toContain('facture_defaite');
  });

  it('(1.83.0) un abonnement payé qui finit bientôt sans facture suivante est « à facturer » ; préparée, puis émise sans être payée, la ligne s\'éteint', async () => {
    const b = await abonnee('Papeterie à Renouveler', 2);
    const debut = plusJours(jour, 3);
    expect((await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Abonnement mensuel' })).statut).toBe(201);
    await emettreEtRegler(b.id, debut, '47.410');
    // Le temps a passé : la période payée finit dans huit jours.
    await admin.query('update plateforme.abonnement set essai_jusqu_au = $2::date - 30, paye_jusqu_au = $2::date + 8 where entreprise = $1', [b.id, jour]);
    const accueil = async () => ((await appeler('GET', '/console/accueil', direction.console)).corps.decider as { sorte: string; entreprise?: { id: string }; jusquAu?: string }[])
      .filter((l) => l.entreprise?.id === b.id);
    expect(await accueil()).toMatchObject([{ sorte: 'a_facturer', jusquAu: plusJours(jour, 8), jours: 8, offre: 'essentiel', periodicite: 'mensuel' }]);
    // La fiche le dit aussi, par la même fonction.
    expect(((await fiche(b.id)).attend as { sorte: string }[]).map((a) => a.sorte)).toContain('a_facturer');
    // Le support ne facture pas.
    expect(((await appeler('GET', '/console/accueil', support.console)).corps.decider as { sorte: string; entreprise?: { id: string } }[])
      .filter((l) => l.entreprise?.id === b.id).map((l) => l.sorte)).not.toContain('a_facturer');
    // Préparée pour la période qui suit : la ligne s'éteint ; émise et pas encore payée, elle reste éteinte.
    const suivante = plusJours(jour, 9);
    const p2 = await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Renouvellement' });
    expect(p2.statut, JSON.stringify(p2.corps)).toBe(201);
    expect((await accueil()).map((l) => l.sorte)).toEqual([]);
    const objets = await dossier(editeur, direction.appli);
    const brouillon = objets.find((o) => o.collection === 'documents' && o.cle === `abonnement-${b.id}-${suivante}`);
    expect(brouillon, 'le brouillon de la période qui suit').toBeTruthy();
    const client = objets.find((o) => o.collection === 'clients' && o.cle === brouillon?.contenu.clientId)?.contenu;
    const e = await appeler('POST', `/entreprises/${editeur}/dossier-v10/emettre`, direction.appli, { document: brouillon?.contenu, client, revision: brouillon?.revision, rang: brouillon?.rang ?? null, netAPayer: '47.410' });
    expect(e.statut, JSON.stringify(e.corps)).toBe(200);
    expect((await accueil()).map((l) => l.sorte)).toEqual([]);
  });

  it('un avoir qui annule tout sauf le timbre défait aussi la facture : une ligne, pas un trop-perçu à part (0114)', async () => {
    const b = await abonnee('Pharmacie Sans Timbre', 2);
    const debut = plusJours(jour, 3);
    expect((await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Abonnement mensuel' })).statut).toBe(201);
    const { cle, client } = await emettreEtRegler(b.id, debut, '47.410');
    // L'avoir de l'abonnement, sans le timbre (46,410 DT) : le timbre d'un avoir est À VÉRIFIER avec le comptable.
    const avoir = {
      id: `avoir-${b.id}`, type: 'avoir', number: '', date: jour, clientId: (client as Corps).id, creditOf: cle, creditReason: 'Abonnement annulé', status: 'brouillon',
      lines: [{ label: 'SkanFact Essentiel — abonnement mensuel', description: '', qty: 1, unit: '', unitPrice: 39, vatRate: 19 }],
      discountRate: 0, applyStamp: false, withholdingRate: 0, currency: 'DT', exchangeRate: '', payments: [],
    };
    expect((await appeler('POST', `/entreprises/${editeur}/dossier-v10`, direction.appli, { changements: [{ collection: 'documents', cle: avoir.id, rang: null, revision: null, contenu: avoir }] })).statut).toBe(200);
    const ea = await appeler('POST', `/entreprises/${editeur}/dossier-v10/emettre-avoir`, direction.appli, { document: avoir, client, revision: 1, rang: null, netAPayer: '46.410' });
    expect(ea.statut, JSON.stringify(ea.corps)).toBe(200);
    const decider = ((await appeler('GET', '/console/accueil', direction.console)).corps.decider as { sorte: string; entreprise?: { id: string }; cause?: string; trop?: string | null }[])
      .filter((l) => l.entreprise?.id === b.id);
    expect(decider).toEqual([expect.objectContaining({ sorte: 'facture_defaite', cause: 'avoir', trop: '46.410' })]);
    const p = (await appeler('GET', '/console/paiements', direction.console)).corps as { defaites: { entreprise: { id: string }; cause: string }[]; trop: { entreprise: { id: string }; annulee: boolean; trop: string }[] };
    expect(p.defaites.find((d) => d.entreprise.id === b.id)).toMatchObject({ cause: 'avoir' });
    expect(p.trop.find((t) => t.entreprise.id === b.id)).toMatchObject({ annulee: true, trop: '46.410' });
  });
});

describe('l\'offre choisie dans l\'application (1.84.0, 0158)', () => {
  it('la propriétaire choisit ; la console la voit dans « À décider » et prépare la facture sur elle ; préparée, le choix s\'éteint', async () => {
    // Une propriétaire, son entreprise en essai, et une commerciale de son équipe.
    const email = `choix-proprio-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await appeler('POST', '/inscription', undefined, { email, nom: 'Hela Choix', motDePasse: MDP });
    const hela = String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const ent = String((await appeler('POST', '/entreprises', hela, { raisonSociale: 'Droguerie du Choix' })).corps.id);
    await admin.query('update plateforme.abonnement set essai_jusqu_au = $2::date + 10 where entreprise = $1', [ent, jour]);
    const emailC = `choix-commerciale-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
    await appeler('POST', '/inscription', undefined, { email: emailC, nom: 'Commerciale', motDePasse: MDP });
    const commerciale = String((await appeler('POST', '/connexion', undefined, { email: emailC, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const inv = String((await appeler('POST', `/entreprises/${ent}/invitations`, hela, { email: emailC, roles: ['commercial'] })).corps.jeton);
    expect((await appeler('POST', '/invitations/accepter', commerciale, { jeton: inv })).statut).toBe(200);
    // Avant : rien de choisi ; elle peut choisir.
    const avant = (await appeler('GET', `/entreprises/${ent}/abonnement`, hela)).corps;
    expect(avant).toMatchObject({ choix: null, peutChoisir: true });
    // La commerciale ne choisit pas ; une offre inconnue est refusée.
    expect((await appeler('POST', `/entreprises/${ent}/abonnement/choisir`, commerciale, { offre: 'complet', periodicite: 'annuel' })).statut).toBe(403);
    expect((await appeler('POST', `/entreprises/${ent}/abonnement/choisir`, hela, { offre: 'premium', periodicite: 'annuel' })).statut).toBe(400);
    // Elle choisit Essentiel au mois, puis se ravise : Complet à l'année. Le dernier choix compte.
    expect((await appeler('POST', `/entreprises/${ent}/abonnement/choisir`, hela, { offre: 'essentiel', periodicite: 'mensuel' })).statut).toBe(201);
    const c = await appeler('POST', `/entreprises/${ent}/abonnement/choisir`, hela, { offre: 'complet', periodicite: 'annuel' });
    expect(c.statut, JSON.stringify(c.corps)).toBe(201);
    expect(c.corps.choix).toMatchObject({ offre: 'complet', periodicite: 'annuel', par: 'Hela Choix' });
    expect((await appeler('GET', `/entreprises/${ent}/abonnement`, hela)).corps.choix).toMatchObject({ offre: 'complet', periodicite: 'annuel' });
    // Un choix ne se réécrit pas.
    await expect(admin.query('update plateforme.offre_choisie set offre = \'essentiel\' where entreprise = $1', [ent])).rejects.toThrow(/ne se modifie/);
    // La console (la direction) : une ligne, qui dit qui a choisi quoi ; elle tient lieu de « à facturer ». Le support ne la lit pas.
    const lignes = async (jeton = direction.console) => ((await appeler('GET', '/console/accueil', jeton)).corps.decider as { sorte: string; entreprise?: { id: string } }[])
      .filter((l) => l.entreprise?.id === ent);
    expect(await lignes()).toMatchObject([{ sorte: 'offre_choisie', offre: 'complet', periodicite: 'annuel', par: 'Hela Choix' }]);
    expect((await lignes(support.console)).map((l) => l.sorte)).not.toContain('offre_choisie');
    expect(((await appeler('GET', `/console/entreprises/${ent}`, direction.console)).corps.attend as { sorte: string }[]).map((a) => a.sorte)).toContain('offre_choisie');
    // La facture préparée sur ce choix l'éteint, des deux côtés.
    const f = await appeler('POST', `/console/entreprises/${ent}/factures`, direction.console, { offre: 'complet', periodicite: 'annuel', motif: 'Choisie dans l\'application' });
    expect(f.statut, JSON.stringify(f.corps)).toBe(201);
    expect((await lignes()).map((l) => l.sorte)).not.toContain('offre_choisie');
    expect((await appeler('GET', `/entreprises/${ent}/abonnement`, hela)).corps.choix).toBeNull();
  });

  it('une facture qui attend son paiement passe d\'abord : choisir est refusé, avec son numéro ; une entreprise offerte n\'a rien à choisir', async () => {
    const b = await abonnee('Mercerie à Facture Ouverte', 2);
    const proprio = String((await appeler('POST', '/connexion', undefined, { email: b.email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
    const debut = plusJours(jour, 3);
    expect((await appeler('POST', `/console/entreprises/${b.id}/factures`, direction.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Abonnement mensuel' })).statut).toBe(201);
    const objets = await dossier(editeur, direction.appli);
    const brouillon = objets.find((o) => o.collection === 'documents' && o.cle === `abonnement-${b.id}-${debut}`);
    const client = objets.find((o) => o.collection === 'clients' && o.cle === brouillon?.contenu.clientId)?.contenu;
    const e = await appeler('POST', `/entreprises/${editeur}/dossier-v10/emettre`, direction.appli, { document: brouillon?.contenu, client, revision: brouillon?.revision, rang: brouillon?.rang ?? null, netAPayer: '47.410' });
    expect(e.statut, JSON.stringify(e.corps)).toBe(200);
    const refus = await appeler('POST', `/entreprises/${b.id}/abonnement/choisir`, proprio, { offre: 'complet', periodicite: 'annuel' });
    expect(refus.statut).toBe(409);
    expect(String(refus.corps.motif)).toContain(`Ta facture ${String(e.corps.numero)} attend déjà son paiement`);
    // SkanFact elle-même (offerte) n'a pas d'abonnement à choisir.
    const offerte = await appeler('POST', `/entreprises/${editeur}/abonnement/choisir`, direction.appli, { offre: 'complet', periodicite: 'annuel' });
    expect(offerte.statut).toBe(403);
    expect(String(offerte.corps.motif)).toMatch(/n'a pas d'abonnement à choisir/);
  });
});
