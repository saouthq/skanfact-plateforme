-- L'identité d'une entreprise suit sa fiche société (lot facture, 05/10/2026 ; docs/facture-details.md, D6). La
-- raison sociale et le matricule fiscal que la personne écrit dans sa fiche (Paramètres → Mon entreprise, ou
-- « Compléter ma fiche » avant d'émettre) SONT ceux de l'entreprise : la liste des entreprises, le portefeuille du
-- cabinet et la copie figée des pièces suivantes les lisent ici. Ils restaient ceux de la création : une fiche
-- complétée plus tard ne changeait rien au serveur.
--   - Seuls le propriétaire et un administrateur les portent (le geste de la fiche, que le serveur vérifie déjà avant
--     d'écrire la fiche ; la base le redit).
--   - L'entreprise d'essai garde les siens (l'exemple y écrit une fiche inventée), un dossier tenu par un cabinet aussi
--     (son associé les corrige : brique 57, 0033).
--   - Un matricule déjà porté par une autre entreprise se refuse en le disant, et rien n'est écrit.
-- Rend ce qu'ils étaient avant, ou null quand rien ne change.
create function socle.porter_identite(p_entreprise uuid, p_raison_sociale text, p_matricule text) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare e socle.entreprise; v_nom text := btrim(coalesce(p_raison_sociale, ''));
begin
  select * into e from socle.entreprise where id = p_entreprise for update;
  if not found or e.essai or e.tenue_par is not null then return null; end if;
  -- Une raison sociale effacée ne laisse pas l'entreprise sans nom : elle garde la sienne.
  if v_nom = '' then v_nom := e.raison_sociale; end if;
  if v_nom = e.raison_sociale and p_matricule is not distinct from e.matricule_fiscal then return null; end if;
  if not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']) then
    perform socle.refus('seuls le propriétaire et un administrateur changent le nom ou le matricule de l''entreprise');
  end if;
  if p_matricule is not null and exists (select 1 from socle.entreprise x where x.active and x.matricule_fiscal = p_matricule and x.id <> p_entreprise) then
    perform socle.refus('ce matricule fiscal est déjà celui d''une autre entreprise sur SkanFact : relis-le sur ta carte d''identification fiscale');
  end if;
  update socle.entreprise set raison_sociale = v_nom, matricule_fiscal = p_matricule where id = p_entreprise;
  -- L'organisation née avec l'entreprise porte son nom ; une organisation nommée autrement le garde.
  update socle.organisation set nom = v_nom where id = e.organisation and nom = e.raison_sociale;
  return jsonb_build_object('raisonSociale', e.raison_sociale, 'matriculeFiscal', e.matricule_fiscal);
end $$;

revoke execute on function socle.porter_identite(uuid, text, text) from public;
grant execute on function socle.porter_identite(uuid, text, text) to skanfact_app;
