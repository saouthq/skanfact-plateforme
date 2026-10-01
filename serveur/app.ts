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
import { Limiteur } from './limites.ts';
import { jetonDUnAppareilRetire, quiEst, remisParCeJeton, type Contexte, type Qui } from './connexion.ts';
import { choisirEncodage, compresser, compressible, SEUIL_COMPRESSION } from './compression.ts';
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
  // La lecture sensible d'UN objet (03 D10) : son type, et le paramètre du chemin qui le nomme. La
  // trace de la lecture dit alors quel objet a été lu, pas seulement qu'on a lu.
  objetLu?: { type: string; param: string };
  // La taille permise du corps, en octets, quand ce n'est pas celle de Fastify (1 Mo) : un livre d'un
  // exercice entier se reprend en une fois (brique 62).
  limiteCorps?: number;
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
  // Changé ailleurs entre-temps (01 R15) : du serveur (Perimee), ou de la base (errcode SK409).
  if (err.code === 'perimee' || err.code === 'SK409') return envoyer(409, { motif: texteDuRefus(err), bouton: 'recharger' });
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

export function creerApp(ctx: Contexte, routes: Route<never>[], options: { limiteur?: Limiteur } = {}): FastifyInstance {
  // Le démarrage échoue AVANT d'écouter si une seule route est mal déclarée.
  for (const r of routes) verifierDeclaration(r);

  const app = Fastify({ logger: false });
  const limiteur = options.limiteur ?? new Limiteur();
  // Un entier de 64 bits (un rang, un compteur) sort en texte : un nombre JSON au-delà de 2^53
  // perdrait ses derniers chiffres chez celui qui le lit. L'argent, lui, sort toujours en texte
  // décimal (versTexte), jamais en unités brutes.
  app.setReplySerializer((corps) => JSON.stringify(corps, (_cle, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)));

  // Une réponse de l'API ne se garde dans aucun cache (brique 113 bis) : ni le navigateur ni un intermédiaire ne doit
  // la resservir (un dossier d'hier montré pour celui d'aujourd'hui), ni la laisser sur le disque (des données
  // comptables : 05 § 5, INPDP).
  // « /v1 » seul ou « /v1/… », jamais « /v10/… » : les écrans de la v10 ne sont pas l'API (défaut trouvé le 01/10/2026,
  // brique 118 : ils partaient « no-store », et chaque ouverture les retéléchargeait entiers).
  const deLApi = (url: string) => url === VERSION || url.startsWith(`${VERSION}/`) || url.startsWith(`${VERSION}?`);
  app.addHook('onSend', async (requete, reponse) => { if (deLApi(requete.url)) reponse.header('cache-control', 'no-store'); });
  // Une réponse de l'API de plus de 1 Ko part compressée quand le navigateur l'accepte (brique 118 ; docs/leger.md, S3) :
  // un dossier en JSON pèse quatre fois moins sur une connexion lente.
  app.addHook('onSend', async (requete, reponse, corps) => {
    if (!deLApi(requete.url) || reponse.getHeader('content-encoding')) return corps;
    if (typeof corps !== 'string' && !Buffer.isBuffer(corps)) return corps;
    if (!compressible(String(reponse.getHeader('content-type') ?? ''))) return corps;
    reponse.header('vary', 'accept-encoding');
    const brut = Buffer.isBuffer(corps) ? corps : Buffer.from(corps);
    const encodage = brut.length > SEUIL_COMPRESSION ? choisirEncodage(requete.headers['accept-encoding']) : null;
    if (!encodage) return corps;
    reponse.header('content-encoding', encodage).removeHeader('content-length');
    return compresser(brut, encodage);
  });

  // La documentation de l'API, écrite depuis les routes elles-mêmes : jamais en retard sur elles.
  const doc = documentation(routes);
  app.get(`${VERSION}/documentation`, async () => doc);

  for (const r of routes) {
    app.route({
      method: r.methode,
      url: VERSION + r.chemin,
      ...(r.limiteCorps ? { bodyLimit: r.limiteCorps } : {}),
      handler: async (requete, reponse) => {
        const langue = langueDe(requete.headers);
        const envoyer = (statut: number, corps: unknown) => reponse.code(statut).send(rendreTout(corps, langue));
        let corps: unknown = undefined;
        if (r.corps) {
          const lu = r.corps.safeParse(requete.body ?? {});
          if (!lu.success) {
            const p = lu.error.issues[0];
            const champ = nomDuChamp(p, 'corps');
            const pourquoi = p ? raison(p, requete.body) : motif('champ.valeur');
            // `raison` seule, pour l'écran qui la montre SOUS le champ (le nom technique du champ n'y
            // a rien à faire) ; `motif` entier, pour qui lit la réponse sans écran.
            return envoyer(400, { motif: motif('commun.champ_invalide', { champ, raison: pourquoi }), champ: p ? champ : null, raison: pourquoi });
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
        // Les limites d'appels d'une clé (14 § 2.5), avant tout travail : un appel refusé ne coûte rien.
        if (cle) {
          const v = limiteur.appel(cle.id);
          reponse.header('ratelimit-limit', String(limiteur.limite)).header('ratelimit-remaining', String(v.restants));
          if (!v.permis) {
            reponse.header('retry-after', String(v.attendreSecondes));
            return envoyer(429, { motif: v.attendreSecondes === 1 ? motif('api.trop_d_appels_une') : motif('api.trop_d_appels', { secondes: v.attendreSecondes }), attendreSecondes: v.attendreSecondes });
          }
        }
        const qui: Qui | null = cle
          ? { utilisateur: cle.creePar, session: '', appareil: null, posteDUnAutre: false, codeAConfigurer: false, cle: { id: cle.id, gestes: cle.gestes } }
          : jeton ? await quiEst(ctx, jeton) : null;
        if (!qui) {
          // Un appareil retiré l'apprend à sa reconnexion : il efface ce qu'il garde (04 § 7, brique 74),
          // et ce qu'il avait remis en quarantaine se dit (brique 74 bis).
          if (jeton && !cle && await jetonDUnAppareilRetire(ctx, jeton)) {
            const remis = await remisParCeJeton(ctx, jeton);
            const m = remis > 1 ? motif('connexion.appareil_retire_remis', { n: remis }) : remis === 1 ? motif('connexion.appareil_retire_remis_un') : motif('connexion.appareil_retire');
            return envoyer(401, { motif: m, bouton: 'connexion', effacer: true });
          }
          return envoyer(401, { motif: motif('commun.connexion_requise'), bouton: 'connexion' });
        }
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
                const lu = r.objetLu ? params[r.objetLu.param] ?? '' : '';
                const objet = r.objetLu && /^[0-9a-f-]{36}$/i.test(lu) ? [r.objetLu.type, lu] : [null, null];
                await tx.query(`insert into socle.audit (entreprise, utilisateur, cle_api, appareil, geste, objet_type, objet_id, lecture)
                  values ($1, socle.moi(), socle.ma_cle(), $2, $3, $4, $5, true)`, [entreprise, qui.appareil, r.geste, ...objet]);
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
