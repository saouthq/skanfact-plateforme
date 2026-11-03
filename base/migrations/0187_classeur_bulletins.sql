-- Les bulletins de paie du classeur réservés à qui fait la paie (03/11/2026, 1.266.6 ; cadrage 16 § 10.1, point 12 ;
-- correction urgente, notée pour la sortie du Personnel). « Les envoyer » (1.245.0) range chaque bulletin validé au
-- classeur du dossier, mais la règle de lecture de cabinet.document (0180) ne regardait ni le rôle ni le mandat : tout
-- membre du cabinet qui voit le dossier (un collaborateur « saisie », la révision) lisait les bulletins, et la comptabilité
-- interne du client les lisait aussi par « Mon comptable » (0181, deux fonctions qui passent outre la règle).
--
-- Un document porte désormais la marque `paie` (un fait, pas son titre : un titre libre qui change rouvrirait la fuite
-- sans un mot) ; marqué, il suit la règle des bulletins eux-mêmes, paie.mes_entreprises() (0019) : au cabinet, le rôle
-- Paie et l'associé, sous un mandat qui comprend la paie ; chez le client, le propriétaire, l'administrateur et la paie.
alter table cabinet.document add column paie boolean not null default false;

-- Les bulletins déjà rangés, reconnus aux trois marques que « Les envoyer » écrit depuis la 1.245.0.
update cabinet.document set paie = true
 where rubrique = 'piece' and provenance = 'la Paie du cabinet' and detail = 'bulletin validé' and titre like 'Bulletin de paie · %';

drop policy visible on cabinet.document;
create policy visible on cabinet.document
  using (cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises())
    and (not paie or entreprise in (select paie.mes_entreprises())));

-- Ce que le client lit de son cabinet (0181) : un bulletin, seulement pour qui lit la paie de l'entreprise.
create or replace function cabinet.ce_que_mon_cabinet_a_range(p_entreprise uuid) returns table (
  sorte text, id uuid, rubrique text, categorie text, periode text, titre text, nom text, type text, taille int,
  depose_le timestamptz, depose_nom text, cabinet_nom text, jointe_le timestamptz, achat uuid, achat_ref text, ecriture_piece text, fichier uuid)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select 'document', d.id, d.rubrique, d.categorie, d.periode, d.titre, d.nom, d.type, d.taille, d.depose_le, u.nom, o.nom,
         case when d.classee_raison = 'jointe' then d.classee_le end, a.id, a.ref_v10, e.piece, null::uuid
    from cabinet.document d
    join socle.organisation o on o.id = d.cabinet
    left join socle.utilisateur u on u.id = d.depose_par
    left join compta.ecriture e on e.id = d.jointe_ecriture and e.entreprise = d.entreprise
    left join achats.piece a on a.entreprise = d.entreprise and e.origine_type = 'achat' and a.id = e.origine
   where d.entreprise = p_entreprise and d.remplace_par is null and messagerie.cote_entreprise(p_entreprise)
     and (not d.paie or p_entreprise in (select paie.mes_entreprises()))
  union all
  select 'message', m.id, 'piece', null, null, fi.nom, fi.nom, fi.type, length(fi.contenu), m.ecrit_le, null, o.nom,
         m.classee_le, a.id, a.ref_v10, e.piece, fi.id
    from messagerie.message m
    join messagerie.fichier fi on fi.id = m.fichier
    join socle.organisation o on o.id = m.cabinet
    join compta.ecriture e on e.id = m.jointe_ecriture and e.entreprise = m.entreprise
    left join achats.piece a on a.entreprise = m.entreprise and e.origine_type = 'achat' and a.id = e.origine
   where m.entreprise = p_entreprise and m.classee_raison = 'jointe' and messagerie.cote_entreprise(p_entreprise)
$$;

create or replace function cabinet.document_pour_le_client(p_entreprise uuid, p_document uuid) returns table (nom text, type text, contenu bytea)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select d.nom, d.type, d.contenu from cabinet.document d
   where d.entreprise = p_entreprise and d.id = p_document and messagerie.cote_entreprise(p_entreprise)
     and (not d.paie or p_entreprise in (select paie.mes_entreprises()))
$$;
