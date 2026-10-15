-- Les droits payés valent jusqu'au bout (1.28.0 ; l'audit de la console 1.26.0, C01 ; docs/abonnement.md B6). Payer en
-- avance la période qui vient — le 15 octobre pour le 1er novembre, ce que la facture permet — appliquait aussitôt ce
-- que cette période change : les modules qui devaient partir à son premier jour partaient le 15, et une offre plus
-- petite remplaçait dès le 15 celle que le client avait payée jusqu'au 31.
--
-- Désormais, une période payée avant son premier jour garde ce qu'elle change POUR ce jour-là (« à venir ») : son offre,
-- sa périodicité, les modules qui partent. Le jour venu, la bascule l'applique (plateforme.basculer_abonnements, au
-- démarrage du serveur puis chaque heure : un client garde au pire une heure de plus ce qu'il avait payé, jamais une
-- heure de moins). Payée le jour même ou en retard, rien n'attend : elle s'applique tout de suite, comme avant. La
-- facture de SkanFact et le paiement reçu ailleurs suivent la même règle.

alter table plateforme.abonnement
  add column a_venir_le date,
  add column a_venir_offre text check (a_venir_offre in ('essentiel', 'complet')),
  add column a_venir_periodicite text check (a_venir_periodicite in ('annuel', 'mensuel')),
  add column a_venir_retraits text[] not null default '{}',
  add constraint abonnement_a_venir check ((a_venir_le is null) = (a_venir_offre is null) and (a_venir_le is null) = (a_venir_periodicite is null)
                                           and (a_venir_le is not null or cardinality(a_venir_retraits) = 0)),
  add constraint abonnement_a_venir_retraits check (a_venir_retraits <@ modules);

-- La ligne, telle que la console la lit et la compare avant un geste : avec ce qui attend son jour (toujours, nul s'il
-- n'y a rien : la console envoie la même forme).
create or replace function plateforme.ligne_abonnement(a plateforme.abonnement) returns jsonb
language sql immutable set search_path = pg_catalog, plateforme as $$
  select case when a.entreprise is null then null else jsonb_build_object(
    'essai_jusqu_au', a.essai_jusqu_au, 'paye_jusqu_au', a.paye_jusqu_au, 'offre', a.offre, 'periodicite', a.periodicite,
    'resilie_le', a.resilie_le, 'suspendu_le', a.suspendu_le, 'offert', a.offert, 'modules', to_jsonb(a.modules),
    'delai_echeance', a.delai_echeance, 'delai_jusqu_au', a.delai_jusqu_au,
    'suivante_offre', a.suivante_offre, 'suivante_periodicite', a.suivante_periodicite, 'suivante_a_partir_du', a.suivante_a_partir_du,
    'mois_offerts', a.mois_offerts, 'modules_a_retirer', to_jsonb(a.modules_a_retirer),
    'a_venir_le', a.a_venir_le, 'a_venir_offre', a.a_venir_offre, 'a_venir_periodicite', a.a_venir_periodicite,
    'a_venir_retraits', to_jsonb(a.a_venir_retraits)) end
$$;

-- Ce que les faits portent de plus : ce qui attend son jour, aussi.
create or replace function plateforme.faits_en_plus(a plateforme.abonnement) returns jsonb
language sql immutable set search_path = pg_catalog, plateforme as $$
  select jsonb_build_object(
    'delai', case when a.delai_jusqu_au is null then null else jsonb_build_object('echeance', a.delai_echeance, 'jusquAu', a.delai_jusqu_au) end,
    'offreSuivante', case when a.suivante_offre is null then null
                          else jsonb_build_object('offre', a.suivante_offre, 'periodicite', a.suivante_periodicite, 'aPartirDu', a.suivante_a_partir_du) end,
    'moisOffert', coalesce(a.mois_offerts, 0) > 0,
    'modulesARetirer', coalesce(to_jsonb(a.modules_a_retirer), '[]'::jsonb),
    'aVenir', case when a.a_venir_le is null then null
                   else jsonb_build_object('le', a.a_venir_le, 'offre', a.a_venir_offre, 'periodicite', a.a_venir_periodicite,
                                           'retraits', to_jsonb(a.a_venir_retraits)) end)
$$;

create or replace function plateforme.console_faits_en_plus() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_object_agg(a.entreprise, plateforme.faits_en_plus(a)), '{}'::jsonb) from plateforme.abonnement a
           where a.delai_jusqu_au is not null or a.suivante_offre is not null or a.mois_offerts > 0 or cardinality(a.modules_a_retirer) > 0
              or a.a_venir_le is not null);
end $$;

-- ── La bascule : ce qui attend son jour s'applique ce jour-là ────────────────────────────────────────────────────────
-- Une entreprise : rien si son jour n'est pas venu. L'événement le dit dans l'histoire de l'abonnement (« appliqué »).
create function plateforme.basculer_abonnement(p_entreprise uuid, p_jour date) returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, plateforme as $$
declare v_ligne plateforme.abonnement; v_avant jsonb;
begin
  select * into v_ligne from plateforme.abonnement a where a.entreprise = p_entreprise for update;
  if not found or v_ligne.a_venir_le is null or v_ligne.a_venir_le > p_jour then return false; end if;
  v_avant := plateforme.ligne_abonnement(v_ligne);
  update plateforme.abonnement set offre = a_venir_offre, periodicite = a_venir_periodicite,
         modules = array(select m from unnest(modules) m where not (m = any(a_venir_retraits)) order by m),
         modules_a_retirer = array(select m from unnest(modules_a_retirer) m where not (m = any(a_venir_retraits)) order by m),
         a_venir_le = null, a_venir_offre = null, a_venir_periodicite = null, a_venir_retraits = '{}', modifie_le = now()
   where entreprise = p_entreprise returning * into v_ligne;
  insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, avant, apres)
    values (p_entreprise, 'periode_commencee', 'systeme', 'la période payée commence : ce qu''elle change s''applique', v_avant,
            plateforme.ligne_abonnement(v_ligne));
  return true;
end $$;

-- Toutes celles dont le jour est venu (le tour du serveur) : combien ont basculé.
create function plateforme.basculer_abonnements(p_jour date) returns integer
language plpgsql volatile security definer set search_path = pg_catalog, plateforme as $$
declare n integer := 0; v uuid;
begin
  for v in select a.entreprise from plateforme.abonnement a where a.a_venir_le is not null and a.a_venir_le <= p_jour order by a.entreprise loop
    if plateforme.basculer_abonnement(v, p_jour) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- L'histoire d'un abonnement dit la bascule.
alter table plateforme.evenement_abonnement drop constraint evenement_abonnement_nature_check;
alter table plateforme.evenement_abonnement add constraint evenement_abonnement_nature_check check (nature in ('essai_commence',
  'essai_prolonge', 'paye', 'resilie', 'resiliation_annulee', 'suspendu', 'repris', 'offert', 'offert_retire',
  'module_ouvert', 'module_ferme', 'delai_accorde', 'mois_offert', 'offre_changee', 'periode_commencee'));

-- ── Le geste de la console : la ligne d'après porte ce qui attend son jour ────────────────────────────────────────────
-- (le reste comme 0113 ; un paiement reçu ailleurs ne se note pas deux fois : la même facture, déjà notée, est refusée)
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

  -- Ce qui attendait son jour, s'il est venu, d'abord : le geste porte sur la ligne d'aujourd'hui.
  perform plateforme.basculer_abonnement(p_entreprise, p_jour);
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

  if p_geste = 'payer' then
    if length(btrim(coalesce(p_details->>'facture', ''))) not between 1 and 40
       or coalesce(p_details->>'montant', '') !~ '^[1-9][0-9]{0,15}$'
       or coalesce(p_details->>'moyen', '') not in ('virement', 'cheque', 'especes')
       or coalesce(p_details->>'le', '') !~ '^\d{4}-\d{2}-\d{2}$' or (p_details->>'le')::date > p_jour then
      perform socle.refus('un paiement reçu dit sa facture, le montant reçu, son moyen (virement, chèque, espèces) et son jour : sans eux, rien n''est payé');
    end if;
    -- La même facture deux fois (un double clic, un paiement noté par deux personnes) ne paie pas deux périodes.
    if exists (select 1 from plateforme.evenement_abonnement v where v.entreprise = p_entreprise and v.nature = 'paye'
                 and lower(btrim(v.apres->>'facture')) = lower(btrim(p_details->>'facture'))) then
      perform socle.refus('ce paiement est déjà noté : la même facture ne paie pas deux périodes');
    end if;
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
      delai_echeance = case when p_apres ? 'delai_echeance' then (p_apres->>'delai_echeance')::date else delai_echeance end,
      delai_jusqu_au = case when p_apres ? 'delai_jusqu_au' then (p_apres->>'delai_jusqu_au')::date else delai_jusqu_au end,
      suivante_offre = case when p_apres ? 'suivante_offre' then p_apres->>'suivante_offre' else suivante_offre end,
      suivante_periodicite = case when p_apres ? 'suivante_periodicite' then p_apres->>'suivante_periodicite' else suivante_periodicite end,
      suivante_a_partir_du = case when p_apres ? 'suivante_a_partir_du' then (p_apres->>'suivante_a_partir_du')::date else suivante_a_partir_du end,
      mois_offerts = case when p_apres ? 'mois_offerts' then (p_apres->>'mois_offerts')::int else mois_offerts end,
      modules_a_retirer = case when jsonb_typeof(p_apres->'modules_a_retirer') = 'array'
                     then array(select distinct m from jsonb_array_elements_text(p_apres->'modules_a_retirer') m order by m) else modules_a_retirer end,
      -- Ce qui attend son jour (0121) : une ligne envoyée sans lui (un écran d'avant) le garde.
      a_venir_le = case when p_apres ? 'a_venir_le' then (p_apres->>'a_venir_le')::date else a_venir_le end,
      a_venir_offre = case when p_apres ? 'a_venir_offre' then p_apres->>'a_venir_offre' else a_venir_offre end,
      a_venir_periodicite = case when p_apres ? 'a_venir_periodicite' then p_apres->>'a_venir_periodicite' else a_venir_periodicite end,
      a_venir_retraits = case when jsonb_typeof(p_apres->'a_venir_retraits') = 'array'
                     then array(select distinct m from jsonb_array_elements_text(p_apres->'a_venir_retraits') m order by m) else a_venir_retraits end,
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

-- ── Payée par sa facture : la période qui commence plus tard attend son jour ────────────────────────────────────────
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
  v_jour date := (now() at time zone 'Africa/Tunis')::date;
begin
  select * into v_f from plateforme.facture_abonnement f where f.editeur = p_editeur and f.piece_v10 = p_piece_v10 for update;
  if not found or v_f.payee_le is not null then return null; end if;
  select * into v_p from ventes.piece p where p.entreprise = p_editeur and p.ref_v10 = p_piece_v10 and p.type = 'facture' and p.statut = 'emise';
  if not found then return null; end if;
  select coalesce(sum(a.net_a_payer), 0) into v_avoirs from ventes.piece a where a.entreprise = v_p.entreprise and a.corrige = v_p.id and a.statut = 'emise';
  select coalesce(sum(r.montant), 0) into v_reglements from ventes.reglement r where r.entreprise = v_p.entreprise and r.piece = v_p.id;
  if v_p.net_a_payer <= 0 or v_avoirs >= v_p.net_a_payer or v_p.net_a_payer - v_avoirs - v_reglements > 0 then return null; end if;
  update plateforme.facture_abonnement set payee_le = now() where id = v_f.id;
  -- Ce qui attendait son jour, s'il est venu, d'abord.
  perform plateforme.basculer_abonnement(v_f.entreprise, v_jour);
  select * into v_ligne from plateforme.abonnement a where a.entreprise = v_f.entreprise for update;
  if not found or (v_ligne.paye_jusqu_au is not null and v_ligne.paye_jusqu_au >= v_f.fin) then return null; end if;
  v_avant := plateforme.ligne_abonnement(v_ligne);
  if v_f.debut > v_jour and v_ligne.offre is not null then
    -- Payée en avance : la période payée qui court va au bout avec ce qu'elle avait ; ce que la nouvelle change attend
    -- son premier jour. (Un premier paiement pendant l'essai n'a rien de payé à protéger : il s'applique tout de suite.) (Deux périodes payées d'avance : la plus tardive dit l'offre, les retraits s'ajoutent, au premier
    -- des deux jours — un cas que la console n'a pas encore rencontré, écrit dans docs/abonnement.md B6.)
    update plateforme.abonnement set paye_jusqu_au = v_f.fin, resilie_le = null,
           a_venir_le = coalesce(least(a_venir_le, v_f.debut), v_f.debut), a_venir_offre = v_f.offre, a_venir_periodicite = v_f.periodicite,
           a_venir_retraits = array(select distinct m from unnest(a_venir_retraits || modules_a_retirer) m order by m), modules_a_retirer = '{}',
           suivante_offre = case when suivante_a_partir_du is not null and v_f.debut >= suivante_a_partir_du then null else suivante_offre end,
           suivante_periodicite = case when suivante_a_partir_du is not null and v_f.debut >= suivante_a_partir_du then null else suivante_periodicite end,
           suivante_a_partir_du = case when suivante_a_partir_du is not null and v_f.debut >= suivante_a_partir_du then null else suivante_a_partir_du end,
           modifie_le = now()
     where entreprise = v_f.entreprise returning * into v_ligne;
  else
    update plateforme.abonnement set paye_jusqu_au = v_f.fin, offre = v_f.offre, periodicite = v_f.periodicite, resilie_le = null,
           modules = array(select m from unnest(modules) m where not (m = any(modules_a_retirer)) order by m), modules_a_retirer = '{}',
           suivante_offre = case when suivante_a_partir_du is not null and v_f.debut >= suivante_a_partir_du then null else suivante_offre end,
           suivante_periodicite = case when suivante_a_partir_du is not null and v_f.debut >= suivante_a_partir_du then null else suivante_periodicite end,
           suivante_a_partir_du = case when suivante_a_partir_du is not null and v_f.debut >= suivante_a_partir_du then null else suivante_a_partir_du end,
           modifie_le = now()
     where entreprise = v_f.entreprise returning * into v_ligne;
  end if;
  insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, avant, apres)
    values (v_f.entreprise, 'paye', 'systeme', 'facture ' || v_p.numero_texte || ' réglée', v_avant,
            plateforme.ligne_abonnement(v_ligne) || jsonb_build_object('debut', v_f.debut, 'fin', v_f.fin, 'facture', v_p.numero_texte)
            || case when v_f.mois_offert then jsonb_build_object('moisOffert', true) else '{}'::jsonb end)
    returning id into v_evenement;
  update plateforme.facture_abonnement set evenement = v_evenement where id = v_f.id;
  return v_evenement;
end $$;

-- ── La facture d'après : les modules qui partent avec la période payée d'avance ne s'y comptent plus non plus ─────────
create or replace function plateforme.lignes_en_plus(p_entreprise uuid, p_offre text, p_periodicite text, p_jour date, p_prix_au date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, caisse, plateforme as $$
declare
  v_a plateforme.abonnement;
  v_modules text[];
  v_comptes jsonb := plateforme.comptes_de_l_entreprise(p_entreprise, p_jour);
  v_contenu jsonb := plateforme.contenu_du_jour(p_offre, p_prix_au);
  v_inclus jsonb;
  v_lignes jsonb := '[]'::jsonb;
  v_c record;
  v_prix bigint;
begin
  select * into v_a from plateforme.abonnement a where a.entreprise = p_entreprise;
  v_modules := array(select m from unnest(coalesce(v_a.modules, '{}')) m
                      where not (m = any(coalesce(v_a.modules_a_retirer, '{}'))) and not (m = any(coalesce(v_a.a_venir_retraits, '{}'))) order by m);
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

revoke execute on function plateforme.basculer_abonnement(uuid, date), plateforme.basculer_abonnements(date) from public;
grant execute on function plateforme.basculer_abonnements(date) to skanfact_app;
