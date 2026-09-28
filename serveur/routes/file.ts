// Les routes de la file d'opérations (04 § 4 à § 5.2) : envoyer ses gestes, lire « À reprendre »,
// et en sortir une ligne par un geste.

import { z } from 'zod';
import type { Route } from '../app.ts';
import type { Contexte } from '../connexion.ts';
import { recevoir, schemaOperation, type Traitement } from '../file.ts';
import { GESTES } from '../porte/gestes.ts';

const LIMITE_MAX = 200;

export function routesFile(ctx: Contexte, traitements: Map<string, Traitement<never>>): Route<never>[] {
  // Un traitement porte un geste que la porte connaît : sinon, le serveur ne démarre pas (03 D2).
  for (const g of traitements.keys()) {
    if (!GESTES.has(g)) throw new Error(`le traitement « ${g} » porte un geste que la porte ne connaît pas`);
  }
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  ajouter({
    methode: 'POST', chemin: '/operations', geste: 'compte.file.envoyer',
    corps: z.object({ operations: z.array(schemaOperation).min(1).max(LIMITE_MAX) }),
    // Chaque geste passe par la porte et a sa propre transaction : `recevoir` les ouvre.
    traiter: async ({ qui, corps }) => {
      if (!qui) throw new Error('session attendue');
      if (!qui.appareil) return { statut: 400, corps: { motif: 'Cette session n\'est rattachée à aucun appareil : reconnecte-toi depuis le poste.' } };
      return { corps: { reponses: await recevoir(ctx, qui, corps.operations, traitements) } };
    },
  });

  // « À reprendre » d'une entreprise : chacun y voit ses gestes, le propriétaire et l'administrateur
  // ceux de toute l'entreprise (la base en décide).
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/a-reprendre', geste: 'socle.accueil.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const lignes = (await tx.query(`select o.id, o.geste, o.statut, o.motif, o.instant_poste, o.recu_le, o.horloge_ecartee,
          o.utilisateur, u.nom, o.charge
        from socle.operation o left join socle.utilisateur u on u.id = o.utilisateur
        where o.entreprise = $1 and o.statut <> 'acceptee' and o.resolue_le is null
        order by o.recu_le, o.id limit $2`, [params.entreprise, LIMITE_MAX])).rows;
      return { corps: { lignes } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/operations/:operation/reprendre', geste: 'compte.a_reprendre.resoudre',
    corps: z.object({ resolution: z.string().trim().min(1).max(500) }),
    traiter: async ({ params, corps }, tx) => {
      if (!tx || !z.string().uuid().safeParse(params.operation).success) return { statut: 404, corps: { motif: 'Introuvable.' } };
      await tx.query('select socle.resoudre_operation($1, $2)', [params.operation, corps.resolution]);
      return { corps: { ok: true } };
    },
  });

  return routes;
}
