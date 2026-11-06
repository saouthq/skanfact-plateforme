// La banque (brique 40 ; docs/cabinet.md, C19 à C21) : les relevés d'un compte bancaire et leur
// rapprochement avec les livres. Chaque route ne fait que lire le corps et appeler la base, qui refait
// chaque contrôle (compta.importer_releve, compta.rapprocher…, migration 0023) et garde qui peut : qui
// saisit. Les montants entrent en texte exact (« -1250,500 », au sens de la banque) et vont à la base
// en millimes.

import { z } from 'zod';
import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import type { Contexte } from '../connexion.ts';
import { motif, t } from '../../textes/index.ts';
import { estJour } from './saisie.ts';
import './textes.ts';

const uuid = z.string().uuid();
const champInvalide = (champ: string, raison: ReturnType<typeof t>) => ({ statut: 400 as const, corps: { motif: motif('commun.champ_invalide', { champ, raison }), champ } });
const introuvable = { statut: 404 as const, corps: { motif: motif('commun.introuvable') } };
const jour = z.string().refine(estJour, { message: 'champ.jour' });

const RELEVE = z.object({
  annee: z.number().int().min(1900).max(2999),
  compte: z.string().max(20),
  banque: z.string().max(60).default(''),
  fichier: z.string().max(200).default(''),
  empreinte: z.string().regex(/^[0-9a-f]{64}$/, { message: 'compta.champ.empreinte' }),
  soldeDebut: z.string().max(30),
  soldeFin: z.string().max(30),
  lignes: z.array(z.object({
    date: jour, libelle: z.string().max(500).default(''), reference: z.string().max(100).default(''), montant: z.string().max(30),
  }).strict()).max(5000),
}).strict();

const POSES = z.object({
  poses: z.array(z.object({
    ligne: uuid, ecritureLigne: uuid.nullable(), niveau: z.enum(['certain', 'probable', 'a-confirmer', 'aucun']), auto: z.boolean().default(false),
    // (1.299.0) Une remise de chèques : les autres lignes d'écriture qui font la ligne du relevé avec la première.
    autres: z.array(uuid).max(49).optional(),
  }).strict()).min(1).max(5000),
}).strict();

// Un montant signé en millimes, ou null s'il ne se lit pas.
const millimes = (v: string) => { try { return depuisTexte(v, 3); } catch { return null; } };

export function routesBanque(ctx: Contexte): Route<never>[] {
  void ctx;
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  // Les relevés d'une année, leurs lignes et ce qui leur répond (la ligne d'écriture, son écriture, son rang).
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/compta/releves', geste: 'compta.livres.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const annee = Number(query.annee);
      if (!Number.isInteger(annee) || annee < 1900 || annee > 2999) return champInvalide('annee', t('compta.champ.annee'));
      const releves = (await tx.query(`select id, compte, banque, to_char(du, 'YYYY-MM-DD') du, to_char(au, 'YYYY-MM-DD') au, solde_debut, solde_fin,
          fichier, empreinte, importe_le from compta.releve where entreprise = $1 and annee = $2 order by du, importe_le`, [params.entreprise ?? '', annee])).rows;
      // (1.299.0) Ce qui répond d'une ligne, dans l'ordre de la pose : la première, puis les autres d'une remise.
      const lignes = releves.length ? (await tx.query(`select l.id, l.releve, l.rang, to_char(l.date_operation, 'YYYY-MM-DD') date, l.libelle, l.reference, l.montant, l.niveau,
          (select json_agg(json_build_object('ligne', a.ligne, 'niveau', a.niveau, 'auto', a.auto, 'le', to_char(a.pose_le, 'YYYY-MM-DD'), 'ecriture', g.ecriture, 'rang', g.rang) order by a.rang)
             from compta.rapprochement a join compta.ligne g on g.id = a.ligne where a.releve_ligne = l.id) faces
          from compta.releve_ligne l
          where l.releve = any($1::uuid[]) order by l.releve, l.rang`, [releves.map((r) => r.id)])).rows : [];
      type Face = { ligne: string; niveau: string; auto: boolean; le: string; ecriture: string; rang: number };
      const enFace = (faces: Face[] | null) => {
        const [f, ...autres] = faces ?? [];
        if (!f) return null;
        return { ligne: f.ligne, ecriture: f.ecriture, rang: Number(f.rang), niveau: f.niveau, auto: f.auto, le: f.le,
          ...(autres.length ? { autres: autres.map((x) => ({ ligne: x.ligne, ecriture: x.ecriture, rang: Number(x.rang) })) } : {}) };
      };
      return {
        corps: {
          releves: releves.map((r) => ({
            id: r.id, compte: r.compte, banque: r.banque, du: r.du, au: r.au, soldeDebut: versTexte(BigInt(r.solde_debut), 3), soldeFin: versTexte(BigInt(r.solde_fin), 3),
            fichier: r.fichier, empreinte: r.empreinte, importeLe: r.importe_le,
            lignes: lignes.filter((l) => l.releve === r.id).map((l) => ({
              id: l.id, rang: Number(l.rang), date: l.date, libelle: l.libelle, reference: l.reference, montant: versTexte(BigInt(l.montant), 3), niveau: l.niveau,
              rapprochement: enFace(l.faces as Face[] | null),
            })),
          })),
        },
      };
    },
  });

  // Importer un relevé : ses soldes et ses lignes ; la base refuse un doublon et un relevé qui ne se boucle pas.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/releves', geste: 'compta.ecritures.saisir', corps: RELEVE,
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const debut = millimes(corps.soldeDebut), fin = millimes(corps.soldeFin);
      if (debut === null) return champInvalide('soldeDebut', t('compta.champ.montant_signe'));
      if (fin === null) return champInvalide('soldeFin', t('compta.champ.montant_signe'));
      const lignes = [];
      for (const [i, l] of corps.lignes.entries()) {
        const m = millimes(l.montant);
        if (m === null) return champInvalide(`lignes.${i}.montant`, t('compta.champ.montant_signe'));
        lignes.push({ date: l.date, libelle: l.libelle, reference: l.reference, montant: m.toString() });
      }
      const releve = { compte: corps.compte.trim(), banque: corps.banque, fichier: corps.fichier, empreinte: corps.empreinte,
        soldeDebut: debut.toString(), soldeFin: fin.toString(), lignes };
      const id = (await tx.query('select compta.importer_releve($1, $2, $3::jsonb) id', [params.entreprise ?? '', corps.annee, JSON.stringify(releve)])).rows[0].id as string;
      return { statut: 201, corps: { id } };
    },
  });

  ajouter({
    methode: 'DELETE', chemin: '/entreprises/:entreprise/compta/releves/:releve', geste: 'compta.ecritures.saisir',
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.releve).success) return introuvable;
      await tx.query('select compta.retirer_releve($1, $2)', [params.entreprise ?? '', params.releve]);
      return { corps: { ok: true } };
    },
  });

  // Poser, défaire, ou garder le jugement de l'automatique, ligne par ligne.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/releves/:releve/rapprochements', geste: 'compta.ecritures.saisir', corps: POSES,
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !uuid.safeParse(params.releve).success) return introuvable;
      const n = (await tx.query('select compta.rapprocher($1, $2, $3::jsonb) n', [params.entreprise ?? '', params.releve, JSON.stringify(corps.poses)])).rows[0].n;
      return { corps: { poses: Number(n) } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/compta/releves/:releve/derapprocher', geste: 'compta.ecritures.saisir', corps: z.object({}).strict(),
    traiter: async ({ params }, tx) => {
      if (!tx || !uuid.safeParse(params.releve).success) return introuvable;
      const n = (await tx.query('select compta.derapprocher($1, $2) n', [params.entreprise ?? '', params.releve])).rows[0].n;
      return { corps: { defaits: Number(n) } };
    },
  });

  return routes;
}
