-- 0092 — Les versions du service (Console 3e ; docs/console.md C27 ; skanfact docs/cadrage/10-console.md § 2.8).
-- Le suiveur (exploitation/suivre.ts) installe seul la dernière version vérifiée ; la console le regarde faire et lui
-- donne trois CONSIGNES, qu'il lit dans la base à chaque tour (toutes les deux minutes) :
--   - GELER les installations jusqu'à une date (quatorze jours au plus) : une période sensible, une démonstration, un
--     week-end sans personne de garde. Rien ne s'installe d'ici là, sauf un retour demandé ;
--   - RETENIR une version : elle ne s'installe pas, ni aucune d'avant elle — on attend la suivante ;
--   - REVENIR à une version d'avant : le suiveur l'installe au tour suivant, et la version quittée est retenue (sinon il
--     la réinstallerait aussitôt). La base, elle, ne recule pas : une migration ne se défait pas.
-- Chaque consigne a son motif, et entre au journal ; elle se lève de même. La console lit aussi les migrations passées,
-- et chaque version que la veille a vue tourner (plateforme.service_releve), avec les minutes sans réponse autour de son
-- arrivée.

create table plateforme.service_consigne (
  id uuid primary key default socle.uuidv7(),
  sorte text not null check (sorte in ('gel', 'retenue', 'retour')),
  -- La version retenue, ou celle où revenir ; la version quittée par un retour (retenue tant que le retour tient).
  version text check (version ~ '^[0-9a-f]{40}$'),
  quitte text check (quitte ~ '^[0-9a-f]{40}$'),
  jusqu_au timestamptz,
  motif text not null check (length(btrim(motif)) >= 3),
  qui uuid not null references socle.utilisateur(id),
  le timestamptz not null,
  -- Un retour : quand le suiveur l'a fait, et comment (installée, ou la raison de ne pas l'avoir fait).
  faite_le timestamptz,
  faite_ok boolean,
  faite_raison text check (faite_raison in ('installee', 'inconnue', 'sans_suiveur', 'deja', 'installation', 'démarrage')),
  levee_le timestamptz,
  levee_par uuid references socle.utilisateur(id),
  levee_motif text,
  check ((sorte = 'gel') = (jusqu_au is not null)),
  check ((sorte = 'gel') = (version is null)),
  check ((sorte = 'retour') = (quitte is not null)),
  check (version is null or quitte is null or version <> quitte),
  check ((levee_le is null) = (levee_par is null))
);
alter table plateforme.service_consigne enable row level security;
alter table plateforme.service_consigne force row level security;

-- Une consigne en vigueur : pas levée ; un gel, pas fini ; un retour, pas fait ou fait avec succès (la version quittée
-- reste retenue). Un retour qui a échoué ne retient rien : la version quittée tourne toujours.
create function plateforme.consigne_en_vigueur(c plateforme.service_consigne, p_maintenant timestamptz) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select c.levee_le is null and case c.sorte when 'gel' then c.jusqu_au > p_maintenant
                                             when 'retour' then c.faite_le is null or c.faite_ok
                                             else true end
$$;

-- ── La lecture de la console ─────────────────────────────────────────────────────────────────────────────────────────
create function plateforme.console_service_versions(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'technique']);
begin
  return jsonb_build_object(
    -- Les trente dernières migrations passées sur cette base.
    'migrations', (select coalesce(jsonb_agg(jsonb_build_object('numero', m.numero, 'nom', m.nom, 'le', m.appliquee_le) order by m.numero desc), '[]'::jsonb)
                     from (select * from socle.migration order by numero desc limit 30) m),
    -- Chaque version vue par la veille, d'une suite de relevés à l'autre (un retour fait une seconde suite), sur un an ;
    -- et les minutes sans réponse dans les dix minutes qui ont suivi son arrivée.
    'versions', (select coalesce(jsonb_agg(jsonb_build_object('version', v.version, 'debut', v.debut, 'fin', v.fin,
                    'sansReponse', (select count(*) from plateforme.service_releve r
                                     where r.minute >= v.debut and r.minute < v.debut + interval '10 minutes' and not r.repond))
                    order by v.debut desc), '[]'::jsonb)
                   from (select version, min(minute) debut, max(minute) fin from (
                           select minute, version, row_number() over (order by minute) - row_number() over (partition by version order by minute) suite
                             from plateforme.service_releve where minute >= p_maintenant - interval '366 days' and version is not null) r
                          group by version, suite order by min(minute) desc limit 80) v),
    -- Les consignes en vigueur, puis celles des quatre-vingt-dix derniers jours, avec qui les a posées et levées.
    'consignes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'sorte', c.sorte, 'version', c.version, 'quitte', c.quitte,
                    'jusquAu', c.jusqu_au, 'motif', c.motif, 'par', u.nom, 'le', c.le, 'enVigueur', plateforme.consigne_en_vigueur(c, p_maintenant),
                    'faiteLe', c.faite_le, 'faiteOk', c.faite_ok, 'faiteRaison', c.faite_raison,
                    'leveeLe', c.levee_le, 'leveePar', l.nom, 'leveeMotif', c.levee_motif)
                    order by plateforme.consigne_en_vigueur(c, p_maintenant) desc, c.le desc), '[]'::jsonb)
                    from plateforme.service_consigne c join socle.utilisateur u on u.id = c.qui left join socle.utilisateur l on l.id = c.levee_par
                   where plateforme.consigne_en_vigueur(c, p_maintenant) or c.le >= p_maintenant - interval '90 days'),
    'postgres', current_setting('server_version'));
end $$;

-- ── Les gestes ───────────────────────────────────────────────────────────────────────────────────────────────────────
create function plateforme.console_versions_geler(p_jusqu_au timestamptz, p_motif text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_id uuid; v_gel plateforme.service_consigne;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('geler les installations demande son motif (trois caractères au moins)'); end if;
  if p_jusqu_au is null or p_jusqu_au <= p_maintenant then perform socle.refus('la fin du gel doit venir après maintenant'); end if;
  if p_jusqu_au > p_maintenant + interval '14 days' then perform socle.refus('un gel dure quatorze jours au plus : on le repose s''il le faut'); end if;
  select * into v_gel from plateforme.service_consigne c where c.sorte = 'gel' and plateforme.consigne_en_vigueur(c, p_maintenant) limit 1;
  if found then perform socle.refus('un gel est déjà en cours : lève-le pour en poser un autre'); end if;
  insert into plateforme.service_consigne (sorte, jusqu_au, motif, qui, le) values ('gel', p_jusqu_au, btrim(p_motif), socle.moi(), p_maintenant)
    returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'versions.geler', btrim(p_motif), null, jsonb_build_object('consigne', v_id, 'jusquAu', p_jusqu_au));
  return v_id;
end $$;

create function plateforme.console_versions_retenir(p_version text, p_motif text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_id uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('retenir une version demande son motif (trois caractères au moins)'); end if;
  if coalesce(p_version, '') !~ '^[0-9a-f]{40}$' then perform socle.refus('cette version n''est pas une version du dépôt'); end if;
  if exists (select 1 from plateforme.service_consigne c where c.version = p_version and c.sorte = 'retenue' and plateforme.consigne_en_vigueur(c, p_maintenant)) then
    perform socle.refus('cette version est déjà retenue');
  end if;
  insert into plateforme.service_consigne (sorte, version, motif, qui, le) values ('retenue', p_version, btrim(p_motif), socle.moi(), p_maintenant)
    returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'versions.retenir', btrim(p_motif), null, jsonb_build_object('consigne', v_id, 'version', p_version));
  return v_id;
end $$;

-- Revenir : la version où revenir, et celle qu'on quitte (la console la lit dans l'état du suiveur). Un seul retour à la fois.
create function plateforme.console_versions_revenir(p_version text, p_quitte text, p_motif text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_id uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('revenir en arrière demande son motif (trois caractères au moins)'); end if;
  if coalesce(p_version, '') !~ '^[0-9a-f]{40}$' or coalesce(p_quitte, '') !~ '^[0-9a-f]{40}$' then
    perform socle.refus('cette version n''est pas une version du dépôt');
  end if;
  if p_version = p_quitte then perform socle.refus('c''est la version en service : il n''y a pas à y revenir'); end if;
  if exists (select 1 from plateforme.service_consigne c where c.sorte = 'retour' and c.levee_le is null and c.faite_le is null) then
    perform socle.refus('un retour est déjà demandé : le suiveur le fait à son prochain tour, ou lève-le');
  end if;
  insert into plateforme.service_consigne (sorte, version, quitte, motif, qui, le) values ('retour', p_version, p_quitte, btrim(p_motif), socle.moi(), p_maintenant)
    returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'versions.revenir', btrim(p_motif), jsonb_build_object('version', p_quitte), jsonb_build_object('consigne', v_id, 'version', p_version));
  return v_id;
end $$;

create function plateforme.console_versions_lever(p_id uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_c plateforme.service_consigne;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('lever une consigne demande son motif (trois caractères au moins)'); end if;
  select * into v_c from plateforme.service_consigne c where c.id = p_id for update;
  if not found then perform socle.refus('cette consigne n''existe pas'); end if;
  if not plateforme.consigne_en_vigueur(v_c, p_maintenant) then perform socle.refus('cette consigne n''est plus en vigueur : il n''y a rien à lever'); end if;
  update plateforme.service_consigne set levee_le = p_maintenant, levee_par = socle.moi(), levee_motif = btrim(p_motif) where id = p_id;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'versions.lever', btrim(p_motif),
            jsonb_build_object('consigne', p_id, 'sorte', v_c.sorte, 'version', v_c.version, 'jusquAu', v_c.jusqu_au), jsonb_build_object('levee', p_maintenant));
end $$;

-- ── Ce que le suiveur lit et note (root, par le compte d'administration de la base ; jamais le serveur) ─────────────
create function plateforme.suiveur_consignes() returns jsonb
language sql stable set search_path = pg_catalog, plateforme as $$
  select jsonb_build_object(
    'gel', (select jsonb_build_object('jusquAu', c.jusqu_au, 'motif', c.motif) from plateforme.service_consigne c
             where c.sorte = 'gel' and plateforme.consigne_en_vigueur(c, now()) order by c.jusqu_au desc limit 1),
    'retenues', (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from (
                   select c.version x from plateforme.service_consigne c where c.sorte = 'retenue' and plateforme.consigne_en_vigueur(c, now())
                   union all
                   select c.quitte from plateforme.service_consigne c where c.sorte = 'retour' and plateforme.consigne_en_vigueur(c, now())) r),
    'retour', (select jsonb_build_object('id', c.id, 'version', c.version) from plateforme.service_consigne c
                where c.sorte = 'retour' and c.levee_le is null and c.faite_le is null order by c.le limit 1))
$$;

create function plateforme.suiveur_noter_retour(p_id uuid, p_ok boolean, p_raison text) returns void
language sql volatile set search_path = pg_catalog, plateforme as $$
  update plateforme.service_consigne set faite_le = now(), faite_ok = p_ok, faite_raison = p_raison
   where id = p_id and sorte = 'retour' and faite_le is null and levee_le is null
$$;

revoke execute on function plateforme.consigne_en_vigueur(plateforme.service_consigne, timestamptz),
  plateforme.console_service_versions(timestamptz), plateforme.console_versions_geler(timestamptz, text, timestamptz),
  plateforme.console_versions_retenir(text, text, timestamptz), plateforme.console_versions_revenir(text, text, text, timestamptz),
  plateforme.console_versions_lever(uuid, text, timestamptz), plateforme.suiveur_consignes(), plateforme.suiveur_noter_retour(uuid, boolean, text),
  -- (Celles de la sécurité, 0091, ne l'avaient pas été : la garde du rôle suffisait, une seconde ne coûte rien.)
  plateforme.console_service_securite(timestamptz), plateforme.console_lever_attente(text, text, timestamptz) from public;
grant execute on function plateforme.console_service_versions(timestamptz), plateforme.console_versions_geler(timestamptz, text, timestamptz),
  plateforme.console_versions_retenir(text, text, timestamptz), plateforme.console_versions_revenir(text, text, text, timestamptz),
  plateforme.console_versions_lever(uuid, text, timestamptz),
  plateforme.console_service_securite(timestamptz), plateforme.console_lever_attente(text, text, timestamptz) to skanfact_app;

-- Un point d'incident (0089) : le refus d'une gravité qui descendrait se lit dans la langue de la personne. Écrit par
-- concaténation, il ne se reconnaissait pas au catalogue (textes/base.ts) et partait tel quel ; avec format(), le
-- serveur reconnaît la phrase et rend la gravité comme une valeur.
create or replace function plateforme.console_point_incident(p_incident uuid, p_texte text, p_public boolean, p_gravite text, p_maintenant timestamptz)
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
      perform socle.refus(format('une gravité monte, elle ne descend pas : l''incident reste au moins %s', v_i.gravite));
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
