-- Les déclarations et l'inventaire repris avec le livre du Cabinet v10 (brique 69, 30/09/2026 ;
-- docs/cabinet.md, C59). Chacun se pose par son geste ordinaire (compta.poser_declaration,
-- compta.poser_inventaire : ils refont leurs contrôles et gardent qui peut), puis garde ce que la v10
-- savait déjà :
--   - une déclaration : le jour où elle a été préparée, son dépôt (le jour, la référence) et son
--     paiement (jamais sans dépôt : la règle de la table), et l'écriture du mois qui lui est liée ;
--   - l'inventaire : l'écriture de variation de stock qui lui est liée ;
-- l'écriture liée doit être une écriture REPRISE de ce dossier : c'est ce lien qui empêche de la
-- repasser. Seulement dans un dossier que le cabinet de la personne tient.

create function compta.reprendre_declaration_v10(p_entreprise uuid, p_declaration jsonb) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare v_id uuid; v_ecriture uuid := nullif(p_declaration->>'ecriture', '')::uuid;
begin
  if socle.perimetre_cabinet(p_entreprise) is null
     or not exists (select 1 from socle.entreprise where id = p_entreprise and tenue_par is not null) then
    perform socle.refus('la reprise d''un livre de la v10 s''écrit dans un dossier que ton cabinet tient');
  end if;
  if v_ecriture is not null and not exists (select 1 from compta.ecriture e where e.id = v_ecriture and e.entreprise = p_entreprise and e.origine_type = 'reprise_v10') then
    perform socle.refus('l''écriture liée à une déclaration ou à un inventaire repris n''est pas une écriture reprise de ce dossier');
  end if;
  v_id := compta.poser_declaration(p_entreprise, p_declaration->>'periode', p_declaration->'cases');
  update compta.declaration set
    preparee_le = case when coalesce((p_declaration->>'preparee')::bigint, 0) > 0 then to_timestamp((p_declaration->>'preparee')::bigint / 1000.0) else preparee_le end,
    deposee_le = (p_declaration->'deposee'->>'le')::date, deposee_par = case when p_declaration->'deposee'->>'le' is null then null else socle.moi() end,
    deposee_reference = coalesce(p_declaration->'deposee'->>'reference', ''),
    payee_le = (p_declaration->>'payee')::date, payee_par = case when p_declaration->>'payee' is null then null else socle.moi() end,
    ecriture = v_ecriture
   where id = v_id;
  return v_id;
end $$;

create function compta.reprendre_inventaire_v10(p_entreprise uuid, p_annee int, p_inventaire jsonb) returns bigint
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare v_total bigint; v_ecriture uuid := nullif(p_inventaire->>'ecriture', '')::uuid;
begin
  if socle.perimetre_cabinet(p_entreprise) is null
     or not exists (select 1 from socle.entreprise where id = p_entreprise and tenue_par is not null) then
    perform socle.refus('la reprise d''un livre de la v10 s''écrit dans un dossier que ton cabinet tient');
  end if;
  if v_ecriture is not null and not exists (select 1 from compta.ecriture e where e.id = v_ecriture and e.entreprise = p_entreprise and e.origine_type = 'reprise_v10') then
    perform socle.refus('l''écriture liée à une déclaration ou à un inventaire repris n''est pas une écriture reprise de ce dossier');
  end if;
  v_total := compta.poser_inventaire(p_entreprise, p_annee, p_inventaire);
  update compta.inventaire set ecriture = v_ecriture where entreprise = p_entreprise and annee = p_annee;
  return v_total;
end $$;

revoke execute on function compta.reprendre_declaration_v10(uuid, jsonb), compta.reprendre_inventaire_v10(uuid, int, jsonb) from public;
grant execute on function compta.reprendre_declaration_v10(uuid, jsonb), compta.reprendre_inventaire_v10(uuid, int, jsonb) to skanfact_app;
