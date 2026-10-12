-- Le code de connexion au choix (décision de Skander du 12/10/2026 ; skanfact docs/cadrage/03-droits.md § 6 ;
-- docs/entree.md) : l'e-mail par défaut, le SMS (WinSMS), ou une application d'authentification.
--
-- 1. Le SMS a un coût : chaque SMS envoyé se compte, par personne. Au plus 5 par heure et 20 par jour (À VÉRIFIER sur
--    l'usage des pilotes) ; au-delà, rien ne part, et l'écran propose un code de secours.
-- 2. Le numéro ne change plus par une simple mise à jour : seule une activation prouvée (un code reçu à ce numéro, puis
--    tapé) le pose. Une session volée ne détourne donc pas les codes vers un autre téléphone.
-- 3. Le SMS s'active en deux temps, comme l'application (0076 § 1 bis) : préparé (le numéro et le code en attente, 15
--    minutes, cinq essais), puis activé par le code reçu. Une activation abandonnée ne change rien.
-- 4. Prouver le code actuel quand on a le SMS (retirer le code, de nouveaux codes de secours, changer de numéro) : un
--    code de preuve part au numéro du compte, valable 10 minutes, une fois.
-- 5. Un comptable de cabinet revient à l'e-mail quand ce serveur en envoie (le code par e-mail vaut alors son code) ;
--    sans relais d'e-mails, son code ne se retire toujours pas.
-- 6. Le mot de passe oublié d'un compte au SMS : le code part au numéro du compte, sur demande, depuis la page du lien.

-- ── 1. Les SMS envoyés, comptés ────────────────────────────────────────────────────────────────────────────────────
create table socle.sms_envoye (
  id uuid primary key default socle.uuidv7(),
  utilisateur uuid not null references socle.utilisateur(id),
  raison text not null check (raison in ('connexion', 'activation', 'preuve', 'reinitialisation')),
  le timestamptz not null
);
create index on socle.sms_envoye (utilisateur, le);
alter table socle.sms_envoye enable row level security;
alter table socle.sms_envoye force row level security;

-- Peut-on encore envoyer un SMS à cette personne ?
create function socle.sms_permis(p_utilisateur uuid, p_maintenant timestamptz) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select (select count(*) from socle.sms_envoye s where s.utilisateur = p_utilisateur and s.le > p_maintenant - interval '1 hour') < 5
     and (select count(*) from socle.sms_envoye s where s.utilisateur = p_utilisateur and s.le > p_maintenant - interval '1 day') < 20
$$;

-- Compter un SMS qui va partir : faux (et rien n'est compté) quand la limite est atteinte.
create function socle.compter_sms(p_utilisateur uuid, p_raison text, p_maintenant timestamptz) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if not socle.sms_permis(p_utilisateur, p_maintenant) then return false; end if;
  insert into socle.sms_envoye (utilisateur, raison, le) values (p_utilisateur, p_raison, p_maintenant);
  return true;
end $$;

-- ── 2. Le numéro ne se change qu'en le prouvant ────────────────────────────────────────────────────────────────────
revoke update (telephone) on socle.utilisateur from skanfact_app;

-- Le code posé d'un coup (0002, 0076 ; gardé pour l'API) ne pose plus le SMS sans numéro prouvé : la connexion
-- enverrait le code nulle part.
create or replace function socle.poser_code(p_methode text, p_secret text, p_empreintes_secours text[]) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is null then raise exception 'personne n''est connecté' using errcode = '42501'; end if;
  if cardinality(p_empreintes_secours) <> 10 then raise exception 'il faut 10 codes de secours'; end if;
  if (select u.code_methode from socle.utilisateur u where u.id = socle.moi()) is not null then
    perform socle.refus('le code du téléphone est déjà activé : pour changer de téléphone, passe par Ton compte');
  end if;
  if p_methode = 'sms' and (select u.telephone from socle.utilisateur u where u.id = socle.moi()) is null then
    perform socle.refus('le code par SMS s''active depuis Ton compte : un code part d''abord à ton numéro');
  end if;
  update socle.utilisateur set code_methode = p_methode, code_secret = p_secret where id = socle.moi();
  delete from socle.code_secours where utilisateur = socle.moi();
  insert into socle.code_secours (utilisateur, empreinte) select socle.moi(), e from unnest(p_empreintes_secours) e;
  update socle.session set code_a_configurer = false where utilisateur = socle.moi() and fermee_le is null;
end $$;

-- ── 3. Activer le SMS en deux temps ────────────────────────────────────────────────────────────────────────────────
alter table socle.utilisateur
  add column telephone_attente text, add column code_sms_attente text, add column code_sms_attente_le timestamptz,
  add column code_sms_attente_erreurs int not null default 0,
  add column code_sms_preuve text, add column code_sms_preuve_le timestamptz;

-- Le numéro (déjà lu et écrit « +216XXXXXXXX » par le serveur) et l'empreinte du code qui va y partir. Rend « ok », ou
-- « limite » (trop de SMS envoyés : rien n'est préparé). Le serveur a vérifié le code actuel juste avant, s'il y en a un.
create function socle.preparer_sms(p_telephone text, p_code text, p_maintenant timestamptz) returns text
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  if p_telephone !~ '^\+216[0-9]{8}$' then raise exception 'le numéro s''écrit +216 suivi de huit chiffres'; end if;
  if not socle.compter_sms(socle.moi(), 'activation', p_maintenant) then return 'limite'; end if;
  update socle.utilisateur set telephone_attente = p_telephone, code_sms_attente = p_code, code_sms_attente_le = p_maintenant,
         code_sms_attente_erreurs = 0
   where id = socle.moi();
  return 'ok';
end $$;

-- Le code reçu, tapé : le SMS devient le code du compte (le numéro est prouvé), avec ses codes de secours. Rend « ok »,
-- « faux » (une erreur de plus ; à la cinquième, la préparation ne vaut plus) ou « perime » (plus de 15 minutes, ou
-- cinq erreurs, ou rien de préparé).
create function socle.activer_sms_en_attente(p_code text, p_empreintes_secours text[], p_maintenant timestamptz) returns text
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare u record; v_avant text;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  if cardinality(p_empreintes_secours) <> 10 then raise exception 'il faut 10 codes de secours'; end if;
  select x.telephone_attente, x.code_sms_attente, x.code_sms_attente_le, x.code_sms_attente_erreurs, x.code_methode into u
    from socle.utilisateur x where x.id = socle.moi() for update;
  if u.telephone_attente is null or u.code_sms_attente_le <= p_maintenant - interval '15 minutes' or u.code_sms_attente_erreurs >= 5 then
    return 'perime';
  end if;
  if u.code_sms_attente <> p_code then
    update socle.utilisateur set code_sms_attente_erreurs = code_sms_attente_erreurs + 1 where id = socle.moi();
    return 'faux';
  end if;
  v_avant := u.code_methode;
  update socle.utilisateur set code_methode = 'sms', code_secret = null, telephone = u.telephone_attente, telephone_verifie_le = p_maintenant,
         telephone_attente = null, code_sms_attente = null, code_sms_attente_le = null, code_sms_attente_erreurs = 0,
         code_secret_attente = null, code_secours_attente = null, code_attente_le = null
   where id = socle.moi();
  delete from socle.code_secours where utilisateur = socle.moi();
  insert into socle.code_secours (utilisateur, empreinte) select socle.moi(), e from unnest(p_empreintes_secours) e;
  update socle.session set code_a_configurer = false where utilisateur = socle.moi() and fermee_le is null;
  perform socle.tracer(null, 'compte.code.activer', 'utilisateur', socle.moi(),
    case when v_avant is null then null else jsonb_build_object('methode', v_avant) end, jsonb_build_object('methode', 'sms'));
  return 'ok';
end $$;

-- L'application qu'on active remplace un SMS : le numéro d'attente d'une activation SMS abandonnée tombe aussi.
create or replace function socle.activer_code_en_attente(p_maintenant timestamptz) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_secret text; v_secours text[];
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  select u.code_secret_attente, u.code_secours_attente into v_secret, v_secours from socle.utilisateur u
   where u.id = socle.moi() and u.code_attente_le > p_maintenant - interval '1 hour';
  if v_secret is null then return false; end if;
  update socle.utilisateur set code_methode = 'application', code_secret = v_secret,
         code_secret_attente = null, code_secours_attente = null, code_attente_le = null,
         telephone_attente = null, code_sms_attente = null, code_sms_attente_le = null, code_sms_attente_erreurs = 0
   where id = socle.moi();
  delete from socle.code_secours where utilisateur = socle.moi();
  insert into socle.code_secours (utilisateur, empreinte) select socle.moi(), e from unnest(v_secours) e;
  update socle.session set code_a_configurer = false where utilisateur = socle.moi() and fermee_le is null;
  perform socle.tracer(null, 'compte.code.activer', 'utilisateur', socle.moi(), null, jsonb_build_object('methode', 'application'));
  return true;
end $$;

-- ── 4. La preuve par SMS du code actuel ────────────────────────────────────────────────────────────────────────────
-- Rend le numéro où le code part, ou rien (trop de SMS envoyés). Seulement pour qui a le SMS.
create function socle.poser_preuve_sms(p_code text, p_maintenant timestamptz) returns text
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_tel text;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  select u.telephone into v_tel from socle.utilisateur u where u.id = socle.moi() and u.code_methode = 'sms';
  if v_tel is null then perform socle.refus('le code par SMS n''est pas celui de ce compte'); end if;
  if not socle.compter_sms(socle.moi(), 'preuve', p_maintenant) then return null; end if;
  update socle.utilisateur set code_sms_preuve = p_code, code_sms_preuve_le = p_maintenant where id = socle.moi();
  return v_tel;
end $$;

-- Le code de preuve tapé : juste, il ne sert plus (une fois) ; faux, rien ne change (l'erreur se compte comme à la
-- connexion, par le serveur).
create function socle.consommer_preuve_sms(p_code text, p_maintenant timestamptz) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is null then return false; end if;
  update socle.utilisateur set code_sms_preuve = null, code_sms_preuve_le = null
   where id = socle.moi() and code_methode = 'sms' and code_sms_preuve = p_code and code_sms_preuve_le > p_maintenant - interval '10 minutes';
  return found;
end $$;

-- ── 5. Retirer le code ─────────────────────────────────────────────────────────────────────────────────────────────
-- `p_courriel` : ce serveur envoie des e-mails, et le code par e-mail tient lieu de code (un comptable y revient). Le
-- numéro prouvé reste au compte (il resservira si le SMS est réactivé : un code y repartira d'abord).
drop function socle.retirer_code();
create function socle.retirer_code(p_courriel boolean) returns text
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_email text; v_methode text;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  if not p_courriel and exists (select 1 from socle.membre m where m.utilisateur = socle.moi() and m.actif
              and m.roles && array['supervision', 'revision', 'saisie']::text[]) then
    perform socle.refus('le code du téléphone est exigé de chaque comptable d''un cabinet : il ne se retire pas');
  end if;
  select u.email, u.code_methode into v_email, v_methode from socle.utilisateur u where u.id = socle.moi();
  if v_methode is null then perform socle.refus('le code du téléphone n''est pas activé sur ce compte'); end if;
  update socle.utilisateur set code_methode = null, code_secret = null, code_sms_preuve = null, code_sms_preuve_le = null where id = socle.moi();
  delete from socle.code_secours where utilisateur = socle.moi();
  perform socle.tracer(null, 'compte.code.retirer', 'utilisateur', socle.moi(), jsonb_build_object('methode', v_methode), null);
  return v_email;
end $$;

-- ── 6. Renvoyer un code de connexion, par e-mail ou par SMS ────────────────────────────────────────────────────────
-- Comme en 0076 (cinq envois par défi, pas deux en moins de 30 secondes), et un SMS se compte. Rend l'adresse, si elle
-- est vérifiée, la méthode et le numéro ; rien si le défi est fini, trop tôt, trop souvent, ou si trop de SMS sont
-- partis.
drop function socle.renvoyer_defi(uuid, text, timestamptz, interval);
create function socle.renvoyer_defi(p_defi uuid, p_empreinte text, p_maintenant timestamptz, p_duree interval)
returns table (a_email text, a_verifiee boolean, a_methode text, a_telephone text)
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_utilisateur uuid; v_methode text;
begin
  update socle.defi_connexion d set code_empreinte = p_empreinte, envois = d.envois + 1, envoye_le = p_maintenant,
         expire_le = p_maintenant + p_duree
   where d.id = p_defi and d.methode in ('courriel', 'sms') and d.resolu_le is null and d.expire_le > p_maintenant and d.erreurs < 5
     and d.envois < 5 and coalesce(d.envoye_le, d.cree_le) <= p_maintenant - interval '30 seconds'
     and (d.methode = 'courriel' or socle.sms_permis(d.utilisateur, p_maintenant))
  returning d.utilisateur, d.methode into v_utilisateur, v_methode;
  if v_utilisateur is null then return; end if;
  if v_methode = 'sms' then perform socle.compter_sms(v_utilisateur, 'connexion', p_maintenant); end if;
  return query select u.email, u.adresse_verifiee_le is not null, v_methode, u.telephone from socle.utilisateur u where u.id = v_utilisateur;
end $$;

-- ── 7. Le mot de passe oublié d'un compte au SMS ───────────────────────────────────────────────────────────────────
alter table socle.reinitialisation add column code_sms text, add column sms_envois int not null default 0, add column sms_le timestamptz;

-- Le code part au numéro du compte (au plus cinq fois par lien, pas deux en moins de 30 secondes, et dans la limite des
-- SMS) : rend le numéro, ou rien.
create function socle.reinitialisation_sms(p_empreinte text, p_code text, p_maintenant timestamptz) returns text
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_tel text; v_utilisateur uuid;
begin
  update socle.reinitialisation r set code_sms = p_code, sms_envois = r.sms_envois + 1, sms_le = p_maintenant
    from socle.utilisateur u
   where r.jeton_empreinte = p_empreinte and r.utilise_le is null and r.expire_le > p_maintenant and r.erreurs < 5
     and u.id = r.utilisateur and u.code_methode = 'sms' and u.telephone is not null
     and r.sms_envois < 5 and coalesce(r.sms_le, '-infinity'::timestamptz) <= p_maintenant - interval '30 seconds'
     and socle.sms_permis(u.id, p_maintenant)
  returning u.telephone, u.id into v_tel, v_utilisateur;
  if v_tel is null then return null; end if;
  perform socle.compter_sms(v_utilisateur, 'reinitialisation', p_maintenant);
  return v_tel;
end $$;

drop function socle.lire_reinitialisation(text, timestamptz);
create function socle.lire_reinitialisation(p_empreinte text, p_maintenant timestamptz)
returns table (utilisateur uuid, email text, code_methode text, code_secret text, code_sms text, telephone text)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select u.id, u.email, u.code_methode, u.code_secret, r.code_sms, u.telephone
    from socle.reinitialisation r join socle.utilisateur u on u.id = r.utilisateur
   where r.jeton_empreinte = p_empreinte and r.utilise_le is null and r.expire_le > p_maintenant and r.erreurs < 5
$$;

revoke execute on function socle.sms_permis(uuid, timestamptz), socle.compter_sms(uuid, text, timestamptz),
  socle.preparer_sms(text, text, timestamptz), socle.activer_sms_en_attente(text, text[], timestamptz),
  socle.poser_preuve_sms(text, timestamptz), socle.consommer_preuve_sms(text, timestamptz), socle.retirer_code(boolean),
  socle.renvoyer_defi(uuid, text, timestamptz, interval), socle.reinitialisation_sms(text, text, timestamptz),
  socle.lire_reinitialisation(text, timestamptz) from public;
grant execute on function socle.sms_permis(uuid, timestamptz), socle.compter_sms(uuid, text, timestamptz),
  socle.preparer_sms(text, text, timestamptz), socle.activer_sms_en_attente(text, text[], timestamptz),
  socle.poser_preuve_sms(text, timestamptz), socle.consommer_preuve_sms(text, timestamptz), socle.retirer_code(boolean),
  socle.renvoyer_defi(uuid, text, timestamptz, interval), socle.reinitialisation_sms(text, text, timestamptz),
  socle.lire_reinitialisation(text, timestamptz) to skanfact_app;
