// La console limitée à des adresses (pilotage depuis la console, point 9 ; base 0234). Le titulaire choisit les adresses
// (ou les plages) d'où la console s'ouvre ; tant que la liste est vide, elle s'ouvre de partout, comme avant.
//
// Ce qui est fermé depuis une autre adresse : la connexion à la console (les trois routes de l'entrée) et chaque appel
// d'une session déjà ouverte. L'application des clients n'est jamais touchée. La base garde la règle « ne jamais se
// fermer la porte » (la première adresse contient celle d'où l'on parle ; on ne retire pas la seule qui nous laisse
// entrer) ; si toutes les connexions du titulaire changent, `node base/equipe.ts adresses-ouvrir "<motif>"` la rouvre.
//
// L'adresse lue est celle de la requête (`requete.ip`), derrière le nombre de relais que la configuration déclare : la
// même que celle des limites d'appels et du blocage d'adresses.

import { z } from 'zod';
import type { Route } from './app.ts';
import { enTantQue, type Transaction } from './base.ts';
import type { Contexte } from './connexion.ts';
import { motif, type Texte } from '../textes/index.ts';
import './adresses-console/textes.ts';

// Cette adresse peut-elle ouvrir la console ? La base illisible : oui (une panne de la base ne ferme pas la console à
// son titulaire ; chaque geste, lui, passe par la base qui revérifie le rôle).
export async function adresseConsolePermise(ctx: Contexte, ip: string | undefined): Promise<boolean> {
  try {
    return await enTantQue(ctx.pool, null, async (tx) => (await tx.query('select plateforme.adresse_console_permise($1) v', [ip ?? ''])).rows[0]?.v !== false);
  } catch { return true; }
}

export type RefusAdresse = { motif: Texte; adresseRefusee: string };
export async function refusAdresseConsole(ctx: Contexte, ip: string | undefined): Promise<RefusAdresse | null> {
  if (await adresseConsolePermise(ctx, ip)) return null;
  const adresse = ip && ip.length <= 60 ? ip : 'inconnue';
  return { motif: motif('adresses_console.refusee', { adresse }), adresseRefusee: adresse };
}

// Les routes de la console : lire, ajouter une adresse, en retirer une.
export function routesAdressesConsole(ctx: Contexte): Route<never>[] {
  const maintenant = () => (ctx.maintenant ?? (() => new Date()))();
  const transaction = (tx: Transaction | null): Transaction => { if (!tx) throw new Error('transaction attendue'); return tx; };
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };
  ajouter({
    methode: 'GET', chemin: '/console/adresses', geste: 'console.adresses.voir',
    traiter: async ({ requete }, tx) => ({ corps: (await transaction(tx).query('select plateforme.console_adresses_console($1) v', [requete.ip ?? ''])).rows[0]?.v }),
  });
  ajouter({
    methode: 'POST', chemin: '/console/adresses', geste: 'console.adresses.poser',
    corps: z.object({ plage: z.string().max(60), nom: z.string().max(80), motif: z.string().max(500) }),
    traiter: async ({ corps, requete }, tx) => {
      const id = (await transaction(tx).query('select plateforme.console_ajouter_adresse($1, $2, $3, $4, $5) v', [corps.plage, corps.nom, corps.motif, requete.ip ?? '', maintenant()])).rows[0]?.v;
      return { statut: 201, corps: { id: Number(id) } };
    },
  });
  ajouter({
    methode: 'POST', chemin: '/console/adresses/retirer', geste: 'console.adresses.poser',
    corps: z.object({ id: z.number().int().positive(), motif: z.string().max(500) }),
    traiter: async ({ corps, requete }, tx) => {
      await transaction(tx).query('select plateforme.console_retirer_adresse($1, $2, $3, $4)', [corps.id, corps.motif, requete.ip ?? '', maintenant()]);
      return { corps: { ok: true } };
    },
  });
  return routes;
}
