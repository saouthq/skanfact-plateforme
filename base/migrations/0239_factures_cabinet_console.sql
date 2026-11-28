-- 0239 — Une facture d'abonnement d'un cabinet est une de nos factures (1.389.1 ; l'issue #29, CONS3-2).
--
-- La facture annuelle d'un cabinet (0172, plateforme.facture_cabinet) est émise par l'entreprise SkanFact comme celle
-- d'un abonné : elle compte dans « Nos factures », dans « À encaisser », dans l'encaissé du mois et dans ce qui attend
-- d'être émis. Les deux lectures de la console ne lisaient que les factures des entreprises abonnées : celle d'un
-- cabinet n'existait nulle part dans la console, payée ou pas. Une seule liste des factures d'abonnement, pour les deux
-- lectures — et le cabinet le dit (`cabinet`), pour que l'écran mène à sa fiche et non à celle d'un client.

create function plateforme.nos_factures_d_abonnement()
  returns table (editeur uuid, piece_v10 text, qui uuid, nom text, cabinet boolean, offre text, periodicite text,
                 debut date, fin date, prepare_le timestamptz, montant_ht bigint, payee_le timestamptz)
language sql stable security definer set search_path = pg_catalog, socle, plateforme as $$
  select f.editeur, f.piece_v10, e.id, e.raison_sociale, false, f.offre, f.periodicite, f.debut, f.fin, f.prepare_le, f.montant_ht, f.payee_le
    from plateforme.facture_abonnement f join socle.entreprise e on e.id = f.entreprise
  union all
  select c.editeur, c.piece_v10, o.id, o.nom, true, null, null, c.debut, c.fin, c.prepare_le, c.montant_ht, c.payee_le
    from plateforme.facture_cabinet c join socle.organisation o on o.id = c.cabinet
$$;
revoke execute on function plateforme.nos_factures_d_abonnement() from public;

-- Nos factures du mois (la fonction de 0109, la liste des deux sortes de factures).
create or replace function plateforme.console_nos_factures(p_mois date) returns jsonb
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
    -- L'entreprise SkanFact, et si sa fiche la dit soumise à la facture électronique : sans cela, une pièce dont la
    -- fiche ne permet pas le fichier s'émet sans lui (serveur/v10/dossier.ts), et l'écran dit où le régler.
    'editeur', (select jsonb_build_object('entreprise', e.id, 'raisonSociale', e.raison_sociale, 'devise', e.devise_base,
                  'decimales', (select dv.decimales from socle.devise dv where dv.code = e.devise_base),
                  'soumise', coalesce((select c.contenu -> 'efacture' = 'true'::jsonb from socle.dossier_v10 c
                                        where c.entreprise = e.id and c.collection = '_racine' and c.cle = 'company'), false))
                  from socle.entreprise e where e.id = v_editeur),
    -- Les pièces émises du mois, la plus récente d'abord : une facture d'abonnement, ou un avoir qui en corrige une.
    'pieces', (select coalesce(jsonb_agg(x.v order by x.date_piece desc, x.emise_le desc), '[]'::jsonb) from (
                 select p.date_piece, p.emise_le, jsonb_build_object(
                   'type', p.type, 'numero', p.numero_texte, 'date', p.date_piece, 'echeance', p.echeance,
                   'piece', p.ref_v10, 'editeur', p.entreprise, 'devise', p.devise, 'decimales', dv.decimales, 'net', p.net_a_payer::text,
                   'entreprise', jsonb_build_object('id', f.qui, 'nom', f.nom, 'cabinet', f.cabinet),
                   'offre', f.offre, 'periodicite', f.periodicite, 'debut', f.debut, 'fin', f.fin,
                   -- L'avoir : la facture qu'il corrige (son numéro, sa pièce).
                   'corrige', case when p.type = 'avoir' then jsonb_build_object('numero', fp.numero_texte, 'piece', fp.ref_v10) end,
                   'avoirs', case when p.type = 'facture' then (select coalesce(jsonb_agg(a.net_a_payer::text), '[]'::jsonb) from ventes.piece a
                               where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise') else '[]'::jsonb end,
                   'reglements', case when p.type = 'facture' then (select coalesce(jsonb_agg(r.montant::text), '[]'::jsonb) from ventes.reglement r
                                   where r.entreprise = p.entreprise and r.piece = p.id) else '[]'::jsonb end,
                   -- Ce qui la suit hors du dossier : le fichier écrit, la signature posée, le dépôt et ce que la TTN en a dit.
                   'efacture', exists (select 1 from ventes.efacture ef where ef.piece = p.id),
                   'signee', exists (select 1 from ventes.efacture_signee s where s.piece = p.id),
                   'ttn', (select jsonb_build_object('statut', t.statut, 'motif', t.motif, 'deposeLe', t.depose_le, 'accepteLe', t.accepte_le,
                             'reference', t.reference, 'essais', t.essais) from ventes.envoi_ttn t where t.piece = p.id)) v
                   from ventes.piece p
                   left join ventes.piece fp on p.type = 'avoir' and fp.id = p.corrige
                   join plateforme.nos_factures_d_abonnement() f
                     on f.editeur = p.entreprise and f.piece_v10 = case when p.type = 'facture' then p.ref_v10 else fp.ref_v10 end
                   left join socle.devise dv on dv.code = p.devise
                  where p.entreprise = v_editeur and p.statut = 'emise' and p.type in ('facture', 'avoir')
                    and (p.type = 'facture' or fp.type = 'facture')
                    and p.date_piece between v_debut and v_fin) x)
  );
end $$;


-- Les paiements de nos factures (la fonction de 0137, la même liste).
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
                  'entreprise', jsonb_build_object('id', f.qui, 'nom', f.nom, 'cabinet', f.cabinet), 'noteLe', r.cree_le,
                  'enLigne', (select jsonb_build_object('prestataire', l.prestataire, 'prouveLe', l.prouve_le)
                                from ventes.paiement_en_ligne l
                               where l.entreprise = r.entreprise and l.statut = 'encaisse' and l.reglement_v10 = r.ref_v10))
                  order by r.date_reglement desc, r.cree_le desc, r.id desc), '[]'::jsonb)
                from plateforme.nos_factures_d_abonnement() f
                join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
                join ventes.reglement r on r.entreprise = p.entreprise and r.piece = p.id
                left join socle.devise dv on dv.code = p.devise
               where f.editeur = v_editeur and r.date_reglement between v_debut and v_fin),
    -- Les factures émises dont le solde n'est pas nul aujourd'hui (net − avoirs − règlements ≠ 0) : qui doit, qui a trop
    -- payé. Tout mois confondu : une dette ne s'arrête pas à la fin du mois.
    'ouvertes', (select coalesce(jsonb_agg(x.v order by x.echeance nulls last, x.numero), '[]'::jsonb) from (
                  select p.echeance, p.numero_texte numero, jsonb_build_object(
                    'piece', f.piece_v10, 'editeur', f.editeur, 'numero', p.numero_texte, 'echeance', p.echeance,
                    'debut', f.debut, 'fin', f.fin, 'devise', p.devise, 'decimales', dv.decimales, 'net', p.net_a_payer::text, 'timbre', coalesce(p.timbre, 0)::text,
                    'entreprise', jsonb_build_object('id', f.qui, 'nom', f.nom, 'cabinet', f.cabinet),
                    'avoirs', (select coalesce(jsonb_agg(a.net_a_payer::text), '[]'::jsonb) from ventes.piece a
                                where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise'),
                    'reglements', (select coalesce(jsonb_agg(r.montant::text), '[]'::jsonb) from ventes.reglement r
                                    where r.entreprise = p.entreprise and r.piece = p.id)) v
                    from plateforme.nos_factures_d_abonnement() f
                    join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
                    left join socle.devise dv on dv.code = p.devise
                   where f.editeur = v_editeur
                     and p.net_a_payer
                         - (select coalesce(sum(a.net_a_payer), 0) from ventes.piece a where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise')
                         - (select coalesce(sum(r.montant), 0) from ventes.reglement r where r.entreprise = p.entreprise and r.piece = p.id) <> 0) x),
    -- Les factures préparées qui attendent d'être émises dans l'application de SkanFact : elles ne doivent rien encore.
    'aEmettre', (select coalesce(jsonb_agg(jsonb_build_object('piece', f.piece_v10, 'editeur', f.editeur, 'debut', f.debut, 'fin', f.fin,
                    'prepareLe', f.prepare_le, 'entreprise', jsonb_build_object('id', f.qui, 'nom', f.nom, 'cabinet', f.cabinet),
                    'montantHt', f.montant_ht::text)
                    order by f.prepare_le), '[]'::jsonb)
                  from plateforme.nos_factures_d_abonnement() f
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
                    'payeeLe', f.payee_le, 'debut', f.debut, 'fin', f.fin, 'entreprise', jsonb_build_object('id', f.qui, 'nom', f.nom, 'cabinet', f.cabinet),
                    'cause', case when s.avoirs > 0 and s.avoirs >= p.net_a_payer - coalesce(p.timbre, 0) then 'avoir' else 'reglement' end)
                    order by f.payee_le), '[]'::jsonb)
                  from plateforme.nos_factures_d_abonnement() f
                  join ventes.piece p on p.entreprise = f.editeur and p.ref_v10 = f.piece_v10 and p.type = 'facture' and p.statut = 'emise'
                  cross join lateral (select
                    (select coalesce(sum(a.net_a_payer), 0) from ventes.piece a where a.entreprise = p.entreprise and a.corrige = p.id and a.statut = 'emise') avoirs,
                    (select coalesce(sum(r.montant), 0) from ventes.reglement r where r.entreprise = p.entreprise and r.piece = p.id) regle) s
                 where f.editeur = v_editeur and f.payee_le is not null
                   and ((s.avoirs > 0 and s.avoirs >= p.net_a_payer - coalesce(p.timbre, 0)) or p.net_a_payer - s.avoirs - s.regle > 0))
  );
end
$$;
