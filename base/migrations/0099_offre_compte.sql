-- 0099 — Ce que l'offre compte (abonnement 14c, deuxième partie ; docs/abonnement.md « 14c » ; skanfact
-- docs/cadrage/07-offres-et-prix.md, 03 § 4.1, 02 § 6). Décidé par délégation le 14/10/2026.
--
-- Deux choses :
--   1. les modules achetés SEULS sur Essentiel (la paie, la comptabilité complète) : un geste de SkanFact (la console,
--      l'outil de l'exploitation), avec son motif et son événement, comme tous les gestes sur un abonnement ;
--   2. ce qui dépasse l'offre, compté le jour où la facture d'une période se prépare (07, « Au-delà de l'offre ») : les
--      utilisateurs (03 § 4.1 : chaque membre actif, sauf qui ne travaille que sur les caisses), les salariés, les
--      caisses, les établissements ; chacun au prix du jour de sa ligne (plateforme.prix_option).
-- La règle des lignes vit ICI (plateforme.lignes_en_plus) : la console s'en sert pour écrire la facture, et la base la
-- rejoue en la notant (deux chemins, un chiffre).

-- ── 1. Les modules achetés seuls ───────────────────────────────────────────────────────────────────────────────────────
alter table plateforme.abonnement add column modules text[] not null default '{}'
  check (modules <@ array['paie', 'compta']::text[]);

alter table plateforme.evenement_abonnement drop constraint evenement_abonnement_nature_check;
alter table plateforme.evenement_abonnement add constraint evenement_abonnement_nature_check check (nature in ('essai_commence',
  'essai_prolonge', 'paye', 'resilie', 'resiliation_annulee', 'suspendu', 'repris', 'offert', 'offert_retire', 'module_ouvert', 'module_ferme'));

-- La ligne telle que la console la lit, la renvoie, et que la base compare avant d'écrire (01 R15) : avec ses modules.
create or replace function plateforme.ligne_abonnement(a plateforme.abonnement) returns jsonb
language sql immutable set search_path = pg_catalog, plateforme as $$
  select case when a.entreprise is null then null else jsonb_build_object(
    'essai_jusqu_au', a.essai_jusqu_au, 'paye_jusqu_au', a.paye_jusqu_au, 'offre', a.offre, 'periodicite', a.periodicite,
    'resilie_le', a.resilie_le, 'suspendu_le', a.suspendu_le, 'offert', a.offert, 'modules', to_jsonb(a.modules)) end
$$;

-- Les faits que l'état et la porte lisent : avec les modules achetés (serveur/abonnement/offre.ts).
create or replace function plateforme.faits_abonnement(p_entreprise uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object(
    'connu', a.entreprise is not null,
    'essaiJusquAu', a.essai_jusqu_au, 'payeJusquAu', a.paye_jusqu_au, 'offre', a.offre, 'periodicite', a.periodicite,
    'resilieLe', a.resilie_le, 'suspenduLe', a.suspendu_le, 'offert', coalesce(a.offert, false),
    'bacASable', e.essai, 'tenuParCabinet', e.tenue_par is not null, 'modules', coalesce(to_jsonb(a.modules), '[]'::jsonb))
    from socle.entreprise e left join plateforme.abonnement a on a.entreprise = e.id
   where e.id = p_entreprise and e.id in (select socle.mes_entreprises())
$$;

-- Le geste de la console : deux gestes de plus (ouvrir, fermer un module, la direction seule) ; les modules s'écrivent
-- avec le reste de la ligne. Une ligne envoyée sans eux (un écran d'avant) les garde tels quels.
create or replace function plateforme.console_poser_abonnement(p_entreprise uuid, p_geste text, p_motif text, p_avant jsonb, p_apres jsonb,
                                                                p_details jsonb, p_jour date) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  v_nature text;
  v_ligne plateforme.abonnement;
  v_avant jsonb;
  v_jours int;
  v_evenement uuid;
  v_geste uuid;
begin
  v_nature := case p_geste when 'prolonger' then 'essai_prolonge' when 'payer' then 'paye' when 'resilier' then 'resilie'
    when 'annuler-resiliation' then 'resiliation_annulee' when 'suspendre' then 'suspendu' when 'reprendre' then 'repris'
    when 'offrir' then 'offert' when 'retirer-offert' then 'offert_retire'
    when 'ouvrir-module' then 'module_ouvert' when 'fermer-module' then 'module_ferme' end;
  if v_nature is null then perform socle.refus('ce geste n''existe pas dans la console'); end if;
  if v_role = 'support' and p_geste <> 'prolonger' then perform socle.refus('ton rôle dans l''équipe SkanFact ne permet pas ce geste'); end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste sur un abonnement demande son motif (trois caractères au moins) : il reste dans son histoire');
  end if;
  if not exists (select 1 from socle.entreprise e where e.id = p_entreprise and not e.essai) then
    perform socle.refus('cette entreprise n''existe pas, ou c''est une entreprise d''exemple');
  end if;

  select * into v_ligne from plateforme.abonnement a where a.entreprise = p_entreprise for update;
  v_avant := case when found then plateforme.ligne_abonnement(v_ligne) end;
  -- Changé depuis que la console l'a lu : on n'écrase pas (01 R15).
  if v_avant is distinct from p_avant then
    raise exception 'cet abonnement a changé depuis que tu l''as ouvert : relis-le avant de refaire le geste' using errcode = 'SK409';
  end if;

  if v_role = 'support' then
    if v_avant is null or (p_apres - 'essai_jusqu_au') is distinct from (v_avant - 'essai_jusqu_au') then
      perform socle.refus('le support prolonge un essai, rien d''autre : le reste se demande à la direction');
    end if;
    v_jours := (p_apres->>'essai_jusqu_au')::date - greatest((v_avant->>'essai_jusqu_au')::date, p_jour);
    if v_jours is null or v_jours not between 7 and 30 then
      perform socle.refus('le support prolonge un essai de 7 à 30 jours : au-delà, la direction');
    end if;
    if exists (select 1 from plateforme.evenement_abonnement v where v.entreprise = p_entreprise and v.nature = 'essai_prolonge') then
      perform socle.refus('cet essai a déjà été prolongé une fois : une nouvelle prolongation se demande à la direction');
    end if;
  end if;

  if v_avant is null then
    insert into plateforme.abonnement (entreprise, essai_jusqu_au) values (p_entreprise, (p_apres->>'essai_jusqu_au')::date);
  end if;
  update plateforme.abonnement set essai_jusqu_au = (p_apres->>'essai_jusqu_au')::date, paye_jusqu_au = (p_apres->>'paye_jusqu_au')::date,
      offre = p_apres->>'offre', periodicite = p_apres->>'periodicite', resilie_le = (p_apres->>'resilie_le')::date,
      suspendu_le = (p_apres->>'suspendu_le')::date, offert = coalesce((p_apres->>'offert')::boolean, false),
      modules = case when jsonb_typeof(p_apres->'modules') = 'array'
                     then array(select distinct m from jsonb_array_elements_text(p_apres->'modules') m order by m) else modules end,
      modifie_le = now()
   where entreprise = p_entreprise;
  insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, avant, apres)
    values (p_entreprise, case when v_avant is null then 'essai_commence' else v_nature end, 'exploitation', btrim(p_motif), v_avant,
            p_apres || coalesce(p_details, '{}'::jsonb))
    returning id into v_evenement;
  insert into plateforme.geste_console (qui, role, geste, entreprise, evenement, motif, avant, apres)
    values (socle.moi(), v_role, 'abonnement.' || p_geste, p_entreprise, v_evenement, btrim(p_motif), v_avant, p_apres || coalesce(p_details, '{}'::jsonb))
    returning id into v_geste;
  return v_geste;
end $$;

-- ── 2. Les prix de ce qui s'ajoute à une offre (07), datés comme ceux des offres ────────────────────────────────────────
-- À l'année : la grille de 07. Au mois : le dixième, le rapport des offres (390 / 39) — proposé le 14/10/2026, accepté
-- d'un « go » de Skander le même jour. Hors taxes, en millimes.
create table plateforme.prix_option (
  option text not null check (option in ('module_paie', 'module_compta', 'utilisateur', 'caisse', 'etablissement', 'salarie')),
  periodicite text not null check (periodicite in ('annuel', 'mensuel')),
  a_partir_du date not null,
  montant_ht bigint not null check (montant_ht > 0),
  primary key (option, periodicite, a_partir_du)
);
alter table plateforme.prix_option enable row level security;
alter table plateforme.prix_option force row level security;
insert into plateforme.prix_option (option, periodicite, a_partir_du, montant_ht) values
  ('module_paie', 'annuel', '2026-09-28', 150000), ('module_paie', 'mensuel', '2026-09-28', 15000),
  ('module_compta', 'annuel', '2026-09-28', 150000), ('module_compta', 'mensuel', '2026-09-28', 15000),
  ('utilisateur', 'annuel', '2026-09-28', 30000), ('utilisateur', 'mensuel', '2026-09-28', 3000),
  ('caisse', 'annuel', '2026-09-28', 120000), ('caisse', 'mensuel', '2026-09-28', 12000),
  ('etablissement', 'annuel', '2026-09-28', 120000), ('etablissement', 'mensuel', '2026-09-28', 12000),
  ('salarie', 'annuel', '2026-09-28', 12000), ('salarie', 'mensuel', '2026-09-28', 1200);

-- ── 3. Les lignes en plus d'une facture d'abonnement ───────────────────────────────────────────────────────────────────
-- Ce qu'une offre contient (07) : Essentiel, 3 utilisateurs, 1 caisse, 1 établissement, et 10 salariés avec la paie
-- achetée ; Complet, des utilisateurs sans limite, 2 caisses, 2 établissements, 20 salariés. Ce qui dépasse fait une
-- ligne (la quantité au-delà, au prix du jour) ; un module acheté seul sur Essentiel aussi. Compté le jour donné :
--   - les utilisateurs : chaque membre ACTIF de l'entreprise, une fois, quel que soit son rôle — sauf qui n'a que les
--     rôles de la caisse (caissier, serveur : c'est la caisse qui se paie). Jamais l'équipe d'un cabinet, ni une
--     invitation pas encore acceptée (03 § 4.1) ;
--   - les salariés : les fiches de la paie sans date de sortie, ou sortis ce jour-là ou après ;
--   - les caisses et les établissements actifs.
-- Rend [{option, quantite, compte, inclus, prixHt}] ; un prix manquant est refusé (jamais une ligne à zéro).
create function plateforme.lignes_en_plus(p_entreprise uuid, p_offre text, p_periodicite text, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, caisse, plateforme as $$
declare
  v_modules text[] := coalesce((select a.modules from plateforme.abonnement a where a.entreprise = p_entreprise), '{}');
  v_lignes jsonb := '[]'::jsonb;
  v_c record;
  v_prix bigint;
begin
  for v_c in
    with comptes as (
      select (select count(*) from socle.membre m where m.entreprise = p_entreprise and m.actif
                and not (m.roles <@ array['caissier', 'serveur']::text[]))::int utilisateurs,
             (select count(*) from socle.dossier_v10 d where d.entreprise = p_entreprise and d.collection = 'employees'
                and coalesce(nullif(d.contenu->>'endDate', ''), '9999-12-31') >= to_char(p_jour, 'YYYY-MM-DD'))::int salaries,
             (select count(*) from caisse.caisse c where c.entreprise = p_entreprise and c.active)::int caisses,
             (select count(*) from socle.etablissement e where e.entreprise = p_entreprise and e.actif)::int etablissements
    )
    select x.option, x.compte, x.inclus, case when x.option like 'module_%' then x.compte else greatest(x.compte - x.inclus, 0) end quantite
      from comptes c, lateral (values
        ('module_paie', case when p_offre = 'essentiel' and 'paie' = any(v_modules) then 1 else 0 end, 0),
        ('module_compta', case when p_offre = 'essentiel' and 'compta' = any(v_modules) then 1 else 0 end, 0),
        ('utilisateur', case when p_offre = 'essentiel' then c.utilisateurs else 0 end, 3),
        ('caisse', c.caisses, case when p_offre = 'complet' then 2 else 1 end),
        ('etablissement', c.etablissements, case when p_offre = 'complet' then 2 else 1 end),
        -- La paie : celle de Complet (20 salariés), ou la paie achetée sur Essentiel (10) ; sans paie, rien ne se compte.
        ('salarie', case when p_offre = 'complet' or 'paie' = any(v_modules) then c.salaries else 0 end,
          case when p_offre = 'complet' then 20 else 10 end)
      ) as x(option, compte, inclus)
  loop
    continue when v_c.quantite <= 0;
    select p.montant_ht into v_prix from plateforme.prix_option p
     where p.option = v_c.option and p.periodicite = p_periodicite and p.a_partir_du <= p_jour order by p.a_partir_du desc limit 1;
    if v_prix is null then perform socle.refus(format('aucun prix n''est posé pour cette ligne de la facture : %s', v_c.option)); end if;
    v_lignes := v_lignes || jsonb_build_object('option', v_c.option, 'quantite', v_c.quantite, 'compte', v_c.compte,
      'inclus', v_c.inclus, 'prixHt', v_prix::text);
  end loop;
  return v_lignes;
end $$;

-- Ce que la console lit avant de préparer : la direction seule (celle qui prépare).
create function plateforme.console_lignes_facture(p_entreprise uuid, p_offre text, p_periodicite text, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction']);
  return plateforme.lignes_en_plus(p_entreprise, p_offre, p_periodicite, p_jour);
end $$;

-- Noter la facture préparée : la base rejoue le total (l'offre au prix du jour, et les lignes en plus) et le compare à
-- celui de la pièce écrite. Le journal garde les lignes.
create or replace function plateforme.console_noter_facture(p_entreprise uuid, p_piece_v10 text, p_client_v10 text, p_offre text, p_periodicite text,
                                                            p_debut date, p_fin date, p_montant_ht bigint, p_motif text, p_jour date) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_editeur uuid := plateforme.editeur_de_mes_factures();
  v_prix bigint;
  v_lignes jsonb;
  v_f plateforme.facture_abonnement;
  v_geste uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  if p_entreprise = v_editeur then perform socle.refus('l''entreprise SkanFact ne se facture pas à elle-même'); end if;
  if not exists (select 1 from socle.entreprise e where e.id = p_entreprise and not e.essai) then
    perform socle.refus('cette entreprise n''existe pas, ou c''est une entreprise d''exemple');
  end if;
  select x.montant_ht into v_prix from plateforme.prix x
   where x.offre = p_offre and x.periodicite = p_periodicite and x.a_partir_du <= p_jour order by x.a_partir_du desc limit 1;
  v_lignes := plateforme.lignes_en_plus(p_entreprise, p_offre, p_periodicite, p_jour);
  if v_prix is null or v_prix + coalesce((select sum((l->>'quantite')::bigint * (l->>'prixHt')::bigint) from jsonb_array_elements(v_lignes) l), 0) <> p_montant_ht then
    perform socle.refus('le prix n''est pas celui du jour : relis-le avant de préparer la facture');
  end if;
  if not exists (select 1 from socle.dossier_v10 d where d.entreprise = v_editeur and d.collection = 'documents' and d.cle = p_piece_v10)
     or not exists (select 1 from socle.dossier_v10 d where d.entreprise = v_editeur and d.collection = 'clients' and d.cle = p_client_v10) then
    perform socle.refus(format('la facture préparée manque au dossier de l''entreprise SkanFact : %s', p_piece_v10));
  end if;
  select * into v_f from plateforme.facture_abonnement f where f.editeur = v_editeur and f.piece_v10 = p_piece_v10 for update;
  if found and (v_f.entreprise <> p_entreprise or v_f.payee_le is not null) then
    perform socle.refus('cette facture est déjà payée : elle ne se refait pas');
  end if;
  insert into plateforme.facture_abonnement (entreprise, editeur, piece_v10, client_v10, offre, periodicite, debut, fin, montant_ht, prepare_par)
    values (p_entreprise, v_editeur, p_piece_v10, p_client_v10, p_offre, p_periodicite, p_debut, p_fin, p_montant_ht, socle.moi())
    on conflict (editeur, piece_v10) do update set client_v10 = excluded.client_v10, offre = excluded.offre, periodicite = excluded.periodicite,
      debut = excluded.debut, fin = excluded.fin, montant_ht = excluded.montant_ht, prepare_le = now(), prepare_par = excluded.prepare_par;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'factures.preparer', p_entreprise, btrim(p_motif), null,
            -- « facturée », jamais « payée » : préparer n'encaisse rien ; le montant en dinars, comme l'écran l'écrit ; les
            -- lignes en plus, par leur nom et leur quantité.
            jsonb_build_object('offre', p_offre, 'periodicite', p_periodicite, 'factureDu', p_debut, 'factureAu', p_fin,
              'montantHt', (p_montant_ht::numeric / 1000)::numeric(16, 3)::text,
              'enPlus', (select coalesce(jsonb_agg(jsonb_build_object('option', l->>'option', 'quantite', (l->>'quantite')::int)), '[]'::jsonb)
                           from jsonb_array_elements(v_lignes) l)))
    returning id into v_geste;
  return v_geste;
end $$;

-- Les prix d'un jour de ce qui s'ajoute à l'offre, comme plateforme.prix_du_jour pour les offres : l'abonné les lit dans
-- « Ton abonnement » AVANT qu'une ligne en plus n'arrive sur sa facture.
create function plateforme.prix_options_du_jour(p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select coalesce(jsonb_agg(jsonb_build_object('option', p.option, 'periodicite', p.periodicite, 'montantHt', p.montant_ht::text)
    order by p.option, p.periodicite), '[]'::jsonb)
    from (select distinct on (option, periodicite) option, periodicite, montant_ht from plateforme.prix_option
           where a_partir_du <= p_jour order by option, periodicite, a_partir_du desc) p
$$;

revoke execute on function plateforme.lignes_en_plus(uuid, text, text, date), plateforme.console_lignes_facture(uuid, text, text, date),
  plateforme.prix_options_du_jour(date) from public;
grant execute on function plateforme.console_lignes_facture(uuid, text, text, date), plateforme.prix_options_du_jour(date) to skanfact_app;
