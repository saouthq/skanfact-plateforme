-- La saisie au brouillard du Cabinet faite sans réseau (1.105.0 ; docs/hors-ligne.md, H15). Le poste garde l'écriture,
-- chiffrée, avec un identifiant qu'il choisit, et l'envoie au retour du réseau. Une réponse perdue en route (le réseau
-- qui retombe pendant l'envoi) fait renvoyer la même écriture : elle n'entre qu'UNE fois. Le même identifiant revenu
-- pour la même entreprise est « déjà reçu », sans rien changer (pas même ce qu'on y aurait modifié depuis) ; pour une
-- autre entreprise, il est refusé sans rien en dire. Tout le reste est la saisie (compta.saisir, 0021) : les mêmes
-- droits, d'abord, les mêmes contrôles, la même trace.

create function compta.saisir_une_fois(p_entreprise uuid, p_id uuid, p_ecriture jsonb) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare v_entreprise uuid;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  select entreprise into v_entreprise from compta.ecriture where id = p_id;
  if found then
    if v_entreprise = p_entreprise then return false; end if;
    perform socle.refus('cet identifiant d''écriture est déjà pris : rien n''a été enregistré');
  end if;
  perform compta.poser_saisie(p_entreprise, p_id, p_ecriture, true);
  perform socle.tracer(p_entreprise, 'compta.ecriture.saisir', 'ecriture', p_id, null, p_ecriture);
  return true;
end $$;
revoke execute on function compta.saisir_une_fois(uuid, uuid, jsonb) from public;
grant execute on function compta.saisir_une_fois(uuid, uuid, jsonb) to skanfact_app;
