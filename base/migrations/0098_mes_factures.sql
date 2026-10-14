-- Nos factures, seconde partie (14b, 14/10/2026 ; docs/abonnement.md B5 ; skanfact docs/cadrage/10-console.md § 2.5–2.6,
-- 14 § 2.2) : l'abonné voit, dans « Ton abonnement », les factures que l'entreprise SkanFact lui a émises, chacune telle
-- qu'elle s'imprime, et règle en ligne celle qui doit encore, par le prestataire de l'entreprise SkanFact (brique 78 : la
-- preuve se redemande au prestataire ; prouvé, le règlement s'ajoute à la facture, et la facture réglée paie
-- l'abonnement, B4).
--
-- Sans lien secret : c'est une personne, dans SON entreprise, qui lit et qui paie — le propriétaire ou un administrateur
-- (les gestes socle.abonnement.voir et socle.abonnement.payer), jamais une clé de l'API. Qui quitte l'entreprise ne lit
-- plus rien. La base choisit ce qui se lit : les factures ÉMISES de CET abonné (jamais un brouillon : une facture préparée
-- attend encore sa relecture ; jamais un autre abonné) et les avoirs émis qui les corrigent ; le serveur réduit ensuite
-- aux listes fermées de l'espace client (ce qu'une pièce imprime, serveur/ventes/espace.ts).
--
-- La règle « une demande identique encore ouverte se redonne » (0047) vit désormais en un seul endroit,
-- ventes.paiement_noter : l'espace client et l'abonné la partagent.

-- ── Qui ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
create function plateforme.mes_factures_exiger(p_entreprise uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, socle as $$
begin
  if socle.moi() is null or socle.ma_cle() is not null or not (socle.mes_roles(p_entreprise) && array['proprietaire', 'administrateur']::text[]) then
    perform socle.refus('les factures de l''abonnement se lisent et se règlent par le propriétaire ou un administrateur de l''entreprise');
  end if;
end $$;

-- ── Ce qui se lit ────────────────────────────────────────────────────────────────────────────────────────────────────
-- Les pièces : chaque facture émise de l'abonnement (la période qu'elle paie, son offre), et les avoirs émis qui la
-- corrigent ; la plus récente d'abord. Les montants en entiers, en texte : le reste et l'état se calculent au serveur, par
-- les fonctions de toutes les factures (la règle de l'espace client et de la console).
create function plateforme.mes_pieces_abonnement(p_entreprise uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
  select coalesce(jsonb_agg(x.j order by x.le desc, x.id desc), '[]'::jsonb) from (
    select p.id, p.date_piece le, jsonb_build_object(
        'id', p.id, 'editeur', f.editeur, 'type', p.type, 'numero', p.numero_texte, 'date', p.date_piece, 'echeance', p.echeance,
        'devise', p.devise, 'decimales', dv.decimales, 'net', p.net_a_payer::text,
        'avoirs', (select coalesce(jsonb_agg(a.net_a_payer::text), '[]') from ventes.piece a
                    where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise'),
        'reglements', (select coalesce(jsonb_agg(r.montant::text), '[]') from ventes.reglement r
                        where r.entreprise = p.entreprise and r.piece = p.id),
        'periode', jsonb_build_object('debut', f.debut, 'fin', f.fin, 'offre', f.offre, 'periodicite', f.periodicite),
        'document', d.contenu) j
      from plateforme.facture_abonnement f
      join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
      join socle.devise dv on dv.code = p.devise
      join socle.dossier_v10 d on d.entreprise = p.entreprise and d.collection = 'documents' and d.cle = p.ref_v10
     where f.entreprise = p_entreprise
    union all
    select a.id, a.date_piece, jsonb_build_object(
        'id', a.id, 'editeur', f.editeur, 'type', a.type, 'numero', a.numero_texte, 'date', a.date_piece, 'echeance', a.echeance,
        'devise', a.devise, 'decimales', dv.decimales, 'net', a.net_a_payer::text, 'avoirs', '[]'::jsonb, 'reglements', '[]'::jsonb,
        'periode', jsonb_build_object('debut', f.debut, 'fin', f.fin, 'offre', f.offre, 'periodicite', f.periodicite),
        'document', d.contenu)
      from plateforme.facture_abonnement f
      join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
      join ventes.piece a on a.entreprise = p.entreprise and a.corrige = p.id and a.type = 'avoir' and a.statut = 'emise'
      join socle.devise dv on dv.code = a.devise
      join socle.dossier_v10 d on d.entreprise = a.entreprise and d.collection = 'documents' and d.cle = a.ref_v10
     where f.entreprise = p_entreprise
  ) x
$$;

-- Ce que « Ton abonnement » lit : les pièces, et si une facture de SkanFact se règle en ligne (l'entreprise SkanFact a
-- branché son prestataire) ; et, s'il y a des pièces, la fiche société de l'entreprise SkanFact et la fiche du client
-- telles que la facture les imprime.
create function plateforme.mes_factures_abonnement(p_entreprise uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  v_pieces jsonb;
  v_f plateforme.facture_abonnement;
begin
  perform plateforme.mes_factures_exiger(p_entreprise);
  v_pieces := plateforme.mes_pieces_abonnement(p_entreprise);
  if jsonb_array_length(v_pieces) = 0 then
    return jsonb_build_object('pieces', v_pieces,
      'paiement', exists (select 1 from plateforme.editeur e join ventes.prestataire pr on pr.entreprise = e.entreprise));
  end if;
  -- La facture émise la plus récente dit l'entreprise SkanFact et la fiche du client (une seule par abonné, reprise).
  select f.* into v_f from plateforme.facture_abonnement f
   where f.entreprise = p_entreprise
     and exists (select 1 from ventes.piece p where p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise')
   order by f.debut desc, f.prepare_le desc limit 1;
  return jsonb_build_object(
    'entreprise', (select d.contenu from socle.dossier_v10 d where d.entreprise = v_f.editeur and d.collection = '_racine' and d.cle = 'company'),
    'client', (select d.contenu from socle.dossier_v10 d where d.entreprise = v_f.editeur and d.collection = 'clients' and d.cle = v_f.client_v10),
    'paiement', exists (select 1 from ventes.prestataire pr where pr.entreprise = v_f.editeur),
    'pieces', v_pieces);
end $$;

-- ── Régler en ligne ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Ce qu'il faut pour calculer le reste d'UNE facture de l'abonnement (la forme de ventes.espace_a_payer).
create function plateforme.ma_facture_a_payer(p_entreprise uuid, p_numero text) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare
  p jsonb;
  v_portefeuille text;
  v_cle text;
begin
  perform plateforme.mes_factures_exiger(p_entreprise);
  select x into p from jsonb_array_elements(plateforme.mes_pieces_abonnement(p_entreprise)) x
   where x ->> 'type' = 'facture' and x ->> 'numero' = p_numero;
  if p is null then return null; end if;
  select portefeuille, cle_scellee into v_portefeuille, v_cle from ventes.prestataire where entreprise = (p ->> 'editeur')::uuid;
  return jsonb_build_object('entreprise', p ->> 'editeur', 'piece', p - 'document',
    'prestataire', case when v_portefeuille is null then null else jsonb_build_object('portefeuille', v_portefeuille, 'cle_scellee', v_cle) end);
end $$;

-- La demande, notée AVANT d'aller chez le prestataire (sa commande porte notre identifiant). Une demande identique encore
-- ouverte (même facture, même montant, moins de 25 minutes : le prestataire garde son adresse 30 minutes) est rendue
-- telle quelle : deux clics ne font pas deux paiements. `p_a` : ce que rend ventes.espace_a_payer ou
-- plateforme.ma_facture_a_payer (qui ont vérifié qui demande).
create function ventes.paiement_noter(p_a jsonb, p_montant bigint, p_retour_empreinte text, p_maintenant timestamptz) returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, ventes as $$
declare
  v_entreprise uuid := (p_a ->> 'entreprise')::uuid;
  v_piece uuid := (p_a -> 'piece' ->> 'id')::uuid;
  v_ouvert uuid;
  v_adresse text;
  v_id uuid;
begin
  select x.id, x.adresse into v_ouvert, v_adresse from ventes.paiement_en_ligne x
   where x.entreprise = v_entreprise and x.piece = v_piece and x.statut = 'initie' and x.montant = p_montant
     and x.adresse is not null and x.cree_le > p_maintenant - interval '25 minutes'
   order by x.cree_le desc limit 1;
  if v_ouvert is not null then return jsonb_build_object('id', v_ouvert, 'adresse', v_adresse); end if;
  insert into ventes.paiement_en_ligne (entreprise, piece, prestataire, montant, devise, retour_empreinte, cree_le)
  values (v_entreprise, v_piece, 'konnect', p_montant, p_a -> 'piece' ->> 'devise', p_retour_empreinte, p_maintenant)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'entreprise', v_entreprise, 'devise', p_a -> 'piece' ->> 'devise',
    'portefeuille', p_a -> 'prestataire' ->> 'portefeuille', 'cle_scellee', p_a -> 'prestataire' ->> 'cle_scellee');
end $$;

-- L'espace client passe par elle (le même comportement que 0047).
create or replace function ventes.paiement_demander(p_jeton_empreinte text, p_numero text, p_montant bigint, p_retour_empreinte text, p_maintenant timestamptz)
returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, ventes as $$
declare a jsonb;
begin
  a := ventes.espace_a_payer(p_jeton_empreinte, p_numero);
  if a is null then return null; end if;
  return ventes.paiement_noter(a, p_montant, p_retour_empreinte, p_maintenant);
end $$;

-- L'abonné, depuis « Ton abonnement ».
create function plateforme.mon_paiement_demander(p_entreprise uuid, p_numero text, p_montant bigint, p_retour_empreinte text, p_maintenant timestamptz)
returns jsonb
language plpgsql volatile security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
declare a jsonb;
begin
  a := plateforme.ma_facture_a_payer(p_entreprise, p_numero);
  if a is null then return null; end if;
  return ventes.paiement_noter(a, p_montant, p_retour_empreinte, p_maintenant);
end $$;

revoke execute on function plateforme.mes_factures_exiger(uuid), plateforme.mes_pieces_abonnement(uuid), plateforme.mes_factures_abonnement(uuid),
  plateforme.ma_facture_a_payer(uuid, text), ventes.paiement_noter(jsonb, bigint, text, timestamptz),
  plateforme.mon_paiement_demander(uuid, text, bigint, text, timestamptz) from public;
-- Les fonctions qui vérifient qui demande, seules : jamais celles qui lisent ou notent sans le vérifier.
grant execute on function plateforme.mes_factures_abonnement(uuid), plateforme.ma_facture_a_payer(uuid, text),
  plateforme.mon_paiement_demander(uuid, text, bigint, text, timestamptz) to skanfact_app;
