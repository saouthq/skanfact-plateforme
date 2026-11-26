-- 0237 — Les questions du cabinet refaites (1.388.86 ; vérification complète, lot Pont, 25/11/2026).
--
-- Décidé avec Skander : une question est une pièce ou une réponse DEMANDÉE, comme une pièce demandée de la conversation
-- (0168). Elle ne passe plus par un « envoi » qu'on répète et qu'on compte :
--   1. Elle part quand on la pose, si qui la pose peut valider ; posée par une saisie, ou gardée pour plus tard
--      (« Garder pour plus tard »), elle attend qu'on l'envoie (statut « ouverte », comme avant).
--   2. Elle porte une date « pour le » (facultative ; l'écran propose dans sept jours). Restée sans réponse à cette date,
--      elle se relance par e-mail ce jour-là, puis une fois par semaine, trois relances au plus — le même e-mail sans
--      contenu que les pièces demandées (0168). Une question sans date ne se relance pas toute seule.
--   3. Le cabinet garde la relance à la main, sans attendre un autre jour : elle compte avec les automatiques et repousse
--      la suivante d'une semaine.
--   4. Le client répond par écrit, ou avec un fichier ou une pièce de son dossier, d'un seul geste : le fichier ou la pièce
--      part dans la conversation, et la question retient le message qui l'a portée.
-- Le compteur d'envois (`envois`, et la règle « une relance se fait un autre jour » de 0162, 0185, 0235) disparaît :
-- ce qui reste est le jour du premier envoi, la date « pour le », et les relances.

alter table compta.question
  add column envoyee_le timestamptz,
  add column pour_le date,
  add column relances int not null default 0,
  add column relance_le timestamptz,
  add column reponse_message uuid references messagerie.message(id) on delete set null;

-- La reprise : le premier envoi devient le jour d'envoi ; les envois suivants étaient des relances à la main (trois au
-- plus comptées). Aucune date « pour le » : rien ne se relance tout seul dans ce qui existe (pas de vague d'e-mails).
update compta.question set envoyee_le = envois[1],
  relances = least(cardinality(envois) - 1, 3),
  relance_le = case when cardinality(envois) > 1 then envois[cardinality(envois)] end
 where cardinality(envois) > 0;

drop policy visible on compta.question;
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'compta.question'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%envois%' loop
    execute format('alter table compta.question drop constraint %I', c);
  end loop;
end $$;
alter table compta.question drop column envois;

alter table compta.question
  add constraint question_envoyee check ((statut = 'ouverte') = (envoyee_le is null) or statut = 'close'),
  add constraint question_relances check (relances between 0 and 3 and (relances = 0) = (relance_le is null));

-- Qui lit les livres lit les questions ; une question jamais envoyée ne se lit que du côté du cabinet qui l'a posée.
create policy visible on compta.question using (entreprise in (select compta.mes_entreprises())
  and (envoyee_le is not null or cabinet is null or cabinet in (select socle.mes_organisations())));

-- La date « pour le » d'une question : un jour, aujourd'hui ou plus tard (jour de Tunis).
create function compta.pour_le_question(p_valeur jsonb) returns date
language plpgsql stable set search_path = pg_catalog as $$
declare v text := coalesce(p_valeur #>> '{}', '');
begin
  if v !~ '^(\d{4}-\d{2}-\d{2})?$' then perform socle.refus('une date « pour le » s''écrit en jour, mois et année'); end if;
  return nullif(v, '')::date;
end $$;

-- Poser une question : elle part tout de suite si qui la pose peut valider et ne la garde pas ; sinon elle attend.
-- `p_question` : { periode, cycle, compte, ecriture, piece, montant (millimes), objet, texte, attendu, pour, garder }.
create or replace function compta.poser_question(p_entreprise uuid, p_question jsonb) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare v_id uuid; v_cabinet uuid; v_ecriture uuid; v_pour date; v_part boolean;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.saisir');
  v_cabinet := compta.mon_cabinet(p_entreprise);
  if v_cabinet is null then perform socle.refus('seul le cabinet de l''entreprise lui pose des questions'); end if;
  if coalesce(p_question->>'periode', '') !~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$' then perform socle.refus('une période de révision est une année (AAAA) ou un mois (AAAA-MM)'); end if;
  if length(trim(coalesce(p_question->>'texte', ''))) = 0 then perform socle.refus('une question sans texte n''apprend rien au client'); end if;
  if coalesce(p_question->>'attendu', 'explication') not in ('piece', 'explication', 'confirmation') then
    perform socle.refus('ce que la question attend en retour n''est pas connu');
  end if;
  if jsonb_typeof(coalesce(p_question->'montant', '0')) <> 'number' or not socle.sans_virgule(coalesce(p_question->'montant', '0')) then
    perform socle.refus('un montant se donne en millimes');
  end if;
  v_pour := compta.pour_le_question(p_question->'pour');
  if v_pour < (clock_timestamp() at time zone 'Africa/Tunis')::date then perform socle.refus('une réponse se demande pour aujourd''hui ou plus tard'); end if;
  v_ecriture := nullif(p_question->>'ecriture', '')::uuid;
  if v_ecriture is not null and not exists (select 1 from compta.ecriture e where e.id = v_ecriture and e.entreprise = p_entreprise) then
    perform socle.refus('cette écriture n''existe pas');
  end if;
  v_part := not coalesce((p_question->>'garder')::boolean, false) and compta.peut(p_entreprise, 'compta.ecritures.valider');
  insert into compta.question (entreprise, cabinet, periode, cycle, compte, ecriture, piece, montant, objet, texte, attendu, pose_par,
                               statut, envoyee_le, pour_le)
  values (p_entreprise, v_cabinet, p_question->>'periode', coalesce(p_question->>'cycle', ''), coalesce(p_question->>'compte', ''),
          v_ecriture, coalesce(p_question->>'piece', ''), coalesce((p_question->>'montant')::bigint, 0), trim(coalesce(p_question->>'objet', '')),
          trim(p_question->>'texte'), coalesce(p_question->>'attendu', 'explication'), socle.moi(),
          case when v_part then 'envoyee' else 'ouverte' end, case when v_part then now() end, v_pour)
  returning id into v_id;
  perform socle.tracer(p_entreprise, 'compta.question.poser', 'question', v_id, null,
    jsonb_build_object('periode', p_question->>'periode', 'piece', p_question->>'piece', 'objet', p_question->>'objet',
      'pour', v_pour, 'envoyee', v_part));
  return v_id;
end $$;

-- Réécrire une question qui n'a pas encore sa réponse : son objet, son texte, ce qu'elle attend, son cycle, son compte,
-- sa date « pour le » (null la retire : elle ne se relance plus toute seule).
create or replace function compta.modifier_question(p_entreprise uuid, p_id uuid, p_champs jsonb) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare q compta.question; v_pour date;
begin
  q := compta.question_du_cabinet(p_entreprise, p_id, 'compta.ecritures.saisir');
  if q.statut in ('repondue', 'close') then perform socle.refus('cette question a reçu sa réponse : elle ne se réécrit plus'); end if;
  if p_champs ? 'texte' and length(trim(coalesce(p_champs->>'texte', ''))) = 0 then perform socle.refus('une question sans texte n''apprend rien au client'); end if;
  if p_champs ? 'attendu' and coalesce(p_champs->>'attendu', '') not in ('piece', 'explication', 'confirmation') then
    perform socle.refus('ce que la question attend en retour n''est pas connu');
  end if;
  if p_champs ? 'pour' then
    v_pour := compta.pour_le_question(p_champs->'pour');
    if v_pour < (clock_timestamp() at time zone 'Africa/Tunis')::date and v_pour is distinct from q.pour_le then
      perform socle.refus('une réponse se demande pour aujourd''hui ou plus tard');
    end if;
  end if;
  update compta.question set
    objet = case when p_champs ? 'objet' then trim(p_champs->>'objet') else objet end,
    texte = case when p_champs ? 'texte' then trim(p_champs->>'texte') else texte end,
    attendu = case when p_champs ? 'attendu' then p_champs->>'attendu' else attendu end,
    cycle = case when p_champs ? 'cycle' then p_champs->>'cycle' else cycle end,
    compte = case when p_champs ? 'compte' then p_champs->>'compte' else compte end,
    pour_le = case when p_champs ? 'pour' then v_pour else pour_le end
   where id = p_id;
  perform socle.tracer(p_entreprise, 'compta.question.modifier', 'question', p_id,
    jsonb_build_object('objet', q.objet, 'texte', q.texte, 'attendu', q.attendu, 'pour', q.pour_le), p_champs);
end $$;

-- Retirer une question jamais envoyée : le client ne l'a jamais vue. Envoyée, elle se ferme.
create or replace function compta.retirer_question(p_entreprise uuid, p_id uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare q compta.question;
begin
  q := compta.question_du_cabinet(p_entreprise, p_id, 'compta.ecritures.saisir');
  if q.envoyee_le is not null then perform socle.refus('cette question est déjà partie chez le client : elle se ferme, elle ne s''efface pas'); end if;
  delete from compta.question where id = p_id;
  perform socle.tracer(p_entreprise, 'compta.question.retirer', 'question', p_id, jsonb_build_object('objet', q.objet, 'texte', q.texte), null);
end $$;

-- Fermer une question (elle a trouvé sa réponse ailleurs), ou la rouvrir. Rend son statut.
create or replace function compta.fermer_question(p_entreprise uuid, p_id uuid, p_rouvrir boolean) returns text
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare q compta.question; v_statut text;
begin
  q := compta.question_du_cabinet(p_entreprise, p_id, 'compta.ecritures.saisir');
  v_statut := case when not p_rouvrir then 'close' when q.reponse is not null then 'repondue'
                   when q.envoyee_le is not null then 'envoyee' else 'ouverte' end;
  update compta.question set statut = v_statut, close_par = case when p_rouvrir then null else socle.moi() end,
    close_le = case when p_rouvrir then null else now() end where id = p_id;
  perform socle.tracer(p_entreprise, case when p_rouvrir then 'compta.question.rouvrir' else 'compta.question.fermer' end, 'question', p_id,
    jsonb_build_object('statut', q.statut), jsonb_build_object('statut', v_statut));
  return v_statut;
end $$;

-- Envoyer les questions d'une année qui attendent de partir (gardées, ou posées par une saisie). Une question déjà
-- partie ne repart pas : elle se relance (compta.relancer_question). Rend combien sont parties.
create or replace function compta.envoyer_questions(p_entreprise uuid, p_annee int) returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare n int; v_cabinet uuid;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  v_cabinet := compta.mon_cabinet(p_entreprise);
  if v_cabinet is null then perform socle.refus('seul le cabinet de l''entreprise lui pose des questions'); end if;
  update compta.question set envoyee_le = now(), statut = 'envoyee'
   where entreprise = p_entreprise and cabinet = v_cabinet and left(periode, 4) = p_annee::text and statut = 'ouverte';
  get diagnostics n = row_count;
  if n = 0 then perform socle.refus('aucune question n''attend de partir : celles qui sont parties se relancent de leur ligne'); end if;
  perform socle.tracer(p_entreprise, 'compta.questions.envoyer', 'question', null, null, jsonb_build_object('annee', p_annee, 'envoyees', n));
  return n;
end $$;

-- Les questions qu'on nomme (« Envoyer maintenant », les questions prêtes qui partent avec un message de la conversation).
create or replace function compta.envoyer_questions_choisies(p_entreprise uuid, p_ids uuid[]) returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare n int; v_cabinet uuid;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  v_cabinet := compta.mon_cabinet(p_entreprise);
  if v_cabinet is null then perform socle.refus('seul le cabinet de l''entreprise lui pose des questions'); end if;
  if coalesce(cardinality(p_ids), 0) = 0 then perform socle.refus('choisis les questions qui partent'); end if;
  update compta.question set envoyee_le = now(), statut = 'envoyee'
   where entreprise = p_entreprise and cabinet = v_cabinet and id = any(p_ids) and statut = 'ouverte';
  get diagnostics n = row_count;
  if n = 0 then perform socle.refus('aucune de ces questions n''attend de partir : celles qui sont parties se relancent de leur ligne'); end if;
  perform socle.tracer(p_entreprise, 'compta.questions.envoyer', 'question', null, null, jsonb_build_object('envoyees', n, 'choisies', cardinality(p_ids)));
  return n;
end $$;

-- Relancer à la main une question partie et sans réponse : le client reçoit l'alerte « un message t'attend » ; la relance
-- compte avec les automatiques (trois au plus) et repousse la suivante d'une semaine. Rend le nombre de relances.
create function compta.relancer_question(p_entreprise uuid, p_id uuid) returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare q compta.question; n int;
begin
  q := compta.question_du_cabinet(p_entreprise, p_id, 'compta.ecritures.valider');
  if q.statut = 'ouverte' then perform socle.refus('cette question n''est pas encore partie : envoie-la d''abord'); end if;
  if q.statut <> 'envoyee' then perform socle.refus('cette question a reçu sa réponse : il n''y a plus rien à relancer'); end if;
  update compta.question set relances = least(relances + 1, 3), relance_le = now() where id = p_id returning relances into n;
  perform socle.tracer(p_entreprise, 'compta.question.relancer', 'question', p_id, jsonb_build_object('relances', q.relances), jsonb_build_object('relances', n));
  return n;
end $$;

-- Le client répond (qui tient la comptabilité de l'entreprise, jamais par un cabinet), à une question qu'il a reçue et
-- qui n'est pas fermée ; il peut compléter sa réponse tant qu'elle ne l'est pas.
create or replace function compta.repondre_question(p_entreprise uuid, p_id uuid, p_reponse text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare q compta.question;
begin
  if not (p_entreprise in (select socle.mes_entreprises())) then perform socle.refus('entreprise introuvable'); end if;
  if socle.perimetre_cabinet(p_entreprise) is not null or socle.ma_cle() is not null
     or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne']::text[]) then
    perform socle.refus('seule l''entreprise répond aux questions de son cabinet');
  end if;
  select * into q from compta.question where id = p_id and entreprise = p_entreprise for update;
  if not found or q.envoyee_le is null then perform socle.refus('cette question n''existe plus'); end if;
  if q.statut = 'close' then perform socle.refus('cette question est fermée : ton cabinet n''attend plus de réponse'); end if;
  if length(trim(coalesce(p_reponse, ''))) = 0 then perform socle.refus('une réponse vide ne répond à rien'); end if;
  if length(trim(p_reponse)) > 4000 then perform socle.refus('une réponse se borne à quatre mille caractères'); end if;
  update compta.question set reponse = trim(p_reponse), statut = 'repondue', repondu_par = socle.moi(), repondu_le = now() where id = p_id;
  perform socle.tracer(p_entreprise, 'compta.question.repondre', 'question', p_id, case when q.reponse is null then null else jsonb_build_object('reponse', q.reponse) end,
    jsonb_build_object('reponse', trim(p_reponse)));
end $$;

-- Répondre avec un fichier ou une pièce du dossier, d'un seul geste : le message (`p_message`, le même que pour
-- messagerie.ecrire : { texte, fichier } ou { texte, piece }) part dans la conversation du cabinet qui a posé la question,
-- la réponse s'écrit, et la question retient le message. L'un sans l'autre ne se garde pas.
create function compta.repondre_question(p_entreprise uuid, p_id uuid, p_reponse text, p_message jsonb) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare q compta.question; v_msg uuid;
begin
  perform compta.repondre_question(p_entreprise, p_id, p_reponse);
  select * into q from compta.question where id = p_id;
  if q.cabinet is null or not exists (select 1 from socle.mandat d where d.entreprise = p_entreprise and d.cabinet = q.cabinet and d.statut = 'actif'
                                        and d.debut <= current_date and (d.fin is null or d.fin >= current_date)) then
    perform socle.refus('ce cabinet ne suit plus ton dossier : ta réponse part par écrit seulement');
  end if;
  if p_message->>'fichier' is null and jsonb_typeof(p_message->'piece') is distinct from 'object' then
    perform socle.refus('une réponse jointe porte un fichier ou une pièce du dossier');
  end if;
  v_msg := messagerie.ecrire(p_entreprise, 'entreprise', p_message - 'demande' - 'pour' - 'repondA');
  update compta.question set reponse_message = v_msg where id = p_id;
  return v_msg;
end $$;

-- ── Les relances automatiques (le serveur, chaque minute, hors de toute personne) ─────────────────
-- Les pièces demandées (0168) et, désormais, les questions parties sans réponse dont la date « pour le » est venue, sous
-- un mandat actif de leur cabinet, relancées moins de trois fois et pas depuis sept jours. Pour chacune, les personnes de
-- l'entreprise qui lisent le fil, à une adresse vérifiée, qui n'ont pas décoché « Me prévenir par e-mail ». Ce qui en
-- sort : l'adresse, la langue, et de quoi noter la relance (`message` ou `question`) ; rien de ce qu'on demande.
create or replace function messagerie.relances_dues(p_maintenant timestamptz) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle as $$
  with jour as (select (p_maintenant at time zone 'Africa/Tunis')::date j),
  dues as (
    select m.id, 'message' sorte, m.entreprise, m.cabinet from messagerie.message m, jour
     where m.demande is not null and m.demande_recue_le is null and m.demande_pour is not null and m.demande_pour <= jour.j
       and m.relances < 3 and (m.relance_le is null or m.relance_le <= p_maintenant - interval '7 days')
    union all
    select q.id, 'question', q.entreprise, q.cabinet from compta.question q, jour
     where q.statut = 'envoyee' and q.cabinet is not null and q.pour_le is not null and q.pour_le <= jour.j
       and q.relances < 3 and (q.relance_le is null or q.relance_le <= p_maintenant - interval '7 days')
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

-- La relance automatique d'une question est partie : elle en compte une de plus, et attend sept jours avant la suivante.
create function compta.question_relancee(p_question uuid, p_le timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is not null then perform socle.refus('seul le serveur note une relance partie'); end if;
  update compta.question set relances = relances + 1, relance_le = p_le where id = p_question and statut = 'envoyee' and relances < 3;
end $$;

-- L'alerte « un message t'attend » : une question à lire pour le client depuis son envoi, ou depuis sa dernière relance.
create or replace function messagerie.alertes_dues(p_maintenant timestamptz, p_delai interval) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle as $$
  with a_lire as (
    select x.entreprise, x.cabinet, x.lecteur from (
      select m.entreprise, m.cabinet, case m.cote when 'entreprise' then 'cabinet' else 'entreprise' end lecteur, m.ecrit_le quand
        from messagerie.message m
      union all
      select q.entreprise, q.cabinet, 'entreprise', greatest(q.envoyee_le, q.relance_le) from compta.question q
       where q.cabinet is not null and q.envoyee_le is not null and q.statut = 'envoyee'
      union all
      select q.entreprise, q.cabinet, 'cabinet', q.repondu_le from compta.question q where q.cabinet is not null and q.repondu_le is not null
    ) x
    left join messagerie.fil f on f.entreprise = x.entreprise and f.cabinet = x.cabinet
    where x.quand <= p_maintenant - p_delai
      and x.quand > coalesce(case x.lecteur when 'entreprise' then f.lu_entreprise else f.lu_cabinet end, '-infinity')
    group by 1, 2, 3
  ),
  personnes as (
    select a.entreprise, a.cabinet, a.lecteur, m.utilisateur from a_lire a
      join socle.membre m on m.entreprise = a.entreprise and m.actif
       and m.roles && array['proprietaire', 'administrateur', 'comptabilite_interne']::text[]
     where a.lecteur = 'entreprise'
    union
    select a.entreprise, a.cabinet, a.lecteur, m.utilisateur from a_lire a
      join socle.mandat d on d.entreprise = a.entreprise and d.cabinet = a.cabinet and d.statut = 'actif'
       and d.debut <= current_date and (d.fin is null or d.fin >= current_date)
      join socle.membre m on m.organisation = d.cabinet and m.actif
       and ('supervision' = any(m.roles) or exists (select 1 from socle.mandat_affectation x where x.mandat = d.id and x.membre = m.id))
     where a.lecteur = 'cabinet'
  )
  select coalesce(jsonb_agg(jsonb_build_object('utilisateur', p.utilisateur, 'email', u.email, 'langue', u.langue, 'cote', p.lecteur,
           'entreprise', p.entreprise, 'cabinet', p.cabinet) order by p.entreprise, p.cabinet, p.utilisateur), '[]'::jsonb)
    from personnes p
    join socle.utilisateur u on u.id = p.utilisateur and u.adresse_verifiee_le is not null
    left join messagerie.fil f on f.entreprise = p.entreprise and f.cabinet = p.cabinet
    left join messagerie.alerte al on al.utilisateur = p.utilisateur and al.entreprise = p.entreprise and al.cabinet = p.cabinet
   where socle.moi() is null and coalesce(al.active, true)
     and (al.prevenue_le is null
          or al.prevenue_le < coalesce(case p.lecteur when 'entreprise' then f.lu_entreprise else f.lu_cabinet end, '-infinity'))
$$;

-- Les noms de qui a posé et de qui a répondu aux questions envoyées d'un fil que je lis.
create or replace function messagerie.noms_des_questions(p_entreprise uuid, p_cabinet uuid)
returns table (question uuid, pose_nom text, repondu_nom text)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select q.id, pu.nom, ru.nom
    from compta.question q
    left join socle.utilisateur pu on pu.id = q.pose_par
    left join socle.utilisateur ru on ru.id = q.repondu_par
   where q.entreprise = p_entreprise and q.cabinet = p_cabinet and q.envoyee_le is not null
     and (exists (select 1 from messagerie.mes_fils() f where f.entreprise = p_entreprise and f.cabinet = p_cabinet)
       or (messagerie.cote_entreprise(p_entreprise) and exists (select 1 from socle.mandat d where d.entreprise = p_entreprise and d.cabinet = p_cabinet)))
$$;

revoke execute on function compta.pour_le_question(jsonb), compta.relancer_question(uuid, uuid),
  compta.repondre_question(uuid, uuid, text, jsonb), compta.question_relancee(uuid, timestamptz) from public;
grant execute on function compta.relancer_question(uuid, uuid), compta.repondre_question(uuid, uuid, text, jsonb),
  compta.question_relancee(uuid, timestamptz) to skanfact_app;
