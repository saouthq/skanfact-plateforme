-- 0227 — Les modules programmés, et le retour automatique (pilotage depuis la console, points 3 et 4 ; Skander,
-- 25/11/2026 : « la caisse s'ouvre le 1er décembre à 8 h », « une maintenance de 22 h à 23 h qui se lève toute seule »,
-- « un état posé pour un essai qui revient de lui-même après N jours »).
--
-- Un état posé porte désormais deux dates, toutes deux facultatives :
--   - `debut` : il ne vaut qu'à partir de ce moment (vide : tout de suite) ;
--   - `fin`   : il cesse de valoir à ce moment, et le module revient à ce qui vaudrait sans lui (vide : sans fin).
-- Plusieurs états peuvent attendre leur tour pour le même module et la même entreprise : celui « tout de suite », et des
-- programmés. L'état EN VIGUEUR est, parmi ceux dont le début est passé et la fin pas encore, le plus récemment commencé.
-- Rien ne tourne en tâche de fond : chaque lecture compare à l'heure du serveur, donc rien ne peut « oublier » de basculer.

alter table plateforme.module_etat add column debut timestamptz, add column fin timestamptz,
  add constraint module_etat_dates check (fin is null or debut is null or fin > debut);
drop index plateforme.module_etat_un;
create unique index module_etat_un on plateforme.module_etat (module, coalesce(entreprise, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(debut, '-infinity'::timestamptz));

-- L'état en vigueur d'UN module pour UNE portée exacte (une entreprise, ou tout le serveur quand elle est vide), à un instant.
create function plateforme.module_en_vigueur(p_module text, p_entreprise uuid, p_a timestamptz) returns plateforme.module_etat
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select m.* from plateforme.module_etat m
   where m.module = p_module and m.entreprise is not distinct from p_entreprise
     and (m.debut is null or m.debut <= p_a) and (m.fin is null or m.fin > p_a)
   order by coalesce(m.debut, '-infinity'::timestamptz) desc limit 1;
$$;
revoke execute on function plateforme.module_en_vigueur(text, uuid, timestamptz) from public;

drop function plateforme.console_poser_module(text, uuid, text, text, timestamptz, text);
create function plateforme.console_poser_module(p_module text, p_entreprise uuid, p_etat text, p_motif text, p_maintenant timestamptz,
  p_message text default null, p_debut timestamptz default null, p_fin timestamptz default null) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_avant plateforme.module_etat;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if not plateforme.suis_titulaire_console() then
    perform socle.refus('seul le titulaire de la console change l''état d''un module');
  end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  perform plateforme.motif_sans_secret(p_motif);
  if v_msg is not null then
    if length(v_msg) not between 3 and 300 then perform socle.refus('le message aux clients tient entre trois et trois cents caractères'); end if;
    perform plateforme.motif_sans_secret(v_msg);
  end if;
  if p_etat = 'serveur' and (v_msg is not null or p_debut is not null or p_fin is not null) then
    perform socle.refus('un message aux clients accompagne un état posé : « revenir au réglage du serveur » efface aussi le message');
  end if;
  if p_module !~ '^[a-z]{2,20}$' then perform socle.refus('ce module n''existe pas'); end if;
  if p_etat not in ('ouvert', 'beta', 'a_venir', 'ferme', 'serveur') then perform socle.refus('cet état n''existe pas'); end if;
  if p_entreprise is not null and not exists (select 1 from socle.entreprise where id = p_entreprise) then
    perform socle.refus('cette entreprise n''existe pas');
  end if;
  if p_debut is not null and p_debut <= p_maintenant then
    perform socle.refus('le début programmé est déjà passé : choisis « tout de suite »');
  end if;
  if p_fin is not null and p_fin <= coalesce(p_debut, p_maintenant) then
    perform socle.refus('la fin vient après le début');
  end if;
  v_avant := plateforme.module_en_vigueur(p_module, p_entreprise, p_maintenant);
  if p_debut is null then
    -- Tout de suite : remplace l'état « tout de suite » (et ce qui est déjà échu) ; les programmés à venir attendent.
    delete from plateforme.module_etat
     where module = p_module and entreprise is not distinct from p_entreprise
       and (debut is null or debut <= p_maintenant or (fin is not null and fin <= p_maintenant));
  else
    delete from plateforme.module_etat where module = p_module and entreprise is not distinct from p_entreprise and debut = p_debut;
  end if;
  if p_etat <> 'serveur' then
    insert into plateforme.module_etat (module, entreprise, etat, motif, le, par, message, debut, fin)
      values (p_module, p_entreprise, p_etat, btrim(p_motif), p_maintenant, socle.moi(), v_msg, p_debut, p_fin);
  end if;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'modules.etat', p_entreprise, btrim(p_motif),
      jsonb_build_object('module', p_module, 'etat', coalesce(v_avant.etat, 'serveur'), 'message', v_avant.message),
      jsonb_build_object('module', p_module, 'etat', p_etat, 'message', v_msg, 'debut', p_debut, 'fin', p_fin));
end $$;

-- Annuler un état programmé qui n'a pas encore commencé (le titulaire seul, motivé, au journal).
create function plateforme.console_annuler_programme(p_id bigint, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v plateforme.module_etat;
begin
  if not plateforme.suis_titulaire_console() then
    perform socle.refus('seul le titulaire de la console change l''état d''un module');
  end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  perform plateforme.motif_sans_secret(p_motif);
  select * into v from plateforme.module_etat where id = p_id for update;
  if v.id is null or v.debut is null or v.debut <= p_maintenant then
    perform socle.refus('ce changement programmé a déjà commencé ou n''existe plus : change le module à la place');
  end if;
  delete from plateforme.module_etat where id = p_id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'modules.annuler', v.entreprise, btrim(p_motif),
      jsonb_build_object('module', v.module, 'etat', v.etat, 'message', v.message, 'debut', v.debut, 'fin', v.fin), null);
end $$;

-- La console : chaque état posé, avec ses dates (en vigueur, programmé, ou échu — les échus ne se montrent plus) ;
-- l'historique garde aussi les annulations.
create or replace function plateforme.console_modules(p_entreprise uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']);
begin
  return jsonb_build_object(
    'maintenant', now(),
    'poses', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'module', m.module, 'entreprise', m.entreprise, 'nom', e.raison_sociale, 'etat', m.etat,
      'motif', m.motif, 'message', m.message, 'le', m.le, 'debut', m.debut, 'fin', m.fin, 'par', (select u.nom from socle.utilisateur u where u.id = m.par))
      order by m.module, e.raison_sociale nulls first, coalesce(m.debut, '-infinity'::timestamptz))
      from plateforme.module_etat m left join socle.entreprise e on e.id = m.entreprise
     where m.fin is null or m.fin > now()), '[]'::jsonb),
    'entreprise', (select jsonb_build_object('id', e.id, 'nom', e.raison_sociale) from socle.entreprise e where e.id = p_entreprise),
    'titulaire', plateforme.suis_titulaire_console(),
    'nomTitulaire', (select u.nom from socle.utilisateur u where u.id = plateforme.titulaire_console()),
    'historique', coalesce((select jsonb_agg(h order by h.le desc) from (
      select g.id, g.le, g.geste, g.motif, g.avant, g.apres, g.entreprise, e.raison_sociale nom, u.nom par
        from plateforme.geste_console g
        left join socle.entreprise e on e.id = g.entreprise
        left join socle.utilisateur u on u.id = g.qui
       where g.geste in ('modules.etat', 'modules.annuler') and (p_entreprise is null or g.entreprise = p_entreprise)
       order by g.le desc, g.id desc limit 30) h), '[]'::jsonb));
end $$;

-- Ce que voit une personne connectée : l'état EN VIGUEUR, pour tous et pour les entreprises qu'elle voit.
create or replace function socle.modules_pour_moi() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('module', v.module, 'entreprise', v.entreprise, 'etat', v.etat, 'message', v.message, 'fin', v.fin))
    from (select distinct module, entreprise from plateforme.module_etat) k
    cross join lateral plateforme.module_en_vigueur(k.module, k.entreprise, now()) v
   where v.id is not null
     and (v.entreprise is null
      or cardinality(coalesce(socle.mes_roles(v.entreprise), '{}')) > 0
      or socle.perimetre_cabinet(v.entreprise) is not null)), '[]'::jsonb);
end $$;

create or replace function socle.etat_module(p_module text, p_entreprise uuid) returns text
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select coalesce((plateforme.module_en_vigueur(p_module, p_entreprise, now())).etat, (plateforme.module_en_vigueur(p_module, null, now())).etat);
$$;

revoke execute on function plateforme.console_poser_module(text, uuid, text, text, timestamptz, text, timestamptz, timestamptz), plateforme.console_annuler_programme(bigint, text, timestamptz) from public;
grant execute on function plateforme.console_poser_module(text, uuid, text, text, timestamptz, text, timestamptz, timestamptz), plateforme.console_annuler_programme(bigint, text, timestamptz) to skanfact_app;
