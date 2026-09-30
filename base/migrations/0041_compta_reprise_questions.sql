-- La révision et les questions au client reprises avec le livre du Cabinet v10 (brique 68, 30/09/2026 ;
-- docs/cabinet.md, C58). La révision d'une période se pose par le geste ordinaire
-- (cabinet.poser_revision, 0028). Les questions, elles, ne naissent pas « ouvertes » : la v10 les avait
-- déjà envoyées (chaque envoi, son instant), le client y avait parfois répondu, le cabinet en avait
-- fermé. Elles se reprennent dans leur état, avec leurs instants :
--   - seulement dans un dossier que le cabinet de la personne tient, par qui saisit ; la question est
--     celle du cabinet qui le tient ;
--   - la pièce en face de laquelle la question est née : une écriture REPRISE de ce dossier ;
--   - les règles de la table tiennent (une répondue a sa réponse, une ouverte n'a pas d'envoi) ; la
--     réponse du client reste sans auteur sur la plateforme : il l'avait écrite dans la v10.

create function compta.reprendre_questions_v10(p_entreprise uuid, p_questions jsonb) returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare q jsonb; v_cabinet uuid; v_ecriture uuid; v_n int := 0;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  if socle.perimetre_cabinet(p_entreprise) is null
     or not exists (select 1 from socle.entreprise where id = p_entreprise and tenue_par is not null) then
    perform socle.refus('la reprise d''un livre de la v10 s''écrit dans un dossier que ton cabinet tient');
  end if;
  -- Le cabinet qui pose : celui qui tient le dossier (le contrôle au-dessus garantit qu'il y en a un).
  select tenue_par into v_cabinet from socle.entreprise where id = p_entreprise;
  for q in select value from jsonb_array_elements(coalesce(p_questions, '[]'::jsonb)) loop
    v_ecriture := nullif(q->>'ecriture', '')::uuid;
    if v_ecriture is not null and not exists (select 1 from compta.ecriture e where e.id = v_ecriture and e.entreprise = p_entreprise and e.origine_type = 'reprise_v10') then
      perform socle.refus('la pièce d''une question reprise n''est pas une écriture reprise de ce dossier');
    end if;
    insert into compta.question (entreprise, cabinet, periode, cycle, compte, ecriture, piece, montant, objet, texte, attendu, statut, envois,
                                 reponse, repondu_le, pose_par, pose_le, close_par, close_le)
    values (p_entreprise, v_cabinet, q->>'periode', coalesce(q->>'cycle', ''), coalesce(q->>'compte', ''), v_ecriture, coalesce(q->>'piece', ''),
            coalesce((q->>'montant')::bigint, 0), coalesce(q->>'objet', ''), q->>'texte', coalesce(q->>'attendu', 'explication'), q->>'statut',
            coalesce((select array_agg(to_timestamp(x::bigint / 1000.0) order by o) from jsonb_array_elements_text(q->'envois') with ordinality t(x, o)), '{}'),
            nullif(q->>'reponse', ''), case when q->>'repondue' is null then null else to_timestamp((q->>'repondue')::bigint / 1000.0) end,
            socle.moi(), case when coalesce((q->>'posee')::bigint, 0) > 0 then to_timestamp((q->>'posee')::bigint / 1000.0) else now() end,
            case when q->>'statut' = 'close' then socle.moi() end,
            case when q->>'statut' = 'close' then coalesce(to_timestamp((q->>'close')::bigint / 1000.0), now()) end);
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then perform socle.tracer(p_entreprise, 'compta.question.reprendre', 'question', null, null, jsonb_build_object('questions', v_n)); end if;
  return v_n;
end $$;
revoke execute on function compta.reprendre_questions_v10(uuid, jsonb) from public;
grant execute on function compta.reprendre_questions_v10(uuid, jsonb) to skanfact_app;
