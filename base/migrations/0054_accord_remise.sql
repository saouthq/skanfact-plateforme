-- L'accord d'un responsable au-delà d'une remise (brique 103 ; 03 D11 : « une remise, une vente au-delà de
-- l'encours d'un client… » ; docs/accords.md). Quand l'entreprise règle une remise permise sans accord
-- (`remiseAccordAuDela`, en %, sur sa fiche ; vide : pas de seuil, la valeur qui ne change rien), une facture dont
-- la remise globale la dépasse ne s'émet par un commercial qu'avec l'accord du propriétaire ou d'un administrateur.

-- 1. Une demande d'accord peut porter sur une remise : son taux et le seuil de l'entreprise, en centièmes de pour
--    cent (15 % = 1500) ; le montant est celui de la remise (en millimes), l'encours vaut 0 et le plafond rien.
alter table ventes.accord drop constraint accord_geste_check;
alter table ventes.accord add constraint accord_geste_check check (geste in ('encours', 'remise'));
alter table ventes.accord add column taux integer check (taux is null or taux between 1 and 10000);
alter table ventes.accord add column seuil integer check (seuil is null or seuil between 0 and 10000);
alter table ventes.accord alter column plafond drop not null;
alter table ventes.accord add constraint accord_forme check (
  (geste = 'encours' and plafond is not null and taux is null and seuil is null)
  or (geste = 'remise' and plafond is null and taux is not null and seuil is not null and taux > seuil));

-- Le taux et le seuil d'une demande ne se réécrivent pas plus que ses montants (0052, `accord_regles`).
create function ventes.accord_remise_fige() returns trigger
language plpgsql as $$
begin
  if (new.taux, new.seuil) is distinct from (old.taux, old.seuil) then
    raise exception 'Une demande d''accord ne se réécrit pas : on en fait une autre.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger accord_remise_fige before update on ventes.accord
  for each row execute function ventes.accord_remise_fige();

-- 2. La remise permise sans accord se règle par un responsable (03 § 2.3, « Seuils d'accord : les régler » : P, A),
--    jusque dans la base, comme l'encours autorisé (0052).
create function socle.dossier_v10_seuil_remise() returns trigger
language plpgsql as $$
declare
  avant jsonb;
  apres jsonb;
begin
  if not (new.collection = '_racine' and new.cle = 'company') then return new; end if;
  apres := new.contenu -> 'remiseAccordAuDela';
  avant := case when tg_op = 'UPDATE' then old.contenu -> 'remiseAccordAuDela' else null end;
  -- Absent, vide ou zéro : « pas de seuil ».
  if coalesce(apres, 'null'::jsonb) in ('null'::jsonb, '""'::jsonb, '0'::jsonb) then apres := null; end if;
  if coalesce(avant, 'null'::jsonb) in ('null'::jsonb, '""'::jsonb, '0'::jsonb) then avant := null; end if;
  if apres is distinct from avant and socle.moi() is not null
     and not (socle.mes_roles(new.entreprise) && array['proprietaire', 'administrateur']) then
    raise exception 'La remise permise sans accord se règle par le propriétaire ou un administrateur.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger dossier_v10_seuil_remise before insert or update on socle.dossier_v10
  for each row execute function socle.dossier_v10_seuil_remise();
