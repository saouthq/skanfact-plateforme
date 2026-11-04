// Le PDF fait par le serveur (docs/pdf.md) : la page que l'écran a dessinée en revient en PDF A4, comme l'application
// de bureau l'imprime. Un geste PERSONNEL : le serveur ne lit rien dans la base, il imprime ce que la personne voit
// déjà, pour une entreprise comme pour un cabinet ; il ne garde rien (ni la page, ni le PDF).

import { z } from 'zod';
import type { Route } from '../app.ts';
import type { Contexte } from '../connexion.ts';
import { motif } from '../../textes/index.ts';
import { ImpressionImpossible, ImpressionTropLongue, ImprimeurOccupe } from './imprimeur.ts';
import './textes.ts';

// La page d'une pièce porte son logo et son cachet en images intégrées : quelques centaines de Ko d'ordinaire.
export const LIMITE_PAGE = 8 * 1_048_576;
const ATTENTE_PDF = 10;

export function routesPdf(ctx: Contexte): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };
  ajouter({
    methode: 'POST', chemin: '/pdf', geste: 'compte.pdf.imprimer', limiteCorps: LIMITE_PAGE + 65_536,
    corps: z.object({ nom: z.string().trim().min(1).max(200), html: z.string().min(1) }),
    traiter: async ({ corps, qui }) => {
      const nom = corps.nom;
      const taille = Buffer.byteLength(corps.html, 'utf8');
      if (taille > LIMITE_PAGE) {
        return { statut: 413, corps: { motif: motif('pdf.trop_lourd', { nom, taille: (taille / 1_048_576).toFixed(1).replace('.', ','), limite: LIMITE_PAGE / 1_048_576 }), bouton: null } };
      }
      const imprimeur = ctx.imprimeur;
      if (!imprimeur) return { statut: 503, corps: { motif: motif('pdf.indisponible'), bouton: null, indisponible: true } };
      // (1.276.0, l'audit G12) L'impression se fait transaction close (`ensuite`) : elle n'a pas besoin de la base, et
      // jusqu'à une minute d'attente ne garde plus une connexion. Chaque personne a sa part de la file.
      const html = corps.html;
      return { corps: {}, ensuite: async () => {
        let fait;
        try { fait = await imprimeur.imprimer(html, qui?.cle?.id ?? qui?.utilisateur); } catch (e) {
          if (e instanceof ImprimeurOccupe && e.message === 'personne') return { statut: 429, corps: { motif: motif('pdf.trop_a_la_fois', { secondes: ATTENTE_PDF }), bouton: null, attendreSecondes: ATTENTE_PDF } };
          if (e instanceof ImprimeurOccupe) return { statut: 503, corps: { motif: motif('pdf.occupe'), bouton: null, attendreSecondes: 60 } };
          if (e instanceof ImpressionTropLongue) return { statut: 504, corps: { motif: motif('pdf.trop_long', { nom }), bouton: null } };
          // Chromium absent de cette machine : l'écran retombe sur la fenêtre d'impression, et le dit.
          if (e instanceof ImpressionImpossible && e.message === 'navigateur-absent') return { statut: 503, corps: { motif: motif('pdf.indisponible'), bouton: null, indisponible: true } };
          if (e instanceof ImpressionImpossible) return { statut: 422, corps: { motif: motif('pdf.echec', { nom }), bouton: null } };
          throw e;
        }
        return { corps: { nom: /\.pdf$/i.test(nom) ? nom : `${nom}.pdf`, pages: fait.pages, pdf: fait.pdf.toString('base64') } };
      } };
    },
  });
  return routes;
}
