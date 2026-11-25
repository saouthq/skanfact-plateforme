-- 0229 — L'ouverture progressive (pilotage depuis la console, point 1 ; Skander, 25/11/2026 : « ouvrir un module à 10 %,
-- 50 %, 100 % des entreprises »).
--
-- Un état de plus : « progressif », avec sa part (1 à 99 %). Chaque entreprise a, pour chaque module, un rang STABLE de 0
-- à 99 (`plateforme.rang_module`, tiré de l'empreinte du module et de l'entreprise) : elle a le module en bêta si son rang
-- est sous la part, « à venir » sinon. Monter de 10 à 50 % garde les 10 % du début (le rang ne change jamais) ; les
-- volontaires de la bêta (0228) l'ont toujours. Le même calcul vit dans serveur/modules-pilotes.ts (`rangModule`) :
-- un test les confronte.

alter table plateforme.module_etat add column part smallint check (part is null or part between 1 and 99);
alter table plateforme.module_etat drop constraint module_etat_etat_check;
alter table plateforme.module_etat add constraint module_etat_etat_check check (etat in ('ouvert', 'beta', 'volontaires', 'progressif', 'a_venir', 'ferme'));
alter table plateforme.module_etat add constraint module_etat_part check ((etat = 'progressif') = (part is not null));

create function plateforme.rang_module(p_module text, p_entreprise uuid) returns int
language sql immutable set search_path = pg_catalog as $$
  select (('x' || substr(md5(p_module || ':' || p_entreprise::text), 1, 8))::bit(32)::bigint % 100)::int;
$$;

drop function plateforme.console_poser_module(text, uuid, text, text, timestamptz, text, timestamptz, timestamptz);
create function plateforme.console_poser_module(p_module text, p_entreprise uuid, p_etat text, p_motif text, p_maintenant timestamptz,
  p_message text default null, p_debut timestamptz default null, p_fin timestamptz default null, p_part smallint default null) returns void
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
  if p_etat not in ('ouvert', 'beta', 'volontaires', 'progressif', 'a_venir', 'ferme', 'serveur') then perform socle.refus('cet état n''existe pas'); end if;
  if p_entreprise is not null and not exists (select 1 from socle.entreprise where id = p_entreprise) then
    perform socle.refus('cette entreprise n''existe pas');
  end if;
  if p_etat = 'progressif' and (p_part is null or p_part not between 1 and 99) then
    perform socle.refus('une ouverture progressive s''ouvre à une part des entreprises, entre 1 et 99 %');
  end if;
  if p_etat <> 'progressif' and p_part is not null then perform socle.refus('seule une ouverture progressive porte une part des entreprises'); end if;
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
    insert into plateforme.module_etat (module, entreprise, etat, motif, le, par, message, debut, fin, part)
      values (p_module, p_entreprise, p_etat, btrim(p_motif), p_maintenant, socle.moi(), v_msg, p_debut, p_fin, p_part);
  end if;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'modules.etat', p_entreprise, btrim(p_motif),
      jsonb_build_object('module', p_module, 'etat', coalesce(v_avant.etat, 'serveur'), 'message', v_avant.message, 'part', v_avant.part),
      jsonb_build_object('module', p_module, 'etat', p_etat, 'message', v_msg, 'debut', p_debut, 'fin', p_fin, 'part', p_part));
end $$;
revoke execute on function plateforme.console_poser_module(text, uuid, text, text, timestamptz, text, timestamptz, timestamptz, smallint) from public;
grant execute on function plateforme.console_poser_module(text, uuid, text, text, timestamptz, text, timestamptz, timestamptz, smallint) to skanfact_app;

create or replace function plateforme.console_modules(p_entreprise uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']);
begin
  return jsonb_build_object(
    'maintenant', now(),
    'poses', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'module', m.module, 'entreprise', m.entreprise, 'nom', e.raison_sociale, 'etat', m.etat,
      'motif', m.motif, 'message', m.message, 'le', m.le, 'debut', m.debut, 'fin', m.fin, 'part', m.part, 'par', (select u.nom from socle.utilisateur u where u.id = m.par))
      order by m.module, e.raison_sociale nulls first, coalesce(m.debut, '-infinity'::timestamptz))
      from plateforme.module_etat m left join socle.entreprise e on e.id = m.entreprise
     where m.fin is null or m.fin > now()), '[]'::jsonb),
    'entreprise', (select jsonb_build_object('id', e.id, 'nom', e.raison_sociale) from socle.entreprise e where e.id = p_entreprise),
    'titulaire', plateforme.suis_titulaire_console(),
    'nomTitulaire', (select u.nom from socle.utilisateur u where u.id = plateforme.titulaire_console()),
    'historique', coalesce((select jsonb_agg(h order by h.le desc) from (
      select g.id, g.le, g.geste, g.motif, g.avant, g.apres, g.entreprise, e.raison_sociale nom, u.nom par
        from plateforme.geste_console g
        left join socle.entreprise e on e.id = g.entreprise
        left join socle.utilisateur u on u.id = g.qui
       where g.geste in ('modules.etat', 'modules.annuler') and (p_entreprise is null or g.entreprise = p_entreprise)
       order by g.le desc, g.id desc limit 30) h), '[]'::jsonb));
end $$;

-- Ce que voit une personne connectée : l'état en vigueur, avec sa part.
create or replace function socle.modules_pour_moi() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('module', v.module, 'entreprise', v.entreprise, 'etat', v.etat, 'message', v.message, 'fin', v.fin, 'part', v.part))
    from (select distinct module, entreprise from plateforme.module_etat) k
    cross join lateral plateforme.module_en_vigueur(k.module, k.entreprise, now()) v
   where v.id is not null
     and (v.entreprise is null
      or cardinality(coalesce(socle.mes_roles(v.entreprise), '{}')) > 0
      or socle.perimetre_cabinet(v.entreprise) is not null)), '[]'::jsonb);
end $$;

-- La garde de la base : « volontaires » et « progressif » se résolvent pour l'entreprise.
create or replace function socle.etat_module(p_module text, p_entreprise uuid) returns text
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select case
           when (x.m).etat = 'volontaires' then case when x.vol then 'beta' else 'a_venir' end
           when (x.m).etat = 'progressif' then case when x.vol or plateforme.rang_module(p_module, p_entreprise) < (x.m).part then 'beta' else 'a_venir' end
           else (x.m).etat end
    from (select case when (y.pe).id is not null then y.pe else y.pg end m, y.vol
            from (select plateforme.module_en_vigueur(p_module, p_entreprise, now()) pe, plateforme.module_en_vigueur(p_module, null, now()) pg,
                         (select volontaire_beta from socle.entreprise where id = p_entreprise) is not null vol) y) x;
$$;

-- La console : pour une part donnée, combien d'entreprises auraient le module (les volontaires comptent toujours).
create function plateforme.console_progressif(p_module text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']);
begin
  return (select jsonb_build_object('total', count(*),
      'p10', count(*) filter (where e.volontaire_beta is not null or plateforme.rang_module(p_module, e.id) < 10),
      'p25', count(*) filter (where e.volontaire_beta is not null or plateforme.rang_module(p_module, e.id) < 25),
      'p50', count(*) filter (where e.volontaire_beta is not null or plateforme.rang_module(p_module, e.id) < 50),
      'p75', count(*) filter (where e.volontaire_beta is not null or plateforme.rang_module(p_module, e.id) < 75))
    from socle.entreprise e where not e.essai);
end $$;
revoke execute on function plateforme.console_progressif(text) from public;
grant execute on function plateforme.console_progressif(text) to skanfact_app;
