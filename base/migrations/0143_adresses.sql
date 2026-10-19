-- 0143 — Les adresses internet qui frappent à l'entrée : vues, et bloquées (l'audit 1.42.0 § 4 ; docs/console.md C67 ;
-- décidé par délégation le 19/10/2026).
--
-- Jusqu'ici, la console voyait les comptes visés (un mot de passe connu, un compte freiné : l'adresse e-mail), jamais
-- d'où venaient les essais. Le serveur compte désormais, heure par heure et par adresse internet, ce que l'entrée a
-- refusé (un mot de passe ou un code faux) et ce qu'elle a freiné (trop d'appels) ; rien d'autre (ni le compte visé, ni
-- ce qui a été tapé). Une adresse internet est une donnée personnelle : trente jours se gardent, lus par la direction et la
-- technique seules.
--
-- Bloquer une adresse ferme L'ENTRÉE seulement (les routes publiques : se connecter, s'inscrire, un code, un mot de passe
-- oublié) pour une heure ou un jour au plus ; une personne déjà connectée continue. Une adresse peut être celle de tout
-- un bureau ou d'un opérateur mobile (une adresse partagée) : on bloque court, et on le dit à qui bloque.

-- ── 1. Ce que l'entrée a vu, par adresse et par heure ────────────────────────────────────────────────────────────────
create table plateforme.adresse_vue (
  adresse inet not null,
  heure timestamptz not null check (heure = date_trunc('hour', heure)),
  echecs integer not null default 0 check (echecs >= 0),
  freins integer not null default 0 check (freins >= 0),
  primary key (adresse, heure)
);
create index adresse_vue_heure on plateforme.adresse_vue (heure);
alter table plateforme.adresse_vue enable row level security;
alter table plateforme.adresse_vue force row level security;

-- Le serveur note ce qu'il a compté depuis son dernier passage : { "<adresse>": [échecs, freins], … }. Une clé qui n'est
-- pas une adresse internet est ignorée (rien n'entre qui ne soit une adresse). Trente jours se gardent.
create function plateforme.noter_adresses(p_comptes jsonb, p_maintenant timestamptz) returns integer
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare k text; v jsonb; n integer := 0; v_ip inet;
begin
  if socle.moi() is not null then perform socle.refus('seul le serveur compte et applique les adresses de l''entrée'); end if;
  for k, v in select * from jsonb_each(coalesce(p_comptes, '{}'::jsonb)) loop
    begin v_ip := k::inet; exception when others then continue; end;
    if jsonb_typeof(v) <> 'array' then continue; end if;
    insert into plateforme.adresse_vue (adresse, heure, echecs, freins)
      values (host(v_ip)::inet, date_trunc('hour', p_maintenant), greatest(coalesce((v->>0)::integer, 0), 0), greatest(coalesce((v->>1)::integer, 0), 0))
      on conflict (adresse, heure) do update set echecs = plateforme.adresse_vue.echecs + excluded.echecs, freins = plateforme.adresse_vue.freins + excluded.freins;
    n := n + 1;
  end loop;
  delete from plateforme.adresse_vue where heure < p_maintenant - interval '30 days';
  return n;
end $$;

-- ── 2. Les adresses bloquées ─────────────────────────────────────────────────────────────────────────────────────────
create table plateforme.adresse_bloquee (
  id uuid primary key default socle.uuidv7(),
  adresse inet not null,
  le timestamptz not null,
  par uuid not null references socle.utilisateur(id),
  jusqu_au timestamptz not null,
  motif text not null check (length(btrim(motif)) >= 3),
  levee_le timestamptz,
  levee_par uuid references socle.utilisateur(id),
  levee_motif text,
  check (jusqu_au > le and jusqu_au <= le + interval '24 hours'),
  check ((levee_le is null) = (levee_par is null))
);
create index adresse_bloquee_active on plateforme.adresse_bloquee (adresse) where levee_le is null;
alter table plateforme.adresse_bloquee enable row level security;
alter table plateforme.adresse_bloquee force row level security;

-- Ce que le serveur applique : les adresses bloquées en ce moment (il les relit chaque demi-minute, et après un geste).
create function plateforme.adresses_bloquees(p_maintenant timestamptz) returns table (adresse text, jusqu_au timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is not null then perform socle.refus('seul le serveur compte et applique les adresses de l''entrée'); end if;
  return query select host(b.adresse), max(b.jusqu_au) from plateforme.adresse_bloquee b
                where b.levee_le is null and b.jusqu_au > p_maintenant group by b.adresse;
end $$;

-- Bloquer (la direction ou la technique) : une adresse internet, une heure ou un jour, un motif ; jamais la machine
-- elle-même, jamais une adresse déjà bloquée (on la débloque, puis on la rebloque, avec le motif de chaque geste).
create function plateforme.console_bloquer_adresse(p_adresse text, p_heures integer, p_motif text, p_maintenant timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_ip inet; v_id uuid; v_jusqua timestamptz;
begin
  begin v_ip := btrim(coalesce(p_adresse, ''))::inet; exception when others then
    perform socle.refus('ce n''est pas une adresse internet : quatre nombres séparés par des points (IPv4), ou une adresse IPv6');
  end;
  if masklen(v_ip) <> (case family(v_ip) when 4 then 32 else 128 end) then
    perform socle.refus('une adresse seule se bloque, jamais une plage d''adresses');
  end if;
  if v_ip <<= '127.0.0.0/8'::inet or v_ip = '::1'::inet or v_ip = '::ffff:127.0.0.1'::inet then
    perform socle.refus('c''est l''adresse de la machine elle-même : elle ne se bloque pas');
  end if;
  if coalesce(p_heures, 0) not in (1, 24) then perform socle.refus('une adresse se bloque une heure ou un jour'); end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('bloquer une adresse dit pourquoi (trois caractères au moins) : le motif reste au journal de la console'); end if;
  select b.jusqu_au into v_jusqua from plateforme.adresse_bloquee b where b.adresse = v_ip and b.levee_le is null and b.jusqu_au > p_maintenant limit 1;
  if found then perform socle.refus('cette adresse est déjà bloquée : débloque-la d''abord pour changer sa durée'); end if;
  insert into plateforme.adresse_bloquee (adresse, le, par, jusqu_au, motif)
    values (v_ip, p_maintenant, socle.moi(), p_maintenant + make_interval(hours => p_heures), btrim(p_motif)) returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, motif, apres)
    values (socle.moi(), v_role, 'service.adresse_bloquee', btrim(p_motif), jsonb_build_object('adresse', host(v_ip), 'heures', p_heures));
  return jsonb_build_object('id', v_id, 'jusquAu', p_maintenant + make_interval(hours => p_heures));
end $$;

create function plateforme.console_debloquer_adresse(p_id uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_b plateforme.adresse_bloquee;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('débloquer une adresse dit pourquoi (trois caractères au moins) : le motif reste au journal de la console'); end if;
  select * into v_b from plateforme.adresse_bloquee b where b.id = p_id for update;
  if not found then perform socle.refus('ce blocage n''existe pas'); end if;
  if v_b.levee_le is not null or v_b.jusqu_au <= p_maintenant then perform socle.refus('cette adresse n''est plus bloquée'); end if;
  update plateforme.adresse_bloquee set levee_le = p_maintenant, levee_par = socle.moi(), levee_motif = btrim(p_motif) where id = p_id;
  insert into plateforme.geste_console (qui, role, geste, motif, avant)
    values (socle.moi(), v_role, 'service.adresse_debloquee', btrim(p_motif), jsonb_build_object('adresse', host(v_b.adresse), 'jusquAu', v_b.jusqu_au));
end $$;

-- ── 3. Ce que l'écran Sécurité en montre ─────────────────────────────────────────────────────────────────────────────
-- Les vingt adresses qui ont le plus frappé ces vingt-quatre heures (refusées, freinées), et si elles sont bloquées ; les
-- blocages en cours ; ceux des sept derniers jours qui sont finis (levés, ou arrivés à leur fin).
create function plateforme.console_adresses(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']);
begin
  return jsonb_build_object(
    'vues', (select coalesce(jsonb_agg(jsonb_build_object('adresse', host(x.adresse), 'echecs', x.echecs, 'freins', x.freins, 'derniere', x.derniere,
               'bloquee', (select jsonb_build_object('id', b.id, 'jusquAu', b.jusqu_au) from plateforme.adresse_bloquee b
                             where b.adresse = x.adresse and b.levee_le is null and b.jusqu_au > p_maintenant order by b.jusqu_au desc limit 1))
               order by x.echecs + x.freins desc, x.adresse), '[]'::jsonb) from (
               select v.adresse, sum(v.echecs)::int echecs, sum(v.freins)::int freins, max(v.heure) derniere from plateforme.adresse_vue v
                where v.heure >= date_trunc('hour', p_maintenant) - interval '23 hours'
                group by v.adresse order by sum(v.echecs) + sum(v.freins) desc, v.adresse limit 20) x),
    'bloquees', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'adresse', host(b.adresse), 'le', b.le, 'jusquAu', b.jusqu_au, 'motif', b.motif, 'par', u.nom)
                   order by b.jusqu_au), '[]'::jsonb)
                   from plateforme.adresse_bloquee b join socle.utilisateur u on u.id = b.par
                  where b.levee_le is null and b.jusqu_au > p_maintenant),
    'finies', (select coalesce(jsonb_agg(jsonb_build_object('adresse', host(b.adresse), 'le', b.le, 'fin', coalesce(b.levee_le, b.jusqu_au), 'levee', b.levee_le is not null)
                 order by coalesce(b.levee_le, b.jusqu_au) desc), '[]'::jsonb)
                 from (select * from plateforme.adresse_bloquee b where coalesce(b.levee_le, b.jusqu_au) <= p_maintenant
                         and coalesce(b.levee_le, b.jusqu_au) >= p_maintenant - interval '7 days' order by coalesce(b.levee_le, b.jusqu_au) desc limit 10) b));
end $$;

-- ── Les droits ───────────────────────────────────────────────────────────────────────────────────────────────────────
revoke execute on function plateforme.noter_adresses(jsonb, timestamptz), plateforme.adresses_bloquees(timestamptz),
  plateforme.console_bloquer_adresse(text, integer, text, timestamptz), plateforme.console_debloquer_adresse(uuid, text, timestamptz),
  plateforme.console_adresses(timestamptz) from public;
grant execute on function plateforme.noter_adresses(jsonb, timestamptz), plateforme.adresses_bloquees(timestamptz),
  plateforme.console_bloquer_adresse(text, integer, text, timestamptz), plateforme.console_debloquer_adresse(uuid, text, timestamptz),
  plateforme.console_adresses(timestamptz) to skanfact_app;
