-- L'entreprise d'essai des développeurs (14 § 2.5 ; décidé le 28/09/2026 par délégation) : un
-- développeur qui veut brancher son logiciel sur SkanFact essaie l'API sur une entreprise à lui,
-- déjà garnie, sans toucher à une vraie.
--   - chaque personne peut en avoir UNE (une seule active) ; elle en est la propriétaire ;
--   - elle est marquée `essai`, et ne le perd jamais : une pièce d'essai ne devient jamais une
--     vraie pièce. Ses numéros commencent par « ESSAI » (ESSAI-2026-001) ;
--   - elle vient avec trois clients d'exemple (les factures, le développeur les fait lui-même :
--     c'est ce qu'il vient apprendre) ;
--   - ce qui l'exclura plus tard, écrit ici pour ne pas l'oublier : jamais facturée par l'abonnement,
--     jamais transmise à la TTN, « ESSAI » sur chaque document.

alter table socle.entreprise add column essai boolean not null default false;

-- Une entreprise d'essai le reste, et une vraie ne le devient jamais.
create function socle.essai_immuable() returns trigger
language plpgsql as $$
begin
  if new.essai is distinct from old.essai then perform socle.refus('une entreprise d''essai le reste, et une vraie ne le devient jamais'); end if;
  return new;
end $$;
create trigger essai_immuable before update of essai on socle.entreprise for each row execute function socle.essai_immuable();

create function socle.creer_entreprise_essai() returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_org uuid; v_ent uuid; v_nom text;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  if exists (select 1 from socle.entreprise e join socle.membre m on m.entreprise = e.id
              where e.essai and m.utilisateur = socle.moi() and m.actif and 'proprietaire' = any(m.roles)) then
    perform socle.refus('tu as déjà une entreprise d''essai');
  end if;
  select nom into v_nom from socle.utilisateur where id = socle.moi();
  insert into socle.organisation (type, nom) values ('independant', 'Essai de ' || v_nom) returning id into v_org;
  insert into socle.entreprise (organisation, raison_sociale, essai) values (v_org, 'Entreprise d''essai de ' || v_nom, true) returning id into v_ent;
  insert into socle.etablissement (entreprise, code, nom, type) values (v_ent, '000', 'Siège', 'siege');
  insert into socle.membre (utilisateur, entreprise, roles) values (socle.moi(), v_ent, array['proprietaire']);
  insert into socle.serie (entreprise, type, prefixe, legale) values (v_ent, 'facture', 'ESSAI', true);
  insert into socle.tiers (entreprise, nature, raison_sociale, identifiant, type_identifiant, adresse, email) values
    (v_ent, 'societe', 'Menuiserie du Lac (exemple)', '1234567A', 'matricule', '12 rue du Lac, Tunis', 'contact@exemple.tn'),
    (v_ent, 'personne', 'Amel Ben Salah (exemple)', null, null, 'Sfax', null),
    (v_ent, 'etranger', 'Atelier Lumière (exemple)', null, null, 'Lyon', null);
  update socle.tiers set pays = 'FR', devise = 'EUR' where entreprise = v_ent and nature = 'etranger';
  perform socle.tracer(v_ent, 'socle.entreprise.creer', 'entreprise', v_ent, null, jsonb_build_object('essai', true));
  return v_ent;
end $$;

revoke execute on function socle.creer_entreprise_essai() from public;
grant execute on function socle.creer_entreprise_essai() to skanfact_app;
