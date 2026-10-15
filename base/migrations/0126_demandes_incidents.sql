-- 0126 : une demande du support liée à son incident et à sa correction (1.32.0 ; la liste des fonctions qui manquent, 19 ;
-- docs/console.md C48).
--   - Une demande de client se lie à l'incident qui la cause (« la caisse ne répond plus » pendant INC-2026-003) : la
--     demande le dit, l'incident compte les demandes liées — combien, jamais qui (la technique lit l'écran des incidents).
--   - Une demande qui attend une correction du programme note la version qui la corrige (« 1.32.0 ») : quand cette version
--     est en service, la console le dit — il reste à l'écrire au client.
--   - Chaque geste a son motif et sa ligne au journal ; la direction et le support les font (ils lisent les demandes).

alter table plateforme.demande_support
  add column incident uuid references plateforme.service_incident(id),
  add column correction text check (correction ~ '^\d{1,4}\.\d{1,4}\.\d{1,4}$'),
  add column correction_le timestamptz,
  add constraint demande_correction check ((correction is null) = (correction_le is null));
create index demande_support_incident on plateforme.demande_support (incident) where incident is not null;

-- La ligne d'une demande (0124) : avec son incident et sa correction.
create or replace function plateforme.support_ligne(d plateforme.demande_support) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object('id', d.id, 'numero', d.numero, 'sujet', d.sujet, 'canal', d.canal, 'ouverteLe', d.ouverte_le,
    'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale, 'essai', e.essai),
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
    from socle.entreprise e, socle.utilisateur p
   where e.id = d.entreprise and p.id = d.demandeur
$$;

-- Les incidents qu'une demande peut rejoindre (la direction et le support) : ceux ouverts, et ceux clos depuis trente
-- jours au plus (une demande arrive souvent après la fin). Rien d'autre que leur titre et leur gravité.
create function plateforme.console_incidents_a_lier(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'ref', plateforme.ref_incident(i.id), 'titre', i.titre, 'gravite', i.gravite,
            'ouvertLe', i.ouvert_le, 'closLe', i.clos_le) order by i.clos_le is not null, i.ouvert_le desc), '[]'::jsonb)
            from plateforme.service_incident i where i.clos_le is null or i.clos_le >= p_maintenant - interval '30 days');
end $$;

-- Lier une demande à un incident, ou l'en délier (p_incident null).
create function plateforme.console_lier_incident(p_demande uuid, p_incident uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']); v plateforme.demande_support;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  select * into v from plateforme.demande_support where id = p_demande for update;
  if not found then perform socle.refus('cette demande n''existe pas'); end if;
  if p_incident is not null and not exists (select 1 from plateforme.service_incident i where i.id = p_incident
                                             and (i.clos_le is null or i.clos_le >= p_maintenant - interval '30 days')) then
    perform socle.refus('cet incident n''existe pas, ou il est clos depuis plus de trente jours');
  end if;
  if p_incident is null and v.incident is null then perform socle.refus('cette demande n''est liée à aucun incident'); end if;
  if v.incident is not distinct from p_incident then perform socle.refus('cette demande est déjà liée à cet incident'); end if;
  update plateforme.demande_support set incident = p_incident where id = p_demande;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.incident', v.entreprise, btrim(p_motif),
            jsonb_build_object('demande', v.id, 'numero', v.numero, 'incident', plateforme.ref_incident(v.incident)),
            jsonb_build_object('demande', v.id, 'numero', v.numero, 'incident', plateforme.ref_incident(p_incident)));
end $$;

-- Noter la version qui corrige une demande (« 1.32.0 »), ou la retirer (p_version null).
create function plateforme.console_noter_correction(p_demande uuid, p_version text, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']); v plateforme.demande_support;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  if p_version is not null and p_version !~ '^\d{1,4}\.\d{1,4}\.\d{1,4}$' then
    perform socle.refus('une version s''écrit comme « 1.32.0 »');
  end if;
  select * into v from plateforme.demande_support where id = p_demande for update;
  if not found then perform socle.refus('cette demande n''existe pas'); end if;
  if p_version is null and v.correction is null then perform socle.refus('cette demande n''attend aucune correction'); end if;
  if v.correction is not distinct from p_version then perform socle.refus('cette demande attend déjà cette version'); end if;
  update plateforme.demande_support set correction = p_version, correction_le = case when p_version is null then null else p_maintenant end
   where id = p_demande;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'support.correction', v.entreprise, btrim(p_motif),
            jsonb_build_object('demande', v.id, 'numero', v.numero, 'correction', v.correction),
            jsonb_build_object('demande', v.id, 'numero', v.numero, 'correction', p_version));
end $$;

-- Les incidents du service (0089) : avec les demandes de clients liées, comptées.
create or replace function plateforme.console_service_incidents(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'technique']);
  return jsonb_build_object(
    'incidents', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'annee', i.annee, 'numero', i.numero, 'titre', i.titre, 'gravite', i.gravite,
                    'fiche', i.fiche, 'ouvertLe', i.ouvert_le, 'ouvertPar', o.nom, 'public', i.public, 'publicLe', i.public_le, 'fin', i.fin,
                    'closLe', i.clos_le, 'closPar', c.nom, 'effet', i.effet, 'cause', i.cause, 'change', i.change,
                    'points', (select coalesce(jsonb_agg(jsonb_build_object('le', p.le, 'par', u.nom, 'texte', p.texte, 'public', p.public, 'gravite', p.gravite)
                                 order by p.le), '[]'::jsonb)
                                 from plateforme.service_incident_point p join socle.utilisateur u on u.id = p.qui where p.incident = i.id),
                    'suites', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'titre', s.titre, 'responsable', r.nom, 'due', s.due_le,
                                 'faiteLe', s.faite_le, 'repoussee', s.repoussee) order by s.due_le, s.id), '[]'::jsonb)
                                 from plateforme.service_suite s join socle.utilisateur r on r.id = s.responsable where s.incident = i.id),
                    -- 0126 : les demandes de clients liées, comptées (jamais nommées ici : la technique lit cet écran).
                    'demandes', (select jsonb_build_object('n', count(*), 'ouvertes', count(*) filter (where d.close_le is null))
                                   from plateforme.demande_support d where d.incident = i.id))
                  order by i.ouvert_le desc), '[]'::jsonb)
                  from plateforme.service_incident i join socle.utilisateur o on o.id = i.ouvert_par left join socle.utilisateur c on c.id = i.clos_par
                 where i.clos_le is null or i.clos_le >= p_maintenant - interval '400 days'),
    'maintenances', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'titre', m.titre, 'texte', m.texte, 'debut', m.debut, 'fin', m.fin,
                       'par', u.nom, 'annuleeLe', m.annulee_le) order by m.debut desc), '[]'::jsonb)
                       from plateforme.service_maintenance m join socle.utilisateur u on u.id = m.annoncee_par
                      where m.fin >= p_maintenant - interval '60 days'),
    'equipe', (select coalesce(jsonb_agg(jsonb_build_object('id', e.utilisateur, 'nom', u.nom) order by u.nom), '[]'::jsonb)
                 from plateforme.equipe e join socle.utilisateur u on u.id = e.utilisateur
                where e.actif and e.role in ('direction', 'technique')));
end $$;

revoke execute on function plateforme.console_incidents_a_lier(timestamptz), plateforme.console_lier_incident(uuid, uuid, text, timestamptz),
  plateforme.console_noter_correction(uuid, text, text, timestamptz) from public;
grant execute on function plateforme.console_incidents_a_lier(timestamptz), plateforme.console_lier_incident(uuid, uuid, text, timestamptz),
  plateforme.console_noter_correction(uuid, text, text, timestamptz) to skanfact_app;
