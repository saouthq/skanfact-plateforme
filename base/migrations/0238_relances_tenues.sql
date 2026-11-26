-- 0238 — Les relances des questions tiennent ce qu'elles disent (1.388.92 ; revue critique du lot Pont, 26/11/2026).
--
-- 1. Une relance à la main envoie l'e-mail. Elle ne faisait que compter : l'e-mail ne partait que si le client avait
--    lu le fil depuis l'alerte précédente, et trois clics usaient les trois relances automatiques sans qu'un seul e-mail
--    parte, sous un écran qui disait « il reçoit un e-mail ». Elle se marque désormais « à envoyer » : le tour suivant du
--    serveur (chaque minute) l'envoie par le même e-mail sans contenu que les automatiques, et elle compte une seule fois.
--    Trois relances faites, une quatrième se refuse en disant quoi faire.
-- 2. Une question gardée dont la date « pour le » est passée (ou tombe aujourd'hui) part avec une date neuve, dans sept
--    jours : sinon elle se relançait dans la minute, « en retard » chez un client qui la découvre.

alter table compta.question add column relance_a_envoyer boolean not null default false;

create or replace function compta.relancer_question(p_entreprise uuid, p_id uuid) returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare q compta.question; n int;
begin
  q := compta.question_du_cabinet(p_entreprise, p_id, 'compta.ecritures.valider');
  if q.statut = 'ouverte' then perform socle.refus('cette question n''est pas encore partie : envoie-la d''abord'); end if;
  if q.statut <> 'envoyee' then perform socle.refus('cette question a reçu sa réponse : il n''y a plus rien à relancer'); end if;
  if q.relances >= 3 then perform socle.refus('trois relances sont déjà parties : écris-lui dans la conversation, ou appelle-le'); end if;
  if q.relance_a_envoyer then perform socle.refus('une relance part déjà dans la minute : inutile d''en ajouter une'); end if;
  update compta.question set relances = relances + 1, relance_le = now(), relance_a_envoyer = true where id = p_id returning relances into n;
  perform socle.tracer(p_entreprise, 'compta.question.relancer', 'question', p_id, jsonb_build_object('relances', q.relances), jsonb_build_object('relances', n));
  return n;
end $$;

-- La relance partie (automatique, ou demandée à la main) : une automatique compte une de plus ; une demandée à la main
-- était déjà comptée au clic, elle ne fait que partir.
create or replace function compta.question_relancee(p_question uuid, p_le timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is not null then perform socle.refus('seul le serveur note une relance partie'); end if;
  update compta.question
     set relances = case when relance_a_envoyer then relances else relances + 1 end,
         relance_le = case when relance_a_envoyer then relance_le else p_le end,
         relance_a_envoyer = false
   where id = p_question and statut = 'envoyee' and (relance_a_envoyer or relances < 3);
end $$;

create or replace function messagerie.relances_dues(p_maintenant timestamptz) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle as $$
  with jour as (select (p_maintenant at time zone 'Africa/Tunis')::date j),
  dues as (
    select m.id, 'message' sorte, m.entreprise, m.cabinet from messagerie.message m, jour
     where m.demande is not null and m.demande_recue_le is null and m.demande_pour is not null and m.demande_pour <= jour.j
       and m.relances < 3 and (m.relance_le is null or m.relance_le <= p_maintenant - interval '7 days')
    union all
    select q.id, 'question', q.entreprise, q.cabinet from compta.question q, jour
     where q.statut = 'envoyee' and q.cabinet is not null
       and (q.relance_a_envoyer
         or (q.pour_le is not null and q.pour_le <= jour.j
             and q.relances < 3 and (q.relance_le is null or q.relance_le <= p_maintenant - interval '7 days')))
  ),
  sous_mandat as (
    select x.* from dues x, jour
     where exists (select 1 from socle.mandat d where d.entreprise = x.entreprise and d.cabinet = x.cabinet and d.statut = 'actif'
                     and d.debut <= jour.j and (d.fin is null or d.fin >= jour.j))
  )
  select coalesce(jsonb_agg(jsonb_build_object(x.sorte, x.id, 'utilisateur', mb.utilisateur, 'email', u.email, 'langue', u.langue,
           'entreprise', x.entreprise, 'cabinet', x.cabinet) order by x.entreprise, x.sorte, x.id, mb.utilisateur), '[]'::jsonb)
    from sous_mandat x
    join socle.membre mb on mb.entreprise = x.entreprise and mb.actif
     and mb.roles && array['proprietaire', 'administrateur', 'comptabilite_interne']::text[]
    join socle.utilisateur u on u.id = mb.utilisateur and u.adresse_verifiee_le is not null
    left join messagerie.alerte al on al.utilisateur = mb.utilisateur and al.entreprise = x.entreprise and al.cabinet = x.cabinet
   where socle.moi() is null and coalesce(al.active, true)
$$;

-- 2. La date d'une question qui part : passée ou du jour, elle devient dans sept jours (jour de Tunis).
create or replace function compta.envoyer_questions(p_entreprise uuid, p_annee int) returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare n int; v_cabinet uuid; v_jour date := (now() at time zone 'Africa/Tunis')::date;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  v_cabinet := compta.mon_cabinet(p_entreprise);
  if v_cabinet is null then perform socle.refus('seul le cabinet de l''entreprise lui pose des questions'); end if;
  update compta.question set envoyee_le = now(), statut = 'envoyee',
         pour_le = case when pour_le is not null and pour_le <= v_jour then v_jour + 7 else pour_le end
   where entreprise = p_entreprise and cabinet = v_cabinet and left(periode, 4) = p_annee::text and statut = 'ouverte';
  get diagnostics n = row_count;
  if n = 0 then perform socle.refus('aucune question n''attend de partir : celles qui sont parties se relancent de leur ligne'); end if;
  perform socle.tracer(p_entreprise, 'compta.questions.envoyer', 'question', null, null, jsonb_build_object('annee', p_annee, 'envoyees', n));
  return n;
end $$;

create or replace function compta.envoyer_questions_choisies(p_entreprise uuid, p_ids uuid[]) returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare n int; v_cabinet uuid; v_jour date := (now() at time zone 'Africa/Tunis')::date;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  v_cabinet := compta.mon_cabinet(p_entreprise);
  if v_cabinet is null then perform socle.refus('seul le cabinet de l''entreprise lui pose des questions'); end if;
  if coalesce(cardinality(p_ids), 0) = 0 then perform socle.refus('choisis les questions qui partent'); end if;
  update compta.question set envoyee_le = now(), statut = 'envoyee',
         pour_le = case when pour_le is not null and pour_le <= v_jour then v_jour + 7 else pour_le end
   where entreprise = p_entreprise and cabinet = v_cabinet and id = any(p_ids) and statut = 'ouverte';
  get diagnostics n = row_count;
  if n = 0 then perform socle.refus('aucune de ces questions n''attend de partir : celles qui sont parties se relancent de leur ligne'); end if;
  perform socle.tracer(p_entreprise, 'compta.questions.envoyer', 'question', null, null, jsonb_build_object('envoyees', n, 'choisies', cardinality(p_ids)));
  return n;
end $$;
