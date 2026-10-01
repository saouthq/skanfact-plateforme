// Le tableau de bord du groupe (brique 113 ; 14 § 3.6 : « les chiffres de toutes les sociétés d'un groupe, dans la
// devise de base » ; 13, cible n° 6). Qui tient plusieurs sociétés voit leurs chiffres côte à côte, lus dans leurs
// livres : le chiffre d'affaires du mois et de l'exercice, ce qui reste à encaisser et à payer, la trésorerie. Une
// société dont le rôle de la personne ne montre pas les livres est nommée, sans ses chiffres (et sans deviner pourquoi
// au-delà de ce que la porte dit). Le total se fait par devise : on n'additionne jamais deux devises (7.0.1).
//
// Les chiffres sont ceux des livres (les écritures du serveur, brouillard compris, comme la balance) : la même source
// que la balance et la déclaration du mois, donc le même chiffre (« deux chemins, un chiffre »). Les entreprises
// d'essai (ce ne sont pas des données) et celles vues seulement par le mandat d'un cabinet n'y sont pas.

import { sql } from 'kysely';
import { versTexte } from '../moteur/argent.ts';
import type { Route } from './app.ts';
import { requetes } from './base.ts';
import type { Contexte } from './connexion.ts';
import { peut } from './porte/porte.ts';
import { aujourdhuiATunis } from './reglements.ts';
import { motif } from '../textes/index.ts';

type Chiffres = { caMois: string; caExercice: string; aEncaisser: string; aPayer: string; tresorerie: string };

export function routesGroupe(_ctx: Contexte, maintenant: () => Date = () => new Date()): Route<never>[] {
  const routes: Route<never>[] = [];
  const ajouter = <C>(r: Route<C>) => { routes.push(r as unknown as Route<never>); };

  ajouter({
    methode: 'GET', chemin: '/moi/groupe', geste: 'compte.voir',
    traiter: async ({ qui }, tx) => {
      if (!qui || !tx) throw new Error('session attendue');
      const jour = aujourdhuiATunis(maintenant());
      const mois = `${jour.slice(0, 7)}-01`;
      const entreprises = (await tx.query(`select e.id, e.raison_sociale, e.devise_base, e.debut_exercice_mois, coalesce(d.decimales, 3) decimales
          from socle.entreprise e left join socle.devise d on d.code = e.devise_base
         where not e.essai and socle.perimetre_cabinet(e.id) is null order by e.raison_sociale, e.id`)).rows as
        { id: string; raison_sociale: string; devise_base: string; debut_exercice_mois: number; decimales: number }[];
      const societes: { id: string; raisonSociale: string; devise: string; exerciceDepuis: string; chiffres: Chiffres | null; motif?: ReturnType<typeof motif> }[] = [];
      const totaux = new Map<string, { decimales: number; somme: Record<keyof Chiffres, bigint> }>();
      for (const e of entreprises) {
        // L'exercice en cours : il commence le 1er de son mois de début, cette année ou la précédente.
        const an = Number(jour.slice(0, 4)), moisDebut = Number(e.debut_exercice_mois);
        const debutAn = Number(jour.slice(5, 7)) >= moisDebut ? an : an - 1;
        const exercice = `${debutAn}-${String(moisDebut).padStart(2, '0')}-01`;
        const d = await peut(tx, qui, e.id, 'compta.livres.voir', false);
        if (!d.ok) { societes.push({ id: e.id, raisonSociale: e.raison_sociale, devise: e.devise_base, exerciceDepuis: exercice, chiffres: null, motif: motif('groupe.sans_chiffres') }); continue; }
        const r = (await sql<{ ca_mois: string; ca_exercice: string; a_encaisser: string; a_payer: string; tresorerie: string }>`
          select coalesce(sum(case when l.compte like '70%' and e.date_ecriture >= ${mois}::date then l.credit - l.debit end), 0)::text ca_mois,
                 coalesce(sum(case when l.compte like '70%' and e.date_ecriture >= ${exercice}::date then l.credit - l.debit end), 0)::text ca_exercice,
                 coalesce(sum(case when l.compte like '411%' then l.debit - l.credit end), 0)::text a_encaisser,
                 coalesce(sum(case when l.compte like '401%' then l.credit - l.debit end), 0)::text a_payer,
                 coalesce(sum(case when l.compte like '5%' then l.debit - l.credit end), 0)::text tresorerie
            from compta.ligne l join compta.ecriture e on e.id = l.ecriture
           where l.entreprise = ${e.id} and e.date_ecriture <= ${jour}::date`.execute(requetes(tx))).rows[0];
        const brut: Record<keyof Chiffres, bigint> = { caMois: BigInt(r?.ca_mois ?? 0), caExercice: BigInt(r?.ca_exercice ?? 0),
          aEncaisser: BigInt(r?.a_encaisser ?? 0), aPayer: BigInt(r?.a_payer ?? 0), tresorerie: BigInt(r?.tresorerie ?? 0) };
        const dec = Number(e.decimales);
        societes.push({ id: e.id, raisonSociale: e.raison_sociale, devise: e.devise_base, exerciceDepuis: exercice,
          chiffres: Object.fromEntries(Object.entries(brut).map(([k, v]) => [k, versTexte(v, dec)])) as Chiffres });
        const t = totaux.get(e.devise_base) ?? { decimales: dec, somme: { caMois: 0n, caExercice: 0n, aEncaisser: 0n, aPayer: 0n, tresorerie: 0n } };
        for (const k of Object.keys(brut) as (keyof Chiffres)[]) t.somme[k] += brut[k];
        totaux.set(e.devise_base, t);
      }
      return { corps: { jour, societes, totaux: [...totaux].map(([devise, t]) => ({ devise,
        chiffres: Object.fromEntries(Object.entries(t.somme).map(([k, v]) => [k, versTexte(v, t.decimales)])) as Chiffres })) } };
    },
  });
  return routes;
}
