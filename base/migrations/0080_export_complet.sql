-- L'export complet de l'entreprise, demandé par elle (lot équipe, « Télécharger toutes mes données », 12/10/2026 ;
-- docs/export-complet.md). 03 : le propriétaire et un administrateur l'obtiennent, jamais bloqué par l'abonnement (07,
-- « jamais de données en otage »), et « il doit contenir tout » (04). Le fichier est celui de l'outil d'exploitation
-- (base/entreprise.ts) : il se restaure à l'identique.
--
-- Le serveur le fabrique dans la transaction de la personne qui le demande, sous la sécurité par ligne : jamais par une
-- connexion d'administration. Elle lui montre toutes les lignes de son entreprise (deux brouillons d'un cabinet mis à part,
-- qui ne partent plus avec l'entreprise : base/entreprise.ts) ; elle ne lui montre pas ce que
-- ces lignes DÉSIGNENT ailleurs, et qui part avec elles comme une référence (sans secret) :
--   - le cabinet qui la tient ou l'a tenue, ses collaborateurs (leurs affectations au dossier, ce qu'ils ont écrit) ;
--   - les personnes et les appareils qui ont agi dans l'entreprise sans en être membres aujourd'hui (le support) ;
--   - les appareils de ses collègues (chacun ne voit que les siens) ;
--   - la liste des migrations de la base, que l'en-tête du fichier porte (une restauration vérifie le niveau).
-- Quatre fonctions les rendent, pour le propriétaire et l'administrateur de l'entreprise seulement, et pour les SEULS
-- identifiants demandés parmi ceux qui touchent l'entreprise : une personne membre d'elle, de son groupe ou d'un cabinet
-- qui a eu un mandat sur elle, ou que sa trace nomme ; un appareil d'une de ces personnes ; une de ces organisations.
-- Le serveur ne demande que ce que les lignes de l'entreprise désignent (base/entreprise.ts) ; la fonction refuse de
-- répondre pour qui ne touche pas l'entreprise, même si on le lui demande. Une personne sort sans son mot de passe ni son
-- téléphone, un appareil sans sa clé, une organisation sans son code de cabinet : les colonnes de l'export d'exploitation.

-- Les transferts de propriété de l'entreprise : le propriétaire et l'administrateur les lisent tous. Ils font partie de son
-- histoire, que l'export emporte (et que la trace nomme déjà) ; avant, seuls celui qui transfère et celui qui reçoit les
-- lisaient, et l'export d'un administrateur, ou d'un propriétaire arrivé par un second transfert, les aurait perdus.
drop policy lire on socle.transfert_propriete;
create policy lire on socle.transfert_propriete for select using (
  de = socle.moi() or vers = socle.moi()
  or (entreprise in (select socle.mes_entreprises()) and socle.mes_roles(entreprise) && array['proprietaire', 'administrateur']::text[]));

-- Peut-on exporter cette entreprise ? Le propriétaire et l'administrateur (03, « Export complet »).
create function socle.peut_exporter(p_entreprise uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select p_entreprise in (select socle.mes_entreprises())
     and socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']::text[]
$$;

-- Les organisations qui touchent l'entreprise : la sienne (un groupe), le cabinet qui la tient, et tout cabinet qui a eu
-- un mandat sur elle, quel qu'en soit l'état (un mandat arrêté laisse ses écritures, ses questions, son fil).
create function socle.export_organisations_proches(p_entreprise uuid) returns setof uuid
language sql stable security definer set search_path = pg_catalog, socle as $$
  select organisation from socle.entreprise where id = p_entreprise and organisation is not null
  union select tenue_par from socle.entreprise where id = p_entreprise and tenue_par is not null
  union select cabinet from socle.mandat where entreprise = p_entreprise
$$;

-- Les personnes qui touchent l'entreprise : membres d'elle ou d'une organisation proche, d'hier comme d'aujourd'hui, et
-- toute personne que sa trace nomme (le support, une personne retirée d'un cabinet).
create function socle.export_personne_proche(p_entreprise uuid, p_utilisateur uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select exists (select 1 from socle.membre m where m.utilisateur = p_utilisateur
                    and (m.entreprise = p_entreprise or m.organisation in (select socle.export_organisations_proches(p_entreprise))))
      or exists (select 1 from socle.audit a where a.utilisateur = p_utilisateur and a.entreprise = p_entreprise)
$$;

create function socle.export_membres(p_entreprise uuid, p_ids uuid[]) returns setof socle.membre
language plpgsql stable security definer set search_path = pg_catalog, socle as $$
begin
  if not socle.peut_exporter(p_entreprise) then perform socle.refus('ton rôle ne permet pas l''export complet de l''entreprise'); end if;
  return query select m.* from socle.membre m
    where m.id = any(p_ids)
      and (m.entreprise = p_entreprise or m.organisation in (select socle.export_organisations_proches(p_entreprise)));
end $$;

create function socle.export_organisations(p_entreprise uuid, p_ids uuid[])
returns table (id uuid, type text, nom text, cree_le timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, socle as $$
begin
  if not socle.peut_exporter(p_entreprise) then perform socle.refus('ton rôle ne permet pas l''export complet de l''entreprise'); end if;
  return query select o.id, o.type, o.nom, o.cree_le from socle.organisation o
    where o.id = any(p_ids) and o.id in (select socle.export_organisations_proches(p_entreprise));
end $$;

create function socle.export_utilisateurs(p_entreprise uuid, p_ids uuid[])
returns table (id uuid, email text, nom text, langue text, cree_le timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, socle as $$
begin
  if not socle.peut_exporter(p_entreprise) then perform socle.refus('ton rôle ne permet pas l''export complet de l''entreprise'); end if;
  return query select u.id, u.email, u.nom, u.langue, u.cree_le from socle.utilisateur u
    where u.id = any(p_ids) and socle.export_personne_proche(p_entreprise, u.id);
end $$;

create function socle.export_appareils(p_entreprise uuid, p_ids uuid[])
returns table (id uuid, utilisateur uuid, nom text, type text, premier_vu timestamptz, revoque_le timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, socle as $$
begin
  if not socle.peut_exporter(p_entreprise) then perform socle.refus('ton rôle ne permet pas l''export complet de l''entreprise'); end if;
  return query select a.id, a.utilisateur, a.nom, a.type, a.premier_vu, a.revoque_le from socle.appareil a
    where a.id = any(p_ids) and socle.export_personne_proche(p_entreprise, a.utilisateur);
end $$;

-- Le niveau de la base, que l'en-tête de l'export porte : une restauration le compare au sien. Les numéros et les
-- empreintes des fichiers de migration du dépôt (public) ; rien d'autre.
create function socle.export_migrations(p_entreprise uuid) returns table (numero integer, empreinte text)
language plpgsql stable security definer set search_path = pg_catalog, socle as $$
begin
  if not socle.peut_exporter(p_entreprise) then perform socle.refus('ton rôle ne permet pas l''export complet de l''entreprise'); end if;
  return query select m.numero, m.empreinte from socle.migration m order by m.numero;
end $$;

revoke execute on function socle.peut_exporter(uuid), socle.export_organisations_proches(uuid),
  socle.export_personne_proche(uuid, uuid), socle.export_membres(uuid, uuid[]), socle.export_organisations(uuid, uuid[]),
  socle.export_utilisateurs(uuid, uuid[]), socle.export_appareils(uuid, uuid[]), socle.export_migrations(uuid) from public;
grant execute on function socle.export_membres(uuid, uuid[]), socle.export_organisations(uuid, uuid[]),
  socle.export_utilisateurs(uuid, uuid[]), socle.export_appareils(uuid, uuid[]), socle.export_migrations(uuid) to skanfact_app;
