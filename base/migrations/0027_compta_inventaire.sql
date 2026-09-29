-- L'inventaire de stock (brique 42 bis, 29/09/2026 ; docs/cabinet.md, C30). Le Cabinet v10 gardait,
-- dans le livre d'un exercice, l'inventaire compté au dernier jour (des lignes : référence,
-- désignation, quantité, coût unitaire) et proposait la variation de stock (compta.js,
-- variationDeStock : ce que le compte de stock portait contre ce qu'on vient de compter), au
-- brouillard. Ici :
--   - un inventaire par entreprise et par année, ses lignes gardées au serveur : la quantité en
--     millièmes (un stock se compte aussi en kilos), le coût unitaire en millimes ; le TOTAL se
--     calcule ICI (la valeur d'une ligne arrondie au millime, puis la somme) ;
--   - refait, il remplace le précédent, sauf une fois sa variation passée en écriture (contre-passe-la
--     ou supprime-la d'abord) ;
--   - la variation entre au brouillard par la saisie, datée dans l'année, et se lie à l'inventaire ;
--     supprimée ou contre-passée, le lien ne vaut plus.
-- Saisir l'inventaire : qui saisit. Écrire la variation : qui valide (la v10 : « validation »).

create table compta.inventaire (
  entreprise uuid not null references socle.entreprise(id),
  annee int not null check (annee between 1900 and 2999),
  date_inventaire date not null,
  compte text not null check (compte ~ '^[0-9]{1,12}$'),
  lignes jsonb not null check (jsonb_typeof(lignes) = 'array' and socle.sans_virgule(lignes)),
  total bigint not null,
  ecriture uuid references compta.ecriture(id) on delete set null,
  saisi_par uuid references socle.utilisateur(id),
  saisi_le timestamptz not null default now(),
  primary key (entreprise, annee),
  check (extract(year from date_inventaire) = annee)
);
alter table compta.inventaire enable row level security;
alter table compta.inventaire force row level security;
create policy visible on compta.inventaire using (entreprise in (select compta.mes_entreprises()));
grant select on compta.inventaire to skanfact_app;

-- `p_inventaire` : { date, compte, lignes: [{ ref, libelle, quantite (millièmes), cout (millimes) }] }.
-- Rend le total, en millimes.
create function compta.poser_inventaire(p_entreprise uuid, p_annee int, p_inventaire jsonb) returns bigint
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x compta.inventaire; l jsonb; k int := 0; v_total bigint := 0; v_date date;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  if coalesce(p_inventaire->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    perform socle.refus('la date de l''inventaire manque : c''est le dernier jour de l''exercice');
  end if;
  v_date := (p_inventaire->>'date')::date;
  if extract(year from v_date) <> p_annee then perform socle.refus(format('l''inventaire de %s se date dans cette année', p_annee)); end if;
  if coalesce(p_inventaire->>'compte', '') !~ '^[0-9]{1,12}$' then perform socle.refus('le compte de stock de l''inventaire manque'); end if;
  if jsonb_typeof(p_inventaire->'lignes') <> 'array' or jsonb_array_length(p_inventaire->'lignes') = 0 then
    perform socle.refus('un inventaire sans une seule ligne ne dit pas « le stock est vide », il dit « rien n''a été compté »');
  end if;
  if jsonb_array_length(p_inventaire->'lignes') > 10000 then perform socle.refus('un inventaire se borne à dix mille lignes'); end if;
  for l in select * from jsonb_array_elements(p_inventaire->'lignes') loop
    k := k + 1;
    if length(trim(coalesce(l->>'libelle', ''))) = 0 then perform socle.refus(format('ligne %s : la désignation manque', k)); end if;
    if jsonb_typeof(l->'quantite') <> 'number' or not socle.sans_virgule(l->'quantite') or (l->>'quantite')::numeric < 0 then
      perform socle.refus(format('ligne %s : une quantité négative ne s''inventorie pas', k));
    end if;
    if jsonb_typeof(l->'cout') <> 'number' or not socle.sans_virgule(l->'cout') or (l->>'cout')::numeric < 0 then
      perform socle.refus(format('ligne %s : un coût unitaire négatif n''existe pas', k));
    end if;
    v_total := v_total + round((l->>'quantite')::numeric * (l->>'cout')::numeric / 1000)::bigint;
  end loop;
  select * into x from compta.inventaire where entreprise = p_entreprise and annee = p_annee for update;
  if found and compta.ecriture_vivante(x.ecriture) then
    perform socle.refus(format('l''inventaire de %s est déjà passé en écriture (la variation de stock) : contre-passe-la ou supprime-la, puis refais-le', p_annee));
  end if;
  insert into compta.inventaire (entreprise, annee, date_inventaire, compte, lignes, total, saisi_par)
  values (p_entreprise, p_annee, v_date, p_inventaire->>'compte', p_inventaire->'lignes', v_total, socle.moi())
  on conflict (entreprise, annee) do update set date_inventaire = excluded.date_inventaire, compte = excluded.compte, lignes = excluded.lignes,
    total = excluded.total, ecriture = null, saisi_par = excluded.saisi_par, saisi_le = now();
  perform socle.tracer(p_entreprise, case when x.entreprise is null then 'compta.inventaire.saisir' else 'compta.inventaire.refaire' end, 'inventaire', null,
    case when x.entreprise is null then null else jsonb_build_object('annee', p_annee, 'total', x.total) end,
    jsonb_build_object('annee', p_annee, 'total', v_total, 'lignes', jsonb_array_length(p_inventaire->'lignes')));
  return v_total;
end $$;

-- Écrire la variation de stock de l'année, au brouillard, et la lier à l'inventaire.
create function compta.ecrire_variation_stock(p_entreprise uuid, p_annee int, p_ecriture jsonb) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x compta.inventaire; v_id uuid;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  select * into x from compta.inventaire where entreprise = p_entreprise and annee = p_annee for update;
  if not found then perform socle.refus(format('aucun inventaire saisi pour %s', p_annee)); end if;
  if compta.ecriture_vivante(x.ecriture) then
    perform socle.refus('la variation de stock de cet exercice est déjà passée : la repasser compterait le stock deux fois');
  end if;
  if coalesce(p_ecriture->>'date', '') not like p_annee || '-%' then
    perform socle.refus(format('la variation de stock de %s se date dans cette année', p_annee));
  end if;
  v_id := compta.saisir(p_entreprise, p_ecriture);
  update compta.inventaire set ecriture = v_id where entreprise = p_entreprise and annee = p_annee;
  return v_id;
end $$;

revoke execute on function compta.poser_inventaire(uuid, int, jsonb), compta.ecrire_variation_stock(uuid, int, jsonb) from public;
grant execute on function compta.poser_inventaire(uuid, int, jsonb), compta.ecrire_variation_stock(uuid, int, jsonb) to skanfact_app;
