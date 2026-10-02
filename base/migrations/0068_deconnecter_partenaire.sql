-- « Déconnecter » chez le partenaire (brique 135 ; docs/boutique.md, B0). Quand le commerçant déconnecte sa boutique
-- dans SkanEcom, SkanEcom oublie la clé ; sans ce geste, SkanFact la gardait valable un an (essai de bout en bout du
-- 02/10/2026 : deux « SkanEcom (connexion) » dans Services connectés, la plus ancienne orpheline). Le serveur du
-- partenaire (son secret est vérifié par le serveur) présente la clé : elle est coupée ici.
--
-- Seule une clé que CE partenaire a reçue par l'échange se coupe ainsi ; la reconnaître suffit (une clé déjà coupée ou
-- expirée ne change pas, et la réponse est la même : le partenaire peut redemander sans risque). Rien (null) : ce
-- partenaire n'a pas reçu cette clé.

create function socle.deconnecter_partenaire(p_partenaire text, p_empreinte_cle text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cle uuid; v_entreprise uuid; v_revoquee timestamptz;
begin
  select k.id, k.entreprise, k.revoquee_le into v_cle, v_entreprise, v_revoquee
    from socle.autorisation_partenaire a join socle.cle_api k on k.id = a.cle_api
   where a.partenaire = p_partenaire and k.empreinte = p_empreinte_cle
     for update of k;
  if v_cle is null then return null; end if;
  if v_revoquee is null then
    update socle.cle_api set revoquee_le = now() where id = v_cle;
    -- La trace : personne n'est connecté (c'est le serveur du partenaire), la ligne le dit par son geste.
    perform socle.tracer(v_entreprise, 'socle.partenaire.deconnecter', 'cle_api', v_cle, null, jsonb_build_object('partenaire', p_partenaire));
  end if;
  return v_cle;
end $$;

revoke execute on function socle.deconnecter_partenaire(text, text) from public;
grant execute on function socle.deconnecter_partenaire(text, text) to skanfact_app;
