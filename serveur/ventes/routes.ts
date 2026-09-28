// Les routes du module Ventes : les clients (la fiche tiers du socle, par le geste du tableau
// « Ventes » de 03 § 2.1), les brouillons, la lecture d'une pièce et l'émission d'une facture.
// Les nombres entrent et sortent en TEXTE exact (« 2.525 », « 1191.000 ») : jamais en nombre à
// virgule (01 R3).

import { z } from 'zod';
import { depuisTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import type { Contexte } from '../connexion.ts';
import { creerBrouillon, DECIMALES, emettre, lirePiece, modifierBrouillon, supprimerBrouillon, type BrouillonSaisi } from './pieces.ts';

const LIMITE_MAX = 200;
const uuid = z.string().uuid();
const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'un jour du calendrier (AAAA-MM-JJ)');
// Un nombre écrit en texte, à `dec` décimales au plus.
const decimal = (dec: number) => z.string().max(30).refine((v) => { try { depuisTexte(v, dec); return true; } catch { return false; } },
  `un nombre écrit en texte, à ${dec} décimales au plus (« 2.525 »)`);
const taux = decimal(DECIMALES.taux).refine((v) => { const t = depuisTexte(v, DECIMALES.taux); return t >= 0n && t <= 1_000_000n; }, 'un pourcentage entre 0 et 100');

const ligne = z.object({
  designation: z.string().trim().min(1).max(500), description: z.string().max(4000).optional(),
  quantite: decimal(DECIMALES.quantite), prixUnitaire: decimal(DECIMALES.prix), tauxTva: taux, sansRemise: z.boolean().optional(),
});
const brouillon = z.object({
  type: z.enum(['devis', 'proforma', 'commande', 'livraison', 'facture', 'note_honoraires']),
  tiers: uuid, datePiece: jour, echeance: jour.optional(), devise: z.string().regex(/^[A-Z]{3}$/).optional(),
  cours: decimal(DECIMALES.cours).optional(), tauxRemise: taux.optional(), tauxRetenue: taux.optional(),
  appliquerTimbre: z.boolean().optional(), objet: z.string().max(500).optional(), notes: z.string().max(4000).optional(),
  lignes: z.array(ligne).min(1).max(500),
}).refine((b) => b.devise === undefined || b.devise === 'TND' || b.cours !== undefined, { message: 'une pièce en devise porte son cours', path: ['cours'] });

export function routesVentes(ctx: Contexte): Route<never>[] {
  void ctx;
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };
  const idValide = (v: string | undefined) => uuid.safeParse(v).success;

  // ── Les clients ─────────────────────────────────────────────────────────────────────────────
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/clients', geste: 'ventes.client.modifier',
    corps: z.object({
      raisonSociale: z.string().trim().min(1).max(300), nature: z.enum(['societe', 'personne', 'etranger']).optional(),
      identifiant: z.string().trim().min(1).max(40).optional(), typeIdentifiant: z.enum(['matricule', 'cin', 'carte_sejour', 'etranger']).optional(),
      adresse: z.string().max(1000).optional(), pays: z.string().regex(/^[A-Z]{2}$/).optional(),
      email: z.string().email().optional(), telephone: z.string().max(40).optional(), devise: z.string().regex(/^[A-Z]{3}$/).optional(),
    }).refine((c) => (c.identifiant === undefined) === (c.typeIdentifiant === undefined), { message: 'un identifiant va avec son type', path: ['typeIdentifiant'] }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const id = (await tx.query(`insert into socle.tiers (entreprise, nature, raison_sociale, identifiant, type_identifiant, adresse, pays, email, telephone, devise, roles)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '{client}') returning id`,
      [params.entreprise, corps.nature ?? 'societe', corps.raisonSociale, corps.identifiant ?? null, corps.typeIdentifiant ?? null,
        corps.adresse ?? null, corps.pays ?? 'TN', corps.email ?? null, corps.telephone ?? null, corps.devise ?? 'TND'])).rows[0].id;
      await tx.query(`select socle.tracer($1, 'ventes.client.creer', 'tiers', $2, null, $3)`, [params.entreprise, id, JSON.stringify({ raisonSociale: corps.raisonSociale })]);
      return { statut: 201, corps: { id } };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/clients', geste: 'ventes.pieces.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const clients = (await tx.query(`select id, raison_sociale, nature, identifiant, pays, devise from socle.tiers
        where entreprise = $1 and 'client' = any(roles) order by raison_sociale, id limit $2`, [params.entreprise, LIMITE_MAX])).rows;
      return { corps: { clients } };
    },
  });

  // ── Les pièces ──────────────────────────────────────────────────────────────────────────────
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/ventes', geste: 'ventes.brouillon.modifier', corps: brouillon,
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      const id = await creerBrouillon(tx, qui.utilisateur, params.entreprise ?? '', corps as BrouillonSaisi);
      return { statut: 201, corps: { id } };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/ventes/:piece', geste: 'ventes.pieces.voir',
    traiter: async ({ params }, tx) => {
      if (!tx || !idValide(params.piece)) return { statut: 404, corps: { motif: 'Introuvable.' } };
      return { corps: await lirePiece(tx, params.entreprise ?? '', params.piece ?? '') };
    },
  });

  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/ventes/:piece', geste: 'ventes.brouillon.modifier',
    corps: z.object({ revision: z.number().int().min(1), brouillon }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !idValide(params.piece)) return { statut: 404, corps: { motif: 'Introuvable.' } };
      const revision = await modifierBrouillon(tx, params.entreprise ?? '', params.piece ?? '', corps.revision, corps.brouillon as BrouillonSaisi);
      return { corps: { revision } };
    },
  });

  ajouter({
    methode: 'DELETE', chemin: '/entreprises/:entreprise/ventes/:piece', geste: 'ventes.brouillon.modifier',
    traiter: async ({ params }, tx) => {
      if (!tx || !idValide(params.piece)) return { statut: 404, corps: { motif: 'Introuvable.' } };
      await supprimerBrouillon(tx, params.entreprise ?? '', params.piece ?? '');
      return { corps: { ok: true } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/ventes/:piece/emettre', geste: 'ventes.facture.emettre',
    traiter: async ({ params, qui }, tx) => {
      if (!tx || !qui || !idValide(params.piece)) return { statut: 404, corps: { motif: 'Introuvable.' } };
      await emettre(tx, qui.utilisateur, params.entreprise ?? '', params.piece ?? '');
      return { corps: await lirePiece(tx, params.entreprise ?? '', params.piece ?? '') };
    },
  });

  return routes;
}
