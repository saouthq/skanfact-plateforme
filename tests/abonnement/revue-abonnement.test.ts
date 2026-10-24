// L'abonnement après sa revue, lot 1 (1.118.0 ; 0170 ; docs/revue-abonnement.md), par l'API. Ce que le serveur garantit :
//   - une facture de l'abonnement ÉMISE s'annonce par e-mail à qui gère l'abonnement, une fois ; payée, un reçu part, une
//     fois. Ni le montant, ni le numéro, ni le nom de l'entreprise dans l'e-mail ; un brouillon ne s'annonce pas ; un
//     envoi raté se retente ;
//   - l'état dit ce qui attend qui gère l'abonnement (une facture à régler, un choix dont la facture se prépare), jamais
//     à un autre rôle ;
//   - « Ton abonnement » dit la prochaine facture d'un abonnement payé (par la règle de la facture) et les rappels déjà
//     partis pour l'échéance qui vient.

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
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';
import { konnectSimule } from '../konnect-simule.ts';
import { annoncerLesFactures } from '../../serveur/abonnement/courriels.ts';

const MDP = 'Un-bon-mot-de-passe';
const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
const veille = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'revue-abonnement-')), 'veille.json');
const jour = aujourdhuiATunis();
let konnect: Awaited<ReturnType<typeof konnectSimule>>;
let ctx: Contexte;
let postier: Contexte;
type Parti = { a: string; objet: string; texte: string; bouton?: string };
const partis: Parti[] = [];
let enPanne = false;
let app: FastifyInstance;

type Corps = Record<string, unknown>;
async function appeler(methode: 'GET' | 'POST' | 'PUT', url: string, jeton?: string, corps?: unknown): Promise<{ statut: number; corps: Corps }> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
const adresse = (qui: string) => `revue-abo-${qui}${++n}-${Math.random().toString(36).slice(2, 7)}@exemple.tn`;
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
  return { id, jeton, email };
}
type Objet = { collection: string; cle: string; rang: number | null; contenu: Corps; revision: number };
const dossier = async (ent: string, jeton: string) => (await appeler('GET', `/entreprises/${ent}/dossier-v10`, jeton)).corps.objets as Objet[];

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
  // Le relais d'e-mails, pour le postier seulement : branché sur l'application, il ferait vérifier chaque adresse à
  // l'inscription (0076).
  postier = { ...ctx, courriel: { envoi: { envoyer: async (c) => { if (enPanne) throw new Error('le relais ne répond pas'); partis.push(c as Parti); } }, adresse: () => 'https://app.exemple.tn' } };
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

describe('les e-mails d\'une facture de l\'abonnement', () => {
  it('émise, elle s\'annonce une fois ; payée, le reçu part une fois ; rien de la facture dans l\'e-mail', async () => {
    const a = await abonnee('Librairie Annoncée', -20);
    const pour = () => partis.filter((p) => p.a === a.email);
    // Préparée, pas encore émise : rien ne s'annonce (un brouillon peut encore changer).
    const f = await facturer(a, jour);
    await annoncerLesFactures(postier);
    expect(pour()).toEqual([]);
    // Émise : un e-mail, qui dit son échéance et où la lire.
    const numero = await f.emettre();
    enPanne = true;
    await annoncerLesFactures(postier);
    enPanne = false;
    expect(pour()).toEqual([]);
    await annoncerLesFactures(postier);
    expect(pour()).toHaveLength(1);
    const [annonce] = pour();
    expect(annonce?.objet).toBe('Ta facture d\'abonnement SkanFact est prête');
    expect(annonce?.texte).toContain(`Elle est à régler au plus tard le ${jour.split('-').reverse().join('/')}.`);
    expect(annonce?.texte).toContain('https://app.exemple.tn/');
    expect(JSON.stringify(annonce)).not.toMatch(new RegExp(`Librairie|${numero}|47[.,]410|39[.,]000`));
    await annoncerLesFactures(postier);
    expect(pour()).toHaveLength(1);
    // Payée en ligne : le reçu, avec le jour jusqu'où l'abonnement est payé ; une seule fois.
    const r = await appeler('POST', `/entreprises/${a.id}/abonnement/payer`, a.jeton, { numero });
    const ref = [...konnect.paiements.values()].find((p) => String(r.corps.adresse).endsWith(`/payer/${p.ref}`))?.ref;
    const retour = new URL(await konnect.payer(String(ref), { avis: false }));
    const fragment = new URLSearchParams(retour.hash.slice(1));
    expect((await appeler('POST', '/espace/paiement', undefined, { paiement: fragment.get('paiement'), s: fragment.get('s') })).corps).toMatchObject({ etat: 'encaisse' });
    await annoncerLesFactures(postier);
    expect(pour()).toHaveLength(2);
    const recu = pour()[1];
    expect(recu?.objet).toBe('Ton paiement à SkanFact est bien reçu');
    expect(recu?.texte).toContain(`L'abonnement est payé jusqu'au ${plusJours(plusMois(jour, 1), -1).split('-').reverse().join('/')}.`);
    expect(JSON.stringify(recu)).not.toMatch(new RegExp(`Librairie|${numero}|47[.,]410`));
    await annoncerLesFactures(postier);
    expect(pour()).toHaveLength(2);
  });

  it('une facture payée avant d\'avoir été annoncée n\'envoie que le reçu ; un autre rôle n\'en reçoit rien', async () => {
    const b = await abonnee('Pressing Pressé', -20);
    const commercial = adresse('commercial');
    await appeler('POST', '/inscription', undefined, { email: commercial, nom: 'Karim Commercial', motDePasse: MDP });
    const karim = await connecter(commercial);
    const inv = await appeler('POST', `/entreprises/${b.id}/invitations`, b.jeton, { email: commercial, roles: ['commercial'] });
    expect((await appeler('POST', '/invitations/accepter', karim, { jeton: String(inv.corps.jeton) })).statut).toBe(200);
    const numero = await (await facturer(b, jour)).emettre();
    const r = await appeler('POST', `/entreprises/${b.id}/abonnement/payer`, b.jeton, { numero });
    const ref = [...konnect.paiements.values()].find((p) => String(r.corps.adresse).endsWith(`/payer/${p.ref}`))?.ref;
    const retour = new URL(await konnect.payer(String(ref), { avis: false }));
    const fragment = new URLSearchParams(retour.hash.slice(1));
    await appeler('POST', '/espace/paiement', undefined, { paiement: fragment.get('paiement'), s: fragment.get('s') });
    await annoncerLesFactures(postier);
    expect(partis.filter((p) => p.a === b.email).map((p) => p.objet)).toEqual(['Ton paiement à SkanFact est bien reçu']);
    expect(partis.filter((p) => p.a === commercial)).toEqual([]);
  });
});

describe('ce qui attend, la prochaine facture, les rappels partis', () => {
  it('l\'état dit la facture à régler, puis le choix qui attend sa facture, à qui gère l\'abonnement seulement', async () => {
    const c = await abonnee('Droguerie en Grâce', -2);
    const commercial = adresse('commercial');
    await appeler('POST', '/inscription', undefined, { email: commercial, nom: 'Hela Commerciale', motDePasse: MDP });
    const hela = await connecter(commercial);
    const inv = await appeler('POST', `/entreprises/${c.id}/invitations`, c.jeton, { email: commercial, roles: ['commercial'] });
    expect((await appeler('POST', '/invitations/accepter', hela, { jeton: String(inv.corps.jeton) })).statut).toBe(200);
    const etat = async (jeton: string) => (await appeler('GET', `/entreprises/${c.id}/abonnement/etat`, jeton)).corps;
    expect(await etat(c.jeton)).toMatchObject({ etat: 'en_retard', aFaire: null });
    // Un choix : sa facture se prépare.
    expect((await appeler('POST', `/entreprises/${c.id}/abonnement/choisir`, c.jeton, { offre: 'essentiel', periodicite: 'mensuel' })).statut).toBe(201);
    expect(await etat(c.jeton)).toMatchObject({ aFaire: 'attendre' });
    // La facture émise : elle est à régler. La commerciale lit l'état, jamais ce qui attend (la base lui refuse les factures).
    await (await facturer(c, plusJours(jour, -1))).emettre();
    expect(await etat(c.jeton)).toMatchObject({ aFaire: 'payer' });
    const vu = await etat(hela);
    expect(vu).toMatchObject({ etat: 'en_retard', aFaire: null });
    // Loin de l'échéance, rien n'est lu : l'état ne demande rien.
    await admin.query('update plateforme.abonnement set essai_jusqu_au = $2::date + 60 where entreprise = $1', [c.id, jour]);
    expect(await etat(c.jeton)).toMatchObject({ etat: 'essai', aFaire: null });
  });

  it('payé, « Ton abonnement » dit ce que dira la prochaine facture, et les rappels déjà partis', async () => {
    const d = await abonnee('Quincaillerie Payée', -20);
    const numero = await (await facturer(d, jour)).emettre();
    const r = await appeler('POST', `/entreprises/${d.id}/abonnement/payer`, d.jeton, { numero });
    const ref = [...konnect.paiements.values()].find((p) => String(r.corps.adresse).endsWith(`/payer/${p.ref}`))?.ref;
    const retour = new URL(await konnect.payer(String(ref), { avis: false }));
    const fragment = new URLSearchParams(retour.hash.slice(1));
    await appeler('POST', '/espace/paiement', undefined, { paiement: fragment.get('paiement'), s: fragment.get('s') });
    const fin = plusJours(plusMois(jour, 1), -1);
    const lire = async () => (await appeler('GET', `/entreprises/${d.id}/abonnement`, d.jeton)).corps;
    expect((await lire()).prochaine).toEqual({ debut: plusJours(fin, 1), offre: 'essentiel', periodicite: 'mensuel', montantHt: '39.000', remise: null });
    // Les rappels déjà partis pour l'échéance : leur rang et leur jour.
    expect((await lire()).rappels).toEqual([]);
    await admin.query("insert into plateforme.relance_abonnement (entreprise, echeance, rang, partie_le) values ($1, $2, 'j15', now())", [d.id, fin]);
    expect((await lire()).rappels).toEqual([{ rang: 'j15', le: jour }]);
    // Résilié : il n'y a plus de prochaine facture.
    await admin.query('update plateforme.abonnement set resilie_le = $2 where entreprise = $1', [d.id, jour]);
    expect((await lire()).prochaine).toBeNull();
  });
});
