-- 0096 — Le support, seconde partie : l'accès au dossier d'un client (Support S2 ; docs/support.md ; skanfact
-- docs/cadrage/10-console.md § 2.7, 03 § 5, 01 § 18 « acces_support »). Le support de SkanFact ne voit rien du dossier
-- d'un client (S1). Pour l'aider sur ses chiffres, un membre de l'équipe DEMANDE l'accès depuis la console, avec un motif ;
-- le propriétaire ou un administrateur de l'entreprise l'ACCORDE dans son application, pour 48 heures au plus, ou le
-- refuse ; il le RETIRE quand il veut. L'accès est en LECTURE seulement (personne chez SkanFact n'écrit dans les données
-- d'un client, 03 § 5) et ne lit que ce que lit un membre « Lecture » de l'entreprise (le serveur filtre le dossier par
-- ce rôle) ; CHAQUE PAGE LUE est tracée, et l'entreprise voit ces lectures (« Qui a regardé mes données »).
--
-- Rien ici ne passe par la sécurité par ligne du dossier : le support n'entre jamais dans `socle.mes_entreprises()`, il
-- n'a aucun chemin d'écriture. Sa seule lecture est `plateforme.support_dossier`, qui vérifie l'accès à chaque appel
-- (accordé, pas retiré, pas fini, pas échu, à lui) et trace la page.

create table plateforme.acces_support (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  -- Le membre de l'équipe SkanFact qui lira, et lui seul.
  demandeur uuid not null references socle.utilisateur(id),
  -- La demande de support qui l'explique, quand elle existe (une demande de cette entreprise).
  demande uuid references plateforme.demande_support(id),
  motif text not null check (length(btrim(motif)) between 3 and 300 and motif !~ '[<>]'),
  demande_le timestamptz not null,
  -- Accordé : par qui, pour combien d'heures (48 au plus), jusqu'à quand.
  accorde_le timestamptz,
  accorde_par uuid references socle.utilisateur(id),
  heures integer check (heures between 1 and 48),
  fin timestamptz,
  refuse_le timestamptz,
  refuse_par uuid references socle.utilisateur(id),
  -- Retiré par l'entreprise avant sa fin.
  retire_le timestamptz,
  retire_par uuid references socle.utilisateur(id),
  -- Fini du côté du support : sa demande retirée avant réponse, ou l'accès rendu avant sa fin (« J'ai fini »).
  clos_le timestamptz,
  check ((accorde_le is null) = (accorde_par is null) and (accorde_le is null) = (heures is null) and (accorde_le is null) = (fin is null)),
  check (fin is null or fin = accorde_le + make_interval(hours => heures)),
  check ((refuse_le is null) = (refuse_par is null)),
  check ((retire_le is null) = (retire_par is null)),
  check (accorde_le is null or refuse_le is null),
  check (retire_le is null or accorde_le is not null)
);
alter table plateforme.acces_support enable row level security;
alter table plateforme.acces_support force row level security;
create index on plateforme.acces_support (entreprise, demande_le desc);
create index on plateforme.acces_support (demandeur, entreprise);

-- Chaque page lue pendant un accès : son NOM (« factures »), à quel instant. Ni le contenu, ni un identifiant.
create table plateforme.lecture_support (
  id uuid primary key default socle.uuidv7(),
  acces uuid not null references plateforme.acces_support(id),
  page text not null check (page ~ '^[a-z][a-z0-9_-]{0,39}$'),
  lu_le timestamptz not null
);
alter table plateforme.lecture_support enable row level security;
alter table plateforme.lecture_support force row level security;
create index on plateforme.lecture_support (acces, lu_le);

create function plateforme.lecture_support_intouchable() returns trigger
language plpgsql as $$
begin
  raise exception 'une lecture du support ne se modifie pas et ne s''efface pas : c''est la trace que l''entreprise relit' using errcode = '42501';
end $$;
create trigger lecture_support_intouchable before update or delete on plateforme.lecture_support
  for each row execute function plateforme.lecture_support_intouchable();

-- ── Où en est un accès, à un instant ──────────────────────────────────────────────────────────
-- Un fait se garde, l'état se déduit (une fin passée n'a besoin de personne pour fermer l'accès) :
-- refusé, retiré (par l'entreprise), fini (par le support), actif (accordé, avant sa fin), échu, ou demandé.
create function plateforme.acces_support_etat(a plateforme.acces_support, p_maintenant timestamptz) returns text
language sql immutable as $$
  select case
    when a.refuse_le is not null then 'refuse'
    when a.retire_le is not null then 'retire'
    when a.clos_le is not null then 'fini'
    when a.accorde_le is not null and p_maintenant < a.fin then 'actif'
    when a.accorde_le is not null then 'echu'
    else 'demande' end
$$;

-- Un accès, comme les deux côtés le lisent. `equipe` : la console (les noms entiers) ; sinon l'entreprise, qui lit le
-- membre de l'équipe par son prénom (comme les réponses du support).
create function plateforme.acces_support_json(a plateforme.acces_support, p_maintenant timestamptz, p_equipe boolean) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object('id', a.id, 'entreprise', a.entreprise,
    'etat', plateforme.acces_support_etat(a, p_maintenant),
    'demandeur', (select case when p_equipe then u.nom else split_part(btrim(u.nom), ' ', 1) end from socle.utilisateur u where u.id = a.demandeur),
    -- Le mien (la console) : c'est moi qui lirai, ou qui ai demandé.
    'aMoi', a.demandeur = socle.moi(),
    'demande', (select jsonb_build_object('id', d.id, 'numero', d.numero, 'sujet', d.sujet) from plateforme.demande_support d where d.id = a.demande),
    'motif', a.motif, 'demandeLe', a.demande_le, 'heures', a.heures, 'accordeLe', a.accorde_le, 'fin', a.fin,
    'accordePar', (select u.nom from socle.utilisateur u where u.id = a.accorde_par),
    'refuseLe', a.refuse_le, 'refusePar', (select u.nom from socle.utilisateur u where u.id = a.refuse_par),
    'retireLe', a.retire_le, 'retirePar', (select u.nom from socle.utilisateur u where u.id = a.retire_par),
    'closLe', a.clos_le,
    'lectures', (select coalesce(jsonb_agg(jsonb_build_object('page', l.page, 'le', l.lu_le) order by l.lu_le, l.id), '[]'::jsonb)
                   from plateforme.lecture_support l where l.acces = a.id))
$$;

-- ── La console ───────────────────────────────────────────────────────────────────────────────
-- Demander l'accès : un membre de l'équipe (direction, support), avec son motif ; une demande de support de cette
-- entreprise peut l'expliquer. Une seule demande en cours ou un seul accès actif à la fois, par membre et par entreprise.
create function plateforme.console_demander_acces(p_entreprise uuid, p_demande uuid, p_motif text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  v_motif text := btrim(coalesce(p_motif, '')); v_id uuid; v_numero integer;
begin
  if length(v_motif) < 3 or length(v_motif) > 300 then perform socle.refus('demander l''accès dit pourquoi : de trois à trois cents caractères'); end if;
  if v_motif ~ '[<>]' then perform socle.refus('le motif s''écrit sans les signes < ni >'); end if;
  if not exists (select 1 from socle.entreprise e where e.id = p_entreprise) then perform socle.refus('cette entreprise n''existe pas'); end if;
  if p_demande is not null then
    select d.numero into v_numero from plateforme.demande_support d where d.id = p_demande and d.entreprise = p_entreprise;
    if not found then perform socle.refus('cette demande de support n''est pas celle de cette entreprise'); end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('plateforme.acces_support'), hashtext(p_entreprise::text || socle.moi()::text));
  if exists (select 1 from plateforme.acces_support a where a.entreprise = p_entreprise and a.demandeur = socle.moi()
               and plateforme.acces_support_etat(a, p_maintenant) in ('demande', 'actif')) then
    perform socle.refus('tu as déjà une demande en cours ou un accès actif sur ce dossier');
  end if;
  insert into plateforme.acces_support (entreprise, demandeur, demande, motif, demande_le)
    values (p_entreprise, socle.moi(), p_demande, v_motif, p_maintenant) returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.acces_demander', p_entreprise, v_motif, null,
            jsonb_build_object('acces', v_id, 'demande', p_demande, 'numero', v_numero));
  return v_id;
end $$;

-- Rendre l'accès (« J'ai fini ») ou retirer sa demande : celui qui l'a demandé, ou la direction.
create function plateforme.console_clore_acces(p_acces uuid, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']); v plateforme.acces_support; v_etat text;
begin
  select * into v from plateforme.acces_support where id = p_acces for update;
  if not found then perform socle.refus('cet accès n''existe pas'); end if;
  if v.demandeur <> socle.moi() and v_role <> 'direction' then perform socle.refus('seul celui qui l''a demandé, ou la direction, rend cet accès'); end if;
  v_etat := plateforme.acces_support_etat(v, p_maintenant);
  if v_etat not in ('demande', 'actif') then perform socle.refus('cet accès est déjà fermé'); end if;
  update plateforme.acces_support set clos_le = p_maintenant where id = p_acces;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.acces_clore', v.entreprise, v.motif, jsonb_build_object('acces', v.id, 'etat', v_etat), jsonb_build_object('clos', p_maintenant));
end $$;

-- Les accès d'une entreprise, du plus récent au plus ancien, comme la console les lit.
create function plateforme.console_acces_support(p_entreprise uuid, p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(plateforme.acces_support_json(a, p_maintenant, true) order by a.demande_le desc, a.id desc), '[]'::jsonb)
            from plateforme.acces_support a where a.entreprise = p_entreprise);
end $$;

-- L'accès en cours d'un membre de l'équipe : actif, à lui, avec sa session de la console ouverte. Sinon, un refus qui dit
-- pourquoi. Puis la page lue est tracée (une page relue dans la minute ne se trace pas deux fois).
create function plateforme.support_acces_actif(p_acces uuid, p_page text, p_maintenant timestamptz) returns plateforme.acces_support
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v plateforme.acces_support; v_etat text;
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  if p_page is null or p_page !~ '^[a-z][a-z0-9_-]{0,39}$' then perform socle.refus('cette page n''est pas un nom de page'); end if;
  select * into v from plateforme.acces_support where id = p_acces;
  if not found or v.demandeur <> socle.moi() then perform socle.refus('cet accès n''existe pas, ou n''est pas le tien'); end if;
  v_etat := plateforme.acces_support_etat(v, p_maintenant);
  if v_etat = 'demande' then perform socle.refus('l''entreprise n''a pas encore accordé cet accès'); end if;
  if v_etat = 'refuse' then perform socle.refus('l''entreprise a refusé cet accès'); end if;
  if v_etat = 'retire' then perform socle.refus('l''entreprise a retiré cet accès'); end if;
  if v_etat = 'echu' then perform socle.refus('cet accès est fini : ses heures sont passées'); end if;
  if v_etat <> 'actif' then perform socle.refus('cet accès est fermé'); end if;
  if not exists (select 1 from plateforme.lecture_support l where l.acces = v.id and l.page = p_page and l.lu_le > p_maintenant - interval '1 minute') then
    insert into plateforme.lecture_support (acces, page, lu_le) values (v.id, p_page, p_maintenant);
  end if;
  return v;
end $$;

-- Lire le dossier pendant un accès actif : les objets du dossier de la v10, tels qu'ils sont (le serveur les filtre par
-- le rôle « Lecture »), la fin de l'accès et le nom de l'entreprise (celui que la console montre : la bande de la lecture
-- le dit, même quand la fiche société du dossier est vide). La page ouverte est tracée.
create function plateforme.support_dossier(p_acces uuid, p_page text, p_maintenant timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v plateforme.acces_support := plateforme.support_acces_actif(p_acces, p_page, p_maintenant);
begin
  return jsonb_build_object('entreprise', v.entreprise, 'fin', v.fin,
    'nom', (select e.raison_sociale from socle.entreprise e where e.id = v.entreprise),
    'objets', (select coalesce(jsonb_agg(jsonb_build_object('collection', d.collection, 'cle', d.cle, 'rang', d.rang, 'contenu', d.contenu, 'revision', d.revision)
                 order by d.collection <> '_racine', d.collection collate "C", d.rang, d.cle collate "C"), '[]'::jsonb)
                 from socle.dossier_v10 d where d.entreprise = v.entreprise));
end $$;

-- Noter une page lue (l'écran du support le dit à chaque page qu'il ouvre).
create function plateforme.support_noter_page(p_acces uuid, p_page text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.support_acces_actif(p_acces, p_page, p_maintenant);
end $$;

-- ── L'entreprise ─────────────────────────────────────────────────────────────────────────────
-- Le propriétaire ou un administrateur, une personne (jamais une clé de l'API) : eux décident de qui lit l'entreprise.
create function plateforme.acces_support_exiger(p_entreprise uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is null or socle.ma_cle() is not null or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']::text[]) then
    perform socle.refus('l''accès du support se décide par le propriétaire ou un administrateur de l''entreprise');
  end if;
end $$;

-- Les accès de l'entreprise : ceux qui attendent une réponse, ceux qui courent, et les lectures de chacun.
create function plateforme.acces_support_du_client(p_entreprise uuid, p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.acces_support_exiger(p_entreprise);
  return (select coalesce(jsonb_agg(plateforme.acces_support_json(a, p_maintenant, false) order by a.demande_le desc, a.id desc), '[]'::jsonb)
            from plateforme.acces_support a where a.entreprise = p_entreprise);
end $$;

-- Accorder (pour 1 à 48 heures) ou refuser une demande d'accès.
create function plateforme.acces_support_repondre(p_entreprise uuid, p_acces uuid, p_accorder boolean, p_heures integer, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v plateforme.acces_support;
begin
  perform plateforme.acces_support_exiger(p_entreprise);
  select * into v from plateforme.acces_support where id = p_acces and entreprise = p_entreprise for update;
  if not found then perform socle.refus('cette demande d''accès n''existe pas'); end if;
  if plateforme.acces_support_etat(v, p_maintenant) <> 'demande' then perform socle.refus('cette demande d''accès a déjà sa réponse'); end if;
  if p_accorder then
    if p_heures is null or p_heures < 1 or p_heures > 48 then perform socle.refus('un accès s''accorde pour une à quarante-huit heures'); end if;
    update plateforme.acces_support set accorde_le = p_maintenant, accorde_par = socle.moi(), heures = p_heures,
           fin = p_maintenant + make_interval(hours => p_heures) where id = p_acces;
  else
    update plateforme.acces_support set refuse_le = p_maintenant, refuse_par = socle.moi() where id = p_acces;
  end if;
  -- La trace de l'entreprise (03 § 7) : qui a accordé ou refusé, pour combien d'heures. Le motif reste sur l'accès.
  perform socle.tracer(p_entreprise, 'socle.support.autoriser', 'acces_support', p_acces, jsonb_build_object('etat', 'demande'),
    case when p_accorder then jsonb_build_object('etat', 'accorde', 'heures', p_heures) else jsonb_build_object('etat', 'refuse') end);
end $$;

-- Retirer un accès qui court : il se ferme tout de suite, la lecture suivante est refusée.
create function plateforme.acces_support_retirer(p_entreprise uuid, p_acces uuid, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v plateforme.acces_support;
begin
  perform plateforme.acces_support_exiger(p_entreprise);
  select * into v from plateforme.acces_support where id = p_acces and entreprise = p_entreprise for update;
  if not found then perform socle.refus('cet accès n''existe pas'); end if;
  if plateforme.acces_support_etat(v, p_maintenant) <> 'actif' then perform socle.refus('cet accès ne court plus'); end if;
  update plateforme.acces_support set retire_le = p_maintenant, retire_par = socle.moi() where id = p_acces;
  perform socle.tracer(p_entreprise, 'socle.support.autoriser', 'acces_support', p_acces, jsonb_build_object('etat', 'actif', 'fin', v.fin), jsonb_build_object('etat', 'retire'));
end $$;

revoke execute on function plateforme.acces_support_etat(plateforme.acces_support, timestamptz),
  plateforme.acces_support_json(plateforme.acces_support, timestamptz, boolean),
  plateforme.console_demander_acces(uuid, uuid, text, timestamptz), plateforme.console_clore_acces(uuid, timestamptz),
  plateforme.console_acces_support(uuid, timestamptz), plateforme.support_acces_actif(uuid, text, timestamptz),
  plateforme.support_dossier(uuid, text, timestamptz), plateforme.support_noter_page(uuid, text, timestamptz),
  plateforme.acces_support_exiger(uuid), plateforme.acces_support_du_client(uuid, timestamptz),
  plateforme.acces_support_repondre(uuid, uuid, boolean, integer, timestamptz), plateforme.acces_support_retirer(uuid, uuid, timestamptz) from public;
grant execute on function plateforme.console_demander_acces(uuid, uuid, text, timestamptz), plateforme.console_clore_acces(uuid, timestamptz),
  plateforme.console_acces_support(uuid, timestamptz), plateforme.support_dossier(uuid, text, timestamptz),
  plateforme.support_noter_page(uuid, text, timestamptz), plateforme.acces_support_du_client(uuid, timestamptz),
  plateforme.acces_support_repondre(uuid, uuid, boolean, integer, timestamptz), plateforme.acces_support_retirer(uuid, uuid, timestamptz) to skanfact_app;
