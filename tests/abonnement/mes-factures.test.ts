// Nos factures, seconde partie (14b ; docs/abonnement.md B5 ; 0098), par l'API, avec un Konnect simulé
// (tests/konnect-simule.ts). Ce que le serveur garantit :
//   - « Ton abonnement » montre à qui le gère (le propriétaire, un administrateur) les factures que l'entreprise SkanFact
//     lui a ÉMISES — jamais un brouillon, jamais celles d'un autre abonné —, chacune réduite à ce qu'elle imprime (les
//     listes fermées de l'espace client), avec son reste et son état ; un autre rôle ne les lit pas ;
//   - « Payer en ligne » demande le RESTE de SA facture, sur le portefeuille de l'entreprise SkanFact ; deux clics ne font
//     pas deux paiements ; prouvé chez Konnect, le règlement s'ajoute à la facture, et l'abonnement suit jusqu'à la fin
//     de sa période (B4) — même en lecture seule : c'est elle qui rouvre ; la facture d'un autre ne se paie pas d'ici.

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ajouter as ajouterALEquipe } from '../../base/equipe.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool } from '../../serveur/base.ts';
import { CLE_DU_COFFRE_D_ESSAI } from '../../serveur/coffre.ts';
import { plusJours, plusMois } from '../../serveur/abonnement/etat.ts';
import { routesAbonnement } from '../../serveur/abonnement/routes.ts';
import { mettreEnPlaceCode, quiEst, type Contexte } from '../../serveur/connexion.ts';
import { routesConsole } from '../../serveur/console/routes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { codeTotp, depuisBase32 } from '../../serveur/totp.ts';
import { routesV10 } from '../../serveur/v10/routes.ts';
import { CHAMPS_CLIENT, CHAMPS_PIECE, CHAMPS_SOCIETE } from '../../serveur/ventes/espace.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';
import { konnectSimule } from '../konnect-simule.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mes-factures-')), 'veille.json');
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
const adresse = (qui: string) => `mes-factures-${qui}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
async function connecter(email: string) {
  return String((await appeler('POST', '/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Poste', type: 'navigateur' } })).corps.jeton);
}
// Amira, de la direction : sa session de l'application (elle est propriétaire de l'entreprise SkanFact) et de la console.
async function direction() {
  const email = adresse('amira');
  await appeler('POST', '/inscription', undefined, { email, nom: 'Amira Équipe', motDePasse: MDP });
  const appli = await connecter(email);
  const qui = await quiEst(ctx, appli);
  if (!qui) throw new Error('session attendue');
  const { secret } = await mettreEnPlaceCode(ctx, qui, 'application');
  await ajouterALEquipe(admin, email, 'direction', 'mise en place des essais');
  const r = await appeler('POST', '/console/connexion', undefined, { email, motDePasse: MDP, appareil: { nom: 'Bureau', type: 'navigateur' } });
  const k = await appeler('POST', '/console/connexion/code', undefined, { defi: r.corps.defi, code: codeTotp(depuisBase32(secret ?? ''), Date.now()) });
  expect(k.corps.etat, JSON.stringify(k.corps)).toBe('connecte');
  return { appli, console: String(k.corps.jeton) };
}
// Une entreprise abonnée : sa propriétaire (connectée), et le jour où son essai finit.
async function abonnee(nom: string, essaiDans: number) {
  const email = adresse('proprio');
  await appeler('POST', '/inscription', undefined, { email, nom: `Proprio ${n}`, motDePasse: MDP });
  const jeton = await connecter(email);
  const id = String((await appeler('POST', '/entreprises', jeton, { raisonSociale: nom })).corps.id);
  await admin.query('update plateforme.abonnement set essai_jusqu_au = $2::date + $3::int where entreprise = $1', [id, jour, essaiDans]);
  return { id, jeton };
}
type Objet = { collection: string; cle: string; rang: number | null; contenu: Corps; revision: number };
const dossier = async (ent: string, jeton: string) => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];
const ligneAbonnement = async (ent: string) =>
  (await admin.query('select paye_jusqu_au::text paye, offre, periodicite from plateforme.abonnement where entreprise = $1', [ent])).rows[0] as { paye: string | null; offre: string | null; periodicite: string | null };
type Piece = { type: string; numero: string; net: string; reste: string | null; statut: string | null; payable: boolean; document: Corps; periode: Corps | null };
type Factures = { entreprise: Corps; client: Corps; pieces: Piece[] } | null;
const sesFactures = async (b: { id: string; jeton: string }) => {
  const r = await appeler('GET', `/entreprises/${b.id}/abonnement`, b.jeton);
  expect(r.statut, JSON.stringify(r.corps)).toBe(200);
  return { factures: r.corps.factures as Factures, enLigne: r.corps.enLigne };
};

let amira: Awaited<ReturnType<typeof direction>>;
let editeur: string;
const PORTEFEUILLE = `portefeuille-skanfact-${Date.now()}`;
const COMPTABLE = 'cabinet-de-skanfact@exemple.tn';

// Préparer (la console) puis émettre (l'application de SkanFact) la facture d'un abonnement Essentiel au mois : 39 HT,
// 7,410 de TVA, 1 de timbre.
async function facturer(b: { id: string }, debut: string) {
  expect((await appeler('POST', `/console/entreprises/${b.id}/factures`, amira.console, { offre: 'essentiel', periodicite: 'mensuel', motif: 'Abonnement mensuel' })).statut).toBe(201);
  const cle = `abonnement-${b.id}-${debut}`;
  const objets = await dossier(editeur, amira.appli);
  const brouillon = objets.find((o) => o.collection === 'documents' && o.cle === cle);
  const client = objets.find((o) => o.collection === 'clients' && o.cle === brouillon?.contenu.clientId)?.contenu;
  return {
    cle,
    emettre: async () => {
      const e = await appeler('POST', `/entreprises/${editeur}/dossier-v10/emettre`, amira.appli, { document: brouillon?.contenu, client, revision: brouillon?.revision, rang: brouillon?.rang ?? null, netAPayer: '47.410' });
      expect(e.statut, JSON.stringify(e.corps)).toBe(200);
      return String(e.corps.numero);
    },
  };
}

beforeAll(async () => {
  await admin.connect();
  await admin.query(`insert into socle.regle_fiscale (code, valeur, debut, source)
    select 'timbre.facture', '1000', '2000-01-01', 'Règle d''essai des tests' where not exists (select 1 from socle.regle_fiscale where code = 'timbre.facture')`);
  konnect = await konnectSimule();
  ctx = {
    pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} },
    paiement: { konnect: konnect.base, coffre: CLE_DU_COFFRE_D_ESSAI, adresse: () => 'https://skanfact.exemple.tn' },
  };
  declarerGestesVentes();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesV10(ctx), ...routesConsole(ctx, { veille }), ...routesAbonnement(ctx)]);
  await app.ready();
  amira = await direction();
  // L'entreprise SkanFact, désignée par Amira, avec son Konnect : l'argent de nos abonnés va sur SON portefeuille.
  editeur = String((await appeler('POST', '/entreprises', amira.appli, { raisonSociale: 'SkanFact Éditions SARL' })).corps.id);
  await admin.query('delete from plateforme.facture_abonnement');
  await admin.query('delete from plateforme.editeur');
  expect((await appeler('POST', '/console/reglages/factures/editeur', amira.console, { entreprise: editeur, motif: 'Nos factures naissent ici' })).statut).toBe(200);
  // Amira ouvre l'application de SkanFact (le dossier naît, avec sa fiche), y note l'adresse de son comptable (la fiche
  // ne l'imprime pas : elle ne part jamais chez un abonné), puis y branche Konnect, dans les Paramètres.
  const fiche = (await dossier(editeur, amira.appli)).find((o) => o.collection === '_racine' && o.cle === 'company');
  expect((await appeler('POST', `/entreprises/${editeur}/dossier-v10`, amira.appli, { changements: [
    { collection: '_racine', cle: 'company', rang: null, revision: fiche?.revision ?? null, contenu: { ...fiche?.contenu, accountantEmail: COMPTABLE } }] })).statut).toBe(200);
  const b = await appeler('PUT', `/entreprises/${editeur}/paiement-en-ligne`, amira.appli, { portefeuille: PORTEFEUILLE, cle: 'sk_test_cle-de-l-api-konnect-b3f2' });
  expect(b.statut, JSON.stringify(b.corps)).toBe(200);
});
afterAll(async () => { await app.close(); await konnect.fermer(); await admin.end(); await pool.end(); });

describe('l\'abonné et ses factures', () => {
  it('« Ton abonnement » montre les factures émises de CET abonné, réduites à ce qu\'elles impriment ; jamais un brouillon, jamais un autre rôle', async () => {
    const a = await abonnee('Boulangerie Abonnée', 3);
    const f = await facturer(a, plusJours(jour, 4));
    // Préparée, pas émise : rien ne se montre encore (la facture attend sa relecture chez SkanFact).
    expect(await sesFactures(a)).toEqual({ factures: null, enLigne: true });
    const numero = await f.emettre();
    // Une autre abonnée, et sa facture : jamais chez la première.
    const b = await abonnee('Épicerie Voisine', 5);
    const autre = await (await facturer(b, plusJours(jour, 6))).emettre();
    const { factures } = await sesFactures(a);
    expect(factures?.pieces.map((p) => p.numero)).toEqual([numero]);
    expect(factures?.pieces[0]).toMatchObject({
      type: 'facture', net: '47.410', reste: '47.410', statut: 'a_payer', payable: true,
      periode: { debut: plusJours(jour, 4), fin: plusJours(plusMois(plusJours(jour, 4), 1), -1), offre: 'essentiel', periodicite: 'mensuel' },
    });
    expect(JSON.stringify(factures)).not.toContain(autre);
    // Ce qu'elle imprime, rien de plus : les listes fermées de l'espace client.
    for (const p of factures?.pieces ?? []) for (const k of Object.keys(p.document)) expect(CHAMPS_PIECE as readonly string[]).toContain(k);
    for (const k of Object.keys(factures?.entreprise ?? {})) expect(CHAMPS_SOCIETE as readonly string[]).toContain(k);
    for (const k of Object.keys(factures?.client ?? {})) expect(CHAMPS_CLIENT as readonly string[]).toContain(k);
    expect(factures?.entreprise.name).toBe('SkanFact Éditions SARL');
    expect(factures?.client.name).toBe('Boulangerie Abonnée');
    expect(JSON.stringify(factures)).not.toContain(COMPTABLE);
    // Un commercial de la boulangerie ne lit ni ne paie l'abonnement : c'est l'affaire de qui le gère.
    const email = adresse('karim');
    await appeler('POST', '/inscription', undefined, { email, nom: 'Karim Commercial', motDePasse: MDP });
    const karim = await connecter(email);
    const inv = String((await appeler('POST', `/entreprises/${a.id}/invitations`, a.jeton, { email, roles: ['commercial'] })).corps.jeton);
    expect((await appeler('POST', '/invitations/accepter', karim, { jeton: inv })).statut).toBe(200);
    expect((await appeler('GET', `/entreprises/${a.id}/abonnement`, karim)).statut).toBe(403);
    expect((await appeler('POST', `/entreprises/${a.id}/abonnement/payer`, karim, { numero })).statut).toBe(403);
    // La propriétaire de l'épicerie ne paie pas, d'ici, la facture de la boulangerie.
    expect((await appeler('POST', `/entreprises/${b.id}/abonnement/payer`, b.jeton, { numero })).statut).toBe(404);
    expect([...konnect.paiements.values()].filter((p) => p.portefeuille === PORTEFEUILLE)).toEqual([]);
  });

  it('en lecture seule, l\'abonnée paie en ligne le reste de SA facture, sur le portefeuille de SkanFact ; prouvé, l\'abonnement suit et rouvre', async () => {
    const a = await abonnee('Librairie en Lecture', -20);
    // En lecture seule depuis treize jours : la période de la facture commence aujourd'hui.
    const numero = await (await facturer(a, jour)).emettre();
    const payer = () => appeler('POST', `/entreprises/${a.id}/abonnement/payer`, a.jeton, { numero });
    const r = await payer();
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    const demandes = [...konnect.paiements.values()].filter((p) => p.portefeuille === PORTEFEUILLE);
    expect(demandes).toHaveLength(1);
    expect(demandes[0]).toMatchObject({ montant: 47410, devise: 'TND', statut: 'pending' });
    expect(String(r.corps.adresse)).toMatch(new RegExp(`/payer/${demandes[0]?.ref}$`));
    // Deux clics, un paiement : la demande encore ouverte se redonne.
    expect((await payer()).corps.adresse).toBe(r.corps.adresse);
    expect([...konnect.paiements.values()].filter((p) => p.portefeuille === PORTEFEUILLE)).toHaveLength(1);
    // La trace de l'abonnée dit le geste, et la facture.
    const trace = (await admin.query("select apres from socle.audit where entreprise = $1 and geste = 'socle.abonnement.payer'", [a.id])).rows;
    expect(trace).toEqual([{ apres: { numero } }, { apres: { numero } }]);
    // Elle paie chez Konnect, puis revient sur la page de retour de l'espace client, qui demande au serveur où en est SON
    // paiement : la preuve se redemande à Konnect, et le règlement s'ajoute à la facture de SkanFact.
    const retour = new URL(await konnect.payer(String(demandes[0]?.ref), { avis: false }));
    expect(retour.pathname).toBe('/espace/retour.html');
    const fragment = new URLSearchParams(retour.hash.slice(1));
    const vu = await appeler('POST', '/espace/paiement', undefined, { paiement: fragment.get('paiement'), s: fragment.get('s') });
    expect(vu.corps).toMatchObject({ etat: 'encaisse', numero, montant: '47.410', devise: 'TND' });
    expect((await sesFactures(a)).factures?.pieces[0]?.statut).toBe('payee');
    expect((await sesFactures(a)).factures?.pieces[0]).toMatchObject({ reste: '0.000', payable: false });
    // L'abonnement suit : payé jusqu'à la fin de la période de la facture, et l'entreprise n'est plus en lecture seule.
    expect(await ligneAbonnement(a.id)).toMatchObject({ paye: plusJours(plusMois(jour, 1), -1), offre: 'essentiel', periodicite: 'mensuel' });
    const etat = await appeler('GET', `/entreprises/${a.id}/abonnement/etat`, a.jeton);
    expect(etat.corps.etat).toBe('actif');
    // Payée, plus rien à payer : la demande suivante le dit.
    const encore = await payer();
    expect(encore.statut).toBe(409);
    expect(String(encore.corps.motif)).toMatch(/rien à payer|déjà/i);
  });

  it('un avoir de SkanFact se lit avec la facture qu\'il corrige, et « Payer en ligne » ne demande que ce qui reste', async () => {
    const c = await abonnee('Pressing Corrigé', 8);
    const f = await facturer(c, plusJours(jour, 9));
    const numero = await f.emettre();
    // Dix jours offerts : SkanFact émet un avoir de 10 HT (11,900 TTC, sans timbre) sur la facture, dans son application.
    const objets = await dossier(editeur, amira.appli);
    const facture = objets.find((o) => o.collection === 'documents' && o.cle === f.cle);
    const client = objets.find((o) => o.collection === 'clients' && o.cle === facture?.contenu.clientId);
    const avoir = { id: `avoir-${f.cle}`, type: 'avoir', number: '', date: jour, clientId: facture?.contenu.clientId, creditOf: f.cle,
      creditReason: 'Dix jours offerts', status: 'brouillon', discountRate: 0, applyStamp: false, withholdingRate: 0,
      lines: [{ label: 'Dix jours offerts', description: '', qty: 1, unit: '', unitPrice: { '~n': '10' }, vatRate: 19 }],
      currency: facture?.contenu.currency ?? 'DT', exchangeRate: '', payments: [] };
    const e = await appeler('POST', `/entreprises/${editeur}/dossier-v10/emettre-avoir`, amira.appli,
      { document: avoir, client: client?.contenu, revision: null, rang: objets.filter((o) => o.collection === 'documents').length, netAPayer: '11.900' });
    expect(e.statut, JSON.stringify(e.corps)).toBe(200);
    const { factures } = await sesFactures(c);
    expect(factures?.pieces.map((p) => [p.type, p.net, p.reste, p.payable])).toEqual([['avoir', '11.900', null, false], ['facture', '47.410', '35.510', true]]);
    expect(factures?.pieces[1]).toMatchObject({ numero, credite: '11.900', paye: '0.000' });
    // Le paiement demande le reste, jamais le net de la facture.
    const r = await appeler('POST', `/entreprises/${c.id}/abonnement/payer`, c.jeton, { numero });
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
    const ref = String(r.corps.adresse).split('/').pop() ?? '';
    expect(konnect.paiements.get(ref)).toMatchObject({ montant: 35510, portefeuille: PORTEFEUILLE });
  });
});
