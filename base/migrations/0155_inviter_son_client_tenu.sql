-- Le cabinet invite son client tenu à rejoindre son dossier (1.78.0 ; 03 § 3.5 ; docs/recette.md). Un dossier tenu est
-- l'entreprise d'un client qui n'est pas sur SkanFact, sans aucun membre côté client (D4). L'associé donne l'adresse
-- du client ; SkanFact lui écrit (le relais de l'équipe, 0119) ; le client ouvre le lien, crée son compte (ou se
-- connecte) AVEC CETTE ADRESSE, et devient le PROPRIÉTAIRE de son dossier : ses livres sont ceux que le cabinet a tenus,
-- le mandat continue, actif, avec le même périmètre (la paie reste ouverte si le cabinet la faisait : le client peut la
-- décocher, 03 § 3.4). Le dossier n'est plus « tenu » : il compte pour le cabinet comme celui d'un client abonné (07).
-- Son essai part du jour où il rejoint, comme pour toute entreprise qui arrive : celui du dossier tenu courait depuis sa
-- création (décidé par délégation le 20/10/2026, à confirmer par Skander). Le lien : l'empreinte seulement, 30 jours,
-- une fois ; une nouvelle invitation remplace l'ancienne.

create table socle.invitation_client_tenu (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  cabinet uuid not null references socle.organisation(id),
  email text not null,
  jeton_empreinte text not null unique,
  invite_par uuid not null references socle.utilisateur(id),
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null,
  utilisee_le timestamptz,
  annulee_le timestamptz,
  courriel text,
  courriel_le timestamptz
);
create index invitation_client_tenu_entreprise on socle.invitation_client_tenu (entreprise);
alter table socle.invitation_client_tenu enable row level security;
alter table socle.invitation_client_tenu force row level security;
-- Elle se voit par les associés du cabinet qui tient le dossier ; elle s'écrit par les fonctions qui suivent seulement.
create policy lire on socle.invitation_client_tenu for select using (socle.suis_associe(cabinet));
grant select on socle.invitation_client_tenu to skanfact_app;

-- L'associé du cabinet qui tient le dossier invite ; l'invitation d'avant, si elle attend, s'annule.
create function socle.inviter_client_tenu(p_entreprise uuid, p_email text, p_empreinte text, p_expire timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid; v_id uuid; v_email text := lower(btrim(p_email));
begin
  select e.tenue_par into v_cabinet from socle.entreprise e where e.id = p_entreprise;
  if v_cabinet is null or not socle.suis_associe(v_cabinet) then
    perform socle.refus('seul un associé du cabinet qui tient ce dossier invite son client');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform socle.refus('cette adresse e-mail ne va pas'); end if;
  update socle.invitation_client_tenu set annulee_le = now()
   where entreprise = p_entreprise and utilisee_le is null and annulee_le is null;
  insert into socle.invitation_client_tenu (entreprise, cabinet, email, jeton_empreinte, invite_par, expire_le)
  values (p_entreprise, v_cabinet, v_email, p_empreinte, socle.moi(), p_expire) returning id into v_id;
  return v_id;
end $$;

create function socle.annuler_invitation_client_tenu(p_entreprise uuid) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_cabinet uuid;
begin
  select e.tenue_par into v_cabinet from socle.entreprise e where e.id = p_entreprise;
  if v_cabinet is null or not socle.suis_associe(v_cabinet) then
    perform socle.refus('seul un associé du cabinet qui tient ce dossier invite son client');
  end if;
  update socle.invitation_client_tenu set annulee_le = now()
   where entreprise = p_entreprise and utilisee_le is null and annulee_le is null;
end $$;

-- Ce que le lien dit, avant de se connecter : le dossier, le cabinet, qui invite, l'adresse invitée.
create function socle.apercu_invitation_client_tenu(p_empreinte text, p_maintenant timestamptz)
returns table (entreprise text, cabinet text, invite_par text, email text, expire_le timestamptz)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select e.raison_sociale, o.nom, coalesce(nullif(btrim(u.nom), ''), u.email), i.email, i.expire_le
    from socle.invitation_client_tenu i
    join socle.entreprise e on e.id = i.entreprise
    join socle.organisation o on o.id = i.cabinet
    join socle.utilisateur u on u.id = i.invite_par
   where i.jeton_empreinte = p_empreinte and i.utilisee_le is null and i.annulee_le is null and i.expire_le > p_maintenant
     and e.tenue_par = i.cabinet
$$;

-- Le client rejoint son dossier : avec l'adresse invitée seulement ; il en devient le propriétaire, le dossier n'est
-- plus tenu, le mandat continue ; son essai part d'aujourd'hui s'il n'a rien payé.
create function socle.rejoindre_dossier_tenu(p_empreinte text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare i record; v_email text; v_jour date; v_jusqu_au date;
begin
  if socle.moi() is null then perform socle.refus('connecte-toi d''abord'); end if;
  select * into i from socle.invitation_client_tenu x where x.jeton_empreinte = p_empreinte for update;
  if not found or i.utilisee_le is not null or i.annulee_le is not null or i.expire_le <= p_maintenant then
    perform socle.refus('ce lien ne vaut plus : demande à ton cabinet de t''inviter de nouveau');
  end if;
  select email into v_email from socle.utilisateur where id = socle.moi();
  if lower(v_email) <> i.email then
    perform socle.refus('cette invitation a été envoyée à une autre adresse : connecte-toi avec celle-là');
  end if;
  if not exists (select 1 from socle.entreprise e where e.id = i.entreprise and e.tenue_par = i.cabinet) then
    perform socle.refus('ce dossier n''est plus tenu par ton cabinet : demande-lui ce qu''il en est');
  end if;
  insert into socle.membre (utilisateur, entreprise, roles) values (socle.moi(), i.entreprise, array['proprietaire']);
  update socle.entreprise set tenue_par = null where id = i.entreprise;
  select (p_maintenant at time zone e.fuseau)::date into v_jour from socle.entreprise e where e.id = i.entreprise;
  v_jusqu_au := v_jour + coalesce((plateforme.regle_du_jour('essai', v_jour))[1], 0);
  update plateforme.abonnement a set essai_jusqu_au = greatest(a.essai_jusqu_au, v_jusqu_au)
   where a.entreprise = i.entreprise and a.paye_jusqu_au is null;
  if found then
    insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, apres)
    values (i.entreprise, 'essai_commence', 'systeme', 'le client a rejoint son dossier tenu', jsonb_build_object('essaiJusquAu', v_jusqu_au));
  end if;
  update socle.invitation_client_tenu set utilisee_le = p_maintenant where id = i.id;
  return i.entreprise;
end $$;

-- L'état de l'e-mail (0124, 0138, 0154) se note aussi sur l'invitation du client tenu.
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
  update socle.invitation_client_tenu set courriel = p_etat, courriel_le = p_maintenant
   where jeton_empreinte = p_empreinte
     and (p_etat <> 'en_attente' or courriel is null or courriel = 'a_envoyer');
end $$;

revoke all on function socle.inviter_client_tenu(uuid, text, text, timestamptz), socle.annuler_invitation_client_tenu(uuid),
  socle.apercu_invitation_client_tenu(text, timestamptz), socle.rejoindre_dossier_tenu(text, timestamptz) from public;
grant execute on function socle.inviter_client_tenu(uuid, text, text, timestamptz), socle.annuler_invitation_client_tenu(uuid),
  socle.apercu_invitation_client_tenu(text, timestamptz), socle.rejoindre_dossier_tenu(text, timestamptz) to skanfact_app;
