-- Le code du téléphone facultatif dans une entreprise, et les codes par e-mail (décision de Skander du 09/10/2026, sur
-- les maquettes de l'onboarding ; skanfact docs/cadrage/03-droits.md § 6 ; docs/entree.md).
--
-- 1. Le code du téléphone n'est plus exigé que des comptables d'un cabinet (ils voient les comptes et les salaires de
--    dizaines d'entreprises), et de l'équipe SkanFact quand la console sera là. Dans une entreprise, il est recommandé,
--    jamais imposé, quel que soit le rôle : l'imposer dès l'inscription arrêtait un débutant avant même l'essai.
-- 2. Il se retire, dans Paramètres → Ton compte : le serveur a d'abord vérifié le code du moment ou un code de secours
--    (qui n'a que le mot de passe ne l'enlève pas) ; la base refuse à qui un rôle l'exige, et trace.
-- 3. Un défi par e-mail, seulement si le serveur sait envoyer un e-mail : à la première connexion d'un compte dont
--    l'adresse n'est pas encore vérifiée (juste après l'inscription), et à la première connexion d'un appareil inconnu
--    quand la personne n'a pas de code du téléphone. Le code est le même qu'un code par SMS : six chiffres, gardés en
--    empreinte. Réussi, il prouve l'adresse (recevoir le code, c'est la lire) et reconnaît l'appareil 30 jours.

-- Le jour où l'adresse a été prouvée (un code reçu à cette adresse, puis tapé).
alter table socle.utilisateur add column adresse_verifiee_le timestamptz;
-- Le défi par e-mail ; il se renvoie : combien de fois, et quand pour la dernière (personne ne remplit la boîte d'un
-- autre).
alter table socle.defi_connexion drop constraint defi_connexion_methode_check;
alter table socle.defi_connexion add constraint defi_connexion_methode_check check (methode in ('sms', 'application', 'secours', 'courriel'));
alter table socle.defi_connexion add column envois int not null default 1, add column envoye_le timestamptz;

-- ── 1. Qui doit avoir le code du téléphone ─────────────────────────────────────────────────────────────────────────
-- La connexion le lit avant de savoir qui est « moi » (0002) ; la porte le relit à chaque requête (0003).
create or replace function socle.pour_connexion(p_email text)
returns table (utilisateur uuid, empreinte text, code_methode text, code_secret text, telephone text, code_obligatoire boolean)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select u.id, u.empreinte_mot_de_passe, u.code_methode, u.code_secret, u.telephone,
         exists (select 1 from socle.membre m
                  where m.utilisateur = u.id and m.actif
                    and m.roles && array['supervision', 'revision', 'saisie']::text[])
    from socle.utilisateur u where lower(u.email) = lower(trim(p_email))
$$;

create or replace function socle.code_manquant() returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select coalesce((select u.code_methode is null from socle.utilisateur u where u.id = socle.moi()), false)
     and exists (select 1 from socle.membre m where m.utilisateur = socle.moi() and m.actif
                  and m.roles && array['supervision', 'revision', 'saisie']::text[])
$$;

-- Ce que « Ton compte » montre : le code est-il exigé de moi (on ne propose pas de le retirer), mon adresse est-elle
-- vérifiée, et combien de codes de secours me restent.
create function socle.mon_compte() returns table (code_exige boolean, adresse_verifiee boolean, codes_secours int)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select exists (select 1 from socle.membre m where m.utilisateur = socle.moi() and m.actif
                  and m.roles && array['supervision', 'revision', 'saisie']::text[]),
         u.adresse_verifiee_le is not null,
         (select count(*)::int from socle.code_secours c where c.utilisateur = u.id and c.utilise_le is null)
    from socle.utilisateur u where u.id = socle.moi()
$$;

-- De nouveaux codes de secours (les anciens ne valent plus) : le serveur a vérifié le code du moment juste avant.
create function socle.nouveaux_codes_secours(p_empreintes text[]) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  if cardinality(p_empreintes) <> 10 then raise exception 'il faut 10 codes de secours'; end if;
  if (select u.code_methode from socle.utilisateur u where u.id = socle.moi()) is null then
    perform socle.refus('le code du téléphone n''est pas activé sur ce compte');
  end if;
  delete from socle.code_secours where utilisateur = socle.moi();
  insert into socle.code_secours (utilisateur, empreinte) select socle.moi(), e from unnest(p_empreintes) e;
  perform socle.tracer(null, 'compte.code.secours', 'utilisateur', socle.moi(), null, null);
end $$;

-- Changer son mot de passe : le serveur a vérifié l'ancien. Les autres sessions se ferment (qui connaissait l'ancien est
-- dehors) ; celle-ci reste ouverte.
create function socle.changer_mot_de_passe(p_empreinte text, p_session uuid, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  update socle.utilisateur set empreinte_mot_de_passe = p_empreinte where id = socle.moi();
  update socle.session set fermee_le = p_maintenant where utilisateur = socle.moi() and fermee_le is null and id <> p_session;
  perform socle.tracer(null, 'compte.mot_de_passe.changer', 'utilisateur', socle.moi(), null, null);
end $$;

-- ── 1 bis. Activer le code en deux temps ───────────────────────────────────────────────────────────────────────────
-- Devenu facultatif, le code s'active depuis Ton compte. Posé tout de suite (poser_code, 0002), une activation
-- abandonnée en route (la page fermée avant d'avoir ajouté SkanFact à l'application) enfermait la personne dehors :
-- la connexion, et même le mot de passe oublié, demandaient un code qu'elle n'avait pas. Le code se PRÉPARE d'abord
-- (le secret et les codes de secours attendent, une heure au plus), puis ne s'active qu'avec le premier code juste.
alter table socle.utilisateur add column code_secret_attente text, add column code_secours_attente text[], add column code_attente_le timestamptz;

create function socle.preparer_code(p_secret text, p_empreintes_secours text[], p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  if cardinality(p_empreintes_secours) <> 10 then raise exception 'il faut 10 codes de secours'; end if;
  update socle.utilisateur set code_secret_attente = p_secret, code_secours_attente = p_empreintes_secours, code_attente_le = p_maintenant
   where id = socle.moi();
end $$;

create function socle.mon_secret_en_attente(p_maintenant timestamptz) returns text
language sql stable security definer set search_path = pg_catalog, socle as $$
  select u.code_secret_attente from socle.utilisateur u
   where u.id = socle.moi() and u.code_attente_le > p_maintenant - interval '1 hour'
$$;

-- Le premier code juste (vérifié par le serveur) : le code préparé devient celui du compte, avec ses codes de secours.
-- Qui avait déjà un code (il change de téléphone) l'a prouvé avant la préparation.
create function socle.activer_code_en_attente(p_maintenant timestamptz) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_secret text; v_secours text[];
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  select u.code_secret_attente, u.code_secours_attente into v_secret, v_secours from socle.utilisateur u
   where u.id = socle.moi() and u.code_attente_le > p_maintenant - interval '1 hour';
  if v_secret is null then return false; end if;
  update socle.utilisateur set code_methode = 'application', code_secret = v_secret,
         code_secret_attente = null, code_secours_attente = null, code_attente_le = null
   where id = socle.moi();
  delete from socle.code_secours where utilisateur = socle.moi();
  insert into socle.code_secours (utilisateur, empreinte) select socle.moi(), e from unnest(v_secours) e;
  update socle.session set code_a_configurer = false where utilisateur = socle.moi() and fermee_le is null;
  perform socle.tracer(null, 'compte.code.activer', 'utilisateur', socle.moi(), null, jsonb_build_object('methode', 'application'));
  return true;
end $$;

-- Le code posé d'un coup (0002, gardé pour l'API) ne remplace plus un code actif : une session volée suffisait à
-- mettre le sien à la place et à fermer la porte au vrai titulaire. Changer de téléphone passe par la préparation, qui
-- prouve d'abord le code actuel.
create or replace function socle.poser_code(p_methode text, p_secret text, p_empreintes_secours text[]) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is null then raise exception 'personne n''est connecté' using errcode = '42501'; end if;
  if cardinality(p_empreintes_secours) <> 10 then raise exception 'il faut 10 codes de secours'; end if;
  if (select u.code_methode from socle.utilisateur u where u.id = socle.moi()) is not null then
    perform socle.refus('le code du téléphone est déjà activé : pour changer de téléphone, passe par Ton compte');
  end if;
  update socle.utilisateur set code_methode = p_methode, code_secret = p_secret where id = socle.moi();
  delete from socle.code_secours where utilisateur = socle.moi();
  insert into socle.code_secours (utilisateur, empreinte) select socle.moi(), e from unnest(p_empreintes_secours) e;
  update socle.session set code_a_configurer = false where utilisateur = socle.moi() and fermee_le is null;
end $$;

-- ── 2. Retirer le code ─────────────────────────────────────────────────────────────────────────────────────────────
-- Le serveur a vérifié le code (ou un code de secours) juste avant, dans la même transaction. Les codes de secours
-- tombent avec lui ; les appareils restent reconnus (ils l'ont été par ce code). Rend l'adresse où confirmer par e-mail.
create function socle.retirer_code() returns text
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_email text; v_methode text;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  if exists (select 1 from socle.membre m where m.utilisateur = socle.moi() and m.actif
              and m.roles && array['supervision', 'revision', 'saisie']::text[]) then
    perform socle.refus('le code du téléphone est exigé de chaque comptable d''un cabinet : il ne se retire pas');
  end if;
  select u.email, u.code_methode into v_email, v_methode from socle.utilisateur u where u.id = socle.moi();
  if v_methode is null then perform socle.refus('le code du téléphone n''est pas activé sur ce compte'); end if;
  update socle.utilisateur set code_methode = null, code_secret = null where id = socle.moi();
  delete from socle.code_secours where utilisateur = socle.moi();
  perform socle.tracer(null, 'compte.code.retirer', 'utilisateur', socle.moi(), jsonb_build_object('methode', v_methode), null);
  return v_email;
end $$;

-- ── 3. Les codes par e-mail ────────────────────────────────────────────────────────────────────────────────────────
-- L'adresse de cette personne est-elle prouvée ? (lu à la connexion, avant de savoir qui est « moi »)
create function socle.adresse_verifiee(p_utilisateur uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select coalesce((select u.adresse_verifiee_le is not null from socle.utilisateur u where u.id = p_utilisateur), false)
$$;

-- Le défi par e-mail réussi prouve l'adresse. Seul un défi par e-mail, déjà conclu (le code juste), la prouve.
create function socle.prouver_adresse(p_defi uuid, p_maintenant timestamptz) returns void
language sql volatile security definer set search_path = pg_catalog, socle as $$
  update socle.utilisateur u set adresse_verifiee_le = coalesce(u.adresse_verifiee_le, p_maintenant)
    from socle.defi_connexion d
   where d.id = p_defi and d.methode = 'courriel' and d.resolu_le is not null and u.id = d.utilisateur
$$;

-- Renvoyer le code d'un défi par e-mail : un nouveau code remplace l'ancien (qui ne vaut plus), au plus cinq envois par
-- défi, et pas deux en moins de 30 secondes. Les erreurs déjà faites restent comptées. Rend l'adresse où l'envoyer, et
-- si elle est déjà vérifiée (le texte de l'e-mail en dépend) ; rien si le défi est fini, ou si c'est trop tôt, ou trop
-- souvent.
create function socle.renvoyer_defi(p_defi uuid, p_empreinte text, p_maintenant timestamptz, p_duree interval)
returns table (a_email text, a_verifiee boolean)
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_utilisateur uuid;
begin
  update socle.defi_connexion d set code_empreinte = p_empreinte, envois = d.envois + 1, envoye_le = p_maintenant,
         expire_le = p_maintenant + p_duree
   where d.id = p_defi and d.methode = 'courriel' and d.resolu_le is null and d.expire_le > p_maintenant and d.erreurs < 5
     and d.envois < 5 and coalesce(d.envoye_le, d.cree_le) <= p_maintenant - interval '30 seconds'
  returning d.utilisateur into v_utilisateur;
  if v_utilisateur is null then return; end if;
  return query select u.email, u.adresse_verifiee_le is not null from socle.utilisateur u where u.id = v_utilisateur;
end $$;

-- « Ce n'est pas ton adresse ? La corriger » : une faute de frappe à l'inscription enfermait dehors (le code partait à
-- une adresse que personne ne lit, et la connexion le redemandait). Seulement pendant un défi par e-mail encore ouvert,
-- tant que l'adresse n'a jamais été prouvée ; le nouveau code part à la nouvelle adresse (un envoi de plus, cinq au
-- plus) et l'ancien ne vaut plus. Une adresse déjà celle d'un autre compte se refuse, comme à l'inscription.
create function socle.corriger_adresse_du_defi(p_defi uuid, p_adresse text, p_empreinte text, p_maintenant timestamptz, p_duree interval)
returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_utilisateur uuid;
begin
  select d.utilisateur into v_utilisateur from socle.defi_connexion d join socle.utilisateur u on u.id = d.utilisateur
   where d.id = p_defi and d.methode = 'courriel' and d.resolu_le is null and d.expire_le > p_maintenant and d.erreurs < 5
     and d.envois < 5 and u.adresse_verifiee_le is null
   for update of d;
  if v_utilisateur is null then return false; end if;
  if exists (select 1 from socle.utilisateur u where lower(u.email) = lower(trim(p_adresse)) and u.id <> v_utilisateur) then
    perform socle.refus('cette adresse est déjà celle d''un autre compte');
  end if;
  update socle.utilisateur set email = lower(trim(p_adresse)) where id = v_utilisateur;
  update socle.defi_connexion set code_empreinte = p_empreinte, envois = envois + 1, envoye_le = p_maintenant, expire_le = p_maintenant + p_duree
   where id = p_defi;
  return true;
end $$;

-- ── 4. Changer d'adresse ───────────────────────────────────────────────────────────────────────────────────────────
-- Le serveur a vérifié le mot de passe. Avec un relais d'e-mails, la nouvelle adresse reçoit un code et ne remplace
-- l'ancienne qu'une fois ce code tapé (elle est alors prouvée) ; l'ancienne est prévenue. Sans relais, on ne sait rien
-- envoyer : l'adresse change tout de suite et reste à vérifier (une faute de frappe à l'inscription se corrige ainsi).
create table socle.changement_adresse (
  id uuid primary key default socle.uuidv7(),
  utilisateur uuid not null references socle.utilisateur(id),
  nouvelle text not null,
  code_empreinte text not null,
  cree_le timestamptz not null,
  expire_le timestamptz not null,
  erreurs int not null default 0,
  fait_le timestamptz
);
create index on socle.changement_adresse (utilisateur, cree_le);
alter table socle.changement_adresse enable row level security;
alter table socle.changement_adresse force row level security;

-- Une adresse déjà celle d'un autre compte se refuse (elle ne se partage pas).
create function socle.adresse_libre(p_adresse text) returns void
language plpgsql stable security definer set search_path = pg_catalog, socle as $$
begin
  if exists (select 1 from socle.utilisateur u where lower(u.email) = lower(trim(p_adresse)) and u.id <> socle.moi()) then
    perform socle.refus('cette adresse est déjà celle d''un autre compte');
  end if;
end $$;

create function socle.demander_changement_adresse(p_nouvelle text, p_empreinte text, p_maintenant timestamptz, p_duree interval) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v uuid;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  perform socle.adresse_libre(p_nouvelle);
  if (select count(*) from socle.changement_adresse c where c.utilisateur = socle.moi() and c.cree_le > p_maintenant - interval '1 hour') >= 3 then
    perform socle.refus('trois demandes en une heure : attends un peu avant d''en refaire une');
  end if;
  insert into socle.changement_adresse (utilisateur, nouvelle, code_empreinte, cree_le, expire_le)
  values (socle.moi(), lower(trim(p_nouvelle)), p_empreinte, p_maintenant, p_maintenant + p_duree) returning id into v;
  return v;
end $$;

-- Le code tapé : rend l'ancienne adresse (à prévenir), ou rien si le code ne va pas (une erreur de plus comptée ; à la
-- cinquième, la demande ne vaut plus).
create function socle.confirmer_changement_adresse(p_demande uuid, p_empreinte text, p_maintenant timestamptz) returns text
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare c record; v_ancienne text;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  select * into c from socle.changement_adresse d
   where d.id = p_demande and d.utilisateur = socle.moi() and d.fait_le is null and d.expire_le > p_maintenant and d.erreurs < 5;
  if not found then perform socle.refus('cette demande n''est plus valable : recommence le changement d''adresse'); end if;
  if c.code_empreinte <> p_empreinte then
    update socle.changement_adresse set erreurs = erreurs + 1 where id = p_demande;
    return null;
  end if;
  perform socle.adresse_libre(c.nouvelle);
  select u.email into v_ancienne from socle.utilisateur u where u.id = socle.moi();
  update socle.changement_adresse set fait_le = p_maintenant where id = p_demande;
  update socle.utilisateur set email = c.nouvelle, adresse_verifiee_le = p_maintenant where id = socle.moi();
  perform socle.tracer(null, 'compte.adresse.changer', 'utilisateur', socle.moi(), jsonb_build_object('email', v_ancienne), jsonb_build_object('email', c.nouvelle));
  return v_ancienne;
end $$;

create function socle.changer_adresse_sans_code(p_nouvelle text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_ancienne text;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  perform socle.adresse_libre(p_nouvelle);
  select u.email into v_ancienne from socle.utilisateur u where u.id = socle.moi();
  update socle.utilisateur set email = lower(trim(p_nouvelle)), adresse_verifiee_le = null where id = socle.moi();
  perform socle.tracer(null, 'compte.adresse.changer', 'utilisateur', socle.moi(), jsonb_build_object('email', v_ancienne), jsonb_build_object('email', lower(trim(p_nouvelle))));
end $$;

revoke execute on function socle.preparer_code(text, text[], timestamptz), socle.mon_secret_en_attente(timestamptz), socle.activer_code_en_attente(timestamptz) from public;
grant execute on function socle.preparer_code(text, text[], timestamptz), socle.mon_secret_en_attente(timestamptz), socle.activer_code_en_attente(timestamptz) to skanfact_app;
revoke execute on function socle.mon_compte(), socle.nouveaux_codes_secours(text[]), socle.changer_mot_de_passe(text, uuid, timestamptz),
  socle.retirer_code(), socle.adresse_verifiee(uuid), socle.prouver_adresse(uuid, timestamptz),
  socle.renvoyer_defi(uuid, text, timestamptz, interval), socle.corriger_adresse_du_defi(uuid, text, text, timestamptz, interval), socle.adresse_libre(text),
  socle.demander_changement_adresse(text, text, timestamptz, interval), socle.confirmer_changement_adresse(uuid, text, timestamptz),
  socle.changer_adresse_sans_code(text) from public;
grant execute on function socle.mon_compte(), socle.nouveaux_codes_secours(text[]), socle.changer_mot_de_passe(text, uuid, timestamptz),
  socle.retirer_code(), socle.adresse_verifiee(uuid), socle.prouver_adresse(uuid, timestamptz),
  socle.renvoyer_defi(uuid, text, timestamptz, interval), socle.corriger_adresse_du_defi(uuid, text, text, timestamptz, interval), socle.adresse_libre(text),
  socle.demander_changement_adresse(text, text, timestamptz, interval), socle.confirmer_changement_adresse(uuid, text, timestamptz),
  socle.changer_adresse_sans_code(text) to skanfact_app;
