-- 0142 — Le contenu des pièces scellées, relu contre son empreinte (l'audit 1.42.0 § 4 ; docs/console.md C66 ; décidé par
-- délégation le 19/10/2026).
--
-- La relecture de 0115 refait les LIENS de chaque chaîne (chaque maillon suit le précédent, chaque empreinte se recalcule,
-- la fin est là). Elle ne voit pas une pièce retouchée par-dessous la base, dont le maillon, lui, n'a pas bougé : c'est le
-- CONTENU de la pièce d'aujourd'hui, recalculé et comparé à celui qui a été scellé, qui la voit. Ce contenu se calcule par
-- le module qui possède la pièce, avec la fonction qui l'a scellée (deux chemins, un chiffre) :
--   - une écriture validée : compta.contenu_ecriture, dans la base (0018) ;
--   - une pièce de vente : `contenuScelle` (serveur/ventes/pieces.ts), dans le serveur — la base lui rend les pièces et
--     leurs lignes, au serveur seul (aucune personne connectée n'appelle ces fonctions).
-- Chaque chaîne garde la date et le résultat de sa dernière relecture du contenu, et jusqu'à quel maillon elle est allée
-- (une pièce scellée après le début de la relecture attend la suivante). Une relecture se demande aussi depuis la console :
-- pour une entreprise (la direction, qui la nomme) ou pour toutes ; une seule à la fois, faite par le serveur, qui note où
-- il en est.

-- ── 1. Ce que chaque chaîne garde de la relecture de son contenu ─────────────────────────────────────────────────────
-- `contenu_ok` : vrai, tout relu était intact ; faux, une pièce a changé ou a disparu (au rang `contenu_rang` ; `contenu_motif`
-- le dit par un code : « modifiee », « disparue », que la console dit en mots) ; vide avec une date, la chaîne porte une sorte
-- de pièce que la relecture ne sait pas encore lire (« inconnue:<sorte> »).
alter table socle.chaine add column contenu_le timestamptz, add column contenu_ok boolean, add column contenu_rang bigint,
  add column contenu_motif text, add column contenu_jusqua bigint;
create index chaine_contenu_le on socle.chaine (contenu_le nulls first);

-- Le serveur seul : une personne connectée (socle.moi()) n'appelle aucune des fonctions qui suivent, sauf la console.
create function plateforme.exiger_le_serveur() returns void
language plpgsql stable security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is not null then perform socle.refus('seul le serveur relit le contenu des pièces scellées'); end if;
end $$;

-- Les chaînes à relire : celles d'une entreprise (toutes), ou les `p_lot` les moins récemment relues de toute la base
-- (jamais relues en tête). Une chaîne sans maillon n'a rien à relire.
create function plateforme.contenus_a_relire(p_lot integer, p_entreprise uuid)
returns table (entreprise uuid, cle text, rang bigint)
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_le_serveur();
  if p_entreprise is not null then
    return query select ch.entreprise, ch.cle, ch.rang from socle.chaine ch where ch.entreprise = p_entreprise and ch.rang > 0 order by ch.cle;
  else
    return query select ch.entreprise, ch.cle, ch.rang from socle.chaine ch where ch.rang > 0
      order by ch.contenu_le nulls first, ch.entreprise, ch.cle limit greatest(coalesce(p_lot, 1), 1);
  end if;
end $$;

-- Les maillons d'une chaîne, `p_n` à la fois, après le rang `p_apres` et jusqu'au rang `p_jusqua`. Pour une écriture, son
-- contenu d'aujourd'hui est recalculé ici même (`recalcule`, vide si elle a disparu) ; pour une pièce de vente, le serveur
-- le recalcule (plateforme.pieces_a_relire, plateforme.lignes_a_relire).
create function plateforme.maillons_a_relire(p_entreprise uuid, p_cle text, p_apres bigint, p_jusqua bigint, p_n integer)
returns table (rang bigint, objet_type text, objet_id uuid, contenu text, recalcule text)
language plpgsql stable security definer set search_path = pg_catalog, socle, compta, plateforme as $$
begin
  perform plateforme.exiger_le_serveur();
  return query
    select m.rang, m.objet_type, m.objet_id, m.contenu,
           case when m.objet_type = 'ecriture' then
             (select compta.contenu_ecriture(e.id, e.numero) from compta.ecriture e where e.id = m.objet_id and e.entreprise = m.entreprise) end
      from socle.maillon m
     where m.entreprise = p_entreprise and m.cle = p_cle and m.rang > p_apres and m.rang <= p_jusqua
     order by m.rang limit least(greatest(coalesce(p_n, 1), 1), 2000);
end $$;

-- Les pièces de vente et leurs lignes, telles qu'elles sont aujourd'hui, pour le serveur qui recalcule leur contenu.
create function plateforme.pieces_a_relire(p_entreprise uuid, p_ids uuid[]) returns setof ventes.piece
language plpgsql stable security definer set search_path = pg_catalog, ventes, plateforme as $$
begin
  perform plateforme.exiger_le_serveur();
  return query select p.* from ventes.piece p where p.entreprise = p_entreprise and p.id = any(p_ids);
end $$;
create function plateforme.lignes_a_relire(p_entreprise uuid, p_ids uuid[]) returns setof ventes.ligne
language plpgsql stable security definer set search_path = pg_catalog, ventes, plateforme as $$
begin
  perform plateforme.exiger_le_serveur();
  return query select l.* from ventes.ligne l where l.entreprise = p_entreprise and l.piece = any(p_ids) order by l.piece, l.rang;
end $$;

-- Les liens d'UNE chaîne (une relecture demandée les refait avant le contenu) : le contrôle de 0115, par le serveur seul.
create function plateforme.relire_liens(p_entreprise uuid, p_cle text, p_le timestamptz) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_ok boolean;
begin
  perform plateforme.exiger_le_serveur();
  select v.ok into v_ok from socle.verifier_chaine(p_entreprise, p_cle, p_le) v;
  return v_ok;
end $$;

-- Ce que la relecture a trouvé, pour une chaîne.
create function plateforme.noter_contenu(p_entreprise uuid, p_cle text, p_le timestamptz, p_ok boolean, p_rang bigint, p_motif text, p_jusqua bigint)
returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_le_serveur();
  if p_motif is not null and length(p_motif) > 200 then perform socle.refus('le motif d''une relecture : 200 caractères au plus'); end if;
  update socle.chaine ch set contenu_le = p_le, contenu_ok = p_ok, contenu_rang = case when p_ok then null else p_rang end,
         contenu_motif = case when p_ok then null else p_motif end, contenu_jusqua = p_jusqua
   where ch.entreprise = p_entreprise and ch.cle = p_cle;
end $$;

-- ── 2. Chaque relecture du contenu, comptée ──────────────────────────────────────────────────────────────────────────
-- Quand, combien de chaînes et de pièces relues, combien de chaînes au contenu cassé en tout après elle, combien de temps.
-- Quatre-vingt-dix jours se gardent (comme plateforme.releve_chaines).
create table plateforme.releve_contenus (
  le timestamptz primary key,
  chaines integer not null check (chaines >= 0),
  pieces bigint not null check (pieces >= 0),
  cassees integer not null check (cassees >= 0),
  duree_ms integer not null check (duree_ms >= 0)
);
alter table plateforme.releve_contenus enable row level security;
alter table plateforme.releve_contenus force row level security;

create function plateforme.noter_releve_contenus(p_le timestamptz, p_chaines integer, p_pieces bigint, p_duree_ms integer) returns integer
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_cassees integer;
begin
  perform plateforme.exiger_le_serveur();
  select count(*) into v_cassees from socle.chaine ch where ch.contenu_ok = false;
  insert into plateforme.releve_contenus (le, chaines, pieces, cassees, duree_ms)
    values (p_le, greatest(p_chaines, 0), greatest(p_pieces, 0), v_cassees, greatest(p_duree_ms, 0))
    on conflict (le) do update set chaines = excluded.chaines, pieces = excluded.pieces, cassees = excluded.cassees, duree_ms = excluded.duree_ms;
  delete from plateforme.releve_contenus where le < p_le - interval '90 days';
  return v_cassees;
end $$;

-- Une relecture demandée refait aussi les liens de chaque chaîne : elle se compte comme une relecture des liens (0115).
create function plateforme.noter_releve_liens(p_le timestamptz, p_chaines integer, p_maillons bigint, p_duree_ms integer) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_le_serveur();
  insert into plateforme.releve_chaines (le, chaines, maillons, cassees, duree_ms)
    values (p_le, greatest(p_chaines, 0), greatest(p_maillons, 0), (select count(*) from socle.chaine ch where ch.controle_ok = false), greatest(p_duree_ms, 0))
    on conflict (le) do update set chaines = excluded.chaines, maillons = excluded.maillons, cassees = excluded.cassees, duree_ms = excluded.duree_ms;
end $$;

-- ── 3. Une relecture demandée depuis la console ──────────────────────────────────────────────────────────────────────
-- Pour une entreprise (la direction, qui la nomme : son numéro de client « E-0012 »), ou pour toutes. Une seule à la fois :
-- la suivante attend que celle-ci soit finie. Le serveur la prend (`pris_le`, renouvelé à chaque pas : un serveur arrêté
-- en route la laisse reprendre par un autre après cinq minutes), dit où il en est, et la finit.
create table plateforme.relecture_demandee (
  id uuid primary key default socle.uuidv7(),
  demandee_le timestamptz not null,
  demandee_par uuid not null references socle.utilisateur(id),
  entreprise uuid references socle.entreprise(id),
  pris_le timestamptz,
  total integer check (total >= 0),
  faites integer not null default 0 check (faites >= 0),
  pieces bigint not null default 0 check (pieces >= 0),
  cassees integer not null default 0 check (cassees >= 0),
  finie_le timestamptz
);
create unique index relecture_une_seule on plateforme.relecture_demandee ((true)) where finie_le is null;
alter table plateforme.relecture_demandee enable row level security;
alter table plateforme.relecture_demandee force row level security;

-- Demander : la direction ou la technique pour toutes, la direction seule pour une entreprise (la technique ne reçoit aucun
-- identifiant de client, 03 § 5). Le geste entre au journal de la console, avec son motif.
create function plateforme.console_demander_relecture(p_client text, p_motif text, p_maintenant timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'technique']);
  v_client text := upper(btrim(coalesce(p_client, ''))); v_ent uuid; v_id uuid; v_en_cours plateforme.relecture_demandee;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('une relecture demandée dit pourquoi (trois caractères au moins) : elle reste au journal de la console'); end if;
  if v_client <> '' then
    if v_role <> 'direction' then perform socle.refus('relire une entreprise nommée est un geste de la direction'); end if;
    if v_client ~ '^E-[0-9]{1,9}$' then
      select n.objet into v_ent from plateforme.numero_client n where n.sorte = 'E' and n.numero = substr(v_client, 3)::integer;
    elsif v_client ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' then
      select e.id into v_ent from socle.entreprise e where e.id = lower(v_client)::uuid;
    end if;
    if v_ent is null then perform socle.refus('aucune entreprise ne porte ce numéro de client'); end if;
  end if;
  select * into v_en_cours from plateforme.relecture_demandee d where d.finie_le is null;
  if found then perform socle.refus('une relecture est déjà en cours : la suivante se demande quand elle est finie'); end if;
  insert into plateforme.relecture_demandee (demandee_le, demandee_par, entreprise) values (p_maintenant, socle.moi(), v_ent) returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, apres)
    values (socle.moi(), v_role, 'service.relecture_demandee', v_ent, btrim(p_motif), jsonb_build_object('relecture', v_id, 'toutes', v_ent is null));
  return jsonb_build_object('id', v_id);
end $$;

-- Prendre la demande ouverte (le serveur) : celle que personne ne tient, ou qu'un serveur arrêté a lâchée depuis cinq minutes.
create function plateforme.relecture_prendre(p_maintenant timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare d plateforme.relecture_demandee;
begin
  perform plateforme.exiger_le_serveur();
  select * into d from plateforme.relecture_demandee x
   where x.finie_le is null and (x.pris_le is null or x.pris_le < p_maintenant - interval '5 minutes')
   for update skip locked;
  if not found then return null; end if;
  update plateforme.relecture_demandee set pris_le = p_maintenant, faites = 0, pieces = 0, cassees = 0, total = null where id = d.id;
  return jsonb_build_object('id', d.id, 'entreprise', d.entreprise);
end $$;

-- Où en est le serveur (`p_finie` : elle est finie).
create function plateforme.relecture_avance(p_id uuid, p_total integer, p_faites integer, p_pieces bigint, p_cassees integer, p_finie boolean, p_maintenant timestamptz)
returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_le_serveur();
  update plateforme.relecture_demandee set pris_le = p_maintenant, total = p_total, faites = greatest(p_faites, 0), pieces = greatest(p_pieces, 0),
         cassees = greatest(p_cassees, 0), finie_le = case when p_finie then p_maintenant end
   where id = p_id and finie_le is null;
end $$;

-- ── 4. Ce que la console en montre ───────────────────────────────────────────────────────────────────────────────────
-- 0115 redite : `nCassees` compte une chaîne cassée par ses liens OU par son contenu, et chaque chaîne cassée dit ce qui
-- casse (`quoi` : « liens » ou « contenu »). `contenu` : la dernière relecture du contenu, ce qui n'a jamais été relu, le
-- plus ancien, ce qui ne se relit pas encore. `demande` : la relecture demandée en cours, ou la dernière (sept jours).
-- `incident` : l'incident ouvert sur la fiche réflexe « une chaîne cassée » (« empreinte »).
create or replace function plateforme.console_chaines(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']);
begin
  return jsonb_build_object(
    'dernier', (select jsonb_build_object('le', r.le, 'chaines', r.chaines, 'maillons', r.maillons, 'cassees', r.cassees, 'dureeMs', r.duree_ms)
                  from plateforme.releve_chaines r order by r.le desc limit 1),
    'total', (select count(*) from socle.chaine),
    'maillons', (select coalesce(sum(ch.rang), 0) from socle.chaine ch),
    'jamais', (select count(*) from socle.chaine ch where ch.controle_le is null),
    'plusAncien', (select min(ch.controle_le) from socle.chaine ch),
    'nCassees', (select count(*) from socle.chaine ch where ch.controle_ok = false or ch.contenu_ok = false),
    'jours', (select coalesce(jsonb_agg(jsonb_build_object('jour', j.jour, 'n', j.n, 'cassees', j.cassees) order by j.jour), '[]'::jsonb) from (
                select coalesce(a.jour, b.jour) jour, coalesce(a.n, 0) + coalesce(b.n, 0) n, greatest(coalesce(a.cassees, 0), coalesce(b.cassees, 0)) cassees
                  from (select (r.le at time zone 'Africa/Tunis')::date jour, count(*) n, max(r.cassees) cassees from plateforme.releve_chaines r
                         where r.le >= p_maintenant - interval '30 days' group by 1) a
                  full join (select (r.le at time zone 'Africa/Tunis')::date jour, count(*) n, max(r.cassees) cassees from plateforme.releve_contenus r
                              where r.le >= p_maintenant - interval '30 days' group by 1) b on a.jour = b.jour) j),
    'cassees', (select coalesce(jsonb_agg(jsonb_build_object('sorte', split_part(x.cle, ':', 1), 'quoi', x.quoi, 'rang', x.rang, 'motif', x.motif,
                  'le', x.le, 'entreprise', case when v_role = 'direction' then jsonb_build_object('id', e.id, 'nom', e.raison_sociale, 'numero', plateforme.numero_texte(e.id)) end)
                  order by x.le desc), '[]'::jsonb)
                  from (select * from (
                          select ch.entreprise, ch.cle, 'liens' quoi, ch.casse_rang rang, ch.casse_motif motif, ch.controle_le le from socle.chaine ch where ch.controle_ok = false
                          union all
                          select ch.entreprise, ch.cle, 'contenu', ch.contenu_rang, ch.contenu_motif, ch.contenu_le from socle.chaine ch where ch.contenu_ok = false) y
                        order by y.le desc limit 20) x
                  join socle.entreprise e on e.id = x.entreprise),
    'contenu', jsonb_build_object(
      'dernier', (select jsonb_build_object('le', r.le, 'chaines', r.chaines, 'pieces', r.pieces, 'cassees', r.cassees, 'dureeMs', r.duree_ms)
                    from plateforme.releve_contenus r order by r.le desc limit 1),
      'jamais', (select count(*) from socle.chaine ch where ch.contenu_le is null and ch.rang > 0),
      'plusAncien', (select min(ch.contenu_le) from socle.chaine ch where ch.rang > 0),
      'nCassees', (select count(*) from socle.chaine ch where ch.contenu_ok = false),
      'nonRelues', (select count(*) from socle.chaine ch where ch.contenu_le is not null and ch.contenu_ok is null),
      -- Les pièces scellées après la dernière relecture de leur chaîne (une chaîne jamais relue se compte à part) : la
      -- suivante les prendra.
      'enAttente', (select coalesce(sum(ch.rang - ch.contenu_jusqua), 0) from socle.chaine ch
                     where ch.contenu_le is not null and ch.rang > coalesce(ch.contenu_jusqua, 0))),
    'demande', (select jsonb_build_object('id', d.id, 'demandeeLe', d.demandee_le, 'par', u.nom, 'toutes', d.entreprise is null,
                  'entreprise', case when v_role = 'direction' and d.entreprise is not null then
                    (select jsonb_build_object('id', e.id, 'nom', e.raison_sociale, 'numero', plateforme.numero_texte(e.id)) from socle.entreprise e where e.id = d.entreprise) end,
                  'total', d.total, 'faites', d.faites, 'pieces', d.pieces, 'cassees', d.cassees, 'commencee', d.pris_le is not null,
                  'nouvelleLe', d.pris_le, 'finieLe', d.finie_le)
                  from plateforme.relecture_demandee d join socle.utilisateur u on u.id = d.demandee_par
                 where d.finie_le is null or d.finie_le >= p_maintenant - interval '7 days'
                 order by d.finie_le is null desc, d.demandee_le desc, d.id desc limit 1),
    -- L'incident ouvert sur la fiche « une chaîne cassée » (la console le relie à la chaîne), s'il y en a un.
    'incident', (select jsonb_build_object('id', i.id, 'annee', i.annee, 'numero', i.numero) from plateforme.service_incident i
                  where i.clos_le is null and i.fiche = 'empreinte' order by i.ouvert_le desc limit 1));
end $$;

-- Ce que la veille lit (0115 redite) : une chaîne cassée par ses liens ou par son contenu ; la dernière relecture, de l'une
-- ou de l'autre.
create or replace function plateforme.veille_lire(p_maintenant timestamptz, p_minutes int) returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select jsonb_build_object(
    'sourdines', (select coalesce(jsonb_agg(jsonb_build_object('regle', s.regle, 'debut', s.debut, 'fin', s.fin) order by s.debut), '[]'::jsonb)
                    from plateforme.service_sourdine s where s.levee_le is null and s.debut <= p_maintenant and s.fin > p_maintenant),
    'demandes', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'sorte', d.sorte) order by d.le), '[]'::jsonb)
                   from plateforme.service_demande d where d.faite_le is null),
    'minutes', (select coalesce(jsonb_agg(jsonb_build_array(m.minute, m.n, m.pannes, m.lecture) order by m.minute), '[]'::jsonb) from (
                  select minute, sum(n)::int n, sum(pannes)::int pannes, plateforme.somme_seaux(seaux) filter (where sorte = 'lecture') lecture
                    from plateforme.service_minute
                   where minute >= date_trunc('minute', p_maintenant) - make_interval(mins => least(greatest(p_minutes, 1), 60))
                     and minute < date_trunc('minute', p_maintenant)
                   group by minute) m),
    'chaines', jsonb_build_object('cassees', (select count(*) from socle.chaine ch where ch.controle_ok = false or ch.contenu_ok = false),
                                  'dernierLe', (select max(r.le) from plateforme.releve_chaines r)),
    'annonce', jsonb_build_object(
      'incident', (select jsonb_build_object('gravite', i.gravite, 'texte', i.public, 'le', i.public_le, 'depuis', i.ouvert_le)
                     from plateforme.service_incident i where i.clos_le is null and i.public is not null
                    order by plateforme.rang_gravite(i.gravite) desc, i.public_le desc limit 1),
      'maintenance', (select jsonb_build_object('titre', m.titre, 'texte', m.texte, 'debut', m.debut, 'fin', m.fin)
                        from plateforme.service_maintenance m
                       where m.annulee_le is null and m.fin > p_maintenant and m.debut <= p_maintenant + interval '48 hours'
                       order by m.debut limit 1)));
$$;

-- ── Les droits ───────────────────────────────────────────────────────────────────────────────────────────────────────
revoke execute on function plateforme.exiger_le_serveur(), plateforme.contenus_a_relire(integer, uuid),
  plateforme.maillons_a_relire(uuid, text, bigint, bigint, integer), plateforme.pieces_a_relire(uuid, uuid[]), plateforme.lignes_a_relire(uuid, uuid[]),
  plateforme.relire_liens(uuid, text, timestamptz), plateforme.noter_contenu(uuid, text, timestamptz, boolean, bigint, text, bigint), plateforme.noter_releve_contenus(timestamptz, integer, bigint, integer),
  plateforme.noter_releve_liens(timestamptz, integer, bigint, integer), plateforme.console_demander_relecture(text, text, timestamptz), plateforme.relecture_prendre(timestamptz),
  plateforme.relecture_avance(uuid, integer, integer, bigint, integer, boolean, timestamptz) from public;
grant execute on function plateforme.contenus_a_relire(integer, uuid),
  plateforme.maillons_a_relire(uuid, text, bigint, bigint, integer), plateforme.pieces_a_relire(uuid, uuid[]), plateforme.lignes_a_relire(uuid, uuid[]),
  plateforme.relire_liens(uuid, text, timestamptz), plateforme.noter_contenu(uuid, text, timestamptz, boolean, bigint, text, bigint), plateforme.noter_releve_contenus(timestamptz, integer, bigint, integer),
  plateforme.noter_releve_liens(timestamptz, integer, bigint, integer), plateforme.console_demander_relecture(text, text, timestamptz), plateforme.relecture_prendre(timestamptz),
  plateforme.relecture_avance(uuid, integer, integer, bigint, integer, boolean, timestamptz) to skanfact_app;
