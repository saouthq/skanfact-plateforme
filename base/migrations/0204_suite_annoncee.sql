-- (1.329.0) « Je facturais déjà » : la suite qu'une entreprise annonce dans son dossier (`counters`, « facture-2026 » : 47,
-- posée par « Continuer ma numérotation… » ou Paramètres → Documents → Numérotation) n'arrivait jamais à la série du
-- serveur. La fenêtre d'émission annonçait FAC-2026-048 et le serveur donnait FAC-2026-001 : deux factures « 001 » la même
-- année, l'une dans le carnet, l'autre ici (trouvé en jouant la boulangerie, 1.328.0).
--
-- À l'émission, la période encore VIERGE d'une série de facture ou d'avoir part de la dernière pièce émise ailleurs ; une
-- période où un numéro a déjà été donné ne bouge jamais (une série légale reste continue). Qui écrit la suite annoncée dans
-- le dossier, c'est le serveur qui le décide (serveur/v10/dossier.ts, `garderLaNumerotation` : le propriétaire ou un
-- administrateur) ; qui ÉMET la première facture (un commercial aussi) ne fait que la lire.
create function ventes.reprendre_v10(p_serie uuid, p_periode int, p_dernier bigint) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare s record;
begin
  select * into s from socle.serie where id = p_serie;
  if not found or s.entreprise not in (select socle.mes_entreprises()) then perform socle.refus('série introuvable'); end if;
  if not (socle.mes_roles(s.entreprise) && array['proprietaire', 'administrateur', 'commercial']::text[]) then
    perform socle.refus('ton rôle ne permet pas d''émettre une pièce');
  end if;
  if not s.legale or (s.type, s.prefixe) not in (('facture', 'FAC'), ('avoir', 'AVO')) then
    perform socle.refus('cette série n''est pas celle d''une facture ou d''un avoir');
  end if;
  if p_dernier is null or p_dernier < 1 or p_dernier > 99999 then return; end if;
  insert into socle.compteur (serie, entreprise, periode, dernier, repris) values (p_serie, s.entreprise, p_periode, p_dernier, p_dernier)
  on conflict (serie, periode) do nothing;
  if found then
    perform socle.tracer(s.entreprise, 'socle.serie.reprendre', 'serie', p_serie, null,
      jsonb_build_object('periode', p_periode, 'dernier', p_dernier, 'par', 'emission'));
  end if;
end $$;
revoke all on function ventes.reprendre_v10(uuid, int, bigint) from public;
grant execute on function ventes.reprendre_v10(uuid, int, bigint) to skanfact_app;
