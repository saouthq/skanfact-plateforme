-- 0224 — L'invitation du comptable et les remises d'un appareil, alignées sur les règles de l'équipe.
--
-- 1. Le lien d'invitation d'un comptable se prend avec le compte de l'adresse invitée, comme l'invitation d'une
--    personne de l'équipe (0030, accepter_invitation) : le cabinet qui l'ouvre avec une autre adresse lit pourquoi.
-- 2. Les remises d'un appareil (0044) attendent la décision du propriétaire (03, D8) : elles se lisent et se décident
--    par ceux qui voient toute l'entreprise, propriétaire et administrateur.
create or replace function socle.rejoindre_par_invitation_comptable(p_empreinte text, p_cabinet uuid, p_maintenant timestamptz)
returns table (entreprise uuid, mandat uuid)
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare i record; v_mandat uuid; v_email text;
begin
  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet reçoit un dossier'); end if;
  select * into i from socle.invitation_comptable x where x.jeton_empreinte = p_empreinte for update;
  if not found or i.utilisee_le is not null or i.annulee_le is not null or i.expire_le <= p_maintenant then
    perform socle.refus('ce lien ne vaut plus : demande à ton client de t''inviter de nouveau');
  end if;
  select lower(btrim(u.email)) into v_email from socle.utilisateur u where u.id = socle.moi();
  if v_email is distinct from lower(btrim(i.email)) then
    perform socle.refus('cette invitation a été envoyée à une autre adresse : connecte-toi avec celle-là');
  end if;
  if not exists (select 1 from socle.membre m where m.entreprise = i.entreprise and m.utilisateur = i.invite_par
                  and m.actif and 'proprietaire' = any(m.roles)) then
    perform socle.refus('celui qui t''a invité n''est plus le propriétaire de cette entreprise : demande-lui de t''inviter de nouveau');
  end if;
  if exists (select 1 from socle.mandat d where d.entreprise = i.entreprise and d.statut in ('propose', 'actif')) then
    perform socle.refus('cette entreprise a déjà un cabinet : ton client doit d''abord arrêter son mandat');
  end if;
  insert into socle.mandat (cabinet, entreprise, accorde_par, debut, perimetre, statut)
  values (p_cabinet, i.entreprise, i.invite_par, current_date, i.perimetre, 'propose') returning id into v_mandat;
  update socle.invitation_comptable set utilisee_le = p_maintenant, mandat = v_mandat where id = i.id;
  entreprise := i.entreprise; mandat := v_mandat;
  return next;
end $$;

drop policy visible on socle.quarantaine;
create policy visible on socle.quarantaine using (entreprise in (select socle.mes_entreprises()) and socle.mes_roles(entreprise) && array['proprietaire', 'administrateur']::text[]);
