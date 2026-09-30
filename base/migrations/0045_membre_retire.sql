-- Un membre retiré (brique 76 ; docs/hors-ligne.md, H13 ; 03 D8 : « un membre retiré voit les données
-- de cette entreprise effacées de ses postes à leur reconnexion »). Son poste l'apprend en ouvrant
-- l'entreprise (le serveur ne la lui montre plus) ; ce qu'il y avait fait hors ligne est d'abord remis,
-- en quarantaine, comme pour un appareil retiré (0044) : le propriétaire décide. Puis le poste efface ce
-- qu'il gardait de CETTE entreprise (les autres restent).

-- Remettre par une session valable (le serveur l'a reconnue : `quiEst`) d'une personne qui a été
-- membre de l'entreprise et ne l'est plus. Rend le nombre de changements reçus que la personne a faits
-- (0044, `changements_faits`), ou null (rien n'est reçu).
create function socle.remettre_d_un_membre_retire(p_session uuid, p_entreprise uuid, p_changements jsonb, p_maintenant timestamptz)
returns integer
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare s record;
begin
  select se.id, se.utilisateur, se.appareil, a.nom into s
    from socle.session se join socle.appareil a on a.id = se.appareil where se.id = p_session;
  if not found then return null; end if;
  if not exists (select 1 from socle.membre m where m.utilisateur = s.utilisateur and m.entreprise = p_entreprise and not m.actif) then
    return null;
  end if;
  insert into socle.quarantaine (entreprise, session, appareil, appareil_nom, utilisateur, recue_le, changements)
    values (p_entreprise, s.id, s.appareil, s.nom, s.utilisateur, p_maintenant, p_changements)
    on conflict (session, entreprise) do nothing;
  return socle.changements_faits(p_changements);
end $$;
revoke execute on function socle.remettre_d_un_membre_retire(uuid, uuid, jsonb, timestamptz) from public;
grant execute on function socle.remettre_d_un_membre_retire(uuid, uuid, jsonb, timestamptz) to skanfact_app;
