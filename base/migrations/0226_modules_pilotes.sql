-- 0226 — Les modules pilotés depuis la console (Skander, 25/11/2026 : « à partir de la console je dois avoir chaque module
-- et je peux mettre bêta dessus ou à venir »).
--
-- Jusqu'ici, « À venir » et « Bêta » se réglaient par deux variables du serveur (SKANFACT_A_VENIR, SKANFACT_BETA) : il
-- fallait toucher au serveur pour ouvrir la caisse. Un état posé ici passe AVANT ces variables, sans nouvelle version :
--   - ouvert  : le module est là, sans pastille ;
--   - beta    : il est là, avec la pastille « Bêta » ;
--   - a_venir : il se voit avec la pastille « À venir », rien ne s'ouvre ;
--   - ferme   : il ne se voit plus (un défaut grave, le temps de le corriger).
-- Un état se pose pour TOUT le serveur (entreprise vide), ou pour UNE entreprise (l'exception passe avant le général) :
-- c'est ce qui ouvre la caisse à la boulangerie pilote avant tout le monde.
--
-- Règles : la direction seule, avec son motif (au journal de la console) ; « Revenir au réglage du serveur » efface la
-- ligne. Le catalogue des modules vit dans le serveur (serveur/modules-pilotes.ts) : la base ne fait que garder l'état.

create table plateforme.module_etat (
  id bigint generated always as identity primary key,
  module text not null check (module ~ '^[a-z]{2,20}$'),
  entreprise uuid references socle.entreprise(id) on delete cascade,
  etat text not null check (etat in ('ouvert', 'beta', 'a_venir', 'ferme')),
  motif text not null check (length(btrim(motif)) between 3 and 500),
  le timestamptz not null,
  par uuid not null references socle.utilisateur(id)
);
create unique index module_etat_un on plateforme.module_etat (module, coalesce(entreprise, '00000000-0000-0000-0000-000000000000'::uuid));
alter table plateforme.module_etat enable row level security;
alter table plateforme.module_etat force row level security;

create function plateforme.console_poser_module(p_module text, p_entreprise uuid, p_etat text, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_avant text;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  perform plateforme.motif_sans_secret(p_motif);
  if p_module !~ '^[a-z]{2,20}$' then perform socle.refus('ce module n''existe pas'); end if;
  if p_etat not in ('ouvert', 'beta', 'a_venir', 'ferme', 'serveur') then perform socle.refus('cet état n''existe pas'); end if;
  if p_entreprise is not null and not exists (select 1 from socle.entreprise where id = p_entreprise) then
    perform socle.refus('cette entreprise n''existe pas');
  end if;
  select etat into v_avant from plateforme.module_etat
   where module = p_module and coalesce(entreprise, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_entreprise, '00000000-0000-0000-0000-000000000000'::uuid)
   for update;
  delete from plateforme.module_etat
   where module = p_module and coalesce(entreprise, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_entreprise, '00000000-0000-0000-0000-000000000000'::uuid);
  if p_etat <> 'serveur' then
    insert into plateforme.module_etat (module, entreprise, etat, motif, le, par) values (p_module, p_entreprise, p_etat, btrim(p_motif), p_maintenant, socle.moi());
  end if;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'modules.etat', p_entreprise, btrim(p_motif),
      jsonb_build_object('module', p_module, 'etat', coalesce(v_avant, 'serveur')), jsonb_build_object('module', p_module, 'etat', p_etat));
end $$;

-- La liste, pour la console (direction et support la lisent) ; `p_entreprise` donne aussi le nom de l'entreprise dont on
-- règle les exceptions (venue de sa fiche).
create function plateforme.console_modules(p_entreprise uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']);
begin
  return jsonb_build_object(
    'poses', coalesce((select jsonb_agg(jsonb_build_object('module', m.module, 'entreprise', m.entreprise, 'nom', e.raison_sociale, 'etat', m.etat,
      'motif', m.motif, 'le', m.le, 'par', (select u.nom from socle.utilisateur u where u.id = m.par)) order by m.module, e.raison_sociale nulls first)
      from plateforme.module_etat m left join socle.entreprise e on e.id = m.entreprise), '[]'::jsonb),
    'entreprise', (select jsonb_build_object('id', e.id, 'nom', e.raison_sociale) from socle.entreprise e where e.id = p_entreprise));
end $$;

-- Ce que voit une personne connectée : l'état général et celui des entreprises qu'elle voit (ses rôles, ou un mandat de
-- son cabinet). Rien d'autre ne sort : ni le motif, ni qui l'a posé.
create function socle.modules_pour_moi() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('module', m.module, 'entreprise', m.entreprise, 'etat', m.etat))
    from plateforme.module_etat m
   where m.entreprise is null
      or cardinality(coalesce(socle.mes_roles(m.entreprise), '{}')) > 0
      or socle.perimetre_cabinet(m.entreprise) is not null), '[]'::jsonb);
end $$;

-- L'état posé d'UN module pour UNE entreprise (le sien, sinon le général ; null : rien de posé, la variable du serveur
-- décide). Pour les gestes que le serveur refuse quand le module n'est pas ouvert : le paiement en ligne (appelé par le
-- client de l'entreprise, qui n'est pas un utilisateur) et la lecture par l'IA. Rien d'autre ne sort.
create function socle.etat_module(p_module text, p_entreprise uuid) returns text
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select coalesce(
    (select etat from plateforme.module_etat where module = p_module and entreprise = p_entreprise),
    (select etat from plateforme.module_etat where module = p_module and entreprise is null));
$$;
revoke execute on function socle.etat_module(text, uuid) from public;
grant execute on function socle.etat_module(text, uuid) to skanfact_app;

revoke execute on function plateforme.console_poser_module(text, uuid, text, text, timestamptz), plateforme.console_modules(uuid), socle.modules_pour_moi() from public;
grant execute on function plateforme.console_poser_module(text, uuid, text, text, timestamptz), plateforme.console_modules(uuid), socle.modules_pour_moi() to skanfact_app;

-- L'espace d'un client (lien sans compte) : le paiement en ligne s'y propose-t-il ? L'état posé du module « paiement »
-- pour l'entreprise du lien (null : rien de posé, la variable du serveur décide). Rien d'autre ne sort.
create function ventes.etat_paiement_espace(p_jeton_empreinte text) returns text
language sql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
  select socle.etat_module('paiement', (ventes.lien_valable(p_jeton_empreinte)).entreprise);
$$;
revoke execute on function ventes.etat_paiement_espace(text) from public;
grant execute on function ventes.etat_paiement_espace(text) to skanfact_app;
