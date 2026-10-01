-- Le ticket de caisse émis par le serveur (brique 115 ; 03 § 2.1 « Caisse » ; docs/caisse.md). Un ticket est une
-- facture de la v10 marquée « ticket », avec SA série (« TIC-2026-001 » : un ticket ne consomme jamais un numéro de
-- facture, sinon la série légale des factures aurait des trous). Le caissier l'émet (il n'émet pas de facture).

-- La série des tickets se crée au premier ticket, comme celles des factures et des avoirs (0053) ; le caissier ne
-- crée que celle-là.
create or replace function ventes.serie_v10(p_entreprise uuid, p_type text, p_prefixe text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v uuid;
begin
  if (p_type, p_prefixe) not in (('facture', 'FAC'), ('avoir', 'AVO'), ('facture', 'TIC')) then
    perform socle.refus('cette série n''est pas celle d''une facture ou d''un avoir');
  end if;
  if p_entreprise not in (select socle.mes_entreprises())
     or not (socle.mes_roles(p_entreprise) && (case when p_prefixe = 'TIC' then array['proprietaire', 'administrateur', 'caissier']
                                                  else array['proprietaire', 'administrateur', 'commercial'] end)::text[]) then
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
