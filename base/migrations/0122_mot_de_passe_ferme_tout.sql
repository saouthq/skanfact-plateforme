-- Un nouveau mot de passe ferme aussi les sessions de la console (1.28.0 ; l'audit de la console 1.26.0, C02). La
-- réinitialisation (« mot de passe oublié », 0075) et le changement (0076) fermaient les sessions de l'application, pas
-- celles de la console (0083 : une connexion à part) : qui avait volé une session de la console la gardait après que la
-- personne avait repris son compte. Les deux portes ferment désormais tout, au même endroit :
--   - réinitialiser : toutes les sessions, de l'application et de la console, et les défis de connexion de la console
--     qui attendaient leur code (celui qui connaissait l'ancien mot de passe n'en finit pas un) ;
--   - changer : toutes les AUTRES sessions des deux espaces ; celle d'où l'on change reste ouverte. Depuis la console
--     (app.session_console posé), ses autres sessions se ferment dans la même transaction par le journal de l'équipe
--     (plateforme.console_mon_compte_change, 0117), qui les compte ; depuis l'application, ici.

create or replace function socle.conclure_reinitialisation(p_empreinte text, p_mot_de_passe text, p_maintenant timestamptz) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_utilisateur uuid;
begin
  update socle.reinitialisation r set utilise_le = p_maintenant
   where r.jeton_empreinte = p_empreinte and r.utilise_le is null and r.expire_le > p_maintenant and r.erreurs < 5
  returning r.utilisateur into v_utilisateur;
  if v_utilisateur is null then return false; end if;
  update socle.utilisateur set empreinte_mot_de_passe = p_mot_de_passe where id = v_utilisateur;
  update socle.reinitialisation set utilise_le = p_maintenant where utilisateur = v_utilisateur and utilise_le is null;
  update socle.session set fermee_le = p_maintenant where utilisateur = v_utilisateur and fermee_le is null;
  update plateforme.session_console set fermee_le = p_maintenant where utilisateur = v_utilisateur and fermee_le is null;
  update plateforme.defi_console set expire_le = least(expire_le, p_maintenant) where utilisateur = v_utilisateur and resolu_le is null;
  return true;
end $$;

create or replace function socle.changer_mot_de_passe(p_empreinte text, p_session uuid, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_console uuid := nullif(current_setting('app.session_console', true), '')::uuid;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  update socle.utilisateur set empreinte_mot_de_passe = p_empreinte where id = socle.moi();
  update socle.session set fermee_le = p_maintenant where utilisateur = socle.moi() and fermee_le is null and id is distinct from p_session;
  if v_console is null then
    update plateforme.session_console set fermee_le = p_maintenant where utilisateur = socle.moi() and fermee_le is null;
  end if;
  update plateforme.defi_console set expire_le = least(expire_le, p_maintenant) where utilisateur = socle.moi() and resolu_le is null;
  perform socle.tracer(null, 'compte.mot_de_passe.changer', 'utilisateur', socle.moi(), null, null);
end $$;
