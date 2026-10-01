-- L'accord d'un responsable au-delà d'une commande fournisseur (brique 114 ; 03 D11 : « une remise, une vente
-- au-delà de l'encours d'un client, une commande fournisseur, un retour » ; docs/accords.md). Quand l'entreprise
-- règle le montant permis sans accord (`commandeAccordAuDela`, hors taxes, dans sa devise, sur sa fiche ; vide : pas
-- de seuil, la valeur qui ne change rien), une commande fournisseur qui le dépasse ne part (« envoyée ») que par le
-- propriétaire, un administrateur, ou avec l'accord de l'un d'eux.

-- 1. Une demande d'accord peut porter sur une commande fournisseur : `client_v10` est alors la clé du fournisseur,
--    `montant` le total hors taxes de la commande ramené dans la devise de l'entreprise, `plafond` le montant permis
--    sans accord (le seuil de ce jour-là, figé comme le reste de la demande) ; l'encours vaut 0.
alter table ventes.accord drop constraint accord_geste_check;
alter table ventes.accord add constraint accord_geste_check check (geste in ('encours', 'remise', 'commande'));
alter table ventes.accord drop constraint accord_forme;
alter table ventes.accord add constraint accord_forme check (
  (geste = 'encours' and plafond is not null and taux is null and seuil is null)
  or (geste = 'remise' and plafond is null and taux is not null and seuil is not null and taux > seuil)
  or (geste = 'commande' and plafond is not null and taux is null and seuil is null and montant > plafond and encours = 0));

-- 2. Le montant permis sans accord se règle par un responsable (03 § 2.3, « Seuils d'accord : les régler » : P, A),
--    jusque dans la base, comme la remise (0054) et l'encours (0052).
create function socle.dossier_v10_seuil_commande() returns trigger
language plpgsql as $$
declare
  avant jsonb;
  apres jsonb;
begin
  if not (new.collection = '_racine' and new.cle = 'company') then return new; end if;
  apres := new.contenu -> 'commandeAccordAuDela';
  avant := case when tg_op = 'UPDATE' then old.contenu -> 'commandeAccordAuDela' else null end;
  -- Absent, vide ou zéro : « pas de seuil ».
  if coalesce(apres, 'null'::jsonb) in ('null'::jsonb, '""'::jsonb, '0'::jsonb) then apres := null; end if;
  if coalesce(avant, 'null'::jsonb) in ('null'::jsonb, '""'::jsonb, '0'::jsonb) then avant := null; end if;
  if apres is distinct from avant and socle.moi() is not null
     and not (socle.mes_roles(new.entreprise) && array['proprietaire', 'administrateur']) then
    raise exception 'Le montant d''une commande fournisseur permis sans accord se règle par le propriétaire ou un administrateur.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger dossier_v10_seuil_commande before insert or update on socle.dossier_v10
  for each row execute function socle.dossier_v10_seuil_commande();
