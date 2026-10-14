-- L'argent juste (docs/console.md C37 ; l'audit du 14/10/2026 ; décidé par délégation le 14/10/2026 — Skander : « décide à
-- ma place ce qui est le mieux d'après notre projet » —, sauf le support qui offre un mois, que Skander a dit lui-même) :
--
--   1. Offrir un mois : SUR LA PROCHAINE FACTURE (skanfact docs/cadrage/10-console.md § 2.4) — la facture de la période
--      suivante couvre un mois de plus, au même prix, et le dit. Rien ne s'allonge avant elle : un mois offert n'est jamais
--      une gratuité sans fin, et il laisse sa trace sur une pièce. Un seul mois attend à la fois. Le support l'offre aussi
--      (Skander, 14/10/2026), une fois par entreprise sur douze mois ; au-delà, la direction.
--   2. Un paiement reçu hors de la plateforme (une facture faite ailleurs) dit sa facture, le montant reçu, son moyen et
--      son jour : sans eux, rien n'est payé. Paiements le compte avec le reste.
--   3. Un module acheté s'ouvre tout de suite ; la facture suivante rattrape, au prorata, les jours de la période payée qui
--      court (la règle fiscale du rattrapage : À VÉRIFIER avec le comptable). Un module retiré reste ouvert jusqu'au
--      renouvellement : rien n'est perdu, rien n'est à rembourser. Le renouvellement payé applique aussi l'offre changée
--      (0111), que rien n'appliquait.
--   4. Le renouvellement de chaque entreprise, en un passage, par la règle de la facture (la liste, les échéances, la
--      fiche disent le même chiffre qu'elle) ; les factures payées puis défaites (un règlement retiré, un avoir), que
--      « À décider » montre.

alter table plateforme.abonnement
  add column mois_offerts integer not null default 0 check (mois_offerts between 0 and 1),
  add column modules_a_retirer text[] not null default '{}',
  add constraint abonnement_modules_a_retirer check (modules_a_retirer <@ modules);
alter table plateforme.facture_abonnement add column mois_offert boolean not null default false;

-- La ligne telle que la console la lit, la renvoie, et que la base compare avant d'écrire (01 R15).
create or replace function plateforme.ligne_abonnement(a plateforme.abonnement) returns jsonb
language sql immutable set search_path = pg_catalog, plateforme as $$
  select case when a.entreprise is null then null else jsonb_build_object(
    'essai_jusqu_au', a.essai_jusqu_au, 'paye_jusqu_au', a.paye_jusqu_au, 'offre', a.offre, 'periodicite', a.periodicite,
    'resilie_le', a.resilie_le, 'suspendu_le', a.suspendu_le, 'offert', a.offert, 'modules', to_jsonb(a.modules),
    'delai_echeance', a.delai_echeance, 'delai_jusqu_au', a.delai_jusqu_au,
    'suivante_offre', a.suivante_offre, 'suivante_periodicite', a.suivante_periodicite, 'suivante_a_partir_du', a.suivante_a_partir_du,
    'mois_offerts', a.mois_offerts, 'modules_a_retirer', to_jsonb(a.modules_a_retirer)) end
$$;

-- Ce que les faits portent de plus (la porte, la fiche, les listes) : le délai, l'offre de la prochaine échéance, le mois
-- offert qui attend sa facture, les modules qui partent au renouvellement.
create or replace function plateforme.faits_en_plus(a plateforme.abonnement) returns jsonb
language sql immutable set search_path = pg_catalog, plateforme as $$
  select jsonb_build_object(
    'delai', case when a.delai_jusqu_au is null then null else jsonb_build_object('echeance', a.delai_echeance, 'jusquAu', a.delai_jusqu_au) end,
    'offreSuivante', case when a.suivante_offre is null then null
                          else jsonb_build_object('offre', a.suivante_offre, 'periodicite', a.suivante_periodicite, 'aPartirDu', a.suivante_a_partir_du) end,
    'moisOffert', coalesce(a.mois_offerts, 0) > 0,
    'modulesARetirer', coalesce(to_jsonb(a.modules_a_retirer), '[]'::jsonb))
$$;

create or replace function plateforme.console_faits_en_plus() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_object_agg(a.entreprise, plateforme.faits_en_plus(a)), '{}'::jsonb) from plateforme.abonnement a
           where a.delai_jusqu_au is not null or a.suivante_offre is not null or a.mois_offerts > 0 or cardinality(a.modules_a_retirer) > 0);
end $$;

-- ── 1. et 2. Le geste de la console ──────────────────────────────────────────────────────────────────────────────────
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
    when 'ouvrir-module' then 'module_ouvert' when 'fermer-module' then 'module_ferme'
    when 'accorder-delai' then 'delai_accorde' when 'offrir-mois' then 'mois_offert' when 'changer-offre' then 'offre_changee' end;
  if v_nature is null then perform socle.refus('ce geste n''existe pas dans la console'); end if;
  if v_role = 'support' and p_geste not in ('prolonger', 'offrir-mois') then
    perform socle.refus('ton rôle dans l''équipe SkanFact ne permet pas ce geste');
  end if;
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

  if v_role = 'support' and p_geste = 'prolonger' then
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

  -- 1. Un mois offert attend sa facture : un seul à la fois. Le support ne pose que lui, une fois par entreprise sur douze
  -- mois (Skander, 14/10/2026) ; au-delà, la direction.
  if p_geste = 'offrir-mois' then
    if v_avant is null or coalesce((v_avant->>'mois_offerts')::int, 0) <> 0 then
      perform socle.refus('un mois offert attend déjà la prochaine facture : un seul à la fois');
    end if;
    if (p_apres->>'mois_offerts')::int is distinct from 1 or (p_apres - 'mois_offerts') is distinct from (v_avant - 'mois_offerts') then
      perform socle.refus('un mois offert se pose sur la prochaine facture, et rien d''autre ne change');
    end if;
    if v_role = 'support' and exists (select 1 from plateforme.evenement_abonnement v where v.entreprise = p_entreprise and v.nature = 'mois_offert'
                                        and v.le > (p_jour - 365)::timestamptz) then
      perform socle.refus('un mois a déjà été offert à cette entreprise ces douze derniers mois : un autre se demande à la direction');
    end if;
  end if;

  -- 2. Un paiement reçu hors de la plateforme : la facture faite ailleurs, le montant reçu (en millimes), son moyen et son
  -- jour. Sans eux, rien n'est payé.
  if p_geste = 'payer' then
    if length(btrim(coalesce(p_details->>'facture', ''))) not between 1 and 40
       or coalesce(p_details->>'montant', '') !~ '^[1-9][0-9]{0,15}$'
       or coalesce(p_details->>'moyen', '') not in ('virement', 'cheque', 'especes')
       or coalesce(p_details->>'le', '') !~ '^\d{4}-\d{2}-\d{2}$' or (p_details->>'le')::date > p_jour then
      perform socle.refus('un paiement reçu dit sa facture, le montant reçu, son moyen (virement, chèque, espèces) et son jour : sans eux, rien n''est payé');
    end if;
    -- L'argent reçu est celui de l'entreprise SkanFact du jour : Paiements le compte dans SON encaissé.
    p_details := p_details || jsonb_build_object('editeur', (select d.entreprise from plateforme.editeur d));
  end if;

  if v_avant is null then
    insert into plateforme.abonnement (entreprise, essai_jusqu_au) values (p_entreprise, (p_apres->>'essai_jusqu_au')::date);
  end if;
  update plateforme.abonnement set essai_jusqu_au = (p_apres->>'essai_jusqu_au')::date, paye_jusqu_au = (p_apres->>'paye_jusqu_au')::date,
      offre = p_apres->>'offre', periodicite = p_apres->>'periodicite', resilie_le = (p_apres->>'resilie_le')::date,
      suspendu_le = (p_apres->>'suspendu_le')::date, offert = coalesce((p_apres->>'offert')::boolean, false),
      modules = case when jsonb_typeof(p_apres->'modules') = 'array'
                     then array(select distinct m from jsonb_array_elements_text(p_apres->'modules') m order by m) else modules end,
      -- Le délai et l'offre de la prochaine échéance (0111), le mois offert et les modules qui partent (0113) : une ligne
      -- envoyée sans eux (un écran d'avant) les garde.
      delai_echeance = case when p_apres ? 'delai_echeance' then (p_apres->>'delai_echeance')::date else delai_echeance end,
      delai_jusqu_au = case when p_apres ? 'delai_jusqu_au' then (p_apres->>'delai_jusqu_au')::date else delai_jusqu_au end,
      suivante_offre = case when p_apres ? 'suivante_offre' then p_apres->>'suivante_offre' else suivante_offre end,
      suivante_periodicite = case when p_apres ? 'suivante_periodicite' then p_apres->>'suivante_periodicite' else suivante_periodicite end,
      suivante_a_partir_du = case when p_apres ? 'suivante_a_partir_du' then (p_apres->>'suivante_a_partir_du')::date else suivante_a_partir_du end,
      mois_offerts = case when p_apres ? 'mois_offerts' then (p_apres->>'mois_offerts')::int else mois_offerts end,
      modules_a_retirer = case when jsonb_typeof(p_apres->'modules_a_retirer') = 'array'
                     then array(select distinct m from jsonb_array_elements_text(p_apres->'modules_a_retirer') m order by m) else modules_a_retirer end,
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

-- ── 3. Ce qui s'ajoute à l'offre sur la facture : les modules qui restent, et le rattrapage d'un module ouvert en cours ─
-- Le rattrapage : un module acheté pendant la période payée qui court (après que sa facture s'est préparée, ou que son
-- paiement s'est noté), que son offre ne comprenait pas, se facture sur la facture suivante pour les jours de cette
-- période où il a servi — son prix de la période, au prorata des jours, au millime le plus proche. Une fois : la période
-- suivante payée, il n'est plus « en cours ». Un retrait prévu annulé (« ouvrir » un module qui allait partir) n'est pas
-- une ouverture.
create function plateforme.rattrapage_modules(a plateforme.abonnement, p_prix_au date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_fuseau text;
  v_debut date;
  v_paye_le timestamptz;
  v_depuis timestamptz;
  v_fin date := a.paye_jusqu_au;
  v_contenu jsonb;
  v_lignes jsonb := '[]'::jsonb;
  v_m record;
  v_prix bigint;
  v_jours integer;
  v_sur integer;
begin
  if a.entreprise is null or v_fin is null or a.offre is null or a.periodicite is null or p_prix_au <= v_fin then return v_lignes; end if;
  select coalesce(e.fuseau, 'Africa/Tunis') into v_fuseau from socle.entreprise e where e.id = a.entreprise;
  -- Le premier jour de la période payée qui finit à « payé jusqu'au » : celui du paiement qui l'a payée.
  select (v.apres->>'debut')::date, v.le into v_debut, v_paye_le from plateforme.evenement_abonnement v
   where v.entreprise = a.entreprise and v.nature = 'paye' and v.apres->>'fin' = v_fin::text and v.apres->>'debut' ~ '^\d{4}-\d{2}-\d{2}$'
   order by v.le desc limit 1;
  if v_debut is null then return v_lignes; end if;
  -- Ce que la période a payé s'est arrêté à l'instant où sa facture s'est préparée (ou, sans facture de la plateforme, où
  -- le paiement s'est noté) : un module ouvert après n'y était pas — même le premier jour de la période ; ouvert avant,
  -- il y était, et ne se facture pas deux fois.
  v_depuis := coalesce((select f.prepare_le from plateforme.facture_abonnement f where f.entreprise = a.entreprise and f.debut = v_debut), v_paye_le);
  v_contenu := plateforme.contenu_du_jour(a.offre, v_debut);
  for v_m in
    select v.apres->>'module' module, min((v.le at time zone v_fuseau)::date) ouvert_le
      from plateforme.evenement_abonnement v
     where v.entreprise = a.entreprise and v.nature = 'module_ouvert' and v.apres->>'module' = any(a.modules)
       and coalesce(v.apres->>'annuleRetrait', 'false') <> 'true'
       and v.le > v_depuis and (v.le at time zone v_fuseau)::date <= v_fin
     group by v.apres->>'module' order by 1
  loop
    continue when coalesce((v_contenu->>v_m.module)::int, 0) <> 0;
    v_prix := plateforme.prix_de('module_' || v_m.module, a.periodicite, v_debut);
    continue when v_prix is null;
    v_jours := v_fin - greatest(v_m.ouvert_le, v_debut) + 1;
    v_sur := v_fin - v_debut + 1;
    v_lignes := v_lignes || jsonb_build_object('option', 'rattrapage_' || v_m.module, 'quantite', 1, 'compte', v_jours, 'inclus', v_sur,
      'prixHt', ((v_prix * v_jours * 2 + v_sur) / (2 * v_sur))::text, 'du', greatest(v_m.ouvert_le, v_debut), 'au', v_fin);
  end loop;
  return v_lignes;
end $$;

create or replace function plateforme.lignes_en_plus(p_entreprise uuid, p_offre text, p_periodicite text, p_jour date, p_prix_au date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, caisse, plateforme as $$
declare
  v_a plateforme.abonnement;
  -- Les modules de la période facturée : ceux qui restent (un module retiré part au renouvellement, 0113).
  v_modules text[];
  v_comptes jsonb := plateforme.comptes_de_l_entreprise(p_entreprise, p_jour);
  v_contenu jsonb := plateforme.contenu_du_jour(p_offre, p_prix_au);
  v_inclus jsonb;
  v_lignes jsonb := '[]'::jsonb;
  v_c record;
  v_prix bigint;
begin
  select * into v_a from plateforme.abonnement a where a.entreprise = p_entreprise;
  v_modules := array(select m from unnest(coalesce(v_a.modules, '{}')) m where not (m = any(coalesce(v_a.modules_a_retirer, '{}'))) order by m);
  v_inclus := plateforme.inclus_de_l_offre(p_offre, v_modules, p_prix_au);
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
  if v_a.entreprise is not null then v_lignes := v_lignes || plateforme.rattrapage_modules(v_a, p_prix_au); end if;
  return v_lignes;
end $$;

-- ── 1. et 3. Noter la facture préparée : sa période (un mois de plus quand elle porte le mois offert), ses lignes ─────
drop function plateforme.console_noter_facture(uuid, text, text, text, text, date, date, bigint, text, date);
create function plateforme.console_noter_facture(p_entreprise uuid, p_piece_v10 text, p_client_v10 text, p_offre text, p_periodicite text,
                                                 p_debut date, p_fin date, p_montant_ht bigint, p_motif text, p_jour date,
                                                 p_mois_offert boolean) returns uuid
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
  v_deja boolean;
  v_a plateforme.abonnement;
  v_fin date;
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
  v_deja := found;
  if v_deja and (v_f.entreprise <> p_entreprise or v_f.payee_le is not null) then
    perform socle.refus('cette facture est déjà payée : elle ne se refait pas');
  end if;
  -- Le mois offert : il attend sur l'abonnement, ou cette facture le portait déjà (préparée de nouveau). Il va sur la
  -- PROCHAINE facture : on n'en prépare pas une sans lui, et une facture qui le porte le garde.
  select * into v_a from plateforme.abonnement a where a.entreprise = p_entreprise for update;
  if p_mois_offert and not ((v_deja and v_f.mois_offert) or coalesce(v_a.mois_offerts, 0) = 1) then
    perform socle.refus('aucun mois offert n''attend cette facture : relis la fiche avant de la préparer');
  end if;
  if not p_mois_offert and ((v_deja and v_f.mois_offert) or coalesce(v_a.mois_offerts, 0) = 1) then
    perform socle.refus('un mois offert attend cette facture : elle le porte');
  end if;
  -- Sa période : un an ou un mois à partir de son premier jour, un mois de plus avec le mois offert (le même calcul que le
  -- serveur : les mois de calendrier, la fin d'un mois court gardée).
  v_fin := (p_debut + make_interval(months => case p_periodicite when 'annuel' then 12 else 1 end + case when p_mois_offert then 1 else 0 end))::date - 1;
  if p_fin <> v_fin then
    perform socle.refus('la période de la facture n''est pas la bonne : relis-la avant de la préparer');
  end if;
  insert into plateforme.facture_abonnement (entreprise, editeur, piece_v10, client_v10, offre, periodicite, debut, fin, montant_ht, prepare_par,
                                            remise_nature, remise_taux, remise_ht, mois_offert)
    values (p_entreprise, v_editeur, p_piece_v10, p_client_v10, p_offre, p_periodicite, p_debut, p_fin, p_montant_ht, socle.moi(),
            case when v_taux > 0 then v_remise->>'nature' end, v_taux, v_remise_ht, p_mois_offert)
    on conflict (editeur, piece_v10) do update set client_v10 = excluded.client_v10, offre = excluded.offre, periodicite = excluded.periodicite,
      debut = excluded.debut, fin = excluded.fin, montant_ht = excluded.montant_ht, prepare_le = now(), prepare_par = excluded.prepare_par,
      remise_nature = excluded.remise_nature, remise_taux = excluded.remise_taux, remise_ht = excluded.remise_ht, mois_offert = excluded.mois_offert;
  -- Le mois offert passe de l'abonnement à sa facture.
  if p_mois_offert and coalesce(v_a.mois_offerts, 0) = 1 then
    update plateforme.abonnement set mois_offerts = 0, modifie_le = now() where entreprise = p_entreprise;
  end if;
  insert into plateforme.geste_console (qui, role, geste, entreprise, motif, avant, apres)
    values (socle.moi(), v_role, 'factures.preparer', p_entreprise, btrim(p_motif), null,
            jsonb_build_object('offre', p_offre, 'periodicite', p_periodicite, 'factureDu', p_debut, 'factureAu', p_fin,
              'montantHt', (p_montant_ht::numeric / 1000)::numeric(16, 3)::text,
              'enPlus', (select coalesce(jsonb_agg(jsonb_build_object('option', l->>'option', 'quantite', (l->>'quantite')::int)), '[]'::jsonb)
                           from jsonb_array_elements(v_lignes) l))
            || case when v_taux > 0 then jsonb_build_object('remise', jsonb_build_object('nature', v_remise->>'nature', 'taux', v_taux,
                 'montantHt', (v_remise_ht::numeric / 1000)::numeric(16, 3)::text)) else '{}'::jsonb end
            || case when p_mois_offert then jsonb_build_object('moisOffert', true) else '{}'::jsonb end)
    returning id into v_geste;
  return v_geste;
end $$;

-- ── 3. Payée, la facture paie l'abonnement — et le renouvellement applique ce qui l'attendait ────────────────────────
-- Les modules retirés partent ; l'offre changée (0111) est celle de la facture, et ne se redit plus.
create or replace function plateforme.abonnement_paye_par_facture(p_editeur uuid, p_piece_v10 text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  v_f plateforme.facture_abonnement;
  v_p ventes.piece;
  v_avoirs bigint;
  v_reglements bigint;
  v_ligne plateforme.abonnement;
  v_avant jsonb;
  v_evenement uuid;
begin
  select * into v_f from plateforme.facture_abonnement f where f.editeur = p_editeur and f.piece_v10 = p_piece_v10 for update;
  if not found or v_f.payee_le is not null then return null; end if;
  select * into v_p from ventes.piece p where p.entreprise = p_editeur and p.ref_v10 = p_piece_v10 and p.type = 'facture' and p.statut = 'emise';
  if not found then return null; end if;
  select coalesce(sum(a.net_a_payer), 0) into v_avoirs from ventes.piece a where a.entreprise = v_p.entreprise and a.corrige = v_p.id and a.statut = 'emise';
  select coalesce(sum(r.montant), 0) into v_reglements from ventes.reglement r where r.entreprise = v_p.entreprise and r.piece = v_p.id;
  -- Une facture que ses avoirs couvrent est annulée, pas payée ; une facture qui doit encore attend.
  if v_p.net_a_payer <= 0 or v_avoirs >= v_p.net_a_payer or v_p.net_a_payer - v_avoirs - v_reglements > 0 then return null; end if;
  update plateforme.facture_abonnement set payee_le = now() where id = v_f.id;
  select * into v_ligne from plateforme.abonnement a where a.entreprise = v_f.entreprise for update;
  -- Sans abonnement (une restauration dans une autre base), ou déjà couvert au-delà : rien ne bouge.
  if not found or (v_ligne.paye_jusqu_au is not null and v_ligne.paye_jusqu_au >= v_f.fin) then return null; end if;
  v_avant := plateforme.ligne_abonnement(v_ligne);
  update plateforme.abonnement set paye_jusqu_au = v_f.fin, offre = v_f.offre, periodicite = v_f.periodicite, resilie_le = null,
         modules = array(select m from unnest(modules) m where not (m = any(modules_a_retirer)) order by m), modules_a_retirer = '{}',
         suivante_offre = case when suivante_a_partir_du is not null and v_f.debut >= suivante_a_partir_du then null else suivante_offre end,
         suivante_periodicite = case when suivante_a_partir_du is not null and v_f.debut >= suivante_a_partir_du then null else suivante_periodicite end,
         suivante_a_partir_du = case when suivante_a_partir_du is not null and v_f.debut >= suivante_a_partir_du then null else suivante_a_partir_du end,
         modifie_le = now()
   where entreprise = v_f.entreprise returning * into v_ligne;
  insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, avant, apres)
    values (v_f.entreprise, 'paye', 'systeme', 'facture ' || v_p.numero_texte || ' réglée', v_avant,
            plateforme.ligne_abonnement(v_ligne) || jsonb_build_object('debut', v_f.debut, 'fin', v_f.fin, 'facture', v_p.numero_texte)
            || case when v_f.mois_offert then jsonb_build_object('moisOffert', true) else '{}'::jsonb end)
    returning id into v_evenement;
  update plateforme.facture_abonnement set evenement = v_evenement where id = v_f.id;
  return v_evenement;
end $$;

-- Les factures d'abonnement d'une entreprise, telles que la console les montre (0097) ; et si elle porte le mois offert.
create or replace function plateforme.console_factures_abonnement(p_entreprise uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'editeur', f.editeur, 'piece', f.piece_v10, 'client', f.client_v10, 'offre', f.offre, 'periodicite', f.periodicite,
      'debut', f.debut, 'fin', f.fin, 'montantHt', f.montant_ht::text, 'prepareLe', f.prepare_le,
      'preparePar', (select u.nom from socle.utilisateur u where u.id = f.prepare_par), 'payeeLe', f.payee_le,
      'dansLeDossier', d.cle is not null, 'moisOffert', f.mois_offert,
      'numero', p.numero_texte, 'emise', p.statut = 'emise', 'echeance', coalesce(p.echeance::text, d.contenu ->> 'dueDate'),
      'devise', p.devise, 'decimales', dv.decimales, 'net', p.net_a_payer::text,
      'avoirs', case when p.id is null then '[]'::jsonb else (select coalesce(jsonb_agg(a.net_a_payer::text), '[]') from ventes.piece a
                  where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise') end,
      'reglements', case when p.id is null then '[]'::jsonb else (select coalesce(jsonb_agg(r.montant::text), '[]') from ventes.reglement r
                      where r.entreprise = p.entreprise and r.piece = p.id) end)
      order by f.debut desc, f.prepare_le desc), '[]'::jsonb)
    from plateforme.facture_abonnement f
    left join socle.dossier_v10 d on d.entreprise = f.editeur and d.collection = 'documents' and d.cle = f.piece_v10
    left join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
    left join socle.devise dv on dv.code = p.devise
   where f.entreprise = p_entreprise);
end $$;

-- La liste des clients en dit un peu plus (0110) : et si un mois a été offert ces douze derniers mois — la même question
-- que le geste se pose avant de laisser le support en offrir un (console_poser_abonnement).
create or replace function plateforme.console_clients_en_plus(p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  if p_jour is null then perform socle.refus('le jour de la liste manque'); end if;
  return (select coalesce(jsonb_object_agg(e.id, jsonb_build_object(
      'piecesMois', (select count(*) from ventes.piece p where p.entreprise = e.id and p.statut = 'emise'
                       and (p.emise_le at time zone e.fuseau)::date between date_trunc('month', p_jour)::date and p_jour),
      'prolonge', (select coalesce(sum((v.apres ->> 'jours')::int), 0) from plateforme.evenement_abonnement v
                    where v.entreprise = e.id and v.nature = 'essai_prolonge' and jsonb_typeof(v.apres -> 'jours') = 'number'),
      'essaiJours', (select (v.apres ->> 'essaiJusquAu')::date - (v.le at time zone e.fuseau)::date from plateforme.evenement_abonnement v
                      where v.entreprise = e.id and v.nature = 'essai_commence' and v.apres ->> 'essaiJusquAu' ~ '^\d{4}-\d{2}-\d{2}$'
                      order by v.le limit 1),
      'prolongeUneFois', exists (select 1 from plateforme.evenement_abonnement v where v.entreprise = e.id and v.nature = 'essai_prolonge'),
      'moisOffertRecent', exists (select 1 from plateforme.evenement_abonnement v where v.entreprise = e.id and v.nature = 'mois_offert'
                                    and v.le > (p_jour - 365)::timestamptz),
      'factures', case when exists (select 1 from plateforme.facture_abonnement f where f.entreprise = e.id and f.payee_le is null)
                       then plateforme.console_factures_abonnement(e.id) else '[]'::jsonb end)), '{}'::jsonb)
    from socle.entreprise e
   where not e.essai);
end $$;

-- ── 4. Le renouvellement de chaque entreprise, en un passage ─────────────────────────────────────────────────────────
-- La MÊME règle que la facture : l'offre au prix de son premier jour, ce qui s'y ajoute (lignes_en_plus, rattrapage
-- compris), la remise de la période. `p_demandes` : [{entreprise, offre, periodicite, debut}], la période que le serveur
-- calcule (prochainePeriode, la règle de la facture). Une ligne qui ne se calcule pas (un prix manque) le dit, sans
-- emporter les autres.
create function plateforme.console_renouvellements(p_demandes jsonb, p_jour date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_d jsonb;
  v_r jsonb := '{}'::jsonb;
  v_debut date;
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  for v_d in select d from jsonb_array_elements(coalesce(p_demandes, '[]'::jsonb)) d loop
    continue when coalesce(v_d->>'entreprise', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(v_d->>'offre', '') not in ('essentiel', 'complet') or coalesce(v_d->>'periodicite', '') not in ('annuel', 'mensuel')
      or coalesce(v_d->>'debut', '') !~ '^\d{4}-\d{2}-\d{2}$';
    v_debut := (v_d->>'debut')::date;
    begin
      v_r := v_r || jsonb_build_object(v_d->>'entreprise', jsonb_build_object(
        'prixHt', plateforme.prix_de(v_d->>'offre', v_d->>'periodicite', v_debut)::text,
        'enPlus', plateforme.lignes_en_plus((v_d->>'entreprise')::uuid, v_d->>'offre', v_d->>'periodicite', p_jour, v_debut),
        'remise', plateforme.remise_de((v_d->>'entreprise')::uuid, v_debut)));
    exception when others then
      v_r := v_r || jsonb_build_object(v_d->>'entreprise', jsonb_build_object('incalculable', true));
    end;
  end loop;
  return v_r;
end $$;

-- ── 2. et 4. Paiements : les paiements reçus hors de la plateforme, et les factures payées puis défaites ─────────────
-- La lecture de 0108, et deux clés de plus.
create or replace function plateforme.console_paiements(p_mois date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_editeur uuid;
  v_debut date := date_trunc('month', p_mois)::date;
  v_fin date := (date_trunc('month', p_mois) + interval '1 month' - interval '1 day')::date;
begin
  select d.entreprise into v_editeur from plateforme.editeur d;
  return jsonb_build_object(
    'mois', to_char(v_debut, 'YYYY-MM'),
    'editeur', (select jsonb_build_object('entreprise', e.id, 'raisonSociale', e.raison_sociale, 'devise', e.devise_base,
                  'decimales', (select dv.decimales from socle.devise dv where dv.code = e.devise_base))
                  from socle.entreprise e where e.id = v_editeur),
    -- Les règlements du mois sur nos factures, le plus récent d'abord ; un montant négatif est un remboursement.
    'recus', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', r.id, 'date', r.date_reglement, 'montant', r.montant::text, 'devise', p.devise, 'decimales', dv.decimales,
                  'mode', r.mode, 'reference', r.reference, 'numero', p.numero_texte, 'piece', f.piece_v10, 'editeur', f.editeur,
                  'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale), 'noteLe', r.cree_le,
                  'enLigne', (select jsonb_build_object('prestataire', l.prestataire, 'prouveLe', l.prouve_le)
                                from ventes.paiement_en_ligne l
                               where l.entreprise = r.entreprise and l.statut = 'encaisse' and l.reglement_v10 = r.ref_v10))
                  order by r.date_reglement desc, r.cree_le desc, r.id desc), '[]'::jsonb)
                from plateforme.facture_abonnement f
                join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
                join ventes.reglement r on r.entreprise = p.entreprise and r.piece = p.id
                join socle.entreprise e on e.id = f.entreprise
                left join socle.devise dv on dv.code = p.devise
               where f.editeur = v_editeur and r.date_reglement between v_debut and v_fin),
    -- Les factures émises dont le solde n'est pas nul aujourd'hui (net − avoirs − règlements ≠ 0) : qui doit, qui a trop
    -- payé. Tout mois confondu : une dette ne s'arrête pas à la fin du mois.
    'ouvertes', (select coalesce(jsonb_agg(x.v order by x.echeance nulls last, x.numero), '[]'::jsonb) from (
                  select p.echeance, p.numero_texte numero, jsonb_build_object(
                    'piece', f.piece_v10, 'editeur', f.editeur, 'numero', p.numero_texte, 'echeance', p.echeance,
                    'debut', f.debut, 'fin', f.fin, 'devise', p.devise, 'decimales', dv.decimales, 'net', p.net_a_payer::text,
                    'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale),
                    'avoirs', (select coalesce(jsonb_agg(a.net_a_payer::text), '[]'::jsonb) from ventes.piece a
                                where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise'),
                    'reglements', (select coalesce(jsonb_agg(r.montant::text), '[]'::jsonb) from ventes.reglement r
                                    where r.entreprise = p.entreprise and r.piece = p.id)) v
                    from plateforme.facture_abonnement f
                    join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
                    join socle.entreprise e on e.id = f.entreprise
                    left join socle.devise dv on dv.code = p.devise
                   where f.editeur = v_editeur
                     and p.net_a_payer
                         - (select coalesce(sum(a.net_a_payer), 0) from ventes.piece a where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise')
                         - (select coalesce(sum(r.montant), 0) from ventes.reglement r where r.entreprise = p.entreprise and r.piece = p.id) <> 0) x),
    -- Les factures préparées qui attendent d'être émises dans l'application de SkanFact : elles ne doivent rien encore.
    'aEmettre', (select coalesce(jsonb_agg(jsonb_build_object('piece', f.piece_v10, 'editeur', f.editeur, 'debut', f.debut, 'fin', f.fin,
                    'prepareLe', f.prepare_le, 'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale))
                    order by f.prepare_le), '[]'::jsonb)
                  from plateforme.facture_abonnement f
                  join socle.entreprise e on e.id = f.entreprise
                  join socle.dossier_v10 d on d.entreprise = f.editeur and d.collection = 'documents' and d.cle = f.piece_v10
                 where f.editeur = v_editeur
                   and not exists (select 1 from ventes.piece p where p.entreprise = f.editeur and p.ref_v10 = f.piece_v10
                                     and p.type = 'facture' and p.statut = 'emise')),
    -- Les coûts du mois, retirés compris (la trace) : le premier saisi d'abord.
    'couts', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'libelle', c.libelle, 'montant', c.montant::text, 'dApres', c.d_apres,
                  'saisiLe', c.saisi_le, 'saisiPar', (select u.nom from socle.utilisateur u where u.id = c.saisi_par),
                  'retireLe', c.retire_le, 'retirePar', (select u.nom from socle.utilisateur u where u.id = c.retire_par))
                  order by c.saisi_le, c.id), '[]'::jsonb)
                from plateforme.cout_du_mois c where c.mois = v_debut),
    -- Reçus hors de la plateforme ce mois (le jour du paiement, pas celui du geste), par l'entreprise SkanFact ; le plus
    -- récent d'abord.
    'horsPlateforme', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'date', v.apres->>'le', 'montant', v.apres->>'montant',
                          'moyen', v.apres->>'moyen', 'facture', v.apres->>'facture', 'noteLe', v.le,
                          'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale),
                          'par', (select u.nom from plateforme.geste_console g join socle.utilisateur u on u.id = g.qui where g.evenement = v.id limit 1))
                          order by v.apres->>'le' desc, v.le desc), '[]'::jsonb)
                        from plateforme.evenement_abonnement v join socle.entreprise e on e.id = v.entreprise
                       where v.nature = 'paye' and v.par = 'exploitation' and v.apres->>'le' ~ '^\d{4}-\d{2}-\d{2}$'
                         and v.apres->>'montant' ~ '^[0-9]+$' and (v.apres->>'le')::date between v_debut and v_fin
                         and v.apres->>'editeur' = v_editeur::text),
    -- Payées, puis défaites : un avoir qui l'annule (« avoir »), ou un règlement retiré (« reglement ») — la cause se dit,
    -- elle ne demande pas le même geste. Les droits, eux, ont couru : la direction décide.
    'defaites', (select coalesce(jsonb_agg(jsonb_build_object('piece', f.piece_v10, 'editeur', f.editeur, 'numero', p.numero_texte,
                    'payeeLe', f.payee_le, 'debut', f.debut, 'fin', f.fin, 'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale),
                    'cause', case when s.avoirs >= p.net_a_payer then 'avoir' else 'reglement' end)
                    order by f.payee_le), '[]'::jsonb)
                  from plateforme.facture_abonnement f
                  join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
                  join socle.entreprise e on e.id = f.entreprise
                  cross join lateral (select
                    (select coalesce(sum(a.net_a_payer), 0) from ventes.piece a where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise') avoirs,
                    (select coalesce(sum(r.montant), 0) from ventes.reglement r where r.entreprise = p.entreprise and r.piece = p.id) regle) s
                 where f.editeur = v_editeur and f.payee_le is not null
                   and (s.avoirs >= p.net_a_payer or p.net_a_payer - s.avoirs - s.regle > 0))
  );
end $$;

revoke execute on function plateforme.rattrapage_modules(plateforme.abonnement, date),
  plateforme.console_noter_facture(uuid, text, text, text, text, date, date, bigint, text, date, boolean),
  plateforme.console_renouvellements(jsonb, date) from public;
grant execute on function plateforme.console_noter_facture(uuid, text, text, text, text, date, date, bigint, text, date, boolean),
  plateforme.console_renouvellements(jsonb, date) to skanfact_app;
