-- Les erreurs de mot de passe s'oublient (17/11/2026, 1.379.3).
--
-- Depuis 0002, le compteur d'erreurs d'une adresse ne repartait de zéro qu'à une connexion réussie. Quatre fautes de
-- frappe étalées sur des semaines, sur un compte qu'on ouvre rarement, restaient donc comptées : la « première » faute
-- du jour tombait sur l'attente (« Trop d'essais »), sans que la personne ait rien fait de trop ce jour-là.
-- Les erreurs vieilles de plus d'un jour ne comptent plus : le compteur repart à 1. Les paliers ne changent pas (5
-- erreurs : 1 minute, puis 5, 15, 60 au plus), et l'attente en cours non plus : qui essaie des mots de passe à la chaîne
-- reste freiné exactement comme avant.

create or replace function socle.noter_erreur(p_cle text, p_maintenant timestamptz) returns timestamptz
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_erreurs int; v_attente timestamptz;
begin
  insert into socle.tentative (cle, erreurs, derniere) values (lower(trim(p_cle)), 1, p_maintenant)
  on conflict (cle) do update set
    erreurs = case when socle.tentative.derniere < p_maintenant - interval '24 hours' then 1 else socle.tentative.erreurs + 1 end,
    attente_jusqu_au = case when socle.tentative.derniere < p_maintenant - interval '24 hours' then null else socle.tentative.attente_jusqu_au end,
    derniere = p_maintenant
  returning erreurs into v_erreurs;
  if v_erreurs >= 5 then
    v_attente := p_maintenant + case
      when v_erreurs = 5 then interval '1 minute'
      when v_erreurs = 6 then interval '5 minutes'
      when v_erreurs = 7 then interval '15 minutes'
      else interval '60 minutes' end;
    update socle.tentative set attente_jusqu_au = v_attente where cle = lower(trim(p_cle));
  end if;
  return v_attente;
end $$;
