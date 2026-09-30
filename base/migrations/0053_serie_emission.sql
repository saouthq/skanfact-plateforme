-- La série de numéros d'une facture ou d'un avoir de la v10 (FAC, AVO) se crée au premier besoin, par l'émission
-- elle-même (brique 99) : qui peut émettre (propriétaire, administrateur, commercial) n'a pas à créer la série à la
-- main. Créer une AUTRE série reste au propriétaire et à l'administrateur (socle.creer_serie).
create function ventes.serie_v10(p_entreprise uuid, p_type text, p_prefixe text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v uuid;
begin
  if p_entreprise not in (select socle.mes_entreprises())
     or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'commercial']::text[]) then
    perform socle.refus('ton rôle ne permet pas d''émettre une pièce');
  end if;
  if (p_type, p_prefixe) not in (('facture', 'FAC'), ('avoir', 'AVO')) then
    perform socle.refus('cette série n''est pas celle d''une facture ou d''un avoir');
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
revoke all on function ventes.serie_v10(uuid, text, text) from public;
grant execute on function ventes.serie_v10(uuid, text, text) to skanfact_app;
