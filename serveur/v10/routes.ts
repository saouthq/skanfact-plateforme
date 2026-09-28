// Les routes du dossier v10 (0011) : le point de contact de l'interface v10 (web/public/plateforme/
// pont.js) lit le dossier entier, y renvoie les objets qui changent, et fait émettre une facture ou un
// avoir par le serveur. Une clé de l'API n'y entre pas (gestes « horsCle ») : un logiciel branché passe par les
// routes de chaque module.

import { z } from 'zod';
import type { Route } from '../app.ts';
import type { Contexte } from '../connexion.ts';
import { appliquer, emettreDepuisV10, lireDossier, type Changement } from './dossier.ts';

// Une clé v10 : l'identifiant qu'elle a donné à l'objet, ou le nom d'un champ du dossier.
const cle = z.string().min(1).max(200);
const collection = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,60}$/);
// Un objet du dossier : du JSON, sans nombre à virgule (l'interface les écrit en texte exact).
const contenu: z.ZodType<unknown> = z.lazy(() => z.union([z.number().int(), z.string(), z.boolean(), z.null(), z.array(contenu), z.record(z.string(), contenu)]));

export function routesV10(ctx: Contexte): Route<never>[] {
  void ctx;
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/dossier-v10', geste: 'socle.dossier.voir',
    traiter: async ({ params, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      return { corps: { objets: await lireDossier(tx, params.entreprise ?? '', qui.utilisateur) } };
    },
  });

  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/dossier-v10', geste: 'socle.dossier.modifier',
    corps: z.object({ changements: z.array(z.object({ collection, cle, rang: z.number().int().min(0).nullable(), revision: z.number().int().min(1).nullable(), contenu: contenu })).min(1).max(2000) }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      return { corps: { revisions: await appliquer(tx, params.entreprise ?? '', qui.utilisateur, corps.changements as Changement[]) } };
    },
  });

  // Émettre une facture, ou un avoir : chacun sa route, chacun son geste (03 § 2.1).
  const demande = z.object({
    document: z.record(z.string(), contenu), client: z.record(z.string(), contenu).nullable(),
    revision: z.number().int().min(1).nullable(), rang: z.number().int().min(0).nullable(), netAPayer: z.string().regex(/^-?\d+(\.\d+)?$/),
  });
  for (const [type, chemin, geste] of [['facture', 'emettre', 'ventes.facture.emettre'], ['avoir', 'emettre-avoir', 'ventes.avoir.emettre']] as const) {
    ajouter({
      methode: 'POST', chemin: `/entreprises/:entreprise/dossier-v10/${chemin}`, geste, corps: demande,
      traiter: async ({ params, corps, qui }, tx) => {
        if (!tx || !qui) throw new Error('transaction attendue');
        return { corps: await emettreDepuisV10(tx, params.entreprise ?? '', qui.utilisateur, corps as Parameters<typeof emettreDepuisV10>[3], type) };
      },
    });
  }

  return routes;
}
