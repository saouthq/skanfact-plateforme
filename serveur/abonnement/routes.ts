// L'abonnement, lu par l'entreprise (docs/abonnement.md ; skanfact docs/cadrage/07-offres-et-prix.md) :
//   - son état, pour tous ceux qui y travaillent : la pastille de la barre, la carte de l'essai, et la création que
//     l'écran retient AVANT le geste quand l'entreprise est en lecture seule (la porte de la v10, `licenceBlock`) ;
//   - le détail, pour qui gère l'abonnement (le propriétaire, un administrateur) : l'état, les prix du jour, et ce qui
//     est arrivé à l'abonnement (jamais le motif, qui est une note de SkanFact).
// Le serveur ne fait que LIRE ici : l'état se déduit des faits et du jour (serveur/abonnement/etat.ts).

import { versTexte } from '../../moteur/argent.ts';
import type { Route } from '../app.ts';
import { aujourdhuiATunis } from '../reglements.ts';
import { etatAbonnement, type Etat } from './etat.ts';
import { faitsDe } from './condition.ts';
import './textes.ts';

export function routesAbonnement(): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/abonnement/etat', geste: 'socle.accueil.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const jour = aujourdhuiATunis();
      const f = await faitsDe(tx, params.entreprise ?? '');
      const etat: Etat = f ? etatAbonnement(f, jour) : { etat: 'hors', raison: 'inconnu' };
      return { corps: { aujourdhui: jour, ...etat } };
    },
  });

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/abonnement', geste: 'socle.abonnement.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const ent = params.entreprise ?? '';
      const jour = aujourdhuiATunis();
      const f = await faitsDe(tx, ent);
      const etat: Etat = f ? etatAbonnement(f, jour) : { etat: 'hors', raison: 'inconnu' };
      // Les prix hors taxes, en texte décimal (l'argent ne sort jamais en millimes bruts).
      const prix = ((await tx.query('select plateforme.prix_du_jour($1::date) p', [jour])).rows[0].p as { offre: string; periodicite: string; montantHt: string }[])
        .map((p) => ({ ...p, montantHt: versTexte(BigInt(p.montantHt), 3) }));
      const historique = (await tx.query('select plateforme.historique_abonnement($1) h', [ent])).rows[0].h as { le: string; nature: string; apres: unknown }[];
      return { corps: { aujourdhui: jour, etat, prix, historique } };
    },
  });

  return routes;
}
