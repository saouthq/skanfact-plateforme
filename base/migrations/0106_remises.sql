-- 0106 — Les remises (docs/abonnement.md C17 ; skanfact docs/cadrage/07-offres-et-prix.md, « Les groupes »,
-- « Parrainage » et « Tout se règle depuis la console » ; décidé par Skander le 14/10/2026).
--
-- Deux remises, jamais additionnées (la plus forte seule) :
--   - le GROUPE : des sociétés que la direction relie dans la console (un groupe DÉCLARÉ, avec son motif ; la console
--     propose les sociétés qui ont la même propriétaire). La première abonnée du groupe paie le prix normal ; les
--     autres ont la remise ;
--   - le CABINET : une entreprise qui, avant son premier paiement, a confié son dossier à un cabinet (un mandat donné
--     par le code du cabinet, et accepté) a la remise sur ses périodes de la première année.
-- La remise porte sur toute la facture hors taxes (l'offre et ce qui s'ajoute) ; son taux et la durée de celle du
-- cabinet sont des règles datées, préparées dans la console comme un prix (le préavis, retirables avant leur date). Une
-- facture se compte à la règle et au groupe de son premier jour, comme son prix.

-- ── 1. Les règles des remises ────────────────────────────────────────────────────────────────────────────────────────
-- Un taux en pourcent entier : la remise se calcule comme la remise globale d'une pièce de la v10 (le même arrondi).
create table plateforme.regle_remise (
  id uuid primary key default socle.uuidv7(),
  code text not null check (code in ('groupe', 'cabinet')),
  taux integer not null check (taux between 0 and 90),
  -- La remise du cabinet dure un nombre de mois depuis la première période payée ; celle du groupe, toujours.
  mois integer check (mois is null or mois between 1 and 60),
  check ((code = 'cabinet') = (mois is not null)),
  a_partir_du date not null,
  motif text not null check (length(btrim(motif)) >= 3),
  -- Qui l'a préparée ; vide : une migration (la règle de départ, décidée par Skander).
  qui uuid references socle.utilisateur(id),
  le timestamptz not null default now(),
  unique (code, a_partir_du)
);
alter table plateforme.regle_remise enable row level security;
alter table plateforme.regle_remise force row level security;

-- Comme un prix : jamais modifiée ; effacée seulement tant qu'elle est à venir (au calendrier de Tunis).
create function plateforme.regle_remise_intouchable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'une règle de remise posée ne se modifie pas : on en prépare une nouvelle, datée' using errcode = '42501';
  end if;
  if old.a_partir_du <= (now() at time zone 'Africa/Tunis')::date then
    raise exception 'une règle de remise en vigueur ou passée ne s''efface jamais' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger regle_remise_intouchable before update or delete on plateforme.regle_remise
  for each row execute function plateforme.regle_remise_intouchable();

insert into plateforme.regle_remise (code, taux, mois, a_partir_du, motif) values
  ('groupe', 20, null, '2000-01-01', 'Skander, 14/10/2026 : − 20 % pour chaque société d''un groupe après la première abonnée'),
  ('cabinet', 20, 12, '2000-01-01', 'Skander, 14/10/2026 : − 20 % la première année pour un client venu par son cabinet');

-- La règle d'un jour : la dernière qui vaut ce jour-là (rien si aucune).
create function plateforme.regle_remise_du_jour(p_code text, p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select jsonb_build_object('taux', r.taux, 'mois', r.mois, 'aPartirDu', r.a_partir_du)
    from plateforme.regle_remise r where r.code = p_code and r.a_partir_du <= p_jour order by r.a_partir_du desc limit 1
$$;

-- ── 2. Les groupes, déclarés par la direction ────────────────────────────────────────────────────────────────────────
create table plateforme.groupe (
  id uuid primary key default socle.uuidv7(),
  nom text not null check (length(btrim(nom)) between 2 and 120),
  motif text not null check (length(btrim(motif)) >= 3),
  qui uuid references socle.utilisateur(id),
  le timestamptz not null default now()
);
-- Une société entre dans un groupe un jour et en sort un autre : son histoire se garde. Une société n'est que dans un
-- groupe à la fois. Un jour J, elle en est si `depuis <= J < retire_le`.
create table plateforme.groupe_membre (
  id uuid primary key default socle.uuidv7(),
  groupe uuid not null references plateforme.groupe(id),
  entreprise uuid not null references socle.entreprise(id),
  depuis date not null,
  motif text not null check (length(btrim(motif)) >= 3),
  qui uuid references socle.utilisateur(id),
  le timestamptz not null default now(),
  retire_le date,
  retire_motif text check (retire_motif is null or length(btrim(retire_motif)) >= 3),
  retire_par uuid references socle.utilisateur(id),
  check (retire_le is null or retire_le >= depuis)
);
create unique index groupe_membre_un_seul on plateforme.groupe_membre (entreprise) where retire_le is null;
create index on plateforme.groupe_membre (groupe);
alter table plateforme.groupe enable row level security;
alter table plateforme.groupe force row level security;
alter table plateforme.groupe_membre enable row level security;
alter table plateforme.groupe_membre force row level security;

-- ── 3. Ce que la remise lit : la première période payée, le premier paiement ─────────────────────────────────────────
-- Le premier jour de la première période payée (les paiements notés par la console et ceux des factures réglées disent
-- leur période) ; et le jour du premier paiement, au calendrier de Tunis.
create function plateforme.premiere_periode(p_entreprise uuid) returns date
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select min((v.apres->>'debut')::date) from plateforme.evenement_abonnement v
   where v.entreprise = p_entreprise and v.nature = 'paye' and v.apres ? 'debut'
$$;
create function plateforme.premier_paiement(p_entreprise uuid) returns date
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select min((v.le at time zone 'Africa/Tunis')::date) from plateforme.evenement_abonnement v
   where v.entreprise = p_entreprise and v.nature = 'paye'
$$;

-- ── 4. La remise d'une période : la plus forte des deux, jamais leur somme ────────────────────────────────────────────
-- `p_debut` : le premier jour de la période facturée. Rien quand aucune ne s'applique. `aussi` : celle qui s'appliquait
-- aussi et ne s'ajoute pas (la console le dit).
create function plateforme.remise_de(p_entreprise uuid, p_debut date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_regle_groupe jsonb := plateforme.regle_remise_du_jour('groupe', p_debut);
  v_regle_cabinet jsonb := plateforme.regle_remise_du_jour('cabinet', p_debut);
  v_premiere date := coalesce(plateforme.premiere_periode(p_entreprise), p_debut);
  v_paiement date := plateforme.premier_paiement(p_entreprise);
  v_membre plateforme.groupe_membre;
  v_tete record;
  v_cabinet record;
  v_fin date;
  v_g jsonb;
  v_c jsonb;
begin
  -- Le groupe : la société en est le premier jour de la période, et une autre du groupe ce jour-là s'est abonnée avant
  -- elle (la plus ancienne première période payée ; à égalité, la plus ancienne créée). Une société qui n'a jamais payé
  -- compte sa première période à partir de celle qu'on facture.
  select * into v_membre from plateforme.groupe_membre m
   where m.entreprise = p_entreprise and m.depuis <= p_debut and (m.retire_le is null or p_debut < m.retire_le)
   order by m.depuis desc limit 1;
  if found and coalesce((v_regle_groupe->>'taux')::int, 0) > 0 then
    select e.id, e.raison_sociale into v_tete
      from plateforme.groupe_membre m join socle.entreprise e on e.id = m.entreprise
     where m.groupe = v_membre.groupe and m.depuis <= p_debut and (m.retire_le is null or p_debut < m.retire_le)
     order by coalesce(plateforme.premiere_periode(m.entreprise), case when m.entreprise = p_entreprise then p_debut end) nulls last,
              e.cree_le, e.id
     limit 1;
    if v_tete.id is distinct from p_entreprise then
      v_g := jsonb_build_object('nature', 'groupe', 'taux', (v_regle_groupe->>'taux')::int,
        'groupe', (select g.nom from plateforme.groupe g where g.id = v_membre.groupe), 'premiere', v_tete.raison_sociale);
    end if;
  end if;
  -- Le cabinet : un mandat accepté (en cours ou arrêté depuis) dont le premier jour vient avant le premier paiement, et
  -- une période qui commence dans les mois de la règle depuis la première période payée.
  if coalesce((v_regle_cabinet->>'taux')::int, 0) > 0 then
    v_fin := (v_premiere + make_interval(months => (v_regle_cabinet->>'mois')::int))::date;
    if p_debut < v_fin then
      select o.nom, d.debut into v_cabinet from socle.mandat d join socle.organisation o on o.id = d.cabinet
       where d.entreprise = p_entreprise and d.statut in ('actif', 'termine') and (v_paiement is null or d.debut <= v_paiement)
       order by d.debut limit 1;
      if found then
        v_c := jsonb_build_object('nature', 'cabinet', 'taux', (v_regle_cabinet->>'taux')::int, 'cabinet', v_cabinet.nom,
          'jusquAu', v_fin - 1);
      end if;
    end if;
  end if;
  if v_g is null then return v_c; end if;
  if v_c is null then return v_g; end if;
  -- Les deux : la plus forte (à égalité, celle du groupe, qui dure), et l'autre dite.
  if (v_c->>'taux')::int > (v_g->>'taux')::int then return v_c || jsonb_build_object('aussi', v_g); end if;
  return v_g || jsonb_build_object('aussi', v_c);
end $$;

-- Le montant de la remise, en millimes : le même arrondi que la v10 (au millime le plus proche).
create function plateforme.montant_remise(p_base bigint, p_taux integer) returns bigint
language sql immutable as $$ select (p_base * p_taux + 50) / 100 $$;

-- ── 5. La facture d'une période porte sa remise ──────────────────────────────────────────────────────────────────────
alter table plateforme.facture_abonnement
  add column remise_nature text check (remise_nature is null or remise_nature in ('groupe', 'cabinet')),
  add column remise_taux integer not null default 0 check (remise_taux between 0 and 90),
  add column remise_ht bigint not null default 0 check (remise_ht >= 0),
  add check ((remise_nature is null) = (remise_taux = 0));

-- La console : la remise d'une période, pour l'aperçu de la facture et la fiche.
create function plateforme.console_remise(p_entreprise uuid, p_debut date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return plateforme.remise_de(p_entreprise, p_debut);
end $$;

-- Noter la facture préparée : la base rejoue le total au prix et à la remise du premier jour de la période (l'offre et
-- les lignes en plus, moins la remise) et le compare à celui de la pièce écrite. Le reste comme 0103.
create or replace function plateforme.console_noter_facture(p_entreprise uuid, p_piece_v10 text, p_client_v10 text, p_offre text, p_periodicite text,
                                                            p_debut date, p_fin date, p_montant_ht bigint, p_motif text, p_jour date) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_editeur uuid := plateforme.editeur_de_mes_factures();
  v_prix bigint;
  v_lignes jsonb;
  v_brut bigint;
  v_remise jsonb;
  v_taux integer;
  v_remise_ht bigint;
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
  v_brut := v_prix + coalesce((select sum((l->>'quantite')::bigint * (l->>'prixHt')::bigint) from jsonb_array_elements(v_lignes) l), 0);
  v_remise := plateforme.remise_de(p_entreprise, p_debut);
  v_taux := coalesce((v_remise->>'taux')::int, 0);
  v_remise_ht := plateforme.montant_remise(v_brut, v_taux);
  if v_prix is null or v_brut - v_remise_ht <> p_montant_ht then
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
  insert into plateforme.facture_abonnement (entreprise, editeur, piece_v10, client_v10, offre, periodicite, debut, fin, montant_ht, prepare_par,
                                            remise_nature, remise_taux, remise_ht)
    values (p_entreprise, v_editeur, p_piece_v10, p_client_v10, p_offre, p_periodicite, p_debut, p_fin, p_montant_ht, socle.moi(),
            case when v_taux > 0 then v_remise->>'nature' end, v_taux, v_remise_ht)
    on conflict (editeur, piece_v10) do update set client_v10 = excluded.client_v10, offre = excluded.offre, periodicite = excluded.periodicite,
      debut = excluded.debut, fin = excluded.fin, montant_ht = excluded.montant_ht, prepare_le = now(), prepare_par = excluded.prepare_par,
      remise_nature = excluded.remise_nature, remise_taux = excluded.remise_taux, remise_ht = excluded.remise_ht;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'factures.preparer', p_entreprise, btrim(p_motif), null,
            jsonb_build_object('offre', p_offre, 'periodicite', p_periodicite, 'factureDu', p_debut, 'factureAu', p_fin,
              'montantHt', (p_montant_ht::numeric / 1000)::numeric(16, 3)::text,
              'enPlus', (select coalesce(jsonb_agg(jsonb_build_object('option', l->>'option', 'quantite', (l->>'quantite')::int)), '[]'::jsonb)
                           from jsonb_array_elements(v_lignes) l))
            || case when v_taux > 0 then jsonb_build_object('remise', jsonb_build_object('nature', v_remise->>'nature', 'taux', v_taux,
                 'montantHt', (v_remise_ht::numeric / 1000)::numeric(16, 3)::text)) else '{}'::jsonb end)
    returning id into v_geste;
  return v_geste;
end $$;

-- ── 6. Les gestes de la direction : les règles des remises ───────────────────────────────────────────────────────────
-- Comme un prix : au plus tôt après le préavis, une seule à venir par remise, jamais l'identique ; retirable avant sa
-- date.
create function plateforme.console_preparer_remise(p_code text, p_taux integer, p_mois integer, p_a_partir_du date, p_motif text,
                                                   p_maintenant timestamptz, p_jour date) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_preavis integer := (plateforme.regle_du_jour('preavis_prix', p_jour))[1];
  v_avant jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('plateforme.regle_remise'));
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('changer une remise demande son motif (trois caractères au moins)'); end if;
  if p_code is null or p_code not in ('groupe', 'cabinet') then perform socle.refus('une remise est celle du groupe ou celle du cabinet'); end if;
  if p_taux is null or p_taux < 0 or p_taux > 90 then perform socle.refus('une remise compte de 0 à 90 %'); end if;
  if (p_code = 'cabinet') <> (p_mois is not null) or (p_mois is not null and (p_mois < 1 or p_mois > 60)) then
    perform socle.refus('la remise du cabinet dure de 1 à 60 mois ; celle du groupe, toujours');
  end if;
  if v_preavis is null then perform socle.refus('le préavis d''un nouveau prix n''est pas réglé : règle-le d''abord'); end if;
  if p_a_partir_du is null or p_a_partir_du < p_jour + v_preavis then
    perform socle.refus(format('une nouvelle remise commence au plus tôt le %s : c''est le préavis en vigueur', to_char(p_jour + v_preavis, 'DD/MM/YYYY')));
  end if;
  if exists (select 1 from plateforme.regle_remise r where r.code = p_code and r.a_partir_du > p_jour) then
    perform socle.refus('un changement de cette remise est déjà préparé : retire-le avant d''en préparer un autre');
  end if;
  v_avant := plateforme.regle_remise_du_jour(p_code, p_jour);
  if (v_avant->>'taux')::int = p_taux and (v_avant->>'mois')::int is not distinct from p_mois then
    perform socle.refus('c''est déjà la remise en vigueur : rien ne changerait');
  end if;
  insert into plateforme.regle_remise (code, taux, mois, a_partir_du, motif, qui, le)
    values (p_code, p_taux, p_mois, p_a_partir_du, btrim(p_motif), socle.moi(), p_maintenant);
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.remise_preparee', btrim(p_motif),
            jsonb_build_object('code', p_code, 'taux', (v_avant->>'taux')::int, 'mois', (v_avant->>'mois')::int),
            jsonb_build_object('code', p_code, 'taux', p_taux, 'mois', p_mois, 'aPartirDu', p_a_partir_du));
end $$;

create function plateforme.console_retirer_remise(p_code text, p_a_partir_du date, p_motif text, p_maintenant timestamptz, p_jour date)
  returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_r plateforme.regle_remise;
  v_reste jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('plateforme.regle_remise'));
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('retirer un changement de remise demande son motif (trois caractères au moins)'); end if;
  select * into v_r from plateforme.regle_remise r where r.code = p_code and r.a_partir_du = p_a_partir_du;
  if not found then perform socle.refus('ce changement de remise n''existe pas, ou il a déjà été retiré : relis les remises'); end if;
  if p_a_partir_du <= p_jour then perform socle.refus('cette remise est déjà en vigueur : elle ne se retire plus ; prépare-en une nouvelle'); end if;
  delete from plateforme.regle_remise r where r.id = v_r.id;
  v_reste := plateforme.regle_remise_du_jour(p_code, p_jour);
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.remise_retiree', btrim(p_motif),
            jsonb_build_object('code', p_code, 'taux', v_r.taux, 'mois', v_r.mois, 'aPartirDu', v_r.a_partir_du),
            jsonb_build_object('code', p_code, 'taux', (v_reste->>'taux')::int, 'mois', (v_reste->>'mois')::int));
end $$;

-- Ce que la console lit : chaque remise du jour, qui l'a posée et pourquoi, et ce qui est préparé.
create function plateforme.console_remises(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']);
begin
  return jsonb_build_object(
    'duJour', (select coalesce(jsonb_object_agg(c.code, (
        select jsonb_build_object('taux', r.taux, 'mois', r.mois, 'aPartirDu', r.a_partir_du, 'motif', r.motif, 'par', u.nom, 'le', r.le)
          from plateforme.regle_remise r left join socle.utilisateur u on u.id = r.qui
         where r.code = c.code and r.a_partir_du <= p_jour order by r.a_partir_du desc limit 1)), '{}'::jsonb)
      from unnest(array['groupe', 'cabinet']) c(code)),
    'aVenir', (select coalesce(jsonb_agg(jsonb_build_object('code', r.code, 'taux', r.taux, 'mois', r.mois, 'aPartirDu', r.a_partir_du,
                 'motif', r.motif, 'par', u.nom, 'le', r.le) order by r.a_partir_du, r.code), '[]'::jsonb)
                 from plateforme.regle_remise r left join socle.utilisateur u on u.id = r.qui where r.a_partir_du > p_jour),
    -- Combien d'entreprises sont dans un groupe aujourd'hui, et combien de groupes.
    'groupes', (select count(distinct m.groupe) from plateforme.groupe_membre m where m.depuis <= p_jour and (m.retire_le is null or p_jour < m.retire_le)),
    'enGroupe', (select count(*) from plateforme.groupe_membre m where m.depuis <= p_jour and (m.retire_le is null or p_jour < m.retire_le)));
end $$;

-- ── 7. Les gestes de la direction : les groupes ──────────────────────────────────────────────────────────────────────
-- Une société d'un groupe : une vraie entreprise (pas d'exemple, pas l'entreprise SkanFact), dans un seul groupe à la
-- fois. Chaque entrée et chaque sortie a sa ligne au journal, sur la société.
create function plateforme.groupe_peut_entrer(p_entreprise uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if not exists (select 1 from socle.entreprise e where e.id = p_entreprise and not e.essai) then
    perform socle.refus('cette entreprise n''existe pas, ou c''est une entreprise d''exemple');
  end if;
  -- L'entreprise SkanFact, lue sans l'exiger (elle n'est peut-être pas encore désignée, et la direction qui déclare un
  -- groupe n'en est pas forcément la propriétaire).
  if p_entreprise = (select d.entreprise from plateforme.editeur d) then perform socle.refus('l''entreprise SkanFact n''entre dans aucun groupe'); end if;
  if exists (select 1 from plateforme.groupe_membre m where m.entreprise = p_entreprise and m.retire_le is null) then
    perform socle.refus('cette société est déjà dans un groupe : retire-la d''abord de celui-ci');
  end if;
end $$;

create function plateforme.console_creer_groupe(p_nom text, p_entreprises uuid[], p_motif text, p_jour date) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_groupe uuid;
  v_e uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un groupe se crée avec son motif (trois caractères au moins)'); end if;
  if length(btrim(coalesce(p_nom, ''))) < 2 then perform socle.refus('un groupe a un nom (deux caractères au moins)'); end if;
  if p_entreprises is null or cardinality(array(select distinct x from unnest(p_entreprises) x)) < 2 then
    perform socle.refus('un groupe réunit au moins deux sociétés');
  end if;
  insert into plateforme.groupe (nom, motif, qui) values (btrim(p_nom), btrim(p_motif), socle.moi()) returning id into v_groupe;
  for v_e in select distinct x from unnest(p_entreprises) x loop
    perform plateforme.groupe_peut_entrer(v_e);
    insert into plateforme.groupe_membre (groupe, entreprise, depuis, motif, qui) values (v_groupe, v_e, p_jour, btrim(p_motif), socle.moi());
    insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
      values (socle.moi(), v_role, 'groupes.entree', v_e, btrim(p_motif), null,
              jsonb_build_object('groupe', v_groupe, 'nom', btrim(p_nom), 'depuis', p_jour, 'cree', true));
  end loop;
  return v_groupe;
end $$;

create function plateforme.console_entrer_groupe(p_groupe uuid, p_entreprise uuid, p_motif text, p_jour date) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_nom text;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('entrer dans un groupe demande son motif (trois caractères au moins)'); end if;
  select g.nom into v_nom from plateforme.groupe g where g.id = p_groupe;
  if v_nom is null then perform socle.refus('ce groupe n''existe pas : relis la fiche'); end if;
  perform plateforme.groupe_peut_entrer(p_entreprise);
  insert into plateforme.groupe_membre (groupe, entreprise, depuis, motif, qui) values (p_groupe, p_entreprise, p_jour, btrim(p_motif), socle.moi());
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'groupes.entree', p_entreprise, btrim(p_motif), null,
            jsonb_build_object('groupe', p_groupe, 'nom', v_nom, 'depuis', p_jour));
end $$;

create function plateforme.console_sortir_groupe(p_entreprise uuid, p_motif text, p_jour date) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_m plateforme.groupe_membre;
  v_nom text;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('sortir d''un groupe demande son motif (trois caractères au moins)'); end if;
  select * into v_m from plateforme.groupe_membre m where m.entreprise = p_entreprise and m.retire_le is null for update;
  if not found then perform socle.refus('cette société n''est dans aucun groupe'); end if;
  select g.nom into v_nom from plateforme.groupe g where g.id = v_m.groupe;
  update plateforme.groupe_membre set retire_le = greatest(p_jour, v_m.depuis), retire_motif = btrim(p_motif), retire_par = socle.moi()
   where id = v_m.id;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'groupes.sortie', p_entreprise, btrim(p_motif),
            jsonb_build_object('groupe', v_m.groupe, 'nom', v_nom, 'depuis', v_m.depuis), jsonb_build_object('groupe', null));
end $$;

-- ── 8. Ce que la fiche d'une entreprise lit : son groupe, ses voisines, sa remise ─────────────────────────────────────
-- `voisines` : les sociétés qui ont la même propriétaire et ne sont dans aucun groupe (la console les propose) ;
-- `groupes` : les groupes existants, pour en rejoindre un ; `remise` : celle de la période qui commence `p_debut`.
create function plateforme.console_groupe_de(p_entreprise uuid, p_jour date, p_debut date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  v_m plateforme.groupe_membre;
begin
  select * into v_m from plateforme.groupe_membre m where m.entreprise = p_entreprise and m.retire_le is null;
  return jsonb_build_object(
    'groupe', case when v_m.id is null then null else (
      select jsonb_build_object('id', g.id, 'nom', g.nom, 'depuis', v_m.depuis, 'motif', v_m.motif,
        'membres', (select coalesce(jsonb_agg(jsonb_build_object('entreprise', e.id, 'raisonSociale', e.raison_sociale, 'depuis', m.depuis,
                      'premierePeriode', plateforme.premiere_periode(e.id))
                      order by plateforme.premiere_periode(e.id) nulls last, e.cree_le, e.id), '[]'::jsonb)
                      from plateforme.groupe_membre m join socle.entreprise e on e.id = m.entreprise
                     where m.groupe = g.id and m.retire_le is null))
        from plateforme.groupe g where g.id = v_m.groupe) end,
    'voisines', (select coalesce(jsonb_agg(jsonb_build_object('entreprise', e.id, 'raisonSociale', e.raison_sociale) order by e.raison_sociale), '[]'::jsonb)
                   from socle.entreprise e
                  where e.id <> p_entreprise and not e.essai and e.id is distinct from (select d.entreprise from plateforme.editeur d)
                    and not exists (select 1 from plateforme.groupe_membre m where m.entreprise = e.id and m.retire_le is null)
                    and exists (select 1 from socle.membre a join socle.membre b on b.utilisateur = a.utilisateur
                                 where a.entreprise = p_entreprise and b.entreprise = e.id and a.actif and b.actif
                                   and 'proprietaire' = any(a.roles) and 'proprietaire' = any(b.roles))),
    'groupes', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'nom', g.nom,
                   'membres', (select count(*) from plateforme.groupe_membre m where m.groupe = g.id and m.retire_le is null)) order by g.nom), '[]'::jsonb)
                  from plateforme.groupe g
                 where exists (select 1 from plateforme.groupe_membre m where m.groupe = g.id and m.retire_le is null)),
    'tauxGroupe', coalesce((plateforme.regle_remise_du_jour('groupe', p_debut)->>'taux')::int, 0),
    'remise', plateforme.remise_de(p_entreprise, p_debut));
end $$;

-- L'aperçu d'un geste sur un groupe, sans rien écrire (10 § 2.4) : les sociétés du groupe après lui, dans l'ordre de leur
-- première période payée (la première paie le prix normal), et le taux de la remise de groupe du jour. `p_groupe` : le
-- groupe (null : un groupe à créer) ; `p_entrent` : les sociétés qui y entrent ; `p_sort` : celle qui en sort. Les mêmes
-- refus que le geste.
create function plateforme.console_groupe_apercu(p_groupe uuid, p_entrent uuid[], p_sort uuid, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_e uuid;
begin
  if p_groupe is not null and not exists (select 1 from plateforme.groupe g where g.id = p_groupe) then
    perform socle.refus('ce groupe n''existe pas : relis la fiche');
  end if;
  for v_e in select distinct x from unnest(coalesce(p_entrent, '{}'::uuid[])) x loop perform plateforme.groupe_peut_entrer(v_e); end loop;
  if p_sort is not null and not exists (select 1 from plateforme.groupe_membre m where m.entreprise = p_sort and m.groupe = p_groupe and m.retire_le is null) then
    perform socle.refus('cette société n''est dans aucun groupe');
  end if;
  return jsonb_build_object(
    'taux', coalesce((plateforme.regle_remise_du_jour('groupe', p_jour)->>'taux')::int, 0),
    'membres', (select coalesce(jsonb_agg(jsonb_build_object('entreprise', e.id, 'raisonSociale', e.raison_sociale,
                  'premierePeriode', plateforme.premiere_periode(e.id)) order by plateforme.premiere_periode(e.id) nulls last, e.cree_le, e.id), '[]'::jsonb)
                  from socle.entreprise e
                 where e.id is distinct from p_sort
                   and (e.id = any(coalesce(p_entrent, '{}'::uuid[]))
                        or exists (select 1 from plateforme.groupe_membre m where m.groupe = p_groupe and m.entreprise = e.id and m.retire_le is null))));
end $$;

-- ── 9. L'abonné lit sa remise, comme ce que son offre compte : le propriétaire ou un administrateur ──────────────────
create function plateforme.ma_remise(p_entreprise uuid, p_debut date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is null or socle.ma_cle() is not null or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']::text[]) then
    return null;
  end if;
  -- Sans le nom de la première société du groupe : c'est une autre entreprise.
  return (select (r - 'premiere') || case when r ? 'aussi' then jsonb_build_object('aussi', (r->'aussi') - 'premiere') else '{}'::jsonb end
            from (select plateforme.remise_de(p_entreprise, p_debut) r) x where r is not null);
end $$;

-- Les échéances de la console : la remise de la prochaine période de chaque entreprise (le lendemain de son échéance).
create function plateforme.console_remises_echeances() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction', 'support']);
begin
  return (select coalesce(jsonb_object_agg(a.entreprise, r.remise), '{}'::jsonb)
    from plateforme.abonnement a join socle.entreprise e on e.id = a.entreprise
    cross join lateral (select plateforme.remise_de(a.entreprise, greatest(a.essai_jusqu_au, coalesce(a.paye_jusqu_au, a.essai_jusqu_au)) + 1) remise) r
   where not e.essai and r.remise is not null);
end $$;

revoke execute on function plateforme.regle_remise_du_jour(text, date), plateforme.premiere_periode(uuid), plateforme.premier_paiement(uuid),
  plateforme.remise_de(uuid, date), plateforme.console_remise(uuid, date),
  plateforme.console_preparer_remise(text, integer, integer, date, text, timestamptz, date),
  plateforme.console_retirer_remise(text, date, text, timestamptz, date), plateforme.console_remises(date),
  plateforme.groupe_peut_entrer(uuid), plateforme.console_creer_groupe(text, uuid[], text, date),
  plateforme.console_entrer_groupe(uuid, uuid, text, date), plateforme.console_sortir_groupe(uuid, text, date),
  plateforme.console_groupe_de(uuid, date, date), plateforme.console_groupe_apercu(uuid, uuid[], uuid, date), plateforme.ma_remise(uuid, date),
  plateforme.console_remises_echeances() from public;
grant execute on function plateforme.console_remise(uuid, date),
  plateforme.console_preparer_remise(text, integer, integer, date, text, timestamptz, date),
  plateforme.console_retirer_remise(text, date, text, timestamptz, date), plateforme.console_remises(date),
  plateforme.console_creer_groupe(text, uuid[], text, date), plateforme.console_entrer_groupe(uuid, uuid, text, date),
  plateforme.console_sortir_groupe(uuid, text, date), plateforme.console_groupe_de(uuid, date, date), plateforme.console_groupe_apercu(uuid, uuid[], uuid, date),
  plateforme.ma_remise(uuid, date), plateforme.console_remises_echeances(), plateforme.montant_remise(bigint, integer) to skanfact_app;
