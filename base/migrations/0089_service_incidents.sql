-- Les incidents du service et la page d'état (Console 3, quatrième partie, 13/10/2026 ; skanfact
-- docs/cadrage/10-console.md § 2.8, 06 § 9 ; docs/console.md C24). Un incident s'ouvre quand des clients risquent de
-- sentir un problème ; il suit les quatre temps d'une fiche (contenir, dire, réparer, écrire) :
--
-- 1. L'incident : son numéro de l'année (INC-2026-001), son titre, sa gravité (mineur, majeur, critique : elle monte en
--    cours de route, jamais elle ne descend), la fiche réflexe qu'il suit, et ce que la page d'état publique en dit tant
--    qu'il est ouvert. Il se clôt avec son compte rendu : l'effet sur les clients, la cause, ce qui change.
-- 2. Ses points : ce qu'on a fait ou appris, dans l'ordre ; un point public remplace ce que dit la page d'état.
-- 3. Ses suites : ce que le compte rendu promet de changer, chacune avec une personne et une date. Un incident n'est
--    vraiment fini que quand ses suites le sont.
-- 4. Les maintenances annoncées : un créneau, ce qui se passe ; la page d'état l'annonce. Une nouvelle version n'en a pas
--    besoin (les deux exemplaires passent l'un après l'autre) : celles-là se lisent dans les relevés de la veille.
--
-- Écrit par la console (direction et technique : 03 § 5, aucune donnée de client ici) ; chaque geste laisse sa ligne au
-- journal. La page d'état publique, écrite par la veille chaque minute, lit l'annonce en cours (plateforme.veille_lire) :
-- elle ne dit jamais un client, une version ni un chemin.

-- ── 1. L'incident ────────────────────────────────────────────────────────────────────────────────────────────────────
create table plateforme.service_incident (
  id uuid primary key default socle.uuidv7(),
  annee smallint not null check (annee between 2026 and 2999),
  numero smallint not null check (numero between 1 and 999),
  titre text not null check (length(btrim(titre)) between 3 and 200),
  gravite text not null check (gravite in ('mineur', 'majeur', 'critique')),
  -- La fiche réflexe suivie (web/console : FICHES), ou aucune.
  fiche text check (fiche ~ '^[a-z-]{1,40}$'),
  ouvert_le timestamptz not null,
  ouvert_par uuid not null references socle.utilisateur(id),
  -- Ce que la page d'état publique dit de lui, et depuis quand ; vide : elle n'en dit rien.
  public text check (length(btrim(public)) between 3 and 500 and public !~ '[<>]'),
  public_le timestamptz,
  -- Le service réparé ; puis le compte rendu, qui clôt l'incident.
  fin timestamptz,
  clos_le timestamptz,
  clos_par uuid references socle.utilisateur(id),
  effet text check (length(btrim(effet)) between 10 and 2000),
  cause text check (length(btrim(cause)) between 10 and 2000),
  change text check (length(btrim(change)) between 10 and 2000),
  unique (annee, numero),
  check ((public is null) = (public_le is null)),
  -- Un incident s'ouvre souvent après le début du problème, et parfois après sa fin : une semaine au plus avant.
  check (fin is null or fin >= ouvert_le - interval '7 days'),
  check ((clos_le is null) = (clos_par is null)),
  check (clos_le is null or (fin is not null and effet is not null and cause is not null and change is not null and public is null))
);
create index service_incident_ouvert on plateforme.service_incident (ouvert_le desc);

-- ── 2. Ses points ────────────────────────────────────────────────────────────────────────────────────────────────────
create table plateforme.service_incident_point (
  id uuid primary key default socle.uuidv7(),
  incident uuid not null references plateforme.service_incident(id),
  le timestamptz not null,
  qui uuid not null references socle.utilisateur(id),
  texte text not null check (length(btrim(texte)) between 3 and 1000),
  public boolean not null default false,
  -- La gravité qui monte avec ce point, s'il la fait monter.
  gravite text check (gravite in ('majeur', 'critique'))
);
create index service_incident_point_incident on plateforme.service_incident_point (incident, le);

-- ── 3. Ses suites ────────────────────────────────────────────────────────────────────────────────────────────────────
create table plateforme.service_suite (
  id uuid primary key default socle.uuidv7(),
  incident uuid not null references plateforme.service_incident(id),
  titre text not null check (length(btrim(titre)) between 3 and 200),
  responsable uuid not null references socle.utilisateur(id),
  due_le date not null,
  faite_le timestamptz,
  faite_par uuid references socle.utilisateur(id),
  repoussee smallint not null default 0 check (repoussee between 0 and 20),
  check ((faite_le is null) = (faite_par is null))
);
create index service_suite_incident on plateforme.service_suite (incident);

-- ── 4. Les maintenances annoncées ────────────────────────────────────────────────────────────────────────────────────
create table plateforme.service_maintenance (
  id uuid primary key default socle.uuidv7(),
  titre text not null check (length(btrim(titre)) between 3 and 200 and titre !~ '[<>]'),
  texte text not null check (length(btrim(texte)) between 3 and 500 and texte !~ '[<>]'),
  debut timestamptz not null,
  fin timestamptz not null,
  annoncee_le timestamptz not null,
  annoncee_par uuid not null references socle.utilisateur(id),
  annulee_le timestamptz,
  annulee_par uuid references socle.utilisateur(id),
  check (fin > debut and fin <= debut + interval '12 hours'),
  check ((annulee_le is null) = (annulee_par is null))
);
create index service_maintenance_debut on plateforme.service_maintenance (debut desc);

alter table plateforme.service_incident enable row level security;
alter table plateforme.service_incident force row level security;
alter table plateforme.service_incident_point enable row level security;
alter table plateforme.service_incident_point force row level security;
alter table plateforme.service_suite enable row level security;
alter table plateforme.service_suite force row level security;
alter table plateforme.service_maintenance enable row level security;
alter table plateforme.service_maintenance force row level security;

-- ── Écrire : la console ──────────────────────────────────────────────────────────────────────────────────────────────
create function plateforme.exiger_motif_incident(p_motif text) returns text
language plpgsql immutable set search_path = pg_catalog, socle as $$
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur un incident demande son motif (trois caractères au moins)'); end if;
  return btrim(p_motif);
end $$;

-- Le rang d'une gravité : elle monte, elle ne descend pas.
create function plateforme.rang_gravite(p text) returns int
language sql immutable as $$ select case p when 'mineur' then 1 when 'majeur' then 2 when 'critique' then 3 end $$;

-- Le numéro d'un incident tel qu'on le cite (INC-2026-006) : le journal le garde à chaque geste.
create function plateforme.ref_incident(p_incident uuid) returns text
language sql stable set search_path = pg_catalog, plateforme as $$
  select format('INC-%s-%s', annee, lpad(numero::text, 3, '0')) from plateforme.service_incident where id = p_incident
$$;

-- Ouvrir un incident : son numéro de l'année, sa gravité, la fiche qu'il suit, et ce que la page d'état en dit (ou rien).
create function plateforme.console_ouvrir_incident(p_titre text, p_gravite text, p_fiche text, p_public text, p_motif text, p_maintenant timestamptz)
returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'technique']);
  v_motif text := plateforme.exiger_motif_incident(p_motif);
  v_annee smallint := extract(year from p_maintenant at time zone 'Africa/Tunis')::smallint;
  v_numero smallint; v_id uuid; v_public text := nullif(btrim(coalesce(p_public, '')), '');
begin
  if length(btrim(coalesce(p_titre, ''))) < 3 then perform socle.refus('un incident a un titre (trois caractères au moins)'); end if;
  if coalesce(p_gravite, '') not in ('mineur', 'majeur', 'critique') then perform socle.refus('la gravité d''un incident : mineur, majeur ou critique'); end if;
  if p_fiche is not null and p_fiche !~ '^[a-z-]{1,40}$' then perform socle.refus('cette fiche réflexe n''existe pas'); end if;
  if v_public is not null and (length(v_public) > 500 or v_public ~ '[<>]') then
    perform socle.refus('le message de la page d''état : 500 caractères au plus, sans balise');
  end if;
  -- Un numéro par incident, sans trou ni doublon : un seul ouvre à la fois.
  lock table plateforme.service_incident in share row exclusive mode;
  select coalesce(max(numero), 0) + 1 into v_numero from plateforme.service_incident where annee = v_annee;
  insert into plateforme.service_incident (annee, numero, titre, gravite, fiche, ouvert_le, ouvert_par, public, public_le)
    values (v_annee, v_numero, btrim(p_titre), p_gravite, p_fiche, p_maintenant, socle.moi(), v_public, case when v_public is null then null else p_maintenant end)
    returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, motif, apres)
    values (socle.moi(), v_role, 'service.incident_ouvert', v_motif,
            jsonb_build_object('incident', v_id, 'ref', format('INC-%s-%s', v_annee, lpad(v_numero::text, 3, '0')), 'gravite', p_gravite));
  return jsonb_build_object('id', v_id, 'annee', v_annee, 'numero', v_numero);
end $$;

-- Un point : ce qu'on a fait ou appris. Public, il remplace ce que dit la page d'état. Il peut faire monter la gravité,
-- jamais la faire descendre (le refus le dit).
create function plateforme.console_point_incident(p_incident uuid, p_texte text, p_public boolean, p_gravite text, p_maintenant timestamptz)
returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'technique']);
  v_i plateforme.service_incident; v_texte text := btrim(coalesce(p_texte, '')); v_monte text;
begin
  if length(v_texte) < 3 or length(v_texte) > 1000 then perform socle.refus('un point d''incident : de trois à mille caractères'); end if;
  select * into v_i from plateforme.service_incident where id = p_incident for update;
  if not found then perform socle.refus('cet incident n''existe pas'); end if;
  if v_i.clos_le is not null then perform socle.refus('cet incident est clos : son compte rendu est écrit'); end if;
  if p_gravite is not null then
    if p_gravite not in ('mineur', 'majeur', 'critique') then perform socle.refus('la gravité d''un incident : mineur, majeur ou critique'); end if;
    if plateforme.rang_gravite(p_gravite) < plateforme.rang_gravite(v_i.gravite) then
      perform socle.refus('une gravité monte, elle ne descend pas : l''incident reste au moins ' || v_i.gravite);
    end if;
    if plateforme.rang_gravite(p_gravite) > plateforme.rang_gravite(v_i.gravite) then v_monte := p_gravite; end if;
  end if;
  if coalesce(p_public, false) and (length(v_texte) > 500 or v_texte ~ '[<>]') then
    perform socle.refus('le message de la page d''état : 500 caractères au plus, sans balise');
  end if;
  insert into plateforme.service_incident_point (incident, le, qui, texte, public, gravite)
    values (p_incident, p_maintenant, socle.moi(), v_texte, coalesce(p_public, false), v_monte);
  update plateforme.service_incident set gravite = coalesce(v_monte, gravite),
         public = case when coalesce(p_public, false) then v_texte else public end,
         public_le = case when coalesce(p_public, false) then p_maintenant else public_le end
   where id = p_incident;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'service.incident_point', v_texte, jsonb_build_object('incident', p_incident, 'gravite', v_i.gravite),
            jsonb_build_object('incident', p_incident, 'ref', plateforme.ref_incident(p_incident), 'gravite', coalesce(v_monte, v_i.gravite), 'public', coalesce(p_public, false)));
end $$;

-- Retirer le message de la page d'état (l'incident reste ouvert).
create function plateforme.console_retirer_public(p_incident uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_motif text := plateforme.exiger_motif_incident(p_motif);
        v_i plateforme.service_incident;
begin
  select * into v_i from plateforme.service_incident where id = p_incident for update;
  if not found then perform socle.refus('cet incident n''existe pas'); end if;
  if v_i.public is null then perform socle.refus('la page d''état ne dit rien de cet incident'); end if;
  update plateforme.service_incident set public = null, public_le = null where id = p_incident;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'service.incident_public_retire', v_motif, jsonb_build_object('incident', p_incident, 'public', v_i.public),
            jsonb_build_object('incident', p_incident, 'ref', plateforme.ref_incident(p_incident), 'le', p_maintenant));
end $$;

-- Clore : la fin du problème, le compte rendu (l'effet sur les clients, la cause, ce qui change) et ses suites, chacune
-- avec une personne de l'équipe et une date. La page d'état cesse d'en parler.
create function plateforme.console_clore_incident(p_incident uuid, p_fin timestamptz, p_effet text, p_cause text, p_change text, p_suites jsonb,
                                                  p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'technique']);
  v_motif text := plateforme.exiger_motif_incident(p_motif);
  v_i plateforme.service_incident; s jsonb; v_resp uuid; v_due date;
begin
  select * into v_i from plateforme.service_incident where id = p_incident for update;
  if not found then perform socle.refus('cet incident n''existe pas'); end if;
  if v_i.clos_le is not null then perform socle.refus('cet incident est déjà clos'); end if;
  if p_fin is null or p_fin < v_i.ouvert_le - interval '7 days' or p_fin > p_maintenant then
    perform socle.refus('la fin du problème : passée, et pas plus d''une semaine avant l''ouverture de l''incident');
  end if;
  if length(btrim(coalesce(p_effet, ''))) < 10 then perform socle.refus('le compte rendu dit l''effet sur les clients (dix caractères au moins)'); end if;
  if length(btrim(coalesce(p_cause, ''))) < 10 then perform socle.refus('le compte rendu dit la cause (dix caractères au moins)'); end if;
  if length(btrim(coalesce(p_change, ''))) < 10 then perform socle.refus('le compte rendu dit ce qui change pour que ça n''arrive plus (dix caractères au moins)'); end if;
  if jsonb_typeof(coalesce(p_suites, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_suites, '[]'::jsonb)) > 20 then
    perform socle.refus('vingt suites au plus');
  end if;
  for s in select * from jsonb_array_elements(coalesce(p_suites, '[]'::jsonb)) loop
    if length(btrim(coalesce(s->>'titre', ''))) < 3 then perform socle.refus('chaque suite a un titre (trois caractères au moins)'); end if;
    select e.utilisateur into v_resp from plateforme.equipe e where e.actif and e.utilisateur::text = s->>'responsable';
    if v_resp is null then perform socle.refus('chaque suite a une personne de l''équipe'); end if;
    begin v_due := (s->>'due')::date; exception when others then v_due := null; end;
    if v_due is null or v_due < (p_maintenant at time zone 'Africa/Tunis')::date then perform socle.refus('chaque suite a une date, aujourd''hui ou plus tard'); end if;
    insert into plateforme.service_suite (incident, titre, responsable, due_le) values (p_incident, btrim(s->>'titre'), v_resp, v_due);
  end loop;
  update plateforme.service_incident set fin = p_fin, clos_le = p_maintenant, clos_par = socle.moi(), effet = btrim(p_effet), cause = btrim(p_cause),
         change = btrim(p_change), public = null, public_le = null
   where id = p_incident;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'service.incident_clos', v_motif, jsonb_build_object('incident', p_incident),
            jsonb_build_object('incident', p_incident, 'ref', plateforme.ref_incident(p_incident), 'fin', p_fin, 'suites', jsonb_array_length(coalesce(p_suites, '[]'::jsonb))));
end $$;

-- Une suite faite.
create function plateforme.console_suite_faite(p_suite uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_motif text := plateforme.exiger_motif_incident(p_motif);
        v_s plateforme.service_suite;
begin
  select * into v_s from plateforme.service_suite where id = p_suite for update;
  if not found then perform socle.refus('cette suite n''existe pas'); end if;
  if v_s.faite_le is not null then perform socle.refus('cette suite est déjà faite'); end if;
  update plateforme.service_suite set faite_le = p_maintenant, faite_par = socle.moi() where id = p_suite;
  insert into plateforme.geste_console (qui, role, geste, motif, apres)
    values (socle.moi(), v_role, 'service.suite_faite', v_motif, jsonb_build_object('suite', p_suite, 'incident', v_s.incident, 'ref', plateforme.ref_incident(v_s.incident), 'titre', v_s.titre));
end $$;

-- Repousser une suite : une date plus tard, et le motif. Le compte des reports se garde.
create function plateforme.console_repousser_suite(p_suite uuid, p_due date, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_motif text := plateforme.exiger_motif_incident(p_motif);
        v_s plateforme.service_suite;
begin
  select * into v_s from plateforme.service_suite where id = p_suite for update;
  if not found then perform socle.refus('cette suite n''existe pas'); end if;
  if v_s.faite_le is not null then perform socle.refus('cette suite est déjà faite'); end if;
  if p_due is null or p_due <= v_s.due_le or p_due < (p_maintenant at time zone 'Africa/Tunis')::date then
    perform socle.refus('une suite se repousse à une date plus tard que celle qu''elle avait, et pas dans le passé');
  end if;
  if v_s.repoussee >= 20 then perform socle.refus('cette suite a été repoussée trop de fois : elle se refait'); end if;
  update plateforme.service_suite set due_le = p_due, repoussee = repoussee + 1 where id = p_suite;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'service.suite_repoussee', v_motif, jsonb_build_object('suite', p_suite, 'due', v_s.due_le),
            jsonb_build_object('suite', p_suite, 'ref', plateforme.ref_incident(v_s.incident), 'titre', v_s.titre, 'due', p_due));
end $$;

-- Annoncer une maintenance : un créneau futur de douze heures au plus, ce qui se passe. La page d'état l'annonce
-- quarante-huit heures avant, puis pendant.
create function plateforme.console_annoncer_maintenance(p_titre text, p_texte text, p_debut timestamptz, p_fin timestamptz, p_motif text, p_maintenant timestamptz)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_motif text := plateforme.exiger_motif_incident(p_motif); v_id uuid;
begin
  if length(btrim(coalesce(p_titre, ''))) < 3 or p_titre ~ '[<>]' then perform socle.refus('une maintenance a un titre (trois caractères au moins, sans balise)'); end if;
  if length(btrim(coalesce(p_texte, ''))) < 3 or length(btrim(p_texte)) > 500 or p_texte ~ '[<>]' then
    perform socle.refus('ce que la page d''état dit de la maintenance : de trois à cinq cents caractères, sans balise');
  end if;
  if p_debut is null or p_fin is null or p_debut <= p_maintenant then perform socle.refus('une maintenance s''annonce avant de commencer'); end if;
  if p_fin <= p_debut or p_fin > p_debut + interval '12 hours' then perform socle.refus('une maintenance dure douze heures au plus'); end if;
  insert into plateforme.service_maintenance (titre, texte, debut, fin, annoncee_le, annoncee_par)
    values (btrim(p_titre), btrim(p_texte), p_debut, p_fin, p_maintenant, socle.moi()) returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, motif, apres)
    values (socle.moi(), v_role, 'service.maintenance_annoncee', v_motif, jsonb_build_object('maintenance', v_id, 'debut', p_debut, 'fin', p_fin));
  return v_id;
end $$;

-- Annuler une maintenance qui n'a pas commencé.
create function plateforme.console_annuler_maintenance(p_maintenance uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_motif text := plateforme.exiger_motif_incident(p_motif);
        v_m plateforme.service_maintenance;
begin
  select * into v_m from plateforme.service_maintenance where id = p_maintenance for update;
  if not found or v_m.annulee_le is not null then perform socle.refus('cette maintenance n''est plus annoncée'); end if;
  if v_m.debut <= p_maintenant then perform socle.refus('cette maintenance a commencé : elle ne s''annule plus'); end if;
  update plateforme.service_maintenance set annulee_le = p_maintenant, annulee_par = socle.moi() where id = p_maintenance;
  insert into plateforme.geste_console (qui, role, geste, motif, avant)
    values (socle.moi(), v_role, 'service.maintenance_annulee', v_motif, jsonb_build_object('maintenance', p_maintenance, 'debut', v_m.debut));
end $$;

-- ── Lire : la console ────────────────────────────────────────────────────────────────────────────────────────────────
-- Les incidents (ouverts, et clos depuis 400 jours) avec leurs points et leurs suites ; les maintenances (depuis 60 jours,
-- et à venir) ; l'équipe à qui confier une suite.
create function plateforme.console_service_incidents(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'technique']);
  return jsonb_build_object(
    'incidents', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'annee', i.annee, 'numero', i.numero, 'titre', i.titre, 'gravite', i.gravite,
                    'fiche', i.fiche, 'ouvertLe', i.ouvert_le, 'ouvertPar', o.nom, 'public', i.public, 'publicLe', i.public_le, 'fin', i.fin,
                    'closLe', i.clos_le, 'closPar', c.nom, 'effet', i.effet, 'cause', i.cause, 'change', i.change,
                    'points', (select coalesce(jsonb_agg(jsonb_build_object('le', p.le, 'par', u.nom, 'texte', p.texte, 'public', p.public, 'gravite', p.gravite)
                                 order by p.le), '[]'::jsonb)
                                 from plateforme.service_incident_point p join socle.utilisateur u on u.id = p.qui where p.incident = i.id),
                    'suites', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'titre', s.titre, 'responsable', r.nom, 'due', s.due_le,
                                 'faiteLe', s.faite_le, 'repoussee', s.repoussee) order by s.due_le, s.id), '[]'::jsonb)
                                 from plateforme.service_suite s join socle.utilisateur r on r.id = s.responsable where s.incident = i.id))
                  order by i.ouvert_le desc), '[]'::jsonb)
                  from plateforme.service_incident i join socle.utilisateur o on o.id = i.ouvert_par left join socle.utilisateur c on c.id = i.clos_par
                 where i.clos_le is null or i.clos_le >= p_maintenant - interval '400 days'),
    'maintenances', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'titre', m.titre, 'texte', m.texte, 'debut', m.debut, 'fin', m.fin,
                       'par', u.nom, 'annuleeLe', m.annulee_le) order by m.debut desc), '[]'::jsonb)
                       from plateforme.service_maintenance m join socle.utilisateur u on u.id = m.annoncee_par
                      where m.fin >= p_maintenant - interval '60 days'),
    'equipe', (select coalesce(jsonb_agg(jsonb_build_object('id', e.utilisateur, 'nom', u.nom) order by u.nom), '[]'::jsonb)
                 from plateforme.equipe e join socle.utilisateur u on u.id = e.utilisateur
                where e.actif and e.role in ('direction', 'technique')));
end $$;

-- ── Lire : la veille ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Ce que la veille lisait (0086), avec l'annonce de la page d'état : l'incident ouvert le plus grave qui a un message
-- public (le plus récent à gravité égale), et la maintenance en cours ou qui commence dans les quarante-huit heures. Rien
-- d'un client : la page le dit tel quel.
create or replace function plateforme.veille_lire(p_maintenant timestamptz, p_minutes int) returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select jsonb_build_object(
    'sourdines', (select coalesce(jsonb_agg(jsonb_build_object('regle', s.regle, 'debut', s.debut, 'fin', s.fin) order by s.debut), '[]'::jsonb)
                    from plateforme.service_sourdine s where s.levee_le is null and s.debut <= p_maintenant and s.fin > p_maintenant),
    'demandes', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'sorte', d.sorte) order by d.le), '[]'::jsonb)
                   from plateforme.service_demande d where d.faite_le is null),
    'minutes', (select coalesce(jsonb_agg(jsonb_build_array(m.minute, m.n, m.pannes, m.lecture) order by m.minute), '[]'::jsonb) from (
                  select minute, sum(n)::int n, sum(pannes)::int pannes, plateforme.somme_seaux(seaux) filter (where sorte = 'lecture') lecture
                    from plateforme.service_minute
                   where minute >= date_trunc('minute', p_maintenant) - make_interval(mins => least(greatest(p_minutes, 1), 60))
                     and minute < date_trunc('minute', p_maintenant)
                   group by minute) m),
    'annonce', jsonb_build_object(
      'incident', (select jsonb_build_object('gravite', i.gravite, 'texte', i.public, 'le', i.public_le, 'depuis', i.ouvert_le)
                     from plateforme.service_incident i where i.clos_le is null and i.public is not null
                    order by plateforme.rang_gravite(i.gravite) desc, i.public_le desc limit 1),
      'maintenance', (select jsonb_build_object('titre', m.titre, 'texte', m.texte, 'debut', m.debut, 'fin', m.fin)
                        from plateforme.service_maintenance m
                       where m.annulee_le is null and m.fin > p_maintenant and m.debut <= p_maintenant + interval '48 hours'
                       order by m.debut limit 1)));
$$;

revoke execute on function plateforme.exiger_motif_incident(text), plateforme.rang_gravite(text), plateforme.ref_incident(uuid),
  plateforme.console_ouvrir_incident(text, text, text, text, text, timestamptz),
  plateforme.console_point_incident(uuid, text, boolean, text, timestamptz),
  plateforme.console_retirer_public(uuid, text, timestamptz),
  plateforme.console_clore_incident(uuid, timestamptz, text, text, text, jsonb, text, timestamptz),
  plateforme.console_suite_faite(uuid, text, timestamptz), plateforme.console_repousser_suite(uuid, date, text, timestamptz),
  plateforme.console_annoncer_maintenance(text, text, timestamptz, timestamptz, text, timestamptz),
  plateforme.console_annuler_maintenance(uuid, text, timestamptz), plateforme.console_service_incidents(timestamptz) from public;
grant execute on function plateforme.console_ouvrir_incident(text, text, text, text, text, timestamptz),
  plateforme.console_point_incident(uuid, text, boolean, text, timestamptz),
  plateforme.console_retirer_public(uuid, text, timestamptz),
  plateforme.console_clore_incident(uuid, timestamptz, text, text, text, jsonb, text, timestamptz),
  plateforme.console_suite_faite(uuid, text, timestamptz), plateforme.console_repousser_suite(uuid, date, text, timestamptz),
  plateforme.console_annoncer_maintenance(text, text, timestamptz, timestamptz, text, timestamptz),
  plateforme.console_annuler_maintenance(uuid, text, timestamptz), plateforme.console_service_incidents(timestamptz) to skanfact_app;
