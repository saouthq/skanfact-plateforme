-- 0117 : « Ton compte » dans la console (1.24.0 ; docs/console.md C40 ; la maquette « Équipe », la vue du support).
-- Chaque membre de l'équipe, quel que soit son rôle, lit son propre compte : son rôle et depuis quand, son code, ses codes
-- de secours qui restent, le jour où son mot de passe a changé, ses gestes récents. Il change son mot de passe, son code
-- et refait ses codes de secours d'ici (le mot de passe ferme ses autres sessions de la console) ; chaque geste entre au
-- journal. Jamais le compte d'un autre : la direction lit l'équipe par son propre écran (console_equipe), et personne ne
-- change le code d'un autre.

create function plateforme.console_mon_compte(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support', 'technique']);
begin
  return (select jsonb_build_object(
      'utilisateur', u.id, 'nom', u.nom, 'email', u.email, 'role', v_role, 'depuis', q.ajoute_le,
      'code', case when u.code_methode in ('sms', 'application') then u.code_methode end,
      -- Le numéro du code par SMS, que le serveur masque avant de l'envoyer à l'écran.
      'telephone', case when u.code_methode = 'sms' then u.telephone end,
      'secours', (select count(*) from socle.code_secours c where c.utilisateur = u.id and c.utilise_le is null),
      -- Le jour où le mot de passe a changé ; jamais changé : celui où le compte est né.
      'motDePasseLe', coalesce((select max(a.instant) from socle.audit a where a.geste = 'compte.mot_de_passe.changer' and a.objet_id = u.id), u.cree_le),
      'motDePasseChange', exists (select 1 from socle.audit a where a.geste = 'compte.mot_de_passe.changer' and a.objet_id = u.id),
      'gestes30', (select count(*) from plateforme.geste_console g where g.qui = u.id and g.le > p_maintenant - interval '30 days'),
      'gestes', (select coalesce(jsonb_agg(x order by x ->> 'le' desc), '[]'::jsonb) from (
                   select jsonb_build_object('le', g.le, 'geste', g.geste, 'motif', g.motif,
                            'entreprise', (select e.raison_sociale from socle.entreprise e where e.id = g.entreprise)) x
                     from plateforme.geste_console g where g.qui = u.id order by g.le desc limit 6) r))
    from socle.utilisateur u join plateforme.equipe q on q.utilisateur = u.id
   where u.id = socle.moi());
end $$;

-- Après un geste sur son propre compte (le mot de passe changé, le code changé, les codes de secours refaits) : au
-- journal (le code : la méthode lue dans le compte, jamais un secret ni un numéro), et, pour le
-- mot de passe, ses autres sessions de la console se ferment (celle-ci reste ouverte). Le geste lui-même s'est fait par
-- le serveur, avec la vérification de l'application (serveur/compte.ts) ; ici, sa trace.
create function plateforme.console_mon_compte_change(p_quoi text, p_maintenant timestamptz) returns integer
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support', 'technique']);
  v_session uuid := nullif(current_setting('app.session_console', true), '')::uuid;
  n integer := 0;
begin
  if p_quoi is null or p_quoi not in ('mot_de_passe', 'code', 'codes_secours') then perform socle.refus('ce geste sur ton compte n''existe pas'); end if;
  -- Trois gestes écrits en entier (le journal se vérifie sur les migrations : un geste calculé ne s'y lit pas).
  if p_quoi = 'mot_de_passe' then
    update plateforme.session_console set fermee_le = p_maintenant
     where utilisateur = socle.moi() and fermee_le is null and id is distinct from v_session;
    get diagnostics n = row_count;
    insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
      values (socle.moi(), v_role, 'equipe.mon_mot_de_passe', socle.moi(), 'changé depuis Ton compte', null, jsonb_build_object('sessionsFermees', n));
  elsif p_quoi = 'code' then
    insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
      values (socle.moi(), v_role, 'equipe.mon_code', socle.moi(), 'changé depuis Ton compte', null,
              (select jsonb_build_object('methode', u.code_methode) from socle.utilisateur u where u.id = socle.moi()));
  else
    insert into plateforme.geste_console (qui, role, geste, membre, motif, avant, apres)
      values (socle.moi(), v_role, 'equipe.mes_codes_secours', socle.moi(), 'refaits depuis Ton compte', null, null);
  end if;
  return n;
end $$;

revoke execute on function plateforme.console_mon_compte(timestamptz), plateforme.console_mon_compte_change(text, timestamptz) from public;
grant execute on function plateforme.console_mon_compte(timestamptz), plateforme.console_mon_compte_change(text, timestamptz) to skanfact_app;
