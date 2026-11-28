-- (1.390.5, issue 12, CP-1) « Ton abonnement » annonçait la facture de la période SUIVANTE pendant que celle de la
-- période qui court n'était pas faite : « 960 DT pour 8 dossiers, à régler avant le 08/12/2027 » (les huit dossiers
-- comptés deux fois, en rattrapage et en période) quand la fenêtre du collage disait 8 × 60 = 480 DT. La facture à
-- venir est maintenant celle que le facturier fera (cabinets_a_facturer, 0220) : la période qui court tant qu'elle
-- n'est pas émise ; la suivante une fois celle-ci faite.

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
  -- (1.390.5) La facture à venir est celle de la période qui court tant qu'elle n'est pas faite (« Ta facture se
  -- prépare ») ; la suivante seulement une fois celle-ci émise.
  if v_a.cabinet is not null then
    v_prochain := plateforme.periode_cabinet(p_cabinet, p_jour);
    if v_prochain is not null and exists (select 1 from plateforme.facture_cabinet f where f.cabinet = p_cabinet and f.debut = v_prochain) then
      v_prochain := (v_prochain + interval '1 year')::date;
    end if;
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
