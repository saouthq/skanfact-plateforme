-- Le service de la plateforme, mesuré (Console 3, 13/10/2026 ; skanfact docs/cadrage/10-console.md § 2.8, 06 § 4 et
-- § 7, VISION-ARCHITECTURE.md § 6 ; docs/console.md C12). Ce que la console montre du service se lit ici :
--
-- 1. Les requêtes de l'API, telles que chaque exemplaire du programme les a servies : par minute et par sorte (la
--    dernière heure, le dernier jour), par heure et par sorte (la semaine, le mois), par jour et par route (quelle route
--    est lente). Combien, combien en panne (un 5xx : un refus écrit n'en est pas une), et la durée de chacune rangée
--    dans un seau (serveur/service/mesures.ts). Jamais une donnée de client : une route est un MODÈLE de chemin, sans
--    valeur ; ni l'entreprise, ni la personne.
-- 2. Le relevé de la veille, minute par minute (exploitation/veiller.ts) : le service répond-il, la charge et la mémoire
--    de la machine, l'occupation des disques.
-- 3. L'histoire des alertes : chaque problème que la veille a vu, quand il a commencé, quand il s'est réglé, sa gravité.
-- 4. Les nuits : la sauvegarde de la base, la copie de base, l'exercice de restauration, tels que la veille les a vus.
--
-- Écrit par le serveur et la veille (le compte du programme), par deux fonctions qui ADDITIONNENT ou rapprochent : un
-- envoi rejoué ne compte pas deux fois ce qu'il rapproche, et un envoi perdu ne fait qu'un trou (« non mesuré »). Lu par la
-- console, la direction et la technique : il n'y a ici aucune donnée de client. Gardé trois jours pour les minutes,
-- 35 jours pour les heures, les routes et les relevés, 400 jours pour les alertes et les nuits.

create function plateforme.ajouter_seaux(a int[], b int[]) returns int[]
language sql immutable set search_path = pg_catalog as $$
  select array(select coalesce(x, 0) + coalesce(y, 0) from unnest(a, b) as t(x, y))
$$;

-- ── 1. Les requêtes ──────────────────────────────────────────────────────────────────────────────────────────────────
create table plateforme.service_minute (
  minute timestamptz not null check (date_trunc('minute', minute) = minute),
  exemplaire text not null check (exemplaire ~ '^[A-Za-z0-9._:-]{1,80}$'),
  sorte text not null check (sorte in ('lecture', 'caisse', 'comptes', 'dossier', 'ecriture', 'console')),
  n int not null check (n >= 0),
  pannes int not null check (pannes between 0 and n),
  seaux int[] not null check (cardinality(seaux) = 47),
  primary key (minute, exemplaire, sorte)
);
create table plateforme.service_heure (
  heure timestamptz not null check (date_trunc('hour', heure) = heure),
  exemplaire text not null check (exemplaire ~ '^[A-Za-z0-9._:-]{1,80}$'),
  sorte text not null check (sorte in ('lecture', 'caisse', 'comptes', 'dossier', 'ecriture', 'console')),
  n int not null check (n >= 0),
  pannes int not null check (pannes between 0 and n),
  seaux int[] not null check (cardinality(seaux) = 47),
  primary key (heure, exemplaire, sorte)
);
create table plateforme.service_route (
  jour date not null,
  exemplaire text not null check (exemplaire ~ '^[A-Za-z0-9._:-]{1,80}$'),
  -- La méthode et le modèle de chemin, sans la version de l'API : « GET /entreprises/:entreprise/ventes/factures ».
  -- Jamais une valeur dans un chemin : ni un identifiant, ni un nombre (une année se dit « :annee »).
  route text not null check (route ~ '^(GET|POST|PUT|DELETE) /[A-Za-z0-9/:_.-]{0,200}$' and route !~ '/[0-9][^/]*(/|$)'
                             and route !~* '[0-9a-f]{8}-[0-9a-f]{4}'),
  sorte text not null check (sorte in ('lecture', 'caisse', 'comptes', 'dossier', 'ecriture', 'console')),
  n int not null check (n >= 0),
  pannes int not null check (pannes between 0 and n),
  seaux int[] not null check (cardinality(seaux) = 47),
  primary key (jour, exemplaire, route)
);

-- ── 2. Le relevé de la veille ────────────────────────────────────────────────────────────────────────────────────────
create table plateforme.service_releve (
  minute timestamptz primary key check (date_trunc('minute', minute) = minute),
  repond boolean not null,
  -- La charge de la machine sur une minute (le nombre de travaux qui attendent le processeur), en centièmes, et sa
  -- mémoire occupée, en pour cent.
  charge_cent int check (charge_cent >= 0),
  memoire smallint check (memoire between 0 and 100),
  processeurs smallint check (processeurs > 0),
  -- L'occupation de chaque disque qui compte : [{ point, pourcent }].
  disques jsonb not null default '[]'::jsonb,
  -- La version qui tourne (le commit), la fin du certificat https, le dernier journal de la base archivé : ce que la
  -- veille a lu à cette minute, rien s'il n'a pas pu se lire.
  version text check (version ~ '^[0-9a-f]{7,40}$'),
  certificat date,
  archive_le timestamptz
);

-- ── 3. Les alertes ───────────────────────────────────────────────────────────────────────────────────────────────────
create table plateforme.service_alerte (
  id uuid primary key default socle.uuidv7(),
  -- La clé de la veille (« service », « sauvegarde », « disque:/ ») : une alerte ouverte par clé au plus.
  cle text not null check (cle ~ '^[a-z-]+(:[A-Za-z0-9/._-]{1,120})?$'),
  titre text not null check (length(titre) between 1 and 300),
  grave boolean not null,
  -- Devenue grave en cours de route (une copie en retard d'une heure) : elle le reste dans l'histoire.
  a_ete_grave boolean not null,
  faire text not null default '',
  debut timestamptz not null,
  fin timestamptz,
  check (fin is null or fin >= debut),
  check (a_ete_grave or not grave)
);
create unique index service_alerte_ouverte on plateforme.service_alerte (cle) where fin is null;
create index service_alerte_debut on plateforme.service_alerte (debut desc);

-- ── 4. Les nuits ─────────────────────────────────────────────────────────────────────────────────────────────────────
create table plateforme.service_nuit (
  -- Le jour de Tunis où la sauvegarde s'est faite (celle de 02:16 le 13 est la nuit du 13).
  jour date primary key,
  -- Chacun : { le, ok } tel que son script l'a écrit, ou rien (pas cette nuit-là).
  sauvegarde jsonb,
  copie_de_base jsonb,
  restauration jsonb
);

alter table plateforme.service_minute enable row level security;
alter table plateforme.service_minute force row level security;
alter table plateforme.service_heure enable row level security;
alter table plateforme.service_heure force row level security;
alter table plateforme.service_route enable row level security;
alter table plateforme.service_route force row level security;
alter table plateforme.service_releve enable row level security;
alter table plateforme.service_releve force row level security;
alter table plateforme.service_alerte enable row level security;
alter table plateforme.service_alerte force row level security;
alter table plateforme.service_nuit enable row level security;
alter table plateforme.service_nuit force row level security;

-- ── Écrire : le serveur ──────────────────────────────────────────────────────────────────────────────────────────────
-- Ce qu'un exemplaire a mesuré depuis son dernier envoi (serveur/service/collecte.ts) : chaque ligne s'ADDITIONNE à ce
-- que la base a déjà pour la même minute, la même heure, le même jour. Le ménage d'après se fait dans la même foulée.
create function plateforme.noter_requetes(p_exemplaire text, p_envoi jsonb) returns void
language plpgsql volatile security definer set search_path = pg_catalog, plateforme as $$
begin
  insert into plateforme.service_minute as s (minute, exemplaire, sorte, n, pannes, seaux)
    select (x->>'minute')::timestamptz, p_exemplaire, x->>'sorte', (x->>'n')::int, (x->>'pannes')::int,
           array(select v::int from jsonb_array_elements_text(x->'h') v)
      from jsonb_array_elements(coalesce(p_envoi->'minutes', '[]'::jsonb)) x
  on conflict (minute, exemplaire, sorte) do update
    set n = s.n + excluded.n, pannes = s.pannes + excluded.pannes, seaux = plateforme.ajouter_seaux(s.seaux, excluded.seaux);
  insert into plateforme.service_heure as s (heure, exemplaire, sorte, n, pannes, seaux)
    select (x->>'heure')::timestamptz, p_exemplaire, x->>'sorte', (x->>'n')::int, (x->>'pannes')::int,
           array(select v::int from jsonb_array_elements_text(x->'h') v)
      from jsonb_array_elements(coalesce(p_envoi->'heures', '[]'::jsonb)) x
  on conflict (heure, exemplaire, sorte) do update
    set n = s.n + excluded.n, pannes = s.pannes + excluded.pannes, seaux = plateforme.ajouter_seaux(s.seaux, excluded.seaux);
  insert into plateforme.service_route as s (jour, exemplaire, route, sorte, n, pannes, seaux)
    select (x->>'jour')::date, p_exemplaire, x->>'route', x->>'sorte', (x->>'n')::int, (x->>'pannes')::int,
           array(select v::int from jsonb_array_elements_text(x->'h') v)
      from jsonb_array_elements(coalesce(p_envoi->'jours', '[]'::jsonb)) x
  on conflict (jour, exemplaire, route) do update
    set n = s.n + excluded.n, pannes = s.pannes + excluded.pannes, seaux = plateforme.ajouter_seaux(s.seaux, excluded.seaux);
  delete from plateforme.service_minute where minute < now() - interval '3 days';
  delete from plateforme.service_heure where heure < now() - interval '35 days';
  delete from plateforme.service_route where jour < (now() - interval '35 days')::date;
end $$;

-- ── Écrire : la veille ───────────────────────────────────────────────────────────────────────────────────────────────
-- Le relevé de la minute ; les problèmes en cours (ceux de veille.json : { cle: { titre, grave, faire, depuis } }) ; les
-- nuits vues. Les alertes se RAPPROCHENT de l'état de la veille, elles ne s'écrivent pas message par message : une
-- minute où la base ne répondait pas ne laisse pas une alerte ouverte pour toujours, ni une alerte oubliée.
create function plateforme.noter_veille(p_releve jsonb, p_problemes jsonb, p_nuits jsonb) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_maintenant timestamptz := (p_releve->>'minute')::timestamptz;
  v_derniere timestamptz := (select max(minute) from plateforme.service_releve);
begin
  insert into plateforme.service_releve (minute, repond, charge_cent, memoire, processeurs, disques, version, certificat, archive_le)
    values (v_maintenant, (p_releve->>'repond')::boolean, round((p_releve->>'charge')::numeric * 100)::int, (p_releve->>'memoire')::smallint,
            (p_releve->>'processeurs')::smallint, coalesce(p_releve->'disques', '[]'::jsonb), p_releve->>'version',
            (p_releve->>'certificat')::date, (p_releve->>'archiveLe')::timestamptz)
  on conflict (minute) do update set repond = excluded.repond, charge_cent = excluded.charge_cent, memoire = excluded.memoire,
    processeurs = excluded.processeurs, disques = excluded.disques, version = excluded.version, certificat = excluded.certificat,
    archive_le = excluded.archive_le;
  -- Les alertes suivent la DERNIÈRE nouvelle : un relevé plus ancien que le dernier reçu (une horloge revenue en arrière,
  -- un envoi rejoué) garde sa minute, mais ne règle ni n'ouvre rien — il fermerait une alerte avant son début.
  if v_derniere is null or v_maintenant >= v_derniere then
    -- Une alerte ouverte que la veille ne voit plus : réglée, maintenant.
    update plateforme.service_alerte a set fin = v_maintenant
     where a.fin is null and not (coalesce(p_problemes, '{}'::jsonb) ? a.cle);
    -- Celles qu'elle voit : la même reste ouverte (son titre et sa gravité suivent), une nouvelle s'ouvre depuis son début.
    update plateforme.service_alerte a set titre = p.value->>'titre', grave = (p.value->>'grave')::boolean,
           a_ete_grave = a.a_ete_grave or (p.value->>'grave')::boolean, faire = coalesce(p.value->>'faire', '')
      from jsonb_each(coalesce(p_problemes, '{}'::jsonb)) p
     where a.fin is null and a.cle = p.key;
    insert into plateforme.service_alerte (cle, titre, grave, a_ete_grave, faire, debut)
      select p.key, p.value->>'titre', (p.value->>'grave')::boolean, (p.value->>'grave')::boolean, coalesce(p.value->>'faire', ''),
             least((p.value->>'depuis')::timestamptz, v_maintenant)
        from jsonb_each(coalesce(p_problemes, '{}'::jsonb)) p
       where not exists (select 1 from plateforme.service_alerte a where a.fin is null and a.cle = p.key);
  end if;
  insert into plateforme.service_nuit as s (jour, sauvegarde, copie_de_base, restauration)
    select (x->>'jour')::date, x->'sauvegarde', x->'copieDeBase', x->'restauration' from jsonb_array_elements(coalesce(p_nuits, '[]'::jsonb)) x
  on conflict (jour) do update set sauvegarde = coalesce(excluded.sauvegarde, s.sauvegarde),
    copie_de_base = coalesce(excluded.copie_de_base, s.copie_de_base), restauration = coalesce(excluded.restauration, s.restauration);
  delete from plateforme.service_releve where minute < now() - interval '35 days';
  delete from plateforme.service_alerte where fin < now() - interval '400 days';
  delete from plateforme.service_nuit where jour < (now() - interval '400 days')::date;
end $$;

-- ── Lire : la console ────────────────────────────────────────────────────────────────────────────────────────────────
-- La direction et la technique (03 § 5 : la technique voit le service, et il n'y a ici aucune donnée de client).

-- Additionner des seaux sur des lignes (deux exemplaires, plusieurs minutes) : un état vide se complète de zéros.
create aggregate plateforme.somme_seaux(int[]) (sfunc = plateforme.ajouter_seaux, stype = int[], initcond = '{}');

-- Une série : depuis un instant, par pas (dix minutes, une heure, six heures), le nombre de requêtes et de pannes de toutes
-- les sortes, et les seaux d'UNE sorte (celle dont le budget se lit : les listes et les fiches). Lue dans les minutes
-- (le dernier jour) ou dans les heures (le mois).
create function plateforme.console_service_serie(p_depuis timestamptz, p_pas interval, p_grain text, p_sorte text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'technique']);
  if p_grain = 'minute' then
    return (select coalesce(jsonb_agg(jsonb_build_array(t, n, pannes, seaux) order by t), '[]'::jsonb) from (
      select date_bin(p_pas, minute, p_depuis) t, sum(n)::int n, sum(pannes)::int pannes,
             plateforme.somme_seaux(seaux) filter (where sorte = p_sorte) seaux
        from plateforme.service_minute where minute >= p_depuis group by 1) x);
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_array(t, n, pannes, seaux) order by t), '[]'::jsonb) from (
    select date_bin(p_pas, heure, p_depuis) t, sum(n)::int n, sum(pannes)::int pannes,
           plateforme.somme_seaux(seaux) filter (where sorte = p_sorte) seaux
      from plateforme.service_heure where heure >= p_depuis group by 1) x);
end $$;

-- Ce que la veille a vu depuis un instant : par jour de Tunis, les minutes relevées et celles où le service ne répondait
-- pas ; chaque coupure (des minutes sans réponse qui se suivent) ; la dernière heure de la machine ; les alertes ouvertes
-- ou finies depuis ; les nuits depuis.
create function plateforme.console_service_veille(p_depuis timestamptz) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_depuis_heure timestamptz := greatest(p_depuis, (select max(minute) from plateforme.service_releve) - interval '59 minutes');
begin
  perform plateforme.exiger_role_console(array['direction', 'technique']);
  return jsonb_build_object(
    'jours', (select coalesce(jsonb_agg(jsonb_build_array(jour, mesurees, bas) order by jour), '[]'::jsonb) from (
               select (minute at time zone 'Africa/Tunis')::date jour, count(*)::int mesurees, (count(*) filter (where not repond))::int bas
                 from plateforme.service_releve where minute >= p_depuis group by 1) x),
    'coupures', (select coalesce(jsonb_agg(jsonb_build_array(debut, fin, minutes) order by debut desc), '[]'::jsonb) from (
                   select min(minute) debut, max(minute) fin, count(*)::int minutes from (
                     select minute, minute - (row_number() over (order by minute)) * interval '1 minute' groupe
                       from plateforme.service_releve where minute >= p_depuis and not repond) b
                    group by groupe) c),
    'machine', (select coalesce(jsonb_agg(jsonb_build_array(minute, repond, charge_cent / 100.0, memoire, processeurs, disques) order by minute), '[]'::jsonb)
                  from plateforme.service_releve where minute >= v_depuis_heure),
    -- Le dernier relevé : la version, le certificat, le dernier journal archivé.
    'dernier', (select jsonb_build_object('minute', minute, 'version', version, 'certificat', certificat, 'archiveLe', archive_le)
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

-- Par le serveur et la veille seulement.
revoke execute on function plateforme.ajouter_seaux(int[], int[]), plateforme.noter_requetes(text, jsonb), plateforme.noter_veille(jsonb, jsonb, jsonb),
  plateforme.console_service_serie(timestamptz, interval, text, text), plateforme.console_service_veille(timestamptz) from public;
grant execute on function plateforme.noter_requetes(text, jsonb), plateforme.noter_veille(jsonb, jsonb, jsonb),
  plateforme.console_service_serie(timestamptz, interval, text, text), plateforme.console_service_veille(timestamptz) to skanfact_app;
