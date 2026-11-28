-- Un cabinet demande un code à ses comptables (1.390.1, tâche 107). La colonne `code_exige` existe depuis la 0219,
-- éteinte au départ ; rien ne permettait de l'allumer. Un associé l'allume ou l'éteint, et le geste se trace au nom du
-- cabinet. La règle reste celle de la 0219 : le code est exigé de chaque comptable (supervision, révision, saisie) sept
-- jours après le premier vrai dossier du cabinet ; avec le relais d'e-mails, le code par e-mail sur un appareil inconnu
-- en tient lieu.
-- Le geste se trace sous « cabinet.equipe.code_exige » : il se lit dans « Ce qui a changé dans l'équipe » (0036).

create function socle.exiger_code_cabinet(p_cabinet uuid, p_exige boolean) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_avant boolean;
begin
  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet demande un code à ses comptables'); end if;
  select code_exige into v_avant from socle.organisation where id = p_cabinet and type = 'cabinet' for update;
  if v_avant is distinct from p_exige then
    update socle.organisation set code_exige = p_exige where id = p_cabinet;
    perform socle.tracer(null, 'cabinet.equipe.code_exige', 'cabinet', p_cabinet, jsonb_build_object('exige', v_avant), jsonb_build_object('exige', p_exige));
  end if;
  return p_exige;
end $$;
revoke execute on function socle.exiger_code_cabinet(uuid, boolean) from public;
grant execute on function socle.exiger_code_cabinet(uuid, boolean) to skanfact_app;
