-- 0095 — Le support, première partie : les demandes (Support S1 ; docs/support.md ; skanfact docs/cadrage/10-console.md
-- § 2.7, 01 § 18 « ticket_support », 03 § 5). Une demande appartient à une entreprise et à la personne qui la pose ; elle
-- se pose depuis l'application (« Écrire au support »), ou se note par l'équipe SkanFact quand elle est arrivée ailleurs
-- (un e-mail, un message WhatsApp, un appel). L'équipe y répond depuis la console ; la réponse se lit dans l'application,
-- et un e-mail SANS CONTENU prévient la personne (comme l'alerte de la messagerie, 0078 : l'adresse, un objet et un texte
-- fixes, l'adresse de l'application ; ni la réponse, ni son auteur, ni l'entreprise).
--
-- Ce que chacun lit :
--   - la personne : SES demandes, dans cette entreprise (jamais celles d'un collègue : on élargit un droit en le décidant,
--     03 D4) ; les membres de l'équipe SkanFact y sont nommés par leur prénom ;
--   - la console (la direction, le support) : toutes les demandes, avec le client et la personne (la liste fermée du cadrage
--     10 § 4 : « demandes de support et nos réponses ») ; la technique, rien.
-- Ce que chacun fait : la personne écrit, relit, répond, dit que c'est réglé (une demande close se rouvre quand elle
-- réécrit) ; l'équipe répond, note une demande reçue ailleurs, clôt et rouvre avec un motif. Un message ne se modifie ni ne
-- s'efface : on en écrit un autre. Chaque geste de l'équipe entre au journal de la console, sans le texte des messages.
-- L'accès au dossier d'un client (48 heures, en lecture, accordé par lui) est la seconde partie (S2).

create sequence plateforme.demande_support_numero;

create table plateforme.demande_support (
  id uuid primary key default socle.uuidv7(),
  -- Le numéro qu'on se dit au téléphone (« ta demande S-0214 »).
  numero integer not null unique default nextval('plateforme.demande_support_numero'),
  entreprise uuid not null references socle.entreprise(id),
  -- Qui la pose : une personne de l'entreprise, qui seule la lira dans l'application.
  demandeur uuid not null references socle.utilisateur(id),
  canal text not null check (canal in ('application', 'email', 'whatsapp', 'telephone')),
  sujet text not null check (length(btrim(sujet)) between 3 and 140 and sujet !~ '[<>]'),
  -- Ce qu'une demande écrite dans l'application emporte avec elle : la version de l'application et le NOM de la page où
  -- était la personne (« factures »), jamais un identifiant ni une donnée de l'entreprise.
  version text check (version is null or version ~ '^[0-9A-Za-z.+-]{1,40}$'),
  page text check (page is null or page ~ '^[a-z][a-z0-9_-]{0,39}$'),
  -- Reçue ailleurs que dans l'application : le membre de l'équipe qui l'a notée.
  notee_par uuid references socle.utilisateur(id),
  ouverte_le timestamptz not null,
  -- Qui s'en occupe : le premier membre de l'équipe qui y répond.
  suivie_par uuid references socle.utilisateur(id),
  -- Close par la personne (« c'est réglé ») ou par l'équipe (avec son motif) ; elle se rouvre quand la personne réécrit.
  close_le timestamptz,
  close_cote text check (close_cote in ('client', 'equipe')),
  close_par uuid references socle.utilisateur(id),
  close_motif text,
  -- Ce que la personne a lu, jusqu'à quel instant (la pastille de l'application, et l'alerte par e-mail).
  lu_le timestamptz,
  -- L'alerte par e-mail de la dernière réponse : partie à cet instant (une par réponse non lue, jamais deux).
  alerte_le timestamptz,
  check ((canal = 'application') = (notee_par is null)),
  check (canal = 'application' or (version is null and page is null)),
  check ((close_le is null) = (close_cote is null) and (close_le is null) = (close_par is null)),
  check (close_cote = 'equipe' or close_motif is null)
);
alter table plateforme.demande_support enable row level security;
alter table plateforme.demande_support force row level security;
create index on plateforme.demande_support (entreprise, ouverte_le desc);
create index on plateforme.demande_support (demandeur, entreprise);
create index demande_support_ouvertes on plateforme.demande_support (ouverte_le) where close_le is null;

create table plateforme.message_support (
  id uuid primary key default socle.uuidv7(),
  demande uuid not null references plateforme.demande_support(id),
  cote text not null check (cote in ('client', 'equipe')),
  -- Qui parle : le demandeur (côté client), ou le membre de l'équipe qui répond.
  auteur uuid not null references socle.utilisateur(id),
  -- Côté client, les mots de la personne notés par un membre de l'équipe (reçus par e-mail, WhatsApp ou téléphone).
  note_par uuid references socle.utilisateur(id),
  texte text not null check (length(btrim(texte)) between 1 and 4000),
  -- Une réponse peut citer un article de l'Aide de l'application : son identifiant, jamais son texte (une seule source).
  article text check (article is null or article ~ '^[a-z][a-z0-9_-]{0,39}$'),
  ecrit_le timestamptz not null,
  check (cote = 'client' or note_par is null),
  check (cote = 'equipe' or article is null)
);
alter table plateforme.message_support enable row level security;
alter table plateforme.message_support force row level security;
create index on plateforme.message_support (demande, ecrit_le, id);

create function plateforme.message_support_intouchable() returns trigger
language plpgsql as $$
begin
  raise exception 'un message du support ne se modifie pas et ne s''efface pas : on en écrit un autre' using errcode = '42501';
end $$;
create trigger message_support_intouchable before update or delete on plateforme.message_support
  for each row execute function plateforme.message_support_intouchable();

-- ── La personne, dans son application ────────────────────────────────────────────────────────────────────────────────
-- Une personne de l'entreprise (un rôle au moins), jamais une clé de l'API : le support se tient entre personnes.
create function plateforme.support_exiger(p_entreprise uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is null or socle.ma_cle() is not null or cardinality(socle.mes_roles(p_entreprise)) = 0 then
    perform socle.refus('le support se joint par une personne de l''entreprise');
  end if;
end $$;

-- Une de MES demandes, dans CETTE entreprise (celle de la route), où je suis encore.
create function plateforme.support_ma_demande(p_entreprise uuid, p_demande uuid) returns plateforme.demande_support
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v plateforme.demande_support;
begin
  select * into v from plateforme.demande_support d where d.id = p_demande and d.demandeur = socle.moi() and d.entreprise = p_entreprise;
  if not found then perform socle.refus('cette demande n''existe pas, ou n''est pas la tienne'); end if;
  perform plateforme.support_exiger(v.entreprise);
  return v;
end $$;

-- Écrire au support : la demande et son premier message. Le même sujet et le même texte, une seconde fois dans les cinq
-- minutes (un double clic, un envoi qui a semblé échouer), rendent la demande déjà posée au lieu d'en ouvrir une seconde.
create function plateforme.support_ecrire(p_entreprise uuid, p_sujet text, p_texte text, p_version text, p_page text, p_maintenant timestamptz)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_id uuid; v_sujet text := btrim(coalesce(p_sujet, '')); v_texte text := btrim(coalesce(p_texte, ''));
begin
  perform plateforme.support_exiger(p_entreprise);
  if length(v_sujet) < 3 or length(v_sujet) > 140 then perform socle.refus('le sujet d''une demande : de trois à cent quarante caractères'); end if;
  if v_sujet ~ '[<>]' then perform socle.refus('le sujet d''une demande s''écrit sans balise'); end if;
  if length(v_texte) < 3 or length(v_texte) > 4000 then perform socle.refus('une demande dit ce qui se passe : de trois à quatre mille caractères'); end if;
  perform pg_advisory_xact_lock(hashtext('plateforme.demande_support'), hashtext(socle.moi()::text));
  select d.id into v_id from plateforme.demande_support d
    join plateforme.message_support m on m.demande = d.id and m.cote = 'client'
   where d.entreprise = p_entreprise and d.demandeur = socle.moi() and d.sujet = v_sujet and m.texte = v_texte
     and d.ouverte_le > p_maintenant - interval '5 minutes'
   limit 1;
  if v_id is not null then return v_id; end if;
  insert into plateforme.demande_support (entreprise, demandeur, canal, sujet, version, page, ouverte_le)
    values (p_entreprise, socle.moi(), 'application', v_sujet,
            case when coalesce(p_version, '') ~ '^[0-9A-Za-z.+-]{1,40}$' then p_version end,
            case when coalesce(p_page, '') ~ '^[a-z][a-z0-9_-]{0,39}$' then p_page end, p_maintenant)
    returning id into v_id;
  insert into plateforme.message_support (demande, cote, auteur, texte, ecrit_le) values (v_id, 'client', socle.moi(), v_texte, p_maintenant);
  return v_id;
end $$;

-- Les messages d'une demande, comme la personne les lit : l'équipe par son prénom.
create function plateforme.support_messages_pour_client(p_demande uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'cote', m.cote, 'texte', m.texte, 'article', m.article, 'le', m.ecrit_le,
           'nom', case m.cote when 'equipe' then split_part(btrim(u.nom), ' ', 1) else u.nom end, 'note', m.note_par is not null)
           order by m.ecrit_le, m.id), '[]'::jsonb)
    from plateforme.message_support m join socle.utilisateur u on u.id = m.auteur
   where m.demande = p_demande
$$;

-- Mes demandes dans cette entreprise, les ouvertes d'abord, la plus récente en haut ; chacune avec ses messages, et ce
-- que je n'ai pas encore lu.
create function plateforme.support_mes_demandes(p_entreprise uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.support_exiger(p_entreprise);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'numero', d.numero, 'sujet', d.sujet, 'canal', d.canal,
             'ouverteLe', d.ouverte_le, 'closeLe', d.close_le, 'closeCote', d.close_cote,
             'nonLu', exists (select 1 from plateforme.message_support m where m.demande = d.id and m.cote = 'equipe'
                               and m.ecrit_le > coalesce(d.lu_le, '-infinity')),
             'dernierCote', (select m.cote from plateforme.message_support m where m.demande = d.id order by m.ecrit_le desc, m.id desc limit 1),
             'messages', plateforme.support_messages_pour_client(d.id))
             order by d.close_le is null desc, d.ouverte_le desc, d.id desc), '[]'::jsonb)
            from plateforme.demande_support d
           where d.entreprise = p_entreprise and d.demandeur = socle.moi());
end $$;

-- Réécrire dans une de mes demandes : elle se rouvre si elle était close.
create function plateforme.support_repondre_client(p_entreprise uuid, p_demande uuid, p_texte text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v plateforme.demande_support := plateforme.support_ma_demande(p_entreprise, p_demande); v_texte text := btrim(coalesce(p_texte, ''));
begin
  if length(v_texte) < 1 or length(v_texte) > 4000 then perform socle.refus('un message au support : de un à quatre mille caractères'); end if;
  insert into plateforme.message_support (demande, cote, auteur, texte, ecrit_le) values (v.id, 'client', socle.moi(), v_texte, p_maintenant);
  update plateforme.demande_support set close_le = null, close_cote = null, close_par = null, close_motif = null,
         lu_le = greatest(coalesce(lu_le, '-infinity'), p_maintenant)
   where id = v.id;
end $$;

-- J'ai lu ce que l'équipe a répondu (la page ouverte le note) : la pastille s'éteint, aucune alerte ne part plus.
create function plateforme.support_lu(p_entreprise uuid, p_demande uuid, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v plateforme.demande_support := plateforme.support_ma_demande(p_entreprise, p_demande);
begin
  update plateforme.demande_support set lu_le = greatest(coalesce(lu_le, '-infinity'), p_maintenant) where id = v.id;
end $$;

-- « C'est réglé » : la personne clôt sa demande ; elle la rouvre en réécrivant.
create function plateforme.support_reglee(p_entreprise uuid, p_demande uuid, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v plateforme.demande_support := plateforme.support_ma_demande(p_entreprise, p_demande);
begin
  if v.close_le is not null then perform socle.refus('cette demande est déjà close'); end if;
  update plateforme.demande_support set close_le = p_maintenant, close_cote = 'client', close_par = socle.moi(), close_motif = null,
         lu_le = greatest(coalesce(lu_le, '-infinity'), p_maintenant)
   where id = v.id;
end $$;

-- Combien de mes demandes ont une réponse que je n'ai pas lue, dans cette entreprise : la pastille de l'application.
create function plateforme.support_a_lire(p_entreprise uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.support_exiger(p_entreprise);
  return (select jsonb_build_object('demandes', count(*) filter (where d.close_le is null),
            'aLire', coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'numero', d.numero, 'sujet', d.sujet) order by d.ouverte_le desc)
                                filter (where exists (select 1 from plateforme.message_support m where m.demande = d.id and m.cote = 'equipe'
                                                        and m.ecrit_le > coalesce(d.lu_le, '-infinity'))), '[]'::jsonb))
            from plateforme.demande_support d where d.entreprise = p_entreprise and d.demandeur = socle.moi());
end $$;

-- ── La console ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- Une ligne de la liste : la demande, son client, la personne, où en est la conversation. Le texte des messages n'y est
-- pas : il se lit en ouvrant la demande.
create function plateforme.support_ligne(d plateforme.demande_support) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object('id', d.id, 'numero', d.numero, 'sujet', d.sujet, 'canal', d.canal, 'ouverteLe', d.ouverte_le,
    'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale, 'essai', e.essai),
    'demandeur', jsonb_build_object('id', p.id, 'nom', p.nom),
    'noteePar', (select u.nom from socle.utilisateur u where u.id = d.notee_par),
    'suiviePar', (select u.nom from socle.utilisateur u where u.id = d.suivie_par),
    'dernierClientLe', (select max(m.ecrit_le) from plateforme.message_support m where m.demande = d.id and m.cote = 'client'),
    'dernierEquipeLe', (select max(m.ecrit_le) from plateforme.message_support m where m.demande = d.id and m.cote = 'equipe'),
    'dernierCote', (select m.cote from plateforme.message_support m where m.demande = d.id order by m.ecrit_le desc, m.id desc limit 1),
    'messages', (select count(*) from plateforme.message_support m where m.demande = d.id),
    'close', case when d.close_le is null then null else jsonb_build_object('le', d.close_le, 'cote', d.close_cote,
               'par', (select u.nom from socle.utilisateur u where u.id = d.close_par), 'motif', d.close_motif) end)
    from socle.entreprise e, socle.utilisateur p
   where e.id = d.entreprise and p.id = d.demandeur
$$;

-- La liste : toutes les demandes ouvertes, puis les cent dernières closes ; celles d'une seule entreprise (sa fiche) si on
-- la nomme. Et la demande ouverte à l'écran, avec ses messages et de quoi joindre la personne.
create function plateforme.console_support(p_entreprise uuid, p_demande uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return jsonb_build_object(
    'ouvertes', (select coalesce(jsonb_agg(plateforme.support_ligne(d) order by d.ouverte_le, d.id), '[]'::jsonb)
                   from plateforme.demande_support d where d.close_le is null and (p_entreprise is null or d.entreprise = p_entreprise)),
    'closes', (select coalesce(jsonb_agg(plateforme.support_ligne(d) order by d.close_le desc, d.id desc), '[]'::jsonb)
                 from plateforme.demande_support d
                where d.id in (select c.id from plateforme.demande_support c where c.close_le is not null and (p_entreprise is null or c.entreprise = p_entreprise)
                                order by c.close_le desc, c.id desc limit 100)),
    'demande', (select jsonb_build_object('ligne', plateforme.support_ligne(d), 'version', d.version, 'page', d.page,
                  -- La personne, comme la liste fermée la dit (10 § 4) : son nom, son adresse, ses rôles ; jamais son téléphone.
                  'personne', jsonb_build_object('nom', p.nom, 'email', p.email,
                    'roles', (select coalesce(to_jsonb(m.roles), '[]'::jsonb) from socle.membre m
                               where m.utilisateur = p.id and m.entreprise = d.entreprise order by m.actif desc limit 1)),
                  'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'cote', m.cote, 'texte', m.texte, 'article', m.article,
                                 'le', m.ecrit_le, 'nom', u.nom, 'notePar', (select n.nom from socle.utilisateur n where n.id = m.note_par))
                                 order by m.ecrit_le, m.id), '[]'::jsonb)
                                 from plateforme.message_support m join socle.utilisateur u on u.id = m.auteur where m.demande = d.id))
                  from plateforme.demande_support d join socle.utilisateur p on p.id = d.demandeur where d.id = p_demande));
end $$;

-- Les personnes d'une entreprise à qui une demande peut se rattacher (noter une demande reçue ailleurs) : ses membres
-- actifs, avec leurs rôles.
create function plateforme.console_support_personnes(p_entreprise uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nom', u.nom, 'roles', m.roles)
            order by ('proprietaire' = any(m.roles)) desc, u.nom, u.id), '[]'::jsonb)
            from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
           where m.entreprise = p_entreprise and m.actif);
end $$;

-- Noter une demande reçue ailleurs (un e-mail, un message WhatsApp, un appel), au nom d'une personne de l'entreprise : elle
-- la lira dans son application, avec la réponse.
create function plateforme.console_noter_demande(p_entreprise uuid, p_demandeur uuid, p_canal text, p_sujet text, p_texte text, p_maintenant timestamptz)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  v_id uuid; v_sujet text := btrim(coalesce(p_sujet, '')); v_texte text := btrim(coalesce(p_texte, ''));
begin
  if p_canal is null or p_canal not in ('email', 'whatsapp', 'telephone') then perform socle.refus('une demande notée a été reçue par e-mail, par WhatsApp ou au téléphone'); end if;
  if length(v_sujet) < 3 or length(v_sujet) > 140 then perform socle.refus('le sujet d''une demande : de trois à cent quarante caractères'); end if;
  if v_sujet ~ '[<>]' then perform socle.refus('le sujet d''une demande s''écrit sans balise'); end if;
  if length(v_texte) < 3 or length(v_texte) > 4000 then perform socle.refus('une demande notée dit ce que la personne a demandé : de trois à quatre mille caractères'); end if;
  if not exists (select 1 from socle.membre m where m.utilisateur = p_demandeur and m.entreprise = p_entreprise and m.actif) then
    perform socle.refus('cette personne n''est pas dans l''équipe de cette entreprise : une demande se range au nom d''une personne qui la lira');
  end if;
  insert into plateforme.demande_support (entreprise, demandeur, canal, sujet, notee_par, ouverte_le)
    values (p_entreprise, p_demandeur, p_canal, v_sujet, socle.moi(), p_maintenant)
    returning id into v_id;
  insert into plateforme.message_support (demande, cote, auteur, note_par, texte, ecrit_le)
    values (v_id, 'client', p_demandeur, socle.moi(), v_texte, p_maintenant);
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.noter', p_entreprise, v_sujet, null,
            jsonb_build_object('demande', v_id, 'numero', (select numero from plateforme.demande_support where id = v_id), 'canal', p_canal));
  return v_id;
end $$;

-- Répondre : le premier qui répond suit la demande. Une demande close ne reçoit plus de réponse : on la rouvre d'abord.
create function plateforme.console_repondre_demande(p_demande uuid, p_texte text, p_article text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  v plateforme.demande_support; v_id uuid; v_texte text := btrim(coalesce(p_texte, ''));
begin
  if length(v_texte) < 3 or length(v_texte) > 4000 then perform socle.refus('une réponse : de trois à quatre mille caractères'); end if;
  if p_article is not null and p_article !~ '^[a-z][a-z0-9_-]{0,39}$' then perform socle.refus('cet article de l''Aide n''existe pas'); end if;
  select * into v from plateforme.demande_support where id = p_demande for update;
  if not found then perform socle.refus('cette demande n''existe pas'); end if;
  if v.close_le is not null then perform socle.refus('cette demande est close : rouvre-la pour y répondre'); end if;
  insert into plateforme.message_support (demande, cote, auteur, texte, article, ecrit_le)
    values (p_demande, 'equipe', socle.moi(), v_texte, p_article, p_maintenant)
    returning id into v_id;
  update plateforme.demande_support set suivie_par = coalesce(suivie_par, socle.moi()) where id = p_demande;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.repondre', v.entreprise, v.sujet, null,
            jsonb_build_object('demande', v.id, 'numero', v.numero, 'article', p_article));
  return v_id;
end $$;

create function plateforme.console_clore_demande(p_demande uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']); v plateforme.demande_support;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('clore une demande demande son motif (trois caractères au moins)'); end if;
  select * into v from plateforme.demande_support where id = p_demande for update;
  if not found then perform socle.refus('cette demande n''existe pas'); end if;
  if v.close_le is not null then perform socle.refus('cette demande est déjà close'); end if;
  update plateforme.demande_support set close_le = p_maintenant, close_cote = 'equipe', close_par = socle.moi(), close_motif = btrim(p_motif)
   where id = p_demande;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.clore', v.entreprise, btrim(p_motif), jsonb_build_object('demande', v.id, 'numero', v.numero, 'sujet', v.sujet),
            jsonb_build_object('close', p_maintenant));
end $$;

create function plateforme.console_rouvrir_demande(p_demande uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']); v plateforme.demande_support;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('rouvrir une demande demande son motif (trois caractères au moins)'); end if;
  select * into v from plateforme.demande_support where id = p_demande for update;
  if not found then perform socle.refus('cette demande n''existe pas'); end if;
  if v.close_le is null then perform socle.refus('cette demande est encore ouverte'); end if;
  update plateforme.demande_support set close_le = null, close_cote = null, close_par = null, close_motif = null where id = p_demande;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.rouvrir', v.entreprise, btrim(p_motif),
            jsonb_build_object('demande', v.id, 'numero', v.numero, 'close', v.close_le, 'closeCote', v.close_cote), jsonb_build_object('rouverte', p_maintenant));
end $$;

-- ── L'alerte par e-mail, par le serveur seul ─────────────────────────────────────────────────────────────────────────
-- Les personnes à prévenir : une réponse de l'équipe qu'elles n'ont pas lue depuis `p_delai` (la page ouverte la marque
-- lue dans la minute), et dont l'alerte n'est pas encore partie. Une demande close ne prévient plus. Comme l'alerte de la
-- messagerie (0078) : à une adresse vérifiée seulement (une adresse que personne n'a prouvée ne reçoit rien), à une
-- personne encore membre de l'entreprise (celle qui l'a quittée ne lirait plus la réponse), et pour le serveur seul.
create function plateforme.support_alertes_dues(p_maintenant timestamptz, p_delai interval) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select coalesce(jsonb_agg(jsonb_build_object('demande', d.id, 'utilisateur', u.id, 'email', u.email, 'langue', u.langue)
           order by u.id, d.ouverte_le, d.id), '[]'::jsonb)
    from plateforme.demande_support d
    join socle.utilisateur u on u.id = d.demandeur and u.adresse_verifiee_le is not null
   where socle.moi() is null
     and d.close_le is null
     and exists (select 1 from socle.membre m where m.entreprise = d.entreprise and m.utilisateur = d.demandeur and m.actif
                  and cardinality(m.roles) > 0)
     and exists (select 1 from plateforme.message_support m where m.demande = d.id and m.cote = 'equipe'
                  and m.ecrit_le <= p_maintenant - p_delai
                  and m.ecrit_le > coalesce(d.lu_le, '-infinity')
                  and m.ecrit_le > coalesce(d.alerte_le, '-infinity'))
$$;

create function plateforme.support_alerte_partie(p_demande uuid, p_le timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is not null then perform socle.refus('seul le serveur note une alerte partie'); end if;
  update plateforme.demande_support set alerte_le = p_le where id = p_demande;
end $$;

revoke execute on function plateforme.support_exiger(uuid), plateforme.support_ma_demande(uuid, uuid),
  plateforme.support_ecrire(uuid, text, text, text, text, timestamptz), plateforme.support_messages_pour_client(uuid),
  plateforme.support_mes_demandes(uuid), plateforme.support_repondre_client(uuid, uuid, text, timestamptz), plateforme.support_lu(uuid, uuid, timestamptz),
  plateforme.support_reglee(uuid, uuid, timestamptz), plateforme.support_a_lire(uuid), plateforme.support_ligne(plateforme.demande_support),
  plateforme.console_support(uuid, uuid), plateforme.console_support_personnes(uuid),
  plateforme.console_noter_demande(uuid, uuid, text, text, text, timestamptz), plateforme.console_repondre_demande(uuid, text, text, timestamptz),
  plateforme.console_clore_demande(uuid, text, timestamptz), plateforme.console_rouvrir_demande(uuid, text, timestamptz),
  plateforme.support_alertes_dues(timestamptz, interval), plateforme.support_alerte_partie(uuid, timestamptz) from public;
grant execute on function plateforme.support_ecrire(uuid, text, text, text, text, timestamptz), plateforme.support_mes_demandes(uuid),
  plateforme.support_repondre_client(uuid, uuid, text, timestamptz), plateforme.support_lu(uuid, uuid, timestamptz), plateforme.support_reglee(uuid, uuid, timestamptz),
  plateforme.support_a_lire(uuid), plateforme.console_support(uuid, uuid), plateforme.console_support_personnes(uuid),
  plateforme.console_noter_demande(uuid, uuid, text, text, text, timestamptz), plateforme.console_repondre_demande(uuid, text, text, timestamptz),
  plateforme.console_clore_demande(uuid, text, timestamptz), plateforme.console_rouvrir_demande(uuid, text, timestamptz),
  plateforme.support_alertes_dues(timestamptz, interval), plateforme.support_alerte_partie(uuid, timestamptz) to skanfact_app;
