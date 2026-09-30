-- Les relevés bancaires repris avec le livre du Cabinet v10 (brique 66, 30/09/2026 ; docs/cabinet.md,
-- C56). La reprise rend maintenant, dans l'ordre du livre, l'identifiant de chaque écriture écrite :
-- le serveur y relie les rapprochements des relevés (une ligne de relevé → la ligne d'écriture reprise),
-- qu'il importe ensuite par les gestes de la banque (compta.importer_releve, compta.rapprocher, 0023),
-- dans la même transaction : chacun refait ses contrôles (le relevé se boucle, le même fichier ne
-- s'importe pas deux fois, la ligne en face touche le compte du relevé, une seule fois). Le reste de la
-- fonction est celui de 0038.

create or replace function compta.reprendre_livre_v10(p_entreprise uuid, p_annee int, p_du date, p_au date, p_ecritures jsonb, p_empreinte text)
returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x jsonb; l jsonb; v_id uuid; v_date date; v_journal text; i int; d bigint; cr bigint; td bigint; tc bigint; n int;
        v_num bigint; v_numero text; m record; c date; v_validees int := 0; v_brouillard int := 0;
        v_jusqua date; v_premier_brouillard date; v_derniere_validee date; e record;
        v_ids uuid[] := '{}'; v_nums bigint[] := '{}'; v_jnx text[] := '{}';
        v_lids uuid[] := '{}'; v_lcomptes text[] := '{}'; v_llettres text[] := '{}'; v_lid uuid; g record;
        v_lettre text; v_rang bigint; v_lettrage uuid; v_renommees jsonb := '[]'; v_nlettrages int := 0;
        v_toutes uuid[] := '{}';
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  if socle.perimetre_cabinet(p_entreprise) is null
     or not exists (select 1 from socle.entreprise where id = p_entreprise and tenue_par is not null) then
    perform socle.refus('la reprise d''un livre de la v10 s''écrit dans un dossier que ton cabinet tient');
  end if;
  if p_annee is null or p_du is null or p_au is null or p_au < p_du or extract(year from p_du)::int <> p_annee then
    perform socle.refus('l''exercice du livre ne se lit pas');
  end if;
  if exists (select 1 from compta.ecriture where entreprise = p_entreprise and date_ecriture between p_du and p_au) then
    perform socle.refus(format('le livre de %s de ce dossier a déjà des écritures : une reprise ne s''écrit que dans un exercice vide', p_annee));
  end if;
  select jusqua into c from compta.cloture where entreprise = p_entreprise for update;
  if c is not null and c >= p_du then
    perform socle.refus(format('la période est validée jusqu''au %s : une reprise ne s''y écrit plus', to_char(c, 'DD/MM/YYYY')));
  end if;
  if exists (select 1 from compta.exercice where entreprise = p_entreprise and annee = p_annee and clos_le is not null) then
    perform socle.refus(format('l''exercice %s est clos', p_annee));
  end if;
  insert into compta.exercice (entreprise, annee, du, au, ouvert_par) values (p_entreprise, p_annee, p_du, p_au, socle.moi())
  on conflict (entreprise, annee) do nothing;

  -- Chaque écriture : contrôlée, écrite au brouillard.
  for x in select value from jsonb_array_elements(coalesce(p_ecritures, '[]'::jsonb)) loop
    v_journal := x->>'journal';
    if coalesce(x->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then perform socle.refus('une écriture de la reprise n''a pas de date'); end if;
    v_date := (x->>'date')::date;
    if v_date < p_du or v_date > p_au then perform socle.refus(format('une écriture du %s tombe hors de l''exercice', to_char(v_date, 'DD/MM/YYYY'))); end if;
    if v_journal is null or not (v_journal = any (array['VT', 'AC', 'BQ', 'CA', 'OD', 'PAIE', 'AN'])) then
      perform socle.refus(format('le journal « %s » n''existe pas sur la plateforme', coalesce(v_journal, '')));
    end if;
    n := coalesce(jsonb_array_length(x->'lignes'), 0);
    if n < 2 then perform socle.refus('une écriture a au moins deux lignes'); end if;
    td := 0; tc := 0;
    for l in select value from jsonb_array_elements(x->'lignes') loop
      if coalesce(l->>'compte', '') !~ '^[0-9]{1,12}$' then perform socle.refus('un compte de la reprise ne s''écrit pas en chiffres'); end if;
      if coalesce(l->>'debit', '0') !~ '^[0-9]{1,15}$' or coalesce(l->>'credit', '0') !~ '^[0-9]{1,15}$' then
        perform socle.refus('un montant de la reprise ne se lit pas en millimes');
      end if;
      d := (coalesce(l->>'debit', '0'))::bigint; cr := (coalesce(l->>'credit', '0'))::bigint;
      if (d > 0) = (cr > 0) then perform socle.refus('une ligne de la reprise va au débit ou au crédit, jamais aux deux ni à aucun'); end if;
      td := td + d; tc := tc + cr;
    end loop;
    if td <> tc then perform socle.refus(format('une écriture du %s ne tombe pas juste', to_char(v_date, 'DD/MM/YYYY'))); end if;
    v_id := socle.uuidv7();
    v_toutes := v_toutes || v_id;
    insert into compta.ecriture (id, entreprise, journal, date_ecriture, origine_type, origine, famille, rang, piece, libelle, saisie_par)
    values (v_id, p_entreprise, v_journal, v_date, 'reprise_v10', v_id, v_id, 0, left(nullif(btrim(x->>'piece'), ''), 200),
            left(coalesce(nullif(btrim(x->>'libelle'), ''), v_journal || ' ' || to_char(v_date, 'DD/MM/YYYY')), 500), socle.moi());
    i := 0;
    for l in select value from jsonb_array_elements(x->'lignes') loop
      i := i + 1;
      insert into compta.ligne (ecriture, entreprise, rang, compte, libelle, debit, credit, tiers_libelle)
      values (v_id, p_entreprise, i, l->>'compte',
              left(coalesce(nullif(btrim(l->>'libelle'), ''), nullif(btrim(x->>'libelle'), ''), v_journal), 500),
              (coalesce(l->>'debit', '0'))::bigint, (coalesce(l->>'credit', '0'))::bigint, left(nullif(btrim(l->>'tiers'), ''), 200))
      returning id into v_lid;
      if coalesce(l->>'lettre', '') <> '' then
        v_lids := v_lids || v_lid; v_lcomptes := v_lcomptes || (l->>'compte'); v_llettres := v_llettres || (l->>'lettre');
      end if;
    end loop;
    if x->>'statut' = 'validee' then
      if coalesce(x->>'numero', '') !~ '^[0-9]{1,6}$' then perform socle.refus('une écriture validée de la reprise n''a pas de numéro'); end if;
      if (x->>'numero')::bigint = any (v_nums) then
        perform socle.refus(format('le numéro %s de la v10 revient deux fois', x->>'numero'));
      end if;
      v_ids := v_ids || v_id; v_nums := v_nums || (x->>'numero')::bigint; v_jnx := v_jnx || v_journal;
      v_validees := v_validees + 1;
      v_derniere_validee := greatest(v_derniere_validee, v_date);
    else
      v_brouillard := v_brouillard + 1;
      v_premier_brouillard := least(v_premier_brouillard, v_date);
    end if;
  end loop;

  -- Les validées, dans l'ordre de leurs numéros : leur numéro de la v10, leur maillon de la chaîne.
  for e in select r.id, r.numero, r.journal from unnest(v_ids, v_nums, v_jnx) r(id, numero, journal) order by r.numero loop
    v_numero := e.journal || '-' || p_annee || '-' || lpad(e.numero::text, 6, '0');
    select * into m from socle.sceller(p_entreprise, 'livres:' || p_entreprise::text, 'ecriture', e.id, compta.contenu_ecriture(e.id, v_numero));
    update compta.ecriture set statut = 'validee', numero = v_numero, chaine_rang = m.rang, empreinte = m.empreinte where id = e.id;
  end loop;
  -- Chaque journal continue au plus grand numéro repris.
  for e in select r.journal, max(r.numero) dernier from unnest(v_nums, v_jnx) r(numero, journal) group by r.journal loop
    insert into compta.compteur (entreprise, journal, annee, dernier) values (p_entreprise, e.journal, p_annee, e.dernier)
    on conflict (entreprise, journal, annee) do update set dernier = greatest(compta.compteur.dernier, excluded.dernier);
  end loop;
  -- Les lettrages du livre (brique 65) : chaque lettre relie des lignes d'un seul compte, d'au moins
  -- deux écritures validées, dont la somme est nulle. La lettre de la v10 est gardée si elle est libre
  -- dans le dossier ; sinon (une autre année l'a prise) la suivante libre, et le résultat le dit.
  for g in select r.lettre, min(r.compte) compte, count(distinct r.compte) nc, array_agg(r.id) lignes
             from unnest(v_lids, v_lcomptes, v_llettres) r(id, compte, lettre) group by r.lettre order by r.lettre loop
    if g.nc <> 1 or g.lettre !~ '^[A-Z]{1,5}$'
       or exists (select 1 from compta.ligne l join compta.ecriture w on w.id = l.ecriture where l.id = any (g.lignes) and w.statut <> 'validee')
       or (select count(distinct l.ecriture) from compta.ligne l where l.id = any (g.lignes)) < 2
       or (select sum(l.debit - l.credit) from compta.ligne l where l.id = any (g.lignes)) <> 0 then
      perform socle.refus(format('la lettre %s de la reprise ne se reprend pas telle quelle', g.lettre));
    end if;
    v_lettre := g.lettre; v_rang := null;
    if exists (select 1 from compta.lettrage lt where lt.entreprise = p_entreprise and lt.lettre = v_lettre) then
      select coalesce(max(lt.rang), 0) + 1 into v_rang from compta.lettrage lt where lt.entreprise = p_entreprise;
      loop
        v_lettre := compta.lettre_de(v_rang);
        exit when not exists (select 1 from compta.lettrage lt where lt.entreprise = p_entreprise and lt.lettre = v_lettre) and not (v_lettre = any (v_llettres));
        v_rang := v_rang + 1;
      end loop;
      v_renommees := v_renommees || jsonb_build_object('v10', g.lettre, 'lettre', v_lettre);
    end if;
    insert into compta.lettrage (entreprise, compte, lettre, rang, cree_par) values (p_entreprise, g.compte, v_lettre, v_rang, socle.moi())
    returning id into v_lettrage;
    insert into compta.ligne_lettree (ligne, lettrage, entreprise) select u.ligne, v_lettrage, p_entreprise from unnest(g.lignes) u(ligne);
    v_nlettrages := v_nlettrages + 1;
  end loop;
  -- La période validée : jusqu'au dernier jour où tout est validé.
  if v_derniere_validee is not null then
    v_jusqua := case when v_premier_brouillard is null then v_derniere_validee else least(v_derniere_validee, v_premier_brouillard - 1) end;
    if v_jusqua >= p_du then
      insert into compta.cloture (entreprise, jusqua, par) values (p_entreprise, v_jusqua, socle.moi())
      on conflict (entreprise) do update set jusqua = excluded.jusqua, par = excluded.par, le = now();
    end if;
  end if;
  perform socle.tracer(p_entreprise, 'compta.reprise.livre_v10', 'exercice', null, null,
    jsonb_build_object('annee', p_annee, 'validees', v_validees, 'brouillard', v_brouillard, 'lettrages', v_nlettrages, 'empreinte', p_empreinte, 'jusqua', v_jusqua));
  return jsonb_build_object('validees', v_validees, 'brouillard', v_brouillard, 'lettrages', v_nlettrages, 'lettres', v_renommees, 'jusqua', v_jusqua,
    'ids', to_jsonb(v_toutes));
end $$;
