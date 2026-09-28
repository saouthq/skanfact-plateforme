// Les routes du module Ventes : les clients (la fiche tiers du socle, par le geste du tableau
// « Ventes » de 03 § 2.1), les brouillons, la lecture d'une pièce et l'émission d'une facture.
// Les nombres entrent et sortent en TEXTE exact (« 2.525 », « 1191.000 ») : jamais en nombre à
// virgule (01 R3).

import { sql } from 'kysely';
import { z } from 'zod';
import { depuisTexte, versTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import { requetes } from '../base.ts';
import { cleDeVerification } from '../validation.ts';
import type { Contexte } from '../connexion.ts';
import { tracer } from '../trace.ts';
import { creerBrouillon, DECIMALES, emettre, lirePiece, modifierBrouillon, supprimerBrouillon, type BrouillonSaisi } from './pieces.ts';
import { motif, t } from '../../textes/index.ts';

// Toute liste qu'on nomme se pagine (règle du projet) : 50 lignes par défaut, 200 au plus.
const LIMITE_MAX = 200;
const limite = (q: Record<string, string>) => Math.min(Math.max(Number(q.limite ?? 50) || 50, 1), LIMITE_MAX);
const uuid = z.string().uuid();
// La page suivante se demande par un curseur opaque : la clé de tri de la dernière ligne vue, puis
// son identifiant, qui départage deux lignes égales (jamais une ligne sautée ni vue deux fois).
// Un curseur absent ou illisible part du début.
const versCurseur = (cle: string, id: string) => Buffer.from(JSON.stringify([cle, id])).toString('base64url');
function depuisCurseur(texte: string | undefined, cle: RegExp): [string, string] | null {
  if (!texte) return null;
  try {
    const [c, id] = JSON.parse(Buffer.from(texte, 'base64url').toString('utf8')) as unknown[];
    if (typeof c === 'string' && cle.test(c) && typeof id === 'string' && uuid.safeParse(id).success) return [c, id];
  } catch { /* illisible : on repart du début */ }
  return null;
}
const TYPES_PIECE = ['devis', 'proforma', 'commande', 'livraison', 'facture', 'note_honoraires'] as const;
const jour = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'champ.jour');
// Un nombre écrit en texte, à `dec` décimales au plus.
const decimal = (dec: number) => z.string().max(30).refine((v) => { try { depuisTexte(v, dec); return true; } catch { return false; } },
  cleDeVerification('ventes.champ.decimal', { dec }));
// zod poursuit les vérifications après un échec : un texte illisible, déjà dit par `decimal`, ne doit
// pas faire tomber celle-ci (ce serait une erreur 500 au lieu d'un refus sur le champ).
const taux = decimal(DECIMALES.taux).refine((v) => {
  let t: bigint;
  try { t = depuisTexte(v, DECIMALES.taux); } catch { return true; }
  return t >= 0n && t <= 1_000_000n;
}, 'ventes.champ.pourcentage');

const ligne = z.object({
  designation: z.string().trim().min(1).max(500), description: z.string().max(4000).optional(),
  quantite: decimal(DECIMALES.quantite), prixUnitaire: decimal(DECIMALES.prix), tauxTva: taux, sansRemise: z.boolean().optional(),
});
const brouillon = z.object({
  type: z.enum(TYPES_PIECE),
  tiers: uuid, datePiece: jour, echeance: jour.optional(), devise: z.string().regex(/^[A-Z]{3}$/).optional(),
  cours: decimal(DECIMALES.cours).optional(), tauxRemise: taux.optional(), tauxRetenue: taux.optional(),
  appliquerTimbre: z.boolean().optional(), objet: z.string().max(500).optional(), notes: z.string().max(4000).optional(),
  lignes: z.array(ligne).min(1).max(500),
}).refine((b) => b.devise === undefined || b.devise === 'TND' || b.cours !== undefined, { message: 'ventes.champ.cours_requis', path: ['cours'] });

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
    }).refine((c) => (c.identifiant === undefined) === (c.typeIdentifiant === undefined), { message: 'ventes.champ.identifiant_et_type', path: ['typeIdentifiant'] }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const entreprise = params.entreprise ?? '';
      const { id } = await requetes(tx).insertInto('socle.tiers').values({
        entreprise, nature: corps.nature ?? 'societe', raison_sociale: corps.raisonSociale, identifiant: corps.identifiant ?? null,
        type_identifiant: corps.typeIdentifiant ?? null, adresse: corps.adresse ?? null, pays: corps.pays ?? 'TN', email: corps.email ?? null,
        telephone: corps.telephone ?? null, devise: corps.devise ?? 'TND', roles: ['client'],
      }).returning('id').executeTakeFirstOrThrow();
      await tracer(tx, entreprise, 'ventes.client.creer', { type: 'tiers', id }, null, { raisonSociale: corps.raisonSociale });
      return { statut: 201, corps: { id } };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/clients', geste: 'ventes.pieces.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      // Par ordre alphabétique ; la page suivante commence après le dernier client vu.
      const n = limite(query);
      const apres = depuisCurseur(query.apres, /^.+$/s);
      const clients = await requetes(tx).selectFrom('socle.tiers').select(['id', 'raison_sociale', 'nature', 'identifiant', 'pays', 'devise'])
        .where('entreprise', '=', params.entreprise ?? '').where(sql<boolean>`'client' = any(roles)`)
        .$if(apres !== null, (q) => q.where(sql<boolean>`(raison_sociale, id) > (${apres?.[0]}, ${apres?.[1]}::uuid)`))
        .orderBy('raison_sociale').orderBy('id').limit(n).execute();
      const dernier = clients.at(-1);
      return { corps: { clients, suite: clients.length === n && dernier ? versCurseur(dernier.raison_sociale, dernier.id) : null } };
    },
  });

  // ── Les pièces ──────────────────────────────────────────────────────────────────────────────
  // La liste, la plus récente d'abord ; la page suivante commence avant la dernière pièce vue. Une
  // pièce émise montre le client de sa copie figée (R7) et son net à payer ; un brouillon, le client
  // de sa fiche, sans montant (il se calcule en l'ouvrant).
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/ventes', geste: 'ventes.pieces.voir',
    traiter: async ({ params, query }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const type = z.enum(TYPES_PIECE).safeParse(query.type ?? 'facture');
      if (!type.success) return { statut: 400, corps: { motif: motif('commun.champ_invalide', { champ: 'type', raison: t('champ.choix', { valeurs: TYPES_PIECE.join(', ') }) }), champ: 'type' } };
      const n = limite(query);
      const avant = depuisCurseur(query.avant, /^\d{4}-\d{2}-\d{2}$/);
      const lignes = await requetes(tx).selectFrom('ventes.piece as p')
        .innerJoin('socle.tiers as t', 't.id', 'p.tiers').innerJoin('socle.devise as d', 'd.code', 'p.devise')
        .select(['p.id', 'p.type', 'p.statut', 'p.numero_texte', 'p.date_piece', 'p.objet', 'p.devise', 'd.symbole', 'd.decimales', 'p.net_a_payer'])
        .select(sql<string>`coalesce(p.copie->'client'->>'raisonSociale', t.raison_sociale)`.as('client'))
        .where('p.entreprise', '=', params.entreprise ?? '').where('p.type', '=', type.data)
        .$if(avant !== null, (q) => q.where(sql<boolean>`(p.date_piece, p.id) < (${avant?.[0]}::date, ${avant?.[1]}::uuid)`))
        .orderBy('p.date_piece', 'desc').orderBy('p.id', 'desc').limit(n).execute();
      const dernier = lignes.at(-1);
      // Le compte de toute la liste, pour dire « 1–25 sur 443 » et le nombre de pages, comme la v10.
      const { total } = await requetes(tx).selectFrom('ventes.piece').select((eb) => eb.fn.countAll<string>().as('total'))
        .where('entreprise', '=', params.entreprise ?? '').where('type', '=', type.data).executeTakeFirstOrThrow();
      return {
        corps: {
          lignes: lignes.map((l) => {
            const net = l.net_a_payer === null ? null : versTexte(l.net_a_payer, l.decimales);
            return {
              id: l.id, type: l.type, statut: l.statut, numero: l.numero_texte, datePiece: l.date_piece, client: l.client, objet: l.objet,
              devise: l.devise, symbole: l.symbole, netAPayer: net,
              // Ce qui reste à encaisser : aucun règlement ne s'enregistre encore, tout reste dû. Le jour
              // où les règlements arrivent, c'est ICI (une seule fonction) qu'ils se retranchent.
              reste: net,
            };
          }),
          suite: lignes.length === n && dernier ? versCurseur(dernier.date_piece, dernier.id) : null,
          total: Number(total),
        },
      };
    },
  });

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
      if (!tx || !idValide(params.piece)) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      return { corps: await lirePiece(tx, params.entreprise ?? '', params.piece ?? '') };
    },
  });

  ajouter({
    methode: 'PUT', chemin: '/entreprises/:entreprise/ventes/:piece', geste: 'ventes.brouillon.modifier',
    corps: z.object({ revision: z.number().int().min(1), brouillon }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !idValide(params.piece)) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      const revision = await modifierBrouillon(tx, params.entreprise ?? '', params.piece ?? '', corps.revision, corps.brouillon as BrouillonSaisi);
      return { corps: { revision } };
    },
  });

  ajouter({
    methode: 'DELETE', chemin: '/entreprises/:entreprise/ventes/:piece', geste: 'ventes.brouillon.modifier',
    traiter: async ({ params }, tx) => {
      if (!tx || !idValide(params.piece)) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      await supprimerBrouillon(tx, params.entreprise ?? '', params.piece ?? '');
      return { corps: { ok: true } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/ventes/:piece/emettre', geste: 'ventes.facture.emettre',
    traiter: async ({ params, qui }, tx) => {
      if (!tx || !qui || !idValide(params.piece)) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      await emettre(tx, qui.utilisateur, params.entreprise ?? '', params.piece ?? '');
      return { corps: await lirePiece(tx, params.entreprise ?? '', params.piece ?? '') };
    },
  });

  return routes;
}
