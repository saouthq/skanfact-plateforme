-- Le nom et le matricule d'un dossier tenu (brique 57, 30/09/2026 ; docs/cabinet.md, C47). Un dossier
-- TENU par le cabinet (un client hors SkanFact) n'a personne d'autre pour dire son nom et son matricule
-- fiscal : un associé du cabinet les corrige depuis la fiche du dossier. Ceux d'un client sur SkanFact
-- sont les siens : lui seul les change (le cabinet ne les touche jamais). Un matricule déjà porté par
-- une autre entreprise se refuse en le disant, à la création comme ici (la base le refusait sans un mot).

create function socle.exiger_matricule_libre(p_matricule text, p_sauf uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, socle as $$
begin
  if p_matricule is not null and exists (select 1 from socle.entreprise e where e.active and e.matricule_fiscal = p_matricule and e.id is distinct from p_sauf) then
    perform socle.refus('ce matricule fiscal est déjà celui d''une entreprise sur SkanFact : si c''est ton client, qu''il te propose le mandat avec le code de ton cabinet');
  end if;
end $$;

create or replace function socle.creer_dossier_tenu(p_cabinet uuid, p_raison_sociale text, p_matricule text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_org uuid; v_ent uuid;
begin
  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet crée un dossier'); end if;
  perform socle.exiger_matricule_libre(p_matricule, null);
  insert into socle.organisation (type, nom) values ('independant', p_raison_sociale) returning id into v_org;
  insert into socle.entreprise (organisation, raison_sociale, matricule_fiscal, tenue_par)
    values (v_org, p_raison_sociale, p_matricule, p_cabinet) returning id into v_ent;
  insert into socle.etablissement (entreprise, code, nom, type) values (v_ent, '000', 'Siège', 'siege');
  insert into socle.mandat (cabinet, entreprise, accorde_par, debut, perimetre, statut)
  values (p_cabinet, v_ent, socle.moi(), current_date, array['comptabilite', 'declarations', 'saisie_achats', 'paie'], 'actif');
  return v_ent;
end $$;

-- Renommer un dossier tenu, ou corriger son matricule (null : pas de matricule). Rend l'état d'avant.
create function socle.renommer_dossier_tenu(p_cabinet uuid, p_entreprise uuid, p_raison_sociale text, p_matricule text) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare e socle.entreprise; v_nom text := btrim(coalesce(p_raison_sociale, ''));
begin
  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet change le nom ou le matricule d''un dossier'); end if;
  select * into e from socle.entreprise where id = p_entreprise for update;
  if not found or not exists (select 1 from socle.mandat m where m.cabinet = p_cabinet and m.entreprise = p_entreprise and m.statut = 'actif') then
    perform socle.refus('ce dossier n''est pas au portefeuille du cabinet');
  end if;
  if e.tenue_par is distinct from p_cabinet then
    perform socle.refus('ce client est sur SkanFact : son nom et son matricule sont les siens, lui seul les change');
  end if;
  perform socle.exiger_matricule_libre(p_matricule, p_entreprise);
  update socle.entreprise set raison_sociale = v_nom, matricule_fiscal = p_matricule where id = p_entreprise;
  update socle.organisation set nom = v_nom where id = e.organisation;
  return jsonb_build_object('raisonSociale', e.raison_sociale, 'matriculeFiscal', e.matricule_fiscal);
end $$;

revoke execute on function socle.exiger_matricule_libre(text, uuid), socle.renommer_dossier_tenu(uuid, uuid, text, text) from public;
grant execute on function socle.renommer_dossier_tenu(uuid, uuid, text, text) to skanfact_app;
