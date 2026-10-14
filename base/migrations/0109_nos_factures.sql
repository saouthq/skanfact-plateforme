-- Nos factures, l'écran de la console (docs/console.md C31 ; skanfact docs/cadrage/10-console.md § 2.5 ; la maquette
-- « Nos factures ») : les factures d'abonnement que l'entreprise SkanFact a émises dans un mois, et les avoirs qui les
-- corrigent, chacune avec ce qui la suit hors du dossier — son fichier de facture électronique (0049), sa signature
-- (0050), son dépôt à la TTN (0051 : acceptée, refusée et pourquoi) — et de quoi dire son paiement (le net, ses avoirs,
-- ses règlements : le solde se calcule au serveur, par la règle de toutes les factures). La console les montre ; elle
-- ne les refait pas (§ 2.5) : chaque ligne s'ouvre dans l'application de SkanFact.

-- La direction seule, comme les paiements (0108) : ce sont les comptes de SkanFact.
create function plateforme.console_nos_factures(p_mois date) returns jsonb
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
                   'entreprise', jsonb_build_object('id', e.id, 'nom', e.raison_sociale),
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
                   join plateforme.facture_abonnement f
                     on f.editeur = p.entreprise and f.piece_v10 = case when p.type = 'facture' then p.ref_v10 else fp.ref_v10 end
                   join socle.entreprise e on e.id = f.entreprise
                   left join socle.devise dv on dv.code = p.devise
                  where p.entreprise = v_editeur and p.statut = 'emise' and p.type in ('facture', 'avoir')
                    and (p.type = 'facture' or fp.type = 'facture')
                    and p.date_piece between v_debut and v_fin) x)
  );
end $$;

revoke execute on function plateforme.console_nos_factures(date) from public;
grant execute on function plateforme.console_nos_factures(date) to skanfact_app;
