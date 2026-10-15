// L'abonnement, dans la base et à la porte (0082 ; serveur/abonnement ; docs/abonnement.md ; skanfact
// docs/cadrage/07-offres-et-prix.md) : une entreprise neuve a trente jours d'essai, et son histoire le dit ; l'état se lit
// par tous ceux qui y travaillent, le détail par qui le gère ; en lecture seule, la porte ferme ce qui a de la valeur et
// engage (une pièce fiscale nouvelle, la caisse qu'on ouvre) et rien d'autre (lire, corriger, ce que la loi demande) ; un
// ticket encaissé sans réseau avant la lecture seule se reçoit encore ; les relances partent une fois par rang, à qui gère
// l'abonnement, sans le nom de l'entreprise ; les gestes de l'exploitant (base/abonnement.ts) laissent chacun leur trace,
// et une trace ne se réécrit pas.

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { faire, voir } from '../../base/abonnement.ts';
import { refuserSiLectureSeule } from '../../serveur/abonnement/condition.ts';
import { plusJours, plusMois } from '../../serveur/abonnement/etat.ts';
import { relancerLesAbonnements } from '../../serveur/abonnement/relances.ts';
import { routesAbonnement } from '../../serveur/abonnement/routes.ts';
import { creerApp, VERSION } from '../../serveur/app.ts';
import { creerPool, enTantQue } from '../../serveur/base.ts';
import type { Contexte } from '../../serveur/connexion.ts';
import { declarerGestesCaisse } from '../../serveur/caisse/gestes.ts';
import { declarerGestesCompta } from '../../serveur/compta/gestes.ts';
import { listeDepuisFichier } from '../../serveur/mot-de-passe.ts';
import { peut } from '../../serveur/porte/porte.ts';
import { aujourdhuiATunis } from '../../serveur/reglements.ts';
import { routesSocle } from '../../serveur/routes/socle.ts';
import { declarerGestesVentes } from '../../serveur/ventes/gestes.ts';
import { routesVentes } from '../../serveur/ventes/routes.ts';

// La preuve d'un paiement reçu hors de la plateforme (0113) : sans elle, rien n'est payé.
const RECU = { facture: 'F-2020-001', montant: 390000n, moyen: 'virement' as const, le: '2020-01-01' };

const admin = new pg.Client({ connectionString: inject('pgAdmin') });
const exploitant = new pg.Client({ connectionString: inject('pgAdmin') });
const pool = creerPool(inject('pgApp'));
type Parti = { a: string; objet: string; texte: string; bouton?: string };
const partis: Parti[] = [];
let enPanne = false;
const ctx: Contexte = { pool, listeVolee: listeDepuisFichier(path.join(import.meta.dirname, '../donnees/mots-de-passe-voles.txt')), sms: { envoyer: async () => {} } };
// Le relais d'e-mails des relances, à part : branché sur l'application, il demanderait un code à chaque inscription.
const ctxRelances: Contexte = { ...ctx,
  courriel: { envoi: { envoyer: async (c) => { if (enPanne) throw new Error('le relais ne répond pas'); partis.push(c as Parti); } }, adresse: () => 'https://app.exemple.tn' } };
let app: FastifyInstance;
const aujourdhui = aujourdhuiATunis();

type Reponse = { statut: number; corps: Record<string, unknown> };
async function appeler(methode: 'GET' | 'POST', url: string, jeton?: string, corps?: unknown): Promise<Reponse> {
  const r = await app.inject({ method: methode, url: VERSION + url, headers: jeton ? { authorization: `Bearer ${jeton}` } : {}, ...(corps === undefined ? {} : { payload: corps as Record<string, unknown> }) });
  return { statut: r.statusCode, corps: r.json() };
}
let n = 0;
async function personne(prenom: string) {
  const email = `abo-${prenom}${++n}@exemple.tn`;
  await appeler('POST', '/inscription', undefined, { email, nom: `${prenom} ${n}`, motDePasse: 'Un-bon-mot-de-passe' });
  const c = await appeler('POST', '/connexion', undefined, { email, motDePasse: 'Un-bon-mot-de-passe', appareil: { nom: 'Poste', type: 'navigateur' } });
  const jeton = String(c.corps.jeton);
  return { email, jeton, id: String((await appeler('GET', '/moi', jeton)).corps.id) };
}
async function inviter(ent: string, par: string, roles: string[], prenom: string) {
  const p = await personne(prenom);
  const jeton = String((await appeler('POST', `/entreprises/${ent}/invitations`, par, { email: p.email, roles })).corps.jeton);
  expect((await appeler('POST', '/invitations/accepter', p.jeton, { jeton })).statut).toBe(200);
  return p;
}
async function entreprise(nom: string) {
  const proprio = await personne('proprio');
  const cree = await appeler('POST', '/entreprises', proprio.jeton, { raisonSociale: nom, matriculeFiscal: `${String(4_100_000 + n).slice(-7)}B/A/M/000` });
  expect(cree.statut, JSON.stringify(cree.corps)).toBeLessThan(300);
  const ent = String(cree.corps.id);
  return { ent, proprio };
}
// La fin de l'essai, posée à la main (ce que les jours feraient tout seuls).
const finEssai = (ent: string, jour: string) => admin.query('update plateforme.abonnement set essai_jusqu_au = $2 where entreprise = $1', [ent, jour]);

beforeAll(async () => {
  await admin.connect();
  await exploitant.connect();
  declarerGestesVentes();
  declarerGestesCaisse();
  declarerGestesCompta();
  app = creerApp(ctx, [...routesSocle(ctx), ...routesVentes(ctx), ...routesAbonnement(ctx)]);
  await app.ready();
});
afterAll(async () => { await app.close(); await admin.end(); await exploitant.end(); await pool.end(); });

describe('l\'essai', () => {
  it('une entreprise neuve a trente jours d\'essai, et son histoire le dit', async () => {
    const { ent } = await entreprise('Essai Neuf');
    const ligne = (await admin.query('select essai_jusqu_au::text j, paye_jusqu_au, offre, offert from plateforme.abonnement where entreprise = $1', [ent])).rows[0];
    expect(ligne).toEqual({ j: plusJours(aujourdhui, 30), paye_jusqu_au: null, offre: null, offert: false });
    const ev = (await admin.query('select nature, par, motif from plateforme.evenement_abonnement where entreprise = $1', [ent])).rows;
    expect(ev).toEqual([{ nature: 'essai_commence', par: 'systeme', motif: null }]);
  });
});

describe('qui lit quoi', () => {
  let E: Awaited<ReturnType<typeof entreprise>>;
  let commercial: Awaited<ReturnType<typeof personne>>;
  beforeAll(async () => {
    E = await entreprise('Qui Lit Quoi');
    commercial = await inviter(E.ent, E.proprio.jeton, ['commercial'], 'commercial');
  });

  it('l\'état, pour tous ceux qui y travaillent', async () => {
    const r = await appeler('GET', `/entreprises/${E.ent}/abonnement/etat`, commercial.jeton);
    expect(r.statut).toBe(200);
    expect(r.corps).toEqual({ aujourdhui, etat: 'essai', jusquAu: plusJours(aujourdhui, 30), jours: 30, fermes: [] });
  });

  it('le détail (les prix, l\'histoire), pour qui gère l\'abonnement ; jamais le motif d\'un geste de SkanFact', async () => {
    expect((await appeler('GET', `/entreprises/${E.ent}/abonnement`, commercial.jeton)).statut).toBe(403);
    await faire(exploitant, E.ent, { geste: 'prolonger', jours: 10, motif: 'note interne : salon de Sfax' });
    const r = await appeler('GET', `/entreprises/${E.ent}/abonnement`, E.proprio.jeton);
    expect(r.statut).toBe(200);
    expect(r.corps.etat).toMatchObject({ etat: 'essai', jusquAu: plusJours(aujourdhui, 40), jours: 40 });
    // Les prix du jour, hors taxes, en texte décimal (0082 : 390 / 39 / 690 / 69 dinars).
    expect(r.corps.prix).toEqual(expect.arrayContaining([
      { offre: 'essentiel', periodicite: 'annuel', montantHt: '390.000' }, { offre: 'essentiel', periodicite: 'mensuel', montantHt: '39.000' },
      { offre: 'complet', periodicite: 'annuel', montantHt: '690.000' }, { offre: 'complet', periodicite: 'mensuel', montantHt: '69.000' },
    ]));
    const histoire = r.corps.historique as Record<string, unknown>[];
    expect(histoire.map((v) => v.nature)).toEqual(['essai_prolonge', 'essai_commence']);
    expect(JSON.stringify(histoire)).not.toMatch(/Sfax|motif/);
  });

  it('une personne d\'ailleurs ne voit rien, ni l\'état ni les faits', async () => {
    const autre = await personne('ailleurs');
    expect((await appeler('GET', `/entreprises/${E.ent}/abonnement/etat`, autre.jeton)).statut).toBe(404);
    const faits = await enTantQue(pool, autre.id, async (tx) => (await tx.query('select plateforme.faits_abonnement($1) f', [E.ent])).rows[0].f);
    expect(faits).toBeNull();
  });
});

describe('la lecture seule', () => {
  let E: Awaited<ReturnType<typeof entreprise>>;
  let facture: string;
  beforeAll(async () => {
    E = await entreprise('Lecture Seule');
    const client = String((await appeler('POST', `/entreprises/${E.ent}/clients`, E.proprio.jeton, { raisonSociale: 'Garage Nord', identifiant: '7654321C/A/M/000', typeIdentifiant: 'matricule' })).corps.id);
    await appeler('POST', `/entreprises/${E.ent}/series`, E.proprio.jeton, { type: 'facture', prefixe: 'FAC', legale: true });
    await appeler('POST', `/entreprises/${E.ent}/regles`, E.proprio.jeton, { code: 'timbre.facture', valeur: 1000, debut: '2026-01-01', motif: 'Essai' });
    facture = String((await appeler('POST', `/entreprises/${E.ent}/ventes`, E.proprio.jeton, { type: 'facture', tiers: client, datePiece: aujourdhui, lignes: [{ designation: 'Porte', quantite: '1', prixUnitaire: '300', tauxTva: '19' }] })).corps.id);
    // L'essai fini il y a dix jours : sept jours de grâce, puis la lecture seule depuis avant-hier.
    await finEssai(E.ent, plusJours(aujourdhui, -10));
  });

  it('l\'état le dit, avec le jour', async () => {
    const r = await appeler('GET', `/entreprises/${E.ent}/abonnement/etat`, E.proprio.jeton);
    expect(r.corps).toEqual({ aujourdhui, etat: 'lecture_seule', depuis: plusJours(aujourdhui, -2), raison: 'essai_termine', fermes: [] });
  });

  it('émettre une facture est refusé : pourquoi, depuis quand, et le geste qui rouvre', async () => {
    const r = await appeler('POST', `/entreprises/${E.ent}/ventes/${facture}/emettre`, E.proprio.jeton);
    expect(r.statut).toBe(403);
    expect(String(r.corps.motif)).toMatch(/lecture seule depuis le \d{2}\/\d{2}\/\d{4} : son essai est terminé\. Tout se lit/i);
    expect(r.corps.bouton).toBe('socle.abonnement.payer');
    // Rien n'a été émis : la pièce reste un brouillon, sans numéro.
    const piece = (await admin.query('select numero from ventes.piece where id = $1', [facture])).rows[0];
    expect(piece.numero).toBeNull();
  });

  it('lire, corriger et créer une fiche restent ouverts', async () => {
    expect((await appeler('GET', `/entreprises/${E.ent}/ventes`, E.proprio.jeton)).statut).toBe(200);
    const fiche = await appeler('POST', `/entreprises/${E.ent}/clients`, E.proprio.jeton, { raisonSociale: 'Garage Sud', identifiant: '7654321D/A/M/000', typeIdentifiant: 'matricule' });
    expect(fiche.statut, JSON.stringify(fiche.corps)).toBeLessThan(300);
  });

  it('la porte ne ferme que les gestes fermés, et seulement pour écrire', async () => {
    const q = { utilisateur: E.proprio.id };
    const decision = (code: string, ecrire: boolean) => enTantQue(pool, E.proprio.id, (tx) => peut(tx, q, E.ent, code, ecrire));
    expect(await decision('caisse.session.ouvrir', true)).toMatchObject({ ok: false, raison: 'condition', bouton: 'socle.abonnement.payer' });
    expect(await decision('caisse.ticket.rendre', true)).toMatchObject({ ok: false, raison: 'condition' });
    // Une lecture n'est jamais fermée, même portée par un geste qui écrit ailleurs (la liste des responsables de la caisse).
    expect((await decision('caisse.ticket.rendre', false)).ok).toBe(true);
    // Ce que la loi demande pour ce qui existe, et ce qui gouverne l'entreprise : ouverts.
    for (const code of ['caisse.session.fermer', 'ventes.paiement.regler', 'compta.declarations.preparer', 'socle.equipe.gerer', 'socle.fiche_societe.modifier']) {
      expect((await decision(code, true)).ok, code).toBe(true);
    }
  });

  it('un ticket encaissé sans réseau AVANT la lecture seule se reçoit ; un nouveau, non', async () => {
    const depuis = plusJours(aujourdhui, -2);
    await expect(enTantQue(pool, E.proprio.id, (tx) => refuserSiLectureSeule(tx, E.ent, { faitLe: plusJours(depuis, -1) }))).resolves.toBeUndefined();
    await expect(enTantQue(pool, E.proprio.id, (tx) => refuserSiLectureSeule(tx, E.ent, { faitLe: depuis }))).rejects.toMatchObject({ bouton: 'socle.abonnement.payer' });
    await expect(enTantQue(pool, E.proprio.id, (tx) => refuserSiLectureSeule(tx, E.ent))).rejects.toThrow(/lecture seule/);
    // Le tour des factures périodiques d'un jour d'avant la lecture seule émet encore.
    await expect(enTantQue(pool, E.proprio.id, (tx) => refuserSiLectureSeule(tx, E.ent, { jour: plusJours(depuis, -1) }))).resolves.toBeUndefined();
  });

  it('un paiement rouvre tout, aussitôt', async () => {
    await faire(exploitant, E.ent, { geste: 'payer', paiement: RECU, offre: 'essentiel', periodicite: 'annuel', motif: 'virement reçu' });
    const r = await appeler('POST', `/entreprises/${E.ent}/ventes/${facture}/emettre`, E.proprio.jeton);
    expect(r.statut, JSON.stringify(r.corps)).toBe(200);
  });
});

describe('les relances', () => {
  let E: Awaited<ReturnType<typeof entreprise>>;
  let commercial: Awaited<ReturnType<typeof personne>>;
  let administrateur: Awaited<ReturnType<typeof personne>>;
  beforeAll(async () => {
    E = await entreprise('Boulangerie Relancée');
    commercial = await inviter(E.ent, E.proprio.jeton, ['commercial'], 'commercial');
    administrateur = await inviter(E.ent, E.proprio.jeton, ['administrateur'], 'admin');
  });
  // La boulangerie ne reste pas « relancée aujourd'hui » pour les fichiers qui suivent dans la même base (l'accueil de la
  // console compte les relances parties depuis hier) : son échéance s'éloigne, ses relances ne sont plus les siennes.
  afterAll(async () => { await finEssai(E.ent, plusJours(aujourdhui, 60)); });
  const pour = (adresses: string[]) => partis.filter((p) => adresses.includes(p.a));
  const parties = async () => (await admin.query('select rang from plateforme.relance_abonnement where entreprise = $1 order by partie_le, rang', [E.ent])).rows.map((r) => r.rang);

  it('quinze jours avant : à qui gère l\'abonnement, une fois, sans le nom de l\'entreprise', async () => {
    await finEssai(E.ent, plusJours(aujourdhui, 15));
    await relancerLesAbonnements(ctxRelances);
    const envoyes = pour([E.proprio.email, administrateur.email, commercial.email]);
    expect(envoyes.map((p) => p.a).sort()).toEqual([E.proprio.email, administrateur.email].sort());
    const [premier] = envoyes;
    expect(premier?.objet).toBe('Ton essai de SkanFact se termine dans 15 jours');
    const [a, m, j] = plusJours(aujourdhui, 15).split('-');
    expect(premier?.texte).toContain(`se termine le ${j}/${m}/${a}`);
    expect(premier?.texte).toContain('https://app.exemple.tn/');
    expect(JSON.stringify(envoyes)).not.toMatch(/Boulangerie|Relancée/);
    expect(await parties()).toEqual(['j15']);
    // Le tour suivant, le même jour : rien de plus.
    await relancerLesAbonnements(ctxRelances);
    expect(pour([E.proprio.email])).toHaveLength(1);
  });

  it('un envoi qui échoue n\'est pas noté : il se retente au tour suivant', async () => {
    await finEssai(E.ent, plusJours(aujourdhui, 7));
    enPanne = true;
    await relancerLesAbonnements(ctxRelances);
    enPanne = false;
    expect(await parties()).toEqual(['j15']);
    await relancerLesAbonnements(ctxRelances);
    expect(await parties()).toEqual(['j15', 'j7']);
    expect(pour([E.proprio.email]).at(-1)?.objet).toBe('Ton essai de SkanFact se termine dans 7 jours');
  });

  it('le jour de la lecture seule, une fois ; pendant la grâce, rien', async () => {
    const avant = partis.length;
    await finEssai(E.ent, plusJours(aujourdhui, -3));
    await relancerLesAbonnements(ctxRelances);
    expect(partis.slice(avant).filter((p) => p.a === E.proprio.email)).toHaveLength(0);
    await finEssai(E.ent, plusJours(aujourdhui, -8));
    await relancerLesAbonnements(ctxRelances);
    await relancerLesAbonnements(ctxRelances);
    const derniers = partis.slice(avant).filter((p) => p.a === E.proprio.email);
    expect(derniers.map((p) => p.objet)).toEqual(['Une de tes entreprises est passée en lecture seule sur SkanFact']);
    expect(derniers[0]?.texte).toContain(`le ${aujourdhui.split('-').reverse().join('/')}`);
  });

  it('sans relais d\'e-mails, rien ne part et rien ne se note : la relance partira avec le relais', async () => {
    const F = await entreprise('Sans Relais');
    await finEssai(F.ent, plusJours(aujourdhui, 15));
    expect(await relancerLesAbonnements(ctx)).toBe(0);
    expect((await admin.query('select count(*)::int n from plateforme.relance_abonnement where entreprise = $1', [F.ent])).rows[0].n).toBe(0);
    // Le relais revenu, la relance qui attendait part.
    await relancerLesAbonnements(ctxRelances);
    expect(partis.filter((p) => p.a === F.proprio.email).map((p) => p.objet)).toEqual(['Ton essai de SkanFact se termine dans 15 jours']);
  });
});

describe('les gestes de l\'exploitant', () => {
  it('chacun pose son événement, avec son motif ; un motif vide est refusé', async () => {
    const { ent } = await entreprise('Gestes');
    await expect(faire(exploitant, ent, { geste: 'payer', paiement: RECU, offre: 'complet', periodicite: 'mensuel', motif: ' ' })).rejects.toThrow(/demande son motif/);
    // Et la base le refuse aussi, par qui que ce soit (un motif d'espaces n'en est pas un).
    await expect(admin.query('insert into plateforme.evenement_abonnement (entreprise, nature, par, motif) values ($1, \'paye\', \'exploitation\', \'  \')', [ent])).rejects.toThrow(/motif_check/);
    // Payé pendant l'essai : un mois de calendrier qui commence le lendemain de la fin de l'essai (aucun jour d'essai perdu).
    const debut = plusJours(aujourdhui, 31);
    expect(await faire(exploitant, ent, { geste: 'payer', paiement: RECU, offre: 'complet', periodicite: 'mensuel', motif: 'chèque n° 12' }))
      .toMatchObject({ etat: 'actif', offre: 'complet', periodicite: 'mensuel', jusquAu: plusJours(plusMois(debut, 1), -1) });
    expect(await faire(exploitant, ent, { geste: 'resilier', motif: 'demande du client' })).toMatchObject({ etat: 'actif', resilie: true });
    expect(await faire(exploitant, ent, { geste: 'annuler-resiliation', motif: 'il reste' })).toMatchObject({ etat: 'actif', resilie: false });
    expect(await faire(exploitant, ent, { geste: 'suspendre', motif: 'impayé' })).toMatchObject({ etat: 'lecture_seule', raison: 'suspendu', depuis: aujourdhui });
    await expect(faire(exploitant, ent, { geste: 'suspendre', motif: 'encore' })).rejects.toThrow(/déjà suspendu/);
    expect(await faire(exploitant, ent, { geste: 'reprendre', motif: 'réglé' })).toMatchObject({ etat: 'actif' });
    expect(await faire(exploitant, ent, { geste: 'offrir', motif: 'fondateur' })).toEqual({ etat: 'hors', raison: 'offert' });
    expect(await faire(exploitant, ent, { geste: 'retirer-offert', motif: 'fin du programme' })).toMatchObject({ etat: 'actif' });
    const v = await voir(exploitant, ent);
    expect(v.evenements.map((e) => [e.nature, e.par])).toEqual([
      ['essai_commence', 'systeme'], ['paye', 'exploitation'], ['resilie', 'exploitation'], ['resiliation_annulee', 'exploitation'],
      ['suspendu', 'exploitation'], ['repris', 'exploitation'], ['offert', 'exploitation'], ['offert_retire', 'exploitation'],
    ]);
    expect(v.evenements[1]?.motif).toBe('chèque n° 12');
  });

  it('un renouvellement à l\'année prend la suite de la période payée', async () => {
    const { ent } = await entreprise('Annuel');
    await faire(exploitant, ent, { geste: 'payer', paiement: RECU, offre: 'essentiel', periodicite: 'mensuel', motif: 'virement' });
    const premiere = plusJours(plusMois(plusJours(aujourdhui, 31), 1), -1);
    // La même facture ne paie pas deux périodes (0121) : celle de l'année a son numéro.
    await expect(faire(exploitant, ent, { geste: 'payer', paiement: { ...RECU, facture: ' f-2020-001' }, offre: 'essentiel', periodicite: 'annuel', motif: 'noté deux fois' }))
      .rejects.toThrow(/déjà noté/);
    const e = await faire(exploitant, ent, { geste: 'payer', paiement: { ...RECU, facture: 'F-2020-002' }, offre: 'essentiel', periodicite: 'annuel', motif: 'virement, à l\'année' });
    const lire = async () => (await admin.query('select paye_jusqu_au::text p, periodicite, a_venir_le::text le, a_venir_periodicite av from plateforme.abonnement where entreprise = $1', [ent])).rows[0];
    // Payée avant son premier jour (l'audit C01) : le mois payé va au bout au mois ; l'année commence à son jour.
    const ligne = await lire();
    expect(ligne).toEqual({ p: plusJours(plusMois(plusJours(premiere, 1), 12), -1), periodicite: 'mensuel', le: plusJours(premiere, 1), av: 'annuel' });
    expect(e).toMatchObject({ etat: 'actif', jusquAu: ligne.p });
    await admin.query('select plateforme.basculer_abonnements($1::date)', [plusJours(premiere, 1)]);
    expect(await lire()).toEqual({ p: ligne.p, periodicite: 'annuel', le: null, av: null });
  });

  it('une trace ne se modifie pas et ne s\'efface pas', async () => {
    const { ent } = await entreprise('Trace');
    await expect(admin.query('update plateforme.evenement_abonnement set motif = $2 where entreprise = $1', [ent, 'réécrit'])).rejects.toThrow(/ne se modifie pas/);
    await expect(admin.query('delete from plateforme.evenement_abonnement where entreprise = $1', [ent])).rejects.toThrow(/ne se modifie pas/);
  });
});
