-- Une relance se fait un autre jour (parcours du 21/10/2026, 1.94.0 ; docs/cabinet.md, C33). « Envoyer les questions »
-- renvoyait TOUTES celles qui attendaient : le comptable qui envoyait une question neuve renvoyait aussi celle partie le
-- matin même, qui passait à « 2 fois » ; le client lisait « envoyée deux fois sans réponse : ton comptable ne peut pas
-- arrêter ton mois », et « À faire » la comptait à relancer, le jour où il l'avait reçue.
--
-- La règle : une question neuve part ; une question déjà partie ne repart (et ne se compte) que si son dernier envoi
-- est d'un AUTRE jour, à Tunis (un jour de calendrier, jamais un délai en heures). Rien d'autre ne change : la fiche,
-- le statut, la trace. Rien à envoyer : le refus dit pourquoi.

create or replace function compta.envoyer_questions(p_entreprise uuid, p_annee int) returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare n int;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  if compta.mon_cabinet(p_entreprise) is null then perform socle.refus('seul le cabinet de l''entreprise lui pose des questions'); end if;
  update compta.question set envois = envois || now(), statut = case when statut = 'ouverte' then 'envoyee' else statut end
   where entreprise = p_entreprise and left(periode, 4) = p_annee::text and statut in ('ouverte', 'envoyee')
     and (cardinality(envois) = 0
          or (envois[cardinality(envois)] at time zone 'Africa/Tunis')::date < (now() at time zone 'Africa/Tunis')::date);
  get diagnostics n = row_count;
  if n = 0 and exists (select 1 from compta.question
                        where entreprise = p_entreprise and left(periode, 4) = p_annee::text and statut = 'envoyee') then
    perform socle.refus('les questions qui attendent sont parties aujourd''hui : une relance se fait un autre jour');
  end if;
  if n = 0 then perform socle.refus('aucune question n''attend de réponse : il n''y aurait rien à envoyer'); end if;
  perform socle.tracer(p_entreprise, 'compta.questions.envoyer', 'question', null, null, jsonb_build_object('annee', p_annee, 'envoyees', n));
  return n;
end $$;
