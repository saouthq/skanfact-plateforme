-- Les alertes du service, suivies par l'équipe (Console 3, troisième partie, 13/10/2026 ; skanfact
-- docs/cadrage/10-console.md § 2.8, 06 § 7 ; docs/console.md C13). Ce que la console fait d'une alerte, et ce que la
-- veille en dit :
--
-- 1. Chaque message de la veille (un nouveau problème, un rappel, un problème réglé, un essai) et par quel moyen il est
--    parti : l'histoire d'une alerte dit qui a été prévenu, et quand. « Parti » veut dire remis au relais d'e-mails ou à
--    WinSMS, jamais « reçu » : la veille n'en sait pas plus.
-- 2. La sourdine : une RÈGLE de la veille qui ne prévient plus personne pendant une durée choisie, jamais plus de quatre
--    heures quand elle a une alerte grave ouverte. Ce qu'elle voit reste affiché ici et sur la page d'état.
-- 3. La prise en charge : qui s'occupe d'une alerte ouverte. Rien ne change sur le serveur ; les rappels continuent.
-- 4. Les demandes de la console à la veille : une alerte d'essai, envoyée la minute suivante. La console ne touche jamais
--    au serveur : elle laisse une demande, la veille la lit, et dit ce qui est parti.
-- 5. Ce que la veille lit de la base chaque minute : les sourdines en cours, les demandes, et les mesures des dernières
--    minutes (ses deux règles neuves : les pannes, le temps de réponse).
-- 6. Ce que la veille écrit en plus : la règle et les étapes de chaque alerte (des phrases, et ce qu'on copie : une
--    commande, un chemin), ce que ses deux règles neuves ont lu, et ses destinataires, MASQUÉS (« s•••@•••.tn »,
--    « +216 •• ••• 456 ») : jamais une adresse entière ici.
--
-- Écrit par la veille (le compte du programme) et par la console (direction et technique : 03 § 5, aucune donnée de
-- client ici). Une sourdine, une prise en charge, une demande laissent leur ligne au journal de la console.

-- ── 4. Les demandes de la console à la veille ────────────────────────────────────────────────────────────────────────
create table plateforme.service_demande (
  id uuid primary key default socle.uuidv7(),
  sorte text not null check (sorte in ('essai')),
  le timestamptz not null,
  qui uuid not null references socle.utilisateur(id),
  motif text not null check (length(btrim(motif)) >= 3),
  -- Faite par la veille (son message est dans service_envoi).
  faite_le timestamptz,
  check (faite_le is null or faite_le >= le)
);
-- Une demande de chaque sorte attend au plus : la veille la prend la minute suivante.
create unique index service_demande_en_attente on plateforme.service_demande (sorte) where faite_le is null;

-- ── 1. Les messages de la veille ─────────────────────────────────────────────────────────────────────────────────────
create table plateforme.service_envoi (
  id uuid primary key default socle.uuidv7(),
  le timestamptz not null,
  sorte text not null check (sorte in ('nouveau', 'rappel', 'regle', 'essai')),
  -- Le problème (sa clé, son titre au moment du message, son début) ; rien pour un essai.
  cle text check (cle ~ '^[a-z-]+(:[A-Za-z0-9/._-]{1,120})?$'),
  titre text check (length(titre) between 1 and 300),
  depuis timestamptz,
  grave boolean not null default false,
  -- Par e-mail, par SMS : parti (vrai), pas parti (faux), rien par ce moyen (vide : pas réglé, ou rien à dire par SMS).
  courriel boolean,
  sms boolean,
  -- L'essai que la console a demandé, s'il en vient un.
  demande uuid references plateforme.service_demande(id) on delete set null,
  check ((sorte = 'essai') = (cle is null)),
  check ((cle is null) = (titre is null) and (cle is null) = (depuis is null)),
  check (demande is null or sorte = 'essai')
);
-- Un message ne s'écrit qu'une fois : la veille renvoie ce que la base n'a pas pris (une base qui ne répondait pas), et
-- un envoi rejoué ne double rien.
create unique index service_envoi_une_fois on plateforme.service_envoi (le, sorte, coalesce(cle, ''), coalesce(demande::text, ''));
create index service_envoi_le on plateforme.service_envoi (le desc);

-- ── 2. La sourdine ───────────────────────────────────────────────────────────────────────────────────────────────────
create table plateforme.service_sourdine (
  id uuid primary key default socle.uuidv7(),
  -- La règle de la veille (exploitation/veille.ts, REGLES) : « disques » tait chaque disque.
  regle text not null check (regle ~ '^[a-z-]{1,40}$'),
  debut timestamptz not null,
  fin timestamptz not null,
  qui uuid not null references socle.utilisateur(id),
  motif text not null check (length(btrim(motif)) >= 3),
  -- Levée avant sa fin, et par qui.
  levee_le timestamptz,
  levee_par uuid references socle.utilisateur(id),
  check (fin > debut and fin <= debut + interval '24 hours'),
  check ((levee_le is null) = (levee_par is null)),
  check (levee_le is null or levee_le >= debut)
);
create index service_sourdine_regle on plateforme.service_sourdine (regle, debut desc);

-- ── 3. La prise en charge ; 6. la règle et les étapes d'une alerte ──────────────────────────────────────────────────
alter table plateforme.service_alerte
  add column regle text check (regle ~ '^[a-z-]{1,40}$'),
  add column etapes jsonb not null default '[]'::jsonb,
  add column prise_par uuid references socle.utilisateur(id),
  add column prise_le timestamptz,
  add column prise_motif text,
  add constraint service_alerte_prise check ((prise_par is null) = (prise_le is null) and (prise_par is null) = (prise_motif is null));

-- ── 6. Le relevé : qui est prévenu (masqué), et ce que les deux règles des requêtes ont lu ──────────────────────────
alter table plateforme.service_releve
  add column destinataires jsonb,
  add column regles jsonb;

alter table plateforme.service_demande enable row level security;
alter table plateforme.service_demande force row level security;
alter table plateforme.service_envoi enable row level security;
alter table plateforme.service_envoi force row level security;
alter table plateforme.service_sourdine enable row level security;
alter table plateforme.service_sourdine force row level security;

-- ── Écrire : la veille ───────────────────────────────────────────────────────────────────────────────────────────────
-- La fonction de 0085, avec un quatrième argument : ce qui est parti. Vide par défaut, pour qu'une veille encore à
-- l'ancienne version l'appelle comme avant pendant une mise à jour (deux fonctions du même nom, l'une à trois arguments
-- et l'autre à quatre dont un par défaut, rendraient l'appel ambigu : l'ancienne s'efface).
drop function plateforme.noter_veille(jsonb, jsonb, jsonb);
create function plateforme.noter_veille(p_releve jsonb, p_problemes jsonb, p_nuits jsonb, p_envois jsonb default '[]'::jsonb) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_maintenant timestamptz := (p_releve->>'minute')::timestamptz;
  v_derniere timestamptz := (select max(minute) from plateforme.service_releve);
begin
  insert into plateforme.service_releve (minute, repond, charge_cent, memoire, processeurs, disques, version, certificat, archive_le, destinataires, regles)
    values (v_maintenant, (p_releve->>'repond')::boolean, round((p_releve->>'charge')::numeric * 100)::int, (p_releve->>'memoire')::smallint,
            (p_releve->>'processeurs')::smallint, coalesce(p_releve->'disques', '[]'::jsonb), p_releve->>'version',
            (p_releve->>'certificat')::date, (p_releve->>'archiveLe')::timestamptz,
            nullif(p_releve->'destinataires', 'null'::jsonb), nullif(p_releve->'regles', 'null'::jsonb))
  on conflict (minute) do update set repond = excluded.repond, charge_cent = excluded.charge_cent, memoire = excluded.memoire,
    processeurs = excluded.processeurs, disques = excluded.disques, version = excluded.version, certificat = excluded.certificat,
    archive_le = excluded.archive_le, destinataires = excluded.destinataires, regles = excluded.regles;
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
  on conflict (jour) do update set sauvegarde = coalesce(excluded.sauvegarde, s.sauvegarde),
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

-- ── Lire : la veille ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Ce que la veille lit de la base, chaque minute, avant de décider (exploitation/veiller.ts) : les sourdines en cours, les
-- demandes qui attendent, et les mesures des dernières minutes FINIES, toutes sortes et tous exemplaires additionnés (les
-- seaux : ceux des listes et des fiches seulement). Rien d'un client.
create function plateforme.veille_lire(p_maintenant timestamptz, p_minutes int) returns jsonb
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
                   group by minute) m));
$$;

-- ── Écrire : la console ──────────────────────────────────────────────────────────────────────────────────────────────
-- Prendre une alerte en charge (direction, technique) : son nom s'affiche ; rien ne change sur le serveur, les rappels
-- continuent. Une alerte réglée ne se prend plus ; une alerte prise par quelqu'un d'autre se reprend (le journal dit qui
-- l'avait).
create function plateforme.console_prendre_alerte(p_alerte uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_a plateforme.service_alerte;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur une alerte demande son motif (trois caractères au moins)'); end if;
  select * into v_a from plateforme.service_alerte a where a.id = p_alerte for update;
  if not found then perform socle.refus('cette alerte n''existe pas'); end if;
  if v_a.fin is not null then perform socle.refus('cette alerte est déjà réglée : il n''y a plus rien à prendre en charge'); end if;
  if v_a.prise_par = socle.moi() then perform socle.refus('tu as déjà pris cette alerte en charge'); end if;
  update plateforme.service_alerte set prise_par = socle.moi(), prise_le = p_maintenant, prise_motif = btrim(p_motif) where id = p_alerte;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'service.prendre', btrim(p_motif), jsonb_build_object('alerte', v_a.id, 'cle', v_a.cle, 'prisePar', v_a.prise_par),
            jsonb_build_object('alerte', v_a.id, 'cle', v_a.cle, 'prisePar', socle.moi()));
end $$;

-- Mettre une règle de la veille en sourdine (direction, technique) : elle regarde toujours, elle ne prévient plus personne
-- jusqu'à la fin choisie. Un quart d'heure à un jour ; quatre heures au plus quand elle a une alerte grave ouverte (la
-- veille borne aussi à quatre heures une alerte qui DEVIENT grave pendant la sourdine). Une seule sourdine à la fois par
-- règle. La règle se nomme comme la veille la nomme : la console ne propose que les siennes.
create function plateforme.console_sourdine(p_regle text, p_minutes int, p_motif text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_id uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur une alerte demande son motif (trois caractères au moins)'); end if;
  if coalesce(p_regle, '') !~ '^[a-z-]{1,40}$' then perform socle.refus('la veille n''a pas de règle à ce nom'); end if;
  if coalesce(p_minutes, 0) not between 15 and 1440 then perform socle.refus('une sourdine dure d''un quart d''heure à un jour'); end if;
  if p_minutes > 240 and exists (select 1 from plateforme.service_alerte a where a.regle = p_regle and a.fin is null and a.grave) then
    perform socle.refus('une alerte grave ne se met pas en sourdine plus de quatre heures');
  end if;
  if exists (select 1 from plateforme.service_sourdine s where s.regle = p_regle and s.levee_le is null and s.fin > p_maintenant) then
    perform socle.refus('cette règle est déjà en sourdine : lève la sourdine en cours d''abord');
  end if;
  insert into plateforme.service_sourdine (regle, debut, fin, qui, motif)
    values (p_regle, p_maintenant, p_maintenant + make_interval(mins => p_minutes), socle.moi(), btrim(p_motif)) returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, motif, apres)
    values (socle.moi(), v_role, 'service.sourdine', btrim(p_motif), jsonb_build_object('regle', p_regle, 'fin', p_maintenant + make_interval(mins => p_minutes)));
  return v_id;
end $$;

-- Lever une sourdine avant sa fin : la veille prévient de nouveau dès la minute suivante.
create function plateforme.console_lever_sourdine(p_sourdine uuid, p_motif text, p_maintenant timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_s plateforme.service_sourdine;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur une alerte demande son motif (trois caractères au moins)'); end if;
  select * into v_s from plateforme.service_sourdine s where s.id = p_sourdine for update;
  if not found or v_s.levee_le is not null or v_s.fin <= p_maintenant then perform socle.refus('cette sourdine est déjà finie'); end if;
  update plateforme.service_sourdine set levee_le = greatest(p_maintenant, v_s.debut), levee_par = socle.moi() where id = p_sourdine;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'service.sourdine_levee', btrim(p_motif), jsonb_build_object('regle', v_s.regle, 'fin', v_s.fin),
            jsonb_build_object('regle', v_s.regle, 'fin', p_maintenant));
end $$;

-- Demander une alerte d'essai : la veille l'envoie la minute suivante, par chaque moyen réglé, et dit ce qui est parti.
create function plateforme.console_demander_essai(p_motif text, p_maintenant timestamptz) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'technique']); v_id uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur une alerte demande son motif (trois caractères au moins)'); end if;
  if exists (select 1 from plateforme.service_demande d where d.sorte = 'essai' and d.faite_le is null) then
    perform socle.refus('une alerte d''essai attend déjà son tour : la veille l''envoie dans la minute');
  end if;
  insert into plateforme.service_demande (sorte, le, qui, motif) values ('essai', p_maintenant, socle.moi(), btrim(p_motif)) returning id into v_id;
  insert into plateforme.geste_console (qui, role, geste, motif, apres) values (socle.moi(), v_role, 'service.essai', btrim(p_motif), jsonb_build_object('demande', v_id));
  return v_id;
end $$;

-- ── Lire : la console ────────────────────────────────────────────────────────────────────────────────────────────────
-- Les alertes (direction, technique) : celles qui sont ouvertes et celles depuis un instant (trente jours), avec qui les a
-- prises en charge ; les messages et les sourdines de la période (et depuis le début de la plus vieille alerte encore
-- ouverte) ; la dernière alerte de chaque clé (sur tout ce que la base garde, 400 jours) ; les dernières demandes ; le
-- dernier relevé (les destinataires masqués, ce que les règles des requêtes ont lu).
create function plateforme.console_service_alertes(p_depuis timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_debut timestamptz;
begin
  perform plateforme.exiger_role_console(array['direction', 'technique']);
  v_debut := least(p_depuis, coalesce((select min(debut) from plateforme.service_alerte where fin is null), p_depuis));
  return jsonb_build_object(
    'alertes', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'cle', a.cle, 'regle', a.regle, 'titre', a.titre, 'grave', a.grave,
                    'aEteGrave', a.a_ete_grave, 'faire', a.faire, 'etapes', a.etapes, 'debut', a.debut, 'fin', a.fin,
                    'prise', case when a.prise_par is null then null else jsonb_build_object('par', u.nom, 'le', a.prise_le, 'motif', a.prise_motif,
                                                                                         'moi', a.prise_par = socle.moi()) end)
                  order by a.debut desc, a.id desc), '[]'::jsonb)
                  from plateforme.service_alerte a left join socle.utilisateur u on u.id = a.prise_par
                 where a.fin is null or a.fin >= p_depuis),
    'envois', (select coalesce(jsonb_agg(jsonb_build_object('le', e.le, 'sorte', e.sorte, 'cle', e.cle, 'titre', e.titre, 'grave', e.grave,
                    'courriel', e.courriel, 'sms', e.sms, 'demande', e.demande) order by e.le), '[]'::jsonb)
                 from plateforme.service_envoi e where e.le >= v_debut),
    'sourdines', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'regle', s.regle, 'debut', s.debut, 'fin', s.fin, 'par', u.nom, 'motif', s.motif,
                    'leveeLe', s.levee_le, 'leveePar', l.nom) order by s.debut), '[]'::jsonb)
                    from plateforme.service_sourdine s join socle.utilisateur u on u.id = s.qui left join socle.utilisateur l on l.id = s.levee_par
                   where s.fin >= v_debut),
    'dernieres', (select coalesce(jsonb_agg(jsonb_build_object('cle', d.cle, 'debut', d.debut, 'fin', d.fin, 'grave', d.a_ete_grave)), '[]'::jsonb) from (
                    select distinct on (cle) cle, debut, fin, a_ete_grave from plateforme.service_alerte order by cle, debut desc) d),
    'demandes', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'sorte', d.sorte, 'le', d.le, 'par', u.nom, 'faiteLe', d.faite_le) order by d.le desc), '[]'::jsonb)
                   from (select * from plateforme.service_demande order by le desc limit 5) d join socle.utilisateur u on u.id = d.qui),
    'releve', (select jsonb_build_object('minute', r.minute, 'destinataires', r.destinataires, 'regles', r.regles)
                 from plateforme.service_releve r order by r.minute desc limit 1));
end $$;

-- Ce que la veille a vu (0085), avec ce que les règles des requêtes ont lu : par jour, les minutes où elles ont pu juger ;
-- au dernier relevé, leur état.
create or replace function plateforme.console_service_veille(p_depuis timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_depuis_heure timestamptz := greatest(p_depuis, (select max(minute) from plateforme.service_releve) - interval '59 minutes');
begin
  perform plateforme.exiger_role_console(array['direction', 'technique']);
  return jsonb_build_object(
    -- Par jour, aussi les minutes où la veille a pu juger les requêtes (une des deux règles calme ou en alerte) : la brique
    -- « les requêtes » n'est bonne que les jours où elle a été jugée.
    'jours', (select coalesce(jsonb_agg(jsonb_build_array(jour, mesurees, bas, requetes) order by jour), '[]'::jsonb) from (
               select (minute at time zone 'Africa/Tunis')::date jour, count(*)::int mesurees, (count(*) filter (where not repond))::int bas,
                      (count(*) filter (where regles->'pannes'->>'etat' in ('calme', 'alerte') or regles->'temps'->>'etat' in ('calme', 'alerte')))::int requetes
                 from plateforme.service_releve where minute >= p_depuis group by 1) x),
    'coupures', (select coalesce(jsonb_agg(jsonb_build_array(debut, fin, minutes) order by debut desc), '[]'::jsonb) from (
                   select min(minute) debut, max(minute) fin, count(*)::int minutes from (
                     select minute, minute - (row_number() over (order by minute)) * interval '1 minute' groupe
                       from plateforme.service_releve where minute >= p_depuis and not repond) b
                    group by groupe) c),
    'machine', (select coalesce(jsonb_agg(jsonb_build_array(minute, repond, charge_cent / 100.0, memoire, processeurs, disques) order by minute), '[]'::jsonb)
                  from plateforme.service_releve where minute >= v_depuis_heure),
    -- Le dernier relevé : la version, le certificat, le dernier journal archivé.
    'dernier', (select jsonb_build_object('minute', minute, 'version', version, 'certificat', certificat, 'archiveLe', archive_le, 'regles', regles)
                  from plateforme.service_releve order by minute desc limit 1),
    -- Chaque version vue, d'une suite de relevés à l'autre : sa première et sa dernière minute. Une version qui revient
    -- après une autre (un retour en arrière) fait une seconde suite, donc une seconde mise en ligne.
    'versions', (select coalesce(jsonb_agg(jsonb_build_array(version, debut, fin) order by debut desc), '[]'::jsonb) from (
                   select version, min(minute) debut, max(minute) fin from (
                     select minute, version, row_number() over (order by minute) - row_number() over (partition by version order by minute) suite
                       from plateforme.service_releve where minute >= p_depuis and version is not null) r
                    group by version, suite) v),
    'alertes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'cle', cle, 'titre', titre, 'grave', grave, 'aEteGrave', a_ete_grave,
                    'faire', faire, 'debut', debut, 'fin', fin) order by debut desc, id desc), '[]'::jsonb)
                  from plateforme.service_alerte where fin is null or fin >= p_depuis),
    'nuits', (select coalesce(jsonb_agg(jsonb_build_object('jour', jour, 'sauvegarde', sauvegarde, 'copieDeBase', copie_de_base,
                    'restauration', restauration) order by jour desc), '[]'::jsonb)
                from plateforme.service_nuit where jour >= (p_depuis at time zone 'Africa/Tunis')::date),
    'exercice', (select jsonb_build_object('jour', jour, 'restauration', restauration) from plateforme.service_nuit
                  where restauration is not null order by jour desc limit 1));
end $$;

revoke execute on function plateforme.noter_veille(jsonb, jsonb, jsonb, jsonb), plateforme.veille_lire(timestamptz, int),
  plateforme.console_prendre_alerte(uuid, text, timestamptz), plateforme.console_sourdine(text, int, text, timestamptz),
  plateforme.console_lever_sourdine(uuid, text, timestamptz), plateforme.console_demander_essai(text, timestamptz),
  plateforme.console_service_alertes(timestamptz) from public;
grant execute on function plateforme.noter_veille(jsonb, jsonb, jsonb, jsonb), plateforme.veille_lire(timestamptz, int),
  plateforme.console_prendre_alerte(uuid, text, timestamptz), plateforme.console_sourdine(text, int, text, timestamptz),
  plateforme.console_lever_sourdine(uuid, text, timestamptz), plateforme.console_demander_essai(text, timestamptz),
  plateforme.console_service_alertes(timestamptz) to skanfact_app;
