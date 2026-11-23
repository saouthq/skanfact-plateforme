-- 0223 — Changer son nom (issue 4, ENTREE-15 ; docs/revue-modules.md § 1.388.24).
--
-- Le nom se tapait une fois, à l'inscription, et rien ne le changeait ensuite : une faute de frappe se lisait pour
-- toujours dans l'équipe, chez le cabinet et sur les messages. Il se change dans « Ton compte ». Ce qui est déjà envoyé
-- (les messages) garde le nom du moment ; l'équipe et le cabinet le lisent par jointure et suivent. Le changement est
-- tracé avec l'ancien nom.
create function socle.changer_mon_nom(p_nom text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_ancien text; v_nom text := btrim(coalesce(p_nom, ''));
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  if char_length(v_nom) < 2 or char_length(v_nom) > 120 then perform socle.refus('nom invalide'); end if;
  select u.nom into v_ancien from socle.utilisateur u where u.id = socle.moi();
  if v_ancien is distinct from v_nom then
    update socle.utilisateur set nom = v_nom where id = socle.moi();
    perform socle.tracer(null, 'compte.nom.changer', 'utilisateur', socle.moi(), jsonb_build_object('nom', v_ancien), jsonb_build_object('nom', v_nom));
  end if;
end $$;
revoke execute on function socle.changer_mon_nom(text) from public;
grant execute on function socle.changer_mon_nom(text) to skanfact_app;
