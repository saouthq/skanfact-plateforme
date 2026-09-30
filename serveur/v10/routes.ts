// Les routes du dossier v10 (0011) : le point de contact de l'interface v10 (web/public/plateforme/
// pont.js) lit le dossier entier, y renvoie les objets qui changent, et fait émettre une facture ou un
// avoir par le serveur. Une clé de l'API n'y entre pas (gestes « horsCle ») : un logiciel branché passe par les
// routes de chaque module.

import { z } from 'zod';
import { motif } from '../../textes/index.ts';
import type { Route } from '../app.ts';
import { mettreEnQuarantaine, type Contexte } from '../connexion.ts';
import { Refus, texteDuRefus } from '../erreurs.ts';
import { appliquer, Conflit, emettreDepuisV10, lireDossier, type Changement } from './dossier.ts';

// Une clé v10 : l'identifiant qu'elle a donné à l'objet, ou le nom d'un champ du dossier.
const cle = z.string().min(1).max(200);
const collection = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,60}$/);
// Un objet du dossier : du JSON, sans nombre à virgule (l'interface les écrit en texte exact).
const contenu: z.ZodType<unknown> = z.lazy(() => z.union([z.number().int(), z.string(), z.boolean(), z.null(), z.array(contenu), z.record(z.string(), contenu)]));

const changement = z.object({ collection, cle, rang: z.number().int().min(0).nullable(), revision: z.number().int().min(1).nullable(), contenu: contenu });

export function routesV10(ctx: Contexte): Route<never>[] {
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
    corps: z.object({ changements: z.array(changement).min(1).max(2000) }),
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

  // ── La quarantaine (brique 74 bis ; docs/hors-ligne.md, H10 ; 04 § 7) ──────────────────────────
  // Un appareil retiré remet ce qui attendait le réseau, par son jeton (qui n'ouvre plus rien d'autre) :
  // reçu, jamais appliqué d'office. Une seule remise par session ; tout un dossier peut y tenir.
  ajouter({
    // (Une route sans session : l'entreprise est dans le corps, la porte ne la juge pas ; la base, si.)
    // (8 Mo : une route sans session ne lit pas plus ; une journée de travail hors ligne y tient large.)
    methode: 'POST', chemin: '/quarantaine', geste: 'public', limiteCorps: 8 * 1024 * 1024,
    corps: z.object({ entreprise: z.string().uuid(), changements: z.array(changement).min(1).max(20_000) }),
    traiter: async ({ corps, requete }) => {
      const jeton = /^Bearer (.+)$/.exec(requete.headers.authorization ?? '')?.[1];
      const recus = jeton ? await mettreEnQuarantaine(ctx, jeton, corps.entreprise, corps.changements) : null;
      if (recus === null) return { statut: 401, corps: { motif: motif('commun.connexion_requise'), bouton: 'connexion' } };
      return { corps: { recus } };
    },
  });

  // Ce qui attend la décision : qui l'a remis, depuis quel appareil, quand, et quoi.
  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/quarantaine', geste: 'socle.dossier.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const r = await tx.query(`select q.id, q.appareil_nom, u.nom utilisateur, q.recue_le, q.changements
        from socle.quarantaine q left join socle.utilisateur u on u.id = q.utilisateur
        where q.entreprise = $1 and q.decision is null order by q.recue_le, q.id limit 50`, [params.entreprise]);
      return {
        corps: {
          remises: (r.rows as { id: string; appareil_nom: string; utilisateur: string | null; recue_le: Date; changements: Changement[] }[]).map((q) => ({
            id: q.id, appareil: q.appareil_nom, utilisateur: q.utilisateur ?? '', recueLe: q.recue_le.toISOString(), changements: q.changements,
          })),
        },
      };
    },
  });

  // Décider : rejeter (rien ne s'applique, la remise reste) ; accepter (chaque changement s'applique
  // comme s'il arrivait maintenant, avec la révision que l'appareil avait vue : ce qui a changé depuis,
  // ou que le serveur refuse, est mis de côté et dit ; jamais deux versions fusionnées en une troisième).
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/quarantaine/:remise', geste: 'socle.dossier.modifier',
    corps: z.object({ accepter: z.boolean() }),
    traiter: async ({ params, corps, qui }, tx) => {
      if (!tx || !qui) throw new Error('transaction attendue');
      if (!/^[0-9a-f-]{36}$/i.test(params.remise ?? '')) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      const q = (await tx.query('select changements, decision from socle.quarantaine where id = $1 and entreprise = $2 for update', [params.remise, params.entreprise])).rows[0] as
        { changements: Changement[]; decision: string | null } | undefined;
      if (!q) return { statut: 404, corps: { motif: motif('commun.introuvable') } };
      if (q.decision) return { statut: 409, corps: { motif: motif('quarantaine.deja_decidee') } };
      let appliques = 0;
      const misDeCote: { collection: string; cle: string; raison: unknown }[] = [];
      if (corps.accepter) {
        for (const c of q.changements) {
          await tx.query('savepoint changement');
          try {
            await appliquer(tx, params.entreprise ?? '', qui.utilisateur, [c]);
            await tx.query('release savepoint changement');
            // On compte ce que la personne avait fait (les réglages du dossier suivent sans se compter, H6).
            if (c.collection !== '_racine') appliques++;
          } catch (e) {
            await tx.query('rollback to savepoint changement');
            // Changé depuis, ou refusé (par le serveur ou par la base : une facture émise, un mois
            // fermé) : mis de côté, avec sa raison ; le reste de la remise s'applique quand même.
            if (e instanceof Conflit) misDeCote.push({ collection: c.collection, cle: c.cle, raison: motif('quarantaine.change_depuis') });
            else if (e instanceof Refus || (e as { code?: unknown }).code === '42501') misDeCote.push({ collection: c.collection, cle: c.cle, raison: texteDuRefus(e as Error) });
            else throw e;
          }
        }
      }
      await tx.query(`update socle.quarantaine set decision = $2, decidee_le = $3, decidee_par = socle.moi(), mis_de_cote = $4 where id = $1`,
        [params.remise, corps.accepter ? 'acceptee' : 'rejetee', (ctx.maintenant ?? (() => new Date()))(), corps.accepter ? JSON.stringify(misDeCote) : null]);
      return { corps: { appliques, misDeCote } };
    },
  });

  return routes;
}
