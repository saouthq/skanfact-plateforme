-- Une facture du dossier émise par une clé de l'API (brique 131 ; docs/boutique.md) : la boutique en ligne d'un
-- commerçant facture ses commandes dans SkanFact. Une clé n'est personne (aucun rôle) : elle prend la série des factures
-- et des avoirs (FAC, AVO) si elle vaut encore, pour SON entreprise (mes_entreprises() l'a déjà dit), et si elle a un
-- geste qui émet une facture. Jamais la série des tickets : la caisse est le geste d'une personne au comptoir.
create or replace function ventes.serie_v10(p_entreprise uuid, p_type text, p_prefixe text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v uuid;
begin
  if (p_type, p_prefixe) not in (('facture', 'FAC'), ('avoir', 'AVO'), ('facture', 'TIC')) then
    perform socle.refus('cette série n''est pas celle d''une facture ou d''un avoir');
  end if;
  if p_entreprise not in (select socle.mes_entreprises())
     or not (socle.mes_roles(p_entreprise) && (case when p_prefixe = 'TIC' then array['proprietaire', 'administrateur', 'caissier']
                                                  else array['proprietaire', 'administrateur', 'commercial'] end)::text[]
             -- (Une clé révoquée, expirée ou d'une autre entreprise n'a déjà pas cette entreprise dans mes_entreprises().)
             or (p_prefixe <> 'TIC' and exists (select 1 from socle.cle_api k where k.id = socle.ma_cle()
                   and k.gestes && array['ventes.facture.emettre', 'ventes.boutique.facturer']))) then
    perform socle.refus('ton rôle ne permet pas d''émettre une pièce');
  end if;
  select id into v from socle.serie where entreprise = p_entreprise and type = p_type and prefixe = p_prefixe and legale and active;
  if found then return v; end if;
  insert into socle.serie (entreprise, type, prefixe, legale, remise, format)
  values (p_entreprise, p_type, p_prefixe, true, 'annuelle', '{P}-{AAAA}-{N:3}')
  returning id into v;
  perform socle.tracer(p_entreprise, 'socle.serie.creer', 'serie', v, null,
    jsonb_build_object('type', p_type, 'prefixe', p_prefixe, 'legale', true, 'par', 'emission'));
  return v;
end $$;
