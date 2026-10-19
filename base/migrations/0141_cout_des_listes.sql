-- 0141 — Le coût des listes de la console (l'audit 1.42.0 A09 ; docs/console.md C65 ; décidé par délégation le 19/10/2026).
--
-- Mesuré d'abord (banc/console/mesurer.ts : 5 000 entreprises, deux millions de pièces émises, cinq personnes de l'équipe
-- en même temps ; seuil écrit d'avance : 95 % des réponses en moins de 300 ms) : la liste des clients répondait en 19 s,
-- la fiche d'un client en 10 s, l'accueil en 22 s. Où le temps passait, fonction par fonction :
--   - compter les pièces de CHAQUE entreprise à chaque liste (plateforme.pieces_creees : deux millions de lignes relues) ;
--   - compter ses membres sans index sur l'entreprise (la table entière relue 5 000 fois) ;
--   - les pièces émises du mois et des deux fois trente jours, cherchées par un jour calculé sur chaque pièce (aucun index
--     ne peut servir : toutes les pièces émises relues) ;
--   - la fiche d'UN client, qui faisait ces calculs pour TOUS les clients et gardait le sien.
-- Ici, la base ; le reste (lire une seule fois ce que plusieurs personnes lisent) est dans le serveur (C65).

-- ── 1. Les membres d'une entreprise : un index ──────────────────────────────────────────────────────────────────────
create index membre_entreprise on socle.membre (entreprise) where entreprise is not null;

-- ── 2. Les pièces émises, par entreprise et par instant ─────────────────────────────────────────────────────────────
-- Ce que la console demande des pièces émises : combien entre deux instants (le mois, les trente jours), la première.
create index piece_emise on ventes.piece (entreprise, emise_le) where statut = 'emise';

-- ── 3. Les pièces créées : un compte tenu à jour ─────────────────────────────────────────────────────────────────────
-- Le nombre de pièces créées d'une entreprise (0114 : son dossier v10, ses pièces de vente et d'achat du serveur, brouillons
-- compris ; « a servi » n'a que cette définition) se tient à jour à chaque pièce qui naît ou s'en va, au lieu d'être recompté
-- à chaque liste (VISION-ARCHITECTURE.md : des totaux tenus à jour plutôt que recalculés). plateforme.pieces_creees reste
-- le recompte, pour une entreprise ; un essai compare les deux chemins (tests/console/cout-des-listes.test.ts).
-- La restauration et la remise d'une entreprise reposent ses lignes sans déclencheurs : elles le refont (socle.recompter_pieces).
create table socle.compte_pieces (
  entreprise uuid primary key references socle.entreprise(id) on delete cascade,
  n bigint not null check (n >= 0)
);
alter table socle.compte_pieces enable row level security;
alter table socle.compte_pieces force row level security;
-- Personne ne le lit en direct : la console, par ses fonctions.
create policy aucune on socle.compte_pieces using (false);

create function socle.recompter_pieces(p_entreprise uuid) returns void
language sql volatile security definer set search_path = pg_catalog, socle as $$
  insert into socle.compte_pieces (entreprise, n)
    select e.id, plateforme.pieces_creees(e.id) from socle.entreprise e where e.id = p_entreprise
  on conflict (entreprise) do update set n = excluded.n
$$;
revoke execute on function socle.recompter_pieces(uuid) from public;

-- Ajouter ou retirer, entreprise par entreprise, ce qu'une instruction a créé ou retiré (une instruction qui pose mille
-- pièces fait une écriture par entreprise, pas mille). Une entreprise qui s'en va (ses pièces partent avec elle) n'a plus
-- de compte à tenir.
create function socle.compter_pieces(p_deltas jsonb) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
begin
  insert into socle.compte_pieces as c (entreprise, n)
    select (d.key)::uuid, greatest((d.value)::bigint, 0) from jsonb_each_text(p_deltas) d
     where exists (select 1 from socle.entreprise e where e.id = (d.key)::uuid)
  on conflict (entreprise) do update set n = greatest(c.n + (p_deltas ->> c.entreprise::text)::bigint, 0);
end $$;
revoke execute on function socle.compter_pieces(jsonb) from public;

-- Une pièce du serveur compte si elle n'est pas reprise de la v10 (ref_v10 : la v10 l'a déjà comptée dans le dossier) ;
-- un objet du dossier v10, si c'est un document de vente ou d'achat.
create function socle.pieces_comptees_ajout() returns trigger
language plpgsql security definer set search_path = pg_catalog, socle as $$
begin
  perform socle.compter_pieces((select jsonb_object_agg(entreprise, k) from (
    select n.entreprise, count(*) k from nouvelles n where n.ref_v10 is null group by n.entreprise) x));
  return null;
end $$;
create function socle.pieces_comptees_retrait() returns trigger
language plpgsql security definer set search_path = pg_catalog, socle as $$
begin
  perform socle.compter_pieces((select jsonb_object_agg(entreprise, -k) from (
    select a.entreprise, count(*) k from anciennes a where a.ref_v10 is null group by a.entreprise) x));
  return null;
end $$;
create function socle.documents_comptes_ajout() returns trigger
language plpgsql security definer set search_path = pg_catalog, socle as $$
begin
  perform socle.compter_pieces((select jsonb_object_agg(entreprise, k) from (
    select n.entreprise, count(*) k from nouvelles n where n.collection in ('documents', 'purchases') group by n.entreprise) x));
  return null;
end $$;
create function socle.documents_comptes_retrait() returns trigger
language plpgsql security definer set search_path = pg_catalog, socle as $$
begin
  perform socle.compter_pieces((select jsonb_object_agg(entreprise, -k) from (
    select a.entreprise, count(*) k from anciennes a where a.collection in ('documents', 'purchases') group by a.entreprise) x));
  return null;
end $$;
-- Une pièce qui changerait d'entreprise ou de nature (rien ne le fait aujourd'hui) : son entreprise se recompte.
create function socle.pieces_comptees_change() returns trigger
language plpgsql security definer set search_path = pg_catalog, socle as $$
begin
  perform socle.recompter_pieces(old.entreprise);
  if new.entreprise is distinct from old.entreprise then perform socle.recompter_pieces(new.entreprise); end if;
  return null;
end $$;

revoke execute on function socle.pieces_comptees_ajout(), socle.pieces_comptees_retrait(), socle.documents_comptes_ajout(),
  socle.documents_comptes_retrait(), socle.pieces_comptees_change() from public;

create trigger pieces_comptees_ajout after insert on ventes.piece referencing new table as nouvelles
  for each statement execute function socle.pieces_comptees_ajout();
create trigger pieces_comptees_retrait after delete on ventes.piece referencing old table as anciennes
  for each statement execute function socle.pieces_comptees_retrait();
create trigger pieces_comptees_change after update of entreprise, ref_v10 on ventes.piece
  for each row when (new.entreprise is distinct from old.entreprise or (new.ref_v10 is null) <> (old.ref_v10 is null))
  execute function socle.pieces_comptees_change();
create trigger pieces_comptees_ajout after insert on achats.piece referencing new table as nouvelles
  for each statement execute function socle.pieces_comptees_ajout();
create trigger pieces_comptees_retrait after delete on achats.piece referencing old table as anciennes
  for each statement execute function socle.pieces_comptees_retrait();
create trigger pieces_comptees_change after update of entreprise, ref_v10 on achats.piece
  for each row when (new.entreprise is distinct from old.entreprise or (new.ref_v10 is null) <> (old.ref_v10 is null))
  execute function socle.pieces_comptees_change();
create trigger pieces_comptees_ajout after insert on socle.dossier_v10 referencing new table as nouvelles
  for each statement execute function socle.documents_comptes_ajout();
create trigger pieces_comptees_retrait after delete on socle.dossier_v10 referencing old table as anciennes
  for each statement execute function socle.documents_comptes_retrait();
create trigger pieces_comptees_change after update of entreprise, collection on socle.dossier_v10
  for each row when (new.entreprise is distinct from old.entreprise or new.collection is distinct from old.collection)
  execute function socle.pieces_comptees_change();

-- Le compte de départ : celui de chaque entreprise, recompté une fois.
insert into socle.compte_pieces (entreprise, n) select e.id, plateforme.pieces_creees(e.id) from socle.entreprise e;

-- ── 4. Les lectures de la liste, sur ce qui précède ; et pour UNE entreprise, la sienne seulement ────────────────────────
-- p_entreprise : la fiche d'un client lit sa ligne, plus celle de tous (même calcul, même règle : C3).
drop function plateforme.console_entreprises();
create function plateforme.console_entreprises(p_entreprise uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'raisonSociale', e.raison_sociale, 'matricule', e.matricule_fiscal, 'active', e.active,
      'creeLe', (e.cree_le at time zone e.fuseau)::date,
      'organisation', jsonb_build_object('id', o.id, 'type', o.type, 'nom', o.nom),
      'tenuePar', (select c.nom from socle.organisation c where c.id = e.tenue_par),
      'faits', jsonb_build_object('connu', a.entreprise is not null, 'essaiJusquAu', a.essai_jusqu_au, 'payeJusquAu', a.paye_jusqu_au,
        'offre', a.offre, 'periodicite', a.periodicite, 'resilieLe', a.resilie_le, 'suspenduLe', a.suspendu_le,
        'offert', coalesce(a.offert, false), 'bacASable', e.essai, 'tenuParCabinet', e.tenue_par is not null),
      'proprietaire', (select jsonb_build_object('nom', u.nom, 'email', u.email) from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
                        where m.entreprise = e.id and m.actif and 'proprietaire' = any(m.roles) order by m.depuis limit 1),
      'membres', (select count(*) from socle.membre m where m.entreprise = e.id and m.actif),
      -- Le dernier instant où quelqu'un a travaillé DANS cette entreprise (socle.activite) : ni ailleurs, ni une connexion.
      'derniereActivite', (select max(a.derniere) from socle.activite a where a.entreprise = e.id),
      'pieces', coalesce((select k.n from socle.compte_pieces k where k.entreprise = e.id), 0)
    ) order by e.cree_le desc, e.id), '[]'::jsonb)
    from socle.entreprise e join socle.organisation o on o.id = e.organisation
    left join plateforme.abonnement a on a.entreprise = e.id
   where not e.essai and (p_entreprise is null or e.id = p_entreprise));
end
$$;
revoke execute on function plateforme.console_entreprises(uuid) from public;
grant execute on function plateforme.console_entreprises(uuid) to skanfact_app;

-- Les bornes d'un jour de l'entreprise, en instants : « émise ce jour-là dans son fuseau » se cherche ainsi dans l'index.
drop function plateforme.console_usage_trente(date);
create function plateforme.console_usage_trente(p_jour date, p_entreprise uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  if p_jour is null then perform socle.refus('le jour de la mesure manque'); end if;
  return (select coalesce(jsonb_object_agg(x.entreprise, jsonb_build_object('trente', x.trente, 'avant', x.avant)), '{}'::jsonb) from (
    select e.id entreprise,
           (select count(*) from ventes.piece p where p.entreprise = e.id and p.statut = 'emise'
               and p.emise_le >= (p_jour - 29)::timestamp at time zone e.fuseau and p.emise_le < (p_jour + 1)::timestamp at time zone e.fuseau)::int trente,
           (select count(*) from ventes.piece p where p.entreprise = e.id and p.statut = 'emise'
               and p.emise_le >= (p_jour - 59)::timestamp at time zone e.fuseau and p.emise_le < (p_jour - 29)::timestamp at time zone e.fuseau)::int avant
      from socle.entreprise e
     where not e.essai and (p_entreprise is null or e.id = p_entreprise)) x
   where x.trente > 0 or x.avant > 0);
end $$;
revoke execute on function plateforme.console_usage_trente(date, uuid) from public;
grant execute on function plateforme.console_usage_trente(date, uuid) to skanfact_app;

drop function plateforme.console_clients_en_plus(date);
create function plateforme.console_clients_en_plus(p_jour date, p_entreprise uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  if p_jour is null then perform socle.refus('le jour de la liste manque'); end if;
  return (select coalesce(jsonb_object_agg(e.id, jsonb_build_object(
      'piecesMois', (select count(*) from ventes.piece p where p.entreprise = e.id and p.statut = 'emise'
                       and p.emise_le >= date_trunc('month', p_jour)::date::timestamp at time zone e.fuseau
                       and p.emise_le < (p_jour + 1)::timestamp at time zone e.fuseau),
      'prolonge', (select coalesce(sum((v.apres ->> 'jours')::int), 0) from plateforme.evenement_abonnement v
                    where v.entreprise = e.id and v.nature = 'essai_prolonge' and jsonb_typeof(v.apres -> 'jours') = 'number'),
      'essaiJours', (select (v.apres ->> 'essaiJusquAu')::date - (v.le at time zone e.fuseau)::date from plateforme.evenement_abonnement v
                      where v.entreprise = e.id and v.nature = 'essai_commence' and v.apres ->> 'essaiJusquAu' ~ '^\d{4}-\d{2}-\d{2}$'
                      order by v.le limit 1),
      'prolongeUneFois', exists (select 1 from plateforme.evenement_abonnement v where v.entreprise = e.id and v.nature = 'essai_prolonge'),
      'moisOffertRecent', exists (select 1 from plateforme.evenement_abonnement v where v.entreprise = e.id and v.nature = 'mois_offert'
                                    and v.le > (p_jour - 365)::timestamptz),
      -- 0127 : le jour (de son fuseau) de sa première facture émise — une note d'honoraires compte —, sa première
      -- utilisation réelle (serveur/console/arrivee.ts).
      'premiereFactureLe', (select (min(p.emise_le) at time zone e.fuseau)::date from ventes.piece p
                             where p.entreprise = e.id and p.type in ('facture', 'note_honoraires') and p.statut = 'emise'),
      -- 0137 : son arrivée close (l'audit 1.42.0 A06) : quand, par qui, pourquoi ; vide si elle ne l'est pas.
      'arriveeClose', (select jsonb_build_object('le', a.close_le, 'par', (select u.nom from socle.utilisateur u where u.id = a.close_par), 'motif', a.motif)
                         from plateforme.arrivee_close a where a.entreprise = e.id),
      'factures', case when exists (select 1 from plateforme.facture_abonnement f where f.entreprise = e.id and f.payee_le is null)
                       then plateforme.console_factures_abonnement(e.id) else '[]'::jsonb end)), '{}'::jsonb)
    from socle.entreprise e
   where not e.essai and (p_entreprise is null or e.id = p_entreprise));
end $$;
revoke execute on function plateforme.console_clients_en_plus(date, uuid) from public;
grant execute on function plateforme.console_clients_en_plus(date, uuid) to skanfact_app;

drop function plateforme.console_identites(date);
create function plateforme.console_identites(p_jour date, p_entreprise uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  if p_jour is null then perform socle.refus('le jour de la liste manque'); end if;
  return jsonb_build_object(
    'entreprises', (select coalesce(jsonb_object_agg(e.id, jsonb_build_object(
        'numero', plateforme.numero_texte(e.id), 'ville', e.ville,
        'telephone', (select u.telephone from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
                       where m.entreprise = e.id and m.actif and 'proprietaire' = any(m.roles) and u.telephone_verifie_le is not null
                       order by m.depuis limit 1),
        'dernierAppel', (select jsonb_build_object('le', n.le, 'resultat', n.resultat, 'qui', (select u.nom from socle.utilisateur u where u.id = n.qui))
                           from plateforme.note_appel n where n.entreprise = e.id order by n.le desc limit 1))), '{}'::jsonb)
      from socle.entreprise e where not e.essai and (p_entreprise is null or e.id = p_entreprise)),
    'cabinets', (select coalesce(jsonb_object_agg(o.id, plateforme.numero_texte(o.id)), '{}'::jsonb) from socle.organisation o where o.type = 'cabinet'),
    -- Les groupes de la console et leurs sociétés ce jour-là (0106 : `depuis <= J < retire_le`) : une ligne de la liste.
    'groupes', (select coalesce(jsonb_object_agg(g.id, jsonb_build_object('numero', plateforme.numero_texte(g.id), 'nom', g.nom,
        'membres', (select coalesce(jsonb_agg(m.entreprise order by m.depuis, m.entreprise), '[]'::jsonb) from plateforme.groupe_membre m
                     where m.groupe = g.id and m.depuis <= p_jour and (m.retire_le is null or p_jour < m.retire_le)))), '{}'::jsonb)
      from plateforme.groupe g));
end $$;
revoke execute on function plateforme.console_identites(date, uuid) from public;
grant execute on function plateforme.console_identites(date, uuid) to skanfact_app;

-- Les cabinets et leurs dossiers : un dossier se cherche par son cabinet (le mandat, la tenue), jamais en relisant toutes
-- les entreprises pour chaque cabinet. p_entreprise : la fiche d'un client lit les seuls cabinets qui la suivent.
create index mandat_cabinet on socle.mandat (cabinet, entreprise);
create index mandat_entreprise on socle.mandat (entreprise);
create index entreprise_tenue_par on socle.entreprise (tenue_par) where tenue_par is not null;

drop function plateforme.console_cabinets();
create function plateforme.console_cabinets(p_entreprise uuid default null) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'nom', o.nom, 'creeLe', (o.cree_le at time zone 'Africa/Tunis')::date,
      'collaborateurs', (select coalesce(jsonb_agg(jsonb_build_object('nom', u.nom, 'email', u.email, 'roles', m.roles, 'depuis', m.depuis,
                            'derniereConnexion', (select max(s.derniere_activite) from socle.session s where s.utilisateur = u.id))
                            order by ('supervision' = any(m.roles)) desc, u.nom, u.id), '[]'::jsonb)
                           from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
                          where m.organisation = o.id and m.actif),
      -- Les dossiers tenus portent aussi le mandat que leur création a posé ; un client, celui qu'il a donné ou proposé.
      -- Un mandat terminé n'en fait plus un dossier du cabinet. Jamais une entreprise d'exemple.
      'dossiers', (select coalesce(jsonb_agg(jsonb_build_object('entreprise', e.id, 'tenu', e.tenue_par = o.id,
                       'mandat', (select jsonb_build_object('statut', d.statut, 'debut', d.debut) from socle.mandat d
                                   where d.cabinet = o.id and d.entreprise = e.id and d.statut in ('propose', 'actif')
                                   order by d.statut = 'actif' desc, d.cree_le desc, d.id desc limit 1))
                       order by e.raison_sociale, e.id), '[]'::jsonb)
                     from socle.entreprise e
                    where not e.essai
                      and e.id in (select x.id from socle.entreprise x where x.tenue_par = o.id
                                   union select d.entreprise from socle.mandat d where d.cabinet = o.id and d.statut in ('propose', 'actif')))
    ) order by o.cree_le desc, o.id), '[]'::jsonb)
    from socle.organisation o
   where o.type = 'cabinet'
     and (p_entreprise is null
          or o.id in (select x.tenue_par from socle.entreprise x where x.id = p_entreprise
                      union select d.cabinet from socle.mandat d where d.entreprise = p_entreprise and d.statut in ('propose', 'actif'))));
end $$;
revoke execute on function plateforme.console_cabinets(uuid) from public;
grant execute on function plateforme.console_cabinets(uuid) to skanfact_app;

-- ── 5. Le calcul partagé de la liste (serveur/console/instantane.ts) ─────────────────────────────────────────────────
-- Avant de servir à une session un calcul fait pour une autre, la base revérifie le rôle de CELLE-CI : la direction et le
-- support lisent la liste des clients ; la technique, jamais (03 § 5).
create function plateforme.console_lire_la_liste() returns void
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
end $$;
revoke execute on function plateforme.console_lire_la_liste() from public;
grant execute on function plateforme.console_lire_la_liste() to skanfact_app;
