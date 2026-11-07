-- (1.319.0) L'état du stock que le client envoie à son comptable, lu par qui lit ses livres (le Stock joué le 07/11/2026,
-- décidé par délégation). Un client SkanFact tient son stock au coût moyen ; le serveur n'en écrit jamais la variation dans
-- ses livres, et le cabinet devait recopier l'inventaire d'un tableur, ligne à ligne, pour que le bilan ait un stock. Le
-- client envoie désormais l'état de son stock à une date (`etatsStock` de son dossier : les articles qui ont du stock, leur
-- quantité, leur coût moyen au millime et leur valeur) ; son cabinet le LIT, sous un mandat qui comprend la comptabilité
-- (compta.mes_entreprises), sans jamais l'écrire, et le reprend comme inventaire.
create policy etat_du_stock_au_cabinet on socle.dossier_v10 for select using (
  collection = 'etatsStock' and entreprise in (select compta.mes_entreprises()));

-- Une ligne d'inventaire peut dire sa VALEUR : celle de la page Stock du client, dont le coût unitaire n'est que la valeur
-- divisée par la quantité, arrondie au millime (37 pots valent 2 281,659 ; 37 × 61,666 = 2 281,642). Sans elle, l'inventaire
-- repris valait quelques millimes de plus ou de moins que la page Stock du client, et la variation de stock aussi. La valeur
-- reste la quantité fois le coût, à l'arrondi près : un demi-millime par unité, plus le millime de son propre arrondi. Une
-- ligne sans valeur se calcule comme avant (quantité fois coût).
create or replace function compta.poser_inventaire(p_entreprise uuid, p_annee int, p_inventaire jsonb) returns bigint
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x compta.inventaire; l jsonb; k int := 0; v_total bigint := 0; v_date date; v_calcule numeric;
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
    v_calcule := (l->>'quantite')::numeric * (l->>'cout')::numeric / 1000;
    if l ? 'valeur' then
      if jsonb_typeof(l->'valeur') <> 'number' or not socle.sans_virgule(l->'valeur') or (l->>'valeur')::numeric < 0 then
        perform socle.refus(format('ligne %s : une valeur négative ne s''inventorie pas', k));
      end if;
      if abs((l->>'valeur')::numeric - v_calcule) > (l->>'quantite')::numeric / 2000 + 1 then
        perform socle.refus(format('ligne %s : la valeur n''est pas la quantité fois le coût unitaire', k));
      end if;
      v_total := v_total + (l->>'valeur')::bigint;
    else
      v_total := v_total + round(v_calcule)::bigint;
    end if;
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
