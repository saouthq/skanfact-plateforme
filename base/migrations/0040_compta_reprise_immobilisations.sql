-- Les immobilisations reprises avec le livre du Cabinet v10 (brique 67, 30/09/2026 ; docs/cabinet.md,
-- C57). La v10 tenait les biens dans le livre de chaque exercice (un bien « reporté » d'une année à
-- l'autre) ; la plateforme garde UNE fiche par bien pour toute la vie de l'entreprise (0026). Reprendre
-- un bien :
--   - seulement dans un dossier que le cabinet de la personne tient, qui est en train de reprendre ;
--   - s'il est déjà là (une autre année reprise avant : même libellé, même compte, même mise en
--     service, même valeur), il n'est pas recréé ; mais si son plan d'amortissement diffère, la
--     reprise s'arrête en le disant : une dotation déjà écrite serait fausse d'un côté ou de l'autre ;
--   - sinon sa fiche se pose par le geste ordinaire (compta.poser_immobilisation), qui refait ses
--     contrôles ;
--   - chaque écriture REPRISE de l'année qui porte sa dotation ou sa sortie lui est reliée : c'est ce
--     qui empêche de la passer une seconde fois.

create function compta.reprendre_immobilisation_v10(p_entreprise uuid, p_annee int, p_fiche jsonb, p_liens jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare x compta.immobilisation; v_id uuid; v_cree boolean := false; k text; l jsonb; v_ecriture uuid; v_n int := 0;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  if socle.perimetre_cabinet(p_entreprise) is null
     or not exists (select 1 from socle.entreprise where id = p_entreprise and tenue_par is not null) then
    perform socle.refus('la reprise d''un livre de la v10 s''écrit dans un dossier que ton cabinet tient');
  end if;
  select * into x from compta.immobilisation i where i.entreprise = p_entreprise and i.fiche->'libelle' = p_fiche->'libelle'
    and i.fiche->'compte' = p_fiche->'compte' and i.fiche->'dateMiseEnService' = p_fiche->'dateMiseEnService' and i.fiche->'valeur' = p_fiche->'valeur'
    order by i.cree_le, i.id limit 1 for update;
  if found then
    foreach k in array compta.champs_du_plan() loop
      if (x.fiche->k) is distinct from (p_fiche->k) then
        perform socle.refus(format('le bien « %s » est déjà dans ce dossier avec un autre plan d''amortissement : la reprise ne le change pas. Mets les deux d''accord, puis reprends le livre', x.fiche->>'libelle'));
      end if;
    end loop;
    v_id := x.id;
  else
    select r_id into v_id from compta.poser_immobilisation(p_entreprise, null, p_fiche, null);
    v_cree := true;
  end if;
  for l in select value from jsonb_array_elements(coalesce(p_liens, '[]'::jsonb)) loop
    v_ecriture := (l->>'ecriture')::uuid;
    if coalesce(l->>'genre', '') not in ('dotation', 'cession')
       or not exists (select 1 from compta.ecriture e where e.id = v_ecriture and e.entreprise = p_entreprise
                        and e.origine_type = 'reprise_v10' and extract(year from e.date_ecriture)::int = p_annee) then
      perform socle.refus(format('une écriture liée au bien « %s » n''est pas une écriture reprise de %s', p_fiche->>'libelle', p_annee));
    end if;
    if exists (select 1 from compta.immobilisation_ecriture i where i.immobilisation = v_id and i.annee = p_annee and i.genre = l->>'genre') then
      perform socle.refus(format('la %s %s du bien « %s » est déjà reliée à une écriture', case l->>'genre' when 'dotation' then 'dotation' else 'sortie' end, p_annee, p_fiche->>'libelle'));
    end if;
    insert into compta.immobilisation_ecriture (immobilisation, annee, genre, ecriture, entreprise) values (v_id, p_annee, l->>'genre', v_ecriture, p_entreprise);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('id', v_id, 'cree', v_cree, 'liees', v_n);
end $$;
revoke execute on function compta.reprendre_immobilisation_v10(uuid, int, jsonb, jsonb) from public;
grant execute on function compta.reprendre_immobilisation_v10(uuid, int, jsonb, jsonb) to skanfact_app;
