-- La liasse et le résultat fiscal de l'année (brique 41 ter, 29/09/2026 ; docs/cabinet.md, C26 et
-- C27). Le Cabinet v10 déduisait la liasse de la balance (compta.js, liasseDepuisLignes : une table de
-- rubriques modifiable) et le résultat fiscal du résultat comptable et de ses RETRAITEMENTS, avec un
-- taux d'impôt qui se SAISIT (vide : l'impôt s'écrit « — » avec sa raison, jamais un taux deviné).
-- Ici, le calcul reste celui de la v10, sur le livre du serveur ; le serveur garde, par année, ce qui
-- se saisit :
--   - les retraitements : leur nature (réintégration, déduction, report déficitaire, amortissement
--     différé), leur libellé, leur montant en millimes, toujours positif (la nature dit le sens) ;
--   - le taux d'impôt, en entier à six décimales comme tout taux (0004 : 25 % = 250000), ou rien.
-- Une révision : deux postes qui écrivent en même temps, le second relit (SK409).
-- Qui peut : le propriétaire, l'administrateur, la comptabilité interne ; au cabinet, l'associé
-- seulement, si le mandat comprend la comptabilité (03 § 3.1 : « états financiers, liasse »).

create table compta.annuel (
  entreprise uuid not null references socle.entreprise(id),
  annee int not null check (annee between 1900 and 2999),
  retraitements jsonb not null default '[]' check (jsonb_typeof(retraitements) = 'array' and socle.sans_virgule(retraitements)),
  taux_impot bigint check (taux_impot is null or taux_impot between 0 and 1000000),
  revision bigint not null default 1,
  modifie_par uuid references socle.utilisateur(id),
  modifie_le timestamptz not null default now(),
  primary key (entreprise, annee)
);
alter table compta.annuel enable row level security;
alter table compta.annuel force row level security;
create policy visible on compta.annuel using (entreprise in (select compta.mes_entreprises()));
grant select on compta.annuel to skanfact_app;

create function compta.peut_liasse(p_entreprise uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select p_entreprise in (select compta.mes_entreprises()) and case
    when socle.perimetre_cabinet(p_entreprise) is not null then
      'comptabilite' = any(socle.perimetre_cabinet(p_entreprise)) and 'supervision' = any(socle.mes_roles(p_entreprise))
    when socle.ma_cle() is not null then
      exists (select 1 from socle.cle_api k where k.id = socle.ma_cle() and k.entreprise = p_entreprise and 'compta.liasse.preparer' = any (k.gestes))
    else socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne']::text[]
  end
$$;

-- Poser les retraitements et le taux d'une année, dans la révision qu'on a lue (null : la première
-- fois). Rend la nouvelle révision.
create function compta.poser_annuel(p_entreprise uuid, p_annee int, p_retraitements jsonb, p_taux bigint, p_revision bigint) returns bigint
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare a compta.annuel; r jsonb; v_rev bigint;
begin
  if not (p_entreprise in (select socle.mes_entreprises())) then perform socle.refus('entreprise introuvable'); end if;
  if not compta.peut_liasse(p_entreprise) then perform socle.refus('ton rôle ne permet pas de préparer la liasse de ce dossier'); end if;
  if p_annee is null or p_annee < 1900 or p_annee > 2999 then perform socle.refus('une année s''écrit sur quatre chiffres'); end if;
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

revoke execute on function compta.peut_liasse(uuid), compta.poser_annuel(uuid, int, jsonb, bigint, bigint) from public;
grant execute on function compta.peut_liasse(uuid), compta.poser_annuel(uuid, int, jsonb, bigint, bigint) to skanfact_app;
