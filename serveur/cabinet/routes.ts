// Les routes du cabinet (brique 36 ; docs/cabinet.md). Deux côtés :
//   - le cabinet : le créer, son portefeuille, accepter ou arrêter un mandat, créer un dossier tenu,
//     confier un dossier à un collaborateur. Ce sont des gestes de la PERSONNE (ils ne portent pas
//     sur une entreprise) : la base vérifie elle-même, dans chaque fonction, qui est associé ;
//   - l'entreprise : voir son cabinet, le choisir (par son code), changer le périmètre, arrêter le
//     mandat (le propriétaire seul, geste socle.cabinet.choisir).
// Chaque changement d'un mandat se trace chez l'entreprise : elle voit qui a fait quoi (03 § 3.4).

import { z } from 'zod';
import { versTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import { requetes, type Transaction } from '../base.ts';
import type { Contexte } from '../connexion.ts';
import { motif, t } from '../../textes/index.ts';
import './textes.ts';

const uuid = z.string().uuid();
const PERIMETRES = ['comptabilite', 'declarations', 'saisie_achats', 'paie'] as const;
const perimetre = z.array(z.enum(PERIMETRES)).min(1).max(4).refine((p) => new Set(p).size === p.length, { message: 'cabinet.champ.perimetre' });
const ROLES_SUR_DOSSIER = ['supervision', 'revision', 'saisie', 'paie'] as const;
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
const FICHE = z.object({
  email: texte(200), phone: texte(40), contact: texte(200), note: texte(2000), archived: z.boolean(),
  from: z.string().regex(/^(\d{4}-\d{2})?$/), regime: texte(40), tvaPeriod: texte(20),
  fees: z.number().int().min(0).max(1_000_000_000_000), cnssEmployeur: texte(40), cnssCode: texte(10),
  relances: z.array(RELANCE).max(50),
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
  void ctx;
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
