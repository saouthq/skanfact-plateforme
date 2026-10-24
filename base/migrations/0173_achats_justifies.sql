-- L'achat d'un client porte-t-il un justificatif ? Oui ou non, lu par qui lit ses livres (1.125.0 ; revue du mois d'un
-- client du 23/10/2026, points 7 et 8 ; décidé par délégation le 23/10/2026, Skander : « continue »). Le cabinet ne lit
-- ni les achats du client (règle « visible » de achats.piece) ni ses pièces jointes (0160) : seul ce oui ou ce non sort,
-- pour les achats d'une entreprise dont la personne lit les livres (compta.mes_entreprises : la sienne, ou celle d'un
-- client sous mandat actif). Ni le fichier, ni son nom, ni le nombre de pièces.
create function compta.achats_justifies(p_entreprise uuid, p_pieces uuid[]) returns table (piece uuid, justifie boolean)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select p.id, coalesce(case when jsonb_typeof(d.contenu -> 'attachments') = 'array' then jsonb_array_length(d.contenu -> 'attachments') > 0 end, false)
    from achats.piece p
    join socle.dossier_v10 d on d.entreprise = p.entreprise and d.collection = 'purchases' and d.cle = p.ref_v10
   where p.entreprise = p_entreprise and p.id = any(p_pieces)
     and p_entreprise in (select compta.mes_entreprises())
$$;
revoke all on function compta.achats_justifies(uuid, uuid[]) from public;
grant execute on function compta.achats_justifies(uuid, uuid[]) to skanfact_app;
