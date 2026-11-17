-- Les gestes de la console sur l'abonnement d'UN cabinet (1.380.0 ; demandé par Skander le 17/11/2026). Jusqu'ici, tout
-- se réglait pour tous les cabinets à la fois (plateforme.regle_cabinet, 0172). Un cabinet qui commence un essai doit
-- pouvoir recevoir plus de dossiers gratuits sans changer la règle de tout le monde. Ce que la console pose, pour un
-- cabinet, et lui seul :
--   - un nombre de dossiers gratuits à lui (jusqu'à une date, ou sans fin) ;
--   - l'abonnement offert (aucun dossier payant, jusqu'à une date ou jusqu'à ce qu'on le retire) ;
--   - un délai : pas de lecture seule avant une date, pour une facture qui attend ;
--   - un report : aucune nouvelle facture avant une date ;
--   - la suspension : ses dossiers tenus en lecture seule, jusqu'à la reprise ;
--   - un prix par dossier et un plafond annuel à lui.
-- Une facture déjà émise ne bouge jamais : un geste vaut pour la suite. Chaque geste demande son motif et se lit au
-- journal de la console.

-- ── 1. Ce qu'un cabinet a reçu ───────────────────────────────────────────────────────────────────────────────────────
create table plateforme.faveur_cabinet (
  cabinet uuid primary key references socle.organisation(id),
  gratuits bigint check (gratuits between 0 and 9999),
  gratuits_jusqu_au date,
  offert boolean not null default false,
  offert_jusqu_au date,
  delai_jusqu_au date,
  sans_facture_avant date,
  suspendu_le date,
  prix_dossier bigint check (prix_dossier > 0),
  plafond bigint check (plafond > 0),
  maj_le timestamptz not null default now()
);
alter table plateforme.faveur_cabinet enable row level security;
alter table plateforme.faveur_cabinet force row level security;
revoke all on plateforme.faveur_cabinet from public;

alter table plateforme.geste_console add column cabinet uuid references socle.organisation(id);
create index geste_console_cabinet on plateforme.geste_console (cabinet, le desc) where cabinet is not null;

-- La règle qui vaut pour CE cabinet un jour donné : la sienne si la console lui en a posé une (et qu'elle court encore),
-- sinon celle de tout le monde. Interne.
create function plateforme.regle_du_cabinet(p_cabinet uuid, p_code text, p_jour date) returns bigint
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select coalesce(
    (select case p_code
              when 'gratuits' then case when f.gratuits_jusqu_au is null or f.gratuits_jusqu_au >= p_jour then f.gratuits end
              when 'prix_dossier' then f.prix_dossier
              when 'plafond' then f.plafond end
       from plateforme.faveur_cabinet f where f.cabinet = p_cabinet),
    plateforme.regle_cabinet_du_jour(p_code, p_jour))
$$;

-- L'abonnement est-il offert ce jour-là ? Interne.
create function plateforme.cabinet_offert(p_cabinet uuid, p_jour date) returns boolean
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select coalesce((select f.offert and (f.offert_jusqu_au is null or f.offert_jusqu_au >= p_jour)
                     from plateforme.faveur_cabinet f where f.cabinet = p_cabinet), false)
$$;

-- ── 2. Les dossiers, l'état et la facture suivent la règle du cabinet ────────────────────────────────────────────────
create or replace function plateforme.dossiers_du_cabinet(p_cabinet uuid, p_jour date)
returns table (entreprise uuid, nom text, cree date, rang bigint, payant boolean)
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select d.id, d.raison_sociale, d.cree, d.rang,
         not plateforme.cabinet_offert(p_cabinet, p_jour)
         and d.rang > coalesce(plateforme.regle_du_cabinet(p_cabinet, 'gratuits', p_jour), 9223372036854775807)
    from (select e.id, e.raison_sociale, (e.cree_le at time zone e.fuseau)::date cree, row_number() over (order by e.cree_le, e.id) rang
            from socle.entreprise e
           where e.tenue_par = p_cabinet and e.active and not e.exemple
             and not exists (select 1 from cabinet.fiche f where f.cabinet = p_cabinet and f.entreprise = e.id and f.contenu ->> 'archived' = 'true')) d
$$;

-- L'état (0172), avec ce que la console a posé : la suspension d'abord ; l'offert ne ferme jamais rien ; le délai
-- repousse la lecture seule ; le report tait « à facturer ».
create or replace function plateforme.etat_cabinet(p_cabinet uuid, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  v_grace integer := (plateforme.regle_du_jour('grace', p_jour))[1];
  v_dues record;
  v_a plateforme.abonnement_cabinet;
  v_f plateforme.faveur_cabinet;
  v_payants bigint;
  v_ferme date;
begin
  select * into v_f from plateforme.faveur_cabinet f where f.cabinet = p_cabinet;
  if v_f.suspendu_le is not null and v_f.suspendu_le <= p_jour then
    return jsonb_build_object('etat', 'lecture_seule', 'depuis', v_f.suspendu_le, 'raison', 'suspendu');
  end if;
  if plateforme.cabinet_offert(p_cabinet, p_jour) then
    return jsonb_build_object('etat', 'gratuit', 'offert', true, 'offertJusquAu', v_f.offert_jusqu_au);
  end if;
  select min(f.echeance) echeance, count(*) n into v_dues
    from plateforme.facture_cabinet f
   where f.cabinet = p_cabinet and coalesce(plateforme.reste_piece(f.editeur, f.piece_v10), 0) > 0;
  if v_dues.n > 0 then
    v_ferme := case when v_grace is null then null else greatest(v_dues.echeance + v_grace, coalesce(v_f.delai_jusqu_au, v_dues.echeance + v_grace)) end;
    if v_ferme is not null and v_ferme < p_jour then
      return jsonb_build_object('etat', 'lecture_seule', 'depuis', v_ferme + 1, 'echeance', v_dues.echeance);
    end if;
    return jsonb_build_object('etat', 'a_payer', 'echeance', v_dues.echeance,
      'lectureSeuleLe', case when v_ferme is null then null else v_ferme + 1 end,
      'delaiJusquAu', case when v_f.delai_jusqu_au >= p_jour then v_f.delai_jusqu_au end);
  end if;
  select * into v_a from plateforme.abonnement_cabinet a where a.cabinet = p_cabinet;
  if v_a.paye_jusqu_au is not null and v_a.paye_jusqu_au >= p_jour then
    return jsonb_build_object('etat', 'actif', 'jusquAu', v_a.paye_jusqu_au);
  end if;
  select count(*) into v_payants from plateforme.dossiers_du_cabinet(p_cabinet, p_jour) d where d.payant;
  if v_payants > 0 then
    if v_f.sans_facture_avant is not null and v_f.sans_facture_avant > p_jour then
      return jsonb_build_object('etat', 'gratuit', 'reporteAu', v_f.sans_facture_avant);
    end if;
    return jsonb_build_object('etat', 'a_facturer');
  end if;
  return jsonb_build_object('etat', 'gratuit');
end $$;

create or replace function plateforme.calcul_facture_cabinet(p_cabinet uuid, p_debut date, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_a plateforme.abonnement_cabinet;
  v_prix bigint := plateforme.regle_du_cabinet(p_cabinet, 'prix_dossier', p_debut);
  v_plafond bigint := plateforme.regle_du_cabinet(p_cabinet, 'plafond', p_debut);
  v_delai bigint := plateforme.regle_cabinet_du_jour('delai', p_debut);
  v_fin date := (p_debut + interval '1 year')::date - 1;
  v_prev_debut date := (p_debut - interval '1 year')::date;
  v_prev_fin date := p_debut - 1;
  v_prev_prix bigint := plateforme.regle_du_cabinet(p_cabinet, 'prix_dossier', (p_debut - interval '1 year')::date);
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
    'gratuits', plateforme.regle_du_cabinet(p_cabinet, 'gratuits', p_jour),
    'dossiers', v_dossiers, 'rattrapages', v_ratt, 'brutHt', v_brut::text,
    'totalHt', (case when v_plafond is not null and v_brut > v_plafond then v_plafond else v_brut end)::text,
    'plafonne', v_plafond is not null and v_brut > v_plafond);
end $$;

-- Les périodes à facturer (0172). Trois choses de plus :
--   - un cabinet dont des dossiers sont devenus payants sans dossier créé (ses gratuits à lui ont pris fin, l'offert a
--     été retiré) commence son abonnement ce jour-là : sans cela il ne serait jamais facturé ;
--   - un cabinet offert, ou dont la facture est reportée, ne se facture pas ;
--   - une période notée « rien à facturer » se retente dès qu'un dossier payant existe.
create or replace function plateforme.cabinets_a_facturer(p_cabinet uuid, p_jour date) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare v jsonb;
begin
  if socle.moi() is not null then return '[]'::jsonb; end if;
  insert into plateforme.abonnement_cabinet (cabinet, depuis)
    select c.cabinet, p_jour
      from (select distinct e.tenue_par cabinet from socle.entreprise e
             where e.tenue_par is not null and e.active and not e.exemple and (p_cabinet is null or e.tenue_par = p_cabinet)) c
     where not exists (select 1 from plateforme.abonnement_cabinet a where a.cabinet = c.cabinet)
       and exists (select 1 from plateforme.dossiers_du_cabinet(c.cabinet, p_jour) d where d.payant)
  on conflict (cabinet) do nothing;
  select coalesce(jsonb_agg(jsonb_build_object('cabinet', x.cabinet, 'debut', x.debut, 'proprietaire', p.utilisateur) order by x.debut), '[]'::jsonb)
    into v
    from (select a.cabinet, plateforme.periode_cabinet(a.cabinet, p_jour) debut from plateforme.abonnement_cabinet a
           where (p_cabinet is null or a.cabinet = p_cabinet) and a.depuis <= p_jour) x
    join plateforme.editeur d on true
    cross join lateral (select m.utilisateur from socle.membre m where m.entreprise = d.entreprise and m.actif and 'proprietaire' = any(m.roles)
                         order by m.utilisateur limit 1) p
   where not plateforme.cabinet_offert(x.cabinet, p_jour)
     and not exists (select 1 from plateforme.faveur_cabinet f where f.cabinet = x.cabinet and f.sans_facture_avant > p_jour)
     and not exists (select 1 from plateforme.facture_cabinet f where f.cabinet = x.cabinet and f.debut = x.debut)
     and not exists (select 1 from plateforme.facture_cabinet_refus r where r.cabinet = x.cabinet and r.debut = x.debut
                       and ((r.vide and not exists (select 1 from plateforme.dossiers_du_cabinet(x.cabinet, p_jour) dd where dd.payant))
                            or (not r.vide and r.le > now() - interval '1 day')));
  return v;
end $$;

-- Un dossier tenu en lecture seule (0172) : payant quand la facture attend ; TOUS les dossiers tenus quand SkanFact a
-- suspendu le cabinet.
create or replace function plateforme.dossier_tenu_bloque_depuis(p_entreprise uuid, p_jour date) returns date
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select case when s ->> 'etat' = 'lecture_seule' and (d.payant or s ->> 'raison' = 'suspendu') then (s ->> 'depuis')::date end
    from socle.entreprise e
    cross join lateral plateforme.etat_cabinet(e.tenue_par, p_jour) s
    join lateral plateforme.dossiers_du_cabinet(e.tenue_par, p_jour) d on d.entreprise = e.id
   where e.id = p_entreprise and e.tenue_par is not null
$$;
-- La même porte, avec sa raison (« suspendu », ou rien : la facture attend) : le refus ne dit pas « règle ta facture »
-- à un cabinet suspendu.
create function plateforme.dossier_tenu_bloque(p_entreprise uuid, p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select case when s ->> 'etat' = 'lecture_seule' and (d.payant or s ->> 'raison' = 'suspendu')
              then jsonb_build_object('depuis', s ->> 'depuis', 'raison', s ->> 'raison') end
    from socle.entreprise e
    cross join lateral plateforme.etat_cabinet(e.tenue_par, p_jour) s
    join lateral plateforme.dossiers_du_cabinet(e.tenue_par, p_jour) d on d.entreprise = e.id
   where e.id = p_entreprise and e.tenue_par is not null
$$;

-- Créer un dossier tenu (0172) : le refus d'un cabinet suspendu dit la suspension, pas la facture.
create or replace function socle.creer_dossier_tenu(p_cabinet uuid, p_raison_sociale text, p_matricule text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle as $$
declare v_org uuid; v_ent uuid; v_jour date := (now() at time zone 'Africa/Tunis')::date; v_etat jsonb;
begin
  if not socle.suis_associe(p_cabinet) then perform socle.refus('seul un associé du cabinet crée un dossier'); end if;
  -- Le même verrou que la facture : un dossier créé pendant qu'elle se prépare attend qu'elle soit écrite.
  perform pg_advisory_xact_lock(hashtextextended('facture-cabinet:' || p_cabinet, 0));
  v_etat := plateforme.etat_cabinet(p_cabinet, v_jour);
  if v_etat ->> 'etat' = 'lecture_seule' and v_etat ->> 'raison' = 'suspendu' then
    perform socle.refus('SkanFact a suspendu l''abonnement de ton cabinet : écris au support pour créer un dossier tenu de plus. Tes dossiers se lisent et s''exportent toujours');
  end if;
  if v_etat ->> 'etat' = 'lecture_seule' then
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

-- ── 3. Ce que la console a posé, tel qu'il se lit (la console, et l'associé dans « Ton abonnement ») ─────────────────
-- Seulement ce qui court encore : une faveur passée ne se lit plus. Interne.
create function plateforme.faveur_du_cabinet(p_cabinet uuid, p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, plateforme as $$
  select coalesce((select jsonb_strip_nulls(jsonb_build_object(
      'gratuits', case when f.gratuits_jusqu_au is null or f.gratuits_jusqu_au >= p_jour then f.gratuits end,
      'gratuitsJusquAu', case when f.gratuits is not null and f.gratuits_jusqu_au >= p_jour then f.gratuits_jusqu_au end,
      'offert', case when plateforme.cabinet_offert(p_cabinet, p_jour) then true end,
      'offertJusquAu', case when plateforme.cabinet_offert(p_cabinet, p_jour) then f.offert_jusqu_au end,
      'delaiJusquAu', case when f.delai_jusqu_au >= p_jour then f.delai_jusqu_au end,
      'sansFactureAvant', case when f.sans_facture_avant > p_jour then f.sans_facture_avant end,
      'suspenduLe', f.suspendu_le,
      'prixHt', f.prix_dossier::text, 'plafondHt', f.plafond::text))
    from plateforme.faveur_cabinet f where f.cabinet = p_cabinet), '{}'::jsonb)
$$;

create or replace function plateforme.mon_abonnement_cabinet(p_cabinet uuid, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  v_a plateforme.abonnement_cabinet;
  v_prochain date;
  v_pieces jsonb;
  v_f plateforme.facture_cabinet;
  v_tenus bigint;
  v_gratuits bigint := plateforme.regle_du_cabinet(p_cabinet, 'gratuits', p_jour);
  v_offert boolean := plateforme.cabinet_offert(p_cabinet, p_jour);
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
    'regles', jsonb_build_object('prixHt', plateforme.regle_du_cabinet(p_cabinet, 'prix_dossier', p_jour)::text, 'gratuits', v_gratuits,
                'plafondHt', plateforme.regle_du_cabinet(p_cabinet, 'plafond', p_jour)::text, 'delai', plateforme.regle_cabinet_du_jour('delai', p_jour),
                'grace', (plateforme.regle_du_jour('grace', p_jour))[1]),
    'faveur', plateforme.faveur_du_cabinet(p_cabinet, p_jour),
    'dossiers', (select coalesce(jsonb_agg(jsonb_build_object('id', d.entreprise, 'nom', d.nom, 'payant', d.payant) order by d.rang), '[]'::jsonb)
                   from plateforme.dossiers_du_cabinet(p_cabinet, p_jour) d),
    'abonnes', (select count(distinct m.entreprise) from socle.mandat m join socle.entreprise e on e.id = m.entreprise
                 where m.cabinet = p_cabinet and m.statut = 'actif' and e.tenue_par is null and e.active),
    'prochaine', case when v_prochain is null then null else plateforme.calcul_facture_cabinet(p_cabinet, v_prochain, p_jour) end,
    'prochainDossier', jsonb_build_object('rang', v_tenus + 1, 'payant', not v_offert and v_gratuits is not null and v_tenus + 1 > v_gratuits,
                         'prixHt', plateforme.regle_du_cabinet(p_cabinet, 'prix_dossier', p_jour)::text, 'abonne', v_a.cabinet is not null),
    'factures', case when jsonb_array_length(v_pieces) = 0 then null else jsonb_build_object(
      'entreprise', (select d.contenu from socle.dossier_v10 d where d.entreprise = v_f.editeur and d.collection = '_racine' and d.cle = 'company'),
      'client', (select d.contenu from socle.dossier_v10 d where d.entreprise = v_f.editeur and d.collection = 'clients' and d.cle = v_f.client_v10),
      'pieces', v_pieces) end,
    'paiement', exists (select 1 from plateforme.editeur e join ventes.prestataire pr on pr.entreprise = e.entreprise));
end $$;

-- La fiche de la console (0172), avec ce qui a été posé, la règle de tout le monde, les gestes que SON rôle peut faire
-- maintenant, et les derniers gestes (qui, quand, pourquoi).
create or replace function plateforme.console_abonnement_cabinet(p_cabinet uuid, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  v_a plateforme.abonnement_cabinet; v_periode date;
  v_role text := plateforme.exiger_role_console(array['direction', 'support']);
  v_f plateforme.faveur_cabinet;
  v_etat jsonb := plateforme.etat_cabinet(p_cabinet, p_jour);
  v_offert boolean := plateforme.cabinet_offert(p_cabinet, p_jour);
  v_gestes text[] := '{}';
begin
  select * into v_a from plateforme.abonnement_cabinet a where a.cabinet = p_cabinet;
  select * into v_f from plateforme.faveur_cabinet f where f.cabinet = p_cabinet;
  v_periode := plateforme.periode_cabinet(p_cabinet, p_jour);
  if v_role = 'direction' then
    v_gestes := array['gratuits'];
    if v_f.gratuits is not null then v_gestes := v_gestes || 'gratuits-retirer'::text; end if;
    v_gestes := v_gestes || (case when v_offert then 'retirer-offert' else 'offrir' end);
    if v_etat ->> 'etat' in ('a_payer', 'lecture_seule') and v_etat ->> 'raison' is null then v_gestes := v_gestes || 'delai'::text; end if;
    if not v_offert then v_gestes := v_gestes || 'reporter'::text; end if;
    if v_f.sans_facture_avant > p_jour then v_gestes := v_gestes || 'reporter-retirer'::text; end if;
    v_gestes := v_gestes || (case when v_f.suspendu_le is not null then 'reprendre' else 'suspendre' end);
    v_gestes := v_gestes || 'prix'::text;
    if v_f.prix_dossier is not null then v_gestes := v_gestes || 'prix-retirer'::text; end if;
    v_gestes := v_gestes || 'plafond'::text;
    if v_f.plafond is not null then v_gestes := v_gestes || 'plafond-retirer'::text; end if;
  end if;
  return jsonb_build_object(
    'etat', v_etat, 'depuis', v_a.depuis, 'payeJusquAu', v_a.paye_jusqu_au,
    'tenus', (select count(*) from plateforme.dossiers_du_cabinet(p_cabinet, p_jour)),
    'payants', (select count(*) from plateforme.dossiers_du_cabinet(p_cabinet, p_jour) d where d.payant),
    'faveur', plateforme.faveur_du_cabinet(p_cabinet, p_jour),
    'regles', jsonb_build_object('gratuits', plateforme.regle_du_cabinet(p_cabinet, 'gratuits', p_jour),
                'prixHt', plateforme.regle_du_cabinet(p_cabinet, 'prix_dossier', p_jour)::text,
                'plafondHt', plateforme.regle_du_cabinet(p_cabinet, 'plafond', p_jour)::text,
                'gratuitsDeTous', plateforme.regle_cabinet_du_jour('gratuits', p_jour),
                'prixDeTousHt', plateforme.regle_cabinet_du_jour('prix_dossier', p_jour)::text,
                'plafondDeTousHt', plateforme.regle_cabinet_du_jour('plafond', p_jour)::text),
    'gestes', to_jsonb(v_gestes),
    'histoire', (select coalesce(jsonb_agg(jsonb_build_object('le', g.le, 'geste', g.geste, 'motif', g.motif, 'apres', g.apres,
                   'qui', (select u.nom from socle.utilisateur u where u.id = g.qui)) order by g.le desc, g.id desc), '[]'::jsonb)
                   from (select * from plateforme.geste_console g where g.cabinet = p_cabinet order by g.le desc, g.id desc limit 20) g),
    'prochaine', case when v_periode is null then null else plateforme.calcul_facture_cabinet(p_cabinet, (v_periode + interval '1 year')::date, p_jour) end,
    'factures', (select coalesce(jsonb_agg(jsonb_build_object('debut', f.debut, 'fin', f.fin, 'echeance', f.echeance, 'montantHt', f.montant_ht::text,
                   'numero', p.numero_texte, 'net', p.net_a_payer::text, 'reste', plateforme.reste_piece(f.editeur, f.piece_v10)::text,
                   'payeeLe', f.payee_le, 'dossiers', cardinality(f.dossiers), 'rattrapes', cardinality(f.rattrapes)) order by f.debut desc), '[]'::jsonb)
                   from plateforme.facture_cabinet f
                   left join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
                  where f.cabinet = p_cabinet),
    'refus', (select r.motif from plateforme.facture_cabinet_refus r where r.cabinet = p_cabinet and r.debut = v_periode and not r.vide));
end $$;

-- ── 4. Le geste (la direction) ───────────────────────────────────────────────────────────────────────────────────────
-- Un geste à la fois, avec son motif. `p_valeur` : un nombre de dossiers, ou un montant en millimes ; `p_jusqu_au` : la
-- date de fin d'une faveur (facultative pour les gratuits et l'offert, obligatoire pour le délai et le report).
create function plateforme.console_geste_cabinet(p_cabinet uuid, p_geste text, p_valeur bigint, p_jusqu_au date, p_motif text,
                                                 p_maintenant timestamptz, p_jour date) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_avant jsonb;
  v_f plateforme.faveur_cabinet;
  v_etat jsonb;
begin
  if not exists (select 1 from socle.organisation o where o.id = p_cabinet and o.type = 'cabinet') then perform socle.refus('ce cabinet n''existe pas'); end if;
  if length(btrim(coalesce(p_motif, ''))) < 3 then perform socle.refus('un geste sur l''abonnement d''un cabinet demande son motif (trois caractères au moins)'); end if;
  perform pg_advisory_xact_lock(hashtextextended('facture-cabinet:' || p_cabinet, 0));
  insert into plateforme.faveur_cabinet (cabinet) values (p_cabinet) on conflict (cabinet) do nothing;
  select * into v_f from plateforme.faveur_cabinet f where f.cabinet = p_cabinet for update;
  v_avant := plateforme.faveur_du_cabinet(p_cabinet, p_jour);
  v_etat := plateforme.etat_cabinet(p_cabinet, p_jour);
  if p_jusqu_au is not null and p_jusqu_au <= p_jour then perform socle.refus('la date de fin est passée : choisis un jour à venir'); end if;
  if p_jusqu_au is not null and p_jusqu_au > p_jour + 1830 then perform socle.refus('la date de fin est trop loin : cinq ans au plus (sans date, la faveur n''a pas de fin)'); end if;

  if p_geste = 'gratuits' then
    if p_valeur is null or p_valeur < 0 or p_valeur > 9999 then perform socle.refus('le nombre de dossiers gratuits est un nombre entier, de 0 à 9999'); end if;
    if v_f.gratuits = p_valeur and v_f.gratuits_jusqu_au is not distinct from p_jusqu_au then perform socle.refus('c''est déjà ce que ce cabinet a : rien ne changerait'); end if;
    update plateforme.faveur_cabinet set gratuits = p_valeur, gratuits_jusqu_au = p_jusqu_au, maj_le = p_maintenant where cabinet = p_cabinet;
  elsif p_geste = 'gratuits-retirer' then
    if v_f.gratuits is null then perform socle.refus('ce cabinet suit déjà la règle de tout le monde'); end if;
    update plateforme.faveur_cabinet set gratuits = null, gratuits_jusqu_au = null, maj_le = p_maintenant where cabinet = p_cabinet;
  elsif p_geste = 'offrir' then
    if plateforme.cabinet_offert(p_cabinet, p_jour) and v_f.offert_jusqu_au is not distinct from p_jusqu_au then perform socle.refus('l''abonnement de ce cabinet est déjà offert'); end if;
    update plateforme.faveur_cabinet set offert = true, offert_jusqu_au = p_jusqu_au, maj_le = p_maintenant where cabinet = p_cabinet;
  elsif p_geste = 'retirer-offert' then
    if not plateforme.cabinet_offert(p_cabinet, p_jour) then perform socle.refus('l''abonnement de ce cabinet n''est pas offert'); end if;
    update plateforme.faveur_cabinet set offert = false, offert_jusqu_au = null, maj_le = p_maintenant where cabinet = p_cabinet;
  elsif p_geste = 'delai' then
    if p_jusqu_au is null then perform socle.refus('un délai demande sa date : jusqu''à quand ce cabinet peut-il régler ?'); end if;
    if not (v_etat ->> 'etat' in ('a_payer', 'lecture_seule')) or v_etat ->> 'raison' is not null then
      perform socle.refus('aucune facture de ce cabinet n''attend son paiement : il n''y a rien à repousser');
    end if;
    if p_jusqu_au > p_jour + 366 then perform socle.refus('un délai dure un an au plus'); end if;
    update plateforme.faveur_cabinet set delai_jusqu_au = p_jusqu_au, maj_le = p_maintenant where cabinet = p_cabinet;
  elsif p_geste = 'reporter' then
    if p_jusqu_au is null then perform socle.refus('un report demande sa date : à partir de quand la prochaine facture peut-elle partir ?'); end if;
    if p_jusqu_au > p_jour + 366 then perform socle.refus('un report dure un an au plus'); end if;
    update plateforme.faveur_cabinet set sans_facture_avant = p_jusqu_au, maj_le = p_maintenant where cabinet = p_cabinet;
  elsif p_geste = 'reporter-retirer' then
    if v_f.sans_facture_avant is null or v_f.sans_facture_avant <= p_jour then perform socle.refus('aucune facture de ce cabinet n''est reportée'); end if;
    update plateforme.faveur_cabinet set sans_facture_avant = null, maj_le = p_maintenant where cabinet = p_cabinet;
  elsif p_geste = 'suspendre' then
    if v_f.suspendu_le is not null then perform socle.refus('ce cabinet est déjà suspendu'); end if;
    update plateforme.faveur_cabinet set suspendu_le = p_jour, maj_le = p_maintenant where cabinet = p_cabinet;
  elsif p_geste = 'reprendre' then
    if v_f.suspendu_le is null then perform socle.refus('ce cabinet n''est pas suspendu'); end if;
    update plateforme.faveur_cabinet set suspendu_le = null, maj_le = p_maintenant where cabinet = p_cabinet;
  elsif p_geste in ('prix', 'plafond') then
    if p_valeur is null or p_valeur <= 0 then perform socle.refus('un prix est un montant hors taxes plus grand que zéro'); end if;
    if p_geste = 'prix' then
      if v_f.prix_dossier = p_valeur then perform socle.refus('c''est déjà le prix de ce cabinet : rien ne changerait'); end if;
      update plateforme.faveur_cabinet set prix_dossier = p_valeur, maj_le = p_maintenant where cabinet = p_cabinet;
    else
      if v_f.plafond = p_valeur then perform socle.refus('c''est déjà le plafond de ce cabinet : rien ne changerait'); end if;
      update plateforme.faveur_cabinet set plafond = p_valeur, maj_le = p_maintenant where cabinet = p_cabinet;
    end if;
  elsif p_geste = 'prix-retirer' then
    if v_f.prix_dossier is null then perform socle.refus('ce cabinet paie déjà le prix de tout le monde'); end if;
    update plateforme.faveur_cabinet set prix_dossier = null, maj_le = p_maintenant where cabinet = p_cabinet;
  elsif p_geste = 'plafond-retirer' then
    if v_f.plafond is null then perform socle.refus('ce cabinet a déjà le plafond de tout le monde'); end if;
    update plateforme.faveur_cabinet set plafond = null, maj_le = p_maintenant where cabinet = p_cabinet;
  else
    perform socle.refus('ce geste n''existe pas pour un cabinet');
  end if;

  insert into plateforme.geste_console (le, qui, role, geste, cabinet, motif, avant, apres)
    values (p_maintenant, socle.moi(), v_role, 'abonnement.cabinet-' || p_geste, p_cabinet, btrim(p_motif), v_avant,
            plateforme.faveur_du_cabinet(p_cabinet, p_jour)
              || jsonb_strip_nulls(jsonb_build_object('valeur', p_valeur::text, 'jusquAu', p_jusqu_au)));
  return plateforme.etat_cabinet(p_cabinet, p_jour);
end $$;

-- ── Les droits ───────────────────────────────────────────────────────────────────────────────────────────────────────
revoke execute on function plateforme.regle_du_cabinet(uuid, text, date), plateforme.cabinet_offert(uuid, date),
  plateforme.faveur_du_cabinet(uuid, date), plateforme.dossier_tenu_bloque(uuid, date),
  plateforme.console_geste_cabinet(uuid, text, bigint, date, text, timestamptz, date) from public;
grant execute on function plateforme.dossier_tenu_bloque(uuid, date),
  plateforme.console_geste_cabinet(uuid, text, bigint, date, text, timestamptz, date) to skanfact_app;
