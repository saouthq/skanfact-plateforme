-- La révision et les questions au client (brique 44, 29/09/2026 ; docs/cabinet.md, C32 et C33). Le
-- Cabinet v10 tenait, dans le livre d'un exercice, son dossier de travail (les comptes signés, les
-- notes de revue, le questionnaire de fin d'exercice, la révision arrêtée) et les questions posées au
-- client, qui partaient dans un fichier et revenaient avec ses réponses. Ici :
--   - la RÉVISION d'une période (l'exercice, ou un mois) est le dossier de travail du CABINET : elle
--     appartient au cabinet (comme la fiche d'un dossier), se garde entière avec une révision, et ne
--     s'écrit que par qui révise (l'associé, le collaborateur) sur un dossier dont le cabinet a le
--     mandat de la comptabilité ;
--   - une QUESTION au client appartient à l'ENTREPRISE : elle se lit dans ses livres, en face de sa
--     pièce. Le cabinet la pose, puis l'ENVOIE (plus de fichier : l'envoi la rend visible au client,
--     et chaque envoi se compte, comme chaque fichier se comptait — deux envois sans réponse, et elle
--     remonte). Avant son premier envoi, le client ne la voit pas et elle s'efface ; après, elle se
--     ferme, elle ne s'efface plus. Une question qui a sa réponse ne se réécrit plus. Le client répond ;
--     rien de ce qui part d'ici ne touche à ses chiffres.

create table cabinet.revision (
  cabinet uuid not null references socle.organisation(id),
  entreprise uuid not null references socle.entreprise(id),
  periode text not null check (periode ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$'),
  contenu jsonb not null check (jsonb_typeof(contenu) = 'object' and socle.sans_virgule(contenu)),
  revision bigint not null default 1,
  modifie_par uuid references socle.utilisateur(id),
  modifie_le timestamptz not null default now(),
  primary key (cabinet, entreprise, periode)
);
alter table cabinet.revision enable row level security;
alter table cabinet.revision force row level security;
create policy visible on cabinet.revision using (cabinet in (select socle.mes_organisations()) and entreprise in (select socle.mes_entreprises()));
grant select on cabinet.revision to skanfact_app;

-- Qui révise un dossier pour un cabinet : un membre du cabinet, sur un dossier dont le mandat actif
-- comprend la comptabilité, avec un rôle qui valide (associé, collaborateur).
create function cabinet.peut_reviser(p_cabinet uuid, p_entreprise uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select p_cabinet in (select socle.mes_organisations())
     and exists (select 1 from socle.mandat d where d.cabinet = p_cabinet and d.entreprise = p_entreprise and d.statut = 'actif'
                   and d.debut <= current_date and (d.fin is null or d.fin >= current_date) and 'comptabilite' = any(d.perimetre))
     and socle.mes_roles(p_entreprise) && array['supervision', 'revision']::text[]
$$;

-- Poser la révision d'une période, entière, dans la révision qu'on a lue (null : la première fois).
create function cabinet.poser_revision(p_cabinet uuid, p_entreprise uuid, p_periode text, p_contenu jsonb, p_revision bigint) returns bigint
language plpgsql volatile security definer set search_path = pg_catalog, socle, cabinet as $$
declare x cabinet.revision; v_rev bigint;
begin
  if not cabinet.peut_reviser(p_cabinet, p_entreprise) then perform socle.refus('ton rôle ne permet pas de réviser ce dossier'); end if;
  if p_periode is null or p_periode !~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$' then perform socle.refus('une période de révision est une année (AAAA) ou un mois (AAAA-MM)'); end if;
  select * into x from cabinet.revision where cabinet = p_cabinet and entreprise = p_entreprise and periode = p_periode for update;
  if coalesce(x.revision, 0) <> coalesce(p_revision, 0) then
    raise exception 'la révision de ce dossier a été changée ailleurs entre-temps : recharge-la, rien n''a été enregistré' using errcode = 'SK409';
  end if;
  if x.cabinet is null then
    insert into cabinet.revision (cabinet, entreprise, periode, contenu, modifie_par) values (p_cabinet, p_entreprise, p_periode, p_contenu, socle.moi());
    v_rev := 1;
  else
    update cabinet.revision set contenu = p_contenu, revision = revision + 1, modifie_par = socle.moi(), modifie_le = now()
     where cabinet = p_cabinet and entreprise = p_entreprise and periode = p_periode returning revision into v_rev;
  end if;
  return v_rev;
end $$;

create table compta.question (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  cabinet uuid references socle.organisation(id),
  periode text not null check (periode ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$'),
  cycle text not null default '' check (length(cycle) <= 40),
  compte text not null default '' check (compte = '' or compte ~ '^[0-9]{1,12}$'),
  ecriture uuid references compta.ecriture(id) on delete set null,
  piece text not null default '' check (length(piece) <= 200),
  montant bigint not null default 0,
  objet text not null default '' check (length(objet) <= 200),
  texte text not null check (length(texte) between 1 and 2000),
  attendu text not null default 'explication' check (attendu in ('piece', 'explication', 'confirmation')),
  statut text not null default 'ouverte' check (statut in ('ouverte', 'envoyee', 'repondue', 'close')),
  envois timestamptz[] not null default '{}',
  reponse text check (reponse is null or length(reponse) between 1 and 4000),
  repondu_par uuid references socle.utilisateur(id),
  repondu_le timestamptz,
  pose_par uuid references socle.utilisateur(id),
  pose_le timestamptz not null default now(),
  close_par uuid references socle.utilisateur(id),
  close_le timestamptz,
  -- Répondue : elle a sa réponse ; ouverte ou envoyée : pas encore ; close : l'un ou l'autre.
  check (statut = 'close' or (statut = 'repondue') = (reponse is not null)),
  check ((statut = 'ouverte') = (cardinality(envois) = 0) or statut = 'close')
);
create index question_entreprise on compta.question (entreprise, periode);
alter table compta.question enable row level security;
alter table compta.question force row level security;
-- Qui lit les livres lit les questions ; une question jamais envoyée ne se lit que du côté du cabinet
-- qui l'a posée.
create policy visible on compta.question using (entreprise in (select compta.mes_entreprises())
  and (cardinality(envois) > 0 or cabinet is null or cabinet in (select socle.mes_organisations())));
grant select on compta.question to skanfact_app;

-- Le cabinet par lequel j'agis sur cette entreprise, avec un mandat actif qui comprend la comptabilité.
create function compta.mon_cabinet(p_entreprise uuid) returns uuid
language sql stable security definer set search_path = pg_catalog, socle as $$
  select d.cabinet from socle.mandat d join socle.membre m on m.organisation = d.cabinet and m.utilisateur = socle.moi() and m.actif
   where d.entreprise = p_entreprise and d.statut = 'actif' and d.debut <= current_date and (d.fin is null or d.fin >= current_date)
     and 'comptabilite' = any(d.perimetre)
   limit 1
$$;

-- La question, lue pour un geste du cabinet : elle doit exister, et le geste est celui de qui la pose.
create function compta.question_du_cabinet(p_entreprise uuid, p_id uuid, p_geste text) returns compta.question
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare q compta.question;
begin
  perform compta.exiger(p_entreprise, p_geste);
  if compta.mon_cabinet(p_entreprise) is null then perform socle.refus('seul le cabinet de l''entreprise lui pose des questions'); end if;
  select * into q from compta.question where id = p_id and entreprise = p_entreprise for update;
  if not found then perform socle.refus('cette question n''existe plus'); end if;
  return q;
end $$;

-- Poser une question (qui saisit : l'assistant aussi, comme la v10). `p_question` : { periode, cycle,
-- compte, ecriture, piece, montant (millimes), objet, texte, attendu }.
create function compta.poser_question(p_entreprise uuid, p_question jsonb) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare v_id uuid; v_cabinet uuid; v_ecriture uuid;
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
  v_ecriture := nullif(p_question->>'ecriture', '')::uuid;
  if v_ecriture is not null and not exists (select 1 from compta.ecriture e where e.id = v_ecriture and e.entreprise = p_entreprise) then
    perform socle.refus('cette écriture n''existe pas');
  end if;
  insert into compta.question (entreprise, cabinet, periode, cycle, compte, ecriture, piece, montant, objet, texte, attendu, pose_par)
  values (p_entreprise, v_cabinet, p_question->>'periode', coalesce(p_question->>'cycle', ''), coalesce(p_question->>'compte', ''),
          v_ecriture, coalesce(p_question->>'piece', ''), coalesce((p_question->>'montant')::bigint, 0), trim(coalesce(p_question->>'objet', '')),
          trim(p_question->>'texte'), coalesce(p_question->>'attendu', 'explication'), socle.moi())
  returning id into v_id;
  perform socle.tracer(p_entreprise, 'compta.question.poser', 'question', v_id, null,
    jsonb_build_object('periode', p_question->>'periode', 'piece', p_question->>'piece', 'objet', p_question->>'objet'));
  return v_id;
end $$;

-- Réécrire une question qui n'a pas encore sa réponse : son objet, son texte, ce qu'elle attend, son
-- cycle, son compte.
create function compta.modifier_question(p_entreprise uuid, p_id uuid, p_champs jsonb) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare q compta.question;
begin
  q := compta.question_du_cabinet(p_entreprise, p_id, 'compta.ecritures.saisir');
  if q.statut in ('repondue', 'close') then perform socle.refus('cette question a reçu sa réponse : elle ne se réécrit plus'); end if;
  if p_champs ? 'texte' and length(trim(coalesce(p_champs->>'texte', ''))) = 0 then perform socle.refus('une question sans texte n''apprend rien au client'); end if;
  if p_champs ? 'attendu' and coalesce(p_champs->>'attendu', '') not in ('piece', 'explication', 'confirmation') then
    perform socle.refus('ce que la question attend en retour n''est pas connu');
  end if;
  update compta.question set
    objet = case when p_champs ? 'objet' then trim(p_champs->>'objet') else objet end,
    texte = case when p_champs ? 'texte' then trim(p_champs->>'texte') else texte end,
    attendu = case when p_champs ? 'attendu' then p_champs->>'attendu' else attendu end,
    cycle = case when p_champs ? 'cycle' then p_champs->>'cycle' else cycle end,
    compte = case when p_champs ? 'compte' then p_champs->>'compte' else compte end
   where id = p_id;
  perform socle.tracer(p_entreprise, 'compta.question.modifier', 'question', p_id,
    jsonb_build_object('objet', q.objet, 'texte', q.texte, 'attendu', q.attendu), p_champs);
end $$;

-- Retirer une question jamais envoyée : le client ne l'a jamais vue. Envoyée, elle se ferme.
create function compta.retirer_question(p_entreprise uuid, p_id uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare q compta.question;
begin
  q := compta.question_du_cabinet(p_entreprise, p_id, 'compta.ecritures.saisir');
  if cardinality(q.envois) > 0 then perform socle.refus('cette question est déjà partie chez le client : elle se ferme, elle ne s''efface pas'); end if;
  delete from compta.question where id = p_id;
  perform socle.tracer(p_entreprise, 'compta.question.retirer', 'question', p_id, jsonb_build_object('objet', q.objet, 'texte', q.texte), null);
end $$;

-- Fermer une question (elle a trouvé sa réponse ailleurs), ou la rouvrir. Rend son statut.
create function compta.fermer_question(p_entreprise uuid, p_id uuid, p_rouvrir boolean) returns text
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare q compta.question; v_statut text;
begin
  q := compta.question_du_cabinet(p_entreprise, p_id, 'compta.ecritures.saisir');
  v_statut := case when not p_rouvrir then 'close' when q.reponse is not null then 'repondue'
                   when cardinality(q.envois) > 0 then 'envoyee' else 'ouverte' end;
  update compta.question set statut = v_statut, close_par = case when p_rouvrir then null else socle.moi() end,
    close_le = case when p_rouvrir then null else now() end where id = p_id;
  perform socle.tracer(p_entreprise, case when p_rouvrir then 'compta.question.rouvrir' else 'compta.question.fermer' end, 'question', p_id,
    jsonb_build_object('statut', q.statut), jsonb_build_object('statut', v_statut));
  return v_statut;
end $$;

-- Envoyer au client les questions d'une année qui attendent leur réponse (qui valide, comme la v10) :
-- chacune compte un envoi de plus. Rend combien sont parties.
create function compta.envoyer_questions(p_entreprise uuid, p_annee int) returns int
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare n int;
begin
  perform compta.exiger(p_entreprise, 'compta.ecritures.valider');
  if compta.mon_cabinet(p_entreprise) is null then perform socle.refus('seul le cabinet de l''entreprise lui pose des questions'); end if;
  update compta.question set envois = envois || now(), statut = case when statut = 'ouverte' then 'envoyee' else statut end
   where entreprise = p_entreprise and left(periode, 4) = p_annee::text and statut in ('ouverte', 'envoyee');
  get diagnostics n = row_count;
  if n = 0 then perform socle.refus('aucune question n''attend de réponse : il n''y aurait rien à envoyer'); end if;
  perform socle.tracer(p_entreprise, 'compta.questions.envoyer', 'question', null, null, jsonb_build_object('annee', p_annee, 'envoyees', n));
  return n;
end $$;

-- Le client répond (qui tient la comptabilité de l'entreprise, jamais par un cabinet), à une question
-- qu'il a reçue et qui n'est pas fermée ; il peut compléter sa réponse tant qu'elle ne l'est pas.
create function compta.repondre_question(p_entreprise uuid, p_id uuid, p_reponse text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, compta as $$
declare q compta.question;
begin
  if not (p_entreprise in (select socle.mes_entreprises())) then perform socle.refus('entreprise introuvable'); end if;
  if socle.perimetre_cabinet(p_entreprise) is not null or socle.ma_cle() is not null
     or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur', 'comptabilite_interne']::text[]) then
    perform socle.refus('seule l''entreprise répond aux questions de son cabinet');
  end if;
  select * into q from compta.question where id = p_id and entreprise = p_entreprise for update;
  if not found or cardinality(q.envois) = 0 then perform socle.refus('cette question n''existe plus'); end if;
  if q.statut = 'close' then perform socle.refus('cette question est fermée : ton cabinet n''attend plus de réponse'); end if;
  if length(trim(coalesce(p_reponse, ''))) = 0 then perform socle.refus('une réponse vide ne répond à rien'); end if;
  if length(trim(p_reponse)) > 4000 then perform socle.refus('une réponse se borne à quatre mille caractères'); end if;
  update compta.question set reponse = trim(p_reponse), statut = 'repondue', repondu_par = socle.moi(), repondu_le = now() where id = p_id;
  perform socle.tracer(p_entreprise, 'compta.question.repondre', 'question', p_id, case when q.reponse is null then null else jsonb_build_object('reponse', q.reponse) end,
    jsonb_build_object('reponse', trim(p_reponse)));
end $$;

revoke execute on function cabinet.peut_reviser(uuid, uuid), cabinet.poser_revision(uuid, uuid, text, jsonb, bigint), compta.mon_cabinet(uuid),
  compta.question_du_cabinet(uuid, uuid, text), compta.poser_question(uuid, jsonb), compta.modifier_question(uuid, uuid, jsonb),
  compta.retirer_question(uuid, uuid), compta.fermer_question(uuid, uuid, boolean), compta.envoyer_questions(uuid, int),
  compta.repondre_question(uuid, uuid, text) from public;
grant execute on function cabinet.peut_reviser(uuid, uuid), cabinet.poser_revision(uuid, uuid, text, jsonb, bigint), compta.mon_cabinet(uuid),
  compta.poser_question(uuid, jsonb), compta.modifier_question(uuid, uuid, jsonb), compta.retirer_question(uuid, uuid),
  compta.fermer_question(uuid, uuid, boolean), compta.envoyer_questions(uuid, int), compta.repondre_question(uuid, uuid, text) to skanfact_app;
