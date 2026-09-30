-- Retirer un dossier du portefeuille (brique 56, 30/09/2026 ; docs/cabinet.md, C46). Le Cabinet v10
-- effaçait un dossier « de ce poste » ; sur la plateforme, rien ne s'efface : retirer un dossier, c'est
-- arrêter son mandat (0019). Le client sur SkanFact garde tout — ses livres sont les siens. Mais un
-- dossier TENU par le cabinet (un client hors SkanFact) n'a personne d'autre que lui : arrêter son
-- mandat quand ses livres ont une écriture les rendrait introuvables pour tout le monde. Il se refuse
-- donc ; un dossier tenu sans aucune écriture (créé par erreur) se retire.

create or replace function socle.arreter_mandat(p_mandat uuid) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare d record; n bigint;
begin
  select * into d from socle.mandat where id = p_mandat for update;
  if not found or not (socle.suis_associe(d.cabinet)
                       or ('proprietaire' = any(socle.mes_roles(d.entreprise)) and socle.perimetre_cabinet(d.entreprise) is null)) then
    perform socle.refus('seuls le propriétaire de l''entreprise et un associé du cabinet arrêtent un mandat');
  end if;
  if d.statut = 'termine' then perform socle.refus('ce mandat est déjà arrêté'); end if;
  if exists (select 1 from socle.entreprise e where e.id = d.entreprise and e.tenue_par = d.cabinet) then
    select count(*) into n from compta.ecriture where entreprise = d.entreprise;
    if n > 0 then
      perform socle.refus(format('ce dossier, que ton cabinet tient, a %s dans ses livres : le retirer les rendrait introuvables pour tout le monde. Archive-le plutôt (sa fiche, « Dossier archivé ») : il sort des listes sans rien perdre',
        case when n = 1 then '1 écriture' else n || ' écritures' end));
    end if;
  end if;
  update socle.mandat set statut = 'termine', fin = greatest(current_date, debut) where id = p_mandat;
  return d.entreprise;
end $$;
