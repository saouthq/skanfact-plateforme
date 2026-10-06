-- Le mot de passe oublié (lot entrée, 06/10/2026 ; docs/entree.md). La personne donne son adresse ; si un compte y
-- répond, un lien à usage unique part par e-mail, valable 30 minutes. Le lien ne suffit jamais seul pour un compte qui
-- a le code du téléphone : il faut aussi ce code (ou un code de secours). Le jeton n'est gardé qu'en empreinte, comme
-- celui d'une session. Choisir un nouveau mot de passe ferme toutes les sessions ouvertes du compte.
--
-- Ces gestes se font AVANT de savoir qui est « moi » : ils passent par des fonctions étroites, comme la connexion
-- (0002). La table ne se lit jamais directement.
create table socle.reinitialisation (
  id uuid primary key default socle.uuidv7(),
  utilisateur uuid not null references socle.utilisateur(id),
  jeton_empreinte text not null unique,
  cree_le timestamptz not null,
  expire_le timestamptz not null,
  -- Les codes du téléphone refusés avec ce lien : au cinquième, le lien ne vaut plus rien.
  erreurs int not null default 0,
  utilise_le timestamptz
);
create index on socle.reinitialisation (utilisateur, cree_le);
alter table socle.reinitialisation enable row level security;
alter table socle.reinitialisation force row level security;

-- Une demande : rend l'adresse (et la langue) à qui écrire si un compte y répond, et au plus trois demandes par heure
-- pour un même compte (au-delà, rien ne part : personne ne remplit la boîte d'un autre). Rien sinon : le serveur
-- répond la même chose dans tous les cas, pour ne jamais dire si une adresse a un compte.
create function socle.demander_reinitialisation(p_email text, p_empreinte text, p_maintenant timestamptz, p_duree interval)
returns table (a_email text, a_langue text)
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_id uuid; v_email text; v_langue text;
begin
  select u.id, u.email, u.langue into v_id, v_email, v_langue from socle.utilisateur u where lower(u.email) = lower(trim(p_email));
  if v_id is null then return; end if;
  if (select count(*) from socle.reinitialisation r where r.utilisateur = v_id and r.cree_le > p_maintenant - interval '1 hour') >= 3 then return; end if;
  insert into socle.reinitialisation (utilisateur, jeton_empreinte, cree_le, expire_le) values (v_id, p_empreinte, p_maintenant, p_maintenant + p_duree);
  return query select v_email, v_langue;
end $$;

-- Un lien encore valable : à qui il est, et ce qu'il faut en plus (le code du téléphone, s'il y en a un).
create function socle.lire_reinitialisation(p_empreinte text, p_maintenant timestamptz)
returns table (utilisateur uuid, email text, code_methode text, code_secret text)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select u.id, u.email, u.code_methode, u.code_secret
    from socle.reinitialisation r join socle.utilisateur u on u.id = r.utilisateur
   where r.jeton_empreinte = p_empreinte and r.utilise_le is null and r.expire_le > p_maintenant and r.erreurs < 5
$$;

create function socle.reinitialisation_erreur(p_empreinte text) returns void
language sql volatile security definer set search_path = pg_catalog, socle as $$
  update socle.reinitialisation set erreurs = erreurs + 1 where jeton_empreinte = p_empreinte
$$;

-- Le nouveau mot de passe (son empreinte, calculée par le serveur) : le lien sert une fois, les autres liens du compte
-- tombent avec lui, et toutes les sessions ouvertes se ferment (celui qui avait volé l'ancien mot de passe est dehors).
create function socle.conclure_reinitialisation(p_empreinte text, p_mot_de_passe text, p_maintenant timestamptz) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_utilisateur uuid;
begin
  update socle.reinitialisation r set utilise_le = p_maintenant
   where r.jeton_empreinte = p_empreinte and r.utilise_le is null and r.expire_le > p_maintenant and r.erreurs < 5
  returning r.utilisateur into v_utilisateur;
  if v_utilisateur is null then return false; end if;
  update socle.utilisateur set empreinte_mot_de_passe = p_mot_de_passe where id = v_utilisateur;
  update socle.reinitialisation set utilise_le = p_maintenant where utilisateur = v_utilisateur and utilise_le is null;
  update socle.session set fermee_le = p_maintenant where utilisateur = v_utilisateur and fermee_le is null;
  return true;
end $$;

revoke execute on function socle.demander_reinitialisation(text, text, timestamptz, interval), socle.lire_reinitialisation(text, timestamptz),
  socle.reinitialisation_erreur(text), socle.conclure_reinitialisation(text, text, timestamptz) from public;
grant execute on function socle.demander_reinitialisation(text, text, timestamptz, interval), socle.lire_reinitialisation(text, timestamptz),
  socle.reinitialisation_erreur(text), socle.conclure_reinitialisation(text, text, timestamptz) to skanfact_app;
