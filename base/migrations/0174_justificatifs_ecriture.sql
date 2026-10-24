-- Le cabinet qui tient la comptabilité d'un client ouvre, en lecture, les justificatifs que le client a joints à la pièce
-- d'où naît une écriture : son achat ou sa vente (1.135.0 ; revue du mois d'un client du 23/10/2026, point 13 ; décidé par
-- délégation le 23/10/2026, Skander : « je te laisse prendre la décision à ma place »). Un comptable valide une écriture
-- sur sa pièce : le 📎 disait « joint par le client », et rien ne s'ouvrait.
--
-- Rien d'autre de ses pièces jointes (un devis, un bon, un mouvement de banque, une pièce sans écriture), et seulement pour
-- qui lit les livres de l'entreprise (compta.mes_entreprises : la sienne, ou celle d'un client sous mandat actif) : la porte
-- de la route ne suffit pas, la base le redit. Le mandat le dit au client (le périmètre « La comptabilité »).

create function compta.justificatifs_ecriture(p_entreprise uuid, p_ecriture uuid) returns table (fichier uuid, nom text, type text, taille int)
language sql stable security definer set search_path = pg_catalog, socle as $$
  with e as (
    select origine, origine_type from compta.ecriture
     where entreprise = p_entreprise and id = p_ecriture and origine_type in ('achat', 'vente')
  ), pieces as (
    select d.contenu from e
      join achats.piece a on e.origine_type = 'achat' and a.entreprise = p_entreprise and a.id = e.origine
      join socle.dossier_v10 d on d.entreprise = p_entreprise and d.collection = 'purchases' and d.cle = a.ref_v10
    union all
    select d.contenu from e
      join ventes.piece v on e.origine_type = 'vente' and v.entreprise = p_entreprise and v.id = e.origine
      join socle.dossier_v10 d on d.entreprise = p_entreprise and d.collection = 'documents' and d.cle = v.ref_v10
  )
  select j.id, j.nom, j.type, j.taille
    from pieces
    cross join lateral jsonb_array_elements(case when jsonb_typeof(pieces.contenu -> 'attachments') = 'array'
      then pieces.contenu -> 'attachments' else '[]'::jsonb end) as fiche(x)
    join socle.piece_jointe j on j.entreprise = p_entreprise and j.id::text = fiche.x ->> 'file'
   where p_entreprise in (select compta.mes_entreprises())
   order by j.depose_le, j.id
$$;
revoke all on function compta.justificatifs_ecriture(uuid, uuid) from public;
grant execute on function compta.justificatifs_ecriture(uuid, uuid) to skanfact_app;

-- Le fichier lui-même, seulement s'il est l'un de ceux-là.
create function compta.justificatif_ecriture(p_entreprise uuid, p_ecriture uuid, p_fichier uuid) returns table (nom text, type text, contenu bytea)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select j.nom, j.type, j.contenu from socle.piece_jointe j
   where j.entreprise = p_entreprise and j.id = p_fichier
     and p_fichier in (select l.fichier from compta.justificatifs_ecriture(p_entreprise, p_ecriture) l)
$$;
revoke all on function compta.justificatif_ecriture(uuid, uuid, uuid) from public;
grant execute on function compta.justificatif_ecriture(uuid, uuid, uuid) to skanfact_app;
