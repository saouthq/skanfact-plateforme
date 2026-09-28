-- 0002 — Se connecter (cadrage : docs/cadrage/03-droits.md § 6, 01 § 4 `appareil` et `session`).
--
-- Se connecter se passe AVANT de savoir qui est « moi » : ces gestes passent donc par des fonctions
-- de la base, étroites, qui ne rendent que ce qu'il faut à l'étape en cours. Le calcul des
-- empreintes (Argon2id) et des codes se fait dans le serveur ; la base garde et compte.

-- Le code sur le téléphone : par SMS (défaut) ou par une application (TOTP).
alter table socle.utilisateur
  add column code_methode text check (code_methode in ('sms', 'application')),
  -- Le secret de l'application d'authentification (base32). À VÉRIFIER : chiffrement au repos
  -- avec une clé du pli scellé (06 § 5), avant la première donnée réelle.
  add column code_secret text;

-- Les 10 codes de secours, à usage unique, gardés en empreinte seulement.
create table socle.code_secours (
  id uuid primary key default socle.uuidv7(),
  utilisateur uuid not null references socle.utilisateur(id),
  empreinte text not null,
  utilise_le timestamptz
);

-- Une étape de connexion en attente du code (le mot de passe est déjà bon).
create table socle.defi_connexion (
  id uuid primary key default socle.uuidv7(),
  utilisateur uuid not null references socle.utilisateur(id),
  appareil uuid references socle.appareil(id),
  methode text not null check (methode in ('sms', 'application', 'secours')),
  -- Pour un SMS : l'empreinte du code envoyé. Pour une application : vide (le code se calcule).
  code_empreinte text,
  cree_le timestamptz not null,
  expire_le timestamptz not null,
  erreurs int not null default 0,
  resolu_le timestamptz
);

-- Les erreurs de mot de passe ou de code : une attente qui s'allonge, jamais un blocage définitif
-- (03 § 6 : sinon n'importe qui bloquerait le compte d'un autre).
create table socle.tentative (
  cle text primary key,            -- l'adresse e-mail, en minuscules
  erreurs int not null default 0,
  attente_jusqu_au timestamptz,
  derniere timestamptz
);

-- La session : un jeton gardé en empreinte seulement ; elle se ferme après un temps d'inaction.
create table socle.session (
  id uuid primary key default socle.uuidv7(),
  utilisateur uuid not null references socle.utilisateur(id),
  appareil uuid references socle.appareil(id),
  jeton_empreinte text not null unique,
  ouverte_le timestamptz not null,
  derniere_activite timestamptz not null,
  inaction_max interval not null,
  -- « Ce n'est pas mon ordinateur » : rien n'est gardé sur le poste, pas de hors-ligne (03 § 6).
  poste_d_un_autre boolean not null default false,
  -- Le code sur le téléphone est obligatoire pour cette personne mais pas encore en place : la
  -- session ne sert qu'à le mettre en place (la porte des droits refuse tout le reste).
  code_a_configurer boolean not null default false,
  fermee_le timestamptz,
  ip inet
);

-- Chacun voit ses propres sessions et ses codes de secours restants, jamais ceux d'un autre.
alter table socle.session enable row level security;
alter table socle.session force row level security;
create policy visible on socle.session using (utilisateur = socle.moi());

alter table socle.code_secours enable row level security;
alter table socle.code_secours force row level security;
create policy visible on socle.code_secours using (utilisateur = socle.moi());

-- Les défis et les tentatives ne se lisent que par les fonctions ci-dessous.
alter table socle.defi_connexion enable row level security;
alter table socle.defi_connexion force row level security;
alter table socle.tentative enable row level security;
alter table socle.tentative force row level security;

-- ── Les fonctions de la connexion ────────────────────────────────────────────────────────────────

-- Ce qu'il faut pour vérifier un mot de passe : l'identifiant, l'empreinte, la méthode de code, et
-- si le code est OBLIGATOIRE pour cette personne (03 § 6 : propriétaire, administrateur, paie, et
-- tous les comptables d'un cabinet).
create function socle.pour_connexion(p_email text)
returns table (utilisateur uuid, empreinte text, code_methode text, code_secret text, telephone text, code_obligatoire boolean)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select u.id, u.empreinte_mot_de_passe, u.code_methode, u.code_secret, u.telephone,
         exists (select 1 from socle.membre m
                  where m.utilisateur = u.id and m.actif
                    and m.roles && array['proprietaire', 'administrateur', 'paie', 'supervision', 'revision', 'saisie']::text[])
    from socle.utilisateur u where lower(u.email) = lower(trim(p_email))
$$;

-- L'attente en cours pour une adresse (null s'il n'y en a pas).
create function socle.attente_connexion(p_cle text, p_maintenant timestamptz) returns timestamptz
language sql stable security definer set search_path = pg_catalog, socle as $$
  select t.attente_jusqu_au from socle.tentative t
   where t.cle = lower(trim(p_cle)) and t.attente_jusqu_au > p_maintenant
$$;

-- Une erreur de plus. Après 5 erreurs : 1 min, puis 5, puis 15, puis 60 (plafond), jamais plus.
create function socle.noter_erreur(p_cle text, p_maintenant timestamptz) returns timestamptz
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_erreurs int; v_attente timestamptz;
begin
  insert into socle.tentative (cle, erreurs, derniere) values (lower(trim(p_cle)), 1, p_maintenant)
  on conflict (cle) do update set erreurs = socle.tentative.erreurs + 1, derniere = p_maintenant
  returning erreurs into v_erreurs;
  if v_erreurs >= 5 then
    v_attente := p_maintenant + case
      when v_erreurs = 5 then interval '1 minute'
      when v_erreurs = 6 then interval '5 minutes'
      when v_erreurs = 7 then interval '15 minutes'
      else interval '60 minutes' end;
    update socle.tentative set attente_jusqu_au = v_attente where cle = lower(trim(p_cle));
  end if;
  return v_attente;
end $$;

create function socle.effacer_erreurs(p_cle text) returns void
language sql volatile security definer set search_path = pg_catalog, socle as $$
  delete from socle.tentative where cle = lower(trim(p_cle))
$$;

-- L'appareil est-il reconnu (le code n'est redemandé qu'après 30 jours, 03 § 6) ?
create function socle.appareil_reconnu(p_utilisateur uuid, p_appareil uuid, p_maintenant timestamptz) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select exists (select 1 from socle.appareil a
                  where a.id = p_appareil and a.utilisateur = p_utilisateur
                    and a.revoque_le is null and a.reconnu_jusqu_au > p_maintenant)
$$;

-- Cet appareil est-il à cette personne, et pas révoqué ? (reconnu ou non)
create function socle.appareil_de(p_utilisateur uuid, p_appareil uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select exists (select 1 from socle.appareil a where a.id = p_appareil and a.utilisateur = p_utilisateur and a.revoque_le is null)
$$;

-- Ouvrir un défi (le mot de passe est bon, il faut le code).
create function socle.ouvrir_defi(p_utilisateur uuid, p_appareil uuid, p_methode text, p_code_empreinte text,
                                  p_maintenant timestamptz, p_duree interval) returns uuid
language sql volatile security definer set search_path = pg_catalog, socle as $$
  insert into socle.defi_connexion (utilisateur, appareil, methode, code_empreinte, cree_le, expire_le)
  values (p_utilisateur, p_appareil, p_methode, p_code_empreinte, p_maintenant, p_maintenant + p_duree)
  returning id
$$;

-- Lire un défi encore ouvert (le serveur vérifie le code avec ce qu'il rend).
create function socle.lire_defi(p_defi uuid, p_maintenant timestamptz)
returns table (utilisateur uuid, appareil uuid, methode text, code_empreinte text, code_secret text, erreurs int, email text)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select d.utilisateur, d.appareil, d.methode, d.code_empreinte, u.code_secret, d.erreurs, u.email
    from socle.defi_connexion d join socle.utilisateur u on u.id = d.utilisateur
   where d.id = p_defi and d.resolu_le is null and d.expire_le > p_maintenant and d.erreurs < 5
$$;

create function socle.defi_erreur(p_defi uuid) returns void
language sql volatile security definer set search_path = pg_catalog, socle as $$
  update socle.defi_connexion set erreurs = erreurs + 1 where id = p_defi
$$;

-- Le défi réussi : il se ferme (un code ne sert qu'une fois), l'appareil est reconnu 30 jours
-- (sauf sur le poste d'un autre), et la session s'ouvre.
create function socle.conclure_defi(p_defi uuid, p_jeton_empreinte text, p_maintenant timestamptz,
                                    p_poste_d_un_autre boolean, p_ip inet) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare d record; v_session uuid;
begin
  update socle.defi_connexion set resolu_le = p_maintenant
   where id = p_defi and resolu_le is null and expire_le > p_maintenant
   returning * into d;
  if not found then
    raise exception 'ce code n''est plus valable : recommence la connexion' using errcode = '42501';
  end if;
  if d.appareil is not null and not p_poste_d_un_autre then
    update socle.appareil set reconnu_jusqu_au = p_maintenant + interval '30 days', dernier_vu = p_maintenant
     where id = d.appareil and utilisateur = d.utilisateur and revoque_le is null;
  end if;
  v_session := socle.ouvrir_session(d.utilisateur, d.appareil, p_jeton_empreinte, p_maintenant, p_poste_d_un_autre, p_ip);
  return v_session;
end $$;

-- Ouvrir une session : 12 heures d'inaction au plus, 30 minutes sur le poste d'un autre (03 § 6).
create function socle.ouvrir_session(p_utilisateur uuid, p_appareil uuid, p_jeton_empreinte text,
                                     p_maintenant timestamptz, p_poste_d_un_autre boolean, p_ip inet,
                                     p_code_a_configurer boolean default false) returns uuid
language sql volatile security definer set search_path = pg_catalog, socle as $$
  insert into socle.session (utilisateur, appareil, jeton_empreinte, ouverte_le, derniere_activite, inaction_max,
                             poste_d_un_autre, code_a_configurer, ip)
  values (p_utilisateur, p_appareil, p_jeton_empreinte, p_maintenant, p_maintenant,
          case when p_poste_d_un_autre then interval '30 minutes' else interval '12 hours' end,
          p_poste_d_un_autre, p_code_a_configurer, p_ip)
  returning id
$$;

-- Qui est derrière ce jeton ? La session doit être ouverte, pas trop longtemps inactive, et son
-- appareil ne doit pas être révoqué. Chaque lecture repousse l'inaction.
create function socle.qui_est(p_jeton_empreinte text, p_maintenant timestamptz)
returns table (utilisateur uuid, session uuid, appareil uuid, poste_d_un_autre boolean, code_a_configurer boolean)
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  return query
  update socle.session s set derniere_activite = p_maintenant
   where s.jeton_empreinte = p_jeton_empreinte and s.fermee_le is null
     and s.derniere_activite + s.inaction_max > p_maintenant
     and not exists (select 1 from socle.appareil a where a.id = s.appareil and a.revoque_le is not null)
  returning s.utilisateur, s.id, s.appareil, s.poste_d_un_autre, s.code_a_configurer;
end $$;

-- Utiliser un code de secours : le serveur a déjà trouvé lequel (par l'empreinte) ; on le marque.
create function socle.codes_secours_restants(p_utilisateur uuid)
returns table (id uuid, empreinte text)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select c.id, c.empreinte from socle.code_secours c where c.utilisateur = p_utilisateur and c.utilise_le is null
$$;

create function socle.consommer_code_secours(p_code uuid, p_maintenant timestamptz) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  update socle.code_secours set utilise_le = p_maintenant where id = p_code and utilise_le is null;
  return found;
end $$;

-- Poser le mot de passe (à l'inscription, ou quand la personne le change : « moi » seulement).
create function socle.poser_mot_de_passe(p_utilisateur uuid, p_empreinte text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is not null and socle.moi() <> p_utilisateur then
    raise exception 'personne ne change le mot de passe d''un autre' using errcode = '42501';
  end if;
  update socle.utilisateur set empreinte_mot_de_passe = p_empreinte where id = p_utilisateur;
end $$;

-- Mettre en place le code sur le téléphone, et recevoir ses 10 codes de secours (moi seulement).
create function socle.poser_code(p_methode text, p_secret text, p_empreintes_secours text[]) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is null then raise exception 'personne n''est connecté' using errcode = '42501'; end if;
  if cardinality(p_empreintes_secours) <> 10 then raise exception 'il faut 10 codes de secours'; end if;
  update socle.utilisateur set code_methode = p_methode, code_secret = p_secret where id = socle.moi();
  delete from socle.code_secours where utilisateur = socle.moi();
  insert into socle.code_secours (utilisateur, empreinte) select socle.moi(), e from unnest(p_empreintes_secours) e;
  update socle.session set code_a_configurer = false where utilisateur = socle.moi() and fermee_le is null;
end $$;

-- Un appareil se déclare à la connexion (il n'a pas encore de session).
create function socle.declarer_appareil(p_utilisateur uuid, p_nom text, p_type text, p_maintenant timestamptz) returns uuid
language sql volatile security definer set search_path = pg_catalog, socle as $$
  insert into socle.appareil (utilisateur, nom, type, premier_vu, dernier_vu) values (p_utilisateur, p_nom, p_type, p_maintenant, p_maintenant)
  returning id
$$;

-- Révoquer un de SES appareils (03 § 6) : ses sessions tombent aussitôt.
create function socle.revoquer_appareil(p_appareil uuid, p_maintenant timestamptz) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  update socle.appareil set revoque_le = p_maintenant where id = p_appareil and utilisateur = socle.moi() and revoque_le is null;
  if not found then return false; end if;
  update socle.session set fermee_le = p_maintenant where appareil = p_appareil and fermee_le is null;
  return true;
end $$;

-- Tout ce qui précède se lance par le serveur seulement.
revoke execute on function socle.pour_connexion(text), socle.attente_connexion(text, timestamptz),
  socle.noter_erreur(text, timestamptz), socle.effacer_erreurs(text), socle.appareil_reconnu(uuid, uuid, timestamptz), socle.appareil_de(uuid, uuid),
  socle.ouvrir_defi(uuid, uuid, text, text, timestamptz, interval), socle.lire_defi(uuid, timestamptz),
  socle.defi_erreur(uuid), socle.conclure_defi(uuid, text, timestamptz, boolean, inet),
  socle.ouvrir_session(uuid, uuid, text, timestamptz, boolean, inet, boolean), socle.qui_est(text, timestamptz),
  socle.codes_secours_restants(uuid), socle.consommer_code_secours(uuid, timestamptz),
  socle.poser_mot_de_passe(uuid, text), socle.poser_code(text, text, text[]),
  socle.declarer_appareil(uuid, text, text, timestamptz), socle.revoquer_appareil(uuid, timestamptz) from public;
grant execute on function socle.pour_connexion(text), socle.attente_connexion(text, timestamptz),
  socle.noter_erreur(text, timestamptz), socle.effacer_erreurs(text), socle.appareil_reconnu(uuid, uuid, timestamptz), socle.appareil_de(uuid, uuid),
  socle.ouvrir_defi(uuid, uuid, text, text, timestamptz, interval), socle.lire_defi(uuid, timestamptz),
  socle.defi_erreur(uuid), socle.conclure_defi(uuid, text, timestamptz, boolean, inet),
  socle.ouvrir_session(uuid, uuid, text, timestamptz, boolean, inet, boolean), socle.qui_est(text, timestamptz),
  socle.codes_secours_restants(uuid), socle.consommer_code_secours(uuid, timestamptz),
  socle.poser_mot_de_passe(uuid, text), socle.poser_code(text, text, text[]),
  socle.declarer_appareil(uuid, text, text, timestamptz), socle.revoquer_appareil(uuid, timestamptz) to skanfact_app;
grant select on socle.session, socle.code_secours to skanfact_app;
grant update (fermee_le) on socle.session to skanfact_app;

-- ── Ce qu'on lit et ce qu'on modifie d'une personne ──────────────────────────────────────────────
-- Voir un collègue ne donne jamais l'empreinte de son mot de passe ni le secret de son code : le
-- serveur ne peut lire que les colonnes utiles. Et on ne modifie que sa propre fiche.
revoke select, insert, update on socle.utilisateur from skanfact_app;
grant select (id, email, nom, telephone, telephone_verifie_le, langue, code_methode, cree_le) on socle.utilisateur to skanfact_app;
grant update (nom, telephone, langue) on socle.utilisateur to skanfact_app;
drop policy visible on socle.utilisateur;
create policy lire on socle.utilisateur for select using (id in (select socle.mes_collegues()));
create policy modifier_soi on socle.utilisateur for update using (id = socle.moi()) with check (id = socle.moi());

-- Les rôles, les mandats et les affectations ne se changent que par des fonctions qui appliquent
-- les règles (03 D4 à D6 : personne ne se donne un droit à soi-même). Le serveur ne les écrit pas
-- directement : même un bug ne ferait pas d'un commercial un propriétaire.
revoke insert, update on socle.membre, socle.mandat from skanfact_app;
revoke insert, delete on socle.mandat_affectation from skanfact_app;
