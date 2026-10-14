-- La liste des clients recalée sur sa maquette (docs/console.md C32 ; la maquette Clients).
--
-- 1. Ce que chaque ligne dit en plus, lu en UN passage pour toute la liste (jamais une lecture par ligne) : les pièces
--    émises du mois en cours (la colonne « Usage » de la maquette, au jour de l'entreprise, comme les pièces émises de sa
--    fiche), les jours ajoutés à son essai (« prolongé de 14 jours »), et ses factures d'abonnement pas encore payées,
--    lues par la fonction de sa fiche (plateforme.console_factures_abonnement) : « 47,410 DT à payer d'ici le 13/10 ».
--    Des comptes et des montants de SkanFact, jamais le contenu d'un dossier.
create function plateforme.console_clients_en_plus(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  if p_jour is null then perform socle.refus('le jour de la liste manque'); end if;
  return (select coalesce(jsonb_object_agg(e.id, jsonb_build_object(
      'piecesMois', (select count(*) from ventes.piece p where p.entreprise = e.id and p.statut = 'emise'
                       and (p.emise_le at time zone e.fuseau)::date between date_trunc('month', p_jour)::date and p_jour),
      'prolonge', (select coalesce(sum((v.apres ->> 'jours')::int), 0) from plateforme.evenement_abonnement v
                    where v.entreprise = e.id and v.nature = 'essai_prolonge' and jsonb_typeof(v.apres -> 'jours') = 'number'),
      -- La durée de son essai, telle qu'il a commencé (« essai, 30 jours ») : le jour de l'événement qui l'ouvre, à la
      -- fin qu'il fixait — jamais recalculée d'une règle d'aujourd'hui.
      'essaiJours', (select (v.apres ->> 'essaiJusquAu')::date - (v.le at time zone e.fuseau)::date from plateforme.evenement_abonnement v
                      where v.entreprise = e.id and v.nature = 'essai_commence' and v.apres ->> 'essaiJusquAu' ~ '^\d{4}-\d{2}-\d{2}$'
                      order by v.le limit 1),
      -- Déjà prolongé une fois : la même question que sa fiche (le support ne prolonge qu'une fois).
      'prolongeUneFois', exists (select 1 from plateforme.evenement_abonnement v where v.entreprise = e.id and v.nature = 'essai_prolonge'),
      'factures', case when exists (select 1 from plateforme.facture_abonnement f where f.entreprise = e.id and f.payee_le is null)
                       then plateforme.console_factures_abonnement(e.id) else '[]'::jsonb end)), '{}'::jsonb)
    from socle.entreprise e
   where not e.essai);
end $$;

revoke execute on function plateforme.console_clients_en_plus(date) from public;
grant execute on function plateforme.console_clients_en_plus(date) to skanfact_app;

-- 2. Exporter la sélection (« Exporter la sélection ») :
-- des noms d'entreprises, de propriétaires, leurs adresses — des données de personnes, qui quittent la console pour un
-- fichier. La direction seule ; chaque export s'écrit au journal, avec son motif, le nombre de lignes et les filtres de
-- la sélection (jamais les lignes elles-mêmes). La base ne fabrique pas le fichier : elle note le geste, le serveur
-- rend la sélection qu'il vient de compter.

create function plateforme.console_noter_export(p_quoi text, p_lignes integer, p_filtres jsonb, p_motif text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_id uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  if p_quoi is distinct from 'clients' then perform socle.refus('cet export n''existe pas'); end if;
  if p_lignes is null or p_lignes < 0 then perform socle.refus('cet export n''existe pas'); end if;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'clients.exporte', btrim(p_motif), null,
            jsonb_build_object('lignes', p_lignes, 'filtres', coalesce(p_filtres, '{}'::jsonb)))
    returning id into v_id;
  return v_id;
end $$;

revoke execute on function plateforme.console_noter_export(text, integer, jsonb, text) from public;
grant execute on function plateforme.console_noter_export(text, integer, jsonb, text) to skanfact_app;

-- 3. Le numéro d'un client (la maquette : « E-0088 », « G-01 », « C-0005 ») : celui qu'on se dit au téléphone, qu'on
--    cherche et qu'on recopie. Un par entreprise (E), par groupe de la console (G), par cabinet (C) ; donné à la
--    création, jamais repris ni réutilisé ; les déjà inscrits le reçoivent dans l'ordre de leur inscription. Une
--    entreprise d'exemple n'en a pas. C'est un repère de SkanFact, pas une donnée de l'entreprise : il n'entre pas dans
--    son export, et une entreprise remise ailleurs y reçoit le sien.
create table plateforme.numero_client (
  objet uuid primary key,
  sorte text not null check (sorte in ('E', 'G', 'C')),
  numero integer not null check (numero > 0),
  donne_le timestamptz not null default now(),
  unique (sorte, numero)
);
alter table plateforme.numero_client enable row level security;
alter table plateforme.numero_client force row level security;
create sequence plateforme.numero_client_e;
create sequence plateforme.numero_client_g;
create sequence plateforme.numero_client_c;

create function plateforme.numeroter_client(p_objet uuid, p_sorte text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, plateforme as $$
begin
  if exists (select 1 from plateforme.numero_client n where n.objet = p_objet) then return; end if;
  insert into plateforme.numero_client (objet, sorte, numero)
    values (p_objet, p_sorte, nextval(case p_sorte when 'E' then 'plateforme.numero_client_e' when 'G' then 'plateforme.numero_client_g'
                                                  else 'plateforme.numero_client_c' end::regclass));
end $$;
revoke execute on function plateforme.numeroter_client(uuid, text) from public;

-- « E-0088 » : quatre chiffres (deux pour un groupe), plus s'il le faut ; rien pour ce qui n'en a pas.
create function plateforme.numero_texte(p_objet uuid) returns text
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select n.sorte || '-' || lpad(n.numero::text, case n.sorte when 'G' then 2 else 4 end, '0') from plateforme.numero_client n where n.objet = p_objet
$$;
revoke execute on function plateforme.numero_texte(uuid) from public;
grant execute on function plateforme.numero_texte(uuid) to skanfact_app;

create function plateforme.numeroter_a_la_creation() returns trigger
language plpgsql volatile security definer set search_path = pg_catalog, plateforme as $$
begin
  perform plateforme.numeroter_client(new.id, tg_argv[0]);
  return new;
end $$;
create trigger numeroter_entreprise after insert on socle.entreprise for each row when (not new.essai)
  execute function plateforme.numeroter_a_la_creation('E');
create trigger numeroter_cabinet after insert on socle.organisation for each row when (new.type = 'cabinet')
  execute function plateforme.numeroter_a_la_creation('C');
create trigger numeroter_groupe after insert on plateforme.groupe for each row
  execute function plateforme.numeroter_a_la_creation('G');
-- Les déjà inscrits, dans l'ordre de leur inscription.
select plateforme.numeroter_client(e.id, 'E') from (select id from socle.entreprise where not essai order by cree_le, id) e;
select plateforme.numeroter_client(o.id, 'C') from (select id from socle.organisation where type = 'cabinet' order by cree_le, id) o;
select plateforme.numeroter_client(g.id, 'G') from (select id from plateforme.groupe order by le, id) g;

-- 4. La ville d'une entreprise (la maquette : « Entreprise · Sousse · E-0140 ») : celle que sa propriétaire donne en la
--    créant (la changer ensuite, depuis Paramètres, reste à faire : docs/console.md, C33) ; rien de deviné dans une
--    adresse écrite en texte libre. Facultative : sans elle, rien ne s'affiche. Une donnée de l'entreprise (elle part
--    avec son export).
alter table socle.entreprise add column ville text
  check (ville is null or (length(btrim(ville)) between 2 and 60 and ville !~ '[<>]'));
create function socle.poser_ville(p_entreprise uuid, p_ville text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v text := nullif(btrim(coalesce(p_ville, '')), '');
begin
  if not exists (select 1 from socle.membre m where m.entreprise = p_entreprise and m.utilisateur = socle.moi() and m.actif
                  and m.roles && array['proprietaire', 'administrateur']) then
    perform socle.refus('seuls la propriétaire et un administrateur disent où est l''entreprise');
  end if;
  if v is not null and (length(v) not between 2 and 60 or v ~ '[<>]') then
    perform socle.refus('une ville s''écrit en deux à soixante caractères, sans balise');
  end if;
  update socle.entreprise set ville = v where id = p_entreprise;
end $$;
revoke execute on function socle.poser_ville(uuid, text) from public;
grant execute on function socle.poser_ville(uuid, text) to skanfact_app;

-- 5. Nos échanges avec un client (la maquette Fiche, « Nos échanges ») : un appel se note — comment il s'est passé, ce
--    qui s'est dit en deux lignes —, et se range sur sa fiche pour que toute l'équipe le lise avant de rappeler. Il ne
--    part jamais chez le client. Une note ne se modifie pas : on en écrit une autre.
create table plateforme.note_appel (
  id uuid primary key default socle.uuidv7(),
  entreprise uuid not null references socle.entreprise(id),
  resultat text not null check (resultat in ('parle', 'sans_reponse', 'message_laisse')),
  resume text check (resume is null or length(btrim(resume)) between 3 and 1000),
  qui uuid not null references socle.utilisateur(id),
  le timestamptz not null default now(),
  check (resultat <> 'parle' or resume is not null)
);
create index note_appel_entreprise on plateforme.note_appel (entreprise, le desc);
alter table plateforme.note_appel enable row level security;
alter table plateforme.note_appel force row level security;
create function plateforme.note_appel_intouchable() returns trigger
language plpgsql as $$
begin
  raise exception 'une note d''appel ne se modifie pas et ne s''efface pas : on en écrit une autre';
end $$;
create trigger note_appel_intouchable before update or delete on plateforme.note_appel
  for each row execute function plateforme.note_appel_intouchable();

create function plateforme.console_noter_appel(p_entreprise uuid, p_resultat text, p_resume text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  v_resume text := nullif(btrim(coalesce(p_resume, '')), '');
  v_id uuid;
begin
  if p_resultat is null or p_resultat not in ('parle', 'sans_reponse', 'message_laisse') then
    perform socle.refus('un appel s''est passé ainsi : on s''est parlé, pas de réponse, ou message laissé');
  end if;
  if p_resultat = 'parle' and (v_resume is null or length(v_resume) < 3) then
    perform socle.refus('un appel où l''on s''est parlé dit en deux lignes ce qui s''est dit');
  end if;
  if v_resume is not null and length(v_resume) > 1000 then perform socle.refus('une note d''appel tient en mille caractères au plus'); end if;
  if not exists (select 1 from socle.entreprise e where e.id = p_entreprise and not e.essai) then
    perform socle.refus('cette entreprise n''existe pas, ou c''est une entreprise d''exemple');
  end if;
  insert into plateforme.note_appel (entreprise, resultat, resume, qui, le) values (p_entreprise, p_resultat, v_resume, socle.moi(), p_maintenant)
    returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'clients.appel', p_entreprise,
            -- Le journal dit comment l'appel s'est passé ; ce qui s'est dit reste sur la note.
            case p_resultat when 'parle' then 'appel : on s''est parlé' when 'sans_reponse' then 'appel : pas de réponse' else 'appel : message laissé' end,
            null, jsonb_build_object('note', v_id, 'resultat', p_resultat));
  return v_id;
end $$;
revoke execute on function plateforme.console_noter_appel(uuid, text, text, timestamptz) from public;
grant execute on function plateforme.console_noter_appel(uuid, text, text, timestamptz) to skanfact_app;

-- 6. Écrire au contact (la maquette : « Écrire… ») : le message ne part jamais dans un e-mail (une alerte par e-mail ne
--    porte pas de contenu). Il s'ouvre dans l'application du client comme une demande au support que SkanFact commence
--    (son canal : « skanfact »), à la personne choisie de l'équipe de l'entreprise ; l'alerte des réponses du support la
--    prévient par e-mail, sans le texte ; sa réponse revient dans le Support et se range sur la fiche.
alter table plateforme.demande_support drop constraint demande_support_canal_check;
alter table plateforme.demande_support add constraint demande_support_canal_check check (canal in ('application', 'email', 'whatsapp', 'telephone', 'skanfact'));
create function plateforme.console_ecrire_au_contact(p_entreprise uuid, p_destinataire uuid, p_sujet text, p_texte text, p_maintenant timestamptz)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  v_id uuid; v_sujet text := btrim(coalesce(p_sujet, '')); v_texte text := btrim(coalesce(p_texte, ''));
begin
  if length(v_sujet) < 3 or length(v_sujet) > 140 then perform socle.refus('l''objet d''un message : de trois à cent quarante caractères'); end if;
  if v_sujet ~ '[<>]' then perform socle.refus('l''objet d''un message s''écrit sans balise'); end if;
  if length(v_texte) < 3 or length(v_texte) > 4000 then perform socle.refus('un message dit quelque chose : de trois à quatre mille caractères'); end if;
  if not exists (select 1 from socle.entreprise e where e.id = p_entreprise and not e.essai) then
    perform socle.refus('cette entreprise n''existe pas, ou c''est une entreprise d''exemple');
  end if;
  if not exists (select 1 from socle.membre m where m.utilisateur = p_destinataire and m.entreprise = p_entreprise and m.actif) then
    perform socle.refus('cette personne n''est pas dans l''équipe de cette entreprise : un message va à une personne qui le lira');
  end if;
  insert into plateforme.demande_support (entreprise, demandeur, canal, sujet, notee_par, suivie_par, ouverte_le)
    values (p_entreprise, p_destinataire, 'skanfact', v_sujet, socle.moi(), socle.moi(), p_maintenant)
    returning id into v_id;
  insert into plateforme.message_support (demande, cote, auteur, texte, ecrit_le)
    values (v_id, 'equipe', socle.moi(), v_texte, p_maintenant);
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'clients.ecrit', p_entreprise, v_sujet, null,
            jsonb_build_object('demande', v_id, 'numero', (select numero from plateforme.demande_support where id = v_id)));
  return v_id;
end $$;
revoke execute on function plateforme.console_ecrire_au_contact(uuid, uuid, text, text, timestamptz) from public;
grant execute on function plateforme.console_ecrire_au_contact(uuid, uuid, text, text, timestamptz) to skanfact_app;

-- 7. Ce que la fiche et la liste lisent de plus d'un client : son numéro, sa ville, le téléphone vérifié de sa
--    propriétaire (celui des codes de connexion ; « À qui parler »), ses notes d'appel, et ses groupes de la console avec
--    leur numéro. En un passage pour toute la liste.
create function plateforme.console_identites(p_jour date) returns jsonb
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
      from socle.entreprise e where not e.essai),
    'cabinets', (select coalesce(jsonb_object_agg(o.id, plateforme.numero_texte(o.id)), '{}'::jsonb) from socle.organisation o where o.type = 'cabinet'),
    -- Les groupes de la console et leurs sociétés ce jour-là (0106 : `depuis <= J < retire_le`) : une ligne de la liste.
    'groupes', (select coalesce(jsonb_object_agg(g.id, jsonb_build_object('numero', plateforme.numero_texte(g.id), 'nom', g.nom,
        'membres', (select coalesce(jsonb_agg(m.entreprise order by m.depuis, m.entreprise), '[]'::jsonb) from plateforme.groupe_membre m
                     where m.groupe = g.id and m.depuis <= p_jour and (m.retire_le is null or p_jour < m.retire_le)))), '{}'::jsonb)
      from plateforme.groupe g));
end $$;
revoke execute on function plateforme.console_identites(date) from public;
grant execute on function plateforme.console_identites(date) to skanfact_app;

-- Les notes d'appel d'une entreprise, la plus récente d'abord (sa fiche, « Nos échanges »).
create function plateforme.console_notes_appel(p_entreprise uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'le', n.le, 'resultat', n.resultat, 'resume', n.resume,
      'qui', (select u.nom from socle.utilisateur u where u.id = n.qui)) order by n.le desc), '[]'::jsonb)
    from plateforme.note_appel n where n.entreprise = p_entreprise);
end $$;
revoke execute on function plateforme.console_notes_appel(uuid) from public;
grant execute on function plateforme.console_notes_appel(uuid) to skanfact_app;
