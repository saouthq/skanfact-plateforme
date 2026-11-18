-- 0221 — Reprendre une écriture rapprochée ne défait plus son rapprochement (1.386.3 ; issue 11, CABSAISIE-15).
--
-- Une écriture écrite depuis la banque est rapprochée du même geste, au brouillard. La fenêtre promet : « Reprendre
-- dans la grille pour ventiler HT et TVA : la ligne 532 reste rapprochée ». Or modifier une écriture refait toutes ses
-- lignes (delete puis insert, 0021) : le rapprochement, attaché à la LIGNE (0023, on delete cascade), partait avec
-- l'ancienne. Lever un compte d'attente (471 → 411) ou ventiler une TVA rendait la ligne du relevé « à traiter », et le
-- mois rapproché ne l'était plus, sans un mot.
--
-- La reprise garde ce qui était rapproché et le rend à la ligne refaite qui porte le même compte et le même montant
-- du même côté : la ligne de banque que la reprise n'a pas touchée. Si elle a changé, le rapprochement n'a plus de
-- raison d'être et ne revient pas : la ligne du relevé redevient à traiter, comme avant.
--
--   compta.poser_saisie (5 arguments) : la même que 0217, avec cette garde.

create or replace function compta.poser_saisie(p_entreprise uuid, p_id uuid, p_ecriture jsonb, p_nouvelle boolean, p_dans_la_periode boolean)
returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare v_date date; v_journal text := p_ecriture->>'journal'; v_libelle text; c date; l jsonb; i int := 0;
        d bigint; cr bigint; td bigint := 0; tc bigint := 0; n int; v_gardes jsonb := '[]'::jsonb;
begin
  if coalesce(p_ecriture->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then perform socle.refus('la date manque'); end if;
  v_date := (p_ecriture->>'date')::date;
  if v_journal is null or not (v_journal = any (array['VT', 'AC', 'BQ', 'CA', 'OD', 'PAIE', 'AN'])) then
    perform socle.refus('le journal manque : c''est lui qui range l''écriture');
  end if;
  select jusqua into c from compta.cloture where entreprise = p_entreprise;
  if c is not null and v_date <= c and not coalesce(p_dans_la_periode, false)
     -- Un exercice rouvert dans la période validée reste écrivable dans ses propres dates.
     and not exists (select 1 from compta.exercice x where x.entreprise = p_entreprise and x.rouvert_le is not null
                       and x.clos_le is null and v_date between x.du and x.au)
     -- Les à-nouveaux de l'année qui suit un exercice rouvert se complètent à son premier jour.
     and not (v_journal = 'AN' and exists (select 1 from compta.exercice x where x.entreprise = p_entreprise and x.clos_le is null
                and x.du = v_date and exists (select 1 from compta.reouverture r where r.entreprise = p_entreprise and r.annee = x.annee - 1))) then
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
    -- (0221) Ce que la banque a rapproché sur les lignes de cette écriture, avant de les refaire.
    select coalesce(jsonb_agg(jsonb_build_object('rl', a.releve_ligne, 'rang', a.rang, 'compte', g.compte, 'debit', g.debit, 'credit', g.credit,
             'niveau', a.niveau, 'auto', a.auto, 'par', a.pose_par, 'le', a.pose_le) order by a.releve_ligne, a.rang), '[]'::jsonb)
      into v_gardes
      from compta.rapprochement a join compta.ligne g on g.id = a.ligne
     where g.ecriture = p_id;
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
  -- (0221) Chaque rapprochement retrouve SA ligne : même compte, même débit, même crédit — la ligne de banque que la
  -- reprise n'a pas touchée. Une ligne de banque changée (son compte, son montant) ne se rapproche plus toute seule.
  for l in select value from jsonb_array_elements(v_gardes) loop
    insert into compta.rapprochement (releve_ligne, rang, ligne, entreprise, niveau, auto, pose_par, pose_le)
    select (l->>'rl')::uuid, (l->>'rang')::smallint, g.id, p_entreprise, l->>'niveau', (l->>'auto')::boolean,
           nullif(l->>'par', '')::uuid, (l->>'le')::timestamptz
      from compta.ligne g
     where g.ecriture = p_id and g.compte = l->>'compte' and g.debit = (l->>'debit')::bigint and g.credit = (l->>'credit')::bigint
       and not exists (select 1 from compta.rapprochement r where r.ligne = g.id)
     order by g.rang limit 1;
  end loop;
end $$;
