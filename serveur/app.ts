// Le serveur web (Fastify). Une seule règle pour toutes les routes (03 D2) :
//   - chaque route DÉCLARE son geste ; une route sans geste, ou avec un geste inconnu, fait échouer
//     le démarrage ;
//   - une route qui porte sur une entreprise passe par la porte avant de travailler ;
//   - le travail se fait dans `enTantQue`, au nom de la personne connectée ;
//   - un refus dit ce qui est refusé, pourquoi, et le bouton qui débloque (motif, qui, bouton).

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';
import { enTantQue, type Transaction } from './base.ts';
import { quiEst, type Contexte, type Qui } from './connexion.ts';
import { GESTES, GESTES_PERSONNELS } from './porte/gestes.ts';
import { peut } from './porte/porte.ts';

export type Requete<C> = { corps: C; params: Record<string, string>; query: Record<string, string>; qui: Qui | null; requete: FastifyRequest };

export type Route<C = unknown> = {
  methode: 'GET' | 'POST' | 'PUT' | 'DELETE';
  chemin: string;
  // Le geste : un geste d'entreprise (le chemin contient alors :entreprise), un geste personnel,
  // ou « public » (inscription, connexion).
  geste: string;
  corps?: ZodType<C>;
  // Le travail. Pour un geste d'entreprise ou personnel, `tx` est une transaction au nom de la
  // personne ; pour un geste public, il n'y a pas de transaction (le travail ouvre les siennes).
  traiter: (r: Requete<C>, tx: Transaction | null) => Promise<{ statut?: number; corps: unknown }>;
};

export class RouteSansGeste extends Error {}

const PERSONNELS = new Set<string>(GESTES_PERSONNELS);

function verifierDeclaration(r: Route<never>) {
  if (!r.geste) throw new RouteSansGeste(`la route ${r.methode} ${r.chemin} ne déclare aucun geste (03 D2)`);
  const connu = GESTES.has(r.geste) || PERSONNELS.has(r.geste);
  if (!connu) throw new RouteSansGeste(`la route ${r.methode} ${r.chemin} déclare un geste inconnu : ${r.geste}`);
  const parEntreprise = GESTES.has(r.geste);
  if (parEntreprise !== r.chemin.includes(':entreprise')) {
    throw new RouteSansGeste(`la route ${r.methode} ${r.chemin} : un geste d'entreprise porte :entreprise dans son chemin, et lui seul`);
  }
}

// Les refus de la base (socle.refus) arrivent avec le code 42501 : on les rend tels quels.
function erreurVersReponse(e: unknown, reponse: FastifyReply) {
  const err = e as { code?: string; message?: string };
  if (err.code === '42501') return reponse.code(403).send({ motif: capitaliser(err.message ?? 'Refusé.'), qui: [], bouton: null });
  reponse.request.log.error(e);
  return reponse.code(500).send({ motif: 'Une erreur est survenue de notre côté. Elle est notée ; réessaie dans un instant.' });
}
const capitaliser = (t: string) => (t.charAt(0).toUpperCase() + t.slice(1)).replace(/([^.])$/, '$1.');

export function creerApp(ctx: Contexte, routes: Route<never>[]): FastifyInstance {
  // Le démarrage échoue AVANT d'écouter si une seule route est mal déclarée.
  for (const r of routes) verifierDeclaration(r);

  const app = Fastify({ logger: false });

  for (const r of routes) {
    app.route({
      method: r.methode,
      url: r.chemin,
      handler: async (requete, reponse) => {
        let corps: unknown = undefined;
        if (r.corps) {
          const lu = r.corps.safeParse(requete.body ?? {});
          if (!lu.success) {
            const champ = lu.error.issues[0];
            return reponse.code(400).send({ motif: `Le champ « ${champ?.path.join('.') || 'corps'} » ne va pas : ${champ?.message ?? 'valeur invalide'}.`, champ: champ?.path.join('.') ?? null });
          }
          corps = lu.data;
        }
        const params = requete.params as Record<string, string>;
        const query = requete.query as Record<string, string>;

        if (r.geste === 'public') {
          try {
            const res = await r.traiter({ corps: corps as never, params, query, qui: null, requete }, null);
            return reponse.code(res.statut ?? 200).send(res.corps);
          } catch (e) { return erreurVersReponse(e, reponse); }
        }

        // Toutes les autres routes demandent une session.
        const jeton = /^Bearer (.+)$/.exec(requete.headers.authorization ?? '')?.[1];
        const qui = jeton ? await quiEst(ctx, jeton) : null;
        if (!qui) return reponse.code(401).send({ motif: 'Connecte-toi pour continuer.', bouton: 'connexion' });

        try {
          const res = await enTantQue(ctx.pool, qui.utilisateur, async (tx) => {
            // Le code sur le téléphone se juge à CHAQUE requête : un rôle reçu après la connexion
            // (créer son entreprise, être promu administrateur) l'exige aussitôt.
            if (!qui.codeAConfigurer && (await tx.query('select socle.code_manquant() m')).rows[0].m) qui.codeAConfigurer = true;
            if (qui.codeAConfigurer && !['compte.code.configurer', 'compte.voir', 'compte.deconnecter'].includes(r.geste)) {
              return { statut: 403, corps: { motif: 'Mets d\'abord en place le code sur ton téléphone : ton rôle l\'exige.', qui: [], bouton: 'compte.code.configurer' } };
            }
            if (GESTES.has(r.geste)) {
              const entreprise = params.entreprise ?? '';
              if (!/^[0-9a-f-]{36}$/i.test(entreprise)) return { statut: 404, corps: { motif: 'Introuvable.' } };
              const d = await peut(tx, qui, entreprise, r.geste, r.methode !== 'GET');
              if (!d.ok) return { statut: d.raison === 'invisible' ? 404 : 403, corps: { motif: d.motif, qui: d.qui, bouton: d.bouton } };
              // Une lecture de donnée sensible se trace, pas seulement les modifications (D10).
              if (d.geste.sensible && r.methode === 'GET') {
                await tx.query(`insert into socle.audit (entreprise, utilisateur, appareil, geste, lecture) values ($1, $2, $3, $4, true)`,
                  [entreprise, qui.utilisateur, qui.appareil, r.geste]);
              }
            }
            return r.traiter({ corps: corps as never, params, query, qui, requete }, tx);
          });
          return reponse.code(res.statut ?? 200).send(res.corps);
        } catch (e) { return erreurVersReponse(e, reponse); }
      },
    });
  }
  return app;
}

export { z };
