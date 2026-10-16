-- 0135 : l'accès d'urgence de l'équipe SkanFact (1.43.0 ; la liste des fonctions qui manquent, 31 : « accès
-- d'urgence » ; docs/console.md C59 ; décidé par délégation le 16/10/2026, « prends la décision à ma place »).
-- Un membre qui a perdu son téléphone ET ses codes de secours n'entrait plus dans la console, et personne ne pouvait
-- reposer son code à sa place (C40). Désormais :
--   - la DIRECTION ouvre un accès d'urgence pour un AUTRE membre (jamais pour elle-même), avec son motif ; la MACHINE
--     (l'outil de l'exploitation, en root : exploitation/equipe.sh urgence) l'ouvre pour n'importe quel membre, la
--     dernière direction comprise — c'est la porte de qui n'a plus personne pour lui ouvrir ;
--   - l'accès vaut VINGT-QUATRE HEURES et sert UNE fois : à sa prochaine connexion, après son mot de passe (qui reste
--     exigé), la personne pose un NOUVEAU code (une application d'authentification, dix nouveaux codes de secours),
--     comme un premier code (0118) ; l'ancien code et ses codes de secours cessent de valoir quand le nouveau s'active ;
--   - l'ouvrir ferme aussitôt ses sessions de la console (le téléphone perdu peut en tenir une) ; la direction peut
--     l'annuler tant qu'il n'a pas servi ; un nouvel accès remplace celui qui attendait ;
--   - chaque geste au journal (ouvert, annulé, servi), avec qui et le motif ; jamais un code ni un secret.

create table plateforme.acces_urgence (
  id uuid primary key default socle.uuidv7(),
  membre uuid not null references socle.utilisateur(id),
  ouvert_le timestamptz not null,
  jusqua timestamptz not null,
  -- Qui l'a ouvert : un membre de la direction, ou personne (la machine, l'outil de l'exploitation).
  ouvert_par uuid references socle.utilisateur(id),
  motif text not null check (length(btrim(motif)) between 3 and 500),
  servi_le timestamptz,
  annule_le timestamptz,
  annule_par uuid references socle.utilisateur(id),
  check (jusqua > ouvert_le),
  check (servi_le is null or annule_le is null)
);
-- Un seul accès qui attend par membre (un nouveau remplace l'ancien, sous le verrou de l'équipe).
create unique index acces_urgence_attend on plateforme.acces_urgence (membre) where servi_le is null and annule_le is null;
alter table plateforme.acces_urgence enable row level security;
alter table plateforme.acces_urgence force row level security;

-- Ouvrir un accès (la console et la machine passent par ici) : le membre est dans l'équipe ; ce qui attendait est
-- remplacé ; ses sessions de la console se ferment ; au journal. `p_par` nul : la machine.
create function plateforme.ouvrir_acces_urgence(p_membre uuid, p_par uuid, p_role text, p_motif text, p_maintenant timestamptz) returns timestamptz
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role_membre text; v_jusqua timestamptz := p_maintenant + interval '24 hours';
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur l''équipe demande son motif (trois caractères au moins)'); end if;
  if length(btrim(p_motif)) > 500 then perform socle.refus('le motif d''un accès d''urgence : cinq cents caractères au plus'); end if;
  select e.role into v_role_membre from plateforme.equipe e where e.utilisateur = p_membre and e.actif;
  if v_role_membre is null then perform socle.refus('membre introuvable'); end if;
  update plateforme.acces_urgence set annule_le = p_maintenant, annule_par = p_par
   where membre = p_membre and servi_le is null and annule_le is null;
  insert into plateforme.acces_urgence (membre, ouvert_le, jusqua, ouvert_par, motif) values (p_membre, p_maintenant, v_jusqua, p_par, btrim(p_motif));
  update plateforme.session_console set fermee_le = p_maintenant where utilisateur = p_membre and fermee_le is null;
  insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
    values (p_par, p_role, 'equipe.urgence_ouverte', p_membre, btrim(p_motif), null,
            jsonb_build_object('role', v_role_membre, 'jusqua', v_jusqua, 'par', case when p_par is null then 'machine' else 'direction' end));
  return v_jusqua;
end $$;

-- Depuis la console : la direction, pour un autre membre.
create function plateforme.console_ouvrir_urgence(p_membre uuid, p_motif text, p_maintenant timestamptz) returns timestamptz
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']);
begin
  perform plateforme.verrou_equipe();
  v_role := plateforme.exiger_role_console(array['direction']);
  if p_membre = socle.moi() then
    perform socle.refus('ton propre accès d''urgence s''ouvre par une autre personne de la direction, ou sur la machine du serveur');
  end if;
  return plateforme.ouvrir_acces_urgence(p_membre, socle.moi(), v_role, p_motif, p_maintenant);
end $$;

-- Annuler un accès qui n'a pas servi (la direction).
create function plateforme.console_annuler_urgence(p_membre uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); a plateforme.acces_urgence;
begin
  perform plateforme.verrou_equipe();
  v_role := plateforme.exiger_role_console(array['direction']);
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur l''équipe demande son motif (trois caractères au moins)'); end if;
  select * into a from plateforme.acces_urgence where membre = p_membre and servi_le is null and annule_le is null and jusqua > p_maintenant for update;
  if not found then perform socle.refus('aucun accès d''urgence n''attend pour cette personne'); end if;
  update plateforme.acces_urgence set annule_le = p_maintenant, annule_par = socle.moi() where id = a.id;
  insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
    values (socle.moi(), v_role, 'equipe.urgence_annulee', p_membre, btrim(p_motif), jsonb_build_object('jusqua', a.jusqua), null);
end $$;

-- À la connexion (sans session : le serveur, après le mot de passe juste) : un accès attend-il, encore valable, pour un
-- membre encore dans l'équipe ?
create function plateforme.acces_urgence_ouvert(p_utilisateur uuid, p_maintenant timestamptz) returns boolean
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select exists (select 1 from plateforme.acces_urgence a join plateforme.equipe e on e.utilisateur = a.membre and e.actif
                  where a.membre = p_utilisateur and a.servi_le is null and a.annule_le is null and a.jusqua > p_maintenant)
$$;

-- Le nouveau code posé par l'accès (après son activation) : l'accès a servi, une fois ; au journal (la méthode lue dans
-- le compte). Faux si aucun accès n'attendait : c'était un premier code (0118).
create function plateforme.servir_acces_urgence(p_utilisateur uuid, p_maintenant timestamptz) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare a plateforme.acces_urgence;
begin
  select * into a from plateforme.acces_urgence where membre = p_utilisateur and servi_le is null and annule_le is null and jusqua > p_maintenant for update;
  if not found then return false; end if;
  update plateforme.acces_urgence set servi_le = p_maintenant where id = a.id;
  insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
    select p_utilisateur, e.role, 'equipe.urgence_servie', p_utilisateur, 'nouveau code posé par l''accès d''urgence', null,
           jsonb_build_object('methode', u.code_methode)
      from plateforme.equipe e join socle.utilisateur u on u.id = e.utilisateur
     where e.utilisateur = p_utilisateur and e.actif;
  return true;
end $$;

-- Ce que la direction lit : les accès des trente derniers jours (le plus récent d'abord), et combien de personnes sont à
-- la direction (une seule : si elle perd son téléphone, seule la machine la dépanne).
create function plateforme.console_acces_urgence(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction']);
  return jsonb_build_object(
    'directions', (select count(*) from plateforme.equipe e where e.role = 'direction' and e.actif),
    'acces', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'membre', a.membre, 'nom', u.nom, 'ouvertLe', a.ouvert_le, 'jusqua', a.jusqua,
        'par', (select p.nom from socle.utilisateur p where p.id = a.ouvert_par), 'machine', a.ouvert_par is null,
        'motif', a.motif, 'serviLe', a.servi_le, 'annuleLe', a.annule_le,
        'etat', case when a.servi_le is not null then 'servi' when a.annule_le is not null then 'annule'
                     when a.jusqua <= p_maintenant then 'passe' else 'attend' end)
        order by a.ouvert_le desc, a.id desc), '[]'::jsonb)
      from plateforme.acces_urgence a join socle.utilisateur u on u.id = a.membre
     where a.ouvert_le > p_maintenant - interval '30 days'));
end $$;

revoke execute on function plateforme.ouvrir_acces_urgence(uuid, uuid, text, text, timestamptz), plateforme.console_ouvrir_urgence(uuid, text, timestamptz),
  plateforme.console_annuler_urgence(uuid, text, timestamptz), plateforme.acces_urgence_ouvert(uuid, timestamptz),
  plateforme.servir_acces_urgence(uuid, timestamptz), plateforme.console_acces_urgence(timestamptz) from public;
grant execute on function plateforme.console_ouvrir_urgence(uuid, text, timestamptz), plateforme.console_annuler_urgence(uuid, text, timestamptz),
  plateforme.acces_urgence_ouvert(uuid, timestamptz), plateforme.servir_acces_urgence(uuid, timestamptz),
  plateforme.console_acces_urgence(timestamptz) to skanfact_app;
