// Les immobilisations (brique 42 ; docs/cabinet.md, C28 et C29). Le plan d'amortissement se calcule
// dans le navigateur, par la v10 ; le serveur garde les fiches des biens (une par bien, pour toute la
// vie de l'entreprise) et le lien entre un bien, une année et l'écriture qui porte sa dotation ou sa
// sortie. La base refait chaque contrôle (compta.poser_immobilisation…, migration 0026). Les montants
// entrent en texte exact et vont à la base en millimes ; la durée en centièmes d'année ; un taux
// dégressif en entier à quatre décimales.

import { z } from 'zod';
import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import type { Contexte } from '../connexion.ts';
import { motif, t } from '../../textes/index.ts';
import { ECRITURE, estJour, versLaBase } from './saisie.ts';
import './textes.ts';

const uuid = z.string().uuid();
const champInvalide = (champ: string, raison: ReturnType<typeof t>) => ({ statut: 400 as const, corps: { motif: motif('commun.champ_invalide', { champ, raison }), champ } });
const introuvable = { statut: 404 as const, corps: { motif: motif('commun.introuvable') } };
const jour = z.string().refine(estJour, { message: 'champ.jour' });
const compte = z.string().regex(/^\d{1,12}$/, { message: 'compta.champ.compte' });
const texte = z.string().max(30);

export const FICHE = z.object({
  libelle: z.string().max(200),
  compte, compteAmort: compte, compteDotation: compte,
  dateAcquisition: jour, dateMiseEnService: jour,
  valeur: texte, residuelle: texte, tva: texte,
  methode: z.enum(['lineaire', 'degressif']),
  duree: texte,
  tauxDegressif: texte.nullable(),
  bascule: z.boolean(),
  subvention: z.object({ montant: texte, compte, compteReprise: compte }).strict().nullable(),
  cession: z.object({ date: jour, prix: texte, motif: z.enum(['cession', 'rebut']) }).strict().nullable(),
  origine: z.object({ source: z.string().max(20), docId: z.string().max(100), mois: z.string().max(7) }).strict(),
}).strict();
type Fiche = z.infer<typeof FICHE>;
type FicheBase = Omit<Fiche, 'valeur' | 'residuelle' | 'tva' | 'duree' | 'tauxDegressif' | 'subvention' | 'cession'> & {
  valeur: number; residuelle: number; tva: number; dureeCentiemes: number; tauxDegressif: number | null;
  subvention: { montant: number; compte: string; compteReprise: string } | null;
  cession: { date: string; prix: number; motif: string } | null;
};

// Un nombre exact à `d` décimales (« 1 250,125 », « 2,5 »), ou null s'il ne se lit pas.
const exact = (v: string, d: number) => { try { return Number(depuisTexte(v, d)); } catch { return null; } };

// La fiche de l'API → celle de la base, ou le champ qui ne se lit pas.
export function versLaBaseFiche(f: Fiche): { fiche: FicheBase } | ReturnType<typeof champInvalide> {
  const argent = (v: string, champ: string) => exact(v, 3) ?? champ;
  const valeur = argent(f.valeur, 'fiche.valeur'), residuelle = argent(f.residuelle || '0', 'fiche.residuelle'), tva = argent(f.tva || '0', 'fiche.tva');
  for (const v of [valeur, residuelle, tva]) if (typeof v === 'string') return champInvalide(v, t('compta.champ.montant'));
  const duree = exact(f.duree, 2);
  if (duree === null) return champInvalide('fiche.duree', t('compta.champ.duree'));
  const taux = f.tauxDegressif === null || f.tauxDegressif.trim() === '' ? null : exact(f.tauxDegressif, 4);
  if (taux === null && f.tauxDegressif !== null && f.tauxDegressif.trim() !== '') return champInvalide('fiche.tauxDegressif', t('compta.champ.taux'));
  let subvention = null;
  if (f.subvention) {
    const m = exact(f.subvention.montant, 3);
    if (m === null) return champInvalide('fiche.subvention.montant', t('compta.champ.montant'));
    subvention = { ...f.subvention, montant: m };
  }
  let cession = null;
  if (f.cession) {
    const prix = exact(f.cession.prix || '0', 3);
    if (prix === null) return champInvalide('fiche.cession.prix', t('compta.champ.montant'));
    cession = { ...f.cession, prix };
  }
  const { duree: _d, ...reste } = f;
  void _d;
  return { fiche: { ...reste, libelle: f.libelle.trim(), valeur: valeur as number, residuelle: residuelle as number, tva: tva as number,
    dureeCentiemes: duree, tauxDegressif: taux, subvention, cession } };
}
// La fiche de la base → celle de l'API (les montants en texte exact).
function versLApi(f: FicheBase) {
  const m = (v: number) => versTexte(BigInt(v), 3);
  const { dureeCentiemes, ...reste } = f;
  return {
    ...reste, valeur: m(f.valeur), residuelle: m(f.residuelle), tva: m(f.tva ?? 0),
    duree: versTexte(BigInt(dureeCentiemes), 2).replace(/\.?0+$/, ''),
    tauxDegressif: f.tauxDegressif === null ? null : versTexte(BigInt(f.tauxDegressif), 4).replace(/\.?0+$/, ''),
    subvention: f.subvention ? { ...f.subvention, montant: m(f.subvention.montant) } : null,
    cession: f.cession ? { ...f.cession, prix: m(f.cession.prix) } : null,
  };
}

const ECRIRE = z.object({
  annee: z.number().int().min(1900).max(2999),
  pieces: z.array(z.object({ immobilisation: uuid, genre: z.enum(['dotation', 'subvention', 'cession']), ecriture: ECRITURE }).strict()).min(1).max(1000),
}).strict();

export function routesImmobilisations(ctx: Contexte): Route<never>[] {
  void ctx;
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  // Les fiches de l'entreprise, et les écritures qui portent encore leurs dotations et leurs sorties.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/compta/immobilisations', geste: 'compta.livres.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const fiches = (await tx.query('select id, fiche, revision from compta.immobilisation where entreprise = $1 order by cree_le, id', [params.entreprise ?? ''])).rows;
      const liens = (await tx.query(`select l.immobilisation, l.annee, l.genre, l.ecriture from compta.immobilisation_ecriture l
          where l.entreprise = $1 and compta.ecriture_vivante(l.ecriture) order by l.annee, l.genre`, [params.entreprise ?? ''])).rows;
      return {
        corps: {
          immobilisations: fiches.map((f) => ({
            id: f.id, revision: Number(f.revision), fiche: versLApi(f.fiche as FicheBase),
            ecritures: liens.filter((l) => l.immobilisation === f.id).map((l) => ({ annee: Number(l.annee), genre: l.genre, ecriture: l.ecriture })),
          })),
        },
      };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/immobilisations', geste: 'compta.ecritures.saisir', corps: z.object({ fiche: FICHE }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const f = versLaBaseFiche(corps.fiche);
      if ('statut' in f) return f;
      const r = (await tx.query('select * from compta.poser_immobilisation($1, null, $2::jsonb, null)', [params.entreprise ?? '', JSON.stringify(f.fiche)])).rows[0];
      return { statut: 201, corps: { id: r.r_id, revision: Number(r.r_revision) } };
    },
  });

  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/compta/immobilisations/:immobilisation', geste: 'compta.ecritures.saisir',
    corps: z.object({ fiche: FICHE, revision: z.number().int().positive() }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.immobilisation).success) return introuvable;
      const f = versLaBaseFiche(corps.fiche);
      if ('statut' in f) return f;
      const r = (await tx.query('select * from compta.poser_immobilisation($1, $2, $3::jsonb, $4)', [params.entreprise ?? '', params.immobilisation, JSON.stringify(f.fiche), corps.revision])).rows[0];
      return { corps: { id: r.r_id, revision: Number(r.r_revision) } };
    },
  });

  ajouter({
    methode: 'DELETE', chemin: '/entreprises/:entreprise/compta/immobilisations/:immobilisation', geste: 'compta.ecritures.saisir',
    traiter: async ({ params, query }, tx) => {
      if (!tx || !uuid.safeParse(params.immobilisation).success) return introuvable;
      const revision = Number(query.revision);
      if (!Number.isInteger(revision) || revision < 1) return champInvalide('revision', t('compta.champ.revision'));
      await tx.query('select compta.supprimer_immobilisation($1, $2, $3)', [params.entreprise ?? '', params.immobilisation, revision]);
      return { corps: { ok: true } };
    },
  });

  // Écrire les dotations, reprises et sorties d'une année, au brouillard, liées à leur bien.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/immobilisations/ecrire', geste: 'compta.ecritures.valider', corps: ECRIRE,
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const pieces = [];
      for (const [i, p] of corps.pieces.entries()) {
        const e = versLaBase(p.ecriture);
        if ('statut' in e) return { ...e, corps: { ...e.corps, champ: `pieces.${i}.${e.corps.champ}` } };
        pieces.push({ immobilisation: p.immobilisation, genre: p.genre, ecriture: JSON.parse(e.json) });
      }
      const ids = (await tx.query('select compta.ecrire_immobilisations($1, $2, $3::jsonb) ids', [params.entreprise ?? '', corps.annee, JSON.stringify(pieces)])).rows[0].ids as string[];
      return { statut: 201, corps: { ids } };
    },
  });

  return routes;
}
