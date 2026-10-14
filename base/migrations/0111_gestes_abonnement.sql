-- Les gestes de la maquette Fiche qui manquaient à l'abonnement (docs/console.md C33 ; serveur/abonnement/gestes.ts) :
--   - accorder un délai : « Prolonger la grâce… » (en grâce : la lecture seule recule) et « Réactiver… » (en lecture
--     seule après un essai ou une échéance manquée : tout se rouvre jusqu'au jour dit, le temps qu'il paie). Un délai
--     vaut pour UNE échéance : payée, l'échéance change, et le délai d'avant ne compte plus. Jamais pour une suspension
--     ni une résiliation (« Reprendre », « Annuler la résiliation ») ;
--   - offrir un mois : la période payée s'allonge d'un mois, sans facture ni avoir (rien n'est vendu pour ce mois-là) ;
--   - changer d'offre : la nouvelle offre (et sa périodicité) vaut à partir de la prochaine échéance — la période payée
--     va au bout avec l'offre payée ; sa prochaine facture la porte. Une facture au prorata en cours de période : À
--     VÉRIFIER avec le comptable (facture complémentaire, avoir) ; elle ne se fait pas.
-- La direction seule (un délai de paiement, un mois offert, une offre : de l'argent).

alter table plateforme.abonnement
  add column delai_echeance date, add column delai_jusqu_au date,
  add column suivante_offre text check (suivante_offre in ('essentiel', 'complet')),
  add column suivante_periodicite text check (suivante_periodicite in ('annuel', 'mensuel')),
  add column suivante_a_partir_du date,
  add constraint abonnement_delai check ((delai_echeance is null) = (delai_jusqu_au is null) and (delai_jusqu_au is null or delai_jusqu_au >= delai_echeance)),
  add constraint abonnement_suivante check ((suivante_offre is null) = (suivante_periodicite is null) and (suivante_offre is null) = (suivante_a_partir_du is null));

alter table plateforme.evenement_abonnement drop constraint evenement_abonnement_nature_check;
alter table plateforme.evenement_abonnement add constraint evenement_abonnement_nature_check check (nature in ('essai_commence',
  'essai_prolonge', 'paye', 'resilie', 'resiliation_annulee', 'suspendu', 'repris', 'offert', 'offert_retire', 'module_ouvert', 'module_ferme',
  'delai_accorde', 'mois_offert', 'offre_changee'));

-- La ligne telle que la console la lit, la renvoie, et que la base compare avant d'écrire (01 R15).
create or replace function plateforme.ligne_abonnement(a plateforme.abonnement) returns jsonb
language sql immutable set search_path = pg_catalog, plateforme as $$
  select case when a.entreprise is null then null else jsonb_build_object(
    'essai_jusqu_au', a.essai_jusqu_au, 'paye_jusqu_au', a.paye_jusqu_au, 'offre', a.offre, 'periodicite', a.periodicite,
    'resilie_le', a.resilie_le, 'suspendu_le', a.suspendu_le, 'offert', a.offert, 'modules', to_jsonb(a.modules),
    'delai_echeance', a.delai_echeance, 'delai_jusqu_au', a.delai_jusqu_au,
    'suivante_offre', a.suivante_offre, 'suivante_periodicite', a.suivante_periodicite, 'suivante_a_partir_du', a.suivante_a_partir_du) end
$$;

-- Ce que les faits portent de plus (la porte, la fiche, les listes) : le délai et l'offre de la prochaine échéance.
create function plateforme.faits_en_plus(a plateforme.abonnement) returns jsonb
language sql immutable set search_path = pg_catalog, plateforme as $$
  select jsonb_build_object(
    'delai', case when a.delai_jusqu_au is null then null else jsonb_build_object('echeance', a.delai_echeance, 'jusquAu', a.delai_jusqu_au) end,
    'offreSuivante', case when a.suivante_offre is null then null
                          else jsonb_build_object('offre', a.suivante_offre, 'periodicite', a.suivante_periodicite, 'aPartirDu', a.suivante_a_partir_du) end)
$$;

create or replace function plateforme.faits_abonnement(p_entreprise uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object(
    'connu', a.entreprise is not null,
    'essaiJusquAu', a.essai_jusqu_au, 'payeJusquAu', a.paye_jusqu_au, 'offre', a.offre, 'periodicite', a.periodicite,
    'resilieLe', a.resilie_le, 'suspenduLe', a.suspendu_le, 'offert', coalesce(a.offert, false),
    'bacASable', e.essai, 'tenuParCabinet', e.tenue_par is not null, 'modules', coalesce(to_jsonb(a.modules), '[]'::jsonb),
    'regles', plateforme.regles_abonnement_histoire(), 'contenu', plateforme.contenu_histoire()) || plateforme.faits_en_plus(a)
    from socle.entreprise e left join plateforme.abonnement a on a.entreprise = e.id
   where e.id = p_entreprise and e.id in (select socle.mes_entreprises())
$$;

-- Les mêmes, pour la console, de chaque entreprise en un passage (la liste, l'accueil, les échéances, la fiche).
create function plateforme.console_faits_en_plus() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_object_agg(a.entreprise, plateforme.faits_en_plus(a)), '{}'::jsonb) from plateforme.abonnement a
           where a.delai_jusqu_au is not null or a.suivante_offre is not null);
end $$;
revoke execute on function plateforme.console_faits_en_plus() from public;
grant execute on function plateforme.console_faits_en_plus() to skanfact_app;

-- Le geste de la console : trois gestes de plus, la direction seule ; le délai et l'offre suivante s'écrivent avec le
-- reste de la ligne.
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
      -- Le délai et l'offre de la prochaine échéance (0111) : une ligne envoyée sans eux (un écran d'avant) les garde.
      delai_echeance = case when p_apres ? 'delai_echeance' then (p_apres->>'delai_echeance')::date else delai_echeance end,
      delai_jusqu_au = case when p_apres ? 'delai_jusqu_au' then (p_apres->>'delai_jusqu_au')::date else delai_jusqu_au end,
      suivante_offre = case when p_apres ? 'suivante_offre' then p_apres->>'suivante_offre' else suivante_offre end,
      suivante_periodicite = case when p_apres ? 'suivante_periodicite' then p_apres->>'suivante_periodicite' else suivante_periodicite end,
      suivante_a_partir_du = case when p_apres ? 'suivante_a_partir_du' then (p_apres->>'suivante_a_partir_du')::date else suivante_a_partir_du end,
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
