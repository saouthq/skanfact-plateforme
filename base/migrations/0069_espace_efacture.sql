-- La facture électronique dans l'espace client (brique 141 ; docs/espace-client.md, E8). Le client d'une
-- entreprise télécharge, par son lien, la facture que la TTN a validée (le fichier signé, avec la référence et la
-- signature de la TTN) : c'est elle qui fait foi. Seulement une pièce de son lien (la base choisit, comme pour le
-- reste de l'espace : `ventes.pieces_du_lien`), et seulement une fois acceptée par la TTN. Un lien inconnu ou retiré :
-- {lien: false} (la page le dit). Rien (null) : pièce hors du lien, ou pas encore acceptée.

create function ventes.espace_efacture(p_jeton_empreinte text, p_type text, p_numero text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes as $$
declare l ventes.lien; v_piece uuid;
begin
  l := ventes.lien_valable(p_jeton_empreinte);
  if l.id is null then return jsonb_build_object('lien', false); end if;
  select (x ->> 'id')::uuid into v_piece from jsonb_array_elements(ventes.pieces_du_lien(l.id)) x
   where x ->> 'type' = p_type and x ->> 'numero' = p_numero;
  if v_piece is null then return null; end if;
  return (select jsonb_build_object('nom', regexp_replace(e.nom, '\.xml$', '_ttn.xml'), 'xml', x.xml_valide)
            from ventes.envoi_ttn x join ventes.efacture e on e.piece = x.piece
           where x.piece = v_piece and x.statut = 'acceptee');
end $$;

revoke execute on function ventes.espace_efacture(text, text, text) from public;
grant execute on function ventes.espace_efacture(text, text, text) to skanfact_app;
