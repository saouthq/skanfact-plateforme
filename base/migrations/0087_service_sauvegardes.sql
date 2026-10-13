-- Les sauvegardes du service, à la console (Console 3c, 13/10/2026 ; skanfact docs/cadrage/10-console.md § 2.8, 06 § 4 ;
-- docs/console.md C14). Trois choses :
--   1. ce que la veille voit des copies à chaque minute — l'archivage en marche, la copie hors de la machine réglée, et
--      depuis quand la plus vieille chose y attend — se range avec son relevé : c'est ce qui MESURE, minute par minute,
--      ce qu'on perdrait si le site brûlait (06 § 4.1 : moins de cinq minutes) ;
--   2. une copie arrivée hors de la machine garde la minute où la veille l'a vue arriver ;
--   3. la console lit en une fois les nuits, le retard de la copie heure par heure, les exemplaires du programme, et les
--      remises d'une entreprise (leur trace vit dans la piste d'audit de chacune) : leur nombre pour la direction et la
--      technique, leur détail — qui nomme le client — pour la direction seule (03 § 5 : la technique ne voit aucune
--      donnée de client).

-- ── 1. Le relevé : l'état des copies à cette minute ──────────────────────────────────────────────────────────────────
-- { archivage: { enMarche } | null, horsMachine: { regle, attenteDepuis } | null } ; null : la veille ne l'a pas lu.
alter table plateforme.service_releve add column copies jsonb;

-- ── Écrire : la veille ───────────────────────────────────────────────────────────────────────────────────────────────
-- La fonction de 0086, avec l'état des copies au relevé, et la minute d'arrivée d'une copie hors de la machine gardée.
create or replace function plateforme.noter_veille(p_releve jsonb, p_problemes jsonb, p_nuits jsonb, p_envois jsonb default '[]'::jsonb) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_maintenant timestamptz := (p_releve->>'minute')::timestamptz;
  v_derniere timestamptz := (select max(minute) from plateforme.service_releve);
begin
  insert into plateforme.service_releve (minute, repond, charge_cent, memoire, processeurs, disques, version, certificat, archive_le, destinataires, regles, copies)
    values (v_maintenant, (p_releve->>'repond')::boolean, round((p_releve->>'charge')::numeric * 100)::int, (p_releve->>'memoire')::smallint,
            (p_releve->>'processeurs')::smallint, coalesce(p_releve->'disques', '[]'::jsonb), p_releve->>'version',
            (p_releve->>'certificat')::date, (p_releve->>'archiveLe')::timestamptz,
            nullif(p_releve->'destinataires', 'null'::jsonb), nullif(p_releve->'regles', 'null'::jsonb), nullif(p_releve->'copies', 'null'::jsonb))
  on conflict (minute) do update set repond = excluded.repond, charge_cent = excluded.charge_cent, memoire = excluded.memoire,
    processeurs = excluded.processeurs, disques = excluded.disques, version = excluded.version, certificat = excluded.certificat,
    archive_le = excluded.archive_le, destinataires = excluded.destinataires, regles = excluded.regles, copies = excluded.copies;
  -- Les alertes suivent la DERNIÈRE nouvelle (0085) ; leur règle et leurs étapes suivent la veille.
  if v_derniere is null or v_maintenant >= v_derniere then
    update plateforme.service_alerte a set fin = v_maintenant
     where a.fin is null and not (coalesce(p_problemes, '{}'::jsonb) ? a.cle);
    update plateforme.service_alerte a set titre = p.value->>'titre', grave = (p.value->>'grave')::boolean,
           a_ete_grave = a.a_ete_grave or (p.value->>'grave')::boolean, faire = coalesce(p.value->>'faire', ''),
           regle = coalesce(p.value->>'regle', a.regle), etapes = coalesce(p.value->'etapes', a.etapes)
      from jsonb_each(coalesce(p_problemes, '{}'::jsonb)) p
     where a.fin is null and a.cle = p.key;
    insert into plateforme.service_alerte (cle, titre, grave, a_ete_grave, faire, regle, etapes, debut)
      select p.key, p.value->>'titre', (p.value->>'grave')::boolean, (p.value->>'grave')::boolean, coalesce(p.value->>'faire', ''),
             p.value->>'regle', coalesce(p.value->'etapes', '[]'::jsonb), least((p.value->>'depuis')::timestamptz, v_maintenant)
        from jsonb_each(coalesce(p_problemes, '{}'::jsonb)) p
       where not exists (select 1 from plateforme.service_alerte a where a.fin is null and a.cle = p.key);
  end if;
  insert into plateforme.service_nuit as s (jour, sauvegarde, copie_de_base, restauration)
    select (x->>'jour')::date, x->'sauvegarde', x->'copieDeBase', x->'restauration' from jsonb_array_elements(coalesce(p_nuits, '[]'::jsonb)) x
  on conflict (jour) do update set
    -- La même sauvegarde, déjà vue arrivée hors de la machine, garde la minute de son arrivée : la veille repose la nuit
    -- chaque minute, avec l'heure où elle l'a vérifiée.
    sauvegarde = case
      when excluded.sauvegarde is not null and s.sauvegarde->>'le' = excluded.sauvegarde->>'le'
           and coalesce((s.sauvegarde->'horsMachine'->>'ok')::boolean, false)
        then jsonb_set(excluded.sauvegarde, '{horsMachine}', s.sauvegarde->'horsMachine')
      else coalesce(excluded.sauvegarde, s.sauvegarde) end,
    copie_de_base = coalesce(excluded.copie_de_base, s.copie_de_base), restauration = coalesce(excluded.restauration, s.restauration);
  -- Ce qui est parti, une fois chacun.
  insert into plateforme.service_envoi (le, sorte, cle, titre, depuis, grave, courriel, sms, demande)
    select (x->>'le')::timestamptz, x->>'sorte', x->>'cle', x->>'titre', (x->>'depuis')::timestamptz, coalesce((x->>'grave')::boolean, false),
           (x->>'courriel')::boolean, (x->>'sms')::boolean,
           (select d.id from plateforme.service_demande d where d.id::text = x->>'demande')
      from jsonb_array_elements(coalesce(p_envois, '[]'::jsonb)) x
  on conflict do nothing;
  -- Un problème dit réglé que la base n'a jamais vu ouvert (une panne de la base elle-même : la veille ne pouvait pas le
  -- lui confier) s'écrit maintenant, fini, depuis son début.
  insert into plateforme.service_alerte (cle, titre, grave, a_ete_grave, debut, fin)
    select x->>'cle', x->>'titre', coalesce((x->>'grave')::boolean, false), coalesce((x->>'grave')::boolean, false),
           (x->>'depuis')::timestamptz, (x->>'le')::timestamptz
      from jsonb_array_elements(coalesce(p_envois, '[]'::jsonb)) x
     where x->>'sorte' = 'regle' and (x->>'depuis')::timestamptz <= (x->>'le')::timestamptz
       and not exists (select 1 from plateforme.service_alerte a where a.cle = x->>'cle'
                         and a.debut <= (x->>'le')::timestamptz and coalesce(a.fin, 'infinity') >= (x->>'depuis')::timestamptz);
  -- Une demande d'essai faite.
  update plateforme.service_demande d set faite_le = (x->>'le')::timestamptz
    from jsonb_array_elements(coalesce(p_envois, '[]'::jsonb)) x
   where x->>'demande' = d.id::text and d.faite_le is null;
  delete from plateforme.service_releve where minute < now() - interval '35 days';
  delete from plateforme.service_alerte where fin < now() - interval '400 days';
  delete from plateforme.service_nuit where jour < (now() - interval '400 days')::date;
  delete from plateforme.service_envoi where le < now() - interval '400 days';
  delete from plateforme.service_sourdine where fin < now() - interval '400 days';
  delete from plateforme.service_demande where le < now() - interval '400 days' and faite_le is not null;
end $$;

-- ── Lire : la console ────────────────────────────────────────────────────────────────────────────────────────────────
-- Les nuits gardées (quatre cents jours), le dernier relevé et l'état de ses copies, le plus long retard de la copie hors
-- de la machine heure par heure sur les vingt-quatre dernières, les exemplaires du programme qui ont servi dans l'heure,
-- et les remises d'une entreprise : leur nombre et la dernière pour tous, leur détail pour la direction.
create function plateforme.console_service_sauvegardes(p_maintenant timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']);
begin
  return jsonb_build_object(
    'nuits', (select coalesce(jsonb_agg(jsonb_build_object('jour', jour, 'sauvegarde', sauvegarde, 'copieDeBase', copie_de_base,
                'restauration', restauration) order by jour desc), '[]'::jsonb) from plateforme.service_nuit),
    'dernier', (select jsonb_build_object('minute', minute, 'archiveLe', archive_le, 'copies', copies)
                  from plateforme.service_releve order by minute desc limit 1),
    'retards', (select coalesce(jsonb_agg(jsonb_build_array(heure, plus_long, lues) order by heure), '[]'::jsonb) from (
                 select date_trunc('hour', minute) heure,
                        max(case when copies->'horsMachine'->>'attenteDepuis' is null then 0
                                 else greatest(0, extract(epoch from minute - (copies->'horsMachine'->>'attenteDepuis')::timestamptz)) end)::int plus_long,
                        count(*)::int lues
                   from plateforme.service_releve
                  where minute > p_maintenant - interval '24 hours' and coalesce((copies->'horsMachine'->>'regle')::boolean, false)
                  group by 1) r),
    'exemplaires', (select count(distinct exemplaire)::int from plateforme.service_minute where minute > p_maintenant - interval '1 hour'),
    'remisesFaites', (select jsonb_build_object('n', count(*), 'derniere', max(instant)) from socle.audit
                       where geste = 'socle.entreprise.remettre' and instant > p_maintenant - interval '400 days'),
    'remises', case when v_role = 'direction' then (
                 select coalesce(jsonb_agg(jsonb_build_object('le', a.instant, 'entreprise', a.entreprise, 'nom', e.raison_sociale,
                          'motif', a.apres->>'motif', 'minute', a.apres->>'minute',
                          'numerosRetires', coalesce(jsonb_array_length(a.apres->'numerosRetires'), 0),
                          -- Qui l'a préparée dans la console : le même client, le même motif, avant la remise.
                          'preparee', (select jsonb_build_object('par', u.nom, 'le', g.le) from plateforme.geste_console g join socle.utilisateur u on u.id = g.qui
                                        where g.geste = 'service.remise' and g.entreprise = a.entreprise and g.motif = a.apres->>'motif' and g.le <= a.instant
                                        order by g.le desc limit 1)) order by a.instant desc), '[]'::jsonb)
                   from socle.audit a join socle.entreprise e on e.id = a.entreprise
                  where a.geste = 'socle.entreprise.remettre' and a.instant > p_maintenant - interval '400 days') end);
end $$;

-- ── Écrire : la console ──────────────────────────────────────────────────────────────────────────────────────────────
-- Préparer la remise d'une entreprise (la direction) : la console compose les commandes, elle ne les exécute jamais ; le
-- geste va au journal — celui de la console et celui de l'entreprise — avec la minute visée et le motif, qui est celui
-- que la remise écrira dans la piste d'audit de l'entreprise (c'est ainsi que l'écran dit qui l'a préparée).
create function plateforme.console_preparer_remise(p_entreprise uuid, p_minute text, p_motif text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']);
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('une remise demande son motif (trois caractères au moins) : il entre dans la piste d''audit de l''entreprise'); end if;
  if coalesce(p_minute, '') !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$' then perform socle.refus('la minute d''une remise s''écrit AAAA-MM-JJ HH:MM, à l''heure de Tunis'); end if;
  if not exists (select 1 from socle.entreprise e where e.id = p_entreprise and not e.essai) then
    perform socle.refus('cette entreprise n''existe pas, ou c''est une entreprise d''exemple');
  end if;
  insert into plateforme.geste_console (qui, role, geste, motif, entreprise, apres)
    values (socle.moi(), v_role, 'service.remise', btrim(p_motif), p_entreprise, jsonb_build_object('minute', p_minute));
end $$;

revoke execute on function plateforme.console_service_sauvegardes(timestamptz), plateforme.console_preparer_remise(uuid, text, text) from public;
grant execute on function plateforme.console_service_sauvegardes(timestamptz), plateforme.console_preparer_remise(uuid, text, text) to skanfact_app;
