// Le support, côté entreprise (Support S1 ; docs/support.md ; 0095) : une personne écrit au support de SkanFact depuis
// son application, relit SES demandes et les réponses de l'équipe, y répond, dit que c'est réglé. La base refait chaque
// contrôle (une personne de l'entreprise, jamais une clé de l'API ; SES demandes seulement, dans l'entreprise de la
// route) : ces routes ne font que lire et appeler ses fonctions.
//
// Ce qui part au serveur avec une demande, compté et décidé : le sujet, le texte, la version de l'application et le NOM
// de la page où la personne était (« factures »). Jamais un identifiant, ni une donnée de son dossier : le support ne
// regarde un dossier qu'avec l'accord de son entreprise (Support S2).

import { z } from 'zod';
import type { Route } from '../app.ts';
import type { Contexte } from '../connexion.ts';
import { Introuvable } from '../erreurs.ts';
import './gestes.ts';
import './textes.ts';

const uuid = z.string().uuid();
const lireUuid = (x: string | undefined) => { if (!x || !uuid.safeParse(x).success) throw new Introuvable(); return x; };

export function routesSupport(ctx: Contexte): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };
  const maintenant = () => (ctx.maintenant ?? (() => new Date()))();

  // Mes demandes dans cette entreprise, les ouvertes d'abord, avec leurs messages et ce que je n'ai pas lu.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/support', geste: 'support.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const demandes = (await tx.query('select plateforme.support_mes_demandes($1) v', [params.entreprise ?? ''])).rows[0]?.v ?? [];
      return { corps: { demandes } };
    },
  });

  // Ce qui m'attend (la pastille et le bandeau de l'application), relu par l'écran de temps en temps : léger.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/support/attente', geste: 'support.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      return { corps: (await tx.query('select plateforme.support_a_lire($1) v', [params.entreprise ?? ''])).rows[0]?.v ?? { demandes: 0, aLire: [] } };
    },
  });

  // Écrire au support : une demande neuve, son sujet et ce qui se passe. La même, renvoyée dans les cinq minutes (un
  // double clic, un envoi qui a semblé échouer), rend la demande déjà posée.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/support', geste: 'support.ecrire',
    corps: z.object({
      sujet: z.string().trim().min(3, 'support.champ.sujet_court').max(140, 'support.champ.sujet_long').refine((v) => !/[<>]/.test(v), 'support.champ.sans_balise'),
      texte: z.string().trim().min(3, 'support.champ.texte_court').max(4000),
      version: z.string().trim().max(40).regex(/^[0-9A-Za-z.+-]*$/).nullable().default(null),
      page: z.string().trim().max(40).regex(/^([a-z][a-z0-9_-]*)?$/).nullable().default(null),
    }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const id = (await tx.query('select plateforme.support_ecrire($1, $2, $3, $4, $5, $6) id',
        [params.entreprise ?? '', corps.sujet, corps.texte, corps.version || null, corps.page || null, maintenant()])).rows[0].id as string;
      return { statut: 201, corps: { id } };
    },
  });

  // Réécrire dans une de mes demandes : elle se rouvre si elle était close.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/support/:demande/messages', geste: 'support.ecrire',
    corps: z.object({ texte: z.string().trim().min(1, 'support.champ.message_vide').max(4000) }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      await tx.query('select plateforme.support_repondre_client($1, $2, $3, $4)', [params.entreprise ?? '', lireUuid(params.demande), corps.texte, maintenant()]);
      return { statut: 201, corps: { ok: true } };
    },
  });

  // J'ai lu ce que l'équipe a répondu (la page ouverte le note) : la pastille s'éteint, aucune alerte ne part plus.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/support/:demande/lu', geste: 'support.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      await tx.query('select plateforme.support_lu($1, $2, $3)', [params.entreprise ?? '', lireUuid(params.demande), maintenant()]);
      return { corps: { ok: true } };
    },
  });

  // « C'est réglé » : la personne clôt sa demande ; elle la rouvre en réécrivant.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/support/:demande/reglee', geste: 'support.ecrire',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      await tx.query('select plateforme.support_reglee($1, $2, $3)', [params.entreprise ?? '', lireUuid(params.demande), maintenant()]);
      return { corps: { ok: true } };
    },
  });

  return routes;
}
