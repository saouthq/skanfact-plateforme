-- 0228 — Les volontaires de la bêta (pilotage depuis la console, point 2 ; Skander, 25/11/2026 : « une case "je veux
-- essayer les nouveautés" chez le client ; la bêta s'ouvre à eux seuls »).
--
-- Une entreprise se déclare volontaire (Paramètres › L'application › Les nouveautés en avant-première) : la propriétaire
-- ou un administrateur, ni le cabinet ni la console. La console, elle, a un état de plus pour un module :
-- « volontaires » — bêta chez les volontaires (le module s'ouvre, avec la pastille), à venir chez les autres (rien ne
-- s'ouvre ; chez qui y a déjà des données, il reste en pause, la règle de la 1.388.70).
-- Se retirer referme la bêta chez soi tout de suite, sans rien effacer.

alter table socle.entreprise add column volontaire_beta timestamptz;

alter table plateforme.module_etat drop constraint module_etat_etat_check;
alter table plateforme.module_etat add constraint module_etat_etat_check check (etat in ('ouvert', 'beta', 'volontaires', 'a_venir', 'ferme'));

create function socle.poser_volontaire_beta(p_entreprise uuid, p_oui boolean) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_avant timestamptz;
begin
  if not exists (select 1 from socle.membre m where m.entreprise = p_entreprise and m.utilisateur = socle.moi() and m.actif
                  and m.roles && array['proprietaire', 'administrateur']) then
    perform socle.refus('seuls la propriétaire et un administrateur décident d''essayer les nouveautés en avant-première');
  end if;
  select volontaire_beta into v_avant from socle.entreprise where id = p_entreprise for update;
  if (v_avant is not null) = p_oui then return; end if;
  update socle.entreprise set volontaire_beta = case when p_oui then now() end where id = p_entreprise;
  perform socle.tracer(p_entreprise, 'socle.volontaire_beta', 'entreprise', p_entreprise,
    jsonb_build_object('volontaire', v_avant is not null), jsonb_build_object('volontaire', p_oui));
end $$;
revoke execute on function socle.poser_volontaire_beta(uuid, boolean) from public;
grant execute on function socle.poser_volontaire_beta(uuid, boolean) to skanfact_app;

-- La console pose « volontaires » comme les autres états.
create or replace function plateforme.console_poser_module(p_module text, p_entreprise uuid, p_etat text, p_motif text, p_maintenant timestamptz,
  p_message text default null, p_debut timestamptz default null, p_fin timestamptz default null) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_avant plateforme.module_etat;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if not plateforme.suis_titulaire_console() then
    perform socle.refus('seul le titulaire de la console change l''état d''un module');
  end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  perform plateforme.motif_sans_secret(p_motif);
  if v_msg is not null then
    if length(v_msg) not between 3 and 300 then perform socle.refus('le message aux clients tient entre trois et trois cents caractères'); end if;
    perform plateforme.motif_sans_secret(v_msg);
  end if;
  if p_etat = 'serveur' and (v_msg is not null or p_debut is not null or p_fin is not null) then
    perform socle.refus('un message aux clients accompagne un état posé : « revenir au réglage du serveur » efface aussi le message');
  end if;
  if p_module !~ '^[a-z]{2,20}$' then perform socle.refus('ce module n''existe pas'); end if;
  if p_etat not in ('ouvert', 'beta', 'volontaires', 'a_venir', 'ferme', 'serveur') then perform socle.refus('cet état n''existe pas'); end if;
  if p_entreprise is not null and not exists (select 1 from socle.entreprise where id = p_entreprise) then
    perform socle.refus('cette entreprise n''existe pas');
  end if;
  if p_debut is not null and p_debut <= p_maintenant then
    perform socle.refus('le début programmé est déjà passé : choisis « tout de suite »');
  end if;
  if p_fin is not null and p_fin <= coalesce(p_debut, p_maintenant) then
    perform socle.refus('la fin vient après le début');
  end if;
  v_avant := plateforme.module_en_vigueur(p_module, p_entreprise, p_maintenant);
  if p_debut is null then
    delete from plateforme.module_etat
     where module = p_module and entreprise is not distinct from p_entreprise
       and (debut is null or debut <= p_maintenant or (fin is not null and fin <= p_maintenant));
  else
    delete from plateforme.module_etat where module = p_module and entreprise is not distinct from p_entreprise and debut = p_debut;
  end if;
  if p_etat <> 'serveur' then
    insert into plateforme.module_etat (module, entreprise, etat, motif, le, par, message, debut, fin)
      values (p_module, p_entreprise, p_etat, btrim(p_motif), p_maintenant, socle.moi(), v_msg, p_debut, p_fin);
  end if;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'modules.etat', p_entreprise, btrim(p_motif),
      jsonb_build_object('module', p_module, 'etat', coalesce(v_avant.etat, 'serveur'), 'message', v_avant.message),
      jsonb_build_object('module', p_module, 'etat', p_etat, 'message', v_msg, 'debut', p_debut, 'fin', p_fin));
end $$;

-- La garde de la base : « volontaires » vaut « bêta » chez une entreprise volontaire, « à venir » chez les autres.
create or replace function socle.etat_module(p_module text, p_entreprise uuid) returns text
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select case when e = 'volontaires'
              then case when (select volontaire_beta from socle.entreprise where id = p_entreprise) is not null then 'beta' else 'a_venir' end
              else e end
    from (select coalesce((plateforme.module_en_vigueur(p_module, p_entreprise, now())).etat, (plateforme.module_en_vigueur(p_module, null, now())).etat) e) x;
$$;

-- La console compte les volontaires (combien verront un module « volontaires »).
create or replace function plateforme.console_volontaires() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']);
begin
  return jsonb_build_object('n', (select count(*) from socle.entreprise where volontaire_beta is not null),
    'noms', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nom', raison_sociale, 'depuis', volontaire_beta) order by volontaire_beta desc)
      from (select id, raison_sociale, volontaire_beta from socle.entreprise where volontaire_beta is not null order by volontaire_beta desc limit 50) v), '[]'::jsonb));
end $$;
revoke execute on function plateforme.console_volontaires() from public;
grant execute on function plateforme.console_volontaires() to skanfact_app;
