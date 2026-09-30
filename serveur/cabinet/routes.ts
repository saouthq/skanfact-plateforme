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
import { requetes, type Transaction } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { motif, t } from '../../textes/index.ts';
import './textes.ts';
import { Refus } from '../erreurs.ts';
import { lireLivreV10, rapportDuLivre } from '../reprise/livre-v10.ts';
import { lirePortefeuilleV10, PORTEFEUILLE_V10 } from '../reprise/cabinet-v10.ts';
import { versLaBaseFiche } from '../compta/immobilisations.ts';
import { PERIODE_REVISION, REVISION } from './revision.ts';

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
const REGIME_DE_CONTRAT = z.object({
  cnssEmployee: TAUX_POUR_CENT, cnssEmployer: TAUX_POUR_CENT, accidentRate: TAUX_POUR_CENT, tfpRate: TAUX_POUR_CENT,
  foprolosRate: TAUX_POUR_CENT, solidarity: TAUX_POUR_CENT, sansIrpp: z.literal(true),
}).partial().strict();
const CONTRATS_A_REGIME = ['cdd', 'saisonnier', 'civp', 'sivp', 'karama', 'stage', 'autre'] as const;
const FICHE = z.object({
  email: texte(200), phone: texte(40), contact: texte(200), note: texte(2000), archived: z.boolean(),
  from: z.string().regex(/^(\d{4}-\d{2})?$/), regime: texte(40), tvaPeriod: texte(20),
  fees: z.number().int().min(0).max(1_000_000_000_000), cnssEmployeur: texte(40), cnssCode: texte(10),
  relances: z.array(RELANCE).max(50),
  // Le compte bancaire du dossier, sa banque, et l'écart de jours du rapprochement (brique 40, C21).
  banque: z.object({ compte: z.string().regex(/^(\d{1,12})?$/), banque: texte(60), jours: z.number().int().min(0).max(30).nullable() }).partial().strict(),
  // Le dernier journal de saisie du dossier, celui que la grille reprend (brique 50).
  dernierJournal: z.string().regex(/^[A-Z0-9]{0,5}$/),
  // Les abonnements du dossier (brique 51).
  abonnements: z.array(ABONNEMENT).max(50),
  // Les taux par contrat de la paie du dossier (brique 55).
  paie: z.object({ regimesContrat: z.partialRecord(z.enum(CONTRATS_A_REGIME), REGIME_DE_CONTRAT) }).strict(),
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
      return {
        corps: {
          dossiers: r.rows.map((d) => ({
            mandat: d.mandat, entreprise: d.entreprise, raisonSociale: d.raison_sociale, matriculeFiscal: d.matricule_fiscal,
            statut: d.statut, perimetre: d.perimetre, debut: d.debut, tenu: d.tenu, role: d.role,
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
      const declarations = await tx.query(`select entreprise, periode, deposee_le is not null deposee from compta.declaration
          where entreprise in (${portefeuille}) and periode >= to_char($2::date, 'YYYY-MM') order by 1, 2`, [params.cabinet, depuis]);
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
          declarations: declarations.rows as { entreprise: string; periode: string; deposee: boolean }[],
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
      // La forme du matricule fiscal que la base garde (0001) : « 1234567A/P/M/000 ».
      matriculeFiscal: z.string().trim().toUpperCase().regex(/^[0-9]{7}[A-Z]\/?[A-Z]\/?[A-Z]\/?[0-9]{3}$/, { message: 'cabinet.champ.matricule' }).optional(),
    }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      const id = (await tx.query('select socle.creer_dossier_tenu($1, $2, $3) id', [params.cabinet, corps.raisonSociale, corps.matriculeFiscal ?? null])).rows[0].id as string;
      await tracer(tx, id, 'cabinet.dossier_tenu.creer', id, null, { cabinet: params.cabinet, raisonSociale: corps.raisonSociale });
      return { statut: 201, corps: { entreprise: id } };
    },
  });
  // Le nom et le matricule d'un dossier tenu (brique 57, 0033) : un associé les corrige ; ceux d'un
  // client sur SkanFact sont les siens. Un matricule vide retire le matricule.
  ajouter({
    methode: 'PUT', chemin: '/cabinets/:cabinet/dossiers/:dossier', geste: 'compte.cabinet.gerer',
    corps: z.object({
      raisonSociale: z.string().trim().min(1).max(200),
      matriculeFiscal: z.string().trim().toUpperCase().regex(/^([0-9]{7}[A-Z]\/?[A-Z]\/?[A-Z]\/?[0-9]{3})?$/, { message: 'cabinet.champ.matricule' }),
    }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success || !uuid.safeParse(params.dossier).success) return introuvable;
      const dossier = params.dossier ?? '';
      const avant = (await tx.query('select socle.renommer_dossier_tenu($1, $2, $3, $4) avant', [params.cabinet, dossier, corps.raisonSociale, corps.matriculeFiscal || null])).rows[0].avant;
      await tracer(tx, dossier, 'cabinet.dossier_tenu.renommer', dossier, avant, { raisonSociale: corps.raisonSociale, matriculeFiscal: corps.matriculeFiscal || null });
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
      const invitations = (await tx.query(`select id, email, roles, expire_le from socle.invitation
        where organisation = $1 and acceptee_le is null and annulee_le is null and expire_le > now() order by cree_le`, [cabinet])).rows as { id: string; email: string; roles: string[]; expire_le: Date }[];
      return {
        corps: {
          membres, affectations,
          invitations: invitations.map((i) => ({ id: i.id, email: i.email, role: i.roles[0], expire: i.expire_le.toISOString() })),
        },
      };
    },
  });
  // L'essai à blanc de la reprise d'un livre du Cabinet v10 (brique 62, C52) : lu, contrôlé, rendu en
  // rapport ; rien n'est créé. Un associé seulement (la porte du cabinet).
  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/reprise/livre/essai', geste: 'compte.cabinet.gerer', limiteCorps: 32 * 1024 * 1024,
    corps: z.object({ livre: z.unknown() }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      if (!(await tx.query('select socle.suis_associe($1) a', [params.cabinet])).rows[0].a) return { statut: 403, corps: { motif: motif('cabinet.reprise.associe') } };
      const lu = lireLivreV10(corps.livre);
      if (!lu) return { statut: 400, corps: { motif: motif('cabinet.reprise.pas_un_livre'), champ: 'livre' } };
      return { corps: rapportDuLivre(lu) };
    },
  });
  // La reprise d'un livre du Cabinet v10 dans un dossier tenu (brique 63, 0037, C53) : relu et contrôlé
  // comme à l'essai à blanc ; une seule anomalie, et rien ne s'écrit. Écrit, sa balance est relue dans
  // la base et comparée à celle du livre : un écart défait tout (deux chemins, un chiffre).
  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/reprise/livre', geste: 'compte.cabinet.gerer', limiteCorps: 32 * 1024 * 1024,
    corps: z.object({ dossier: z.string().uuid(), livre: z.unknown() }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      if (!(await tx.query('select socle.suis_associe($1) a', [params.cabinet])).rows[0].a) return { statut: 403, corps: { motif: motif('cabinet.reprise.associe') } };
      const lu = lireLivreV10(corps.livre);
      if (!lu) return { statut: 400, corps: { motif: motif('cabinet.reprise.pas_un_livre'), champ: 'livre' } };
      const rapport = rapportDuLivre(lu);
      if (lu.anomalies.length) return { statut: 400, corps: { motif: motif('cabinet.reprise.anomalies', { n: String(lu.anomalies.length) }), rapport } };
      const ecritures = lu.ecritures.map((e) => ({
        date: e.date, journal: e.journal, piece: e.piece, libelle: e.libelle, statut: e.statut, numero: e.numeroV10 === null ? null : String(e.numeroV10),
        lignes: e.lignes.map((l) => ({ compte: l.compte, libelle: l.libelle, tiers: l.tiers, debit: l.debit.toString(), credit: l.credit.toString(), lettre: l.lettre })),
      }));
      const empreinte = createHash('sha256').update(JSON.stringify(corps.livre)).digest('hex');
      const cree = (await tx.query('select compta.reprendre_livre_v10($1, $2, $3, $4, $5::jsonb, $6) r',
        [corps.dossier, lu.annee, lu.du, lu.au, JSON.stringify(ecritures), empreinte])).rows[0].r as { validees: number; brouillard: number; lettrages: number; lettres: { v10: string; lettre: string }[]; jusqua: string | null; ids: string[] };
      // Les relevés (brique 66) : importés par les gestes de la banque, qui refont leurs contrôles ; chaque
      // rapprochement relié à la ligne d'écriture reprise (son écriture, sa place parmi les lignes écrites).
      const { ids, ...resultat } = cree;
      const ecritureDe = new Map(lu.ecritures.map((e, i) => [e.refV10, { id: ids[i] ?? '', rangs: e.lignes.map((l) => l.rangV10) }]));
      let rapprochees = 0;
      const lignesEcrites = new Map<string, string>();
      if (lu.releves.some((r) => r.lignes.some((l) => l.face))) {
        for (const x of (await tx.query('select id, ecriture, rang from compta.ligne where ecriture = any($1::uuid[])', [ids])).rows as { id: string; ecriture: string; rang: number }[]) {
          lignesEcrites.set(`${x.ecriture}#${x.rang}`, x.id);
        }
      }
      for (const r of lu.releves) {
        const releve = (await tx.query('select compta.importer_releve($1, $2, $3::jsonb) id', [corps.dossier, lu.annee, JSON.stringify({
          compte: r.compte, banque: r.banque, fichier: r.fichier, empreinte: r.empreinte, soldeDebut: r.soldeDebut.toString(), soldeFin: r.soldeFin.toString(),
          lignes: r.lignes.map((l) => ({ date: l.date, libelle: l.libelle, reference: l.reference, montant: l.montant.toString() })),
        })])).rows[0].id as string;
        const lignes = (await tx.query('select id, rang from compta.releve_ligne where releve = $1', [releve])).rows as { id: string; rang: number }[];
        const ligneDuReleve = new Map(lignes.map((x) => [Number(x.rang), x.id]));
        const poses: { ligne: string; ecritureLigne: string | null; niveau: string; auto: boolean }[] = [];
        for (const [i, l] of r.lignes.entries()) {
          const ligne = ligneDuReleve.get(i + 1) ?? '';
          if (l.face) {
            const e = ecritureDe.get(l.face.ecriture);
            const rang = e ? e.rangs.indexOf(l.face.rangV10) + 1 : 0;
            poses.push({ ligne, ecritureLigne: lignesEcrites.get(`${e?.id}#${rang}`) ?? null, niveau: l.face.niveau, auto: l.face.auto });
            rapprochees++;
          } else if (l.niveau !== 'aucun') poses.push({ ligne, ecritureLigne: null, niveau: l.niveau, auto: true });
        }
        if (poses.length) await tx.query('select compta.rapprocher($1, $2, $3::jsonb)', [corps.dossier, releve, JSON.stringify(poses)]);
      }
      // Les immobilisations (brique 67) : chaque bien posé une fois pour la vie du dossier (ou retrouvé,
      // s'il vient d'une autre année reprise), relié aux écritures reprises qui portent sa dotation ou sa
      // sortie ; l'écriture d'acquisition dont il est né devient l'écriture reprise.
      const immobilisations = { creees: 0, retrouvees: 0, liees: 0 };
      for (const b of lu.biens) {
        const nee = b.docRef ? ecritureDe.get(b.docRef.ecriture) : undefined;
        const docId = nee && b.docRef ? `${nee.id}#${nee.rangs.indexOf(b.docRef.rangV10)}` : b.fiche.origine.docId;
        const f = versLaBaseFiche({ ...b.fiche, origine: { ...b.fiche.origine, docId } });
        if ('statut' in f) throw new Error('fiche relue illisible');
        const liens = b.liens.map((l) => ({ genre: l.genre, ecriture: ecritureDe.get(l.ecriture)?.id ?? null }));
        const r = (await tx.query('select compta.reprendre_immobilisation_v10($1, $2, $3::jsonb, $4::jsonb) r', [corps.dossier, lu.annee, JSON.stringify(f.fiche), JSON.stringify(liens)])).rows[0].r as { cree: boolean; liees: number };
        if (r.cree) immobilisations.creees++; else immobilisations.retrouvees++;
        immobilisations.liees += r.liees;
      }
      // La révision de chaque période (le dossier de travail du cabinet) et les questions au client, dans
      // leur état (brique 68) : la révision par le geste ordinaire, les questions par la base (0041).
      for (const r of lu.revisions) {
        await tx.query('select cabinet.poser_revision($1, $2, $3, $4::jsonb, null)', [params.cabinet, corps.dossier, r.periode, JSON.stringify(r.contenu)]);
      }
      // Les déclarations préparées et l'inventaire, reliés à leur écriture reprise (brique 69, 0042).
      for (const d of lu.declarations) {
        await tx.query('select compta.reprendre_declaration_v10($1, $2::jsonb)', [corps.dossier, JSON.stringify({
          periode: d.periode, cases: Object.fromEntries(Object.entries(d.cases).map(([k, v]) => [k, v === null ? null : Number(v)])),
          preparee: d.preparee, deposee: d.deposee, payee: d.payee, ecriture: ecritureDe.get(d.ecriture)?.id ?? null,
        })]);
      }
      if (lu.inventaire) {
        const inv = lu.inventaire;
        await tx.query('select compta.reprendre_inventaire_v10($1, $2, $3::jsonb)', [corps.dossier, lu.annee, JSON.stringify({
          date: inv.date, compte: inv.compte, lignes: inv.lignes.map((l) => ({ ref: l.ref, libelle: l.libelle, quantite: Number(l.quantite), cout: Number(l.cout) })),
          ecriture: ecritureDe.get(inv.ecriture)?.id ?? null,
        })]);
      }
      const questions = lu.questions.length ? (await tx.query('select compta.reprendre_questions_v10($1, $2::jsonb) n', [corps.dossier, JSON.stringify(lu.questions.map((q) => ({
        ...q, montant: q.montant.toString(), ecriture: ecritureDe.get(q.ecriture)?.id ?? null,
      })))])).rows[0].n as number : 0;
      // Deux chemins, un chiffre : la balance que la base tient maintenant est celle du livre.
      const b = (await tx.query(`select l.compte, sum(l.debit)::text debit, sum(l.credit)::text credit from compta.ligne l join compta.ecriture e on e.id = l.ecriture
          where e.entreprise = $1 and e.statut = 'validee' and e.date_ecriture between $2::date and $3::date group by l.compte`, [corps.dossier, lu.du, lu.au])).rows as { compte: string; debit: string; credit: string }[];
      const tenue = b.map((x) => ({ compte: x.compte, debit: versTexte(BigInt(x.debit), 3), credit: versTexte(BigInt(x.credit), 3) }))
        .sort((x, y) => (x.compte < y.compte ? -1 : x.compte > y.compte ? 1 : 0));
      const attendue = rapport.balance.map((x) => ({ compte: x.compte, debit: x.debit, credit: x.credit }));
      if (JSON.stringify(tenue) !== JSON.stringify(attendue)) throw new Refus('cabinet.reprise.ecart');
      return { statut: 201, corps: { ...resultat, releves: lu.releves.length, rapprochees, immobilisations, revisions: lu.revisions.length, questions, declarations: lu.declarations.length, inventaire: !!lu.inventaire, empreinte, rapport } };
    },
  });
  // Le portefeuille du Cabinet v10 (brique 70, C60) : ses dossiers tenus, lus et contrôlés ; ceux déjà
  // au portefeuille (même matricule, ou même nom sans matricule) sont retrouvés, jamais recréés.
  const lirePortefeuille = async (tx: Transaction, cabinet: string, corps: z.infer<typeof PORTEFEUILLE_V10>) => {
    const lu = lirePortefeuilleV10(corps);
    const anomalies = lu.anomalies.map((a) => ({ nom: a.nom, motif: a.motif }));
    for (const d of lu.dossiers) {
      const f = FICHE.safeParse(d.fiche);
      if (!f.success) anomalies.push({ nom: d.nom, motif: motif('reprise.dossier_fiche', { champ: f.error.issues[0]?.path.join('.') ?? '' }) });
    }
    const deja = (await tx.query(`select raison_sociale, matricule_fiscal from socle.portefeuille($1) where tenu`, [cabinet])).rows as { raison_sociale: string; matricule_fiscal: string | null }[];
    const retrouve = (d: { nom: string; matricule: string | null }) => deja.some((x) => (d.matricule ? x.matricule_fiscal === d.matricule
      : !x.matricule_fiscal && x.raison_sociale.trim().toLowerCase() === d.nom.toLowerCase()));
    const aCreer = lu.dossiers.filter((d) => !retrouve(d));
    return {
      aCreer, rapport: {
        aCreer: aCreer.map((d) => ({ nom: d.nom, matricule: d.matricule })), retrouves: lu.dossiers.filter(retrouve).map((d) => d.nom),
        surSkanfact: lu.surSkanfact, exemples: lu.exemples, anomalies,
      },
    };
  };
  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/reprise/portefeuille/essai', geste: 'compte.cabinet.gerer', limiteCorps: 8 * 1024 * 1024, corps: PORTEFEUILLE_V10,
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.cabinet).success) return introuvable;
      if (!(await tx.query('select socle.suis_associe($1) a', [params.cabinet])).rows[0].a) return { statut: 403, corps: { motif: motif('cabinet.reprise.portefeuille_associe') } };
      return { corps: (await lirePortefeuille(tx, params.cabinet ?? '', corps)).rapport };
    },
  });
  // Créer les dossiers : chacun par le geste ordinaire (socle.creer_dossier_tenu, qui refait ses
  // contrôles, dont le matricule libre), avec sa fiche. Une seule anomalie, et rien ne se crée.
  ajouter({
    methode: 'POST', chemin: '/cabinets/:cabinet/reprise/portefeuille', geste: 'compte.cabinet.gerer', limiteCorps: 8 * 1024 * 1024, corps: PORTEFEUILLE_V10,
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui || !uuid.safeParse(params.cabinet).success) return introuvable;
      const cabinet = params.cabinet ?? '';
      if (!(await tx.query('select socle.suis_associe($1) a', [cabinet])).rows[0].a) return { statut: 403, corps: { motif: motif('cabinet.reprise.portefeuille_associe') } };
      const { aCreer, rapport } = await lirePortefeuille(tx, cabinet, corps);
      if (rapport.anomalies.length) return { statut: 400, corps: { motif: motif('cabinet.reprise.portefeuille_anomalies', { n: String(rapport.anomalies.length) }), rapport } };
      const crees: { v10: string; entreprise: string }[] = [];
      for (const d of aCreer) {
        const id = (await tx.query('select socle.creer_dossier_tenu($1, $2, $3) id', [cabinet, d.nom, d.matricule])).rows[0].id as string;
        await tracer(tx, id, 'cabinet.dossier_tenu.creer', id, null, { cabinet, raisonSociale: d.nom, repriseV10: true });
        await requetes(tx).insertInto('cabinet.fiche').values({ cabinet, entreprise: id, contenu: JSON.stringify(d.fiche), modifie_par: qui.utilisateur }).execute();
        crees.push({ v10: d.refV10, entreprise: id });
      }
      return { statut: 201, corps: { crees, rapport } };
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
      return { statut: 201, corps: { id, jeton, expire: expire.toISOString() } };
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

  return routes;
}
