-- 0217 — Deux portes dans la période validée (1.378.0 ; issue 9, CABDECLARER-1 et CABDECLARER-2).
--
-- « Valider la période » ferme tous les jours jusqu'à une date (0018, 0021). Deux gestes ordinaires d'un cabinet
-- s'y cognaient sans aucune issue :
--
-- 1. L'ÉCRITURE DE LA DÉCLARATION. L'ordre naturel : je valide les écritures du mois, je révise, je déclare, je passe
--    l'écriture de TVA. « Écrire l'écriture du mois » répondait « la période est validée jusqu'au 31/10 : une écriture
--    ne s'y écrit plus », pour toujours, et le compte de TVA à décaisser restait non soldé.
--    Cette écriture n'est pas une saisie : le logiciel la calcule, des comptes de TVA du mois vers le compte de l'État,
--    et elle ne change ni un produit ni une charge. Dans un mois déjà validé, elle est POSÉE ET VALIDÉE D'UN GESTE
--    (numérotée et scellée, comme une contre-passation, 0021), par quelqu'un qui a le droit de VALIDER.
--    Hors de la période validée, rien ne change : elle entre au brouillard.
--
-- 2. ROUVRIR UN EXERCICE CLOS quand des mois de l'année suivante sont déjà validés — c'est-à-dire toujours : en mars,
--    quand arrive la facture en retard de décembre, janvier et février sont validés. La réouverture était refusée
--    (« le rouvrir rouvrirait aussi ces jours-là »). Elle ne touche plus à la période validée : l'exercice rouvert
--    redevient écrivable DANS SES PROPRES DATES (compta.exercice.rouvert_le), les mois validés de l'année suivante
--    restent fermés. Ce qui s'y écrit entre au brouillard et se valide pièce par pièce ; la clôture, refaite, referme
--    la porte (elle exige déjà qu'il ne reste rien au brouillard). Et les à-nouveaux de l'année suivante, qui se
--    complètent au 1er janvier — un jour validé —, passent eux aussi : journal AN, premier jour d'un exercice non clos
--    dont le précédent a été rouvert.
--
--   compta.poser_saisie (5 arguments) : la même que 0210, avec ces portes ;
--   compta.poser_saisie (4 arguments) : inchangée pour ses appelants ;
--   compta.ecrire_declaration        : rend l'identifiant ET si l'écriture est déjà validée ;
--   compta.rouvrir_exercice          : ne refuse plus, et dit lequel des deux cas s'applique.

alter table compta.exercice add column rouvert_le timestamptz;

create function compta.poser_saisie(p_entreprise uuid, p_id uuid, p_ecriture jsonb, p_nouvelle boolean, p_dans_la_periode boolean)
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
revoke execute on function compta.poser_saisie(uuid, uuid, jsonb, boolean, boolean) from public;

create or replace function compta.poser_saisie(p_entreprise uuid, p_id uuid, p_ecriture jsonb, p_nouvelle boolean)
returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
begin
  perform compta.poser_saisie(p_entreprise, p_id, p_ecriture, p_nouvelle, false);
end $$;
revoke execute on function compta.poser_saisie(uuid, uuid, jsonb, boolean) from public;

drop function compta.ecrire_declaration(uuid, text, jsonb, boolean);
create function compta.ecrire_declaration(p_entreprise uuid, p_periode text, p_ecriture jsonb, p_complement boolean)
returns table (r_id uuid, r_validee boolean)
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare d compta.declaration; v_id uuid; c date; v_dedans boolean;
begin
  perform compta.exiger_declarer(p_entreprise);
  select * into d from compta.declaration where entreprise = p_entreprise and type = 'mensuelle' and periode = p_periode for update;
  if not found then perform socle.refus('prépare la déclaration avant d''en écrire l''écriture'); end if;
  if coalesce(p_ecriture->>'date', '') !~ ('^' || p_periode || '-\d{2}$') then
    perform socle.refus(format('l''écriture de la déclaration de %s se date dans ce mois', compta.mois_en_texte(p_periode)));
  end if;
  if not coalesce(p_complement, false) and compta.ecriture_vivante(d.ecriture) then
    perform socle.refus('l''écriture de cette déclaration existe déjà dans le livre : la repasser compterait la TVA du mois deux fois');
  end if;
  select jusqua into c from compta.cloture where entreprise = p_entreprise;
  v_dedans := c is not null and p_ecriture->>'date' <= to_char(c, 'YYYY-MM-DD');
  if v_dedans then
    -- Le mois est déjà validé : l'écriture se pose et se valide d'un geste, par quelqu'un qui a le droit de valider.
    perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
    v_id := socle.uuidv7();
    perform compta.poser_saisie(p_entreprise, v_id, p_ecriture, true, true);
    perform socle.tracer(p_entreprise, 'compta.ecriture.saisir', 'ecriture', v_id, null, p_ecriture);
    perform compta.numeroter(v_id);
    perform socle.tracer(p_entreprise, 'compta.ecritures.valider', 'ecriture', null, null,
      jsonb_build_object('ecritures', to_jsonb(array[v_id]), 'declaration', p_periode));
  else
    v_id := compta.saisir(p_entreprise, p_ecriture);
  end if;
  if not coalesce(p_complement, false) then update compta.declaration set ecriture = v_id where id = d.id; end if;
  r_id := v_id; r_validee := v_dedans;
  return next;
end $$;
revoke execute on function compta.ecrire_declaration(uuid, text, jsonb, boolean) from public;
grant execute on function compta.ecrire_declaration(uuid, text, jsonb, boolean) to skanfact_app;

-- Rouvrir un exercice clos, avec son motif. Rend vrai quand la période validée va au-delà de l'exercice : elle ne
-- bouge alors pas, et seul l'exercice rouvert redevient écrivable.
drop function compta.rouvrir_exercice(uuid, int, text);
create function compta.rouvrir_exercice(p_entreprise uuid, p_annee int, p_motif text) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x compta.exercice; c date; v_motif text := btrim(coalesce(p_motif, '')); v_dedans boolean;
begin
  perform compta.exiger_cloture(p_entreprise);
  select * into x from compta.exercice where entreprise = p_entreprise and annee = p_annee for update;
  if not found or x.clos_le is null then perform socle.refus('cet exercice n''est pas clos'); end if;
  if length(v_motif) < 5 then
    perform socle.refus('une réouverture demande un motif : c''est la seule trace qui expliquera pourquoi un chiffre a changé après coup');
  end if;
  if length(v_motif) > 500 then perform socle.refus('un motif se dit en cinq cents caractères au plus'); end if;
  select jusqua into c from compta.cloture where entreprise = p_entreprise for update;
  v_dedans := c is not null and c > x.au;
  insert into compta.reouverture (entreprise, annee, clos_le, clos_par, rouvert_par, motif)
  values (p_entreprise, p_annee, x.clos_le, x.clos_par, socle.moi(), v_motif);
  if not v_dedans then
    -- La période close revient où elle était : rien de validé avant la clôture, rien de clos après.
    if x.jusqua_avant is null then delete from compta.cloture where entreprise = p_entreprise;
    else update compta.cloture set jusqua = x.jusqua_avant, par = socle.moi(), le = now() where entreprise = p_entreprise; end if;
  end if;
  update compta.exercice set clos_le = null, clos_par = null, jusqua_avant = null,
         rouvert_le = case when v_dedans then now() end
   where entreprise = p_entreprise and annee = p_annee;
  perform socle.tracer(p_entreprise, 'compta.exercice.rouvrir', 'exercice', null, jsonb_build_object('clos_le', x.clos_le),
    jsonb_build_object('annee', p_annee, 'motif', v_motif, 'periode_validee_gardee', v_dedans));
  return v_dedans;
end $$;
revoke execute on function compta.rouvrir_exercice(uuid, int, text) from public;
grant execute on function compta.rouvrir_exercice(uuid, int, text) to skanfact_app;
