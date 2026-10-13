-- 0091 — La sécurité du service (Console 3e ; docs/console.md C26 ; skanfact docs/cadrage/10-console.md § 2.8 ; 03 § 6).
-- Ce que les règles de connexion ont fait, lu dans ce qu'elles écrivent déjà — rien de neuf n'est enregistré :
--   1. les connexions des dernières vingt-quatre heures, heure par heure : celles qui ont abouti (une session ouverte, dans
--      l'application ou la console), et les codes faux tapés après un mot de passe bon (les défis) ;
--   2. ce qui demande un regard : un défi où trois codes faux ou plus ont suivi un mot de passe BON (quelqu'un connaît ce
--      mot de passe), un compte freiné par des mots de passe faux (l'attente qui s'allonge, jamais un blocage) ;
--   3. l'équipe : la méthode de son code, ses appareils reconnus, ses sessions, ses codes de secours.
-- Un compte se nomme en entier pour la direction ; pour la technique, son adresse est masquée (03 § 5 : aucune donnée de
-- client), sauf une personne de l'équipe, qui se nomme toujours. Un geste : lever l'attente d'un compte freiné (la
-- personne a appelé ; c'était bien elle), avec son motif, au journal.

create function plateforme.masquer_adresse(p_email text) returns text
language sql immutable set search_path = pg_catalog as $$
  select case when position('@' in coalesce(p_email, '')) > 1
              then left(p_email, 1) || '…@' || split_part(p_email, '@', 2) else '…' end
$$;

create function plateforme.console_service_securite(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'technique']);
  v_depuis timestamptz := p_maintenant - interval '24 hours';
  v_heure timestamptz := date_trunc('hour', p_maintenant);
begin
  return jsonb_build_object(
    -- Vingt-quatre heures pleines, la dernière en cours ; une heure sans rien vaut zéro (la trace existe).
    'heures', (select coalesce(jsonb_agg(jsonb_build_object('heure', h.h,
        'reussies', (select count(*) from socle.session s where s.ouverte_le >= h.h and s.ouverte_le < h.h + interval '1 hour')
                  + (select count(*) from plateforme.session_console s where s.ouverte_le >= h.h and s.ouverte_le < h.h + interval '1 hour'),
        'codesFaux', (select coalesce(sum(d.erreurs), 0) from socle.defi_connexion d where d.cree_le >= h.h and d.cree_le < h.h + interval '1 hour')
                   + (select coalesce(sum(d.erreurs), 0) from plateforme.defi_console d where d.cree_le >= h.h and d.cree_le < h.h + interval '1 hour'))
        order by h.h), '[]'::jsonb)
      from generate_series(v_heure - interval '23 hours', v_heure, interval '1 hour') h(h)),
    -- Les comptes à qui un mot de passe faux a été tapé (la ligne s'efface à la connexion suivante réussie), et ceux qui
    -- ont dû attendre.
    'motsDePasseFaux', (select count(*) from socle.tentative t where t.derniere >= v_depuis and t.erreurs > 0),
    'freines', (select count(*) from socle.tentative t where t.attente_jusqu_au >= v_depuis),
    'aRegarder', (select coalesce(jsonb_agg(x.l order by x.equipe desc, x.le desc), '[]'::jsonb) from (
        -- Un mot de passe bon, puis trois codes faux ou plus : la personne doit savoir que son mot de passe est connu.
        select d.cree_le le, (eq.utilisateur is not null) equipe, jsonb_build_object('sorte', 'code', 'id', d.id::text, 'le', d.cree_le,
                 'erreurs', d.erreurs, 'resolu', d.resolu_le is not null, 'console', false,
                 'qui', case when v_role = 'direction' or eq.utilisateur is not null then u.nom end,
                 'adresse', case when v_role = 'direction' or eq.utilisateur is not null then u.email else plateforme.masquer_adresse(u.email) end,
                 'role', eq.role, 'appareil', case when a.id is null then null else jsonb_build_object('type', a.type,
                   'nouveau', a.premier_vu >= d.cree_le - interval '1 minute') end) l
          from socle.defi_connexion d join socle.utilisateur u on u.id = d.utilisateur
          left join plateforme.equipe eq on eq.utilisateur = u.id and eq.actif
          left join socle.appareil a on a.id = d.appareil
         where d.cree_le >= v_depuis and d.erreurs >= 3
        union all
        select d.cree_le, true, jsonb_build_object('sorte', 'code', 'id', d.id::text, 'le', d.cree_le, 'erreurs', d.erreurs,
                 'resolu', d.resolu_le is not null, 'console', true, 'qui', u.nom, 'adresse', u.email, 'role', eq.role,
                 'appareil', jsonb_build_object('type', a.type, 'nouveau', a.premier_vu >= d.cree_le - interval '1 minute'))
          from plateforme.defi_console d join socle.utilisateur u on u.id = d.utilisateur
          left join plateforme.equipe eq on eq.utilisateur = u.id
          join socle.appareil a on a.id = d.appareil
         where d.cree_le >= v_depuis and d.erreurs >= 3
        union all
        -- Un compte freiné : cinq mots de passe faux ou plus, l'attente posée. Son identifiant est une empreinte de l'adresse,
        -- jamais l'adresse (elle voyage dans l'adresse de la requête du geste).
        select t.derniere, (eq.utilisateur is not null), jsonb_build_object('sorte', 'attente', 'id', md5(t.cle), 'le', t.derniere,
                 'erreurs', t.erreurs, 'jusquAu', t.attente_jusqu_au, 'connu', u.id is not null,
                 'qui', case when v_role = 'direction' or eq.utilisateur is not null then u.nom end,
                 'adresse', case when v_role = 'direction' or eq.utilisateur is not null then t.cle else plateforme.masquer_adresse(t.cle) end,
                 'role', eq.role)
          from socle.tentative t left join socle.utilisateur u on lower(u.email) = t.cle
          left join plateforme.equipe eq on eq.utilisateur = u.id and eq.actif
         where t.attente_jusqu_au >= v_depuis
        order by 1 desc limit 100) x),
    -- L'équipe : chacun, sa méthode, ses appareils reconnus (et révoqués non), ses sessions de la console encore ouvertes.
    'equipe', (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'nom', u.nom, 'role', eq.role, 'moi', u.id = socle.moi(),
        'methode', u.code_methode,
        'appareils', (select coalesce(jsonb_agg(jsonb_build_object('nom', a.nom, 'type', a.type) order by a.dernier_vu desc nulls last), '[]'::jsonb)
                        from socle.appareil a where a.utilisateur = u.id and a.revoque_le is null and a.reconnu_jusqu_au > p_maintenant),
        'sessions', (select count(*) from plateforme.session_console s where s.utilisateur = u.id and s.fermee_le is null and s.expire_le > p_maintenant),
        'derniere', (select max(s.ouverte_le) from plateforme.session_console s where s.utilisateur = u.id),
        'secours', (select count(*) from socle.code_secours c where c.utilisateur = u.id and c.utilise_le is null),
        'codesFaux', (select coalesce(sum(d.erreurs), 0) from plateforme.defi_console d where d.utilisateur = u.id and d.cree_le >= v_depuis))
        order by case eq.role when 'direction' then 0 when 'technique' then 1 else 2 end, u.nom), '[]'::jsonb)
      from plateforme.equipe eq join socle.utilisateur u on u.id = eq.utilisateur where eq.actif));
end $$;
grant execute on function plateforme.console_service_securite(timestamptz) to skanfact_app;

-- Lever l'attente d'un compte freiné (direction, technique) : la personne a appelé, c'était bien elle. Le compte se désigne
-- par l'empreinte de son adresse ; le journal garde l'empreinte et le nombre d'erreurs effacées, jamais l'adresse.
create function plateforme.console_lever_attente(p_id text, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_t socle.tentative;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('lever une attente demande son motif (trois caractères au moins)'); end if;
  select * into v_t from socle.tentative t where md5(t.cle) = p_id for update;
  if not found then perform socle.refus('ce compte n''attend plus : il n''y a rien à lever'); end if;
  if v_t.attente_jusqu_au is null then perform socle.refus('ce compte n''a pas été freiné : il n''y a rien à lever'); end if;
  delete from socle.tentative where cle = v_t.cle;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'service.lever_attente', btrim(p_motif),
            jsonb_build_object('compte', p_id, 'erreurs', v_t.erreurs, 'jusquAu', v_t.attente_jusqu_au),
            jsonb_build_object('compte', p_id, 'erreurs', 0, 'le', p_maintenant));
end $$;
grant execute on function plateforme.console_lever_attente(text, text, timestamptz) to skanfact_app;
