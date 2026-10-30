-- (1.187.0, Skander, 30/10/2026 : « ce parcours devient obsolète, avec la messagerie on doit faire de l'ergonomie »)
-- Une question de la révision part de la conversation du client, ou de sa fenêtre, d'un geste : « Envoyer maintenant »
-- emporte CELLE-CI (et celles qui attendaient avec elle), les questions gardées partent avec le prochain message de la
-- conversation, et une question restée sans réponse se relance de sa ligne. « Envoyer les questions » de l'année
-- (compta.envoyer_questions) emportait tout d'un bloc ; ici, on nomme celles qui partent.
--
-- Les règles ne changent pas (0162) : seul le cabinet de l'entreprise envoie ; une question neuve part ; une question
-- déjà partie ne repart (et ne se compte) que si son dernier envoi est d'un AUTRE jour, à Tunis ; une question répondue
-- ou close ne part plus. Une question d'un autre cabinet (l'ancien) n'est jamais emportée. Rien à envoyer : le refus
-- dit pourquoi.
create function compta.envoyer_questions_choisies(p_entreprise uuid, p_ids uuid[]) returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare n int; v_cabinet uuid;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  v_cabinet := compta.mon_cabinet(p_entreprise);
  if v_cabinet is null then perform socle.refus('seul le cabinet de l''entreprise lui pose des questions'); end if;
  if coalesce(cardinality(p_ids), 0) = 0 then perform socle.refus('choisis les questions qui partent'); end if;
  update compta.question set envois = envois || now(), statut = case when statut = 'ouverte' then 'envoyee' else statut end
   where entreprise = p_entreprise and cabinet = v_cabinet and id = any(p_ids) and statut in ('ouverte', 'envoyee')
     and (cardinality(envois) = 0
          or (envois[cardinality(envois)] at time zone 'Africa/Tunis')::date < (now() at time zone 'Africa/Tunis')::date);
  get diagnostics n = row_count;
  if n = 0 and exists (select 1 from compta.question
                        where entreprise = p_entreprise and cabinet = v_cabinet and id = any(p_ids) and statut = 'envoyee') then
    perform socle.refus('cette question est partie aujourd''hui : une relance se fait un autre jour');
  end if;
  if n = 0 then perform socle.refus('aucune de ces questions n''attend de réponse : il n''y aurait rien à envoyer'); end if;
  perform socle.tracer(p_entreprise, 'compta.questions.envoyer', 'question', null, null, jsonb_build_object('envoyees', n, 'choisies', cardinality(p_ids)));
  return n;
end $$;
revoke execute on function compta.envoyer_questions_choisies(uuid, uuid[]) from public;
grant execute on function compta.envoyer_questions_choisies(uuid, uuid[]) to skanfact_app;
