-- Un exercice clos verrouille sa liasse (brique 59, 30/09/2026 ; docs/cabinet.md, C49). La clôture
-- (0029) arrête les livres d'une année : plus une écriture n'y entre. Ses retraitements fiscaux et son
-- taux d'impôt (0025) restaient pourtant modifiables, et le résultat fiscal d'une année close pouvait
-- changer sans trace de réouverture. Désormais ils se figent avec elle : les changer demande de rouvrir
-- l'exercice, avec un motif (0029), comme pour ses écritures.

create or replace function compta.poser_annuel(p_entreprise uuid, p_annee int, p_retraitements jsonb, p_taux bigint, p_revision bigint) returns bigint
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare a compta.annuel; r jsonb; v_rev bigint;
begin
  if not (p_entreprise in (select socle.mes_entreprises())) then perform socle.refus('entreprise introuvable'); end if;
  if not compta.peut_liasse(p_entreprise) then perform socle.refus('ton rôle ne permet pas de préparer la liasse de ce dossier'); end if;
  if p_annee is null or p_annee < 1900 or p_annee > 2999 then perform socle.refus('une année s''écrit sur quatre chiffres'); end if;
  if exists (select 1 from compta.exercice x where x.entreprise = p_entreprise and x.annee = p_annee and x.clos_le is not null) then
    perform socle.refus(format('l''exercice %s est clos : sa liasse ne change plus. Rouvre-le (onglet Exercice, avec un motif) pour changer un retraitement ou le taux', p_annee));
  end if;
  if p_retraitements is null or jsonb_typeof(p_retraitements) <> 'array' or jsonb_array_length(p_retraitements) > 200 then
    perform socle.refus('les retraitements d''une année sont une liste de deux cents au plus');
  end if;
  for r in select * from jsonb_array_elements(p_retraitements) loop
    if coalesce(r->>'nature', '') not in ('reintegration', 'deduction', 'deficit', 'amortissement') then
      perform socle.refus('la nature de ce retraitement n''est pas connue');
    end if;
    if length(trim(coalesce(r->>'libelle', ''))) = 0 or length(r->>'libelle') > 200 then
      perform socle.refus('un retraitement sans libellé ne s''explique pas devant un contrôle');
    end if;
    if jsonb_typeof(r->'montant') <> 'number' or not socle.sans_virgule(r->'montant') or (r->>'montant')::numeric <= 0 then
      perform socle.refus('le montant d''un retraitement est positif, en millimes : c''est la nature qui dit dans quel sens il joue');
    end if;
  end loop;
  if p_taux is not null and (p_taux < 0 or p_taux > 1000000) then perform socle.refus('le taux d''impôt se donne en pourcentage, entre 0 et 100'); end if;
  select * into a from compta.annuel where entreprise = p_entreprise and annee = p_annee for update;
  if coalesce(a.revision, 0) <> coalesce(p_revision, 0) then
    raise exception 'la liasse de cette année a été changée ailleurs entre-temps : recharge-la, rien n''a été enregistré' using errcode = 'SK409';
  end if;
  if a.entreprise is null then
    insert into compta.annuel (entreprise, annee, retraitements, taux_impot, modifie_par) values (p_entreprise, p_annee, p_retraitements, p_taux, socle.moi());
    v_rev := 1;
  else
    update compta.annuel set retraitements = p_retraitements, taux_impot = p_taux, revision = revision + 1, modifie_par = socle.moi(), modifie_le = now()
     where entreprise = p_entreprise and annee = p_annee returning revision into v_rev;
  end if;
  perform socle.tracer(p_entreprise, 'compta.annuel.poser', 'annuel', null,
    case when a.entreprise is null then null else jsonb_build_object('retraitements', a.retraitements, 'taux', a.taux_impot) end,
    jsonb_build_object('annee', p_annee, 'retraitements', p_retraitements, 'taux', p_taux));
  return v_rev;
end $$;
