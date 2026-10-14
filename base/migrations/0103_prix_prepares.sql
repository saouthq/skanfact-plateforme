-- 0103 — Un nouveau prix se prépare dans la console (Réglages ; docs/abonnement.md C14 ; skanfact
-- docs/cadrage/07-offres-et-prix.md « Tout se règle depuis la console », décidé par Skander le 14/10/2026).
--
-- Jusqu'ici, un prix neuf s'écrivait dans une migration. La direction le prépare maintenant elle-même, avec son motif et
-- sa ligne au journal :
--   - un prix (d'une offre ou de ce qui s'ajoute à l'offre, à l'année ou au mois) commence au plus tôt après le PRÉAVIS,
--     trente jours (Skander, 14/10/2026), lui-même réglable dans la console ; un seul prix à venir à la fois pour un même
--     choix ;
--   - un prix à venir se retire avant sa date ; un prix en vigueur ou passé ne change ni ne disparaît jamais (la base le
--     refuse, quoi qu'on lui demande) ;
--   - la facture d'une période se prend au prix EN VIGUEUR AU PREMIER JOUR DE LA PÉRIODE : un nouveau prix vaut pour les
--     périodes qui commencent à sa date ou après, et ne touche jamais une période déjà commencée. Ce qui dépasse l'offre
--     se compte toujours le jour où la facture se prépare (0100, 0102).

-- ── 1. Les règles de l'abonnement que la direction règle, datées ─────────────────────────────────────────────────────
-- Une règle ne se modifie pas : on en pose une nouvelle, qui vaut à partir de son jour. Celle d'un jour donné : la
-- dernière posée à ce jour-là. `jours` : une liste de jours, pour qu'une même table tienne aussi les règles à plusieurs
-- valeurs (les rappels avant l'échéance, plus tard) ; le préavis en a une seule.
create table plateforme.regle_abonnement (
  id uuid primary key default socle.uuidv7(),
  code text not null check (code in ('preavis_prix')),
  jours integer[] not null check (cardinality(jours) between 1 and 5 and 0 <= all(jours) and 365 >= all(jours)),
  a_partir_du date not null,
  motif text not null check (length(btrim(motif)) >= 3),
  -- Qui l'a posée ; vide : une migration (la valeur de départ, décidée et écrite dans le cadrage).
  qui uuid references socle.utilisateur(id),
  le timestamptz not null default now(),
  check (code <> 'preavis_prix' or cardinality(jours) = 1)
);
alter table plateforme.regle_abonnement enable row level security;
alter table plateforme.regle_abonnement force row level security;
create index on plateforme.regle_abonnement (code, a_partir_du desc, le desc);

create function plateforme.regle_abonnement_intouchable() returns trigger
language plpgsql as $$
begin
  raise exception 'une règle de l''abonnement ne se modifie pas et ne s''efface pas : on en pose une nouvelle, datée' using errcode = '42501';
end $$;
create trigger regle_abonnement_intouchable before update or delete on plateforme.regle_abonnement
  for each row execute function plateforme.regle_abonnement_intouchable();

insert into plateforme.regle_abonnement (code, jours, a_partir_du, motif)
  values ('preavis_prix', '{30}', '2026-10-14', 'Décidé par Skander le 14/10/2026 : trente jours, réglables dans la console');

-- La règle d'un jour donné : la dernière posée à ce jour-là (rien si aucune ne l'est encore).
create function plateforme.regle_du_jour(p_code text, p_jour date) returns integer[]
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select r.jours from plateforme.regle_abonnement r where r.code = p_code and r.a_partir_du <= p_jour
   order by r.a_partir_du desc, r.le desc, r.id desc limit 1
$$;

-- ── 2. Les prix : qui a préparé un prix, et pourquoi ; un prix posé ne se réécrit pas ───────────────────────────────
alter table plateforme.prix add column motif text, add column pose_par uuid references socle.utilisateur(id), add column pose_le timestamptz;
alter table plateforme.prix_option add column motif text, add column pose_par uuid references socle.utilisateur(id), add column pose_le timestamptz;

-- Un prix ne se modifie jamais ; il ne s'efface que tant qu'il est à venir (au calendrier de Tunis).
create function plateforme.prix_intouchable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'un prix posé ne se modifie pas : on en prépare un nouveau, daté' using errcode = '42501';
  end if;
  if old.a_partir_du <= (now() at time zone 'Africa/Tunis')::date then
    raise exception 'un prix en vigueur ou passé ne s''efface jamais' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger prix_intouchable before update or delete on plateforme.prix
  for each row execute function plateforme.prix_intouchable();
create trigger prix_option_intouchable before update or delete on plateforme.prix_option
  for each row execute function plateforme.prix_intouchable();

-- ── 3. Les gestes de la direction ────────────────────────────────────────────────────────────────────────────────────
-- Ce qui a un prix : les deux offres, et ce qui s'ajoute à l'offre (0099, 0102).
create function plateforme.prix_de(p_quoi text, p_periodicite text, p_jour date) returns bigint
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select coalesce(
    (select x.montant_ht from plateforme.prix x where x.offre = p_quoi and x.periodicite = p_periodicite and x.a_partir_du <= p_jour
      order by x.a_partir_du desc limit 1),
    (select x.montant_ht from plateforme.prix_option x where x.option = p_quoi and x.periodicite = p_periodicite and x.a_partir_du <= p_jour
      order by x.a_partir_du desc limit 1))
$$;

-- Préparer un prix. Le journal garde le prix d'avant et le nouveau, en dinars, comme l'écran les écrit.
create function plateforme.console_preparer_prix(p_quoi text, p_periodicite text, p_a_partir_du date, p_montant_ht bigint, p_motif text,
                                                 p_maintenant timestamptz, p_jour date) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_preavis integer := (plateforme.regle_du_jour('preavis_prix', p_jour))[1];
  v_offre boolean := p_quoi in ('essentiel', 'complet');
  v_avant bigint;
begin
  -- Deux préparations au même instant ne laissent jamais deux prix à venir pour le même choix.
  perform pg_advisory_xact_lock(hashtext('plateforme.prix'));
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('préparer un prix demande son motif (trois caractères au moins)'); end if;
  if p_quoi is null or p_quoi not in ('essentiel', 'complet', 'module_paie', 'module_compta', 'caisse', 'etablissement', 'salarie') then
    perform socle.refus('ce prix ne correspond à aucune offre ni à rien de ce qui s''ajoute à l''offre');
  end if;
  if p_periodicite is null or p_periodicite not in ('annuel', 'mensuel') then perform socle.refus('un prix vaut à l''année ou au mois'); end if;
  if p_montant_ht is null or p_montant_ht <= 0 then perform socle.refus('un prix est un montant hors taxes plus grand que zéro'); end if;
  if v_preavis is null then perform socle.refus('le préavis d''un nouveau prix n''est pas réglé : règle-le d''abord'); end if;
  if p_a_partir_du is null or p_a_partir_du < p_jour + v_preavis then
    perform socle.refus(format('un nouveau prix commence au plus tôt le %s : c''est le préavis en vigueur', to_char(p_jour + v_preavis, 'DD/MM/YYYY')));
  end if;
  if exists (select 1 from plateforme.prix x where v_offre and x.offre = p_quoi and x.periodicite = p_periodicite and x.a_partir_du > p_jour)
     or exists (select 1 from plateforme.prix_option x where not v_offre and x.option = p_quoi and x.periodicite = p_periodicite and x.a_partir_du > p_jour) then
    perform socle.refus('un prix est déjà préparé pour ce choix : retire-le avant d''en préparer un autre');
  end if;
  v_avant := plateforme.prix_de(p_quoi, p_periodicite, p_jour);
  if v_avant = p_montant_ht then perform socle.refus('c''est déjà le prix en vigueur : rien ne changerait'); end if;
  if v_offre then
    insert into plateforme.prix (offre, periodicite, a_partir_du, montant_ht, motif, pose_par, pose_le)
      values (p_quoi, p_periodicite, p_a_partir_du, p_montant_ht, btrim(p_motif), socle.moi(), p_maintenant);
  else
    insert into plateforme.prix_option (option, periodicite, a_partir_du, montant_ht, motif, pose_par, pose_le)
      values (p_quoi, p_periodicite, p_a_partir_du, p_montant_ht, btrim(p_motif), socle.moi(), p_maintenant);
  end if;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.prix_prepare', btrim(p_motif),
            jsonb_build_object('quoi', p_quoi, 'periodicite', p_periodicite,
              'montantHt', case when v_avant is null then null else (v_avant::numeric / 1000)::numeric(16, 3)::text end),
            jsonb_build_object('quoi', p_quoi, 'periodicite', p_periodicite, 'aPartirDu', p_a_partir_du,
              'montantHt', (p_montant_ht::numeric / 1000)::numeric(16, 3)::text));
end $$;

-- Retirer un prix avant sa date : le prix en vigueur reste, sans date de fin. Le journal garde celui qui est retiré.
create function plateforme.console_retirer_prix(p_quoi text, p_periodicite text, p_a_partir_du date, p_motif text,
                                                p_maintenant timestamptz, p_jour date) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_montant bigint;
  v_motif text;
begin
  perform pg_advisory_xact_lock(hashtext('plateforme.prix'));
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('retirer un prix demande son motif (trois caractères au moins)'); end if;
  select x.montant_ht, x.motif into v_montant, v_motif from plateforme.prix x
   where x.offre = p_quoi and x.periodicite = p_periodicite and x.a_partir_du = p_a_partir_du;
  if not found then
    select x.montant_ht, x.motif into v_montant, v_motif from plateforme.prix_option x
     where x.option = p_quoi and x.periodicite = p_periodicite and x.a_partir_du = p_a_partir_du;
  end if;
  if v_montant is null then perform socle.refus('ce prix n''existe pas, ou il a déjà été retiré : relis la grille'); end if;
  if p_a_partir_du <= p_jour then perform socle.refus('ce prix est déjà en vigueur : il ne se retire plus ; prépare-en un nouveau'); end if;
  delete from plateforme.prix x where x.offre = p_quoi and x.periodicite = p_periodicite and x.a_partir_du = p_a_partir_du;
  delete from plateforme.prix_option x where x.option = p_quoi and x.periodicite = p_periodicite and x.a_partir_du = p_a_partir_du;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.prix_retire', btrim(p_motif),
            jsonb_build_object('quoi', p_quoi, 'periodicite', p_periodicite, 'aPartirDu', p_a_partir_du,
              'montantHt', (v_montant::numeric / 1000)::numeric(16, 3)::text, 'motif', v_motif),
            jsonb_build_object('quoi', p_quoi, 'periodicite', p_periodicite,
              'montantHt', (plateforme.prix_de(p_quoi, p_periodicite, p_jour)::numeric / 1000)::numeric(16, 3)::text));
end $$;

-- Régler le préavis : il vaut dès aujourd'hui, pour les prix préparés ensuite (un prix déjà préparé garde sa date).
create function plateforme.console_regler_preavis(p_jours integer, p_motif text, p_maintenant timestamptz, p_jour date) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_avant integer := (plateforme.regle_du_jour('preavis_prix', p_jour))[1];
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('régler le préavis demande son motif (trois caractères au moins)'); end if;
  if p_jours is null or p_jours < 0 or p_jours > 365 then perform socle.refus('le préavis d''un nouveau prix compte de 0 à 365 jours'); end if;
  if v_avant = p_jours then perform socle.refus('c''est déjà le préavis en vigueur : rien ne changerait'); end if;
  insert into plateforme.regle_abonnement (code, jours, a_partir_du, motif, qui, le)
    values ('preavis_prix', array[p_jours], p_jour, btrim(p_motif), socle.moi(), p_maintenant);
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.preavis', btrim(p_motif), jsonb_build_object('jours', v_avant), jsonb_build_object('jours', p_jours));
end $$;

-- ── 4. Ce que la console lit ─────────────────────────────────────────────────────────────────────────────────────────
-- Le préavis en vigueur (et qui l'a posé), et les prix à venir avec qui les a préparés et pourquoi : la grille, elle,
-- reste lue par console_reglages (0093) et console_ajouts (0101).
create function plateforme.console_prix_prepares(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']);
begin
  return jsonb_build_object(
    'preavis', (select jsonb_build_object('jours', r.jours[1], 'aPartirDu', r.a_partir_du, 'motif', r.motif, 'par', u.nom, 'le', r.le)
                  from plateforme.regle_abonnement r left join socle.utilisateur u on u.id = r.qui
                 where r.code = 'preavis_prix' and r.a_partir_du <= p_jour order by r.a_partir_du desc, r.le desc, r.id desc limit 1),
    'aVenir', (select coalesce(jsonb_agg(jsonb_build_object('quoi', v.quoi, 'periodicite', v.periodicite, 'aPartirDu', v.a_partir_du,
                 'montantHt', v.montant_ht::text, 'motif', v.motif, 'par', u.nom, 'le', v.pose_le) order by v.a_partir_du, v.quoi, v.periodicite), '[]'::jsonb)
                 from (select offre quoi, periodicite, a_partir_du, montant_ht, motif, pose_par, pose_le from plateforme.prix where a_partir_du > p_jour
                       union all
                       select option, periodicite, a_partir_du, montant_ht, motif, pose_par, pose_le from plateforme.prix_option where a_partir_du > p_jour) v
                 left join socle.utilisateur u on u.id = v.pose_par));
end $$;

-- ── 5. Ce que l'abonné lit : les prix à venir, sans le motif (une note de SkanFact) ─────────────────────────────────
create function plateforme.prix_a_venir(p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select coalesce(jsonb_agg(jsonb_build_object('quoi', v.quoi, 'periodicite', v.periodicite, 'aPartirDu', v.a_partir_du, 'montantHt', v.montant_ht::text)
    order by v.a_partir_du, v.quoi, v.periodicite), '[]'::jsonb)
    from (select offre quoi, periodicite, a_partir_du, montant_ht from plateforme.prix where a_partir_du > p_jour
          union all
          select option, periodicite, a_partir_du, montant_ht from plateforme.prix_option where a_partir_du > p_jour) v
$$;

-- ── 6. La facture d'une période, au prix de son premier jour ─────────────────────────────────────────────────────────
-- Les lignes en plus : comptées le jour de la préparation (`p_jour`), au prix en vigueur le premier jour de la période
-- (`p_prix_au`). Le reste comme 0102.
create function plateforme.lignes_en_plus(p_entreprise uuid, p_offre text, p_periodicite text, p_jour date, p_prix_au date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, caisse, plateforme as $$
declare
  v_modules text[] := coalesce((select a.modules from plateforme.abonnement a where a.entreprise = p_entreprise), '{}');
  v_comptes jsonb := plateforme.comptes_de_l_entreprise(p_entreprise, p_jour);
  v_inclus jsonb := plateforme.inclus_de_l_offre(p_offre, v_modules);
  v_lignes jsonb := '[]'::jsonb;
  v_c record;
  v_prix bigint;
begin
  for v_c in
    select x.option, x.compte, x.inclus,
           case when x.option like 'module_%' then x.compte when x.inclus is null then 0 else greatest(x.compte - x.inclus, 0) end quantite
      from (values
        ('module_paie', case when p_offre = 'essentiel' and 'paie' = any(v_modules) then 1 else 0 end, 0),
        ('module_compta', case when p_offre = 'essentiel' and 'compta' = any(v_modules) then 1 else 0 end, 0),
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

create function plateforme.console_lignes_facture(p_entreprise uuid, p_offre text, p_periodicite text, p_jour date, p_prix_au date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction']);
  return plateforme.lignes_en_plus(p_entreprise, p_offre, p_periodicite, p_jour, p_prix_au);
end $$;

-- Noter la facture préparée : la base rejoue le total au prix du premier jour de la période (l'offre et les lignes en
-- plus) et le compare à celui de la pièce écrite. Le reste comme 0099.
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
   where x.offre = p_offre and x.periodicite = p_periodicite and x.a_partir_du <= p_debut order by x.a_partir_du desc limit 1;
  v_lignes := plateforme.lignes_en_plus(p_entreprise, p_offre, p_periodicite, p_jour, p_debut);
  if v_prix is null or v_prix + coalesce((select sum((l->>'quantite')::bigint * (l->>'prixHt')::bigint) from jsonb_array_elements(v_lignes) l), 0) <> p_montant_ht then
    perform socle.refus('le total n''est pas celui de la grille au premier jour de la période : relis-le avant de préparer la facture');
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
            jsonb_build_object('offre', p_offre, 'periodicite', p_periodicite, 'factureDu', p_debut, 'factureAu', p_fin,
              'montantHt', (p_montant_ht::numeric / 1000)::numeric(16, 3)::text,
              'enPlus', (select coalesce(jsonb_agg(jsonb_build_object('option', l->>'option', 'quantite', (l->>'quantite')::int)), '[]'::jsonb)
                           from jsonb_array_elements(v_lignes) l)))
    returning id into v_geste;
  return v_geste;
end $$;

drop function plateforme.console_lignes_facture(uuid, text, text, date);
drop function plateforme.lignes_en_plus(uuid, text, text, date);

revoke execute on function plateforme.regle_du_jour(text, date), plateforme.prix_de(text, text, date),
  plateforme.console_preparer_prix(text, text, date, bigint, text, timestamptz, date),
  plateforme.console_retirer_prix(text, text, date, text, timestamptz, date),
  plateforme.console_regler_preavis(integer, text, timestamptz, date), plateforme.console_prix_prepares(date), plateforme.prix_a_venir(date),
  plateforme.lignes_en_plus(uuid, text, text, date, date), plateforme.console_lignes_facture(uuid, text, text, date, date) from public;
grant execute on function plateforme.console_preparer_prix(text, text, date, bigint, text, timestamptz, date),
  plateforme.console_retirer_prix(text, text, date, text, timestamptz, date),
  plateforme.console_regler_preavis(integer, text, timestamptz, date), plateforme.console_prix_prepares(date), plateforme.prix_a_venir(date),
  plateforme.console_lignes_facture(uuid, text, text, date, date) to skanfact_app;
