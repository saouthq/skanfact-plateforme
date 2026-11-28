-- 0242 — « Nos factures » dit qu'une facture payée est défaite par son avoir (1.389.5 ; l'issue #29, CONS3-5).
--
-- Une facture que ses avoirs annulent, le timbre mis à part (un avoir ne le reprend pas toujours : À VÉRIFIER avec le
-- comptable), et que le client avait réglée : Paiements et « À décider » la disent « défaite » avec ce qui est à rendre ;
-- Nos factures disait seulement « Payée ». La pièce porte désormais son timbre, pour que la console applique la même
-- règle (serveur/console/paiements.ts, annuleeParSesAvoirs). La fonction de 0239, avec le timbre.

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
                   'timbre', coalesce(p.timbre, 0)::text,
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
