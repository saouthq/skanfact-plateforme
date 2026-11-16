-- (1.371.0) La balance d'ouverture, après coup.
--
-- Le premier jour, un comptable crée le livre d'un client « pour voir », sans balance. Le lendemain il a la
-- balance de son ancien logiciel : l'exercice était « déjà ouvert », et la seule issue était de la retaper au
-- journal AN, ligne à ligne. La reprise reste offerte tant que l'exercice n'a AUCUNE ouverture en vigueur : ni
-- balance reprise, ni écriture au journal AN (les à-nouveaux d'une clôture, une saisie à la main), et qu'il n'est
-- pas clos. Elle se pose alors à son premier jour, comme le jour de l'ouverture. Une ouverture contre-passée ne
-- compte plus : la bonne balance se reprend d'un geste au lieu de se retaper.
create or replace function compta.ouvrir_exercice(p_entreprise uuid, p_annee int, p_du date, p_lignes jsonb)
returns table (r_du date, r_au date, r_ouverture uuid, r_numero text)
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare v_au date; v_id uuid; v record; v_ex record; v_du date := p_du;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  if p_annee is null or p_annee < 1900 or p_annee > 2999 then perform socle.refus('une année s''écrit sur quatre chiffres'); end if;
  v_au := make_date(p_annee, 12, 31);
  if p_du is null or p_du < make_date(p_annee, 1, 1) then
    perform socle.refus(format('l''exercice %s ne peut pas commencer avant le 01/01/%s : un premier exercice de plus de douze mois se reprend en deux, l''un par année', p_annee, p_annee));
  end if;
  if p_du > v_au then perform socle.refus(format('l''exercice %s finit le 31/12/%s : il ne peut pas commencer après', p_annee, p_annee)); end if;
  -- L'exercice se réserve d'abord : deux ouvertures au même instant, la seconde lit sa phrase.
  insert into compta.exercice (entreprise, annee, du, au, ouvert_par) values (p_entreprise, p_annee, p_du, v_au, socle.moi())
  on conflict (entreprise, annee) do nothing;
  if not found then
    select * into v_ex from compta.exercice x where x.entreprise = p_entreprise and x.annee = p_annee for update;
    -- Une ouverture contre-passée ne compte plus : la bonne balance se reprend alors d'un geste.
    if coalesce(jsonb_array_length(p_lignes), 0) = 0 or v_ex.clos_le is not null
       or exists (select 1 from compta.ecriture e where e.entreprise = p_entreprise and e.journal = 'AN'
                   and e.date_ecriture between v_ex.du and v_ex.au and e.origine_type <> 'contre_passation'
                   and not exists (select 1 from compta.ecriture c where c.entreprise = e.entreprise
                                    and c.origine_type = 'contre_passation' and c.origine = e.id and c.statut = 'validee')) then
      perform socle.refus(format('l''exercice %s est déjà ouvert : une balance d''ouverture fausse se contre-passe, puis la bonne se saisit au journal AN', p_annee));
    end if;
    v_du := v_ex.du;
  end if;
  if coalesce(jsonb_array_length(p_lignes), 0) > 0 then
    v_id := socle.uuidv7();
    perform compta.poser_saisie(p_entreprise, v_id, jsonb_build_object('date', v_du, 'journal', 'AN', 'piece', 'OUVERTURE',
      'libelle', 'Balance d''ouverture', 'lignes', p_lignes), true);
    select * into v from compta.valider_ecritures(p_entreprise, array[v_id]);
    if v.r_motif is not null then perform socle.refus(format('la balance d''ouverture ne se valide pas : %s', v.r_motif)); end if;
    update compta.exercice set ouverture = v_id where entreprise = p_entreprise and annee = p_annee;
    r_numero := v.r_numero;
  end if;
  perform socle.tracer(p_entreprise, 'compta.exercice.ouvrir', 'exercice', v_id, null,
    jsonb_build_object('annee', p_annee, 'du', v_du, 'au', v_au, 'ouverture', v_id));
  r_du := v_du; r_au := v_au; r_ouverture := v_id;
  return next;
end $$;
