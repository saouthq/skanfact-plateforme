-- 0139 : la communication ciblée, et le suivi de sa diffusion (1.47.0 ; la liste des fonctions qui manquent, 37 :
-- « communication ciblée aux clients, avec suivi de diffusion » ; docs/console.md C63 ; décidé par délégation le
-- 16/10/2026). Le message aux clients (0093, C28) reste UN à la fois — un nouveau remplace celui qui s'affichait, quel que
-- soit son public — et :
--   - il s'adresse à TOUS, ou à un PUBLIC choisi par l'état de leur abonnement : en essai, Essentiel, Complet, en retard
--     de paiement, en lecture seule. Une entreprise est de chaque public qui la décrit (un abonné Complet en retard est
--     des deux) ; le serveur compare (serveur/console/diffusion.ts), l'entreprise ne reçoit que le message qui la vise ;
--   - sa DIFFUSION se suit : l'application dit qu'elle l'a montré, puis qu'on l'a caché (« Plus tard »). La liste comptée
--     et décidée de ce qui part de l'application : le message et l'entreprise (celle de la page), et s'il est caché ; la
--     base y ajoute l'instant. Jamais la personne, l'appareil ni l'adresse ; seul le premier instant de chacun compte ; une
--     entreprise d'exemple ne compte pas, ni un message qui ne s'affiche plus ce jour-là.
-- La console lit, pour chaque message, combien d'entreprises l'ont vu, et caché ; la direction pose le public.

alter table plateforme.message_clients add column cible text[] not null default '{}'
  check (cible <@ array['essai', 'essentiel', 'complet', 'en_retard', 'lecture_seule']::text[]);

create table plateforme.message_diffusion (
  message uuid not null references plateforme.message_clients(id),
  entreprise uuid not null references socle.entreprise(id),
  vu_le timestamptz not null,
  cache_le timestamptz,
  primary key (message, entreprise),
  check (cache_le is null or cache_le >= vu_le)
);
alter table plateforme.message_diffusion enable row level security;
alter table plateforme.message_diffusion force row level security;

-- Poser le public du message qu'on vient d'écrire (la route l'appelle dans la transaction de console_ecrire_message) : la
-- direction, son propre message, encore à paraître ou affiché, sans public encore posé. Vide : tous (rien à poser). Au
-- journal, avec le motif du message.
create function plateforme.console_cibler_message(p_id uuid, p_cible text[], p_motif text, p_jour date) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); m plateforme.message_clients;
  v_cible text[] := array(select distinct x from unnest(coalesce(p_cible, '{}')) x order by x);
begin
  if not v_cible <@ array['essai', 'essentiel', 'complet', 'en_retard', 'lecture_seule']::text[] then
    perform socle.refus('un message vise tous les clients, ou ceux en essai, Essentiel, Complet, en retard de paiement ou en lecture seule');
  end if;
  select * into m from plateforme.message_clients where id = p_id for update;
  if not found then perform socle.refus('ce message n''existe pas'); end if;
  if m.qui <> socle.moi() or not plateforme.message_en_cours(m, p_jour) or cardinality(m.cible) > 0 then
    perform socle.refus('le public d''un message se choisit en l''écrivant');
  end if;
  if cardinality(v_cible) = 0 then return; end if;
  update plateforme.message_clients set cible = v_cible where id = p_id;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.message_cible', btrim(p_motif), null, jsonb_build_object('message', p_id, 'cible', to_jsonb(v_cible)));
end $$;

-- L'application : le public du message du jour, pour que le serveur le compare à l'entreprise de la page.
create function plateforme.cible_du_message(p_id uuid) returns text[]
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select m.cible from plateforme.message_clients m where m.id = p_id
$$;

-- L'application : le message montré (p_cache faux), puis caché. L'entreprise est l'une de celles de la personne (sinon
-- rien) ; un message qui ne s'affiche pas ce jour-là, ou une entreprise d'exemple, ne se note pas. Le premier instant
-- seul compte : vu une fois, caché une fois.
create function plateforme.noter_diffusion(p_message uuid, p_entreprise uuid, p_cache boolean, p_maintenant timestamptz, p_jour date) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if p_entreprise is null or p_entreprise not in (select socle.mes_entreprises()) then return false; end if;
  if exists (select 1 from socle.entreprise e where e.id = p_entreprise and e.essai) then return false; end if;
  if not exists (select 1 from plateforme.message_clients m where m.id = p_message and m.retire_le is null and m.du <= p_jour and m.au >= p_jour) then
    return false;
  end if;
  insert into plateforme.message_diffusion (message, entreprise, vu_le, cache_le)
    values (p_message, p_entreprise, p_maintenant, case when p_cache then p_maintenant end)
  on conflict (message, entreprise) do update set cache_le = coalesce(plateforme.message_diffusion.cache_le, excluded.cache_le);
  return true;
end $$;

-- La console : pour chaque message écrit ces quatre-vingt-dix derniers jours, son public, et combien d'entreprises l'ont
-- vu, et caché.
create function plateforme.console_diffusion_messages(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'cible', to_jsonb(m.cible),
      'vus', (select count(*) from plateforme.message_diffusion d where d.message = m.id),
      'caches', (select count(*) from plateforme.message_diffusion d where d.message = m.id and d.cache_le is not null))
      order by m.le desc, m.id desc), '[]'::jsonb)
    from plateforme.message_clients m where m.le > p_jour - interval '90 days');
end $$;

revoke execute on function plateforme.console_cibler_message(uuid, text[], text, date), plateforme.cible_du_message(uuid),
  plateforme.noter_diffusion(uuid, uuid, boolean, timestamptz, date), plateforme.console_diffusion_messages(date) from public;
grant execute on function plateforme.console_cibler_message(uuid, text[], text, date), plateforme.cible_du_message(uuid),
  plateforme.noter_diffusion(uuid, uuid, boolean, timestamptz, date), plateforme.console_diffusion_messages(date) to skanfact_app;
