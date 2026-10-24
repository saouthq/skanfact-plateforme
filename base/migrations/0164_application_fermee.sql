-- L'application fermée aux clients pendant une maintenance (1.107.0 ; docs/console.md, C24 bis ; docs/mise-en-ligne.md,
-- M). Demandé par Skander le 22/10/2026 : « la partie gestion (maintenance en cours) ». Une maintenance annoncée (0089)
-- ne faisait que se dire sur la page d'état ; pendant un geste risqué (une migration lourde, une reprise de données), les
-- clients continuaient d'écrire. Désormais une maintenance peut FERMER l'application aux clients :
--   - une maintenance annoncée se ferme pendant son créneau (avant qu'elle finisse) ;
--   - en urgence, l'application se ferme MAINTENANT : une « Maintenance urgente » qui commence tout de suite, fermée, de
--     douze heures au plus, et la page d'état la dit comme les autres ;
--   - une maintenance fermée en cours se rouvre à tout moment (elle finit alors) ;
--   - le serveur lit la fermeture en cours (`application_fermee`) : les clients voient « Maintenance en cours » et l'heure
--     de fin ; la console, elle, reste ouverte à l'équipe.
-- Chaque geste demande son motif et entre au journal, comme ceux des maintenances.

create table plateforme.service_fermeture (
  maintenance uuid primary key references plateforme.service_maintenance(id),
  posee_le timestamptz not null,
  posee_par uuid not null references socle.utilisateur(id),
  -- Rouverte avant la fin : la maintenance finit alors (sa fin avance), et l'application est rouverte à la seconde même
  -- (une maintenance dure au moins une seconde : 0089).
  rouverte_le timestamptz,
  rouverte_par uuid references socle.utilisateur(id),
  check ((rouverte_le is null) = (rouverte_par is null))
);
alter table plateforme.service_fermeture enable row level security;
alter table plateforme.service_fermeture force row level security;

-- Fermer l'application pendant une maintenance annoncée, qui n'est ni annulée ni finie.
create function plateforme.console_fermer_pendant(p_maintenance uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_motif text := plateforme.exiger_motif_incident(p_motif);
        v_m plateforme.service_maintenance;
begin
  select * into v_m from plateforme.service_maintenance where id = p_maintenance for update;
  if not found or v_m.annulee_le is not null then perform socle.refus('cette maintenance n''est plus annoncée'); end if;
  if v_m.fin <= p_maintenant then perform socle.refus('cette maintenance est finie : il n''y a plus rien à fermer'); end if;
  if exists (select 1 from plateforme.service_fermeture where maintenance = p_maintenance) then
    perform socle.refus('l''application est déjà fermée pendant cette maintenance');
  end if;
  insert into plateforme.service_fermeture (maintenance, posee_le, posee_par) values (p_maintenance, p_maintenant, socle.moi());
  insert into plateforme.geste_console (qui, role, geste, motif, apres)
    values (socle.moi(), v_role, 'service.application_fermee', v_motif, jsonb_build_object('maintenance', p_maintenance, 'debut', v_m.debut, 'fin', v_m.fin));
end $$;

-- Fermer l'application maintenant (une urgence) : une maintenance qui commence tout de suite, fermée.
create function plateforme.console_fermer_maintenant(p_texte text, p_fin timestamptz, p_motif text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_motif text := plateforme.exiger_motif_incident(p_motif); v_id uuid;
begin
  if length(btrim(coalesce(p_texte, ''))) < 3 or length(btrim(p_texte)) > 500 or p_texte ~ '[<>]' then
    perform socle.refus('ce que la page d''état dit de la maintenance : de trois à cinq cents caractères, sans balise');
  end if;
  if p_fin is null or p_fin <= p_maintenant or p_fin > p_maintenant + interval '12 hours' then perform socle.refus('une maintenance dure douze heures au plus'); end if;
  if plateforme.application_fermee(p_maintenant) is not null then perform socle.refus('l''application est déjà fermée : rouvre-la, ou attends la fin de la maintenance'); end if;
  insert into plateforme.service_maintenance (titre, texte, debut, fin, annoncee_le, annoncee_par)
    values ('Maintenance urgente', btrim(p_texte), p_maintenant, p_fin, p_maintenant, socle.moi()) returning id into v_id;
  insert into plateforme.service_fermeture (maintenance, posee_le, posee_par) values (v_id, p_maintenant, socle.moi());
  insert into plateforme.geste_console (qui, role, geste, motif, apres)
    values (socle.moi(), v_role, 'service.application_fermee', v_motif, jsonb_build_object('maintenance', v_id, 'debut', p_maintenant, 'fin', p_fin));
  return v_id;
end $$;

-- Rouvrir : une maintenance fermée, en cours, finit maintenant.
create function plateforme.console_rouvrir(p_maintenance uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_motif text := plateforme.exiger_motif_incident(p_motif);
        v_m plateforme.service_maintenance;
begin
  select * into v_m from plateforme.service_maintenance where id = p_maintenance for update;
  if not found or v_m.annulee_le is not null or v_m.debut > p_maintenant or v_m.fin <= p_maintenant
     or not exists (select 1 from plateforme.service_fermeture where maintenance = p_maintenance and rouverte_le is null) then
    perform socle.refus('l''application n''est pas fermée par cette maintenance en ce moment');
  end if;
  update plateforme.service_fermeture set rouverte_le = p_maintenant, rouverte_par = socle.moi() where maintenance = p_maintenance;
  update plateforme.service_maintenance set fin = greatest(p_maintenant, debut + interval '1 second') where id = p_maintenance;
  insert into plateforme.geste_console (qui, role, geste, motif, avant)
    values (socle.moi(), v_role, 'service.application_rouverte', v_motif, jsonb_build_object('maintenance', p_maintenance, 'fin', v_m.fin));
end $$;

-- Ce que le serveur lit (au plus toutes les cinq secondes) : la fermeture en cours, ou rien. Rien de privé : la page
-- d'état publique dit la même chose.
create function plateforme.application_fermee(p_maintenant timestamptz) returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select jsonb_build_object('maintenance', m.id, 'texte', m.texte, 'fin', m.fin)
    from plateforme.service_maintenance m join plateforme.service_fermeture f on f.maintenance = m.id
   where m.annulee_le is null and f.rouverte_le is null and m.debut <= p_maintenant and m.fin > p_maintenant
   order by m.fin desc limit 1;
$$;

-- La console : les maintenances qui ferment l'application, lues avec les autres (leurs identifiants).
create function plateforme.console_fermetures(p_depuis timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'technique']);
  return (select coalesce(jsonb_agg(f.maintenance), '[]'::jsonb)
            from plateforme.service_fermeture f join plateforme.service_maintenance m on m.id = f.maintenance
           where m.fin >= p_depuis);
end $$;

revoke execute on function plateforme.console_fermer_pendant(uuid, text, timestamptz), plateforme.console_fermer_maintenant(text, timestamptz, text, timestamptz),
  plateforme.console_rouvrir(uuid, text, timestamptz), plateforme.application_fermee(timestamptz), plateforme.console_fermetures(timestamptz) from public;
grant execute on function plateforme.console_fermer_pendant(uuid, text, timestamptz), plateforme.console_fermer_maintenant(text, timestamptz, text, timestamptz),
  plateforme.console_rouvrir(uuid, text, timestamptz), plateforme.application_fermee(timestamptz), plateforme.console_fermetures(timestamptz) to skanfact_app;
