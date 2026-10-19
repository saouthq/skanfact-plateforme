-- 0144 — Les demandes d'effacement : reçues, décidées, faites, prouvées (l'audit 1.42.0 § 4, point 8 ; docs/conservation.md ;
-- docs/console.md C68 ; décidé par délégation le 19/10/2026).
--
-- Deux sortes de demandes, deux rôles de SkanFact (05 § 4.3) :
--   - le COMPTE d'une personne (son nom, son adresse e-mail, son téléphone, son mot de passe, ses codes, ses appareils,
--     ses sessions) : SkanFact en est responsable. Accordé, il s'efface d'ici même (socle.effacer_personne) : l'identité
--     est remplacée par « Personne effacée », les secrets et les adresses internet partent ; l'identifiant reste, pour que
--     les pièces et les traces qu'elle a faites restent justes (la loi les garde, À VÉRIFIER). Une personne encore membre
--     d'une entreprise, ou de l'équipe SkanFact, n'est pas effacée : on la retire d'abord ;
--   - les données d'une ENTREPRISE : SkanFact les tient pour elle. Son propriétaire seul le demande ; l'effacement se fait
--     sur la machine, avec l'outil de l'exploitation (C54) — la console note la demande et la décision, jamais un
--     effacement qu'elle n'a pas fait.
-- Chaque demande a un numéro (« EFF-2026-001 »), une échéance de réponse (trente jours après sa réception, À VÉRIFIER
-- avec l'INPDP), une décision motivée (une exception se dit), et sa preuve : ce qui a été fait, compté, jamais ce qui a
-- été effacé.

create table plateforme.demande_effacement (
  id uuid primary key default socle.uuidv7(),
  annee smallint not null,
  numero smallint not null check (numero > 0),
  recue_le date not null,
  canal text not null check (canal in ('courriel', 'courrier', 'telephone', 'support', 'autre')),
  demandeur text not null check (length(btrim(demandeur)) between 3 and 200),
  sorte text not null check (sorte in ('personne', 'entreprise')),
  utilisateur uuid references socle.utilisateur(id),
  entreprise uuid references socle.entreprise(id),
  notee_le timestamptz not null,
  notee_par uuid not null references socle.utilisateur(id),
  decision text check (decision in ('accordee', 'refusee')),
  raison text check (raison is null or length(btrim(raison)) between 3 and 1000),
  decidee_le timestamptz,
  decidee_par uuid references socle.utilisateur(id),
  faite_le timestamptz,
  faite_par uuid references socle.utilisateur(id),
  preuve jsonb,
  unique (annee, numero),
  check ((sorte = 'personne') = (utilisateur is not null) and (sorte = 'entreprise') = (entreprise is not null)),
  check ((decision is null) = (decidee_le is null)),
  check (faite_le is null or decision = 'accordee')
);
alter table plateforme.demande_effacement enable row level security;
alter table plateforme.demande_effacement force row level security;

-- L'échéance d'une réponse (À VÉRIFIER : le délai que la loi 2004-63 et l'INPDP fixent).
create function plateforme.echeance_effacement(p_recue date) returns date language sql immutable as $$ select p_recue + 30 $$;

-- ── La trace ne garde plus d'adresse e-mail ──────────────────────────────────────────────────────────────────────────
-- La trace (socle.audit) ne se modifie jamais (01 R10) : une adresse qu'on y écrit ne pourrait plus s'effacer. Elle
-- désigne donc, elle ne recopie pas : une invitation par son identifiant (l'invitation garde l'adresse, et l'effacement
-- la remplace), un changement d'adresse par le compte qui l'a fait. Les traces écrites avant cette version gardent la
-- leur (aucune donnée réelle n'existait alors : docs/conservation.md).
create or replace function socle.tracer(p_entreprise uuid, p_geste text, p_objet_type text, p_objet_id uuid, p_avant jsonb, p_apres jsonb)
returns void
language sql volatile security definer set search_path = pg_catalog, socle as $$
  insert into socle.audit (entreprise, utilisateur, cle_api, geste, objet_type, objet_id, avant, apres)
  values (p_entreprise, socle.moi(), socle.ma_cle(), p_geste, p_objet_type, p_objet_id, p_avant - 'email', p_apres - 'email')
$$;

-- Ce qui a changé dans l'équipe d'un cabinet (0036) : une invitation y dit toujours à qui elle est allée, lu dans
-- l'invitation elle-même (qui, effacée, dit « efface-… ») et plus dans la trace.
create or replace function socle.trace_de_l_equipe(p_cabinet uuid)
returns table (instant timestamptz, qui text, geste text, avant jsonb, apres jsonb, membre text)
language plpgsql stable security definer set search_path = pg_catalog, socle as $$
begin
  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet lit ce qui a changé dans son équipe'); end if;
  return query
    select a.instant, coalesce(u.nom, ''), a.geste, a.avant,
           coalesce(a.apres || (select jsonb_build_object('email', i.email) from socle.invitation i where i.id = (a.apres->>'invitation')::uuid), a.apres),
           coalesce(v.nom, '')
      from socle.audit a
      left join socle.utilisateur u on u.id = a.utilisateur
      left join socle.membre m on m.id = coalesce(a.apres->>'membre', a.avant->>'membre')::uuid
      left join socle.utilisateur v on v.id = m.utilisateur
     where a.entreprise is null and a.objet_type = 'cabinet' and a.objet_id = p_cabinet
       and (a.geste like 'cabinet.equipe.%' or a.geste = 'cabinet.renommer')
     order by a.instant desc, a.id desc
     limit 50;
end $$;

-- ── Effacer le compte d'une personne ─────────────────────────────────────────────────────────────────────────────────
-- Son identité remplacée, ses secrets et ses adresses internet retirés ; ce qui la désigne par son identifiant reste
-- (une facture qu'elle a émise, une trace) et se lit désormais « Personne effacée ». Rend ce qui a été fait, compté.
create function socle.effacer_personne(p_utilisateur uuid, p_maintenant timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare u socle.utilisateur; v_email text; v_nouvelle text; n jsonb := '{}'::jsonb; c integer;
begin
  select * into u from socle.utilisateur where id = p_utilisateur for update;
  if not found then perform socle.refus('ce compte n''existe pas'); end if;
  if u.email like 'efface-%@efface.invalid' then perform socle.refus('ce compte est déjà effacé'); end if;
  if exists (select 1 from socle.membre m where m.utilisateur = p_utilisateur and m.actif) then
    perform socle.refus('cette personne est encore membre d''une entreprise : son entreprise la retire d''abord de son équipe');
  end if;
  if exists (select 1 from plateforme.equipe e where e.utilisateur = p_utilisateur and e.retire_le is null) then
    perform socle.refus('cette personne fait encore partie de l''équipe SkanFact : la direction la retire d''abord');
  end if;
  v_email := lower(u.email);
  v_nouvelle := 'efface-' || replace(p_utilisateur::text, '-', '') || '@efface.invalid';
  update socle.utilisateur set email = v_nouvelle, nom = 'Personne effacée', telephone = null, telephone_verifie_le = null,
         telephone_attente = null, empreinte_mot_de_passe = null, adresse_verifiee_le = null, code_methode = null, code_secret = null,
         code_secret_attente = null, code_secours_attente = null, code_attente_le = null, code_sms_attente = null,
         code_sms_attente_le = null, code_sms_attente_erreurs = 0, code_sms_preuve = null, code_sms_preuve_le = null
   where id = p_utilisateur;
  n := n || jsonb_build_object('identite', 1);
  update socle.session set ip = null, fermee_le = coalesce(fermee_le, p_maintenant) where utilisateur = p_utilisateur;
  get diagnostics c = row_count; n := n || jsonb_build_object('sessions', c);
  update plateforme.session_console set ip = null, fermee_le = coalesce(fermee_le, p_maintenant) where utilisateur = p_utilisateur;
  get diagnostics c = row_count; n := n || jsonb_build_object('sessionsConsole', c);
  update socle.appareil set nom = 'Appareil effacé' where utilisateur = p_utilisateur;
  get diagnostics c = row_count; n := n || jsonb_build_object('appareils', c);
  delete from socle.code_secours where utilisateur = p_utilisateur; get diagnostics c = row_count; n := n || jsonb_build_object('codesDeSecours', c);
  delete from socle.defi_connexion where utilisateur = p_utilisateur; get diagnostics c = row_count; n := n || jsonb_build_object('defis', c);
  delete from socle.reinitialisation where utilisateur = p_utilisateur; get diagnostics c = row_count; n := n || jsonb_build_object('reinitialisations', c);
  delete from socle.changement_adresse where utilisateur = p_utilisateur; get diagnostics c = row_count; n := n || jsonb_build_object('changementsDAdresse', c);
  delete from socle.sms_envoye where utilisateur = p_utilisateur; get diagnostics c = row_count; n := n || jsonb_build_object('sms', c);
  delete from socle.tentative where cle = v_email; get diagnostics c = row_count; n := n || jsonb_build_object('tentatives', c);
  update socle.invitation set email = v_nouvelle where lower(email) = v_email; get diagnostics c = row_count; n := n || jsonb_build_object('invitations', c);
  update plateforme.invitation_console set email = v_nouvelle where lower(email) = v_email; get diagnostics c = row_count; n := n || jsonb_build_object('invitationsConsole', c);
  update plateforme.reprise set repreneur_email = v_nouvelle where lower(repreneur_email) = v_email; get diagnostics c = row_count; n := n || jsonb_build_object('reprises', c);
  return n;
end $$;
revoke execute on function socle.effacer_personne(uuid, timestamptz) from public;

-- ── La console ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- Noter une demande reçue (la direction ou le support) : par qui elle arrive, comment, le jour où elle est arrivée, et ce
-- qu'elle vise — un compte (son adresse e-mail) ou une entreprise (son numéro de client, « E-0012 »).
create function plateforme.console_effacement_noter(p_canal text, p_demandeur text, p_recue date, p_sorte text, p_cible text, p_motif text, p_maintenant timestamptz)
returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  v_cible text := btrim(coalesce(p_cible, '')); v_user uuid; v_ent uuid; v_annee smallint; v_numero smallint; v_id uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('noter une demande d''effacement dit pourquoi (trois caractères au moins) : le motif reste au journal de la console'); end if;
  if p_recue is null or p_recue > (p_maintenant at time zone 'Africa/Tunis')::date then perform socle.refus('une demande se note au jour où elle est arrivée, jamais plus tard qu''aujourd''hui'); end if;
  if p_sorte = 'personne' then
    select u.id into v_user from socle.utilisateur u where lower(u.email) = lower(v_cible);
    if v_user is null then perform socle.refus('aucun compte ne porte cette adresse e-mail'); end if;
  elsif p_sorte = 'entreprise' then
    if upper(v_cible) ~ '^E-[0-9]{1,9}$' then
      select n.objet into v_ent from plateforme.numero_client n where n.sorte = 'E' and n.numero = substr(upper(v_cible), 3)::integer;
    end if;
    if v_ent is null then perform socle.refus('aucune entreprise ne porte ce numéro de client'); end if;
  else
    perform socle.refus('une demande vise le compte d''une personne, ou les données d''une entreprise');
  end if;
  v_annee := extract(year from p_maintenant at time zone 'Africa/Tunis')::smallint;
  lock table plateforme.demande_effacement in share row exclusive mode;
  select coalesce(max(numero), 0) + 1 into v_numero from plateforme.demande_effacement where annee = v_annee;
  insert into plateforme.demande_effacement (annee, numero, recue_le, canal, demandeur, sorte, utilisateur, entreprise, notee_le, notee_par)
    values (v_annee, v_numero, p_recue, p_canal, btrim(p_demandeur), p_sorte, v_user, v_ent, p_maintenant, socle.moi()) returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, apres)
    values (socle.moi(), v_role, 'donnees.effacement_note', v_ent, btrim(p_motif), jsonb_build_object('demande', v_id, 'ref', format('EFF-%s-%s', v_annee, lpad(v_numero::text, 3, '0')), 'sorte', p_sorte));
  return jsonb_build_object('id', v_id, 'annee', v_annee, 'numero', v_numero);
end $$;

-- Décider (la direction) : accordée, ou refusée avec sa raison (une exception de la loi se dit : `docs/conservation.md`).
create function plateforme.console_effacement_decider(p_id uuid, p_decision text, p_raison text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); d plateforme.demande_effacement;
begin
  select * into d from plateforme.demande_effacement where id = p_id for update;
  if not found then perform socle.refus('cette demande d''effacement n''existe pas'); end if;
  if d.decision is not null then perform socle.refus('cette demande a déjà sa décision'); end if;
  if coalesce(p_decision, '') not in ('accordee', 'refusee') then perform socle.refus('une demande se décide : accordée, ou refusée'); end if;
  if length(btrim(coalesce(p_raison, ''))) < 3 then perform socle.refus('une décision dit sa raison (trois caractères au moins) : elle se répond à la personne'); end if;
  update plateforme.demande_effacement set decision = p_decision, raison = btrim(p_raison), decidee_le = p_maintenant, decidee_par = socle.moi() where id = p_id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, apres)
    values (socle.moi(), v_role, 'donnees.effacement_decide', d.entreprise, btrim(p_raison), jsonb_build_object('demande', p_id, 'decision', p_decision));
end $$;

-- Effacer (la direction) : le compte d'une personne, la demande accordée. Les données d'une entreprise ne s'effacent pas
-- d'ici (l'outil de l'exploitation, C54) : la console le dit, sans rien noter de fait.
create function plateforme.console_effacement_faire(p_id uuid, p_motif text, p_maintenant timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); d plateforme.demande_effacement; v_preuve jsonb;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('effacer dit pourquoi (trois caractères au moins) : le motif reste au journal de la console'); end if;
  select * into d from plateforme.demande_effacement where id = p_id for update;
  if not found then perform socle.refus('cette demande d''effacement n''existe pas'); end if;
  if d.decision is distinct from 'accordee' then perform socle.refus('une demande s''efface une fois accordée'); end if;
  if d.faite_le is not null then perform socle.refus('cet effacement est déjà fait'); end if;
  if d.sorte = 'entreprise' then
    perform socle.refus('les données d''une entreprise s''effacent sur la machine, avec l''outil de l''exploitation : la console ne le fait pas');
  end if;
  v_preuve := socle.effacer_personne(d.utilisateur, p_maintenant);
  update plateforme.demande_effacement set faite_le = p_maintenant, faite_par = socle.moi(), preuve = v_preuve where id = p_id;
  -- Le nom que la personne a donné en écrivant part aussi, de chacune de ses demandes : le registre garde le numéro, les
  -- dates, la décision et la preuve.
  update plateforme.demande_effacement set demandeur = 'Personne effacée' where utilisateur = d.utilisateur;
  insert into plateforme.geste_console (qui, role, geste, motif, apres)
    values (socle.moi(), v_role, 'donnees.effacement_fait', btrim(p_motif), jsonb_build_object('demande', p_id, 'preuve', v_preuve));
  return v_preuve;
end $$;

-- Ce que l'écran montre (la direction et le support) : chaque demande, son état et son échéance ; le compte visé
-- (son nom et son adresse, tant qu'il n'est pas effacé) ; l'entreprise. Les plus pressées d'abord.
create function plateforme.console_effacements(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'ref', format('EFF-%s-%s', d.annee, lpad(d.numero::text, 3, '0')), 'recueLe', d.recue_le, 'echeance', plateforme.echeance_effacement(d.recue_le),
      'canal', d.canal, 'demandeur', d.demandeur, 'sorte', d.sorte,
      'compte', case when d.utilisateur is not null then (select jsonb_build_object('nom', u.nom, 'email', u.email, 'efface', u.email like 'efface-%@efface.invalid') from socle.utilisateur u where u.id = d.utilisateur) end,
      'entreprise', case when d.entreprise is not null then (select jsonb_build_object('id', e.id, 'nom', e.raison_sociale, 'numero', plateforme.numero_texte(e.id)) from socle.entreprise e where e.id = d.entreprise) end,
      'noteePar', (select u.nom from socle.utilisateur u where u.id = d.notee_par), 'noteeLe', d.notee_le,
      'decision', d.decision, 'raison', d.raison, 'decideeLe', d.decidee_le, 'decideePar', (select u.nom from socle.utilisateur u where u.id = d.decidee_par),
      'faiteLe', d.faite_le, 'faitePar', (select u.nom from socle.utilisateur u where u.id = d.faite_par), 'preuve', d.preuve)
    order by (d.decision is null) desc, (d.decision = 'accordee' and d.faite_le is null and d.sorte = 'personne') desc, d.recue_le, d.numero), '[]'::jsonb)
    from plateforme.demande_effacement d);
end $$;

revoke execute on function plateforme.console_effacement_noter(text, text, date, text, text, text, timestamptz),
  plateforme.console_effacement_decider(uuid, text, text, timestamptz), plateforme.console_effacement_faire(uuid, text, timestamptz),
  plateforme.console_effacements(timestamptz) from public;
grant execute on function plateforme.console_effacement_noter(text, text, date, text, text, text, timestamptz),
  plateforme.console_effacement_decider(uuid, text, text, timestamptz), plateforme.console_effacement_faire(uuid, text, timestamptz),
  plateforme.console_effacements(timestamptz), plateforme.echeance_effacement(date) to skanfact_app;
