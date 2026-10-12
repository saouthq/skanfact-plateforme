-- L'équipe de l'entreprise, à l'écran (lot équipe, 12/10/2026 ; docs/equipe.md). Le serveur savait inviter, changer
-- un rôle et retirer quelqu'un depuis la brique 46 (0003) ; aucun écran ne le proposait, et un commerçant ne pouvait
-- pas donner un accès à son vendeur. L'écran demande deux choses de plus à la base :
--   1. annuler une invitation qui attend (son lien ne vaut plus) ;
--   2. inviter une adresse qui a déjà une invitation en attente la REMPLACE : l'écran montre une ligne par personne,
--      et l'ancien lien ne vaut plus (on renvoie un lien neuf à qui a perdu le premier) ;
-- et refuse d'inviter quelqu'un qui fait déjà partie de l'équipe : ses rôles se changent dans la liste. Accepter une
-- telle invitation remplaçait ses rôles en silence.

create or replace function socle.inviter(p_entreprise uuid, p_email text, p_roles text[], p_jeton_empreinte text, p_expire_le timestamptz)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v uuid; v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if cardinality(socle.roles_donnables(p_entreprise)) = 0 then
    perform socle.refus('ton rôle ne permet pas d''inviter quelqu''un dans l''équipe');
  end if;
  if cardinality(p_roles) = 0 or not (p_roles <@ socle.roles_donnables(p_entreprise)) then
    perform socle.refus('tu ne peux pas donner ce rôle');
  end if;
  if v_email = (select lower(email) from socle.utilisateur where id = socle.moi()) then
    perform socle.refus('personne ne s''invite soi-même');
  end if;
  if exists (select 1 from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
              where m.entreprise = p_entreprise and m.actif and lower(u.email) = v_email) then
    perform socle.refus('cette personne fait déjà partie de l''équipe : change ses rôles dans la liste');
  end if;
  -- L'invitation qui attendait à la même adresse ne vaut plus : la nouvelle la remplace.
  update socle.invitation set annulee_le = now()
   where entreprise = p_entreprise and email = v_email and acceptee_le is null and annulee_le is null;
  insert into socle.invitation (entreprise, email, roles, jeton_empreinte, invite_par, expire_le)
  values (p_entreprise, v_email, p_roles, p_jeton_empreinte, socle.moi(), p_expire_le)
  returning id into v;
  perform socle.tracer(p_entreprise, 'socle.equipe.inviter', 'invitation', v, null,
    jsonb_build_object('email', v_email, 'roles', p_roles));
  return v;
end $$;

-- Annuler une invitation de l'entreprise : par qui gère l'équipe (le propriétaire, un administrateur). Une invitation
-- d'une autre entreprise, ou que l'on ne gère pas, « n'existe pas » (03 D3). Déjà acceptée, elle ne s'annule plus : la
-- personne est dans l'équipe, et c'est elle qu'on retire.
create function socle.annuler_invitation(p_invitation uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare i socle.invitation;
begin
  select * into i from socle.invitation where id = p_invitation and entreprise is not null for update;
  if not found or i.entreprise not in (select socle.mes_entreprises()) or cardinality(socle.roles_donnables(i.entreprise)) = 0 then
    perform socle.refus('cette invitation n''existe pas');
  end if;
  if i.acceptee_le is not null then
    perform socle.refus('cette invitation a déjà été acceptée : retire la personne de l''équipe si elle ne doit plus y être');
  end if;
  if i.annulee_le is null then
    update socle.invitation set annulee_le = now() where id = p_invitation;
    perform socle.tracer(i.entreprise, 'socle.equipe.annuler', 'invitation', i.id, null, jsonb_build_object('email', i.email));
  end if;
end $$;

revoke execute on function socle.annuler_invitation(uuid) from public;
grant execute on function socle.annuler_invitation(uuid) to skanfact_app;

-- Ce qu'un lien d'invitation dit à qui l'ouvre, AVANT de se connecter : où il mène (l'entreprise ou le cabinet), qui
-- invite, et l'adresse avec laquelle entrer. Sans elle, la personne crée son compte à une autre adresse (la sienne de
-- tous les jours), et l'invitation lui est refusée au bout du chemin, « envoyée à une autre adresse ». Rien pour un lien
-- qui ne vaut plus. Le lien est le secret : qui le tient n'en apprend que ce que le message qui le portait disait déjà.
create function socle.apercu_invitation(p_jeton_empreinte text, p_maintenant timestamptz)
returns table (email text, entreprise text, cabinet text, invite_par text, expire_le timestamptz)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select i.email, e.raison_sociale, o.nom, coalesce(nullif(btrim(u.nom), ''), u.email), i.expire_le
    from socle.invitation i
    left join socle.entreprise e on e.id = i.entreprise
    left join socle.organisation o on o.id = i.organisation
    join socle.utilisateur u on u.id = i.invite_par
   where i.jeton_empreinte = p_jeton_empreinte and i.acceptee_le is null and i.annulee_le is null and i.expire_le > p_maintenant
$$;

revoke execute on function socle.apercu_invitation(text, timestamptz) from public;
grant execute on function socle.apercu_invitation(text, timestamptz) to skanfact_app;
