-- Les clés d'accès (passkeys ; 1.390.0, tâche 107 ; décision de Skander du 17/11/2026, 1.379.3 : « le lot suivant »).
--
-- Une clé d'accès est une paire de clés que l'appareil de la personne garde (son téléphone, son ordinateur, son
-- gestionnaire de mots de passe). SkanFact n'en garde que la moitié PUBLIQUE : elle ne sert qu'à vérifier une
-- signature, et la lire ne donne rien. Se connecter avec une clé remplace le mot de passe ET le code : l'appareil a
-- demandé l'empreinte, le visage ou son propre code, et la signature ne vaut que pour l'adresse de SkanFact.
--
-- Les deux tables ne se lisent que par les fonctions ci-dessous ; chacun ne voit que ses propres clés.

create table socle.cle_acces (
  id uuid primary key default socle.uuidv7(),
  utilisateur uuid not null references socle.utilisateur(id) on delete cascade,
  -- L'identifiant que l'appareil a donné à la clé (base64url) : c'est par lui qu'une connexion la retrouve.
  identifiant text not null unique check (length(identifiant) between 16 and 1400),
  -- La clé publique (SPKI, base64url) et son algorithme COSE : -7 (ES256), -8 (Ed25519), -257 (RS256).
  cle_publique text not null check (length(cle_publique) <= 2000),
  algorithme int not null check (algorithme in (-7, -8, -257)),
  -- Le compteur de signatures de l'appareil (0 s'il n'en tient pas) : il ne recule jamais.
  compteur bigint not null default 0 check (compteur >= 0),
  nom text not null check (length(nom) between 1 and 80),
  creee_le timestamptz not null,
  utilisee_le timestamptz,
  retiree_le timestamptz
);
create index cle_acces_utilisateur on socle.cle_acces (utilisateur);

-- Le défi d'une création ou d'une connexion : tiré par le serveur, signé par l'appareil, valable une fois et peu de temps.
create table socle.defi_cle (
  id uuid primary key default socle.uuidv7(),
  -- La personne qui crée une clé ; vide pour une connexion (on ne sait pas encore qui c'est).
  utilisateur uuid references socle.utilisateur(id) on delete cascade,
  but text not null check (but in ('creation', 'connexion')),
  defi text not null check (length(defi) between 16 and 100),
  cree_le timestamptz not null,
  expire_le timestamptz not null,
  utilise_le timestamptz
);
create index defi_cle_expire on socle.defi_cle (expire_le);

alter table socle.cle_acces enable row level security;
alter table socle.cle_acces force row level security;
create policy visible on socle.cle_acces using (utilisateur = socle.moi());
alter table socle.defi_cle enable row level security;
alter table socle.defi_cle force row level security;

-- Tirer un défi. Une création se fait connecté ; une connexion, non. Les défis passés s'effacent au passage, et une
-- connexion ne peut pas en ouvrir sans fin : au-delà de 5 000 encore valables, on refuse (l'entrée reste ouverte par
-- le mot de passe).
create function socle.ouvrir_defi_cle(p_but text, p_defi text, p_maintenant timestamptz, p_duree interval) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_id uuid;
begin
  if p_but = 'creation' and socle.moi() is null then raise exception 'personne n''est connecté' using errcode = '42501'; end if;
  delete from socle.defi_cle where expire_le < p_maintenant - interval '1 hour';
  if p_but = 'connexion' and (select count(*) from socle.defi_cle d where d.but = 'connexion' and d.utilise_le is null and d.expire_le > p_maintenant) >= 5000 then
    return null;
  end if;
  insert into socle.defi_cle (utilisateur, but, defi, cree_le, expire_le)
  values (case when p_but = 'creation' then socle.moi() end, p_but, p_defi, p_maintenant, p_maintenant + p_duree)
  returning id into v_id;
  return v_id;
end $$;

-- Prendre un défi : il ne sert qu'une fois, avant son expiration, et celui d'une création seulement à qui l'a tiré.
create function socle.prendre_defi_cle(p_id uuid, p_but text, p_maintenant timestamptz) returns text
language sql volatile security definer set search_path = pg_catalog, socle as $$
  update socle.defi_cle d set utilise_le = p_maintenant
   where d.id = p_id and d.but = p_but and d.utilise_le is null and d.expire_le > p_maintenant
     and (p_but = 'connexion' or d.utilisateur = socle.moi())
  returning d.defi
$$;

-- Ajouter une clé à son compte (vingt au plus : un téléphone, un ordinateur, un gestionnaire… on n'en a pas cent).
create function socle.ajouter_cle_acces(p_identifiant text, p_cle text, p_algorithme int, p_compteur bigint, p_nom text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_id uuid;
begin
  if socle.moi() is null then raise exception 'personne n''est connecté' using errcode = '42501'; end if;
  if (select count(*) from socle.cle_acces c where c.utilisateur = socle.moi() and c.retiree_le is null) >= 20 then
    perform socle.refus('vingt clés d''accès au plus : retire celle d''un appareil que tu n''utilises plus');
  end if;
  insert into socle.cle_acces (utilisateur, identifiant, cle_publique, algorithme, compteur, nom, creee_le)
  values (socle.moi(), p_identifiant, p_cle, p_algorithme, p_compteur, left(trim(p_nom), 80), p_maintenant)
  returning id into v_id;
  return v_id;
end $$;

-- Ce qu'il faut pour vérifier une connexion par une clé : la personne, la clé publique, son algorithme, son compteur.
-- Une clé retirée ne connecte plus personne.
create function socle.cle_pour_connexion(p_identifiant text)
returns table (id uuid, utilisateur uuid, cle_publique text, algorithme int, compteur bigint, email text)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select c.id, c.utilisateur, c.cle_publique, c.algorithme, c.compteur, u.email
    from socle.cle_acces c join socle.utilisateur u on u.id = c.utilisateur
   where c.identifiant = p_identifiant and c.retiree_le is null
$$;

create function socle.noter_cle_utilisee(p_id uuid, p_compteur bigint, p_maintenant timestamptz) returns void
language sql volatile security definer set search_path = pg_catalog, socle as $$
  update socle.cle_acces set compteur = greatest(compteur, p_compteur), utilisee_le = p_maintenant where id = p_id and retiree_le is null
$$;

-- Ses clés (celles qu'on n'a pas retirées), la plus récente d'abord.
create function socle.mes_cles_acces()
returns table (id uuid, nom text, identifiant text, creee_le timestamptz, utilisee_le timestamptz)
language sql stable security definer set search_path = pg_catalog, socle as $$
  select c.id, c.nom, c.identifiant, c.creee_le, c.utilisee_le from socle.cle_acces c
   where c.utilisateur = socle.moi() and c.retiree_le is null order by c.creee_le desc, c.id
$$;

-- Retirer une de ses clés : elle ne connecte plus. Ses sessions ouvertes restent : elles sont celles de l'appareil, que
-- « Tes appareils » retire.
create function socle.retirer_cle_acces(p_id uuid, p_maintenant timestamptz) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  update socle.cle_acces set retiree_le = p_maintenant where id = p_id and utilisateur = socle.moi() and retiree_le is null;
  return found;
end $$;

revoke execute on function socle.ouvrir_defi_cle(text, text, timestamptz, interval), socle.prendre_defi_cle(uuid, text, timestamptz),
  socle.ajouter_cle_acces(text, text, int, bigint, text, timestamptz), socle.cle_pour_connexion(text),
  socle.noter_cle_utilisee(uuid, bigint, timestamptz), socle.mes_cles_acces(), socle.retirer_cle_acces(uuid, timestamptz) from public;
grant execute on function socle.ouvrir_defi_cle(text, text, timestamptz, interval), socle.prendre_defi_cle(uuid, text, timestamptz),
  socle.ajouter_cle_acces(text, text, int, bigint, text, timestamptz), socle.cle_pour_connexion(text),
  socle.noter_cle_utilisee(uuid, bigint, timestamptz), socle.mes_cles_acces(), socle.retirer_cle_acces(uuid, timestamptz) to skanfact_app;
