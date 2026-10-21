// Les sauvegardes, vues de l'entreprise (lot Fonctions 3 ; base 0161 ; docs/sauvegardes-ecran.md). Le propriétaire et
// ses administrateurs lisent ce que la veille a vu des copies (la nuit, hors de la machine, l'essai de restauration) et
// les remises faites de leur entreprise ; ils DEMANDENT de revenir à une minute passée : la demande part au support,
// qui fait d'abord l'essai (06 § 4.4). Une phrase ne se dit vraie qu'avec ce qui la tient : sans relevé récent de la
// veille, l'écran dit depuis quand elle se tait, au lieu d'un « à jour ».

import { z } from 'zod';
import type { Route } from './app.ts';
import type { Contexte } from './connexion.ts';
import { motif, rendre, t } from '../textes/index.ts';
import { VEILLE_RECENTE_MIN } from './console/alertes.ts';
import { CALENDRIER, GARDE } from './console/sauvegardes.ts';

type Resultat = { le: string; ok: boolean } | null;
const resultat = (x: unknown): Resultat => {
  const r = x as { le?: unknown; ok?: unknown } | null;
  return r && typeof r.le === 'string' ? { le: r.le, ok: r.ok === true } : null;
};
// L'heure de Tunis d'une heure UTC « HH:MM » (la Tunisie n'a plus d'heure d'été depuis 2009 : UTC+1).
const heureATunis = (utc: string) => { const [h, m] = utc.split(':').map(Number); return `${String(((h ?? 0) + 1) % 24).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`; };
// « AAAA-MM-JJ HH:MM » à Tunis, en instant.
export const instantATunis = (minute: string) => new Date(`${minute.replace(' ', 'T')}:00+01:00`);

export function routesSauvegardes(ctx: Contexte): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };
  const maintenant = () => (ctx.maintenant ?? (() => new Date()))();

  ajouter({
    methode: 'GET', chemin: '/entreprises/:entreprise/sauvegardes', geste: 'socle.sauvegardes.voir',
    traiter: async ({ params }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const quand = maintenant();
      const lu = (await tx.query('select plateforme.mes_sauvegardes($1, $2) l', [params.entreprise ?? '', quand])).rows[0].l as Record<string, unknown>;
      const nuit = lu.nuit as { jour: string; sauvegarde: unknown; copieDeBase: unknown } | null;
      const veille = lu.veille as { minute: string; archivage: { enMarche?: unknown } | null; horsMachine: { regle?: unknown; attenteDepuis?: unknown } | null } | null;
      const hm = veille?.horsMachine ?? null;
      return {
        corps: {
          calendrier: { sauvegarde: heureATunis(CALENDRIER.sauvegarde), exercice: { jourDuMois: CALENDRIER.exercice.jourDuMois, heure: heureATunis(CALENDRIER.exercice.heure) } },
          garde: GARDE,
          nuit: nuit ? { jour: nuit.jour, sauvegarde: resultat(nuit.sauvegarde), copieDeBase: resultat(nuit.copieDeBase) } : null,
          reussie: (lu.reussie as { jour: string; le: string } | null) ?? null,
          exercice: (lu.exercice as { jour: string; le: string; ok: boolean } | null) ?? null,
          archivage: veille?.archivage ? { enMarche: veille.archivage.enMarche === true } : null,
          horsMachine: hm ? { regle: hm.regle === true, attenteDepuis: typeof hm.attenteDepuis === 'string' ? hm.attenteDepuis : null } : null,
          veille: veille ? { minute: veille.minute, recente: quand.getTime() - Date.parse(veille.minute) <= VEILLE_RECENTE_MIN * 60_000 } : null,
          remises: (lu.remises as unknown[]) ?? [],
        },
      };
    },
  });

  // Demander de revenir à une minute passée : une demande au support, avec la minute et le motif. Rien ne change ici.
  ajouter({
    methode: 'POST', chemin: '/entreprises/:entreprise/sauvegardes/revenir', geste: 'socle.sauvegardes.demander',
    corps: z.object({
      minute: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, 'sauvegardes.champ.minute'),
      motif: z.string().trim().min(3, 'sauvegardes.champ.motif').max(1000),
    }).strict(),
    traiter: async ({ params, corps }, tx) => {
      if (!tx) throw new Error('transaction attendue');
      const quand = maintenant();
      const visee = instantATunis(corps.minute);
      const [jour, heure] = corps.minute.split(' ');
      const lisible = `${(jour ?? '').split('-').reverse().join('/')} à ${heure ?? ''}`;
      if (Number.isNaN(visee.getTime()) || visee.getTime() >= quand.getTime()) {
        return { statut: 400, corps: { motif: motif('sauvegardes.avenir', { minute: lisible }), champ: 'minute', bouton: null } };
      }
      if (quand.getTime() - visee.getTime() > GARDE.jours * 86_400_000) {
        return { statut: 400, corps: { motif: motif('sauvegardes.trop_vieux', { minute: lisible, jours: GARDE.jours }), champ: 'minute', bouton: null } };
      }
      await tx.query('select plateforme.sauvegardes_exiger($1)', [params.entreprise ?? '']);
      // La demande s'écrit en français, comme la personne l'aurait écrite : l'équipe la lit telle quelle.
      const sujet = rendre(t('sauvegardes.demande.sujet', { minute: lisible }), 'fr');
      const texte = rendre(t('sauvegardes.demande.texte', { minute: lisible, motif: corps.motif }), 'fr');
      const id = (await tx.query('select plateforme.support_ecrire($1, $2, $3, $4, $5, $6) id', [params.entreprise ?? '', sujet, texte, null, 'sauvegardes', quand])).rows[0].id as string;
      return { statut: 201, corps: { id } };
    },
  });
  return routes;
}
