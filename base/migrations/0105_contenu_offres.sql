-- 0105 — Ce que chaque offre comprend se règle dans la console (Réglages ; docs/abonnement.md C16 ; skanfact
-- docs/cadrage/07-offres-et-prix.md « Tout se règle depuis la console », décidé par Skander le 14/10/2026).
--
-- Jusqu'ici, ce qu'une offre comprend s'écrivait dans une fonction (plateforme.inclus_de_l_offre, 0100 puis 0102 : une
-- caisse, un établissement et dix salariés avec la paie pour Essentiel ; deux, deux et vingt pour Complet) et dans le
-- code (serveur/abonnement/offre.ts : la paie et la comptabilité complète fermées sur Essentiel). C'est maintenant un
-- CONTENU daté, que la direction prépare comme un prix :
--   - un changement de contenu est un changement commercial : il se prépare avec le même PRÉAVIS qu'un prix (0103, la
--     règle `preavis_prix`), un seul à venir à la fois pour une même ligne, jamais l'identique ; il se retire avant sa
--     date, et un contenu en vigueur ou passé ne change ni ne disparaît ;
--   - il vaut pour les PÉRIODES qui commencent à sa date ou après, jamais pour une période commencée : la facture d'une
--     période compte ce qui dépasse l'offre d'après le contenu de son premier jour (comme son prix, 0103), et un module
--     reste ouvert ou fermé jusqu'à la fin de la période payée (serveur/abonnement/offre.ts).

-- ── 1. Le contenu, daté ──────────────────────────────────────────────────────────────────────────────────────────────
-- Une ligne par offre et par chose comprise : un nombre (les caisses, les établissements, les salariés qu'on paie avec
-- la paie), ou un module (1 : l'offre le contient ; 0 : il s'achète seul).
create table plateforme.contenu_offre (
  id uuid primary key default socle.uuidv7(),
  offre text not null check (offre in ('essentiel', 'complet')),
  quoi text not null check (quoi in ('caisses', 'etablissements', 'salaries', 'paie', 'compta')),
  nombre integer not null check (nombre between 0 and 1000),
  a_partir_du date not null,
  motif text not null check (length(btrim(motif)) >= 3),
  -- Qui l'a préparé ; vide : une migration (le contenu de départ, écrit dans le cadrage).
  qui uuid references socle.utilisateur(id),
  le timestamptz not null default now(),
  check (quoi not in ('paie', 'compta') or nombre in (0, 1)),
  unique (offre, quoi, a_partir_du)
);
alter table plateforme.contenu_offre enable row level security;
alter table plateforme.contenu_offre force row level security;

-- Comme un prix : jamais modifié ; effacé seulement tant qu'il est à venir (au calendrier de Tunis).
create function plateforme.contenu_intouchable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'un contenu d''offre posé ne se modifie pas : on en prépare un nouveau, daté' using errcode = '42501';
  end if;
  if old.a_partir_du <= (now() at time zone 'Africa/Tunis')::date then
    raise exception 'un contenu d''offre en vigueur ou passé ne s''efface jamais' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger contenu_intouchable before update or delete on plateforme.contenu_offre
  for each row execute function plateforme.contenu_intouchable();

-- Le contenu de départ : celui de 0102 et de serveur/abonnement/offre.ts, depuis toujours.
insert into plateforme.contenu_offre (offre, quoi, nombre, a_partir_du, motif) values
  ('essentiel', 'caisses', 1, '2000-01-01', 'Cadrage 07 (27/09/2026) : le contenu de départ'),
  ('essentiel', 'etablissements', 1, '2000-01-01', 'Cadrage 07 (27/09/2026) : le contenu de départ'),
  ('essentiel', 'salaries', 10, '2000-01-01', 'Cadrage 07 (27/09/2026) : le contenu de départ'),
  ('essentiel', 'paie', 0, '2000-01-01', 'Cadrage 07 (27/09/2026) : le contenu de départ'),
  ('essentiel', 'compta', 0, '2000-01-01', 'Cadrage 07 (27/09/2026) : le contenu de départ'),
  ('complet', 'caisses', 2, '2000-01-01', 'Cadrage 07 (27/09/2026) : le contenu de départ'),
  ('complet', 'etablissements', 2, '2000-01-01', 'Cadrage 07 (27/09/2026) : le contenu de départ'),
  ('complet', 'salaries', 20, '2000-01-01', 'Cadrage 07 (27/09/2026) : le contenu de départ'),
  ('complet', 'paie', 1, '2000-01-01', 'Cadrage 07 (27/09/2026) : le contenu de départ'),
  ('complet', 'compta', 1, '2000-01-01', 'Cadrage 07 (27/09/2026) : le contenu de départ');

-- Le contenu d'une offre un jour donné : chaque ligne, la dernière qui vaut ce jour-là (rien si aucune).
create function plateforme.contenu_du_jour(p_offre text, p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select coalesce(jsonb_object_agg(q.quoi, (select c.nombre from plateforme.contenu_offre c
                                             where c.offre = p_offre and c.quoi = q.quoi and c.a_partir_du <= p_jour
                                             order by c.a_partir_du desc limit 1)), '{}'::jsonb)
    from unnest(array['caisses', 'etablissements', 'salaries', 'paie', 'compta']) q(quoi)
$$;

-- Son histoire, de la plus ancienne à la plus récente, pour l'état d'un abonnement (les modules qu'une période ouvre).
create function plateforme.contenu_histoire() returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select coalesce(jsonb_object_agg(o.offre, (
      select coalesce(jsonb_object_agg(m.quoi, (
          select coalesce(jsonb_agg(jsonb_build_object('aPartirDu', c.a_partir_du, 'jours', jsonb_build_array(c.nombre)) order by c.a_partir_du), '[]'::jsonb)
            from plateforme.contenu_offre c where c.offre = o.offre and c.quoi = m.quoi)), '{}'::jsonb)
        from unnest(array['paie', 'compta']) m(quoi))), '{}'::jsonb)
    from unnest(array['essentiel', 'complet']) o(offre)
$$;

-- ── 2. Ce que l'offre comprend, lu dans le contenu du jour donné ─────────────────────────────────────────────────────
-- Les salariés ne se comptent qu'avec la paie : celle que l'offre contient, ou celle achetée seule (0099).
create function plateforme.inclus_de_l_offre(p_offre text, p_modules text[], p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select case when p_offre in ('essentiel', 'complet') then jsonb_build_object(
      'caisses', (c->>'caisses')::int, 'etablissements', (c->>'etablissements')::int,
      'salaries', case when (c->>'paie')::int = 1 or 'paie' = any(coalesce(p_modules, '{}')) then (c->>'salaries')::int end) end
    from (select plateforme.contenu_du_jour(p_offre, p_jour) c) x
$$;

-- Ce que l'offre compte, pour « Ton abonnement » : le contenu de la période qui court (`p_contenu_au`, son premier jour).
create or replace function plateforme.ce_que_l_offre_compte(p_entreprise uuid, p_offre text, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  return plateforme.ce_que_l_offre_compte(p_entreprise, p_offre, p_jour, p_jour);
end $$;
create function plateforme.ce_que_l_offre_compte(p_entreprise uuid, p_offre text, p_jour date, p_contenu_au date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is null or socle.ma_cle() is not null or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']::text[]) then
    return null;
  end if;
  return jsonb_build_object('comptes', plateforme.comptes_de_l_entreprise(p_entreprise, p_jour),
    'inclus', plateforme.inclus_de_l_offre(p_offre, (select a.modules from plateforme.abonnement a where a.entreprise = p_entreprise), p_contenu_au));
end $$;

-- La facture d'une période : comptée le jour de la préparation (`p_jour`), au prix ET au contenu de son premier jour
-- (`p_prix_au`). Un module acheté seul se facture quand l'offre ne le contient pas ce jour-là.
create or replace function plateforme.lignes_en_plus(p_entreprise uuid, p_offre text, p_periodicite text, p_jour date, p_prix_au date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, caisse, plateforme as $$
declare
  v_modules text[] := coalesce((select a.modules from plateforme.abonnement a where a.entreprise = p_entreprise), '{}');
  v_comptes jsonb := plateforme.comptes_de_l_entreprise(p_entreprise, p_jour);
  v_contenu jsonb := plateforme.contenu_du_jour(p_offre, p_prix_au);
  v_inclus jsonb := plateforme.inclus_de_l_offre(p_offre, v_modules, p_prix_au);
  v_lignes jsonb := '[]'::jsonb;
  v_c record;
  v_prix bigint;
begin
  for v_c in
    select x.option, x.compte, x.inclus,
           case when x.option like 'module_%' then x.compte when x.inclus is null then 0 else greatest(x.compte - x.inclus, 0) end quantite
      from (values
        ('module_paie', case when coalesce((v_contenu->>'paie')::int, 0) = 0 and 'paie' = any(v_modules) then 1 else 0 end, 0),
        ('module_compta', case when coalesce((v_contenu->>'compta')::int, 0) = 0 and 'compta' = any(v_modules) then 1 else 0 end, 0),
        ('caisse', (v_comptes->>'caisses')::int, (v_inclus->>'caisses')::int),
        ('etablissement', (v_comptes->>'etablissements')::int, (v_inclus->>'etablissements')::int),
        ('salarie', (v_comptes->>'salaries')::int, (v_inclus->>'salaries')::int)
      ) as x(option, compte, inclus)
  loop
    continue when v_c.quantite <= 0;
    select p.montant_ht into v_prix from plateforme.prix_option p
     where p.option = v_c.option and p.periodicite = p_periodicite and p.a_partir_du <= p_prix_au order by p.a_partir_du desc limit 1;
    if v_prix is null then perform socle.refus(format('aucun prix n''est posé pour cette ligne de la facture : %s', v_c.option)); end if;
    v_lignes := v_lignes || jsonb_build_object('option', v_c.option, 'quantite', v_c.quantite, 'compte', v_c.compte,
      'inclus', v_c.inclus, 'prixHt', v_prix::text);
  end loop;
  return v_lignes;
end $$;

drop function plateforme.inclus_de_l_offre(text, text[]);

-- ── 3. Les faits que l'état lit portent l'histoire du contenu (les modules d'une période) ─────────────────────────────
create or replace function plateforme.faits_abonnement(p_entreprise uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object(
    'connu', a.entreprise is not null,
    'essaiJusquAu', a.essai_jusqu_au, 'payeJusquAu', a.paye_jusqu_au, 'offre', a.offre, 'periodicite', a.periodicite,
    'resilieLe', a.resilie_le, 'suspenduLe', a.suspendu_le, 'offert', coalesce(a.offert, false),
    'bacASable', e.essai, 'tenuParCabinet', e.tenue_par is not null, 'modules', coalesce(to_jsonb(a.modules), '[]'::jsonb),
    'regles', plateforme.regles_abonnement_histoire(), 'contenu', plateforme.contenu_histoire())
    from socle.entreprise e left join plateforme.abonnement a on a.entreprise = e.id
   where e.id = p_entreprise and e.id in (select socle.mes_entreprises())
$$;

-- ── 4. Les gestes de la direction : préparer, retirer ────────────────────────────────────────────────────────────────
create function plateforme.console_preparer_contenu(p_offre text, p_quoi text, p_nombre integer, p_a_partir_du date, p_motif text,
                                                    p_maintenant timestamptz, p_jour date) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_preavis integer := (plateforme.regle_du_jour('preavis_prix', p_jour))[1];
  v_avant integer;
begin
  perform pg_advisory_xact_lock(hashtext('plateforme.contenu_offre'));
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('changer ce qu''une offre comprend demande son motif (trois caractères au moins)'); end if;
  if p_offre is null or p_offre not in ('essentiel', 'complet') then perform socle.refus('une offre est « essentiel » ou « complet »'); end if;
  if p_quoi is null or p_quoi not in ('caisses', 'etablissements', 'salaries', 'paie', 'compta') then
    perform socle.refus('une offre comprend des caisses, des établissements, des salariés, la paie ou la comptabilité complète');
  end if;
  if p_nombre is null or p_nombre < 0 or p_nombre > 1000 or (p_quoi in ('paie', 'compta') and p_nombre not in (0, 1)) then
    perform socle.refus('ce que l''offre comprend est un nombre de 0 à 1000 ; un module, 1 (compris) ou 0 (acheté seul)');
  end if;
  if v_preavis is null then perform socle.refus('le préavis d''un nouveau prix n''est pas réglé : règle-le d''abord'); end if;
  if p_a_partir_du is null or p_a_partir_du < p_jour + v_preavis then
    perform socle.refus(format('un nouveau contenu commence au plus tôt le %s : c''est le préavis en vigueur', to_char(p_jour + v_preavis, 'DD/MM/YYYY')));
  end if;
  if exists (select 1 from plateforme.contenu_offre c where c.offre = p_offre and c.quoi = p_quoi and c.a_partir_du > p_jour) then
    perform socle.refus('un changement est déjà préparé pour cette ligne : retire-le avant d''en préparer un autre');
  end if;
  v_avant := (plateforme.contenu_du_jour(p_offre, p_jour)->>p_quoi)::int;
  if v_avant = p_nombre then perform socle.refus('c''est déjà ce que l''offre comprend : rien ne changerait'); end if;
  insert into plateforme.contenu_offre (offre, quoi, nombre, a_partir_du, motif, qui, le)
    values (p_offre, p_quoi, p_nombre, p_a_partir_du, btrim(p_motif), socle.moi(), p_maintenant);
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.contenu_prepare', btrim(p_motif),
            jsonb_build_object('offre', p_offre, 'quoi', p_quoi, 'nombre', v_avant),
            jsonb_build_object('offre', p_offre, 'quoi', p_quoi, 'nombre', p_nombre, 'aPartirDu', p_a_partir_du));
end $$;

create function plateforme.console_retirer_contenu(p_offre text, p_quoi text, p_a_partir_du date, p_motif text,
                                                   p_maintenant timestamptz, p_jour date) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_nombre integer;
begin
  perform pg_advisory_xact_lock(hashtext('plateforme.contenu_offre'));
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('retirer un changement de contenu demande son motif (trois caractères au moins)'); end if;
  select c.nombre into v_nombre from plateforme.contenu_offre c where c.offre = p_offre and c.quoi = p_quoi and c.a_partir_du = p_a_partir_du;
  if v_nombre is null then perform socle.refus('ce changement n''existe pas, ou il a déjà été retiré : relis le contenu des offres'); end if;
  if p_a_partir_du <= p_jour then perform socle.refus('ce contenu est déjà en vigueur : il ne se retire plus ; prépare-en un nouveau'); end if;
  delete from plateforme.contenu_offre c where c.offre = p_offre and c.quoi = p_quoi and c.a_partir_du = p_a_partir_du;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.contenu_retire', btrim(p_motif),
            jsonb_build_object('offre', p_offre, 'quoi', p_quoi, 'nombre', v_nombre, 'aPartirDu', p_a_partir_du),
            jsonb_build_object('offre', p_offre, 'quoi', p_quoi, 'nombre', (plateforme.contenu_du_jour(p_offre, p_jour)->>p_quoi)::int));
end $$;

-- ── 5. Ce que la console et l'abonné lisent ──────────────────────────────────────────────────────────────────────────
-- La console : le contenu du jour de chaque offre, et chaque changement à venir avec qui l'a préparé et pourquoi.
create function plateforme.console_contenu_offres(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']);
begin
  return jsonb_build_object(
    'duJour', jsonb_build_object('essentiel', plateforme.contenu_du_jour('essentiel', p_jour), 'complet', plateforme.contenu_du_jour('complet', p_jour)),
    'aVenir', (select coalesce(jsonb_agg(jsonb_build_object('offre', c.offre, 'quoi', c.quoi, 'nombre', c.nombre, 'aPartirDu', c.a_partir_du,
                 'motif', c.motif, 'par', u.nom, 'le', c.le) order by c.a_partir_du, c.offre, c.quoi), '[]'::jsonb)
                 from plateforme.contenu_offre c left join socle.utilisateur u on u.id = c.qui where c.a_partir_du > p_jour));
end $$;

-- L'abonné : le contenu du jour de chaque offre et ce qui est annoncé, sans le motif (une note de SkanFact).
create function plateforme.contenu_offres_pour_abonne(p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select jsonb_build_object(
    'duJour', jsonb_build_object('essentiel', plateforme.contenu_du_jour('essentiel', p_jour), 'complet', plateforme.contenu_du_jour('complet', p_jour)),
    'aVenir', (select coalesce(jsonb_agg(jsonb_build_object('offre', c.offre, 'quoi', c.quoi, 'nombre', c.nombre, 'aPartirDu', c.a_partir_du)
                 order by c.a_partir_du, c.offre, c.quoi), '[]'::jsonb) from plateforme.contenu_offre c where c.a_partir_du > p_jour))
$$;

revoke execute on function plateforme.contenu_du_jour(text, date), plateforme.contenu_histoire(), plateforme.inclus_de_l_offre(text, text[], date),
  plateforme.ce_que_l_offre_compte(uuid, text, date, date),
  plateforme.console_preparer_contenu(text, text, integer, date, text, timestamptz, date),
  plateforme.console_retirer_contenu(text, text, date, text, timestamptz, date),
  plateforme.console_contenu_offres(date), plateforme.contenu_offres_pour_abonne(date) from public;
grant execute on function plateforme.contenu_histoire(), plateforme.ce_que_l_offre_compte(uuid, text, date, date),
  plateforme.console_preparer_contenu(text, text, integer, date, text, timestamptz, date),
  plateforme.console_retirer_contenu(text, text, date, text, timestamptz, date),
  plateforme.console_contenu_offres(date), plateforme.contenu_offres_pour_abonne(date) to skanfact_app;
