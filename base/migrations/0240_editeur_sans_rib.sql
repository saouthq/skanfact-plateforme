-- 0240 — La désignation de l'entreprise SkanFact dit ce qui manque à sa fiche (1.389.2 ; l'issue #29, CONS3-1).
--
-- Désigner l'entreprise SkanFact fait partir des factures dans la minute (le choix d'un client, l'abonnement d'un
-- cabinet), et une facture qui part seule ne part pas sans le RIB de sa fiche (serveur/abonnement/avant-emission.ts) :
-- la console le dit AVANT la désignation (`sansRib` sur chaque entreprise qu'on peut désigner) et après (sur celle qui
-- l'est), au lieu de laisser les factures attendre dans « À décider » sans que personne sache pourquoi. Et ses factures
-- comptent celles des cabinets (0239) : une entreprise qui a émis la facture d'un cabinet ne se remplace plus d'un clic.

-- La fiche d'une entreprise porte-t-elle son RIB (le champ de la fiche société, celui que la facture imprime) ?
create function plateforme.fiche_a_un_rib(p_entreprise uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, socle as $$
  select coalesce((select length(btrim(coalesce(c.contenu ->> 'rib', ''))) > 0 from socle.dossier_v10 c
                    where c.entreprise = p_entreprise and c.collection = '_racine' and c.cle = 'company'), false)
$$;
revoke execute on function plateforme.fiche_a_un_rib(uuid) from public;

create or replace function plateforme.console_editeur() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return jsonb_build_object(
    'editeur', (select jsonb_build_object('entreprise', e.id, 'raisonSociale', e.raison_sociale, 'matricule', e.matricule_fiscal,
                  'poseLe', d.pose_le, 'posePar', (select u.nom from socle.utilisateur u where u.id = d.pose_par),
                  'proprietaire', exists (select 1 from socle.membre m where m.entreprise = e.id and m.utilisateur = socle.moi() and m.actif and 'proprietaire' = any(m.roles)),
                  'factures', (select count(*) from plateforme.nos_factures_d_abonnement() f where f.editeur = e.id),
                  'sansRib', not plateforme.fiche_a_un_rib(e.id))
                  from plateforme.editeur d join socle.entreprise e on e.id = d.entreprise),
    'possibles', (select coalesce(jsonb_agg(jsonb_build_object('entreprise', e.id, 'raisonSociale', e.raison_sociale, 'matricule', e.matricule_fiscal,
                    'sansRib', not plateforme.fiche_a_un_rib(e.id))
                    order by e.raison_sociale, e.id), '[]'::jsonb)
                    from socle.membre m join socle.entreprise e on e.id = m.entreprise
                   where m.utilisateur = socle.moi() and m.actif and 'proprietaire' = any(m.roles) and not e.essai and e.active));
end $$;

-- Désigner une autre entreprise : la facture d'un cabinet y vit aussi (la fonction de 0097, la liste de 0239).
create or replace function plateforme.console_poser_editeur(p_entreprise uuid, p_motif text) returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, socle, plateforme as $$
declare
  v_role text := plateforme.exiger_role_console(array['direction']);
  v_nom text;
  v_avant uuid;
  v_ligne plateforme.abonnement;
  v_evenement uuid;
  v_geste uuid;
begin
  if length(btrim(coalesce(p_motif, ''))) < 3 then
    perform socle.refus('un geste de la console demande son motif (trois caractères au moins) : il reste dans le journal');
  end if;
  select e.raison_sociale into v_nom from socle.entreprise e
   where e.id = p_entreprise and not e.essai and e.active
     and exists (select 1 from socle.membre m where m.entreprise = e.id and m.utilisateur = socle.moi() and m.actif and 'proprietaire' = any(m.roles));
  if v_nom is null then perform socle.refus('nos factures naissent dans une entreprise dont tu es propriétaire : ce n''est pas le cas de celle-ci'); end if;
  select d.entreprise into v_avant from plateforme.editeur d for update;
  if v_avant = p_entreprise then perform socle.refus('c''est déjà l''entreprise de nos factures'); end if;
  if v_avant is not null and exists (select 1 from plateforme.nos_factures_d_abonnement() f where f.editeur = v_avant) then
    perform socle.refus('des factures sont déjà préparées dans l''entreprise SkanFact désignée : elles y vivent, et elle ne se change plus');
  end if;
  insert into plateforme.editeur (seul, entreprise, pose_par) values (true, p_entreprise, socle.moi())
    on conflict (seul) do update set entreprise = excluded.entreprise, pose_le = now(), pose_par = excluded.pose_par;
  -- Elle ne se facture pas à elle-même.
  select * into v_ligne from plateforme.abonnement a where a.entreprise = p_entreprise for update;
  if found and not v_ligne.offert then
    update plateforme.abonnement set offert = true, modifie_le = now() where entreprise = p_entreprise;
    insert into plateforme.evenement_abonnement (entreprise, nature, par, motif, avant, apres)
      values (p_entreprise, 'offert', 'exploitation', 'l''entreprise de SkanFact : elle ne se facture pas à elle-même',
              plateforme.ligne_abonnement(v_ligne), plateforme.ligne_abonnement(v_ligne) || jsonb_build_object('offert', true))
      returning id into v_evenement;
  end if;
  insert into plateforme.geste_console (qui, role, geste, entreprise, evenement, motif, avant, apres)
    values (socle.moi(), v_role, 'factures.editeur', p_entreprise, v_evenement, btrim(p_motif),
            case when v_avant is null then null else jsonb_build_object('entreprise', v_avant,
              'raisonSociale', (select e.raison_sociale from socle.entreprise e where e.id = v_avant)) end,
            jsonb_build_object('entreprise', p_entreprise, 'raisonSociale', v_nom))
    returning id into v_geste;
  return v_geste;
end $$;
