-- 1.299.0 : la remise de chèques au Cabinet. La banque crédite en UNE ligne trois chèques que le livre porte un par un
-- (l'entreprise les a notés à leur arrivée, le pont en a fait trois écritures) : une ligne de relevé répond maintenant de
-- plusieurs lignes d'écriture. Une ligne d'écriture, elle, ne répond toujours que d'une seule ligne de relevé (`ligne`
-- reste unique) : sinon le même chèque compterait dans deux remises. `rang` garde l'ordre de la pose (1 : l'écriture que
-- la ligne désigne, puis les autres), pour que le livre relu dise la même chose que ce qui a été posé.
alter table compta.rapprochement drop constraint rapprochement_pkey;
alter table compta.rapprochement add column rang smallint not null default 1 check (rang between 1 and 50);
alter table compta.rapprochement add primary key (releve_ligne, rang);

-- `p_poses` = [{ ligne (du relevé), ecritureLigne (la ligne d'écriture, ou null pour défaire), autres ([les autres lignes
-- d'écriture d'une remise]), niveau, auto }]. Ce qui ne change pas de 0023 : le jugement sans écriture se garde sur la
-- ligne du relevé ; chaque ligne d'écriture touche le compte du relevé et ne répond pas déjà d'une autre ligne. Ce qui
-- s'ajoute : une remise (des `autres`) ne se pose que si ses lignes font la ligne du relevé AU MILLIME, sans doublon, à
-- cinquante au plus ; sinon le relevé dirait « rapproché » d'un montant qui n'est pas le sien.
create or replace function compta.rapprocher(p_entreprise uuid, p_releve uuid, p_poses jsonb) returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare r record; p jsonb; v_ligne uuid; v_face uuid; v_faces uuid[]; v_niveau text; v_compte text; v_n int := 0;
        v_montant bigint; v_somme bigint; i int;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  select compte into r from compta.releve where id = p_releve and entreprise = p_entreprise;
  if not found then perform socle.refus('ce relevé n''existe pas'); end if;
  for p in select * from jsonb_array_elements(p_poses) loop
    v_ligne := (p->>'ligne')::uuid;
    v_face := nullif(p->>'ecritureLigne', '')::uuid;
    v_niveau := coalesce(p->>'niveau', 'aucun');
    select montant into v_montant from compta.releve_ligne where id = v_ligne and releve = p_releve;
    if not found then perform socle.refus('cette ligne de relevé n''existe pas'); end if;
    if v_face is null then
      if v_niveau not in ('aucun', 'probable', 'a-confirmer') then perform socle.refus('un jugement sans écriture en face est « probable », « à confirmer » ou « aucun »'); end if;
      delete from compta.rapprochement where releve_ligne = v_ligne;
      update compta.releve_ligne set niveau = v_niveau where id = v_ligne;
    else
      if v_niveau not in ('certain', 'probable', 'a-confirmer') then perform socle.refus('un rapprochement posé ne peut pas être « aucun » : c''est ce que veut dire le défaire'); end if;
      v_faces := array[v_face] || coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'autres', '[]'::jsonb)) x), '{}'::uuid[]);
      if cardinality(v_faces) > 50 then perform socle.refus('une ligne de relevé se rapproche de cinquante écritures au plus'); end if;
      if (select count(distinct x) from unnest(v_faces) x) <> cardinality(v_faces) then
        perform socle.refus('la même ligne d''écriture est choisie deux fois');
      end if;
      v_somme := 0;
      for i in 1 .. cardinality(v_faces) loop
        select l.compte, l.debit - l.credit into v_compte, v_montant from compta.ligne l where l.id = v_faces[i] and l.entreprise = p_entreprise;
        if not found then perform socle.refus('cette écriture n''existe pas'); end if;
        if v_compte <> r.compte then perform socle.refus(format('cette ligne d''écriture ne touche pas le compte %s', r.compte)); end if;
        if exists (select 1 from compta.rapprochement where ligne = v_faces[i] and releve_ligne <> v_ligne) then
          perform socle.refus('cette ligne d''écriture répond déjà d''une autre ligne de relevé : défais ce rapprochement d''abord');
        end if;
        v_somme := v_somme + v_montant;
      end loop;
      if cardinality(v_faces) > 1 then
        select montant into v_montant from compta.releve_ligne where id = v_ligne;
        if v_somme <> v_montant then
          perform socle.refus(format('les %s écritures font %s, la ligne du relevé %s : une remise se rapproche quand ses écritures font la ligne au millime',
            cardinality(v_faces), compta.en_texte(v_somme), compta.en_texte(v_montant)));
        end if;
      end if;
      delete from compta.rapprochement where releve_ligne = v_ligne;
      insert into compta.rapprochement (releve_ligne, ligne, entreprise, niveau, auto, pose_par, rang)
      select v_ligne, f.x, p_entreprise, v_niveau, coalesce((p->>'auto')::boolean, false), socle.moi(), f.n
        from unnest(v_faces) with ordinality f(x, n);
      update compta.releve_ligne set niveau = 'aucun' where id = v_ligne;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then perform socle.tracer(p_entreprise, 'compta.releve.rapprocher', 'releve', p_releve, null, jsonb_build_object('lignes', v_n)); end if;
  return v_n;
end $$;
revoke execute on function compta.rapprocher(uuid, uuid, jsonb) from public;
grant execute on function compta.rapprocher(uuid, uuid, jsonb) to skanfact_app;

-- Tout défaire d'un relevé : combien de LIGNES du relevé (une remise de trois chèques est un rapprochement, pas trois).
create or replace function compta.derapprocher(p_entreprise uuid, p_releve uuid) returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare v_n int;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  perform 1 from compta.releve where id = p_releve and entreprise = p_entreprise;
  if not found then perform socle.refus('ce relevé n''existe pas'); end if;
  with d as (delete from compta.rapprochement a using compta.releve_ligne l where a.releve_ligne = l.id and l.releve = p_releve returning a.releve_ligne)
  select count(distinct releve_ligne) into v_n from d;
  if v_n > 0 then perform socle.tracer(p_entreprise, 'compta.releve.derapprocher', 'releve', p_releve, null, jsonb_build_object('lignes', v_n)); end if;
  return v_n;
end $$;
revoke execute on function compta.derapprocher(uuid, uuid) from public;
grant execute on function compta.derapprocher(uuid, uuid) to skanfact_app;
