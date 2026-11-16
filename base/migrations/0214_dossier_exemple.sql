-- Le dossier d'exemple d'un cabinet (1.370.0). Un comptable qui essaie SkanFact Cabinet n'a, le premier jour, aucun
-- client à ouvrir : la plupart des cabinets n'auront aucun client sur SkanFact, et un écran vide ne montre rien de ce
-- que l'outil sait faire. Un associé charge UN dossier d'exemple dans son propre cabinet : un dossier tenu comme un
-- autre (ses livres, sa paie, sa banque), que le serveur seul marque « exemple ».
--   - il ne compte jamais dans l'abonnement (ni gratuit, ni payant), et ne fixe pas son anniversaire ;
--   - un seul à la fois par cabinet ; il se retire d'un geste, livres compris (un dossier tenu ordinaire qui a des
--     écritures ne se retire pas : 0032) ;
--   - la marque ne se pose que par cette fonction : la fiche du dossier, que le cabinet écrit, ne la porte pas, sinon
--     un dossier payant se dirait « exemple ».
alter table socle.entreprise add column exemple boolean not null default false;

-- Les dossiers tenus d'un cabinet (0172), sans son exemple.
create or replace function plateforme.dossiers_du_cabinet(p_cabinet uuid, p_jour date)
returns table (entreprise uuid, nom text, cree date, rang bigint, payant boolean)
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select d.id, d.raison_sociale, d.cree, d.rang,
         d.rang > coalesce(plateforme.regle_cabinet_du_jour('gratuits', p_jour), 9223372036854775807)
    from (select e.id, e.raison_sociale, (e.cree_le at time zone e.fuseau)::date cree, row_number() over (order by e.cree_le, e.id) rang
            from socle.entreprise e
           where e.tenue_par = p_cabinet and e.active and not e.exemple
             and not exists (select 1 from cabinet.fiche f where f.cabinet = p_cabinet and f.entreprise = e.id and f.contenu ->> 'archived' = 'true')) d
$$;

-- Charger l'exemple : rend l'entreprise créée. Le serveur la remplit ensuite par les gestes ordinaires du cabinet.
create function socle.creer_dossier_exemple(p_cabinet uuid, p_raison_sociale text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_org uuid; v_ent uuid;
begin
  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet charge le dossier d''exemple'); end if;
  if exists (select 1 from socle.entreprise e where e.tenue_par = p_cabinet and e.exemple and e.active) then
    perform socle.refus('le dossier d''exemple est déjà dans ton cabinet : retire-le d''abord pour le recharger à neuf');
  end if;
  insert into socle.organisation (type, nom) values ('independant', p_raison_sociale) returning id into v_org;
  insert into socle.entreprise (organisation, raison_sociale, matricule_fiscal, tenue_par, exemple)
    values (v_org, p_raison_sociale, null, p_cabinet, true) returning id into v_ent;
  insert into socle.etablissement (entreprise, code, nom, type) values (v_ent, '000', 'Siège', 'siege');
  insert into socle.mandat (cabinet, entreprise, accorde_par, debut, perimetre, statut)
  values (p_cabinet, v_ent, socle.moi(), current_date, array['comptabilite', 'declarations', 'saisie_achats', 'paie'], 'actif');
  return v_ent;
end $$;

-- Retirer l'exemple : son mandat s'arrête et l'entreprise se ferme ; rien d'autre du cabinet ne bouge.
create function socle.retirer_dossier_exemple(p_cabinet uuid) returns integer
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare n integer;
begin
  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet retire le dossier d''exemple'); end if;
  update socle.mandat d set statut = 'termine', fin = greatest(current_date, d.debut)
   where d.cabinet = p_cabinet and d.statut <> 'termine'
     and d.entreprise in (select e.id from socle.entreprise e where e.tenue_par = p_cabinet and e.exemple);
  update socle.entreprise e set active = false where e.tenue_par = p_cabinet and e.exemple and e.active;
  get diagnostics n = row_count;
  return n;
end $$;

-- Les dossiers d'exemple du cabinet, pour qui en est membre actif : l'écran les marque, et rien ne leur est réclamé.
create function socle.dossiers_exemple(p_cabinet uuid) returns setof uuid
language sql stable security definer set search_path = pg_catalog, socle as $$
  select e.id from socle.entreprise e
   where e.tenue_par = p_cabinet and e.exemple and e.active
     and exists (select 1 from socle.membre m where m.organisation = p_cabinet and m.utilisateur = socle.moi() and m.actif)
$$;

revoke execute on function socle.creer_dossier_exemple(uuid, text), socle.retirer_dossier_exemple(uuid), socle.dossiers_exemple(uuid) from public;
grant execute on function socle.creer_dossier_exemple(uuid, text), socle.retirer_dossier_exemple(uuid), socle.dossiers_exemple(uuid) to skanfact_app;
