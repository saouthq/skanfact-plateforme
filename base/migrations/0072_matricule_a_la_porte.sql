-- La porte refuse un matricule déjà pris en le disant (lot facture vérifié sur le serveur d'essai, 05/10/2026 ;
-- docs/facture-details.md, E4). « Créer mon entreprise » avec le matricule d'une autre entreprise faisait tomber
-- l'index (un matricule, une seule entreprise active : 0071) : la personne lisait « le serveur a rencontré une
-- erreur », et réessayait pour rien. La phrase est celle de la fiche société (porter_identite, 0071). Le serveur
-- garde désormais chaque matricule sous sa forme lisible (serveur/matricule.ts) : écrit autrement, le même matricule
-- est reconnu.

create or replace function socle.creer_entreprise(p_raison_sociale text, p_matricule_fiscal text default null)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_org uuid; v_ent uuid;
begin
  if socle.moi() is null then
    raise exception 'personne n''est connecté : impossible de créer une entreprise' using errcode = '42501';
  end if;
  if p_matricule_fiscal is not null and exists (select 1 from socle.entreprise x where x.active and x.matricule_fiscal = p_matricule_fiscal) then
    perform socle.refus('ce matricule fiscal est déjà celui d''une autre entreprise sur SkanFact : relis-le sur ta carte d''identification fiscale');
  end if;
  insert into socle.organisation (type, nom) values ('independant', p_raison_sociale) returning id into v_org;
  insert into socle.entreprise (organisation, raison_sociale, matricule_fiscal)
    values (v_org, p_raison_sociale, p_matricule_fiscal) returning id into v_ent;
  insert into socle.etablissement (entreprise, code, nom, type) values (v_ent, '000', 'Siège', 'siege');
  insert into socle.membre (utilisateur, entreprise, roles) values (socle.moi(), v_ent, array['proprietaire']);
  return v_ent;
end $$;
