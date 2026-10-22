-- 0166 — Les exercices de crise (1.113.0 ; docs/console.md C24 quater). Demandé par Skander le 22/10/2026 : « se préparer
-- à la gestion de crise ». Un incident qu'on n'a jamais joué se joue mal le jour où il arrive : on le joue avant, à blanc.
--
-- Un exercice suit une fiche réflexe (web/console : FICHES), chronométré : quand il a commencé, la minute où chacun des
-- quatre temps de la fiche a été fait (contenir, dire, réparer, écrire), quand il a fini. Il se clôt avec son compte rendu :
-- ce qui a marché, ce qui a coincé, ce qu'on change, et son verdict (réussi, ou à refaire). Il ne touche à rien : ni la page
-- d'état, ni un client, ni un incident ; seule sa ligne au journal de la console.
--
-- Compté pour le lancement (docs/cadrage/09-feuille-de-route.md, J5) : chaque fiche réussie au moins une fois dans
-- l'année. Écrit par la direction et la technique (03 § 5) ; rien d'un client ici.

create table plateforme.exercice_crise (
  id uuid primary key default socle.uuidv7(),
  fiche text not null check (fiche ~ '^[a-z-]{1,40}$'),
  debut timestamptz not null,
  fin timestamptz not null,
  -- Les quatre temps : la minute (depuis le début) où chacun a été fait, ou null s'il ne l'a pas été.
  temps jsonb not null check (jsonb_typeof(temps) = 'array' and jsonb_array_length(temps) = 4),
  participants text not null check (length(btrim(participants)) between 3 and 300),
  marche text not null check (length(btrim(marche)) between 3 and 2000),
  coince text not null check (length(btrim(coince)) between 3 and 2000),
  change text not null check (length(btrim(change)) between 3 and 2000),
  reussi boolean not null,
  par uuid not null references socle.utilisateur(id),
  -- Un exercice dure ; une demi-journée au plus.
  check (fin > debut and fin <= debut + interval '12 hours')
);
create index exercice_crise_fin on plateforme.exercice_crise (fin desc);
alter table plateforme.exercice_crise enable row level security;
alter table plateforme.exercice_crise force row level security;

-- Noter un exercice fini : il finit au moment où on le note (p_maintenant), il a commencé il y a moins de douze heures.
-- Chaque temps fait l'est à une minute entre le début et la fin, dans l'ordre de la fiche ; un exercice ne se dit réussi
-- que si ses quatre temps ont été faits.
create function plateforme.console_noter_exercice(p_fiche text, p_debut timestamptz, p_temps jsonb, p_participants text,
  p_marche text, p_coince text, p_change text, p_reussi boolean, p_maintenant timestamptz)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'technique']);
  v_duree int; v_t jsonb; v_avant int := -1; v_faits int := 0; v_id uuid; v_i int;
begin
  if coalesce(p_fiche, '') !~ '^[a-z-]{1,40}$' then perform socle.refus('cette fiche réflexe n''existe pas'); end if;
  if p_debut is null or p_debut >= p_maintenant or p_debut < p_maintenant - interval '12 hours' then
    perform socle.refus('un exercice se note le jour où il est joué : commencé il y a moins de douze heures');
  end if;
  v_duree := floor(extract(epoch from p_maintenant - p_debut) / 60)::int;
  if p_temps is null or jsonb_typeof(p_temps) <> 'array' or jsonb_array_length(p_temps) <> 4 then
    perform socle.refus('un exercice dit ses quatre temps : contenir, dire, réparer, écrire');
  end if;
  for v_i in 0..3 loop
    v_t := p_temps -> v_i;
    if jsonb_typeof(v_t) = 'null' then continue; end if;
    if jsonb_typeof(v_t) <> 'number' or (v_t #>> '{}')::numeric <> floor((v_t #>> '{}')::numeric)
       or (v_t #>> '{}')::int < 0 or (v_t #>> '{}')::int > v_duree then
      perform socle.refus('chaque temps fait l''est entre le début et la fin de l''exercice, à la minute');
    end if;
    if (v_t #>> '{}')::int < v_avant then perform socle.refus('les temps se font dans l''ordre de la fiche : contenir, dire, réparer, écrire'); end if;
    v_avant := (v_t #>> '{}')::int; v_faits := v_faits + 1;
  end loop;
  if p_reussi and v_faits < 4 then perform socle.refus('un exercice n''est réussi que si ses quatre temps ont été faits'); end if;
  insert into plateforme.exercice_crise (fiche, debut, fin, temps, participants, marche, coince, change, reussi, par)
    values (p_fiche, p_debut, p_maintenant, p_temps, btrim(p_participants), btrim(p_marche), btrim(p_coince), btrim(p_change), p_reussi, socle.moi())
    returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, motif, apres)
    values (socle.moi(), v_role, 'service.exercice_crise', 'exercice : ' || p_fiche,
            jsonb_build_object('exercice', v_id, 'fiche', p_fiche, 'minutes', v_duree, 'reussi', p_reussi));
  return v_id;
end $$;

-- Les exercices de l'année et un peu plus (400 jours : le dernier de chaque fiche, même joué l'an passé à la même date).
create function plateforme.console_exercices_crise(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'technique']);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'fiche', e.fiche, 'debut', e.debut, 'fin', e.fin, 'temps', e.temps,
            'participants', e.participants, 'marche', e.marche, 'coince', e.coince, 'change', e.change, 'reussi', e.reussi, 'par', u.nom)
            order by e.fin desc), '[]'::jsonb)
            from plateforme.exercice_crise e join socle.utilisateur u on u.id = e.par
           where e.fin >= p_maintenant - interval '400 days');
end $$;

revoke execute on function plateforme.console_noter_exercice(text, timestamptz, jsonb, text, text, text, text, boolean, timestamptz),
  plateforme.console_exercices_crise(timestamptz) from public;
grant execute on function plateforme.console_noter_exercice(text, timestamptz, jsonb, text, text, text, text, boolean, timestamptz),
  plateforme.console_exercices_crise(timestamptz) to skanfact_app;
