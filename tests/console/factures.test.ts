// Nos factures, première partie (14b ; docs/abonnement.md B1–B4 ; 0097), par l'API. Ce que le serveur garantit :
//   - l'entreprise SkanFact se désigne par la direction, et seulement une entreprise dont la personne est propriétaire ;
//     désignée, son abonnement passe « offert » ; une fois une facture préparée, elle ne se change plus ;
//   - « Préparer la facture » montre d'abord ce que la facture dira (le calcul de la v10, timbre compris), puis écrit la
//     fiche du client et le brouillon dans le dossier de l'entreprise SkanFact, au nom de la personne ; une seule pièce
//     par abonné et par période, et le prix est celui du jour ;
//   - la facture s'émet dans l'application de SkanFact, comme toute facture ; réglée en entier — et seulement alors —,
//     elle paie l'abonnement jusqu'à la fin de SA période, une fois, par un événement du système qui la nomme.

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
