-- 0241 — La désignation de l'entreprise SkanFact dit ce qui partira dans la minute (1.389.4 ; l'issue #29, CONS3-4).
--
-- Désigner l'entreprise SkanFact ouvre la porte au facturier : chaque choix d'offre d'un client et chaque abonnement de
-- cabinet qui attendait sa facture part dans la minute qui suit (serveur/principal.ts). La console le dit AVANT la
-- désignation, avec qui et quoi, au lieu de laisser découvrir après coup des factures émises au nom d'une entreprise
-- qu'on venait de choisir. Les règles sont celles du facturier (choix_a_facturer, 0171 ; cabinets_a_facturer, 0220),
-- sans l'entreprise désignée : on demande « que ferait-il si celle-ci l'était ? ».

-- Ce qui attend une entreprise SkanFact pour partir. `entreprise` dit pour quelle entreprise SkanFact le client ne se
-- facture pas (elle ne se facture pas à elle-même) ; un cabinet n'en a pas.
create function plateforme.factures_en_attente_d_editeur(p_jour date) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select coalesce(jsonb_agg(x.v order by x.cabinet, x.nom, x.id), '[]'::jsonb) from (
    select false cabinet, e.raison_sociale nom, e.id,
           jsonb_build_object('sorte', 'client', 'id', e.id, 'nom', e.raison_sociale, 'offre', c.offre, 'periodicite', c.periodicite) v
      from (select distinct on (entreprise) * from plateforme.offre_choisie order by entreprise, le desc) c
      join socle.entreprise e on e.id = c.entreprise
      join plateforme.abonnement a on a.entreprise = c.entreprise
     where e.active and not e.essai and e.tenue_par is null
       and not a.offert and a.suspendu_le is null
       and not (a.resilie_le is not null and a.paye_jusqu_au is not null and a.paye_jusqu_au >= p_jour)
       and not exists (select 1 from plateforme.facture_abonnement f where f.entreprise = c.entreprise and f.prepare_le >= c.le)
    union all
    select true, o.nom, o.id, jsonb_build_object('sorte', 'cabinet', 'id', o.id, 'nom', o.nom)
      from (select distinct e.tenue_par cabinet from socle.entreprise e where e.tenue_par is not null and e.active and not e.exemple) t
      join socle.organisation o on o.id = t.cabinet
     where not plateforme.cabinet_offert(t.cabinet, p_jour)
       and exists (select 1 from plateforme.dossiers_du_cabinet(t.cabinet, p_jour) d where d.payant)
       and not exists (select 1 from plateforme.faveur_cabinet f where f.cabinet = t.cabinet and f.sans_facture_avant > p_jour)
       and not exists (select 1 from plateforme.facture_cabinet f where f.cabinet = t.cabinet
                         and f.debut = coalesce(plateforme.periode_cabinet(t.cabinet, p_jour), p_jour))
  ) x
$$;
revoke execute on function plateforme.factures_en_attente_d_editeur(date) from public;

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
                   where m.utilisateur = socle.moi() and m.actif and 'proprietaire' = any(m.roles) and not e.essai and e.active),
    'enAttente', plateforme.factures_en_attente_d_editeur((now() at time zone 'Africa/Tunis')::date));
end $$;
