-- 0123 : l'équipe SkanFact tient en concurrence (1.29.0 ; l'audit de la console 1.26.0, C05 et C06 ; docs/console.md C45).
--
-- Deux gestes sur l'équipe en même temps pouvaient défaire ce que chacun vérifiait seul :
--   - C05 : avec deux personnes à la direction, A rétrograde B pendant que B rétrograde A. Chacun verrouillait la ligne
--     de l'autre et comptait encore deux directions : les deux passaient, et plus personne ne gérait l'équipe ;
--   - C06 : deux invitations à la même adresse, au même moment, ne trouvaient chacune rien à remplacer : deux liens
--     valaient, avec deux rôles, et « la nouvelle remplace l'ancienne » n'était plus vrai.
-- Désormais, chaque geste qui change l'équipe ou ses invitations prend d'abord un même verrou (plateforme.verrou_equipe :
-- un verrou de transaction, rendu au commit), puis revérifie ce qu'il croit : le rôle de qui agit (il a pu changer
-- pendant l'attente), la direction qui reste, l'invitation qui attend. Et la base n'admet plus qu'une invitation en
-- attente par adresse (un index unique) : ce qui passerait à côté du verrou échouerait au lieu de laisser deux liens.

create function plateforme.verrou_equipe() returns void
language sql volatile security definer set search_path = pg_catalog as $$
  select pg_advisory_xact_lock(hashtext('plateforme.equipe'))
$$;
revoke execute on function plateforme.verrou_equipe() from public;
grant execute on function plateforme.verrou_equipe() to skanfact_app;

-- Une seule invitation en attente par adresse. Celles qui se doublaient déjà : la plus récente reste.
update plateforme.invitation_console i set annulee_le = now()
 where i.acceptee_le is null and i.annulee_le is null
   and exists (select 1 from plateforme.invitation_console j where j.email = i.email and j.acceptee_le is null and j.annulee_le is null
                 and (j.invitee_le, j.id) > (i.invitee_le, i.id));
drop index plateforme.invitation_console_email_idx;
create unique index invitation_console_une_en_attente on plateforme.invitation_console (email) where acceptee_le is null and annulee_le is null;

-- ── Les gestes sur l'équipe : le verrou d'abord, puis tout se revérifie ─────────────────────────────────────────────
-- (Le rôle de qui agit se relit APRÈS le verrou : une instruction qui suit l'attente voit ce que l'autre geste a validé.)
create or replace function plateforme.console_ajouter_membre(p_email text, p_role text, p_motif text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); v_u uuid; v_avant jsonb;
begin
  perform plateforme.verrou_equipe();
  v_role := plateforme.exiger_role_console(array['direction']);
  if coalesce(p_role, '') not in ('direction', 'support', 'technique') then perform socle.refus('ce rôle n''existe pas dans l''équipe SkanFact'); end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur l''équipe demande son motif (trois caractères au moins)'); end if;
  select u.id into v_u from socle.utilisateur u where lower(u.email) = lower(btrim(p_email));
  if v_u is null then
    perform socle.refus('aucun compte SkanFact n''a cette adresse : la personne crée d''abord son compte sur l''application');
  end if;
  select jsonb_build_object('role', e.role, 'actif', e.actif) into v_avant from plateforme.equipe e where e.utilisateur = v_u for update;
  if coalesce((v_avant->>'actif')::boolean, false) then
    perform socle.refus('cette personne fait déjà partie de l''équipe SkanFact : change son rôle dans la liste');
  end if;
  insert into plateforme.equipe (utilisateur, role) values (v_u, p_role)
    on conflict (utilisateur) do update set role = excluded.role, actif = true, ajoute_le = now(), retire_le = null;
  insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
    values (socle.moi(), v_role, 'equipe.ajouter', v_u, btrim(p_motif), v_avant, jsonb_build_object('role', p_role, 'actif', true));
  return v_u;
end $$;

create or replace function plateforme.console_changer_role(p_membre uuid, p_role text, p_motif text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); v_avant text;
begin
  perform plateforme.verrou_equipe();
  v_role := plateforme.exiger_role_console(array['direction']);
  if coalesce(p_role, '') not in ('direction', 'support', 'technique') then perform socle.refus('ce rôle n''existe pas dans l''équipe SkanFact'); end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur l''équipe demande son motif (trois caractères au moins)'); end if;
  if p_membre = socle.moi() then perform socle.refus('personne ne change son propre rôle'); end if;
  select e.role into v_avant from plateforme.equipe e where e.utilisateur = p_membre and e.actif for update;
  if v_avant is null then perform socle.refus('membre introuvable'); end if;
  if v_avant = p_role then perform socle.refus('cette personne a déjà ce rôle'); end if;
  if v_avant = 'direction' and (select count(*) from plateforme.equipe e where e.role = 'direction' and e.actif) = 1 then
    perform socle.refus('l''équipe garde toujours une personne à la direction');
  end if;
  update plateforme.equipe set role = p_role where utilisateur = p_membre;
  insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
    values (socle.moi(), v_role, 'equipe.role', p_membre, btrim(p_motif), jsonb_build_object('role', v_avant), jsonb_build_object('role', p_role));
end $$;

create or replace function plateforme.console_retirer_membre(p_membre uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); v_avant text;
begin
  perform plateforme.verrou_equipe();
  v_role := plateforme.exiger_role_console(array['direction']);
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur l''équipe demande son motif (trois caractères au moins)'); end if;
  if p_membre = socle.moi() then perform socle.refus('personne ne se retire soi-même de l''équipe SkanFact'); end if;
  select e.role into v_avant from plateforme.equipe e where e.utilisateur = p_membre and e.actif for update;
  if v_avant is null then perform socle.refus('membre introuvable'); end if;
  if v_avant = 'direction' and (select count(*) from plateforme.equipe e where e.role = 'direction' and e.actif) = 1 then
    perform socle.refus('l''équipe garde toujours une personne à la direction');
  end if;
  update plateforme.equipe set actif = false, retire_le = p_maintenant where utilisateur = p_membre;
  -- Ses sessions de la console tombent aussitôt.
  update plateforme.session_console set fermee_le = p_maintenant where utilisateur = p_membre and fermee_le is null;
  insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
    values (socle.moi(), v_role, 'equipe.retirer', p_membre, btrim(p_motif), jsonb_build_object('role', v_avant, 'actif', true),
            jsonb_build_object('role', v_avant, 'actif', false));
end $$;

-- ── Les invitations : une seule en attente par adresse, remplacée sous le verrou ───────────────────────────────────
create or replace function plateforme.console_inviter(p_email text, p_role text, p_motif text, p_jeton_empreinte text, p_maintenant timestamptz,
                                                      p_expire_le timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); v_email text := lower(btrim(coalesce(p_email, ''))); v uuid; n int;
begin
  perform plateforme.verrou_equipe();
  v_role := plateforme.exiger_role_console(array['direction']);
  if coalesce(p_role, '') not in ('direction', 'support', 'technique') then perform socle.refus('ce rôle n''existe pas dans l''équipe SkanFact'); end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur l''équipe demande son motif (trois caractères au moins)'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform socle.refus('cette adresse e-mail ne va pas'); end if;
  if exists (select 1 from plateforme.equipe e join socle.utilisateur u on u.id = e.utilisateur where e.actif and lower(u.email) = v_email) then
    perform socle.refus('cette personne fait déjà partie de l''équipe SkanFact : change son rôle dans la liste');
  end if;
  -- L'invitation qui attendait à la même adresse ne vaut plus : la nouvelle la remplace.
  update plateforme.invitation_console set annulee_le = p_maintenant
   where email = v_email and acceptee_le is null and annulee_le is null;
  get diagnostics n = row_count;
  insert into plateforme.invitation_console (email, role, jeton_empreinte, invite_par, invitee_le, expire_le)
    values (v_email, p_role, p_jeton_empreinte, socle.moi(), p_maintenant, p_expire_le) returning id into v;
  if n > 0 then
    insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
      values (socle.moi(), v_role, 'equipe.invitation_renvoyee', null, btrim(p_motif), null,
              jsonb_build_object('email', v_email, 'role', p_role, 'expire', p_expire_le));
  else
    insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
      values (socle.moi(), v_role, 'equipe.inviter', null, btrim(p_motif), null,
              jsonb_build_object('email', v_email, 'role', p_role, 'expire', p_expire_le));
  end if;
  return v;
end $$;

create or replace function plateforme.console_annuler_invitation(p_invitation uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); i record;
begin
  perform plateforme.verrou_equipe();
  v_role := plateforme.exiger_role_console(array['direction']);
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur l''équipe demande son motif (trois caractères au moins)'); end if;
  update plateforme.invitation_console set annulee_le = p_maintenant
   where id = p_invitation and acceptee_le is null and annulee_le is null returning * into i;
  if not found then perform socle.refus('cette invitation n''attend plus : invite la personne de nouveau'); end if;
  insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
    values (socle.moi(), v_role, 'equipe.invitation_annulee', null, btrim(p_motif), jsonb_build_object('email', i.email, 'role', i.role), null);
end $$;

-- Accepter : sous le verrou, l'invitation se relit (remplacée ou annulée pendant l'attente, elle ne vaut plus), et un
-- membre devenu actif entre-temps n'a pas son rôle remplacé.
create or replace function plateforme.accepter_invitation_console(p_jeton_empreinte text, p_maintenant timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare i record; v_email text; v_code text; v_avant jsonb;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  perform plateforme.verrou_equipe();
  select * into i from plateforme.invitation_console
   where jeton_empreinte = p_jeton_empreinte and acceptee_le is null and annulee_le is null and expire_le > p_maintenant for update;
  if not found then perform socle.refus('ce lien d''invitation ne vaut plus : demande un nouveau lien à la direction'); end if;
  select lower(u.email), u.code_methode into v_email, v_code from socle.utilisateur u where u.id = socle.moi();
  if v_email is distinct from i.email then perform socle.refus('cette invitation est pour une autre adresse'); end if;
  select jsonb_build_object('role', e.role, 'actif', e.actif) into v_avant from plateforme.equipe e where e.utilisateur = socle.moi() for update;
  if coalesce((v_avant->>'actif')::boolean, false) then
    perform socle.refus('tu fais déjà partie de l''équipe SkanFact');
  end if;
  insert into plateforme.equipe (utilisateur, role, ajoute_le) values (socle.moi(), i.role, p_maintenant)
    on conflict (utilisateur) do update set role = excluded.role, actif = true, ajoute_le = excluded.ajoute_le, retire_le = null;
  update plateforme.invitation_console set acceptee_le = p_maintenant, acceptee_par = socle.moi() where id = i.id;
  insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
    values (socle.moi(), i.role, 'equipe.invitation_acceptee', socle.moi(), 'arrivé par son invitation', v_avant,
            jsonb_build_object('role', i.role, 'actif', true));
  return jsonb_build_object('role', i.role, 'code', coalesce(v_code in ('sms', 'application'), false));
end $$;
