-- 0128 : prévenir d'un coup les clients touchés par un incident (1.35.0 ; la liste des fonctions qui manquent, 19 ;
-- docs/console.md C51). Une demande liée à un incident (0126) attend souvent le même mot que toutes les autres : « c'est
-- réparé », « on y travaille ». La direction et le support l'écrivent une fois ; chaque demande OUVERTE liée à l'incident
-- le reçoit comme une réponse ordinaire (0124 : la même commande ne fait qu'un message par demande), et son client est
-- prévenu comme pour toute réponse. Une demande close n'est pas rouverte ; rien ne part chez qui n'a rien demandé.

create function plateforme.console_repondre_incident(p_incident uuid, p_texte text, p_maintenant timestamptz, p_commande uuid)
returns integer
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  v_ref text; d record; v_nouvelles integer := 0; v_toutes integer := 0;
begin
  if p_commande is null then perform socle.refus('une réponse à plusieurs demandes porte son identifiant de commande'); end if;
  select plateforme.ref_incident(i.id) into v_ref from plateforme.service_incident i where i.id = p_incident;
  if v_ref is null then perform socle.refus('cet incident n''existe pas'); end if;
  -- Les demandes se verrouillent dans un ordre fixe : deux envois au même moment ne s'attendent pas en croix.
  for d in select s.id from plateforme.demande_support s where s.incident = p_incident and s.close_le is null order by s.id for update loop
    v_toutes := v_toutes + 1;
    if not exists (select 1 from plateforme.message_support m where m.demande = d.id and m.commande = p_commande) then
      v_nouvelles := v_nouvelles + 1;
    end if;
    perform plateforme.console_repondre_demande(d.id, p_texte, null, p_maintenant, p_commande);
  end loop;
  if v_toutes = 0 then perform socle.refus('aucune demande ouverte n''est liée à cet incident'); end if;
  -- Renvoyée après une coupure : les réponses sont déjà là, rien de plus ne s'écrit.
  if v_nouvelles = 0 then return v_toutes; end if;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.prevenir', null, v_ref, null, jsonb_build_object('incident', v_ref, 'demandes', v_nouvelles));
  return v_toutes;
end $$;
revoke execute on function plateforme.console_repondre_incident(uuid, text, timestamptz, uuid) from public;
grant execute on function plateforme.console_repondre_incident(uuid, text, timestamptz, uuid) to skanfact_app;
