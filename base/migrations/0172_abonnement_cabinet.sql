-- 0172 — L'abonnement des cabinets (1.120.0 ; docs/abonnement.md C22 ; docs/cadrage/07-offres-et-prix.md, « Comment
-- l'abonnement du cabinet s'applique », décidé avec Skander le 23/10/2026 ; docs/revue-abonnement.md, lot 3).
--
-- Le cabinet est le canal de vente : il ne paie jamais pour un client abonné. Il paie pour les dossiers qu'il TIENT
-- lui-même (un client pas sur SkanFact) : les premiers gratuits, puis un prix par dossier et par an, jamais plus qu'un
-- plafond. Comme tout prix, ces nombres vivent ici, datés, et la direction les change dans la console (avec le préavis
-- d'un prix) :
--   - une facture par an, à l'anniversaire du cabinet (le jour où il a eu plus de dossiers tenus que de gratuits), sur
--     les dossiers tenus payants ce jour-là ; un dossier ajouté en cours d'année se rattrape au prorata de ses jours sur
--     la facture suivante (la règle du module ouvert en cours de période, 0113) ;
--   - préparée et émise par le serveur, au nom de la propriétaire de l'entreprise SkanFact, comme la facture au choix
--     (0171) ; un refus garde son motif pour la console ;
--   - payée (en ligne ou notée par SkanFact), elle paie l'abonnement du cabinet jusqu'à la fin de sa période ;
--   - sans paiement après l'échéance et la grâce : les dossiers tenus PAYANTS passent en lecture seule (la porte des
--     gestes les ferme, serveur/abonnement/condition.ts) et la création d'un dossier tenu se ferme ; les gratuits et les
--     dossiers des clients abonnés restent entiers. Jamais de données en otage : tout se lit, s'imprime, s'exporte.
-- Les dossiers comptent dans l'ordre où ils ont été créés : les plus anciens sont les gratuits. Un dossier archivé (sa
-- fiche, « Dossier archivé ») ne compte pas ; un dossier que son client a rejoint (0155) n'est plus tenu.

-- ── 1. Les règles du cabinet, datées ────────────────────────────────────────────────────────────────────────────────
create table plateforme.regle_cabinet (
  id uuid primary key default socle.uuidv7(),
  -- prix_dossier : le prix HT d'un dossier tenu payant, à l'année (millimes) ; gratuits : combien de dossiers tenus ne se
  -- paient pas ; plafond : jamais plus, par an (millimes) ; delai : les jours entre le début de la période et l'échéance.
  code text not null check (code in ('prix_dossier', 'gratuits', 'plafond', 'delai')),
  valeur bigint not null check (valeur >= 0),
  a_partir_du date not null,
  motif text not null check (length(btrim(motif)) >= 3),
  pose_par uuid references socle.utilisateur(id),
  pose_le timestamptz not null default now()
);
alter table plateforme.regle_cabinet enable row level security;
alter table plateforme.regle_cabinet force row level security;
revoke all on plateforme.regle_cabinet from public;
insert into plateforme.regle_cabinet (code, valeur, a_partir_du, motif) values
  ('prix_dossier', 60000, '2000-01-01', 'Cadrage 07 (28/09/2026, appliqué le 23/10/2026) : 60 DT HT par dossier tenu et par an'),
  ('gratuits', 3, '2000-01-01', 'Cadrage 07 (28/09/2026) : trois dossiers tenus gratuits'),
  ('plafond', 1990000, '2000-01-01', 'Cadrage 07 (28/09/2026) : jamais plus de 1 990 DT HT par an'),
  ('delai', 15, '2000-01-01', 'Lot 3 (23/10/2026, par délégation) : quinze jours pour régler la facture annuelle');

-- La valeur d'une règle un jour donné ; aucune : inconnue (et rien ne se facture ni ne se ferme sur ce qu'on ne connaît pas).
create function plateforme.regle_cabinet_du_jour(p_code text, p_jour date) returns bigint
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select r.valeur from plateforme.regle_cabinet r where r.code = p_code and r.a_partir_du <= p_jour
   order by r.a_partir_du desc, r.pose_le desc, r.id desc limit 1
$$;

-- ── 2. L'abonnement du cabinet et ses factures ──────────────────────────────────────────────────────────────────────
create table plateforme.abonnement_cabinet (
  cabinet uuid primary key references socle.organisation(id),
  -- L'anniversaire : le jour où le cabinet a eu un dossier tenu payant pour la première fois.
  depuis date not null,
  paye_jusqu_au date,
  cree_le timestamptz not null default now()
);
alter table plateforme.abonnement_cabinet enable row level security;
alter table plateforme.abonnement_cabinet force row level security;
revoke all on plateforme.abonnement_cabinet from public;

create table plateforme.facture_cabinet (
  id uuid primary key default socle.uuidv7(),
  cabinet uuid not null references socle.organisation(id),
  editeur uuid not null references socle.entreprise(id),
  piece_v10 text not null,
  client_v10 text not null,
  debut date not null,
  fin date not null check (fin >= debut),
  echeance date not null,
  -- Les dossiers payants comptés au premier jour, et ceux de la période d'avant rattrapés au prorata.
  dossiers uuid[] not null,
  rattrapes uuid[] not null default '{}',
  montant_ht bigint not null check (montant_ht > 0),
  prepare_le timestamptz not null default now(),
  prepare_par uuid references socle.utilisateur(id),
  payee_le timestamptz,
  annoncee_le timestamptz,
  recu_le timestamptz,
  unique (editeur, piece_v10),
  unique (cabinet, debut)
);
alter table plateforme.facture_cabinet enable row level security;
alter table plateforme.facture_cabinet force row level security;
revoke all on plateforme.facture_cabinet from public;

-- Une période qui ne s'est pas facturée : son motif (pour la console ; retentée le lendemain), ou « vide » quand il n'y
-- avait rien à facturer (tous les dossiers rejoints par leurs clients) : la période passe, elle ne se retente pas.
create table plateforme.facture_cabinet_refus (
  cabinet uuid not null references socle.organisation(id),
  debut date not null,
  le timestamptz not null default now(),
  vide boolean not null default false,
  motif text not null check (length(motif) between 1 and 2000),
  primary key (cabinet, debut)
);
alter table plateforme.facture_cabinet_refus enable row level security;
alter table plateforme.facture_cabinet_refus force row level security;
revoke all on plateforme.facture_cabinet_refus from public;

-- ── 3. Les dossiers tenus, et lesquels se paient ────────────────────────────────────────────────────────────────────
-- Les dossiers tenus d'un cabinet, dans l'ordre de leur création : les premiers sont gratuits. Interne (aucune porte).
create function plateforme.dossiers_du_cabinet(p_cabinet uuid, p_jour date)
returns table (entreprise uuid, nom text, cree date, rang bigint, payant boolean)
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select d.id, d.raison_sociale, d.cree, d.rang,
         d.rang > coalesce(plateforme.regle_cabinet_du_jour('gratuits', p_jour), 9223372036854775807)
    from (select e.id, e.raison_sociale, (e.cree_le at time zone e.fuseau)::date cree, row_number() over (order by e.cree_le, e.id) rang
            from socle.entreprise e
           where e.tenue_par = p_cabinet and e.active
             and not exists (select 1 from cabinet.fiche f where f.cabinet = p_cabinet and f.entreprise = e.id and f.contenu ->> 'archived' = 'true')) d
$$;

-- Le reste d'une facture de l'entreprise SkanFact : net − avoirs émis − règlements (la règle de moteur/reglements.ts).
create function plateforme.reste_piece(p_entreprise uuid, p_ref_v10 text) returns bigint
language sql stable security definer set search_path = pg_catalog, ventes as $$
  select p.net_a_payer
         - coalesce((select sum(a.net_a_payer) from ventes.piece a where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise'), 0)
         - coalesce((select sum(r.montant) from ventes.reglement r where r.entreprise = p.entreprise and r.piece = p.id), 0)
    from ventes.piece p where p.entreprise = p_entreprise and p.ref_v10 = p_ref_v10 and p.type = 'facture' and p.statut = 'emise'
$$;

-- L'état de l'abonnement d'un cabinet un jour donné. Interne.
--   lecture_seule : une facture émise attend son paiement au-delà de son échéance et de la grâce (`depuis`) ;
--   a_payer : une facture émise attend son paiement (`echeance`) ;
--   actif : payé jusqu'à `jusquAu` ;
--   a_facturer : des dossiers payants, sans facture pour la période qui court (la facture part dans la minute) ;
--   gratuit : rien à payer.
-- Une grâce qu'on ne connaît pas ne ferme rien (0104).
create function plateforme.etat_cabinet(p_cabinet uuid, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  v_grace integer := (plateforme.regle_du_jour('grace', p_jour))[1];
  v_dues record;
  v_a plateforme.abonnement_cabinet;
  v_payants bigint;
begin
  select min(f.echeance) echeance, count(*) n into v_dues
    from plateforme.facture_cabinet f
   where f.cabinet = p_cabinet and coalesce(plateforme.reste_piece(f.editeur, f.piece_v10), 0) > 0;
  if v_dues.n > 0 then
    if v_grace is not null and v_dues.echeance + v_grace < p_jour then
      return jsonb_build_object('etat', 'lecture_seule', 'depuis', v_dues.echeance + v_grace + 1, 'echeance', v_dues.echeance);
    end if;
    return jsonb_build_object('etat', 'a_payer', 'echeance', v_dues.echeance,
      'lectureSeuleLe', case when v_grace is null then null else v_dues.echeance + v_grace + 1 end);
  end if;
  select * into v_a from plateforme.abonnement_cabinet a where a.cabinet = p_cabinet;
  if v_a.paye_jusqu_au is not null and v_a.paye_jusqu_au >= p_jour then
    return jsonb_build_object('etat', 'actif', 'jusquAu', v_a.paye_jusqu_au);
  end if;
  select count(*) into v_payants from plateforme.dossiers_du_cabinet(p_cabinet, p_jour) d where d.payant;
  if v_payants > 0 then return jsonb_build_object('etat', 'a_facturer'); end if;
  return jsonb_build_object('etat', 'gratuit');
end $$;

-- L'anniversaire de la période qui court (le dernier, au plus tard aujourd'hui) ; rien sans abonnement.
create function plateforme.periode_cabinet(p_cabinet uuid, p_jour date) returns date
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select (a.depuis + make_interval(years => greatest(0, extract(year from age(p_jour, a.depuis))::int)))::date
    from plateforme.abonnement_cabinet a where a.cabinet = p_cabinet and a.depuis <= p_jour
$$;

-- Ce que la facture d'une période dira : les dossiers payants (comptés aujourd'hui), le rattrapage de ceux ajoutés pendant
-- la période d'avant (au prix de son premier jour, la règle de rattrapage_modules, 0113), le plafond. Interne : la même
-- fonction prépare, revérifie, et montre la prochaine facture (deux chemins, un chiffre). Rien sans prix connu.
create function plateforme.calcul_facture_cabinet(p_cabinet uuid, p_debut date, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_a plateforme.abonnement_cabinet;
  v_prix bigint := plateforme.regle_cabinet_du_jour('prix_dossier', p_debut);
  v_plafond bigint := plateforme.regle_cabinet_du_jour('plafond', p_debut);
  v_delai bigint := plateforme.regle_cabinet_du_jour('delai', p_debut);
  v_fin date := (p_debut + interval '1 year')::date - 1;
  v_prev_debut date := (p_debut - interval '1 year')::date;
  v_prev_fin date := p_debut - 1;
  v_prev_prix bigint := plateforme.regle_cabinet_du_jour('prix_dossier', (p_debut - interval '1 year')::date);
  v_deja uuid[];
  v_dossiers jsonb;
  v_n bigint;
  v_ratt jsonb := '[]'::jsonb;
  v_ratt_ht bigint := 0;
  v_sur integer := p_debut - (p_debut - interval '1 year')::date;
  v_brut bigint;
  d record;
  v_jours integer;
  v_m bigint;
begin
  if v_prix is null then return null; end if;
  select * into v_a from plateforme.abonnement_cabinet a where a.cabinet = p_cabinet;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.entreprise, 'nom', x.nom) order by x.rang), '[]'::jsonb), count(*)
    into v_dossiers, v_n from plateforme.dossiers_du_cabinet(p_cabinet, p_jour) x where x.payant;
  -- Le rattrapage : seulement si une période payante a couru avant celle-ci.
  if v_a.cabinet is not null and v_a.depuis <= v_prev_fin and v_prev_prix is not null then
    select f.dossiers into v_deja from plateforme.facture_cabinet f where f.cabinet = p_cabinet and f.debut = v_prev_debut;
    for d in select x.* from plateforme.dossiers_du_cabinet(p_cabinet, p_jour) x
              where x.payant and x.cree between greatest(v_prev_debut, v_a.depuis) and v_prev_fin
                and not (x.entreprise = any(coalesce(v_deja, '{}'::uuid[])))
              order by x.rang
    loop
      v_jours := v_prev_fin - greatest(d.cree, v_prev_debut, v_a.depuis) + 1;
      v_m := (v_prev_prix * v_jours * 2 + v_sur) / (2 * v_sur);
      v_ratt := v_ratt || jsonb_build_object('id', d.entreprise, 'nom', d.nom, 'du', greatest(d.cree, v_prev_debut, v_a.depuis), 'au', v_prev_fin,
        'jours', v_jours, 'sur', v_sur, 'montantHt', v_m::text);
      v_ratt_ht := v_ratt_ht + v_m;
    end loop;
  end if;
  v_brut := v_n * v_prix + v_ratt_ht;
  return jsonb_build_object('debut', p_debut, 'fin', v_fin, 'echeance', p_debut + coalesce(v_delai, 0)::integer,
    'prixHt', v_prix::text, 'plafondHt', case when v_plafond is null then null else v_plafond::text end,
    'gratuits', plateforme.regle_cabinet_du_jour('gratuits', p_jour),
    'dossiers', v_dossiers, 'rattrapages', v_ratt, 'brutHt', v_brut::text,
    'totalHt', (case when v_plafond is not null and v_brut > v_plafond then v_plafond else v_brut end)::text,
    'plafonne', v_plafond is not null and v_brut > v_plafond);
end $$;

-- ── 4. Créer un dossier tenu : jamais bloqué, sauf quand l'abonnement attend son paiement au-delà de la grâce ──────────
-- Le dossier qui dépasse les gratuits fixe l'anniversaire du cabinet (son abonnement commence ce jour-là) ; sa facture part
-- dans la minute (serveur/abonnement/cabinet.ts).
create or replace function socle.creer_dossier_tenu(p_cabinet uuid, p_raison_sociale text, p_matricule text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_org uuid; v_ent uuid; v_jour date := (now() at time zone 'Africa/Tunis')::date;
begin
  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet crée un dossier'); end if;
  -- Le même verrou que la facture : un dossier créé pendant qu'elle se prépare attend qu'elle soit écrite.
  perform pg_advisory_xact_lock(hashtextextended('facture-cabinet:' || p_cabinet, 0));
  if plateforme.etat_cabinet(p_cabinet, v_jour) ->> 'etat' = 'lecture_seule' then
    perform socle.refus('la facture de l''abonnement de ton cabinet attend son paiement : règle-la pour créer un dossier tenu de plus (Réglages, Mon cabinet, Ton abonnement). Tes dossiers se lisent et s''exportent toujours');
  end if;
  perform socle.exiger_matricule_libre(p_matricule, null);
  insert into socle.organisation (type, nom) values ('independant', p_raison_sociale) returning id into v_org;
  insert into socle.entreprise (organisation, raison_sociale, matricule_fiscal, tenue_par)
    values (v_org, p_raison_sociale, p_matricule, p_cabinet) returning id into v_ent;
  insert into socle.etablissement (entreprise, code, nom, type) values (v_ent, '000', 'Siège', 'siege');
  insert into socle.mandat (cabinet, entreprise, accorde_par, debut, perimetre, statut)
  values (p_cabinet, v_ent, socle.moi(), current_date, array['comptabilite', 'declarations', 'saisie_achats', 'paie'], 'actif');
  if not exists (select 1 from plateforme.abonnement_cabinet a where a.cabinet = p_cabinet)
     and exists (select 1 from plateforme.dossiers_du_cabinet(p_cabinet, v_jour) d where d.payant) then
    insert into plateforme.abonnement_cabinet (cabinet, depuis) values (p_cabinet, v_jour);
  end if;
  return v_ent;
end $$;

-- ── 5. La facture, préparée et émise par le serveur ─────────────────────────────────────────────────────────────────
-- Les périodes à facturer (le serveur, hors de toute personne) : la période qui court de chaque cabinet abonné, sans
-- facture, ni « vide », ni refusée depuis moins d'un jour ; avec la propriétaire de l'entreprise SkanFact.
create function plateforme.cabinets_a_facturer(p_cabinet uuid, p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select coalesce(jsonb_agg(jsonb_build_object('cabinet', x.cabinet, 'debut', x.debut, 'proprietaire', p.utilisateur) order by x.debut), '[]'::jsonb)
    from (select a.cabinet, plateforme.periode_cabinet(a.cabinet, p_jour) debut from plateforme.abonnement_cabinet a
           where (p_cabinet is null or a.cabinet = p_cabinet) and a.depuis <= p_jour) x
    join plateforme.editeur d on true
    cross join lateral (select m.utilisateur from socle.membre m where m.entreprise = d.entreprise and m.actif and 'proprietaire' = any(m.roles)
                         order by m.utilisateur limit 1) p
   where socle.moi() is null
     and not exists (select 1 from plateforme.facture_cabinet f where f.cabinet = x.cabinet and f.debut = x.debut)
     and not exists (select 1 from plateforme.facture_cabinet_refus r where r.cabinet = x.cabinet and r.debut = x.debut
                       and (r.vide or r.le > now() - interval '1 day'))
$$;

-- Ce qu'il faut pour facturer une période, à la propriétaire de l'entreprise SkanFact seulement : le cabinet tel que la
-- facture le nomme (son nom, l'adresse d'un associé), la fiche de client de ses factures d'avant, et le calcul.
create function plateforme.facture_cabinet_pour(p_cabinet uuid, p_debut date, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_editeur uuid := plateforme.editeur_de_mes_factures();
begin
  return jsonb_build_object(
    'cabinet', (select jsonb_build_object('nom', o.nom,
                  'email', (select u.email from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
                             where m.organisation = o.id and m.actif and 'supervision' = any(m.roles) order by m.utilisateur limit 1))
                  from socle.organisation o where o.id = p_cabinet and o.type = 'cabinet'),
    'client', (select f.client_v10 from plateforme.facture_cabinet f where f.cabinet = p_cabinet and f.editeur = v_editeur
                order by f.debut desc limit 1),
    'calcul', plateforme.calcul_facture_cabinet(p_cabinet, p_debut, p_jour));
end $$;

-- La facture préparée : la base revérifie le calcul (le même), la pièce et la fiche au dossier de l'entreprise SkanFact.
create function plateforme.noter_facture_cabinet(p_cabinet uuid, p_debut date, p_jour date, p_piece_v10 text, p_client_v10 text,
                                                 p_montant_ht bigint, p_dossiers uuid[], p_rattrapes uuid[]) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_editeur uuid := plateforme.editeur_de_mes_factures();
  v_c jsonb;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('facture-cabinet:' || p_cabinet, 0));
  if p_debut is distinct from plateforme.periode_cabinet(p_cabinet, p_jour) then
    perform socle.refus('cette période n''est pas celle qui court pour ce cabinet');
  end if;
  v_c := plateforme.calcul_facture_cabinet(p_cabinet, p_debut, p_jour);
  if v_c is null or (v_c ->> 'totalHt')::bigint <> p_montant_ht
     or array(select (x ->> 'id')::uuid from jsonb_array_elements(v_c -> 'dossiers') x) is distinct from coalesce(p_dossiers, '{}'::uuid[])
     or array(select (x ->> 'id')::uuid from jsonb_array_elements(v_c -> 'rattrapages') x) is distinct from coalesce(p_rattrapes, '{}'::uuid[]) then
    perform socle.refus('le total n''est pas celui des dossiers tenus du cabinet ce jour-là');
  end if;
  if not exists (select 1 from socle.dossier_v10 d where d.entreprise = v_editeur and d.collection = 'documents' and d.cle = p_piece_v10)
     or not exists (select 1 from socle.dossier_v10 d where d.entreprise = v_editeur and d.collection = 'clients' and d.cle = p_client_v10) then
    perform socle.refus(format('la facture préparée manque au dossier de l''entreprise SkanFact : %s', p_piece_v10));
  end if;
  insert into plateforme.facture_cabinet (cabinet, editeur, piece_v10, client_v10, debut, fin, echeance, dossiers, rattrapes, montant_ht, prepare_par)
    values (p_cabinet, v_editeur, p_piece_v10, p_client_v10, p_debut, (v_c ->> 'fin')::date, (v_c ->> 'echeance')::date,
            coalesce(p_dossiers, '{}'), coalesce(p_rattrapes, '{}'), p_montant_ht, socle.moi())
    returning id into v_id;
  delete from plateforme.facture_cabinet_refus r where r.cabinet = p_cabinet and r.debut = p_debut;
  return v_id;
end $$;

-- Une période qui ne s'est pas facturée (le serveur, hors de toute personne) : son motif, ou « vide ».
create function plateforme.facture_cabinet_refus_noter(p_cabinet uuid, p_debut date, p_vide boolean, p_motif text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is not null then perform socle.refus('seul le serveur note une facture de cabinet qui ne s''est pas faite'); end if;
  insert into plateforme.facture_cabinet_refus (cabinet, debut, vide, motif) values (p_cabinet, p_debut, p_vide, left(p_motif, 2000))
    on conflict (cabinet, debut) do update set le = now(), vide = excluded.vide, motif = excluded.motif;
end $$;

-- ── 6. Payée, la facture paie l'abonnement du cabinet ───────────────────────────────────────────────────────────────
-- Appelée par le serveur après chaque règlement d'une facture du dossier de l'entreprise SkanFact (serveur/v10/dossier.ts).
-- Rien de ce qu'on lui passe n'est cru : la pièce, ses avoirs et ses règlements se relisent ici. Une fois par facture.
create function plateforme.cabinet_paye_par_facture(p_editeur uuid, p_piece_v10 text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_f plateforme.facture_cabinet;
begin
  select * into v_f from plateforme.facture_cabinet f where f.editeur = p_editeur and f.piece_v10 = p_piece_v10 for update;
  if not found or v_f.payee_le is not null then return null; end if;
  if not exists (select 1 from plateforme.editeur e where e.entreprise = p_editeur) then return null; end if;
  if coalesce(plateforme.reste_piece(p_editeur, p_piece_v10), 1) > 0 then return null; end if;
  update plateforme.facture_cabinet set payee_le = now() where id = v_f.id;
  update plateforme.abonnement_cabinet a set paye_jusqu_au = greatest(coalesce(a.paye_jusqu_au, v_f.fin), v_f.fin) where a.cabinet = v_f.cabinet;
  return v_f.id;
end $$;

-- ── 7. Ce que l'associé lit, et ce qu'il règle ──────────────────────────────────────────────────────────────────────
create function plateforme.cabinet_exiger_associe(p_cabinet uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is null or socle.ma_cle() is not null or not socle.suis_associe(p_cabinet) then
    perform socle.refus('l''abonnement du cabinet se lit et se règle par un associé du cabinet');
  end if;
end $$;

-- Les factures émises du cabinet et leurs avoirs (la forme de mes_pieces_abonnement, 0098). Interne.
create function plateforme.pieces_du_cabinet(p_cabinet uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
  select coalesce(jsonb_agg(x.j order by x.le desc, x.id desc), '[]'::jsonb) from (
    select p.id, p.date_piece le, jsonb_build_object(
        'id', p.id, 'editeur', f.editeur, 'type', p.type, 'numero', p.numero_texte, 'date', p.date_piece, 'echeance', p.echeance,
        'devise', p.devise, 'decimales', dv.decimales, 'net', p.net_a_payer::text,
        'avoirs', (select coalesce(jsonb_agg(a.net_a_payer::text), '[]') from ventes.piece a
                    where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise'),
        'reglements', (select coalesce(jsonb_agg(r.montant::text), '[]') from ventes.reglement r
                        where r.entreprise = p.entreprise and r.piece = p.id),
        'periode', jsonb_build_object('debut', f.debut, 'fin', f.fin, 'dossiers', cardinality(f.dossiers), 'rattrapes', cardinality(f.rattrapes)),
        'document', d.contenu) j
      from plateforme.facture_cabinet f
      join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
      join socle.devise dv on dv.code = p.devise
      join socle.dossier_v10 d on d.entreprise = p.entreprise and d.collection = 'documents' and d.cle = p.ref_v10
     where f.cabinet = p_cabinet
    union all
    select a.id, a.date_piece, jsonb_build_object(
        'id', a.id, 'editeur', f.editeur, 'type', a.type, 'numero', a.numero_texte, 'date', a.date_piece, 'echeance', a.echeance,
        'devise', a.devise, 'decimales', dv.decimales, 'net', a.net_a_payer::text, 'avoirs', '[]'::jsonb, 'reglements', '[]'::jsonb,
        'periode', jsonb_build_object('debut', f.debut, 'fin', f.fin, 'dossiers', cardinality(f.dossiers), 'rattrapes', cardinality(f.rattrapes)),
        'document', d.contenu)
      from plateforme.facture_cabinet f
      join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
      join ventes.piece a on a.entreprise = p.entreprise and a.corrige = p.id and a.type = 'avoir' and a.statut = 'emise'
      join socle.devise dv on dv.code = a.devise
      join socle.dossier_v10 d on d.entreprise = a.entreprise and d.collection = 'documents' and d.cle = a.ref_v10
     where f.cabinet = p_cabinet
  ) x
$$;

-- « Ton abonnement » du cabinet, pour un associé : l'état, les règles du jour, les dossiers tenus (gratuits et payants),
-- les clients abonnés (gratuits, sans limite), la prochaine facture (le même calcul), ce que coûterait un dossier de plus,
-- et les factures émises (réduites par le serveur à ce qu'elles impriment).
create function plateforme.mon_abonnement_cabinet(p_cabinet uuid, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  v_a plateforme.abonnement_cabinet;
  v_prochain date;
  v_pieces jsonb;
  v_f plateforme.facture_cabinet;
  v_tenus bigint;
  v_gratuits bigint := plateforme.regle_cabinet_du_jour('gratuits', p_jour);
begin
  perform plateforme.cabinet_exiger_associe(p_cabinet);
  select * into v_a from plateforme.abonnement_cabinet a where a.cabinet = p_cabinet;
  if v_a.cabinet is not null then
    v_prochain := (plateforme.periode_cabinet(p_cabinet, p_jour) + interval '1 year')::date;
  end if;
  select count(*) into v_tenus from plateforme.dossiers_du_cabinet(p_cabinet, p_jour);
  v_pieces := plateforme.pieces_du_cabinet(p_cabinet);
  select f.* into v_f from plateforme.facture_cabinet f
   where f.cabinet = p_cabinet and exists (select 1 from ventes.piece p where p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.statut = 'emise')
   order by f.debut desc limit 1;
  return jsonb_build_object(
    'etat', plateforme.etat_cabinet(p_cabinet, p_jour),
    'depuis', v_a.depuis, 'payeJusquAu', v_a.paye_jusqu_au,
    'regles', jsonb_build_object('prixHt', plateforme.regle_cabinet_du_jour('prix_dossier', p_jour)::text, 'gratuits', v_gratuits,
                'plafondHt', plateforme.regle_cabinet_du_jour('plafond', p_jour)::text, 'delai', plateforme.regle_cabinet_du_jour('delai', p_jour),
                'grace', (plateforme.regle_du_jour('grace', p_jour))[1]),
    'dossiers', (select coalesce(jsonb_agg(jsonb_build_object('id', d.entreprise, 'nom', d.nom, 'payant', d.payant) order by d.rang), '[]'::jsonb)
                   from plateforme.dossiers_du_cabinet(p_cabinet, p_jour) d),
    'abonnes', (select count(distinct m.entreprise) from socle.mandat m join socle.entreprise e on e.id = m.entreprise
                 where m.cabinet = p_cabinet and m.statut = 'actif' and e.tenue_par is null and e.active),
    'prochaine', case when v_prochain is null then null else plateforme.calcul_facture_cabinet(p_cabinet, v_prochain, p_jour) end,
    'prochainDossier', jsonb_build_object('rang', v_tenus + 1, 'payant', v_gratuits is not null and v_tenus + 1 > v_gratuits,
                         'prixHt', plateforme.regle_cabinet_du_jour('prix_dossier', p_jour)::text, 'abonne', v_a.cabinet is not null),
    'factures', case when jsonb_array_length(v_pieces) = 0 then null else jsonb_build_object(
      'entreprise', (select d.contenu from socle.dossier_v10 d where d.entreprise = v_f.editeur and d.collection = '_racine' and d.cle = 'company'),
      'client', (select d.contenu from socle.dossier_v10 d where d.entreprise = v_f.editeur and d.collection = 'clients' and d.cle = v_f.client_v10),
      'pieces', v_pieces) end,
    'paiement', exists (select 1 from plateforme.editeur e join ventes.prestataire pr on pr.entreprise = e.entreprise));
end $$;

-- Régler en ligne une facture du cabinet (la forme de ma_facture_a_payer, 0098).
create function plateforme.ma_facture_cabinet_a_payer(p_cabinet uuid, p_numero text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare p jsonb; v_portefeuille text; v_cle text;
begin
  perform plateforme.cabinet_exiger_associe(p_cabinet);
  select x into p from jsonb_array_elements(plateforme.pieces_du_cabinet(p_cabinet)) x where x ->> 'type' = 'facture' and x ->> 'numero' = p_numero;
  if p is null then return null; end if;
  select portefeuille, cle_scellee into v_portefeuille, v_cle from ventes.prestataire where entreprise = (p ->> 'editeur')::uuid;
  return jsonb_build_object('entreprise', p ->> 'editeur', 'piece', p - 'document',
    'prestataire', case when v_portefeuille is null then null else jsonb_build_object('portefeuille', v_portefeuille, 'cle_scellee', v_cle) end);
end $$;
create function plateforme.mon_paiement_cabinet_demander(p_cabinet uuid, p_numero text, p_montant bigint, p_retour_empreinte text, p_maintenant timestamptz)
returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare a jsonb;
begin
  a := plateforme.ma_facture_cabinet_a_payer(p_cabinet, p_numero);
  if a is null then return null; end if;
  return ventes.paiement_noter(a, p_montant, p_retour_empreinte, p_maintenant);
end $$;

-- ── 8. La lecture seule des dossiers payants ────────────────────────────────────────────────────────────────────────
-- Depuis quand un dossier tenu est en lecture seule (son cabinet ne paie plus, et il est payant), ou rien. Seulement le
-- jour : la porte des gestes s'en sert pour toute personne qui écrit dans le dossier.
create function plateforme.dossier_tenu_bloque_depuis(p_entreprise uuid, p_jour date) returns date
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select case when s ->> 'etat' = 'lecture_seule' and d.payant then (s ->> 'depuis')::date end
    from socle.entreprise e
    cross join lateral plateforme.etat_cabinet(e.tenue_par, p_jour) s
    join lateral plateforme.dossiers_du_cabinet(e.tenue_par, p_jour) d on d.entreprise = e.id
   where e.id = p_entreprise and e.tenue_par is not null
$$;

-- ── 9. La console ───────────────────────────────────────────────────────────────────────────────────────────────────
-- L'abonnement d'un cabinet, sur sa fiche (la direction et le support) : l'état, les dossiers, la prochaine facture, ses
-- factures (le reste de chacune), et le refus de la période qui court.
create function plateforme.console_abonnement_cabinet(p_cabinet uuid, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare v_a plateforme.abonnement_cabinet; v_periode date;
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  select * into v_a from plateforme.abonnement_cabinet a where a.cabinet = p_cabinet;
  v_periode := plateforme.periode_cabinet(p_cabinet, p_jour);
  return jsonb_build_object(
    'etat', plateforme.etat_cabinet(p_cabinet, p_jour), 'depuis', v_a.depuis, 'payeJusquAu', v_a.paye_jusqu_au,
    'tenus', (select count(*) from plateforme.dossiers_du_cabinet(p_cabinet, p_jour)),
    'payants', (select count(*) from plateforme.dossiers_du_cabinet(p_cabinet, p_jour) d where d.payant),
    'prochaine', case when v_periode is null then null else plateforme.calcul_facture_cabinet(p_cabinet, (v_periode + interval '1 year')::date, p_jour) end,
    'factures', (select coalesce(jsonb_agg(jsonb_build_object('debut', f.debut, 'fin', f.fin, 'echeance', f.echeance, 'montantHt', f.montant_ht::text,
                   'numero', p.numero_texte, 'net', p.net_a_payer::text, 'reste', plateforme.reste_piece(f.editeur, f.piece_v10)::text,
                   'payeeLe', f.payee_le, 'dossiers', cardinality(f.dossiers), 'rattrapes', cardinality(f.rattrapes)) order by f.debut desc), '[]'::jsonb)
                   from plateforme.facture_cabinet f
                   left join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
                  where f.cabinet = p_cabinet),
    'refus', (select r.motif from plateforme.facture_cabinet_refus r where r.cabinet = p_cabinet and r.debut = v_periode and not r.vide));
end $$;

-- Les périodes de cabinet qui ne se sont pas facturées seules (« À décider », la direction).
create function plateforme.console_factures_cabinet_refusees() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction']);
  return (select coalesce(jsonb_agg(jsonb_build_object('cabinet', jsonb_build_object('id', o.id, 'nom', o.nom), 'debut', r.debut, 'le', r.le,
            'motif', r.motif) order by r.le), '[]'::jsonb)
            from plateforme.facture_cabinet_refus r join socle.organisation o on o.id = r.cabinet
           where not r.vide and not exists (select 1 from plateforme.facture_cabinet f where f.cabinet = r.cabinet and f.debut = r.debut));
end $$;

-- Les règles du cabinet dans les Réglages : celles du jour, et ce qui est préparé (qui, pourquoi).
create function plateforme.console_regles_cabinet(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support', 'technique']);
  return jsonb_build_object(
    'duJour', (select coalesce(jsonb_object_agg(c.code, (select jsonb_build_object('valeur', r.valeur::text, 'aPartirDu', r.a_partir_du, 'motif', r.motif,
                  'par', (select u.nom from socle.utilisateur u where u.id = r.pose_par), 'le', r.pose_le)
                  from plateforme.regle_cabinet r where r.code = c.code and r.a_partir_du <= p_jour
                  order by r.a_partir_du desc, r.pose_le desc, r.id desc limit 1)), '{}'::jsonb)
                 from (values ('prix_dossier'), ('gratuits'), ('plafond'), ('delai')) c(code)),
    'aVenir', (select coalesce(jsonb_agg(jsonb_build_object('code', r.code, 'valeur', r.valeur::text, 'aPartirDu', r.a_partir_du, 'motif', r.motif,
                  'par', (select u.nom from socle.utilisateur u where u.id = r.pose_par), 'le', r.pose_le) order by r.a_partir_du, r.code), '[]'::jsonb)
                 from plateforme.regle_cabinet r where r.a_partir_du > p_jour),
    'cabinets', (select count(*) from plateforme.abonnement_cabinet));
end $$;

-- Préparer une règle du cabinet (la direction) : avec le préavis d'un prix, une à la fois par règle, jamais la même valeur.
create function plateforme.console_preparer_regle_cabinet(p_code text, p_valeur bigint, p_a_partir_du date, p_motif text,
                                                          p_maintenant timestamptz, p_jour date) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_preavis integer := (plateforme.regle_du_jour('preavis_prix', p_jour))[1];
  v_avant bigint;
begin
  perform pg_advisory_xact_lock(hashtext('plateforme.regle_cabinet'));
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('préparer une règle demande son motif (trois caractères au moins)'); end if;
  if p_code is null or p_code not in ('prix_dossier', 'gratuits', 'plafond', 'delai') then perform socle.refus('cette règle du cabinet n''existe pas'); end if;
  if p_valeur is null or p_valeur < 0 or (p_code in ('prix_dossier', 'plafond') and p_valeur = 0) then
    perform socle.refus('un prix est un montant hors taxes plus grand que zéro ; un nombre de dossiers ou de jours, zéro ou plus');
  end if;
  if v_preavis is null then perform socle.refus('le préavis d''un nouveau prix n''est pas réglé : règle-le d''abord'); end if;
  if p_a_partir_du is null or p_a_partir_du < p_jour + v_preavis then
    perform socle.refus(format('une nouvelle règle commence au plus tôt le %s : c''est le préavis en vigueur', to_char(p_jour + v_preavis, 'DD/MM/YYYY')));
  end if;
  if exists (select 1 from plateforme.regle_cabinet r where r.code = p_code and r.a_partir_du > p_jour) then
    perform socle.refus('une règle est déjà préparée pour ce choix : retire-la avant d''en préparer une autre');
  end if;
  v_avant := plateforme.regle_cabinet_du_jour(p_code, p_jour);
  if v_avant = p_valeur then perform socle.refus('c''est déjà la règle en vigueur : rien ne changerait'); end if;
  insert into plateforme.regle_cabinet (code, valeur, a_partir_du, motif, pose_par, pose_le)
    values (p_code, p_valeur, p_a_partir_du, btrim(p_motif), socle.moi(), p_maintenant);
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.regle_cabinet', btrim(p_motif),
            jsonb_build_object('code', p_code, 'valeur', v_avant::text), jsonb_build_object('code', p_code, 'valeur', p_valeur::text, 'aPartirDu', p_a_partir_du));
end $$;

-- Retirer une règle préparée avant sa date (la direction).
create function plateforme.console_retirer_regle_cabinet(p_code text, p_a_partir_du date, p_motif text, p_maintenant timestamptz, p_jour date) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v_role text := plateforme.exiger_role_console(array['direction']); v_r plateforme.regle_cabinet;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('retirer une règle demande son motif (trois caractères au moins)'); end if;
  select * into v_r from plateforme.regle_cabinet r where r.code = p_code and r.a_partir_du = p_a_partir_du and r.a_partir_du > p_jour for update;
  if not found then perform socle.refus('cette règle n''est pas à venir : une règle en vigueur ne se retire pas'); end if;
  delete from plateforme.regle_cabinet where id = v_r.id;
  insert into plateforme.geste_console (qui, role, geste, motif, avant, apres)
    values (socle.moi(), v_role, 'reglages.regle_cabinet_retiree', btrim(p_motif),
            jsonb_build_object('code', v_r.code, 'valeur', v_r.valeur::text, 'aPartirDu', v_r.a_partir_du), null);
end $$;

-- ── 10. Les e-mails d'une facture (0170) : aussi celles des cabinets, aux associés ──────────────────────────────────
create or replace function plateforme.factures_a_annoncer() returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
  with dus as (
    select f.id, f.entreprise, null::uuid cabinet, 'emise'::text nature, p.echeance le
      from plateforme.facture_abonnement f
      join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
     where f.annoncee_le is null and f.payee_le is null
    union all
    select f.id, f.entreprise, null, 'payee', a.paye_jusqu_au
      from plateforme.facture_abonnement f join plateforme.abonnement a on a.entreprise = f.entreprise
     where f.payee_le is not null and f.recu_le is null
    union all
    select f.id, null, f.cabinet, 'emise', p.echeance
      from plateforme.facture_cabinet f
      join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
     where f.annoncee_le is null and f.payee_le is null
    union all
    select f.id, null, f.cabinet, 'payee', a.paye_jusqu_au
      from plateforme.facture_cabinet f join plateforme.abonnement_cabinet a on a.cabinet = f.cabinet
     where f.payee_le is not null and f.recu_le is null
  )
  select coalesce(jsonb_agg(jsonb_build_object('facture', d.id, 'nature', d.nature, 'le', d.le,
           'adresses', case when d.entreprise is not null
             then (select coalesce(jsonb_agg(distinct u.email), '[]'::jsonb) from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
                    where m.entreprise = d.entreprise and m.actif and m.roles && array['proprietaire', 'administrateur']::text[])
             else (select coalesce(jsonb_agg(distinct u.email), '[]'::jsonb) from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
                    where m.organisation = d.cabinet and m.actif and 'supervision' = any(m.roles)) end)
           order by d.id, d.nature), '[]'::jsonb)
    from dus d
   where socle.moi() is null
     and (d.entreprise is null or exists (select 1 from socle.entreprise e where e.id = d.entreprise and e.active))
$$;

create or replace function plateforme.facture_annoncee(p_facture uuid, p_nature text, p_le timestamptz) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is not null then perform socle.refus('seul le serveur note un e-mail de facture parti'); end if;
  if p_nature = 'emise' then
    update plateforme.facture_abonnement set annoncee_le = p_le where id = p_facture and annoncee_le is null;
    update plateforme.facture_cabinet set annoncee_le = p_le where id = p_facture and annoncee_le is null;
  elsif p_nature = 'payee' then
    update plateforme.facture_abonnement set recu_le = p_le, annoncee_le = coalesce(annoncee_le, p_le) where id = p_facture and recu_le is null;
    update plateforme.facture_cabinet set recu_le = p_le, annoncee_le = coalesce(annoncee_le, p_le) where id = p_facture and recu_le is null;
  else
    perform socle.refus('nature inconnue');
  end if;
end $$;

-- ── Les droits ──────────────────────────────────────────────────────────────────────────────────────────────────────
revoke execute on function plateforme.regle_cabinet_du_jour(text, date), plateforme.dossiers_du_cabinet(uuid, date),
  plateforme.reste_piece(uuid, text), plateforme.etat_cabinet(uuid, date), plateforme.periode_cabinet(uuid, date),
  plateforme.calcul_facture_cabinet(uuid, date, date), plateforme.cabinets_a_facturer(uuid, date),
  plateforme.facture_cabinet_pour(uuid, date, date), plateforme.noter_facture_cabinet(uuid, date, date, text, text, bigint, uuid[], uuid[]),
  plateforme.facture_cabinet_refus_noter(uuid, date, boolean, text), plateforme.cabinet_paye_par_facture(uuid, text),
  plateforme.cabinet_exiger_associe(uuid), plateforme.pieces_du_cabinet(uuid), plateforme.mon_abonnement_cabinet(uuid, date),
  plateforme.ma_facture_cabinet_a_payer(uuid, text), plateforme.mon_paiement_cabinet_demander(uuid, text, bigint, text, timestamptz),
  plateforme.dossier_tenu_bloque_depuis(uuid, date), plateforme.console_abonnement_cabinet(uuid, date),
  plateforme.console_factures_cabinet_refusees(), plateforme.console_regles_cabinet(date),
  plateforme.console_preparer_regle_cabinet(text, bigint, date, text, timestamptz, date),
  plateforme.console_retirer_regle_cabinet(text, date, text, timestamptz, date) from public;
-- Les fonctions qui vérifient qui demande (ou qui ne rendent qu'un jour), seules : jamais celles qui lisent sans vérifier.
grant execute on function plateforme.cabinets_a_facturer(uuid, date), plateforme.facture_cabinet_pour(uuid, date, date),
  plateforme.noter_facture_cabinet(uuid, date, date, text, text, bigint, uuid[], uuid[]),
  plateforme.facture_cabinet_refus_noter(uuid, date, boolean, text), plateforme.cabinet_paye_par_facture(uuid, text),
  plateforme.mon_abonnement_cabinet(uuid, date), plateforme.ma_facture_cabinet_a_payer(uuid, text),
  plateforme.mon_paiement_cabinet_demander(uuid, text, bigint, text, timestamptz), plateforme.dossier_tenu_bloque_depuis(uuid, date),
  plateforme.console_abonnement_cabinet(uuid, date), plateforme.console_factures_cabinet_refusees(), plateforme.console_regles_cabinet(date),
  plateforme.console_preparer_regle_cabinet(text, bigint, date, text, timestamptz, date),
  plateforme.console_retirer_regle_cabinet(text, date, text, timestamptz, date) to skanfact_app;
