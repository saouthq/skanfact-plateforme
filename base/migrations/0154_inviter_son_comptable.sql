-- Inviter son comptable par e-mail, quand il n'est pas encore sur SkanFact (1.77.0 ; recette du 20/10/2026 ;
-- docs/recette.md). Le propriétaire donne l'adresse de son comptable ; SkanFact lui écrit (le même relais que l'équipe,
-- 0119) ; le comptable ouvre le lien, crée son compte puis son cabinet (ou ouvre celui qu'il a), et le dossier du client
-- y arrive PROPOSÉ, avec le périmètre que le client a choisi : l'associé l'accepte sur sa page Dossiers, comme un code
-- tapé. Le lien n'existe que dans le message (la base n'en garde que l'empreinte), vaut 30 jours, une fois ; une
-- nouvelle invitation remplace l'ancienne ; un dossier qui a déjà un cabinet n'invite pas.

create table socle.invitation_comptable (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  email text not null,
  perimetre text[] not null,
  jeton_empreinte text not null unique,
  invite_par uuid not null references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null,
  utilisee_le timestamptz,
  annulee_le timestamptz,
  mandat uuid references socle.mandat(id),
  courriel text,
  courriel_le timestamptz
);
create index invitation_comptable_entreprise on socle.invitation_comptable (entreprise);
alter table socle.invitation_comptable enable row level security;
alter table socle.invitation_comptable force row level security;
-- Elle se voit par le propriétaire et l'administrateur de l'entreprise, comme les invitations de l'équipe ; elle
-- s'écrit par les fonctions qui suivent seulement.
create policy lire on socle.invitation_comptable for select using (
  entreprise in (select socle.mes_entreprises())
  and socle.mes_roles(entreprise) && array['proprietaire', 'administrateur']::text[]);
grant select on socle.invitation_comptable to skanfact_app;

-- Le propriétaire invite : seul lui choisit son cabinet (0019), et pas pendant qu'un mandat est proposé ou en cours.
-- L'invitation d'avant, si elle attend encore, s'annule : un seul lien vaut à la fois.
create function socle.inviter_comptable(p_entreprise uuid, p_email text, p_perimetre text[], p_empreinte text, p_expire timestamptz)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_id uuid; v_email text := lower(btrim(p_email));
begin
  if not ('proprietaire' = any(socle.mes_roles(p_entreprise))) or socle.perimetre_cabinet(p_entreprise) is not null then
    perform socle.refus('seul le propriétaire de l''entreprise invite son comptable');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform socle.refus('cette adresse e-mail ne va pas'); end if;
  if exists (select 1 from socle.mandat d where d.entreprise = p_entreprise and d.statut in ('propose', 'actif')) then
    perform socle.refus('cette entreprise a déjà un cabinet : arrête d''abord son mandat');
  end if;
  update socle.invitation_comptable set annulee_le = now()
   where entreprise = p_entreprise and utilisee_le is null and annulee_le is null;
  insert into socle.invitation_comptable (entreprise, email, perimetre, jeton_empreinte, invite_par, expire_le)
  values (p_entreprise, v_email, p_perimetre, p_empreinte, socle.moi(), p_expire) returning id into v_id;
  return v_id;
end $$;

-- Le propriétaire annule l'invitation qui attend : le lien cesse de valoir.
create function socle.annuler_invitation_comptable(p_entreprise uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if not ('proprietaire' = any(socle.mes_roles(p_entreprise))) or socle.perimetre_cabinet(p_entreprise) is not null then
    perform socle.refus('seul le propriétaire de l''entreprise invite son comptable');
  end if;
  update socle.invitation_comptable set annulee_le = now()
   where entreprise = p_entreprise and utilisee_le is null and annulee_le is null;
end $$;

-- Ce que le lien dit, avant de se connecter (comme 0079) : l'entreprise qui invite, qui l'invite, l'adresse invitée.
create function socle.apercu_invitation_comptable(p_empreinte text, p_maintenant timestamptz)
returns table (entreprise text, invite_par text, email text, expire_le timestamptz)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select e.raison_sociale, coalesce(nullif(btrim(u.nom), ''), u.email), i.email, i.expire_le
    from socle.invitation_comptable i
    join socle.entreprise e on e.id = i.entreprise
    join socle.utilisateur u on u.id = i.invite_par
   where i.jeton_empreinte = p_empreinte and i.utilisee_le is null and i.annulee_le is null and i.expire_le > p_maintenant
$$;

-- Le comptable, associé du cabinet qu'il vient de créer (ou qu'il a déjà), reçoit le dossier : le mandat naît PROPOSÉ
-- au nom du propriétaire qui a invité, avec son périmètre ; l'associé l'accepte ensuite sur sa page Dossiers. Le lien
-- ne sert qu'une fois ; refusé s'il ne vaut plus, si le dossier a trouvé un cabinet entre-temps, ou si celui qui
-- invitait n'en est plus le propriétaire.
create function socle.rejoindre_par_invitation_comptable(p_empreinte text, p_cabinet uuid, p_maintenant timestamptz)
returns table (entreprise uuid, mandat uuid)
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare i record; v_mandat uuid;
begin
  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet reçoit un dossier'); end if;
  select * into i from socle.invitation_comptable x where x.jeton_empreinte = p_empreinte for update;
  if not found or i.utilisee_le is not null or i.annulee_le is not null or i.expire_le <= p_maintenant then
    perform socle.refus('ce lien ne vaut plus : demande à ton client de t''inviter de nouveau');
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

-- L'état de l'e-mail (0124, 0138) se note aussi sur l'invitation du comptable, par l'empreinte de son lien.
create or replace function socle.noter_courriel_invitation(p_empreinte text, p_etat text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if p_etat not in ('a_envoyer', 'parti', 'refuse', 'en_attente', 'sans_relais') then perform socle.refus('cet état d''un e-mail n''existe pas'); end if;
  update socle.invitation set courriel = p_etat, courriel_le = p_maintenant
   where jeton_empreinte = p_empreinte
     and (p_etat <> 'en_attente' or courriel is null or courriel = 'a_envoyer');
  update plateforme.invitation_console set courriel = p_etat, courriel_le = p_maintenant
   where jeton_empreinte = p_empreinte
     and (p_etat <> 'en_attente' or courriel is null or courriel = 'a_envoyer');
  update socle.invitation_comptable set courriel = p_etat, courriel_le = p_maintenant
   where jeton_empreinte = p_empreinte
     and (p_etat <> 'en_attente' or courriel is null or courriel = 'a_envoyer');
end $$;

revoke all on function socle.inviter_comptable(uuid, text, text[], text, timestamptz), socle.annuler_invitation_comptable(uuid),
  socle.apercu_invitation_comptable(text, timestamptz), socle.rejoindre_par_invitation_comptable(text, uuid, timestamptz) from public;
grant execute on function socle.inviter_comptable(uuid, text, text[], text, timestamptz), socle.annuler_invitation_comptable(uuid),
  socle.apercu_invitation_comptable(text, timestamptz), socle.rejoindre_par_invitation_comptable(text, uuid, timestamptz) to skanfact_app;
