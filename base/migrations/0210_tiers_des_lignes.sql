-- 0210 — Le tiers d'une ligne d'écriture (1.358.2 ; docs/revue-modules.md, bout en bout 20).
--
-- Une écriture porte UN tiers (compta.ecriture.tiers) ; une ligne ne portait que son NOM (tiers_libelle). Les à-nouveaux
-- d'un exercice reprennent chaque client sur sa propre ligne d'une même écriture : posés au Cabinet, ils ne gardaient du
-- client que son nom. Au lettrage de l'année suivante, l'hôtel dont la facture de décembre est réglée en janvier apparaissait
-- DEUX fois — l'à-nouveau (3 571 DT dus) sous son nom, le règlement et l'avoir (− 2 595 DT) sous son identifiant —, et la
-- balance âgée le comptait deux fois, dans deux sens. Le moteur partagé gardait l'identifiant (`tiersId`) ; il n'avait pas de
-- case où l'écrire. Une donnée qui n'a pas de case se réinvente, et ce qu'on réinvente est faux.
--   compta.ligne.tiers     : l'identifiant du tiers de la ligne, s'il en a un (un tiers de la même entreprise, sinon rien) ;
--   compta.poser_saisie    : l'écrit depuis `tiersId` (la saisie, les à-nouveaux, l'ouverture) ;
--   compta.poser_miroir    : la contre-passation et l'extourne le recopient, comme le nom.
-- Le sceau d'une écriture (compta.contenu_ecriture) ne change pas : toucher à son contenu ferait échouer la vérification de
-- chaque écriture déjà scellée. L'identifiant ne change aucun montant ni aucun compte ; le nom, qui est scellé, reste.

alter table compta.ligne add column tiers uuid references socle.tiers(id);

create or replace function compta.poser_saisie(p_entreprise uuid, p_id uuid, p_ecriture jsonb, p_nouvelle boolean)
returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare v_date date; v_journal text := p_ecriture->>'journal'; v_libelle text; c date; l jsonb; i int := 0;
        d bigint; cr bigint; td bigint := 0; tc bigint := 0; n int;
begin
  if coalesce(p_ecriture->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then perform socle.refus('la date manque'); end if;
  v_date := (p_ecriture->>'date')::date;
  if v_journal is null or not (v_journal = any (array['VT', 'AC', 'BQ', 'CA', 'OD', 'PAIE', 'AN'])) then
    perform socle.refus('le journal manque : c''est lui qui range l''écriture');
  end if;
  select jusqua into c from compta.cloture where entreprise = p_entreprise;
  if c is not null and v_date <= c then
    perform socle.refus(format('la période est validée jusqu''au %s : une écriture ne s''y écrit plus', to_char(c, 'DD/MM/YYYY')));
  end if;
  n := coalesce(jsonb_array_length(p_ecriture->'lignes'), 0);
  if n < 2 then perform socle.refus('une écriture a au moins deux lignes'); end if;
  v_libelle := left(coalesce(nullif(btrim(p_ecriture->>'libelle'), ''),
    (select nullif(btrim(x.value->>'libelle'), '') from jsonb_array_elements(p_ecriture->'lignes') with ordinality x(value, k)
      where nullif(btrim(x.value->>'libelle'), '') is not null order by x.k limit 1)), 500);
  if v_libelle is null then perform socle.refus('le libellé manque : écris-le sur la pièce ou sur une ligne'); end if;
  for l in select value from jsonb_array_elements(p_ecriture->'lignes') loop
    i := i + 1;
    if coalesce(l->>'compte', '') !~ '^[0-9]{1,12}$' then perform socle.refus(format('ligne %s : le compte doit être un numéro', i)); end if;
    if coalesce(l->>'debit', '0') !~ '^[0-9]{1,15}$' or coalesce(l->>'credit', '0') !~ '^[0-9]{1,15}$' then
      perform socle.refus(format('ligne %s : un montant se lit en millimes, sans signe', i));
    end if;
    d := coalesce(l->>'debit', '0')::bigint; cr := coalesce(l->>'credit', '0')::bigint;
    if d > 0 and cr > 0 then perform socle.refus(format('ligne %s : une ligne va au débit ou au crédit, pas les deux', i)); end if;
    if d = 0 and cr = 0 then perform socle.refus(format('ligne %s : aucun montant', i)); end if;
    td := td + d; tc := tc + cr;
  end loop;
  if td <> tc then
    perform socle.refus(format('débit %s ≠ crédit %s : l''écriture ne tombe pas juste', compta.en_texte(td), compta.en_texte(tc)));
  end if;
  if p_nouvelle then
    insert into compta.ecriture (id, entreprise, journal, date_ecriture, origine_type, origine, famille, rang, piece, libelle, saisie_par)
    values (p_id, p_entreprise, v_journal, v_date, 'saisie', p_id, p_id, 0, left(nullif(btrim(p_ecriture->>'piece'), ''), 200), v_libelle, socle.moi());
  else
    update compta.ecriture set journal = v_journal, date_ecriture = v_date, piece = left(nullif(btrim(p_ecriture->>'piece'), ''), 200),
           libelle = v_libelle, revision = revision + 1
     where id = p_id;
    delete from compta.ligne where ecriture = p_id;
  end if;
  i := 0;
  for l in select value from jsonb_array_elements(p_ecriture->'lignes') loop
    i := i + 1;
    insert into compta.ligne (ecriture, entreprise, rang, compte, libelle, debit, credit, tiers_libelle, tiers)
    values (p_id, p_entreprise, i, l->>'compte', left(coalesce(nullif(btrim(l->>'libelle'), ''), v_libelle), 500),
            coalesce(l->>'debit', '0')::bigint, coalesce(l->>'credit', '0')::bigint, left(nullif(btrim(l->>'tiers'), ''), 200),
            -- Le tiers de la ligne, s'il est un tiers de CETTE entreprise ; sinon rien (son nom reste dans tiers_libelle).
            case when coalesce(l->>'tiersId', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 then (select t.id from socle.tiers t where t.id = (l->>'tiersId')::uuid and t.entreprise = p_entreprise) end);
  end loop;
end $$;
revoke execute on function compta.poser_saisie(uuid, uuid, jsonb, boolean) from public;

create or replace function compta.poser_miroir(x compta.ecriture, p_type text, p_date date, p_libelle text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare v_id uuid := socle.uuidv7();
begin
  insert into compta.ecriture (id, entreprise, journal, date_ecriture, origine_type, origine, famille, rang, piece, tiers, libelle, saisie_par)
  values (v_id, x.entreprise, x.journal, p_date, p_type, x.id, x.famille,
          (select coalesce(max(f.rang), 0) + 1 from compta.ecriture f where f.entreprise = x.entreprise and f.famille = x.famille),
          x.piece, x.tiers, left(replace(coalesce(p_libelle, '{numero}'), '{numero}', x.numero), 500), socle.moi());
  insert into compta.ligne (ecriture, entreprise, rang, compte, libelle, debit, credit, taux_tva, tiers_libelle, tiers)
  select v_id, x.entreprise, y.rang, y.compte, y.libelle, y.credit, y.debit, y.taux_tva, y.tiers_libelle, y.tiers from compta.ligne y where y.ecriture = x.id;
  perform compta.numeroter(v_id);
  return v_id;
end $$;
revoke execute on function compta.poser_miroir(compta.ecriture, text, date, text) from public;
