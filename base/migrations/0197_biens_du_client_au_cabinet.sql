-- Les biens que le client tient dans son SkanFact, lus par qui lit ses livres (1.314.0 ; les Immobilisations jouées le
-- 07/11/2026, décidé par délégation). L'entreprise tient ses fiches de biens dans son dossier (`assets` : le bien, sa
-- famille, sa mise en service, sa valeur, sa durée, sa sortie) ; le cabinet tenait les siennes à part (compta.immobilisation,
-- 0026), sans les voir : deux registres pour une entreprise (« à réunir », 29/09/2026), et le comptable recréait chaque bien
-- de mémoire, avec le risque de deux plans d'amortissement pour un seul bien. Désormais il LIT celles du client, sous un
-- mandat qui comprend la comptabilité (compta.mes_entreprises), sans les écrire : sa fiche se reprend de la leur.
create policy biens_du_client_au_cabinet on socle.dossier_v10 for select using (
  collection = 'assets' and entreprise in (select compta.mes_entreprises()));

-- L'achat d'où un bien est né, tel que le serveur le connaît (sa pièce, par l'identifiant v10 de l'achat) : c'est par lui
-- que la ligne du livre au compte 22 retrouve la fiche du client. Rien d'autre de l'achat ne sort.
create function compta.achats_des_biens(p_entreprise uuid, p_refs text[]) returns table (ref text, piece uuid)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select p.ref_v10, p.id
    from achats.piece p
   where p.entreprise = p_entreprise and p.ref_v10 = any(p_refs)
     and p_entreprise in (select compta.mes_entreprises())
$$;
revoke all on function compta.achats_des_biens(uuid, text[]) from public;
grant execute on function compta.achats_des_biens(uuid, text[]) to skanfact_app;

-- Une facture qui revend un bien de l'entreprise (née de sa fiche : `assetId` sur sa pièce du dossier v10) : son prix va aux
-- produits des cessions (775), pas aux ventes (706). Le serveur réécrit ses écritures quel que soit celui dont le geste les
-- réécrit : la question se pose ici, pour qui voit l'entreprise, et ne rend que oui ou non.
create function ventes.est_une_cession(p_entreprise uuid, p_piece uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select exists (
    select 1 from ventes.piece p join socle.dossier_v10 d on d.entreprise = p.entreprise and d.collection = 'documents' and d.cle = p.ref_v10
     where p.entreprise = p_entreprise and p.id = p_piece and coalesce(d.contenu->>'assetId', '') <> ''
       and p_entreprise in (select socle.mes_entreprises()))
$$;
revoke all on function ventes.est_une_cession(uuid, uuid) from public;
grant execute on function ventes.est_une_cession(uuid, uuid) to skanfact_app;
