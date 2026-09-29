-- L'équipe du cabinet (brique 46, 29/09/2026 ; docs/cabinet.md, C36). Le Cabinet v10 déclarait ses
-- collaborateurs par leur NOM (une identité déclarée sur un poste, pas un mot de passe) et posait leurs
-- droits dossier par dossier. Sur la plateforme, chacun entre avec son propre compte :
--   - l'associé INVITE une personne par son adresse, avec un rôle (associé, collaborateur, assistant de
--     saisie) ; elle rejoint le cabinet en ouvrant le lien, connectée avec cette adresse (l'invitation
--     de l'entreprise, 0003, étendue aux cabinets) ;
--   - il change son rôle, ou la retire (elle n'est pas effacée : son nom reste sur ce qu'elle a fait) ;
--     personne ne change son propre rôle ni ne se retire : le cabinet garde toujours un associé (la
--     porte ne se ferme pas de l'intérieur) ;
--   - confier un dossier reste `confier_dossier` (0019).
-- Chaque geste se trace, au nom du cabinet.

alter table socle.invitation alter column entreprise drop not null;
alter table socle.invitation add column organisation uuid references socle.organisation(id);
alter table socle.invitation add constraint invitation_une_cible check ((entreprise is null) <> (organisation is null));
drop policy lire on socle.invitation;
create policy lire on socle.invitation for select using (
  (entreprise in (select socle.mes_entreprises()) and socle.mes_roles(entreprise) && array['proprietaire', 'administrateur']::text[])
  or (organisation is not null and socle.suis_associe(organisation)));

-- Les rôles d'une personne au cabinet (03 § 3).
create function socle.role_de_cabinet_valide(p_role text) returns boolean
language sql immutable as $$ select p_role in ('supervision', 'revision', 'saisie') $$;

create function socle.inviter_au_cabinet(p_cabinet uuid, p_email text, p_role text, p_jeton_empreinte text, p_expire_le timestamptz)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v uuid; v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet invite quelqu''un dans son équipe'); end if;
  if not socle.role_de_cabinet_valide(p_role) then perform socle.refus('ce rôle n''existe pas au cabinet'); end if;
  if v_email = (select lower(email) from socle.utilisateur where id = socle.moi()) then perform socle.refus('personne ne s''invite soi-même'); end if;
  if exists (select 1 from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
              where m.organisation = p_cabinet and m.actif and lower(u.email) = v_email) then
    perform socle.refus('cette personne fait déjà partie du cabinet');
  end if;
  insert into socle.invitation (organisation, email, roles, jeton_empreinte, invite_par, expire_le)
  values (p_cabinet, v_email, array[p_role], p_jeton_empreinte, socle.moi(), p_expire_le)
  returning id into v;
  perform socle.tracer(null, 'cabinet.equipe.inviter', 'cabinet', p_cabinet, null, jsonb_build_object('email', v_email, 'role', p_role, 'invitation', v));
  return v;
end $$;

create function socle.annuler_invitation_cabinet(p_invitation uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare i socle.invitation;
begin
  select * into i from socle.invitation where id = p_invitation and organisation is not null for update;
  if not found or not socle.suis_associe(i.organisation) then perform socle.refus('cette invitation n''existe pas'); end if;
  if i.acceptee_le is not null then perform socle.refus('cette invitation a déjà été acceptée : retire la personne du cabinet si elle ne doit plus y être'); end if;
  update socle.invitation set annulee_le = now() where id = p_invitation;
  perform socle.tracer(null, 'cabinet.equipe.annuler', 'cabinet', i.organisation, null, jsonb_build_object('email', i.email, 'invitation', i.id));
end $$;

-- Accepter une invitation : il faut être connecté avec la MÊME adresse que l'invitation. Celle d'un
-- cabinet fait de la personne un membre du cabinet (0003 : celle d'une entreprise, inchangée).
create or replace function socle.accepter_invitation(p_jeton_empreinte text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare i record; v_membre uuid; v_email text;
begin
  select email into v_email from socle.utilisateur where id = socle.moi();
  select * into i from socle.invitation where jeton_empreinte = p_jeton_empreinte for update;
  if not found or i.acceptee_le is not null or i.annulee_le is not null or i.expire_le <= p_maintenant then
    perform socle.refus('cette invitation n''est plus valable : demande-en une nouvelle');
  end if;
  if lower(v_email) <> i.email then
    perform socle.refus('cette invitation a été envoyée à une autre adresse');
  end if;
  if i.organisation is not null then
    insert into socle.membre (utilisateur, organisation, roles, invite_par)
    values (socle.moi(), i.organisation, i.roles, i.invite_par)
    on conflict (utilisateur, organisation) where organisation is not null
    do update set roles = excluded.roles, actif = true
    returning id into v_membre;
    update socle.invitation set acceptee_le = p_maintenant where id = i.id;
    perform socle.tracer(null, 'cabinet.equipe.accepter', 'cabinet', i.organisation, null, jsonb_build_object('membre', v_membre, 'roles', i.roles));
    return v_membre;
  end if;
  -- Le propriétaire ne perd jamais son rôle par une invitation (D4).
  if exists (select 1 from socle.membre where utilisateur = socle.moi() and entreprise = i.entreprise and actif and 'proprietaire' = any(roles)) then
    perform socle.refus('tu es le propriétaire de cette entreprise : ton rôle ne change pas par une invitation');
  end if;
  insert into socle.membre (utilisateur, entreprise, roles, invite_par)
  values (socle.moi(), i.entreprise, i.roles, i.invite_par)
  on conflict (utilisateur, entreprise) where entreprise is not null
  do update set roles = excluded.roles, actif = true
  returning id into v_membre;
  update socle.invitation set acceptee_le = p_maintenant where id = i.id;
  perform socle.tracer(i.entreprise, 'socle.equipe.accepter', 'membre', v_membre, null, jsonb_build_object('roles', i.roles));
  return v_membre;
end $$;

-- Le membre d'un cabinet sur lequel un associé agit, jamais lui-même : un associé ne se retire ni ne
-- se rétrograde, un autre associé le fait — le cabinet garde donc toujours un associé.
create function socle.membre_du_cabinet(p_cabinet uuid, p_membre uuid) returns socle.membre
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare m socle.membre;
begin
  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet change son équipe'); end if;
  select * into m from socle.membre where id = p_membre and organisation = p_cabinet and actif for update;
  if not found then perform socle.refus('cette personne n''est pas de l''équipe du cabinet'); end if;
  if m.utilisateur = socle.moi() then perform socle.refus('personne ne change son propre rôle, ni ne se retire soi-même : un autre associé le fait'); end if;
  return m;
end $$;

create function socle.changer_role_cabinet(p_cabinet uuid, p_membre uuid, p_role text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare m socle.membre;
begin
  if not socle.role_de_cabinet_valide(p_role) then perform socle.refus('ce rôle n''existe pas au cabinet'); end if;
  m := socle.membre_du_cabinet(p_cabinet, p_membre);
  update socle.membre set roles = array[p_role] where id = p_membre;
  perform socle.tracer(null, 'cabinet.equipe.changer_role', 'cabinet', p_cabinet, jsonb_build_object('membre', p_membre, 'roles', m.roles),
    jsonb_build_object('membre', p_membre, 'roles', array[p_role]));
end $$;

-- La retirer : elle n'est pas effacée (son nom reste sur ce qu'elle a fait) ; ses dossiers confiés
-- ne lui sont plus ouverts.
create function socle.retirer_du_cabinet(p_cabinet uuid, p_membre uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare m socle.membre;
begin
  m := socle.membre_du_cabinet(p_cabinet, p_membre);
  update socle.membre set actif = false where id = p_membre;
  perform socle.tracer(null, 'cabinet.equipe.retirer', 'cabinet', p_cabinet, jsonb_build_object('membre', p_membre, 'roles', m.roles, 'actif', true),
    jsonb_build_object('membre', p_membre, 'actif', false));
end $$;

revoke execute on function socle.inviter_au_cabinet(uuid, text, text, text, timestamptz), socle.annuler_invitation_cabinet(uuid),
  socle.membre_du_cabinet(uuid, uuid), socle.changer_role_cabinet(uuid, uuid, text), socle.retirer_du_cabinet(uuid, uuid) from public;
grant execute on function socle.inviter_au_cabinet(uuid, text, text, text, timestamptz), socle.annuler_invitation_cabinet(uuid),
  socle.changer_role_cabinet(uuid, uuid, text), socle.retirer_du_cabinet(uuid, uuid) to skanfact_app;
