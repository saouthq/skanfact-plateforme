// Le serveur web (Fastify). Une seule règle pour toutes les routes (03 D2) :
//   - chaque route DÉCLARE son geste ; une route sans geste, ou avec un geste inconnu, fait échouer
//     le démarrage ;
//   - une route qui porte sur une entreprise passe par la porte avant de travailler ;
//   - le travail se fait dans `enTantQue`, au nom de la personne connectée ;
//   - un refus dit ce qui est refusé, pourquoi, et le bouton qui débloque (motif, qui, bouton).

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';
import { langueDe, motif, rendre, rendreTout, t, type Langue } from '../textes/index.ts';
import { enTantQue, type Transaction } from './base.ts';
import { texteDuRefus } from './erreurs.ts';
import { cleValable } from './cles.ts';
import { quiEst, type Contexte, type Qui } from './connexion.ts';
import { GESTES, GESTES_PERSONNELS } from './porte/gestes.ts';
import { peut } from './porte/porte.ts';
import { nomDuChamp, raison } from './validation.ts';

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

// Les adresses de l'API portent leur version (14 § 2.5) : une intégration écrite pour /v1 ne casse
// pas le jour où /v2 existe.
export const VERSION = '/v1';

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

// Les refus de la base (socle.refus) et du serveur (serveur/erreurs.ts) arrivent avec le code 42501 :
// on les rend dans la langue du lecteur, avec le bouton qui débloque s'il y en a un.
function erreurVersReponse(e: unknown, reponse: FastifyReply, langue: Langue) {
  const err = e as { code?: string; message?: string; bouton?: string | null; texte?: unknown };
  const envoyer = (statut: number, corps: unknown) => reponse.code(statut).send(rendreTout(corps, langue));
  if (err.code === '42501') return envoyer(403, { motif: texteDuRefus(err), qui: [], bouton: err.bouton ?? null });
  if (err.code === 'introuvable') return envoyer(404, { motif: motif('commun.introuvable') });
  if (err.code === 'perimee') return envoyer(409, { motif: texteDuRefus(err), bouton: 'recharger' });
  reponse.request.log.error(e);
  return envoyer(500, { motif: motif('commun.erreur_serveur') });
}

// La description des routes au format OpenAPI (14 § 2.5) : le chemin, le geste et ce qu'il fait
// (au catalogue), le corps attendu (tiré des mêmes vérifications que celles du serveur).
export function documentation(routes: Route<never>[]) {
  const chemins: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const chemin = VERSION + r.chemin.replace(/:([a-z_]+)/g, '{$1}');
    const resume = GESTES.has(r.geste) ? t(`geste.${r.geste}`) : t(r.geste === 'public' ? 'doc.public' : 'doc.personnel');
    chemins[chemin] = {
      ...chemins[chemin],
      [r.methode.toLowerCase()]: {
        summary: rendre(resume, 'fr'),
        'x-geste': r.geste,
        parameters: [...r.chemin.matchAll(/:([a-z_]+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } })),
        ...(r.corps ? { requestBody: { required: true, content: { 'application/json': { schema: z.toJSONSchema(r.corps, { unrepresentable: 'any' }) } } } } : {}),
        security: r.geste === 'public' ? [] : [{ jeton: [] }],
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'SkanFact', version: VERSION.slice(2) },
    components: { securitySchemes: { jeton: { type: 'http', scheme: 'bearer', description: rendre(t('doc.jeton'), 'fr') } } },
    paths: chemins,
  };
}

export function creerApp(ctx: Contexte, routes: Route<never>[]): FastifyInstance {
  // Le démarrage échoue AVANT d'écouter si une seule route est mal déclarée.
  for (const r of routes) verifierDeclaration(r);

  const app = Fastify({ logger: false });
  // Un entier de 64 bits (un rang, un compteur) sort en texte : un nombre JSON au-delà de 2^53
  // perdrait ses derniers chiffres chez celui qui le lit. L'argent, lui, sort toujours en texte
  // décimal (versTexte), jamais en unités brutes.
  app.setReplySerializer((corps) => JSON.stringify(corps, (_cle, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)));

  // La documentation de l'API, écrite depuis les routes elles-mêmes : jamais en retard sur elles.
  const doc = documentation(routes);
  app.get(`${VERSION}/documentation`, async () => doc);

  for (const r of routes) {
    app.route({
      method: r.methode,
      url: VERSION + r.chemin,
      handler: async (requete, reponse) => {
        const langue = langueDe(requete.headers);
        const envoyer = (statut: number, corps: unknown) => reponse.code(statut).send(rendreTout(corps, langue));
        let corps: unknown = undefined;
        if (r.corps) {
          const lu = r.corps.safeParse(requete.body ?? {});
          if (!lu.success) {
            const p = lu.error.issues[0];
            const champ = nomDuChamp(p, 'corps');
            return envoyer(400, { motif: motif('commun.champ_invalide', { champ, raison: p ? raison(p, requete.body) : motif('champ.valeur') }), champ: p ? champ : null });
          }
          corps = lu.data;
        }
        const params = requete.params as Record<string, string>;
        const query = requete.query as Record<string, string>;

        if (r.geste === 'public') {
          try {
            const res = await r.traiter({ corps: corps as never, params, query, qui: null, requete }, null);
            return envoyer(res.statut ?? 200, res.corps);
          } catch (e) { return erreurVersReponse(e, reponse, langue); }
        }

        // Toutes les autres routes demandent une session, ou une clé de l'API (03 § 8).
        const jeton = /^Bearer (.+)$/.exec(requete.headers.authorization ?? '')?.[1];
        const cle = jeton ? await cleValable(ctx, jeton) : null;
        const qui: Qui | null = cle
          ? { utilisateur: cle.creePar, session: '', appareil: null, posteDUnAutre: false, codeAConfigurer: false, cle: { id: cle.id, gestes: cle.gestes } }
          : jeton ? await quiEst(ctx, jeton) : null;
        if (!qui) return envoyer(401, { motif: motif('commun.connexion_requise'), bouton: 'connexion' });
        // Une clé n'est pas une personne : son compte, ses appareils, ses invitations ne la regardent pas.
        if (qui.cle && !GESTES.has(r.geste)) return envoyer(403, { motif: motif('porte.cle_personnelle'), qui: [], bouton: null });

        try {
          // La transaction est ouverte au nom de la personne, ou au nom de la CLÉ (jamais de celui
          // qui l'a créée : la clé ne voit que son entreprise, et seulement tant qu'elle vaut).
          const res = await enTantQue(ctx.pool, qui.cle ? null : qui.utilisateur, async (tx) => {
            // Le code sur le téléphone se juge à CHAQUE requête : un rôle reçu après la connexion
            // (créer son entreprise, être promu administrateur) l'exige aussitôt.
            if (!qui.cle && !qui.codeAConfigurer && (await tx.query('select socle.code_manquant() m')).rows[0].m) qui.codeAConfigurer = true;
            if (qui.codeAConfigurer && !['compte.code.configurer', 'compte.voir', 'compte.deconnecter'].includes(r.geste)) {
              return { statut: 403, corps: { motif: motif('commun.code_requis'), qui: [], bouton: 'compte.code.configurer' } };
            }
            if (GESTES.has(r.geste)) {
              const entreprise = params.entreprise ?? '';
              if (!/^[0-9a-f-]{36}$/i.test(entreprise)) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
              const d = await peut(tx, qui, entreprise, r.geste, r.methode !== 'GET');
              if (!d.ok) return { statut: d.raison === 'invisible' ? 404 : 403, corps: { motif: d.motif, qui: d.qui, bouton: d.bouton } };
              // Une lecture de donnée sensible se trace, pas seulement les modifications (D10).
              if (d.geste.sensible && r.methode === 'GET') {
                await tx.query(`insert into socle.audit (entreprise, utilisateur, cle_api, appareil, geste, lecture)
                  values ($1, socle.moi(), socle.ma_cle(), $2, $3, true)`, [entreprise, qui.appareil, r.geste]);
              }
            }
            return r.traiter({ corps: corps as never, params, query, qui, requete }, tx);
          }, qui.cle?.id ?? null);
          return envoyer(res.statut ?? 200, res.corps);
        } catch (e) { return erreurVersReponse(e, reponse, langue); }
      },
    });
  }
  return app;
}

export { z };
