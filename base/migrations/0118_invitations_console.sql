-- 0118 : inviter quelqu'un dans l'équipe SkanFact, et son premier code posé à sa première connexion (1.25.0 ; docs/console.md
-- C41 ; la maquette « Équipe »).
--
-- Jusqu'ici, la direction n'ajoutait qu'une personne qui avait déjà un compte SkanFact (créé d'abord dans l'application),
-- et la console ne s'ouvrait pas tant que son code du téléphone n'était pas en place — ce qui se faisait dans
-- l'application, où un membre de l'équipe n'a pas toujours d'entreprise. Désormais :
--   1. la direction invite une adresse, avec un rôle et un motif ; le lien vaut sept jours, la base n'en garde que
--      l'empreinte. Comme pour l'équipe d'une entreprise (docs/equipe.md E5), le serveur n'envoie rien : le lien se montre
--      une fois à la direction, qui le transmet par ses moyens. Une nouvelle invitation à la même adresse remplace
--      l'ancienne (« Renvoyer ») ; une invitation qui attend s'annule ;
--   2. qui ouvre le lien rejoint l'équipe avec son compte (son mot de passe le prouve) ou en crée un ; l'adresse est celle
--      de l'invitation, jamais une autre ;
--   3. un membre arrivé depuis moins de sept jours, sans code du téléphone, le pose à sa première connexion à la console :
--      le mot de passe juste ouvre un défi « pose » (une application d'authentification, ses dix codes de secours), et le
--      premier code juste l'active et ouvre la session. Passé sept jours sans code, la console le refuse comme avant.
-- Chaque geste entre au journal de l'équipe, écrit en entier.

create table plateforme.invitation_console (
  id uuid primary key default socle.uuidv7(),
  email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role text not null check (role in ('direction', 'support', 'technique')),
  jeton_empreinte text not null unique,
  invite_par uuid not null references socle.utilisateur(id),
  invitee_le timestamptz not null,
  expire_le timestamptz not null,
  acceptee_le timestamptz,
  acceptee_par uuid references socle.utilisateur(id),
  annulee_le timestamptz,
  check (acceptee_le is null or annulee_le is null),
  check ((acceptee_le is null) = (acceptee_par is null))
);
create index on plateforme.invitation_console (email) where acceptee_le is null and annulee_le is null;
alter table plateforme.invitation_console enable row level security;
alter table plateforme.invitation_console force row level security;

-- Le défi de la première connexion : poser son code.
alter table plateforme.defi_console drop constraint defi_console_methode_check;
alter table plateforme.defi_console add constraint defi_console_methode_check check (methode in ('sms', 'application', 'pose'));

-- ── 1. Inviter, renvoyer, annuler (la direction) ─────────────────────────────────────────────────────────────────────
create function plateforme.console_inviter(p_email text, p_role text, p_motif text, p_jeton_empreinte text, p_maintenant timestamptz,
                                           p_expire_le timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); v_email text := lower(btrim(coalesce(p_email, ''))); v uuid; n int;
begin
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

-- Renvoyer : un lien neuf pour la même adresse et le même rôle ; l'ancien ne vaut plus.
create function plateforme.console_renvoyer_invitation(p_invitation uuid, p_motif text, p_jeton_empreinte text, p_maintenant timestamptz,
                                                       p_expire_le timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); i record;
begin
  select * into i from plateforme.invitation_console where id = p_invitation and acceptee_le is null and annulee_le is null;
  if not found then perform socle.refus('cette invitation n''attend plus : invite la personne de nouveau'); end if;
  return plateforme.console_inviter(i.email, i.role, p_motif, p_jeton_empreinte, p_maintenant, p_expire_le);
end $$;

create function plateforme.console_annuler_invitation(p_invitation uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); i record;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur l''équipe demande son motif (trois caractères au moins)'); end if;
  update plateforme.invitation_console set annulee_le = p_maintenant
   where id = p_invitation and acceptee_le is null and annulee_le is null returning * into i;
  if not found then perform socle.refus('cette invitation n''attend plus : invite la personne de nouveau'); end if;
  insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
    values (socle.moi(), v_role, 'equipe.invitation_annulee', null, btrim(p_motif), jsonb_build_object('email', i.email, 'role', i.role), null);
end $$;

-- Les invitations qui attendent (le lien vaut encore, ou ne vaut plus depuis moins de trente jours : à renvoyer).
create function plateforme.console_invitations(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'inviteeLe', i.invitee_le,
            'expireLe', i.expire_le, 'expiree', i.expire_le <= p_maintenant, 'invitePar', u.nom) order by i.invitee_le desc), '[]'::jsonb)
    from plateforme.invitation_console i join socle.utilisateur u on u.id = i.invite_par
   where i.acceptee_le is null and i.annulee_le is null and i.expire_le > p_maintenant - interval '30 days');
end $$;

-- ── 2. Le lien, ouvert par l'invité ──────────────────────────────────────────────────────────────────────────────────
-- Ce que le lien dit avant d'entrer : l'adresse, le rôle, qui invite, jusqu'à quand, et si un compte a déjà cette adresse.
-- Un lien qui ne vaut plus (servi, annulé, remplacé, passé, inventé) ne dit rien : la même absence.
create function plateforme.apercu_invitation_console(p_jeton_empreinte text, p_maintenant timestamptz)
returns table (invitation uuid, email text, role text, invite_par text, expire_le timestamptz, compte boolean)
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select i.id, i.email, i.role, u.nom, i.expire_le, exists (select 1 from socle.utilisateur c where lower(c.email) = i.email)
    from plateforme.invitation_console i join socle.utilisateur u on u.id = i.invite_par
   where i.jeton_empreinte = p_jeton_empreinte and i.acceptee_le is null and i.annulee_le is null and i.expire_le > p_maintenant
$$;

-- Accepter, en tant que la personne (le serveur a vérifié son mot de passe, ou vient de créer son compte) : l'adresse du
-- compte est celle de l'invitation. Rend le rôle, et si son code du téléphone est déjà en place.
create function plateforme.accepter_invitation_console(p_jeton_empreinte text, p_maintenant timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare i record; v_email text; v_code text; v_avant jsonb;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
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

-- ── 3. Le premier code, à la première connexion ──────────────────────────────────────────────────────────────────────
-- Un membre arrivé depuis moins de sept jours, sans code : il peut le poser à la connexion de la console.
create function plateforme.peut_poser_code_console(p_utilisateur uuid, p_maintenant timestamptz) returns boolean
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select exists (select 1 from plateforme.equipe e join socle.utilisateur u on u.id = e.utilisateur
                  where e.utilisateur = p_utilisateur and e.actif and e.ajoute_le > p_maintenant - interval '7 days'
                    and u.code_methode is distinct from 'sms' and u.code_methode is distinct from 'application')
$$;

-- Le défi « pose » se vérifie sur le code préparé (une heure au plus), pas sur un code en place.
create or replace function plateforme.lire_defi_console(p_defi uuid, p_maintenant timestamptz)
returns table (utilisateur uuid, appareil uuid, methode text, code_empreinte text, code_secret text, erreurs int, email text)
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select d.utilisateur, d.appareil, d.methode, d.code_empreinte,
         case when d.methode = 'pose' then (case when u.code_attente_le > p_maintenant - interval '1 hour' then u.code_secret_attente end)
              else u.code_secret end,
         d.erreurs, u.email
    from plateforme.defi_console d join socle.utilisateur u on u.id = d.utilisateur
   where d.id = p_defi and d.resolu_le is null and d.expire_le > p_maintenant and d.erreurs < 5
     and plateforme.role_dans_l_equipe(d.utilisateur) is not null
$$;

-- Au journal, le premier code posé (la méthode lue dans le compte : une application).
create function plateforme.code_pose_console(p_utilisateur uuid) returns void
language sql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
  insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
    select p_utilisateur, e.role, 'equipe.premier_code', p_utilisateur, 'posé à sa première connexion', null,
           jsonb_build_object('methode', u.code_methode)
      from plateforme.equipe e join socle.utilisateur u on u.id = e.utilisateur
     where e.utilisateur = p_utilisateur and e.actif
$$;

revoke execute on function plateforme.console_inviter(text, text, text, text, timestamptz, timestamptz),
  plateforme.console_renvoyer_invitation(uuid, text, text, timestamptz, timestamptz), plateforme.console_annuler_invitation(uuid, text, timestamptz),
  plateforme.console_invitations(timestamptz), plateforme.apercu_invitation_console(text, timestamptz),
  plateforme.accepter_invitation_console(text, timestamptz), plateforme.peut_poser_code_console(uuid, timestamptz),
  plateforme.code_pose_console(uuid) from public;
grant execute on function plateforme.console_inviter(text, text, text, text, timestamptz, timestamptz),
  plateforme.console_renvoyer_invitation(uuid, text, text, timestamptz, timestamptz), plateforme.console_annuler_invitation(uuid, text, timestamptz),
  plateforme.console_invitations(timestamptz), plateforme.apercu_invitation_console(text, timestamptz),
  plateforme.accepter_invitation_console(text, timestamptz), plateforme.peut_poser_code_console(uuid, timestamptz),
  plateforme.code_pose_console(uuid) to skanfact_app;
