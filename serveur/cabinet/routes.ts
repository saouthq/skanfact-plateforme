// Les routes du cabinet (brique 36 ; docs/cabinet.md). Deux côtés :
//   - le cabinet : le créer, son portefeuille, accepter ou arrêter un mandat, créer un dossier tenu,
//     confier un dossier à un collaborateur. Ce sont des gestes de la PERSONNE (ils ne portent pas
//     sur une entreprise) : la base vérifie elle-même, dans chaque fonction, qui est associé ;
//   - l'entreprise : voir son cabinet, le choisir (par son code), changer le périmètre, arrêter le
//     mandat (le propriétaire seul, geste socle.cabinet.choisir).
// Chaque changement d'un mandat se trace chez l'entreprise : elle voit qui a fait quoi (03 § 3.4).

import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { versTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import { enTantQue, requetes, type Transaction } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { motif, t } from '../../textes/index.ts';
import './textes.ts';
import { enMots, envoyerInvitation, etatVu, lienApplication, lienComptable, lienDossier, noterAEnvoyer, roleDansLaPhrase } from '../invitation-courriel.ts';
import { matriculeCanonique, refusDuMatricule } from '../matricule.ts';
import { PERIODE_REVISION, REVISION } from './revision.ts';
import { facturerCabinetBientot } from '../abonnement/cabinet.ts';

const uuid = z.string().uuid();
const PERIMETRES = ['comptabilite', 'declarations', 'saisie_achats', 'paie'] as const;
const perimetre = z.array(z.enum(PERIMETRES)).min(1).max(4).refine((p) => new Set(p).size === p.length, { message: 'cabinet.champ.perimetre' });
const ROLES_SUR_DOSSIER = ['supervision', 'revision', 'saisie', 'paie'] as const;
// Les rôles d'une personne au cabinet (0030) : associé, collaborateur, assistant de saisie.
const ROLES_AU_CABINET = ['supervision', 'revision', 'saisie'] as const;
const introuvable = { statut: 404 as const, corps: { motif: motif('commun.introuvable') } };
// Les champs de la fiche d'un dossier au cabinet : cette liste, et rien d'autre (0020). Les
// honoraires en millimes (jamais de nombre à virgule en base).
const texte = (max: number) => z.string().max(max);
// Une relance notée (brique 38 bis, C15) : son instant (en millisecondes), son moyen, les mois qu'elle
// réclamait, une note ; les cinquante dernières, comme la v10.
const RELANCE = z.object({
  at: z.number().int().min(0).max(8_640_000_000_000_000), via: z.enum(['email', 'tel', 'whatsapp', 'autre']),
  months: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).max(120), note: texte(500),
}).strict();
// Un abonnement du dossier (brique 51) : un guide qui revient tous les N mois, depuis une date, pour un
// montant (texte décimal au millime, jamais un nombre à virgule en base) ; `faites` porte les mois déjà
// écrits, pour que rejouer ne double rien.
const JOUR_OU_RIEN = z.string().regex(/^(\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]))?$/);
const ABONNEMENT = z.object({
  id: z.string().min(1).max(40), nom: texte(120), guideId: z.string().max(40), actif: z.boolean(), depuis: JOUR_OU_RIEN, jusqua: JOUR_OU_RIEN,
  tousLesMois: z.number().int().min(1).max(12), montant: z.string().regex(/^\d{1,12}(\.\d{1,3})?$/), piece: texte(40), libelle: texte(200),
  faites: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).max(600),
}).strict();
// Les taux de la paie qui s'écartent du barème pour un type de contrat (brique 55) : en pour cent, en
// texte décimal à quatre décimales au plus (celles du barème qu'un bulletin fige) ; une case absente suit
// le barème, et le CDI le suit toujours (la v10, compta.js, regimeDuContrat).
const TAUX_POUR_CENT = z.string().regex(/^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/);
// (1.69.0) Les heures d'un mois complet, qui font le prix d'une heure supplémentaire (208 = 26 jours de 8 heures ; 173,33
// pour 40 heures par semaine) : en texte décimal, deux décimales au plus, de 1 à 400.
const HEURES_DU_MOIS = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).refine((v) => Number(v) >= 1 && Number(v) <= 400);
// (1.70.0) Le droit annuel aux congés payés d'un dossier tenu, en jours ouvrables (18 au barème : À VÉRIFIER avec la
// convention collective du client) : en texte décimal, deux décimales au plus, de 1 à 60.
const JOURS_DE_CONGE = z.string().regex(/^\d{1,2}(\.\d{1,2})?$/).refine((v) => Number(v) >= 1 && Number(v) <= 60);
const REGIME_DE_CONTRAT = z.object({
  cnssEmployee: TAUX_POUR_CENT, cnssEmployer: TAUX_POUR_CENT, accidentRate: TAUX_POUR_CENT, tfpRate: TAUX_POUR_CENT,
  foprolosRate: TAUX_POUR_CENT, solidarity: TAUX_POUR_CENT, sansIrpp: z.literal(true),
}).partial().strict();
const CONTRATS_A_REGIME = ['cdd', 'saisonnier', 'civp', 'sivp', 'karama', 'stage', 'autre'] as const;
const FICHE = z.object({
  email: texte(200), phone: texte(40), contact: texte(200), note: texte(2000), archived: z.boolean(),
  from: z.string().regex(/^(\d{4}-\d{2})?$/), regime: texte(40), tvaPeriod: texte(20),
  fees: z.number().int().min(0).max(1_000_000_000_000), cnssEmployeur: texte(40), cnssCode: texte(10),
  // (1.72.0) L'adresse et le gérant du client : en tête et au bas de ses documents (le bulletin, les documents du personnel).
  adresse: texte(300), gerant: texte(200),
  // (1.169.0) Ce que la liste des Dossiers montre sous chaque nom et chaque contact : sa forme, sa ville, la fonction du contact.
  forme: texte(40), ville: texte(80), fonction: texte(80), activite: texte(80),
  relances: z.array(RELANCE).max(50),
  // Le compte bancaire du dossier, sa banque, et l'écart de jours du rapprochement (brique 40, C21).
  banque: z.object({ compte: z.string().regex(/^(\d{1,12})?$/), banque: texte(60), jours: z.number().int().min(0).max(30).nullable() }).partial().strict(),
  // Le dernier journal de saisie du dossier, celui que la grille reprend (brique 50).
  dernierJournal: z.string().regex(/^[A-Z0-9]{0,5}$/),
  // Les abonnements du dossier (brique 51).
  abonnements: z.array(ABONNEMENT).max(50),
  // Les taux par contrat de la paie du dossier (brique 55), et les taux propres à l'entreprise (1.66.0) :
  // l'accident du travail (selon l'activité), la TFP (1 % ou 2 %), le FOPROLOS ; un taux absent suit le barème.
  // (1.69.0) Les heures supplémentaires du pointage : les heures d'un mois complet et jusqu'à trois majorations (%) ;
  // aucune n'est écrite d'avance, une majoration absente ne paraît pas dans la grille. (1.70.0) Le droit annuel aux congés
  // payés : absent, il suit le barème.
  paie: z.object({
    regimesContrat: z.partialRecord(z.enum(CONTRATS_A_REGIME), REGIME_DE_CONTRAT),
    accidentRate: TAUX_POUR_CENT.optional(), tfpRate: TAUX_POUR_CENT.optional(), foprolosRate: TAUX_POUR_CENT.optional(),
    heuresMois: HEURES_DU_MOIS.optional(), hsMaj1: TAUX_POUR_CENT.optional(), hsMaj2: TAUX_POUR_CENT.optional(), hsMaj3: TAUX_POUR_CENT.optional(),
    leaveDaysPerYear: JOURS_DE_CONGE.optional(),
  }).strict(),
}).partial().strict();
// Les réglages du cabinet (0023, C21) : cette liste, et rien d'autre. L'association des colonnes d'un
// relevé PAR BANQUE (le rang de chaque colonne), et les mots retenus (un mot d'un libellé → le compte
// proposé), pour tous ses clients.
const COLONNE = z.number().int().min(0).max(200);
const REGLAGES = z.object({
  banques: z.record(z.string().min(1).max(60), z.object({ date: COLONNE, libelle: COLONNE, montant: COLONNE, debit: COLONNE, credit: COLONNE, reference: COLONNE }).partial().strict())
    .refine((o) => Object.keys(o).length <= 50, { message: 'cabinet.champ.banques' }),
  libelles: z.array(z.object({ motif: z.string().min(1).max(40), compte: z.string().regex(/^\d{1,12}$/) }).strict()).max(500),
  // La forme d'un montant copié pour le portail (l'onglet Déclaration, brique 41).
  formatCopie: z.enum(['point', 'virgule', 'millimes']),
  // Le modèle de liasse du cabinet (brique 41 ter) : ses rubriques, celles de la v10.
  liasse: z.array(z.object({
    id: z.string().min(1).max(20), etat: z.enum(['bilan-actif', 'bilan-passif', 'resultat']), label: z.string().min(1).max(200),
    comptes: z.array(z.string().regex(/^\d{1,12}$/)).max(100), signe: z.union([z.literal(1), z.literal(-1)]),
    deduit: z.boolean(), charge: z.boolean(), resultat: z.boolean(), deuxSens: z.boolean(),
  }).strict()).max(300),
  // La fiche et les réglages du Cabinet v10 (brique 47) : l'adresse et le téléphone du cabinet, le jour
  // des relances, les jours des échéances, la saisie, le thème, les régimes, les échéances pointées.
  email: z.string().max(200).regex(/^([^\s@]+@[^\s@]+\.[^\s@]+)?$/, { message: 'cabinet.champ.email' }),
  phone: texte(40),
  relanceDay: z.number().int().min(1).max(28),
  deadlines: z.object({ tvaDay: z.number().int().min(1).max(31), cnssDay: z.number().int().min(1).max(31) }).strict().nullable(),
  saisie: z.object({
    journalParDefaut: z.string().regex(/^[A-Z]{0,6}$/), dateComplete: z.boolean(), validerParLot: z.boolean(),
    touches: z.object({ ligneSuivante: texte(30), solder: texte(30), recopier: texte(30), dupliquer: texte(30), valider: texte(30) }).strict(),
    regleLe: texte(40).optional(),
  }).strict().nullable(),
  theme: z.enum(['light', 'dark', 'auto']),
  depots: z.array(z.string().regex(/^[a-z-]+@\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)).max(5000),
  regimes: z.array(z.object({
    id: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(80), tva: z.enum(['', 'mensuelle', 'trimestrielle', 'aucune']), cnss: z.boolean(),
    annuelles: z.array(z.object({ id: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(120), mois: z.number().int().min(1).max(12), jour: z.number().int().min(1).max(31) }).strict()).max(30),
  }).strict()).max(50),
  // Les guides d'écritures du cabinet (brique 50) : une pièce type (son nom, son journal, ses lignes),
  // que la saisie propose. Un montant ou un taux s'écrit en texte décimal (jamais un nombre à virgule
  // en base) ; vide, la ligne prend son montant ailleurs (la base, le solde) ou se tape.
  guides: z.array(z.object({
    id: z.string().min(1).max(40), nom: z.string().trim().min(1).max(120), journal: z.string().regex(/^[A-Z0-9]{1,5}$/),
    lignes: z.array(z.object({
      compte: z.string().regex(/^\d{1,12}$/), libelle: texte(200), sens: z.enum(['debit', 'credit']),
      montant: z.string().regex(/^(\d{1,12}(\.\d{1,3})?)?$/), taux: z.string().regex(/^(\d{1,4}(\.\d{1,6})?)?$/), base: z.boolean(), solde: z.boolean(),
    }).strict()).min(2).max(40),
  }).strict()).max(200),
  // La méthode de révision du cabinet (brique 44) : le questionnaire de fin d'exercice (soixante
  // questions au plus, comme la v10) et ses cycles (vides : les sept que la v10 propose).
  questionnaire: z.array(z.object({ question: z.string().trim().min(1).max(500) }).strict()).max(60),
  cycles: z.array(z.object({
    id: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(80), prefixes: z.array(z.string().regex(/^\d{1,12}$/)).min(1).max(50),
  }).strict()).max(30),
}).partial().strict();

const tracer = (tx: Transaction, entreprise: string, geste: string, objet: string, avant: unknown, apres: unknown) =>
  tx.query('select socle.tracer($1, $2, $3, $4, $5, $6)', [entreprise, geste, 'mandat', objet, avant === null ? null : JSON.stringify(avant), apres === null ? null : JSON.stringify(apres)]);

// Le mandat nommé, s'il est bien de ce cabinet (et visible : la sécurité par ligne le dit).
async function mandatDuCabinet(tx: Transaction, cabinet: string, mandat: string) {
  if (!uuid.safeParse(cabinet).success || !uuid.safeParse(mandat).success) return null;
  return await requetes(tx).selectFrom('socle.mandat').select(['id', 'entreprise', 'statut', 'perimetre'])
    .where('id', '=', mandat).where('cabinet', '=', cabinet).executeTakeFirst() ?? null;
}
// Le mandat en cours d'une entreprise (proposé ou actif).
async function mandatEnCours(tx: Transaction, entreprise: string) {
  return await requetes(tx).selectFrom('socle.mandat').select(['id', 'cabinet', 'statut', 'perimetre', 'debut'])
    .where('entreprise', '=', entreprise).where('statut', 'in', ['propose', 'actif']).executeTakeFirst() ?? null;
}

export function routesCabinet(ctx: Contexte): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  // ── Le cabinet ─────────────────────────────────────────────────────────────────────────────
  ajouter({
    methode: 'POST', chemin: '/cabinets', geste: 'compte.cabinet.creer',
    corps: z.object({ nom: z.string().trim().min(1).max(200) }),
    traiter: async ({ corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const r = (await tx.query('select * from socle.creer_cabinet($1)', [corps.nom])).rows[0] as { cabinet: string; code: string };
      return { statut: 201, corps: { id: r.cabinet, code: r.code } };
    },
  });

  // Mes cabinets, et mes rôles dans chacun.
  ajouter({
    methode: 'GET', chemin: '/cabinets', geste: 'compte.cabinets.voir',
    traiter: async (_r, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const r = await tx.query(`select o.id, o.nom, o.code_cabinet code, m.roles from socle.organisation o
        join socle.membre m on m.organisation = o.id and m.utilisateur = socle.moi() and m.actif
        where o.type = 'cabinet' order by o.nom, o.id`);
      return { corps: { cabinets: r.rows } };
    },
  });

  // Le portefeuille : tous les dossiers pour un associé (et les mandats qui attendent son accord),
  // ceux qui lui sont confiés pour un collaborateur.
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/portefeuille', geste: 'compte.cabinets.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      const r = await tx.query('select * from socle.portefeuille($1)', [params.cabinet]);
      // Où joindre un client sur SkanFact (1.76.0) : l'adresse e-mail et le téléphone de SA fiche société, que le mandat
      // actif laisse lire (ces deux champs seuls : socle.coordonnees_de_mes_clients, la fiche entière reste fermée) ; le
      // Cabinet les montrait « à renseigner » et les faisait retaper (recette du 20/10/2026). Rien pour un dossier tenu (sa
      // fiche est celle du cabinet) ni pour un mandat qui attend.
      const clients = r.rows.filter((d) => !d.tenu && d.statut === 'actif').map((d) => d.entreprise as string);
      const coordonnees = new Map((clients.length ? (await tx.query(`select entreprise, email, telephone
          from socle.coordonnees_de_mes_clients() where entreprise = any($1::uuid[])`, [clients])).rows : [])
        .map((x) => [x.entreprise as string, { email: String(x.email ?? ''), telephone: String(x.telephone ?? '') }]));
      return {
        corps: {
          dossiers: r.rows.map((d) => ({
            mandat: d.mandat, entreprise: d.entreprise, raisonSociale: d.raison_sociale, matriculeFiscal: d.matricule_fiscal,
            statut: d.statut, perimetre: d.perimetre, debut: d.debut, tenu: d.tenu, role: d.role,
            ...(coordonnees.has(d.entreprise) ? { coordonnees: coordonnees.get(d.entreprise) } : {}),
          })),
        },
      };
    },
  });

  // Les mois des dossiers (brique 38) : pour chaque dossier dont la personne lit les livres, chaque
  // mois qui a des écritures — combien, combien au brouillard, le chiffre d'affaires (comptes 70) et
  // le dernier mouvement. C'est ce que le tableau du portefeuille compte, à la place des paquets.
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/mois', geste: 'compte.cabinets.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      const depuis = query.depuis ?? '';
      if (!/^\d{4}-\d{2}-01$/.test(depuis)) {
        return { statut: 400, corps: { motif: motif('commun.champ_invalide', { champ: 'depuis', raison: t('cabinet.champ.depuis') }), champ: 'depuis' } };
      }
      const r = await tx.query('select * from compta.mois_du_portefeuille($1, $2::date) order by entreprise, mois', [params.cabinet, depuis]);
      return {
        corps: {
          mois: (r.rows as { entreprise: string; mois: string; ecritures: string; brouillards: string; ca: string; dernier: Date | null }[]).map((x) => ({
            entreprise: x.entreprise, mois: x.mois, ecritures: Number(x.ecritures), brouillards: Number(x.brouillards),
            ca: versTexte(BigInt(x.ca), 3), dernier: x.dernier,
          })),
        },
      };
    },
  });

  // La production du portefeuille (brique 48 ; docs/cabinet.md, C38) : ce que le Cabinet v10 rangeait
  // dans l'index de chaque livre (cabstore.js, productionDuLivre), compté pour tous les dossiers en une
  // fois — par mois, les écritures (hors à-nouveaux), validées et au brouillard, qui y a fait le dernier
  // geste et quand ; les déclarations (déposée ou non) ; les révisions d'un mois (arrêtée ou non) ; et
  // les exercices ouverts. Tout est lu, rien n'est coché à la main ; la sécurité par ligne dit qui lit.
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/production', geste: 'compte.cabinets.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      const depuis = query.depuis ?? '';
      if (!/^\d{4}-\d{2}-01$/.test(depuis)) {
        return { statut: 400, corps: { motif: motif('commun.champ_invalide', { champ: 'depuis', raison: t('cabinet.champ.depuis') }), champ: 'depuis' } };
      }
      const portefeuille = `select p.entreprise from socle.portefeuille($1) p where p.statut = 'actif'`;
      // Une connexion, une requête à la fois.
      const mois = await tx.query(`select e.entreprise, to_char(e.date_ecriture, 'YYYY-MM') mois, count(*) ecritures,
            count(*) filter (where e.statut = 'validee') validees, count(*) filter (where e.statut = 'brouillard') brouillards,
            (array_agg(coalesce(u.nom, '') order by greatest(e.cree_le, e.validee_le) desc, e.id desc))[1] qui,
            max(greatest(e.cree_le, e.validee_le)) depuis
          from compta.ecriture e left join socle.utilisateur u on u.id = coalesce(e.validee_par, e.saisie_par)
          where e.entreprise in (${portefeuille}) and e.date_ecriture >= $2::date and e.journal <> 'AN'
          group by e.entreprise, to_char(e.date_ecriture, 'YYYY-MM') order by 1, 2`, [params.cabinet, depuis]);
      // (1.168.0) Ce que les Échéances montrent ligne par ligne : préparée, déposée, payée, par qui, et ce qu'elle fait payer
      // (la case « à décaisser », en millimes ; null si la case ne se sait pas).
      const declarations = await tx.query(`select d.entreprise, d.periode, d.deposee_le is not null deposee, d.preparee_le, coalesce(pp.nom, '') preparee_par,
            to_char(d.deposee_le, 'YYYY-MM-DD') deposee_le, coalesce(dp.nom, '') deposee_par, to_char(d.payee_le, 'YYYY-MM-DD') payee_le, d.cases->>'aDecaisser' montant
          from compta.declaration d
          left join socle.utilisateur pp on pp.id = d.preparee_par left join socle.utilisateur dp on dp.id = d.deposee_par
          where d.entreprise in (${portefeuille}) and d.periode >= to_char($2::date, 'YYYY-MM') order by 1, 2`, [params.cabinet, depuis]);
      const revisions = await tx.query(`select entreprise, periode, contenu->>'faite' = 'true' faite from cabinet.revision
          where cabinet = $1 and entreprise in (${portefeuille}) and periode ~ '^[0-9]{4}-[0-9]{2}$' and periode >= to_char($2::date, 'YYYY-MM') order by 1, 2`, [params.cabinet, depuis]);
      // Employeur, mois par mois (brique 54, C44) : un mois dont une écriture (hors à-nouveaux ; une écriture
      // contre-passée et son miroir ne comptent pas) touche les salaires (640) ou la CNSS (4531) — les comptes par défaut de la paie de la
      // v10 (compta.js, moisEmployeur). Un bulletin écrit toujours son écriture de paie : elle y est.
      const employeurs = await tx.query(`select e.entreprise, to_char(e.date_ecriture, 'YYYY-MM') mois,
            bool_or(l.compte like '640%' or l.compte like '4531%') employeur
          from compta.ecriture e join compta.ligne l on l.ecriture = e.id
          where e.entreprise in (${portefeuille}) and e.date_ecriture >= $2::date and e.journal <> 'AN' and e.origine_type <> 'contre_passation'
            and not exists (select 1 from compta.ecriture k where k.entreprise = e.entreprise and k.origine_type = 'contre_passation' and k.origine = e.id)
          group by e.entreprise, to_char(e.date_ecriture, 'YYYY-MM') order by 1, 2`, [params.cabinet, depuis]);
      const exercices = await tx.query(`select entreprise, annee, to_char(du, 'YYYY-MM-DD') du, to_char(au, 'YYYY-MM-DD') au, clos_le is not null clos from compta.exercice
          where entreprise in (${portefeuille}) and au >= $2::date order by 1, 2`, [params.cabinet, depuis]);
      return {
        corps: {
          mois: (mois.rows as { entreprise: string; mois: string; ecritures: string; validees: string; brouillards: string; qui: string; depuis: Date }[]).map((x) => ({
            entreprise: x.entreprise, mois: x.mois, ecritures: Number(x.ecritures), validees: Number(x.validees), brouillards: Number(x.brouillards),
            qui: x.qui, depuis: x.depuis.toISOString(),
          })),
          declarations: (declarations.rows as { entreprise: string; periode: string; deposee: boolean; preparee_le: Date; preparee_par: string; deposee_le: string | null;
            deposee_par: string; payee_le: string | null; montant: string | null }[]).map((d) => ({
            entreprise: d.entreprise, periode: d.periode, deposee: d.deposee, prepareeLe: d.preparee_le.toISOString().slice(0, 10), preparePar: d.preparee_par,
            deposeeLe: d.deposee_le, deposeePar: d.deposee_par, payeeLe: d.payee_le, montant: d.montant,
          })),
          revisions: revisions.rows as { entreprise: string; periode: string; faite: boolean }[],
          exercices: exercices.rows as { entreprise: string; annee: number; du: string; au: string; clos: boolean }[],
          employeurs: employeurs.rows as { entreprise: string; mois: string; employeur: boolean }[],
        },
      };
    },
  });

  // Un dossier tenu : un client qui n'est pas (encore) sur SkanFact (03 § 3.5).
  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/dossiers', geste: 'compte.cabinet.gerer',
    corps: z.object({
      raisonSociale: z.string().trim().min(1).max(200),
      // Écrit comme on le recopie : le serveur le garde sous sa forme lisible (serveur/matricule.ts ; E4).
      matriculeFiscal: z.string().max(40).optional(),
    }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      const matricule = matriculeCanonique(corps.matriculeFiscal);
      if (matricule === undefined) return refusDuMatricule(corps.matriculeFiscal);
      const id = (await tx.query('select socle.creer_dossier_tenu($1, $2, $3) id', [params.cabinet, corps.raisonSociale, matricule])).rows[0].id as string;
      await tracer(tx, id, 'cabinet.dossier_tenu.creer', id, null, { cabinet: params.cabinet, raisonSociale: corps.raisonSociale });
      // Au-delà des dossiers gratuits, la facture de l'abonnement du cabinet part dans la minute (1.120.0).
      facturerCabinetBientot(ctx, params.cabinet ?? '');
      return { statut: 201, corps: { entreprise: id } };
    },
  });
  // Le nom et le matricule d'un dossier tenu (brique 57, 0033) : un associé les corrige ; ceux d'un
  // client sur SkanFact sont les siens. Un matricule vide retire le matricule.
  ajouter({
    methode: 'PUT', chemin: '/cabinets/:cabinet/dossiers/:dossier', geste: 'compte.cabinet.gerer',
    corps: z.object({
      raisonSociale: z.string().trim().min(1).max(200),
      matriculeFiscal: z.string().max(40),
    }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success || !uuid.safeParse(params.dossier).success) return introuvable;
      const dossier = params.dossier ?? '';
      const matricule = matriculeCanonique(corps.matriculeFiscal);
      if (matricule === undefined) return refusDuMatricule(corps.matriculeFiscal);
      const avant = (await tx.query('select socle.renommer_dossier_tenu($1, $2, $3, $4) avant', [params.cabinet, dossier, corps.raisonSociale, matricule])).rows[0].avant;
      await tracer(tx, dossier, 'cabinet.dossier_tenu.renommer', dossier, avant, { raisonSociale: corps.raisonSociale, matriculeFiscal: matricule });
      return { corps: { entreprise: dossier } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/mandats/:mandat/accepter', geste: 'compte.cabinet.gerer',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const d = await mandatDuCabinet(tx, params.cabinet ?? '', params.mandat ?? '');
      if (!d) return introuvable;
      const entreprise = (await tx.query('select socle.accepter_mandat($1) e', [d.id])).rows[0].e as string;
      await tracer(tx, entreprise, 'cabinet.mandat.accepter', d.id, { statut: d.statut }, { statut: 'actif' });
      return { corps: { entreprise, statut: 'actif' } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/mandats/:mandat/arreter', geste: 'compte.cabinet.gerer',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const d = await mandatDuCabinet(tx, params.cabinet ?? '', params.mandat ?? '');
      if (!d) return introuvable;
      // Tracé AVANT : une fois le mandat arrêté, le cabinet ne voit plus l'entreprise.
      await tracer(tx, d.entreprise, 'cabinet.mandat.arreter', d.id, { statut: d.statut }, { statut: 'termine' });
      await tx.query('select socle.arreter_mandat($1)', [d.id]);
      return { corps: { statut: 'termine' } };
    },
  });

  // Confier un dossier à un membre de l'équipe, avec son rôle sur ce dossier ; le reprendre.
  ajouter({
    methode: 'PUT', chemin: '/cabinets/:cabinet/mandats/:mandat/affectations/:membre', geste: 'compte.cabinet.gerer',
    corps: z.object({ role: z.enum(ROLES_SUR_DOSSIER) }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const d = await mandatDuCabinet(tx, params.cabinet ?? '', params.mandat ?? '');
      if (!d || !uuid.safeParse(params.membre).success) return introuvable;
      await tx.query('select socle.confier_dossier($1, $2, $3)', [d.id, params.membre, corps.role]);
      if (d.statut === 'actif') await tracer(tx, d.entreprise, 'cabinet.dossier.confier', d.id, null, { membre: params.membre, role: corps.role });
      return { corps: { membre: params.membre, role: corps.role } };
    },
  });
  ajouter({
    methode: 'DELETE', chemin: '/cabinets/:cabinet/mandats/:mandat/affectations/:membre', geste: 'compte.cabinet.gerer',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const d = await mandatDuCabinet(tx, params.cabinet ?? '', params.mandat ?? '');
      if (!d || !uuid.safeParse(params.membre).success) return introuvable;
      if (d.statut === 'actif') await tracer(tx, d.entreprise, 'cabinet.dossier.reprendre', d.id, { membre: params.membre }, null);
      await tx.query('select socle.reprendre_dossier($1, $2)', [d.id, params.membre]);
      return { corps: { membre: params.membre } };
    },
  });

  // ── La fiche du dossier au cabinet (0020) ───────────────────────────────────────────────────
  // Toutes les fiches des dossiers que la personne voit (la sécurité par ligne le décide).
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/fiches', geste: 'compte.cabinets.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      const r = await requetes(tx).selectFrom('cabinet.fiche').select(['entreprise', 'contenu', 'revision'])
        .where('cabinet', '=', params.cabinet ?? '').orderBy('entreprise').execute();
      return { corps: { fiches: r.map((f) => ({ entreprise: f.entreprise, contenu: f.contenu, revision: Number(f.revision) })) } };
    },
  });
  // La poser : son contenu entier, avec la révision connue (null : la première) ; une fiche changée
  // ailleurs entre-temps n'est jamais écrasée.
  ajouter({
    methode: 'PUT', chemin: '/cabinets/:cabinet/fiches/:dossier', geste: 'compte.cabinet.gerer',
    corps: z.object({ contenu: FICHE, revision: z.number().int().positive().nullable() }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui || !uuid.safeParse(params.cabinet).success || !uuid.safeParse(params.dossier).success) return introuvable;
      const cabinet = params.cabinet ?? '', entreprise = params.dossier ?? '';
      const db = requetes(tx);
      // Le dossier doit être au portefeuille de la personne (mandat actif) : sinon, il n'existe pas pour elle.
      const auPortefeuille = (await tx.query(`select 1 from socle.portefeuille($1) where entreprise = $2 and statut = 'actif'`, [cabinet, entreprise])).rowCount;
      if (!auPortefeuille) return introuvable;
      const deja = await db.selectFrom('cabinet.fiche').select('revision').where('cabinet', '=', cabinet).where('entreprise', '=', entreprise).executeTakeFirst();
      const connue = deja ? Number(deja.revision) : null;
      if (connue !== corps.revision) return { statut: 409, corps: { motif: motif('cabinet.fiche_changee'), revision: connue } };
      const contenu = JSON.stringify(corps.contenu);
      // La révision connue se vérifie DANS l'écriture : deux postes qui enregistrent au même instant
      // ne passent pas tous les deux (le second reçoit le refus, jamais un écrasement ni une erreur).
      const ecrites = deja
        ? (await db.updateTable('cabinet.fiche').set({ contenu, revision: BigInt(connue ?? 0) + 1n, modifie_par: qui.utilisateur, modifie_le: new Date() })
          .where('cabinet', '=', cabinet).where('entreprise', '=', entreprise).where('revision', '=', BigInt(connue ?? 0)).executeTakeFirst()).numUpdatedRows
        : (await db.insertInto('cabinet.fiche').values({ cabinet, entreprise, contenu, modifie_par: qui.utilisateur })
          .onConflict((oc) => oc.doNothing()).executeTakeFirst()).numInsertedOrUpdatedRows;
      if (!ecrites) return { statut: 409, corps: { motif: motif('cabinet.fiche_changee'), revision: null } };
      return { corps: { revision: (connue ?? 0) + 1 } };
    },
  });

  // ── Le nom du cabinet (brique 47, 0031) : un associé le change ─────────────────────────────────
  ajouter({
    methode: 'PUT', chemin: '/cabinets/:cabinet/nom', geste: 'compte.cabinet.gerer',
    corps: z.object({ nom: z.string().max(200) }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      await tx.query('select socle.renommer_cabinet($1, $2)', [params.cabinet, corps.nom]);
      return { corps: { nom: corps.nom.trim() } };
    },
  });

  // ── Les réglages du cabinet (0023) ──────────────────────────────────────────────────────────
  // Les lit et les écrit qui est du cabinet (la sécurité par ligne le décide) ; changés ailleurs
  // entre-temps, ils ne sont jamais écrasés.
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/reglages', geste: 'compte.cabinets.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      const r = await requetes(tx).selectFrom('cabinet.reglages').select(['contenu', 'revision']).where('cabinet', '=', params.cabinet ?? '').executeTakeFirst();
      return { corps: { contenu: r ? r.contenu : {}, revision: r ? Number(r.revision) : null } };
    },
  });
  ajouter({
    methode: 'PUT', chemin: '/cabinets/:cabinet/reglages', geste: 'compte.cabinet.gerer',
    corps: z.object({ contenu: REGLAGES, revision: z.number().int().positive().nullable() }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui || !uuid.safeParse(params.cabinet).success) return introuvable;
      const cabinet = params.cabinet ?? '';
      const db = requetes(tx);
      const membre = (await tx.query('select 1 from socle.mes_organisations() o where o = $1', [cabinet])).rowCount;
      if (!membre) return introuvable;
      const deja = await db.selectFrom('cabinet.reglages').select('revision').where('cabinet', '=', cabinet).executeTakeFirst();
      const connue = deja ? Number(deja.revision) : null;
      if (connue !== corps.revision) return { statut: 409, corps: { motif: motif('cabinet.reglages_changes'), revision: connue } };
      const contenu = JSON.stringify(corps.contenu);
      const ecrites = deja
        ? (await db.updateTable('cabinet.reglages').set({ contenu, revision: BigInt(connue ?? 0) + 1n, modifie_par: qui.utilisateur, modifie_le: new Date() })
          .where('cabinet', '=', cabinet).where('revision', '=', BigInt(connue ?? 0)).executeTakeFirst()).numUpdatedRows
        : (await db.insertInto('cabinet.reglages').values({ cabinet, contenu, modifie_par: qui.utilisateur })
          .onConflict((oc) => oc.doNothing()).executeTakeFirst()).numInsertedOrUpdatedRows;
      if (!ecrites) return { statut: 409, corps: { motif: motif('cabinet.reglages_changes'), revision: null } };
      return { corps: { revision: (connue ?? 0) + 1 } };
    },
  });

  // ── La révision d'un dossier (0028) : le dossier de travail du cabinet, période par période ───
  // Les révisions d'une année (l'exercice et ses mois) ; la sécurité par ligne dit qui les lit.
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/revisions/:dossier', geste: 'compte.cabinets.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success || !uuid.safeParse(params.dossier).success) return introuvable;
      const annee = query.annee ?? '';
      if (!/^\d{4}$/.test(annee)) return { statut: 400, corps: { motif: motif('commun.champ_invalide', { champ: 'annee', raison: t('cabinet.champ.annee') }), champ: 'annee' } };
      const r = await requetes(tx).selectFrom('cabinet.revision').select(['periode', 'contenu', 'revision'])
        .where('cabinet', '=', params.cabinet ?? '').where('entreprise', '=', params.dossier ?? '').where(sql<boolean>`left(periode, 4) = ${annee}`)
        .orderBy('periode').execute();
      return { corps: { revisions: r.map((x) => ({ periode: x.periode, contenu: x.contenu, revision: Number(x.revision) })) } };
    },
  });
  // La poser entière, avec la révision connue (null : la première) ; la base garde qui révise
  // (cabinet.peut_reviser) et ne l'écrase jamais si elle a changé ailleurs entre-temps.
  ajouter({
    methode: 'PUT', chemin: '/cabinets/:cabinet/revisions/:dossier/:periode', geste: 'compte.cabinet.gerer',
    corps: z.object({ contenu: REVISION, revision: z.number().int().positive().nullable() }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success || !uuid.safeParse(params.dossier).success) return introuvable;
      if (!PERIODE_REVISION.test(params.periode ?? '')) {
        return { statut: 400, corps: { motif: motif('commun.champ_invalide', { champ: 'periode', raison: t('cabinet.champ.periode') }), champ: 'periode' } };
      }
      const r = (await tx.query('select cabinet.poser_revision($1, $2, $3, $4::jsonb, $5::bigint) revision',
        [params.cabinet, params.dossier, params.periode, JSON.stringify(corps.contenu), corps.revision])).rows[0];
      return { corps: { revision: Number(r.revision) } };
    },
  });

  // ── L'équipe du cabinet (brique 46, 0030) ───────────────────────────────────────────────────
  // Ses membres (leur nom, leur adresse, leur rôle), les dossiers confiés à chacun (les mandats actifs),
  // et — pour un associé — les invitations qui attendent. La sécurité par ligne dit qui voit quoi.
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/equipe', geste: 'compte.cabinets.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      const cabinet = params.cabinet ?? '';
      const membres = (await tx.query(`select m.id membre, m.utilisateur, u.nom, u.email, m.roles from socle.membre m
        join socle.utilisateur u on u.id = m.utilisateur where m.organisation = $1 and m.actif order by lower(u.nom), u.nom, m.id`, [cabinet])).rows;
      if (!membres.length) return introuvable;
      const affectations = (await tx.query(`select a.mandat, d.entreprise, a.membre, a.role from socle.mandat_affectation a
        join socle.mandat d on d.id = a.mandat where d.cabinet = $1 and d.statut = 'actif' order by d.entreprise, a.membre`, [cabinet])).rows;
      const invitations = (await tx.query(`select id, email, roles, expire_le, courriel, courriel_le from socle.invitation
        where organisation = $1 and acceptee_le is null and annulee_le is null and expire_le > now() order by cree_le`, [cabinet])).rows as { id: string; email: string; roles: string[]; expire_le: Date; courriel: string | null; courriel_le: Date | null }[];
      return {
        corps: {
          membres, affectations,
          // Ce que son e-mail est devenu (0124 ; 0138 : « sans réponse » au-delà de dix minutes sans réponse du relais).
          invitations: invitations.map((i) => ({ id: i.id, email: i.email, role: i.roles[0], expire: i.expire_le.toISOString(),
            courriel: etatVu(i.courriel, i.courriel_le, (ctx.maintenant ?? (() => new Date()))()) })),
        },
      };
    },
  });
  // Ce qui a changé dans l'équipe (brique 61, 0036) : les cinquante derniers gestes, pour un associé.
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/equipe/trace', geste: 'compte.cabinets.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      const r = await tx.query('select instant, qui, geste, avant, apres, membre from socle.trace_de_l_equipe($1)', [params.cabinet]);
      return {
        corps: {
          trace: (r.rows as { instant: Date; qui: string; geste: string; avant: Record<string, unknown> | null; apres: Record<string, unknown> | null; membre: string }[])
            .map((x) => ({ instant: x.instant.toISOString(), qui: x.qui, geste: x.geste, avant: x.avant, apres: x.apres, membre: x.membre })),
        },
      };
    },
  });
  // Inviter une personne par son adresse : le lien n'est rendu qu'ici, une fois ; la base n'en garde que l'empreinte.
  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/invitations', geste: 'compte.cabinet.gerer',
    corps: z.object({ email: z.string().trim().email({ message: 'cabinet.champ.email' }), role: z.enum(ROLES_AU_CABINET) }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      const jeton = randomBytes(24).toString('base64url');
      const expire = new Date((ctx.maintenant ?? (() => new Date()))().getTime() + 7 * 24 * 3600_000);
      const id = (await tx.query('select socle.inviter_au_cabinet($1, $2, $3, $4, $5) id',
        [params.cabinet, corps.email, corps.role, createHash('sha256').update(jeton).digest('hex'), expire])).rows[0].id as string;
      // Elle part aussi par e-mail (0119, docs/console.md C42) : qui invite, le cabinet, son rôle, le lien.
      const n = (await tx.query(`select (select nom from socle.utilisateur where id = socle.moi()) qui,
          (select nom from socle.organisation where id = $1) ou`, [params.cabinet])).rows[0] as { qui: string | null; ou: string | null };
      // L'e-mail part une fois l'invitation écrite (0124, l'audit C07) ; la réponse dit ce qu'il est devenu.
      const invitation = { a: corps.email.toLowerCase(), qui: n.qui ?? '', ou: n.ou ?? '', role: roleDansLaPhrase(corps.role), lien: lienApplication(ctx, jeton), expire };
      // « À envoyer », dans la transaction (0138, l'audit 1.42.0 A08) : un arrêt avant l'envoi en laisse la trace.
      await noterAEnvoyer(tx, createHash('sha256').update(jeton).digest('hex'), (ctx.maintenant ?? (() => new Date()))());
      return { statut: 201, corps: { id, jeton, expire: expire.toISOString() },
        apres: async () => enMots(await envoyerInvitation(ctx, invitation, createHash('sha256').update(jeton).digest('hex'))) };
    },
  });
  ajouter({
    methode: 'DELETE', chemin: '/cabinets/:cabinet/invitations/:invitation', geste: 'compte.cabinet.gerer',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success || !uuid.safeParse(params.invitation).success) return introuvable;
      await tx.query('select socle.annuler_invitation_cabinet($1)', [params.invitation]);
      return { corps: { id: params.invitation } };
    },
  });
  ajouter({
    methode: 'PUT', chemin: '/cabinets/:cabinet/membres/:membre', geste: 'compte.cabinet.gerer',
    corps: z.object({ role: z.enum(ROLES_AU_CABINET) }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success || !uuid.safeParse(params.membre).success) return introuvable;
      await tx.query('select socle.changer_role_cabinet($1, $2, $3)', [params.cabinet, params.membre, corps.role]);
      return { corps: { membre: params.membre, role: corps.role } };
    },
  });
  ajouter({
    methode: 'DELETE', chemin: '/cabinets/:cabinet/membres/:membre', geste: 'compte.cabinet.gerer',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success || !uuid.safeParse(params.membre).success) return introuvable;
      await tx.query('select socle.retirer_du_cabinet($1, $2)', [params.cabinet, params.membre]);
      return { corps: { membre: params.membre } };
    },
  });

  // ── L'entreprise et son cabinet ────────────────────────────────────────────────────────────
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/mandat', geste: 'socle.accueil.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const d = await mandatEnCours(tx, params.entreprise ?? '');
      if (!d) return { corps: { mandat: null } };
      // La fiche du cabinet n'est pas ouverte au client : son nom et son code seulement (0020).
      const cabinet = (await tx.query('select nom, code from socle.cabinet_du_mandat($1)', [d.id])).rows[0] as { nom: string; code: string } | undefined;
      return { corps: { mandat: { id: d.id, statut: d.statut, perimetre: d.perimetre, debut: d.debut, cabinet: { nom: cabinet?.nom ?? null, code: cabinet?.code ?? null } } } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/mandat', geste: 'socle.cabinet.choisir',
    corps: z.object({ codeCabinet: z.string().trim().regex(/^[A-Za-z0-9]{6,10}$/, { message: 'cabinet.champ.code' }), perimetre: perimetre.optional() }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const entreprise = params.entreprise ?? '';
      // La paie est décochée par défaut (03 § 3.4) : elle montre le salaire de chacun.
      const p = corps.perimetre ?? ['comptabilite', 'declarations', 'saisie_achats'];
      const id = (await tx.query('select socle.proposer_mandat($1, $2, $3::text[]) id', [entreprise, corps.codeCabinet, p])).rows[0].id as string;
      await tracer(tx, entreprise, 'cabinet.mandat.proposer', id, null, { perimetre: p });
      return { statut: 201, corps: { mandat: id, statut: 'propose', perimetre: p } };
    },
  });

  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/mandat/perimetre', geste: 'socle.cabinet.choisir',
    corps: z.object({ perimetre }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const entreprise = params.entreprise ?? '';
      const d = await mandatEnCours(tx, entreprise);
      if (!d) return introuvable;
      await tx.query('select socle.changer_perimetre($1, $2::text[])', [d.id, corps.perimetre]);
      await tracer(tx, entreprise, 'cabinet.mandat.perimetre', d.id, { perimetre: d.perimetre }, { perimetre: corps.perimetre });
      return { corps: { perimetre: corps.perimetre } };
    },
  });

  ajouter({
    methode: 'DELETE', chemin: '/entreprises/:entreprise/mandat', geste: 'socle.cabinet.choisir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const entreprise = params.entreprise ?? '';
      const d = await mandatEnCours(tx, entreprise);
      if (!d) return introuvable;
      await tx.query('select socle.arreter_mandat($1)', [d.id]);
      await tracer(tx, entreprise, 'cabinet.mandat.arreter', d.id, { statut: d.statut }, { statut: 'termine' });
      return { corps: { statut: 'termine' } };
    },
  });

  // ── Inviter son comptable par e-mail, quand il n'est pas encore sur SkanFact (1.77.0, 0154) ──────────────────────
  // Ce qui part chez le relais, compté : l'adresse du comptable, le nom de qui invite, l'entreprise, le lien et sa date
  // de fin. Le lien n'est rendu qu'ici, une fois (en secours, à transmettre à la main) ; la base n'en garde que l'empreinte.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/mandat/invitation', geste: 'socle.accueil.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.entreprise).success) return introuvable;
      const r = (await tx.query(`select id, email, perimetre, expire_le, courriel, courriel_le from socle.invitation_comptable
          where entreprise = $1 and utilisee_le is null and annulee_le is null and expire_le > $2 order by cree_le desc limit 1`,
        [params.entreprise, (ctx.maintenant ?? (() => new Date()))()])).rows[0];
      if (!r) return { corps: { invitation: null } };
      return { corps: { invitation: { id: r.id, email: r.email, perimetre: r.perimetre, expire: r.expire_le.toISOString(),
        courriel: etatVu(r.courriel, r.courriel_le, (ctx.maintenant ?? (() => new Date()))()) } } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/mandat/invitation', geste: 'socle.cabinet.choisir',
    corps: z.object({ email: z.string().trim().email({ message: 'cabinet.champ.email' }), perimetre: perimetre.optional() }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.entreprise).success) return introuvable;
      const entreprise = params.entreprise ?? '';
      const p = corps.perimetre ?? ['comptabilite', 'declarations', 'saisie_achats'];
      const jeton = randomBytes(24).toString('base64url');
      const empreinte = createHash('sha256').update(jeton).digest('hex');
      const maintenant = (ctx.maintenant ?? (() => new Date()))();
      const expire = new Date(maintenant.getTime() + 30 * 24 * 3600_000);
      const id = (await tx.query('select socle.inviter_comptable($1, $2, $3::text[], $4, $5) id', [entreprise, corps.email, p, empreinte, expire])).rows[0].id as string;
      await tracer(tx, entreprise, 'cabinet.mandat.inviter', id, null, { perimetre: p });
      const n = (await tx.query(`select (select coalesce(nullif(btrim(nom), ''), email) from socle.utilisateur where id = socle.moi()) qui,
          (select raison_sociale from socle.entreprise where id = $1) ou`, [entreprise])).rows[0] as { qui: string | null; ou: string | null };
      const invitation = { a: corps.email.toLowerCase(), qui: n.qui ?? '', ou: n.ou ?? '', role: '', lien: lienComptable(ctx, jeton), expire, cle: 'invitation.comptable' };
      await noterAEnvoyer(tx, empreinte, maintenant);
      return { statut: 201, corps: { id, lien: invitation.lien, expire: expire.toISOString(), perimetre: p },
        apres: async () => enMots(await envoyerInvitation(ctx, invitation, empreinte)) };
    },
  });
  ajouter({
    methode: 'DELETE', chemin: '/entreprises/:entreprise/mandat/invitation', geste: 'socle.cabinet.choisir',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.entreprise).success) return introuvable;
      await tx.query('select socle.annuler_invitation_comptable($1)', [params.entreprise]);
      return { corps: { annulee: true } };
    },
  });
  // Ce que le lien dit, avant de se connecter : l'entreprise, qui invite, l'adresse invitée.
  ajouter({
    methode: 'POST', chemin: '/invitations-comptable/apercu', geste: 'public',
    corps: z.object({ jeton: z.string().min(10).max(100) }),
    traiter: async ({ corps }) => {
      const r = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from socle.apercu_invitation_comptable($1, $2)',
        [createHash('sha256').update(corps.jeton).digest('hex'), (ctx.maintenant ?? (() => new Date()))()])).rows[0]) as
        { entreprise: string; invite_par: string; email: string; expire_le: Date } | undefined;
      if (!r) return { corps: { valable: false } };
      return { corps: { valable: true, entreprise: r.entreprise, invitePar: r.invite_par, email: r.email, expire: r.expire_le.toISOString() } };
    },
  });
  // Le comptable, associé de son cabinet, reçoit le dossier : il y arrive proposé, à accepter sur la page Dossiers.
  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/invitations-comptable/rejoindre', geste: 'compte.cabinet.gerer',
    corps: z.object({ jeton: z.string().min(10).max(100) }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      const r = (await tx.query('select * from socle.rejoindre_par_invitation_comptable($1, $2, $3)',
        [createHash('sha256').update(corps.jeton).digest('hex'), params.cabinet, (ctx.maintenant ?? (() => new Date()))()])).rows[0] as { entreprise: string; mandat: string };
      return { corps: { entreprise: r.entreprise, mandat: r.mandat, statut: 'propose' } };
    },
  });

  // ── Le cabinet invite son client tenu à rejoindre son dossier (1.78.0, 0155 ; 03 § 3.5) ───────────────────────────
  // Ce qui part chez le relais, compté : l'adresse du client, le nom de qui invite, le cabinet, le dossier, le lien et
  // sa date de fin. Le lien n'est rendu qu'ici, une fois (en secours) ; la base n'en garde que l'empreinte.
  ajouter({
    methode: 'GET', chemin: '/cabinets/:cabinet/dossiers/:dossier/invitation', geste: 'compte.cabinets.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success || !uuid.safeParse(params.dossier).success) return introuvable;
      const maintenant = (ctx.maintenant ?? (() => new Date()))();
      const r = (await tx.query(`select id, email, expire_le, courriel, courriel_le from socle.invitation_client_tenu
          where cabinet = $1 and entreprise = $2 and utilisee_le is null and annulee_le is null and expire_le > $3 order by cree_le desc limit 1`,
        [params.cabinet, params.dossier, maintenant])).rows[0];
      if (!r) return { corps: { invitation: null } };
      return { corps: { invitation: { id: r.id, email: r.email, expire: r.expire_le.toISOString(), courriel: etatVu(r.courriel, r.courriel_le, maintenant) } } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/dossiers/:dossier/invitation', geste: 'compte.cabinet.gerer',
    corps: z.object({ email: z.string().trim().email({ message: 'cabinet.champ.email' }) }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success || !uuid.safeParse(params.dossier).success) return introuvable;
      const tenu = (await tx.query('select 1 from socle.entreprise where id = $1 and tenue_par = $2', [params.dossier, params.cabinet])).rowCount;
      if (!tenu) return introuvable;
      const jeton = randomBytes(24).toString('base64url');
      const empreinte = createHash('sha256').update(jeton).digest('hex');
      const maintenant = (ctx.maintenant ?? (() => new Date()))();
      const expire = new Date(maintenant.getTime() + 30 * 24 * 3600_000);
      const id = (await tx.query('select socle.inviter_client_tenu($1, $2, $3, $4) id', [params.dossier, corps.email, empreinte, expire])).rows[0].id as string;
      const n = (await tx.query(`select (select coalesce(nullif(btrim(nom), ''), email) from socle.utilisateur where id = socle.moi()) qui,
          (select nom from socle.organisation where id = $1) cabinet, (select raison_sociale from socle.entreprise where id = $2) dossier`,
        [params.cabinet, params.dossier])).rows[0] as { qui: string | null; cabinet: string | null; dossier: string | null };
      const invitation = { a: corps.email.toLowerCase(), qui: n.qui ?? '', ou: n.dossier ?? '', role: n.cabinet ?? '', lien: lienDossier(ctx, jeton), expire, cle: 'invitation.dossier' };
      await noterAEnvoyer(tx, empreinte, maintenant);
      return { statut: 201, corps: { id, lien: invitation.lien, expire: expire.toISOString() },
        apres: async () => enMots(await envoyerInvitation(ctx, invitation, empreinte)) };
    },
  });
  ajouter({
    methode: 'DELETE', chemin: '/cabinets/:cabinet/dossiers/:dossier/invitation', geste: 'compte.cabinet.gerer',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success || !uuid.safeParse(params.dossier).success) return introuvable;
      await tx.query('select socle.annuler_invitation_client_tenu($1)', [params.dossier]);
      return { corps: { annulee: true } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/invitations-dossier/apercu', geste: 'public',
    corps: z.object({ jeton: z.string().min(10).max(100) }),
    traiter: async ({ corps }) => {
      const r = await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select * from socle.apercu_invitation_client_tenu($1, $2)',
        [createHash('sha256').update(corps.jeton).digest('hex'), (ctx.maintenant ?? (() => new Date()))()])).rows[0]) as
        { entreprise: string; cabinet: string; invite_par: string; email: string; expire_le: Date } | undefined;
      if (!r) return { corps: { valable: false } };
      return { corps: { valable: true, entreprise: r.entreprise, cabinet: r.cabinet, invitePar: r.invite_par, email: r.email, expire: r.expire_le.toISOString() } };
    },
  });
  // Le client rejoint son dossier : il en devient le propriétaire (la trace le dit, chez lui).
  ajouter({
    methode: 'POST', chemin: '/invitations-dossier/rejoindre', geste: 'compte.invitation.accepter',
    corps: z.object({ jeton: z.string().min(10).max(100) }),
    traiter: async ({ corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const entreprise = (await tx.query('select socle.rejoindre_dossier_tenu($1, $2) e',
        [createHash('sha256').update(corps.jeton).digest('hex'), (ctx.maintenant ?? (() => new Date()))()])).rows[0].e as string;
      await tx.query('select socle.tracer($1, $2, $3, $4, $5, $6)', [entreprise, 'socle.dossier.rejoindre', 'entreprise', entreprise, JSON.stringify({ tenu: true }), JSON.stringify({ tenu: false })]);
      return { corps: { entreprise } };
    },
  });

  return routes;
}
