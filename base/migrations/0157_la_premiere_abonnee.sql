-- La première abonnée d'un groupe est celle qui a payé (1.83.0 ; recette du 20/10/2026 ; docs/abonnement.md C17). Une
-- société qui a payé passait APRÈS celle qu'on facture quand sa période payée commençait plus tard que la période
-- facturée : Trabelsi Distribution, payée pour une période qui commence le 05/12/2026, et Trabelsi Logistique, jamais
-- payée, facturée pour une période qui commence le 20/11/2026, payaient toutes deux le prix normal, alors que la fiche
-- et l'aperçu du groupe promettaient « −20 % » à la seconde. Désormais : celles qui ont payé d'abord (la plus ancienne
-- première période payée ; à égalité, la plus ancienne créée), puis, tant qu'aucune n'a payé, celle qu'on facture
-- (elle paie le prix normal) ; l'ordre de la fiche et de l'aperçu (premiere_periode nulls last) est le même.
create or replace function plateforme.remise_de(p_entreprise uuid, p_debut date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_regle_groupe jsonb := plateforme.regle_remise_du_jour('groupe', p_debut);
  v_regle_cabinet jsonb := plateforme.regle_remise_du_jour('cabinet', p_debut);
  v_premiere date := coalesce(plateforme.premiere_periode(p_entreprise), p_debut);
  v_paiement date := plateforme.premier_paiement(p_entreprise);
  v_membre plateforme.groupe_membre;
  v_tete record;
  v_cabinet record;
  v_fin date;
  v_g jsonb;
  v_c jsonb;
begin
  -- Le groupe : la société en est le premier jour de la période, et une autre du groupe ce jour-là s'est abonnée avant
  -- elle : celles qui ont payé d'abord (la plus ancienne première période payée ; à égalité, la plus ancienne créée) ;
  -- tant qu'aucune n'a payé, celle qu'on facture est la première, et paie le prix normal.
  select * into v_membre from plateforme.groupe_membre m
   where m.entreprise = p_entreprise and m.depuis <= p_debut and (m.retire_le is null or p_debut < m.retire_le)
   order by m.depuis desc limit 1;
  if found and coalesce((v_regle_groupe->>'taux')::int, 0) > 0 then
    select e.id, e.raison_sociale into v_tete
      from plateforme.groupe_membre m join socle.entreprise e on e.id = m.entreprise
     where m.groupe = v_membre.groupe and m.depuis <= p_debut and (m.retire_le is null or p_debut < m.retire_le)
     order by case when plateforme.premiere_periode(m.entreprise) is not null then 0 when m.entreprise = p_entreprise then 1 else 2 end,
              plateforme.premiere_periode(m.entreprise), e.cree_le, e.id
     limit 1;
    if v_tete.id is distinct from p_entreprise then
      v_g := jsonb_build_object('nature', 'groupe', 'taux', (v_regle_groupe->>'taux')::int,
        'groupe', (select g.nom from plateforme.groupe g where g.id = v_membre.groupe), 'premiere', v_tete.raison_sociale);
    end if;
  end if;
  -- Le cabinet : un mandat accepté (en cours ou arrêté depuis) dont le premier jour vient avant le premier paiement, et
  -- une période qui commence dans les mois de la règle depuis la première période payée.
  if coalesce((v_regle_cabinet->>'taux')::int, 0) > 0 then
    v_fin := (v_premiere + make_interval(months => (v_regle_cabinet->>'mois')::int))::date;
    if p_debut < v_fin then
      select o.nom, d.debut into v_cabinet from socle.mandat d join socle.organisation o on o.id = d.cabinet
       where d.entreprise = p_entreprise and d.statut in ('actif', 'termine') and (v_paiement is null or d.debut <= v_paiement)
       order by d.debut limit 1;
      if found then
        v_c := jsonb_build_object('nature', 'cabinet', 'taux', (v_regle_cabinet->>'taux')::int, 'cabinet', v_cabinet.nom,
          'jusquAu', v_fin - 1);
      end if;
    end if;
  end if;
  if v_g is null then return v_c; end if;
  if v_c is null then return v_g; end if;
  -- Les deux : la plus forte (à égalité, celle du groupe, qui dure), et l'autre dite.
  if (v_c->>'taux')::int > (v_g->>'taux')::int then return v_c || jsonb_build_object('aussi', v_g); end if;
  return v_g || jsonb_build_object('aussi', v_c);
end $$;

-- Les personnes d'un groupe (la fiche d'un groupe, « Membres ») : chacune une fois, même membre de plusieurs sociétés
-- (Sami, propriétaire des deux sociétés de son groupe, comptait pour deux).
create function plateforme.console_personnes(p_entreprises uuid[]) returns integer
language sql stable security definer set search_path = pg_catalog, socle as $$
  select count(distinct m.utilisateur)::int from socle.membre m where m.entreprise = any(p_entreprises) and m.actif
$$;
revoke execute on function plateforme.console_personnes(uuid[]) from public;
grant execute on function plateforme.console_personnes(uuid[]) to skanfact_app;
