-- La remise à la caisse (brique 125 ; 03 § 2.1 « Caisse » : « remise au-delà du plafond » ; docs/caisse.md, M1 à M4).
-- Le plafond de remise de la caisse (`remiseCaisseAuDela`, en %, sur la fiche de l'entreprise) : au-delà, une remise
-- demande le code d'un responsable présent. Par défaut il vaut 0 % (03 § 2.1) : toute remise le demande. Il se règle
-- par le propriétaire ou un administrateur, jusque dans la base, comme le seuil de remise des factures (0054).
create function socle.dossier_v10_plafond_caisse() returns trigger
language plpgsql as $$
declare
  avant jsonb;
  apres jsonb;
begin
  if not (new.collection = '_racine' and new.cle = 'company') then return new; end if;
  apres := new.contenu -> 'remiseCaisseAuDela';
  avant := case when tg_op = 'UPDATE' then old.contenu -> 'remiseCaisseAuDela' else null end;
  -- Absent, vide ou zéro : le plafond de 0 %.
  if coalesce(apres, 'null'::jsonb) in ('null'::jsonb, '""'::jsonb, '0'::jsonb) then apres := null; end if;
  if coalesce(avant, 'null'::jsonb) in ('null'::jsonb, '""'::jsonb, '0'::jsonb) then avant := null; end if;
  if apres is distinct from avant and socle.moi() is not null
     and not (socle.mes_roles(new.entreprise) && array['proprietaire', 'administrateur']) then
    raise exception 'Le plafond de remise de la caisse se règle par le propriétaire ou un administrateur.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger dossier_v10_plafond_caisse before insert or update on socle.dossier_v10
  for each row execute function socle.dossier_v10_plafond_caisse();

-- Un ticket encaissé sans réseau avec une remise au-delà du plafond, sans responsable (le code ne se vérifie qu'en
-- ligne) : il s'enregistre (c'est un fait), et l'écart se dit en alerte.
alter table caisse.alerte drop constraint alerte_nature_check;
alter table caisse.alerte add constraint alerte_nature_check check (nature in ('numero', 'chaine', 'empreinte', 'apres_fermeture', 'remise'));
