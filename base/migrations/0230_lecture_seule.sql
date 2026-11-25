-- 0230 — La lecture seule générale (pilotage depuis la console, point 5 ; Skander, 25/11/2026 : « tout le site en lecture
-- pendant une grosse opération sur la base »).
--
-- Entre « tout ouvert » et « l'application fermée » (0164, une maintenance) : les clients continuent de LIRE tout ce
-- qu'ils ont (leurs pièces, leurs comptes, leurs PDF), mais plus rien ne s'enregistre jusqu'à l'heure dite. Le serveur
-- refuse chaque geste qui écrit, avec une phrase qui dit jusqu'à quand ; l'application pose un bandeau en haut de page.
--
-- Le titulaire de la console seul la pose (tout de suite ou à une heure donnée), avec son motif, au journal ; elle dure
-- douze heures au plus et s'arrête toute seule à sa fin ; il la lève (ou annule une lecture seule prévue) à tout moment.
-- Rien ne tourne en tâche de fond : chaque lecture compare à l'heure du serveur.

create table plateforme.lecture_seule (
  id bigserial primary key,
  -- Ce que voient les clients, en plus de la phrase de l'application (facultatif).
  message text,
  motif text not null,
  debut timestamptz not null,
  fin timestamptz not null,
  posee_le timestamptz not null,
  posee_par uuid not null references socle.utilisateur(id),
  -- Levée (en cours) ou annulée (pas encore commencée) avant sa fin.
  levee_le timestamptz,
  levee_par uuid references socle.utilisateur(id),
  check (fin > debut),
  check ((levee_le is null) = (levee_par is null))
);
alter table plateforme.lecture_seule enable row level security;
alter table plateforme.lecture_seule force row level security;

-- Ce que le serveur lit (au plus toutes les cinq secondes), sans session : la lecture seule en cours, ou rien. Rien de
-- privé : le message est fait pour être lu par tous les clients.
create function plateforme.lecture_seule_en_cours(p_maintenant timestamptz) returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select jsonb_build_object('id', l.id, 'message', l.message, 'fin', l.fin)
    from plateforme.lecture_seule l
   where l.levee_le is null and l.debut <= p_maintenant and l.fin > p_maintenant
   order by l.debut desc limit 1;
$$;

-- La prochaine, annoncée aux clients la veille (24 h avant son début) : le bandeau la dit, rien n'est encore refusé.
create function plateforme.lecture_seule_prevue(p_maintenant timestamptz) returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select jsonb_build_object('id', l.id, 'message', l.message, 'debut', l.debut, 'fin', l.fin)
    from plateforme.lecture_seule l
   where l.levee_le is null and l.debut > p_maintenant and l.debut <= p_maintenant + interval '24 hours'
   order by l.debut limit 1;
$$;

create function plateforme.console_poser_lecture_seule(p_message text, p_debut timestamptz, p_fin timestamptz, p_motif text, p_maintenant timestamptz) returns bigint
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_debut timestamptz := coalesce(p_debut, p_maintenant);
  v_id bigint;
begin
  if not plateforme.suis_titulaire_console() then
    perform socle.refus('seul le titulaire de la console met le site en lecture seule');
  end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  perform plateforme.motif_sans_secret(p_motif);
  if v_msg is not null then
    if length(v_msg) not between 3 and 300 or v_msg ~ '[<>]' then perform socle.refus('le message aux clients tient entre trois et trois cents caractères, sans balise'); end if;
    perform plateforme.motif_sans_secret(v_msg);
  end if;
  if p_debut is not null and p_debut <= p_maintenant then
    perform socle.refus('le début programmé est déjà passé : choisis « tout de suite »');
  end if;
  if p_fin is null or p_fin <= v_debut then perform socle.refus('la fin vient après le début'); end if;
  if p_fin > v_debut + interval '12 hours' then perform socle.refus('une lecture seule dure douze heures au plus'); end if;
  if exists (select 1 from plateforme.lecture_seule where levee_le is null and fin > p_maintenant and debut < p_fin and fin > v_debut) then
    perform socle.refus('une autre lecture seule couvre déjà ce moment : lève-la, ou choisis un autre créneau');
  end if;
  insert into plateforme.lecture_seule (message, motif, debut, fin, posee_le, posee_par)
    values (v_msg, btrim(p_motif), v_debut, p_fin, p_maintenant, socle.moi()) returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, motif, apres)
    values (socle.moi(), v_role, 'service.lecture_seule', btrim(p_motif), jsonb_build_object('id', v_id, 'debut', v_debut, 'fin', p_fin, 'message', v_msg));
  return v_id;
end $$;

-- Lever une lecture seule en cours, ou annuler une lecture seule prévue.
create function plateforme.console_lever_lecture_seule(p_id bigint, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v plateforme.lecture_seule;
begin
  if not plateforme.suis_titulaire_console() then
    perform socle.refus('seul le titulaire de la console met le site en lecture seule');
  end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  perform plateforme.motif_sans_secret(p_motif);
  select * into v from plateforme.lecture_seule where id = p_id for update;
  if v.id is null or v.levee_le is not null or v.fin <= p_maintenant then
    perform socle.refus('cette lecture seule est déjà finie : il n''y a plus rien à lever');
  end if;
  update plateforme.lecture_seule set levee_le = p_maintenant, levee_par = socle.moi() where id = p_id;
  insert into plateforme.geste_console (qui, role, geste, motif, avant)
    values (socle.moi(), v_role, case when v.debut > p_maintenant then 'service.lecture_seule_annulee' else 'service.lecture_seule_levee' end,
      btrim(p_motif), jsonb_build_object('id', v.id, 'debut', v.debut, 'fin', v.fin, 'message', v.message));
end $$;

-- La console : la lecture seule en cours, les prévues, et les dix dernières (levées, annulées ou finies).
create function plateforme.console_lectures_seules(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support', 'technique']);
begin
  return jsonb_build_object(
    'maintenant', p_maintenant,
    'titulaire', plateforme.suis_titulaire_console(),
    'nomTitulaire', (select u.nom from socle.utilisateur u where u.id = plateforme.titulaire_console()),
    'lignes', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'message', l.message, 'motif', l.motif, 'debut', l.debut, 'fin', l.fin,
        'poseeLe', l.posee_le, 'par', (select u.nom from socle.utilisateur u where u.id = l.posee_par),
        'leveeLe', l.levee_le, 'levePar', (select u.nom from socle.utilisateur u where u.id = l.levee_par)) order by l.debut desc)
      from (select * from plateforme.lecture_seule
             where (levee_le is null and fin > p_maintenant)
                or id in (select id from plateforme.lecture_seule order by debut desc limit 10)) l), '[]'::jsonb));
end $$;

revoke execute on function plateforme.lecture_seule_en_cours(timestamptz), plateforme.lecture_seule_prevue(timestamptz),
  plateforme.console_poser_lecture_seule(text, timestamptz, timestamptz, text, timestamptz),
  plateforme.console_lever_lecture_seule(bigint, text, timestamptz), plateforme.console_lectures_seules(timestamptz) from public;
grant execute on function plateforme.lecture_seule_en_cours(timestamptz), plateforme.lecture_seule_prevue(timestamptz),
  plateforme.console_poser_lecture_seule(text, timestamptz, timestamptz, text, timestamptz),
  plateforme.console_lever_lecture_seule(bigint, text, timestamptz), plateforme.console_lectures_seules(timestamptz) to skanfact_app;
