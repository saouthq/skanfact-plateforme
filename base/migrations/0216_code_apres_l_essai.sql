-- Le code du téléphone ne barre plus l'essai d'un cabinet (décision du 16/11/2026, 1.373.0).
--
-- Depuis 0076, tout comptable d'un cabinet devait installer une application d'authentification AVANT de voir le
-- premier écran du Cabinet : un comptable venu essayer s'arrêtait là, sans avoir rien vu. Or ce que le code protège,
-- ce sont les comptes et les salaires des CLIENTS du cabinet. Tant que le cabinet n'a aucun vrai dossier (rien, ou
-- seulement son dossier d'exemple, 0214), il n'y a rien à protéger : le code reste proposé, jamais exigé.
-- Dès le premier vrai dossier (tenu par le cabinet, ou confié par un client), il redevient obligatoire pour chaque
-- comptable du cabinet, à la requête suivante — la règle de 0076, déplacée au moment où elle protège quelque chose.

-- Et le premier vrai dossier ne ferme pas la porte au milieu du travail : le code devient obligatoire SEPT JOURS après
-- lui (le temps d'installer l'application d'authentification à tête reposée ; le Cabinet le rappelle d'ici là).
-- Passé ce délai, la règle de 0076 s'applique à chaque comptable du cabinet, à la requête suivante.

-- Depuis quand un cabinet a un vrai dossier (tenu par lui, ou confié par un client) ; rien s'il n'en a pas. L'exemple ne
-- compte pas ; un mandat seulement proposé non plus.
create function socle.premier_vrai_dossier(p_cabinet uuid) returns timestamptz
language sql stable security definer set search_path = pg_catalog, socle as $$
  select least(
    (select min(d.cree_le) from socle.mandat d join socle.entreprise e on e.id = d.entreprise
      where d.cabinet = p_cabinet and d.statut = 'actif' and e.active and not e.exemple),
    (select min(e.cree_le) from socle.entreprise e where e.tenue_par = p_cabinet and e.active and not e.exemple))
$$;
revoke execute on function socle.premier_vrai_dossier(uuid) from public;

-- Quand le code devient exigé d'une personne : sept jours après le premier vrai dossier de son cabinet (le plus tôt, si
-- elle est de plusieurs) ; rien si elle n'est d'aucun cabinet, ou si aucun n'a de vrai dossier. Un rôle de cabinet posé
-- hors d'un cabinet (cas qui ne devrait pas exister) garde la règle stricte : tout de suite.
create function socle.code_exige_le_de(p_utilisateur uuid) returns timestamptz
language sql stable security definer set search_path = pg_catalog, socle as $$
  select min(case when m.organisation is null then m.depuis else socle.premier_vrai_dossier(m.organisation) + interval '7 days' end)
    from socle.membre m
   where m.utilisateur = p_utilisateur and m.actif and m.roles && array['supervision', 'revision', 'saisie']::text[]
$$;
revoke execute on function socle.code_exige_le_de(uuid) from public;

create function socle.code_exige_de(p_utilisateur uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select coalesce(socle.code_exige_le_de(p_utilisateur) <= now(), false)
$$;
revoke execute on function socle.code_exige_de(uuid) from public;

create or replace function socle.pour_connexion(p_email text)
returns table (utilisateur uuid, empreinte text, code_methode text, code_secret text, telephone text, code_obligatoire boolean)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select u.id, u.empreinte_mot_de_passe, u.code_methode, u.code_secret, u.telephone, socle.code_exige_de(u.id)
    from socle.utilisateur u where lower(u.email) = lower(trim(p_email))
$$;

create or replace function socle.code_manquant() returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select coalesce((select u.code_methode is null from socle.utilisateur u where u.id = socle.moi()), false)
     and socle.code_exige_de(socle.moi())
$$;

-- Ton compte dit en plus QUAND le code deviendra exigé (le Cabinet le rappelle pendant les sept jours).
drop function socle.mon_compte();
create function socle.mon_compte() returns table (code_exige boolean, adresse_verifiee boolean, codes_secours int, code_exige_le timestamptz)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select socle.code_exige_de(u.id),
         u.adresse_verifiee_le is not null,
         (select count(*)::int from socle.code_secours c where c.utilisateur = u.id and c.utilise_le is null),
         socle.code_exige_le_de(u.id)
    from socle.utilisateur u where u.id = socle.moi()
$$;
revoke execute on function socle.mon_compte() from public;
grant execute on function socle.mon_compte() to skanfact_app;

-- Retirer le code : refusé à qui il est exigé — la même règle, lue au même endroit.
create or replace function socle.retirer_code(p_courriel boolean) returns text
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_email text; v_methode text;
begin
  if socle.moi() is null then perform socle.refus('personne n''est connecté'); end if;
  if not p_courriel and socle.code_exige_de(socle.moi()) then
    perform socle.refus('le code du téléphone est exigé de chaque comptable d''un cabinet : il ne se retire pas');
  end if;
  select u.email, u.code_methode into v_email, v_methode from socle.utilisateur u where u.id = socle.moi();
  if v_methode is null then perform socle.refus('le code du téléphone n''est pas activé sur ce compte'); end if;
  update socle.utilisateur set code_methode = null, code_secret = null, code_sms_preuve = null, code_sms_preuve_le = null where id = socle.moi();
  delete from socle.code_secours where utilisateur = socle.moi();
  perform socle.tracer(null, 'compte.code.retirer', 'utilisateur', socle.moi(), jsonb_build_object('methode', v_methode), null);
  return v_email;
end $$;
