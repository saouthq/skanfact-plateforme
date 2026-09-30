-- La reprise d'un livre du Cabinet v10 dans un dossier tenu (brique 63, 30/09/2026 ; docs/cabinet.md,
-- C53). L'essai à blanc (brique 62) a lu et contrôlé le livre ; ici ses écritures s'écrivent, UNE fois,
-- dans l'exercice du dossier :
--   - seulement un dossier TENU par le cabinet de la personne (un client sur SkanFact passera avec son
--     propre fichier, 08 § 2.4), et un exercice sans aucune écriture : la reprise ne se mélange jamais
--     à un livre commencé ;
--   - une écriture validée dans la v10 garde SON numéro, dans la forme de la plateforme
--     (<journal>-<année>-<numéro v10 sur six chiffres>) : un numéro déjà imprimé ne change jamais ;
--     chaque journal continue ensuite au plus grand numéro repris plus un (C52) ;
--   - la chaîne des livres scelle les validées dans l'ordre de leurs numéros ; la trace de la reprise
--     porte l'empreinte du fichier envoyé (08 § 2.2 : la chaîne commence à la reprise) ;
--   - la période se valide jusqu'au dernier jour où tout est validé (la veille du premier brouillard,
--     et pas après la dernière validée) ; le brouillard de la v10 reste au brouillard.
-- Les contrôles de la saisie (0021) sont refaits ici, écriture par écriture : la base ne croit pas
-- l'essai à blanc sur parole.

alter table compta.ecriture drop constraint ecriture_origine_type_check;
alter table compta.ecriture add constraint ecriture_origine_type_check
  check (origine_type in ('vente', 'encaissement', 'achat', 'imputation', 'reglement_fournisseur', 'paie', 'salaires', 'avance',
                          'contre_passation', 'saisie', 'extourne', 'reprise_v10'));

create function compta.reprendre_livre_v10(p_entreprise uuid, p_annee int, p_du date, p_au date, p_ecritures jsonb, p_empreinte text)
returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x jsonb; l jsonb; v_id uuid; v_date date; v_journal text; i int; d bigint; cr bigint; td bigint; tc bigint; n int;
        v_num bigint; v_numero text; m record; c date; v_validees int := 0; v_brouillard int := 0;
        v_jusqua date; v_premier_brouillard date; v_derniere_validee date; e record;
        v_ids uuid[] := '{}'; v_nums bigint[] := '{}'; v_jnx text[] := '{}';
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
    insert into compta.ecriture (id, entreprise, journal, date_ecriture, origine_type, origine, famille, rang, piece, libelle, saisie_par)
    values (v_id, p_entreprise, v_journal, v_date, 'reprise_v10', v_id, v_id, 0, left(nullif(btrim(x->>'piece'), ''), 200),
            left(coalesce(nullif(btrim(x->>'libelle'), ''), v_journal || ' ' || to_char(v_date, 'DD/MM/YYYY')), 500), socle.moi());
    i := 0;
    for l in select value from jsonb_array_elements(x->'lignes') loop
      i := i + 1;
      insert into compta.ligne (ecriture, entreprise, rang, compte, libelle, debit, credit, tiers_libelle)
      values (v_id, p_entreprise, i, l->>'compte',
              left(coalesce(nullif(btrim(l->>'libelle'), ''), nullif(btrim(x->>'libelle'), ''), v_journal), 500),
              (coalesce(l->>'debit', '0'))::bigint, (coalesce(l->>'credit', '0'))::bigint, left(nullif(btrim(l->>'tiers'), ''), 200));
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
  -- La période validée : jusqu'au dernier jour où tout est validé.
  if v_derniere_validee is not null then
    v_jusqua := case when v_premier_brouillard is null then v_derniere_validee else least(v_derniere_validee, v_premier_brouillard - 1) end;
    if v_jusqua >= p_du then
      insert into compta.cloture (entreprise, jusqua, par) values (p_entreprise, v_jusqua, socle.moi())
      on conflict (entreprise) do update set jusqua = excluded.jusqua, par = excluded.par, le = now();
    end if;
  end if;
  perform socle.tracer(p_entreprise, 'compta.reprise.livre_v10', 'exercice', null, null,
    jsonb_build_object('annee', p_annee, 'validees', v_validees, 'brouillard', v_brouillard, 'empreinte', p_empreinte, 'jusqua', v_jusqua));
  return jsonb_build_object('validees', v_validees, 'brouillard', v_brouillard, 'jusqua', v_jusqua);
end $$;
revoke execute on function compta.reprendre_livre_v10(uuid, int, date, date, jsonb, text) from public;
grant execute on function compta.reprendre_livre_v10(uuid, int, date, date, jsonb, text) to skanfact_app;
