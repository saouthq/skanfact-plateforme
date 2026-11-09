-- 0206 — Le support du Cabinet (1.332.0 ; docs/support.md). Un cabinet écrit à l'équipe SkanFact depuis son application,
-- comme une entreprise (0095) : la demande appartient alors au CABINET et à la personne qui la pose. Jusqu'ici, « Signaler
-- un problème… » du Cabinet en ligne montrait un rapport de l'application de bureau (« Electron », « Dossiers : 0 », une
-- copie externe) et n'envoyait rien ; un commentaire des gestes disait pourtant qu'un cabinet « a son propre support ».
--
-- Les mêmes règles que pour une entreprise : chacun ne lit que SES demandes, dans le cabinet de la route (ni un collègue,
-- ni un autre cabinet de la même personne) ; jamais une clé de l'API ; ce qui part avec une demande, compté et décidé : le
-- sujet, le texte, la version et le NOM de la page. L'équipe répond depuis la console, comme à une entreprise ; l'alerte
-- par e-mail part pareil. Ce qui n'y est pas : l'accès au dossier (Support S2) — un cabinet n'a pas de dossier à ouvrir au
-- support — et « noter une demande reçue ailleurs » au nom d'une personne d'un cabinet (la console le fait pour une
-- entreprise ; pour un cabinet, elle répond à ce qu'il a écrit).

alter table plateforme.demande_support alter column entreprise drop not null;
alter table plateforme.demande_support add column cabinet uuid references socle.organisation(id);
alter table plateforme.demande_support add constraint demande_support_un_client check ((entreprise is null) <> (cabinet is null));
create index demande_support_cabinet on plateforme.demande_support (cabinet, ouverte_le desc) where cabinet is not null;
create index demande_support_demandeur_cabinet on plateforme.demande_support (demandeur, cabinet) where cabinet is not null;

-- ── La personne, dans le Cabinet ──────────────────────────────────────────────────────────────────────────────────────
-- Une personne du cabinet (un membre actif), jamais une clé de l'API : le support se tient entre personnes.
create function plateforme.support_cab_exiger(p_cabinet uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is null or socle.ma_cle() is not null or not exists (
       select 1 from socle.membre m join socle.organisation o on o.id = m.organisation
        where m.organisation = p_cabinet and o.type = 'cabinet' and m.utilisateur = socle.moi() and m.actif) then
    perform socle.refus('le support se joint par une personne du cabinet');
  end if;
end $$;

-- Une de MES demandes, dans CE cabinet (celui de la route), où je suis encore.
create function plateforme.support_cab_ma_demande(p_cabinet uuid, p_demande uuid) returns plateforme.demande_support
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v plateforme.demande_support;
begin
  select * into v from plateforme.demande_support d where d.id = p_demande and d.demandeur = socle.moi() and d.cabinet = p_cabinet;
  if not found then perform socle.refus('cette demande n''existe pas, ou n''est pas la tienne'); end if;
  perform plateforme.support_cab_exiger(v.cabinet);
  return v;
end $$;

-- Écrire au support : la demande et son premier message ; le même envoi dans les cinq minutes rend la même demande.
create function plateforme.support_cab_ecrire(p_cabinet uuid, p_sujet text, p_texte text, p_version text, p_page text, p_maintenant timestamptz)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_id uuid; v_sujet text := btrim(coalesce(p_sujet, '')); v_texte text := btrim(coalesce(p_texte, ''));
begin
  perform plateforme.support_cab_exiger(p_cabinet);
  if length(v_sujet) < 3 or length(v_sujet) > 140 then perform socle.refus('le sujet d''une demande : de trois à cent quarante caractères'); end if;
  if v_sujet ~ '[<>]' then perform socle.refus('le sujet d''une demande s''écrit sans balise'); end if;
  if length(v_texte) < 3 or length(v_texte) > 4000 then perform socle.refus('une demande dit ce qui se passe : de trois à quatre mille caractères'); end if;
  perform pg_advisory_xact_lock(hashtext('plateforme.demande_support'), hashtext(socle.moi()::text));
  select d.id into v_id from plateforme.demande_support d
    join plateforme.message_support m on m.demande = d.id and m.cote = 'client'
   where d.cabinet = p_cabinet and d.demandeur = socle.moi() and d.sujet = v_sujet and m.texte = v_texte
     and d.ouverte_le > p_maintenant - interval '5 minutes'
   limit 1;
  if v_id is not null then return v_id; end if;
  insert into plateforme.demande_support (cabinet, demandeur, canal, sujet, version, page, ouverte_le)
    values (p_cabinet, socle.moi(), 'application', v_sujet,
            case when coalesce(p_version, '') ~ '^[0-9A-Za-z.+-]{1,40}$' then p_version end,
            case when coalesce(p_page, '') ~ '^[a-z][a-z0-9_-]{0,39}$' then p_page end, p_maintenant)
    returning id into v_id;
  insert into plateforme.message_support (demande, cote, auteur, texte, ecrit_le) values (v_id, 'client', socle.moi(), v_texte, p_maintenant);
  return v_id;
end $$;

-- Mes demandes dans ce cabinet, la même forme que celles d'une entreprise (la page « Tes demandes au support » est la même).
create function plateforme.support_cab_mes_demandes(p_cabinet uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.support_cab_exiger(p_cabinet);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'numero', d.numero, 'sujet', d.sujet, 'canal', d.canal,
             'ouverteLe', d.ouverte_le, 'closeLe', d.close_le, 'closeCote', d.close_cote,
             'nonLu', exists (select 1 from plateforme.message_support m where m.demande = d.id and m.cote = 'equipe'
                               and m.ecrit_le > coalesce(d.lu_le, '-infinity')),
             'dernierCote', (select m.cote from plateforme.message_support m where m.demande = d.id order by m.ecrit_le desc, m.id desc limit 1),
             'messages', plateforme.support_messages_pour_client(d.id))
             order by d.close_le is null desc, d.ouverte_le desc, d.id desc), '[]'::jsonb)
            from plateforme.demande_support d
           where d.cabinet = p_cabinet and d.demandeur = socle.moi());
end $$;

create function plateforme.support_cab_repondre(p_cabinet uuid, p_demande uuid, p_texte text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v plateforme.demande_support := plateforme.support_cab_ma_demande(p_cabinet, p_demande); v_texte text := btrim(coalesce(p_texte, ''));
begin
  if length(v_texte) < 1 or length(v_texte) > 4000 then perform socle.refus('un message au support : de un à quatre mille caractères'); end if;
  insert into plateforme.message_support (demande, cote, auteur, texte, ecrit_le) values (v.id, 'client', socle.moi(), v_texte, p_maintenant);
  update plateforme.demande_support set close_le = null, close_cote = null, close_par = null, close_motif = null,
         lu_le = greatest(coalesce(lu_le, '-infinity'), p_maintenant)
   where id = v.id;
end $$;

create function plateforme.support_cab_lu(p_cabinet uuid, p_demande uuid, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v plateforme.demande_support := plateforme.support_cab_ma_demande(p_cabinet, p_demande);
begin
  update plateforme.demande_support set lu_le = greatest(coalesce(lu_le, '-infinity'), p_maintenant) where id = v.id;
end $$;

create function plateforme.support_cab_reglee(p_cabinet uuid, p_demande uuid, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v plateforme.demande_support := plateforme.support_cab_ma_demande(p_cabinet, p_demande);
begin
  if v.close_le is not null then perform socle.refus('cette demande est déjà close'); end if;
  update plateforme.demande_support set close_le = p_maintenant, close_cote = 'client', close_par = socle.moi(), close_motif = null,
         lu_le = greatest(coalesce(lu_le, '-infinity'), p_maintenant)
   where id = v.id;
end $$;

create function plateforme.support_cab_a_lire(p_cabinet uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.support_cab_exiger(p_cabinet);
  return (select jsonb_build_object('demandes', count(*) filter (where d.close_le is null),
            'aLire', coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'numero', d.numero, 'sujet', d.sujet) order by d.ouverte_le desc)
                                filter (where exists (select 1 from plateforme.message_support m where m.demande = d.id and m.cote = 'equipe'
                                                        and m.ecrit_le > coalesce(d.lu_le, '-infinity'))), '[]'::jsonb))
            from plateforme.demande_support d where d.cabinet = p_cabinet and d.demandeur = socle.moi());
end $$;


-- ── La console ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- La ligne d'une demande dit son client : l'entreprise, ou le cabinet (`cabinet` vrai, son nom) ; le reste ne change pas.
create or replace function plateforme.support_ligne(d plateforme.demande_support) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object('id', d.id, 'numero', d.numero, 'sujet', d.sujet, 'canal', d.canal, 'ouverteLe', d.ouverte_le,
    'entreprise', jsonb_build_object('id', coalesce(e.id, o.id), 'nom', coalesce(e.raison_sociale, o.nom), 'essai', coalesce(e.essai, false),
      'cabinet', d.cabinet is not null),
    'demandeur', jsonb_build_object('id', p.id, 'nom', p.nom),
    'noteePar', (select u.nom from socle.utilisateur u where u.id = d.notee_par),
    'suiviePar', (select u.nom from socle.utilisateur u where u.id = d.suivie_par), 'suivieParId', d.suivie_par, 'priorite', d.priorite,
    'technique', case when d.technique_le is null then null else jsonb_build_object('le', d.technique_le, 'motif', d.technique_motif) end,
    'dernierClientLe', (select max(m.ecrit_le) from plateforme.message_support m where m.demande = d.id and m.cote = 'client'),
    -- 0124 (l'audit C08) : le premier mot du client resté sans réponse — après notre dernier mot, et (s'il a réécrit pendant
    -- l'attente de la technique) après le début de cette attente. Une relance du client ne remet rien à zéro.
    'attendClientLe', (select min(m.ecrit_le) from plateforme.message_support m where m.demande = d.id and m.cote = 'client'
        and m.ecrit_le > coalesce((select max(e.ecrit_le) from plateforme.message_support e where e.demande = d.id and e.cote = 'equipe'), '-infinity')),
    'attendClientApresTechniqueLe', (select min(m.ecrit_le) from plateforme.message_support m where m.demande = d.id and m.cote = 'client'
        and m.ecrit_le > greatest(coalesce((select max(e.ecrit_le) from plateforme.message_support e where e.demande = d.id and e.cote = 'equipe'), '-infinity'),
                                  coalesce(d.technique_le, '-infinity'))),
    'dernierEquipeLe', (select max(m.ecrit_le) from plateforme.message_support m where m.demande = d.id and m.cote = 'equipe'),
    'dernierCote', (select m.cote from plateforme.message_support m where m.demande = d.id order by m.ecrit_le desc, m.id desc limit 1),
    'messages', (select count(*) from plateforme.message_support m where m.demande = d.id),
    -- 0126 : l'incident auquel elle est liée, et la version qui la corrige.
    'incident', (select jsonb_build_object('id', i.id, 'ref', plateforme.ref_incident(i.id), 'titre', i.titre, 'gravite', i.gravite, 'closLe', i.clos_le)
                   from plateforme.service_incident i where i.id = d.incident),
    'correction', case when d.correction is null then null else jsonb_build_object('version', d.correction, 'le', d.correction_le) end,
    'close', case when d.close_le is null then null else jsonb_build_object('le', d.close_le, 'cote', d.close_cote,
               'par', (select u.nom from socle.utilisateur u where u.id = d.close_par), 'motif', d.close_motif) end)
    from socle.utilisateur p left join socle.entreprise e on e.id = d.entreprise left join socle.organisation o on o.id = d.cabinet
   where p.id = d.demandeur
$$;

-- La personne d'une demande, ses rôles là où elle l'a posée (l'entreprise, ou le cabinet).
create or replace function plateforme.console_support(p_entreprise uuid, p_demande uuid, p_closes_debut integer default 0) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return jsonb_build_object(
    'ouvertes', (select coalesce(jsonb_agg(plateforme.support_ligne(d) order by d.ouverte_le, d.id), '[]'::jsonb)
                   from plateforme.demande_support d where d.close_le is null and (p_entreprise is null or d.entreprise = p_entreprise)),
    'closes', (select coalesce(jsonb_agg(plateforme.support_ligne(d) order by d.close_le desc, d.id desc), '[]'::jsonb)
                 from plateforme.demande_support d
                where d.id in (select c.id from plateforme.demande_support c where c.close_le is not null and (p_entreprise is null or c.entreprise = p_entreprise)
                                order by c.close_le desc, c.id desc offset greatest(coalesce(p_closes_debut, 0), 0) limit 50)),
    -- Ceux à qui une demande se confie : l'équipe qui répond au support (la direction et le support).
    'equipe', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nom', u.nom, 'role', e.role) order by e.role, u.nom, u.id), '[]'::jsonb)
                 from plateforme.equipe e join socle.utilisateur u on u.id = e.utilisateur where e.actif and e.role in ('direction', 'support')),
    'nCloses', (select count(*) from plateforme.demande_support c where c.close_le is not null and (p_entreprise is null or c.entreprise = p_entreprise)),
    'demande', (select jsonb_build_object('ligne', plateforme.support_ligne(d), 'version', d.version, 'page', d.page,
                  -- La personne, comme la liste fermée la dit (10 § 4) : son nom, son adresse, ses rôles ; jamais son téléphone.
                  'personne', jsonb_build_object('nom', p.nom, 'email', p.email,
                    'roles', (select coalesce(to_jsonb(m.roles), '[]'::jsonb) from socle.membre m
                               where m.utilisateur = p.id and (m.entreprise = d.entreprise or m.organisation = d.cabinet) order by m.actif desc limit 1)),
                  'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'cote', m.cote, 'texte', m.texte, 'article', m.article,
                                 'le', m.ecrit_le, 'nom', u.nom, 'notePar', (select n.nom from socle.utilisateur n where n.id = m.note_par))
                                 order by m.ecrit_le, m.id), '[]'::jsonb)
                                 from plateforme.message_support m join socle.utilisateur u on u.id = m.auteur where m.demande = d.id))
                  from plateforme.demande_support d join socle.utilisateur p on p.id = d.demandeur where d.id = p_demande));
end
$$;

-- L'alerte par e-mail : à une personne encore dans l'entreprise, ou encore dans le cabinet.
create or replace function plateforme.support_alertes_dues(p_maintenant timestamptz, p_delai interval) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select coalesce(jsonb_agg(jsonb_build_object('demande', d.id, 'utilisateur', u.id, 'email', u.email, 'langue', u.langue)
           order by u.id, d.ouverte_le, d.id), '[]'::jsonb)
    from plateforme.demande_support d
    join socle.utilisateur u on u.id = d.demandeur and u.adresse_verifiee_le is not null
   where socle.moi() is null
     and d.close_le is null
     and exists (select 1 from socle.membre m where (m.entreprise = d.entreprise or m.organisation = d.cabinet) and m.utilisateur = d.demandeur and m.actif
                  and cardinality(m.roles) > 0)
     and exists (select 1 from plateforme.message_support m where m.demande = d.id and m.cote = 'equipe'
                  and m.ecrit_le <= p_maintenant - p_delai
                  and m.ecrit_le > coalesce(d.lu_le, '-infinity')
                  and m.ecrit_le > coalesce(d.alerte_le, '-infinity'))
$$;

-- L'Aide qu'une réponse cite : celle que lit le client de la demande. Un cabinet lit l'Aide du Cabinet ; un article de
-- l'Aide de l'entreprise y serait un lien vers rien (la console le vérifie : serveur/console/routes.ts).
create function plateforme.console_demande_du_cabinet(p_demande uuid) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return coalesce((select d.cabinet is not null from plateforme.demande_support d where d.id = p_demande), false);
end $$;

revoke execute on function plateforme.support_cab_exiger(uuid), plateforme.support_cab_ma_demande(uuid, uuid),
  plateforme.support_cab_ecrire(uuid, text, text, text, text, timestamptz), plateforme.support_cab_mes_demandes(uuid),
  plateforme.support_cab_repondre(uuid, uuid, text, timestamptz), plateforme.support_cab_lu(uuid, uuid, timestamptz),
  plateforme.support_cab_reglee(uuid, uuid, timestamptz), plateforme.support_cab_a_lire(uuid), plateforme.console_demande_du_cabinet(uuid) from public;
grant execute on function plateforme.support_cab_ecrire(uuid, text, text, text, text, timestamptz), plateforme.support_cab_mes_demandes(uuid),
  plateforme.support_cab_repondre(uuid, uuid, text, timestamptz), plateforme.support_cab_lu(uuid, uuid, timestamptz),
  plateforme.support_cab_reglee(uuid, uuid, timestamptz), plateforme.support_cab_a_lire(uuid), plateforme.console_demande_du_cabinet(uuid) to skanfact_app;
