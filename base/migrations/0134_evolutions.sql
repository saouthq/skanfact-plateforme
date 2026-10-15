-- 0134 : les retours des clients et les demandes d'évolution (1.42.0 ; la liste des fonctions qui manquent, 35 :
-- « gestion des retours clients et des demandes d'évolution » ; docs/console.md C58). Version légère : une ÉVOLUTION est
-- une idée nommée (« Exporter les factures en Excel ») ; l'équipe y RATTACHE les demandes au support qui la réclament
-- (une demande, une évolution au plus ; reçue dans l'application ou notée d'un appel, d'un e-mail, d'un WhatsApp). La
-- liste des évolutions se range par le nombre de CLIENTS qui les demandent (deux demandes d'une même entreprise font un
-- client), jamais par le bruit. La direction décide de son état : à étudier, prévue, faite (avec la version qui la
-- livre), écartée (avec la raison) ; la direction et le support créent, rattachent et détachent. Rien n'y nomme un client
-- hors de la console ; la technique ne la lit pas (03 § 5). Chaque geste au journal.

create table plateforme.evolution (
  id uuid primary key default socle.uuidv7(),
  titre text not null check (length(btrim(titre)) between 3 and 120),
  description text check (description is null or length(btrim(description)) <= 2000),
  etat text not null default 'a_etudier' check (etat in ('a_etudier', 'prevue', 'faite', 'ecartee')),
  -- La version qui la livre (faite) ; la raison d'un refus (écartée).
  version text check (version is null or version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  raison text check (raison is null or length(btrim(raison)) between 3 and 400),
  check ((etat = 'faite') = (version is not null)),
  check ((etat = 'ecartee') = (raison is not null)),
  notee_le timestamptz not null,
  notee_par uuid not null references socle.utilisateur(id),
  decidee_le timestamptz,
  decidee_par uuid references socle.utilisateur(id),
  check ((decidee_le is null) = (decidee_par is null))
);
create unique index evolution_titre on plateforme.evolution (lower(btrim(titre)));
alter table plateforme.evolution enable row level security;
alter table plateforme.evolution force row level security;

create table plateforme.evolution_demande (
  demande uuid primary key references plateforme.demande_support(id),
  evolution uuid not null references plateforme.evolution(id),
  le timestamptz not null,
  par uuid not null references socle.utilisateur(id)
);
create index evolution_demande_evolution on plateforme.evolution_demande (evolution);
alter table plateforme.evolution_demande enable row level security;
alter table plateforme.evolution_demande force row level security;

-- Les évolutions, les plus demandées d'abord : le nombre de clients (entreprises distinctes), puis de demandes, puis la
-- plus récente ; chacune avec ses vingt dernières demandes (le numéro, le sujet, le client).
create function plateforme.console_evolutions() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(x.v order by x.clients desc, x.demandes desc, x.derniere desc nulls last, x.titre), '[]'::jsonb) from (
    select lower(e.titre) titre, c.clients, c.demandes, c.derniere, jsonb_build_object(
      'id', e.id, 'titre', e.titre, 'description', e.description, 'etat', e.etat, 'version', e.version, 'raison', e.raison,
      'noteeLe', e.notee_le, 'noteePar', (select u.nom from socle.utilisateur u where u.id = e.notee_par),
      'decideeLe', e.decidee_le, 'decideePar', (select u.nom from socle.utilisateur u where u.id = e.decidee_par),
      'clients', c.clients, 'demandes', c.demandes, 'derniere', c.derniere,
      'liste', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'numero', d.numero, 'sujet', d.sujet, 'ouverteLe', d.ouverte_le,
                  'entreprise', jsonb_build_object('id', s.id, 'nom', s.raison_sociale)) order by d.ouverte_le desc), '[]'::jsonb)
                from (select d2.* from plateforme.evolution_demande l2 join plateforme.demande_support d2 on d2.id = l2.demande
                       where l2.evolution = e.id order by d2.ouverte_le desc limit 20) d join socle.entreprise s on s.id = d.entreprise)) v
      from plateforme.evolution e
      cross join lateral (select count(distinct d.entreprise)::int clients, count(*)::int demandes, max(d.ouverte_le) derniere
                            from plateforme.evolution_demande l join plateforme.demande_support d on d.id = l.demande where l.evolution = e.id) c) x);
end $$;

-- L'évolution qu'une demande réclame (ou rien).
create function plateforme.console_evolution_de(p_demande uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select jsonb_build_object('id', e.id, 'titre', e.titre, 'etat', e.etat, 'version', e.version)
            from plateforme.evolution_demande l join plateforme.evolution e on e.id = l.evolution where l.demande = p_demande);
end $$;

-- Rattacher une demande à une évolution (p_evolution), ou l'en détacher (nul). Une demande, une évolution au plus : la
-- rattacher ailleurs la déplace.
create function plateforme.console_rattacher_evolution(p_demande uuid, p_evolution uuid, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']); d plateforme.demande_support; e plateforme.evolution; avant uuid;
begin
  select * into d from plateforme.demande_support where id = p_demande;
  if not found then perform socle.refus('cette demande n''existe pas'); end if;
  select l.evolution into avant from plateforme.evolution_demande l where l.demande = d.id for update;
  if p_evolution is null then
    if avant is null then return; end if;
    delete from plateforme.evolution_demande where demande = d.id;
    insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
      values (socle.moi(), v_role, 'support.evolution_detachee', d.entreprise, 'demande d''évolution', jsonb_build_object('demande', d.numero,
              'evolution', (select x.titre from plateforme.evolution x where x.id = avant)), null);
    return;
  end if;
  select * into e from plateforme.evolution where id = p_evolution;
  if not found then perform socle.refus('cette évolution n''existe pas'); end if;
  if avant = e.id then return; end if;
  insert into plateforme.evolution_demande (demande, evolution, le, par) values (d.id, e.id, p_maintenant, socle.moi())
    on conflict (demande) do update set evolution = excluded.evolution, le = excluded.le, par = excluded.par;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.evolution_rattachee', d.entreprise, 'demande d''évolution',
            case when avant is null then null else jsonb_build_object('evolution', (select x.titre from plateforme.evolution x where x.id = avant)) end,
            jsonb_build_object('demande', d.numero, 'evolution', e.titre));
end $$;

-- Noter une évolution (son titre, ce qu'elle demande) ; la demande d'où elle vient, s'il y en a une, s'y rattache.
create function plateforme.console_noter_evolution(p_titre text, p_description text, p_demande uuid, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']); v_id uuid;
begin
  if length(btrim(coalesce(p_titre, ''))) not between 3 and 120 then perform socle.refus('le titre d''une évolution : de trois à cent vingt caractères'); end if;
  if p_description is not null and length(btrim(p_description)) > 2000 then perform socle.refus('ce qu''une évolution demande : deux mille caractères au plus'); end if;
  if exists (select 1 from plateforme.evolution e where lower(btrim(e.titre)) = lower(btrim(p_titre))) then
    perform socle.refus('une évolution de ce titre existe déjà : rattache la demande à elle');
  end if;
  insert into plateforme.evolution (titre, description, notee_le, notee_par) values (btrim(p_titre), nullif(btrim(coalesce(p_description, '')), ''), p_maintenant, socle.moi())
    returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.evolution_notee', null, 'demande d''évolution', null, jsonb_build_object('titre', btrim(p_titre)));
  if p_demande is not null then perform plateforme.console_rattacher_evolution(p_demande, v_id, p_maintenant); end if;
  return v_id;
end $$;

-- Décider de son état : la direction seule. « Faite » dit la version qui la livre ; « écartée », pourquoi.
create function plateforme.console_decider_evolution(p_id uuid, p_etat text, p_version text, p_raison text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); e plateforme.evolution;
begin
  select * into e from plateforme.evolution where id = p_id for update;
  if not found then perform socle.refus('cette évolution n''existe pas'); end if;
  if p_etat is null or p_etat not in ('a_etudier', 'prevue', 'faite', 'ecartee') then perform socle.refus('une évolution est à étudier, prévue, faite ou écartée'); end if;
  if p_etat = 'faite' and (p_version is null or p_version !~ '^[0-9]+\.[0-9]+\.[0-9]+$') then
    perform socle.refus('une évolution faite dit la version qui la livre, écrite comme 1.42.0');
  end if;
  if p_etat = 'ecartee' and length(btrim(coalesce(p_raison, ''))) not between 3 and 400 then
    perform socle.refus('une évolution écartée dit pourquoi : de trois à quatre cents caractères');
  end if;
  if e.etat = p_etat and e.version is not distinct from (case when p_etat = 'faite' then p_version end)
     and e.raison is not distinct from (case when p_etat = 'ecartee' then btrim(p_raison) end) then return; end if;
  update plateforme.evolution set etat = p_etat, version = case when p_etat = 'faite' then p_version end,
    raison = case when p_etat = 'ecartee' then btrim(p_raison) end, decidee_le = p_maintenant, decidee_par = socle.moi() where id = e.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.evolution_decidee', null, coalesce(nullif(btrim(coalesce(p_raison, '')), ''), 'décision sur une évolution'),
            jsonb_build_object('titre', e.titre, 'etat', e.etat, 'version', e.version),
            jsonb_build_object('titre', e.titre, 'etat', p_etat, 'version', case when p_etat = 'faite' then p_version end));
end $$;

revoke execute on function plateforme.console_evolutions(), plateforme.console_evolution_de(uuid),
  plateforme.console_rattacher_evolution(uuid, uuid, timestamptz), plateforme.console_noter_evolution(text, text, uuid, timestamptz),
  plateforme.console_decider_evolution(uuid, text, text, text, timestamptz) from public;
grant execute on function plateforme.console_evolutions(), plateforme.console_evolution_de(uuid),
  plateforme.console_rattacher_evolution(uuid, uuid, timestamptz), plateforme.console_noter_evolution(text, text, uuid, timestamptz),
  plateforme.console_decider_evolution(uuid, text, text, text, timestamptz) to skanfact_app;
