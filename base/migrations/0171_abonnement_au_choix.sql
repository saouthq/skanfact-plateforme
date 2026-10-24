-- 0171 — L'abonnement après sa revue, lot 2 (1.119.0 ; docs/revue-abonnement.md, P1 4, P2 11 et 12). Skander, « go 1 et 2 »
-- (22/10/2026), sur les trois points du lot : la facture préparée ET émise d'elle-même au choix de l'offre, sans
-- attendre un humain ; le prix TTC à côté du HT (un calcul de l'écran : rien ici) ; « Ne pas renouveler » et ce qui
-- passe à Complet faits par le client lui-même. Décidé par délégation dans le détail :
--   - le choix se facture dans la minute, au nom du propriétaire de l'entreprise SkanFact (comme les factures périodiques
--     émises seules, brique 129) : préparée par la MÊME fonction que la console (serveur/abonnement/factures.ts), notée
--     ici par une jumelle de console_noter_facture (0113) qui revérifie les mêmes chiffres, puis émise par le serveur ;
--     la signature et l'envoi à la TTN restent à une personne. Un choix qui ne se facture pas (la grille sans prix, la
--     fiche du client incomplète pour la facture électronique…) garde son motif, attend la console (« À décider »), et
--     se retente le lendemain ;
--   - « Ne pas renouveler » : l'abonnement payé va au bout de sa période, puis l'entreprise passe en lecture seule ; il se
--     reprend d'un clic tant que la période court. Refusé quand une facture de la période suivante attend son paiement ;
--   - ce qui passe à Complet : à la période suivante, c'est un choix d'offre (il se facture d'avance, comme tout choix) ;
--     tout de suite, c'est un module ouvert (la paie, la comptabilité complète), au prorata de ce qui reste de la période
--     sur la prochaine facture (0113, rattrapage_modules) — le geste de la console, fait par le client.
-- L'histoire de l'abonnement nomme qui a fait le geste : « abonne » (le client lui-même), à côté du serveur et de SkanFact.

alter table plateforme.evenement_abonnement drop constraint evenement_abonnement_par_check;
alter table plateforme.evenement_abonnement add constraint evenement_abonnement_par_check check (par in ('systeme', 'exploitation', 'abonne'));

-- ── 1. La facture au choix ──────────────────────────────────────────────────────────────────────────────────────────
alter table plateforme.facture_abonnement add column au_choix boolean not null default false;

-- Un choix qui ne s'est pas facturé : son motif (dit tel quel à la console), et le jour, pour ne le retenter que le
-- lendemain. Un choix plus récent (un nouveau choix) repart de rien.
create table plateforme.choix_refuse (
  choix uuid primary key references plateforme.offre_choisie(id),
  le timestamptz not null default now(),
  motif text not null check (length(motif) between 1 and 2000)
);
alter table plateforme.choix_refuse enable row level security;
alter table plateforme.choix_refuse force row level security;
revoke all on plateforme.choix_refuse from public;

-- Les faits d'un abonnement, tels que faits_abonnement les rend (0111), sans la porte « mes entreprises » : pour les
-- fonctions qui suivent, qui ont la leur.
create function plateforme.faits_pour_facture(p_entreprise uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object(
    'connu', a.entreprise is not null,
    'essaiJusquAu', a.essai_jusqu_au, 'payeJusquAu', a.paye_jusqu_au, 'offre', a.offre, 'periodicite', a.periodicite,
    'resilieLe', a.resilie_le, 'suspenduLe', a.suspendu_le, 'offert', coalesce(a.offert, false),
    'bacASable', e.essai, 'tenuParCabinet', e.tenue_par is not null, 'modules', coalesce(to_jsonb(a.modules), '[]'::jsonb),
    'regles', plateforme.regles_abonnement_histoire(), 'contenu', plateforme.contenu_histoire()) || plateforme.faits_en_plus(a)
    from socle.entreprise e left join plateforme.abonnement a on a.entreprise = e.id
   where e.id = p_entreprise
$$;

-- Les choix à facturer (le serveur, chaque minute, hors de toute personne) : le dernier choix de chaque entreprise qui
-- n'a pas de facture préparée depuis, quand l'entreprise SkanFact est désignée ; ni pour elle-même, ni pour un exemple,
-- un dossier tenu par un cabinet, un abonnement offert ou suspendu (une décision de SkanFact), ni pendant une période
-- payée que le client a choisi de ne pas renouveler ; un choix refusé attend le lendemain. Avec le propriétaire de
-- l'entreprise SkanFact, au nom de qui la facture s'écrit. `p_entreprise` : celle-ci seulement (juste après son choix).
create function plateforme.choix_a_facturer(p_entreprise uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select coalesce(jsonb_agg(jsonb_build_object('entreprise', c.entreprise, 'choix', c.id, 'proprietaire', p.utilisateur) order by c.le), '[]'::jsonb)
    from (select distinct on (entreprise) * from plateforme.offre_choisie order by entreprise, le desc) c
    join plateforme.editeur d on true
    join socle.entreprise e on e.id = c.entreprise
    join plateforme.abonnement a on a.entreprise = c.entreprise
    cross join lateral (select m.utilisateur from socle.membre m where m.entreprise = d.entreprise and m.actif and 'proprietaire' = any(m.roles)
                         order by m.utilisateur limit 1) p
   where socle.moi() is null and (p_entreprise is null or c.entreprise = p_entreprise) and e.id <> d.entreprise and e.active and not e.essai and e.tenue_par is null
     and not a.offert and a.suspendu_le is null
     and not (a.resilie_le is not null and a.paye_jusqu_au is not null and a.paye_jusqu_au >= (now() at time zone 'Africa/Tunis')::date)
     and not exists (select 1 from plateforme.facture_abonnement f where f.entreprise = c.entreprise and f.prepare_le >= c.le)
     and not exists (select 1 from plateforme.choix_refuse r where r.choix = c.id and r.le > now() - interval '1 day')
$$;

-- Ce qu'il faut pour facturer un choix, au propriétaire de l'entreprise SkanFact seulement (editeur_de_mes_factures) :
-- le choix qui attend, les faits de l'abonnement, l'abonné tel que la facture le nomme (sa raison sociale, son
-- matricule, l'adresse de son propriétaire), et ses factures d'avant (la fiche du client à reprendre, le mois offert).
create function plateforme.choix_pour_facture(p_entreprise uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_editeur uuid := plateforme.editeur_de_mes_factures();
  v_choix plateforme.offre_choisie;
begin
  select c.* into v_choix from plateforme.offre_choisie c
   where c.entreprise = p_entreprise and not exists (select 1 from plateforme.facture_abonnement f where f.entreprise = c.entreprise and f.prepare_le >= c.le)
   order by c.le desc limit 1;
  if not found or p_entreprise = v_editeur then return null; end if;
  return jsonb_build_object(
    'choix', jsonb_build_object('id', v_choix.id, 'offre', v_choix.offre, 'periodicite', v_choix.periodicite, 'le', v_choix.le),
    'faits', plateforme.faits_pour_facture(p_entreprise),
    'abonne', (select jsonb_build_object('raisonSociale', e.raison_sociale, 'matricule', e.matricule_fiscal,
                 'email', (select u.email from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
                            where m.entreprise = e.id and m.actif and 'proprietaire' = any(m.roles) order by m.utilisateur limit 1))
                 from socle.entreprise e where e.id = p_entreprise),
    'factures', (select coalesce(jsonb_agg(jsonb_build_object('client', f.client_v10, 'editeur', f.editeur, 'piece', f.piece_v10, 'moisOffert', f.mois_offert)
                   order by f.debut desc, f.prepare_le desc), '[]'::jsonb)
                   from plateforme.facture_abonnement f where f.entreprise = p_entreprise));
end $$;

-- La période d'un choix, comptée au propriétaire de l'entreprise SkanFact : le prix de l'offre à son premier jour, ce qui
-- s'y ajoute, et sa remise — ce que la console lit pour la même facture (console_lignes_facture, console_remise).
create function plateforme.choix_donnees(p_entreprise uuid, p_offre text, p_periodicite text, p_jour date, p_debut date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.editeur_de_mes_factures();
  if p_offre not in ('essentiel', 'complet') or p_periodicite not in ('annuel', 'mensuel') then perform socle.refus('offre inconnue'); end if;
  return jsonb_build_object(
    'prixHt', plateforme.prix_de(p_offre, p_periodicite, p_debut)::text,
    'enPlus', plateforme.lignes_en_plus(p_entreprise, p_offre, p_periodicite, p_jour, p_debut),
    'remise', plateforme.remise_de(p_entreprise, p_debut));
end $$;

-- La facture d'un choix est préparée : la jumelle de console_noter_facture (0113), qui revérifie les mêmes chiffres (la
-- grille au premier jour de la période, ce qui s'y ajoute, la remise, la période, le mois offert, la pièce et la fiche
-- au dossier de l'entreprise SkanFact) ; au nom de son propriétaire, et seulement pour le choix qui attend, sur son offre.
-- Pas de geste de la console : c'est le choix du client, et la facture le dit (`au_choix`).
create function plateforme.noter_facture_au_choix(p_entreprise uuid, p_piece_v10 text, p_client_v10 text, p_offre text, p_periodicite text,
                                                  p_debut date, p_fin date, p_montant_ht bigint, p_jour date, p_mois_offert boolean) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_editeur uuid := plateforme.editeur_de_mes_factures();
  v_choix jsonb := plateforme.offre_choisie_en_attente(p_entreprise);
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
  v_id uuid;
begin
  if v_choix is null or v_choix->>'offre' is distinct from p_offre or v_choix->>'periodicite' is distinct from p_periodicite then
    perform socle.refus('aucun choix de cette offre n''attend sa facture');
  end if;
  if p_entreprise = v_editeur then perform socle.refus('l''entreprise SkanFact ne se facture pas à elle-même'); end if;
  if not exists (select 1 from socle.entreprise e where e.id = p_entreprise and not e.essai and e.tenue_par is null) then
    perform socle.refus('cette entreprise n''a pas d''abonnement à facturer');
  end if;
  select x.montant_ht into v_prix from plateforme.prix x
   where x.offre = p_offre and x.periodicite = p_periodicite and x.a_partir_du <= p_debut order by x.a_partir_du desc limit 1;
  v_lignes := plateforme.lignes_en_plus(p_entreprise, p_offre, p_periodicite, p_jour, p_debut);
  v_brut := v_prix + coalesce((select sum((l->>'quantite')::bigint * (l->>'prixHt')::bigint) from jsonb_array_elements(v_lignes) l), 0);
  v_remise := plateforme.remise_de(p_entreprise, p_debut);
  v_taux := coalesce((v_remise->>'taux')::int, 0);
  v_remise_ht := plateforme.montant_remise(v_brut, v_taux);
  if v_prix is null or v_brut - v_remise_ht <> p_montant_ht then
    perform socle.refus('le total n''est pas celui de la grille au premier jour de la période');
  end if;
  if not exists (select 1 from socle.dossier_v10 d where d.entreprise = v_editeur and d.collection = 'documents' and d.cle = p_piece_v10)
     or not exists (select 1 from socle.dossier_v10 d where d.entreprise = v_editeur and d.collection = 'clients' and d.cle = p_client_v10) then
    perform socle.refus(format('la facture préparée manque au dossier de l''entreprise SkanFact : %s', p_piece_v10));
  end if;
  select * into v_f from plateforme.facture_abonnement f where f.editeur = v_editeur and f.piece_v10 = p_piece_v10 for update;
  v_deja := found;
  if v_deja then perform socle.refus('la facture de cette période existe déjà'); end if;
  select * into v_a from plateforme.abonnement a where a.entreprise = p_entreprise for update;
  if p_mois_offert is distinct from (coalesce(v_a.mois_offerts, 0) = 1) then
    perform socle.refus('le mois offert de cette facture n''est pas celui qui attend');
  end if;
  v_fin := (p_debut + make_interval(months => case p_periodicite when 'annuel' then 12 else 1 end + case when p_mois_offert then 1 else 0 end))::date - 1;
  if p_fin <> v_fin then perform socle.refus('la période de la facture n''est pas la bonne'); end if;
  insert into plateforme.facture_abonnement (entreprise, editeur, piece_v10, client_v10, offre, periodicite, debut, fin, montant_ht, prepare_par,
                                            remise_nature, remise_taux, remise_ht, mois_offert, au_choix)
    values (p_entreprise, v_editeur, p_piece_v10, p_client_v10, p_offre, p_periodicite, p_debut, p_fin, p_montant_ht, socle.moi(),
            case when v_taux > 0 then v_remise->>'nature' end, v_taux, v_remise_ht, p_mois_offert, true)
    returning id into v_id;
  if p_mois_offert then
    update plateforme.abonnement set mois_offerts = 0, modifie_le = now() where entreprise = p_entreprise;
  end if;
  return v_id;
end $$;

-- Un choix qui ne s'est pas facturé : son motif, noté par le serveur (hors de toute personne).
create function plateforme.choix_refus_noter(p_choix uuid, p_motif text) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  if socle.moi() is not null then perform socle.refus('seul le serveur note un choix qui ne s''est pas facturé'); end if;
  insert into plateforme.choix_refuse (choix, motif) values (p_choix, left(p_motif, 2000))
    on conflict (choix) do update set le = now(), motif = excluded.motif;
end $$;

-- Ce que la console lit des choix qui attendent (0158) : et, pour celui qui ne s'est pas facturé seul, pourquoi.
create or replace function plateforme.console_offres_choisies() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction']);
  return (select coalesce(jsonb_agg(x.v order by x.le), '[]'::jsonb) from (
    select c.le, jsonb_build_object('entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale), 'offre', c.offre,
             'periodicite', c.periodicite, 'le', c.le, 'par', u.nom,
             'refus', (select r.motif from plateforme.choix_refuse r where r.choix = c.id)) v
      from (select distinct on (entreprise) * from plateforme.offre_choisie order by entreprise, le desc) c
      join socle.entreprise e on e.id = c.entreprise
      join socle.utilisateur u on u.id = c.par
     where not exists (select 1 from plateforme.facture_abonnement f where f.entreprise = c.entreprise and f.prepare_le >= c.le)) x);
end $$;

-- Le choix qui attend, tel que l'abonnée le lit (0158) : et son identifiant, et s'il ne s'est pas facturé seul (« la
-- console la prépare »), pour que l'onglet dise ce qui se passe vraiment.
create or replace function plateforme.offre_choisie_en_attente(p_entreprise uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select jsonb_build_object('id', c.id, 'offre', c.offre, 'periodicite', c.periodicite, 'le', c.le, 'par', u.nom,
           'refuse', exists (select 1 from plateforme.choix_refuse r where r.choix = c.id))
    from plateforme.offre_choisie c join socle.utilisateur u on u.id = c.par
   where c.entreprise = p_entreprise
     and not exists (select 1 from plateforme.facture_abonnement f where f.entreprise = c.entreprise and f.prepare_le >= c.le)
   order by c.le desc limit 1
$$;

-- La fiche de l'entreprise SkanFact, pour calculer ce qu'une facture d'abonnement coûtera TVA et timbre compris (le
-- moteur de la v10 : son régime, son taux, son timbre). Lue par le serveur seulement : la route n'en rend que les
-- montants, jamais la fiche (elle porte des réglages qui ne sortent pas : l'adresse de son comptable, sa banque).
create function plateforme.fiche_editeur_pour_prix() returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select d.contenu from plateforme.editeur e
    join socle.dossier_v10 d on d.entreprise = e.entreprise and d.collection = '_racine' and d.cle = 'company'
   where socle.moi() is not null
$$;
revoke execute on function plateforme.fiche_editeur_pour_prix() from public;
grant execute on function plateforme.fiche_editeur_pour_prix() to skanfact_app;

-- ── 2. Ne pas renouveler, puis reprendre ────────────────────────────────────────────────────────────────────────────
-- Qui gère l'abonnement (la propriétaire, l'administratrice), pendant une période payée qui court : « Ne pas
-- renouveler » (l'abonnement va jusqu'au bout de sa période, puis la lecture seule) ou le reprendre. Ni pour un
-- abonnement offert ou suspendu (des décisions de SkanFact) ; ne pas renouveler est refusé quand la facture de la
-- période suivante attend son paiement (l'annuler se demande). L'histoire le dit, par le client lui-même.
create function plateforme.mon_renouvellement(p_entreprise uuid, p_renouveler boolean, p_jour date) returns void
language plpgsql volatile security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  v_a plateforme.abonnement;
  v_avant jsonb;
begin
  if socle.moi() is null or socle.ma_cle() is not null or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']::text[]) then
    perform socle.refus('seuls la propriétaire et l''administratrice de l''entreprise règlent son abonnement');
  end if;
  perform plateforme.basculer_abonnement(p_entreprise, p_jour);
  select * into v_a from plateforme.abonnement a where a.entreprise = p_entreprise for update;
  if not found or v_a.offert or v_a.suspendu_le is not null or v_a.paye_jusqu_au is null or v_a.paye_jusqu_au < p_jour then
    perform socle.refus('seul un abonnement payé qui court se renouvelle ou non');
  end if;
  v_avant := plateforme.ligne_abonnement(v_a);
  if p_renouveler then
    if v_a.resilie_le is null then perform socle.refus('cet abonnement se renouvelle déjà'); end if;
    update plateforme.abonnement set resilie_le = null, modifie_le = now() where entreprise = p_entreprise returning * into v_a;
  else
    if v_a.resilie_le is not null then perform socle.refus('cet abonnement ne se renouvelle déjà plus'); end if;
    if exists (select 1 from plateforme.facture_abonnement f
                 join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
                where f.entreprise = p_entreprise and f.payee_le is null and f.debut > v_a.paye_jusqu_au) then
      perform socle.refus('la facture de ta période suivante attend déjà son paiement : pour ne pas renouveler, écris-nous à contact@skanfact.tn, et nous l''annulerons');
    end if;
    update plateforme.abonnement set resilie_le = p_jour, modifie_le = now() where entreprise = p_entreprise returning * into v_a;
  end if;
  insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, avant, apres)
    values (p_entreprise, case when p_renouveler then 'resiliation_annulee' else 'resilie' end, 'abonne', 'dans l''application', v_avant,
            plateforme.ligne_abonnement(v_a));
  perform socle.tracer(p_entreprise, 'socle.abonnement.payer', 'abonnement', null, null, jsonb_build_object('renouveler', p_renouveler));
end $$;

-- ── 3. Ouvrir un module tout de suite ───────────────────────────────────────────────────────────────────────────────
-- La paie ou la comptabilité complète, sur un abonnement payé qui court, quand son offre ne la contient pas : elle s'ouvre
-- aujourd'hui, et la prochaine facture rattrape au prorata les jours qui restent de la période (rattrapage_modules) — le
-- geste « ouvrir-module » de la console (serveur/abonnement/gestes.ts), fait par qui gère l'abonnement. `p_apercu` : rien
-- ne s'écrit, la fonction dit seulement ce que la prochaine facture rattrapera, par le calcul de rattrapage_modules.
create function plateforme.mon_module_ouvrir(p_entreprise uuid, p_module text, p_jour date, p_apercu boolean) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_a plateforme.abonnement;
  v_avant jsonb;
  v_debut date;
  v_prix bigint;
  v_jours integer;
  v_sur integer;
begin
  if socle.moi() is null or socle.ma_cle() is not null or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']::text[]) then
    perform socle.refus('seuls la propriétaire et l''administratrice de l''entreprise règlent son abonnement');
  end if;
  if p_module not in ('paie', 'compta') then perform socle.refus('le module est la paie ou la comptabilité complète'); end if;
  perform plateforme.basculer_abonnement(p_entreprise, p_jour);
  select * into v_a from plateforme.abonnement a where a.entreprise = p_entreprise for update;
  if not found or v_a.offert or v_a.suspendu_le is not null or v_a.resilie_le is not null or v_a.paye_jusqu_au is null or v_a.paye_jusqu_au < p_jour then
    perform socle.refus('un module s''ouvre tout de suite sur un abonnement payé qui court et se renouvelle');
  end if;
  if coalesce((plateforme.contenu_du_jour(v_a.offre, p_jour)->>p_module)::int, 0) <> 0 then
    perform socle.refus('ton offre contient déjà ce module');
  end if;
  if p_module = any(v_a.modules) then perform socle.refus('ce module est déjà acheté pour ton abonnement'); end if;
  if v_a.a_venir_le is not null and p_module = any(coalesce(v_a.a_venir_retraits, '{}')) then
    perform socle.refus('ce module part avec la période déjà payée : il se rouvre une fois qu''elle a commencé');
  end if;
  -- Ce que la prochaine facture rattrapera : la règle de rattrapage_modules (0113), du jour d'ouverture à la fin payée.
  select (v.apres->>'debut')::date into v_debut from plateforme.evenement_abonnement v
   where v.entreprise = p_entreprise and v.nature = 'paye' and v.apres->>'fin' = v_a.paye_jusqu_au::text and v.apres->>'debut' ~ '^\d{4}-\d{2}-\d{2}$'
   order by v.le desc limit 1;
  v_prix := plateforme.prix_de('module_' || p_module, v_a.periodicite, coalesce(v_debut, p_jour));
  if v_prix is null then perform socle.refus('ce module n''a pas de prix dans la grille : écris-nous à contact@skanfact.tn'); end if;
  -- La facture de la période suivante déjà faite (un choix facturé d'avance) : elle ne compterait ni le module ni son
  -- rattrapage, et l'écran dirait faux ; le module attend qu'elle soit passée, ou SkanFact s'en occupe.
  if exists (select 1 from plateforme.facture_abonnement f where f.entreprise = p_entreprise and f.debut > v_a.paye_jusqu_au) then
    perform socle.refus('la facture de ta période suivante est déjà faite : pour ouvrir ce module maintenant, écris-nous à contact@skanfact.tn');
  end if;
  -- Sans le paiement de la période dans l'histoire, rattrapage_modules ne rattrape rien : l'aperçu le dit (deux chemins,
  -- un chiffre).
  v_jours := case when v_debut is null then 0 else v_a.paye_jusqu_au - greatest(p_jour, v_debut) + 1 end;
  v_sur := case when v_debut is null then 0 else v_a.paye_jusqu_au - v_debut + 1 end;
  if p_apercu then
    return jsonb_build_object('module', p_module, 'jours', v_jours, 'sur', v_sur, 'du', greatest(p_jour, v_debut), 'au', v_a.paye_jusqu_au,
      'rattrapageHt', (case when v_sur = 0 then 0 else (v_prix * v_jours * 2 + v_sur) / (2 * v_sur) end)::text, 'prixHt', v_prix::text, 'periodicite', v_a.periodicite);
  end if;
  v_avant := plateforme.ligne_abonnement(v_a);
  update plateforme.abonnement set modules = array(select distinct m from unnest(v_a.modules || p_module) m order by m), modifie_le = now()
   where entreprise = p_entreprise returning * into v_a;
  insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, avant, apres)
    values (p_entreprise, 'module_ouvert', 'abonne', 'dans l''application', v_avant, plateforme.ligne_abonnement(v_a) || jsonb_build_object('module', p_module));
  perform socle.tracer(p_entreprise, 'socle.abonnement.payer', 'abonnement', null, null, jsonb_build_object('module', p_module));
  return null;
end $$;

revoke execute on function plateforme.faits_pour_facture(uuid), plateforme.choix_a_facturer(uuid), plateforme.choix_pour_facture(uuid),
  plateforme.choix_donnees(uuid, text, text, date, date),
  plateforme.noter_facture_au_choix(uuid, text, text, text, text, date, date, bigint, date, boolean), plateforme.choix_refus_noter(uuid, text),
  plateforme.mon_renouvellement(uuid, boolean, date), plateforme.mon_module_ouvrir(uuid, text, date, boolean) from public;
grant execute on function plateforme.choix_a_facturer(uuid), plateforme.choix_pour_facture(uuid), plateforme.choix_donnees(uuid, text, text, date, date),
  plateforme.noter_facture_au_choix(uuid, text, text, text, text, date, date, bigint, date, boolean), plateforme.choix_refus_noter(uuid, text),
  plateforme.mon_renouvellement(uuid, boolean, date), plateforme.mon_module_ouvrir(uuid, text, date, boolean) to skanfact_app;
