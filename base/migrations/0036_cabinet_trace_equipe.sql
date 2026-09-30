-- Ce qui a changé dans l'équipe du cabinet (brique 61, 30/09/2026 ; docs/cabinet.md, C51). Chaque geste
-- sur l'équipe (inviter, annuler une invitation, rejoindre, changer un rôle, retirer) et le nom du
-- cabinet se tracent au nom du cabinet depuis les briques 46 et 47 (0030, 0031), mais la trace sans
-- entreprise ne se lit que par qui l'a écrite (0003). Un associé la lit ici : les cinquante derniers
-- gestes, avec le nom de qui les a faits et de la personne visée. Personne d'autre.

create index audit_objet on socle.audit (objet_id, instant) where entreprise is null;

create function socle.trace_de_l_equipe(p_cabinet uuid)
returns table (instant timestamptz, qui text, geste text, avant jsonb, apres jsonb, membre text)
language plpgsql stable security definer set search_path = pg_catalog, socle as $$
begin
  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet lit ce qui a changé dans son équipe'); end if;
  return query
    select a.instant, coalesce(u.nom, ''), a.geste, a.avant, a.apres, coalesce(v.nom, '')
      from socle.audit a
      left join socle.utilisateur u on u.id = a.utilisateur
      left join socle.membre m on m.id = coalesce(a.apres->>'membre', a.avant->>'membre')::uuid
      left join socle.utilisateur v on v.id = m.utilisateur
     where a.entreprise is null and a.objet_type = 'cabinet' and a.objet_id = p_cabinet
       and (a.geste like 'cabinet.equipe.%' or a.geste = 'cabinet.renommer')
     order by a.instant desc, a.id desc
     limit 50;
end $$;
revoke execute on function socle.trace_de_l_equipe(uuid) from public;
grant execute on function socle.trace_de_l_equipe(uuid) to skanfact_app;
