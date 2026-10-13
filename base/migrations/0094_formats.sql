-- 0094 — Les formats officiels, vus de la console (Réglages ; docs/console.md C28). Ce que la plateforme a vraiment fait
-- des fichiers que l'administration attend : les entreprises soumises à la facture électronique, les fichiers TEIF écrits
-- à l'émission, les pièces signées, et où en est leur envoi à la TTN. Des COMPTES, toutes entreprises mêlées : jamais une
-- pièce, un nom ni un montant. Les entreprises d'exemple (le bac à sable) n'y comptent pas, comme dans la liste des
-- clients (0083). La lecture est à la direction et au support : le support répond à un client dont la pièce est
-- refusée ou retenue.

create function plateforme.console_formats() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, ventes, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return jsonb_build_object(
    -- Soumises : la case « Mon entreprise est soumise à la facture électronique » de leur fiche (brique 80).
    'soumises', (select count(*) from socle.dossier_v10 d join socle.entreprise e on e.id = d.entreprise
                  where not e.essai and d.collection = '_racine' and d.cle = 'company' and d.contenu->'efacture' = 'true'::jsonb),
    -- Les fichiers TEIF écrits à l'émission, chez combien d'entreprises, le dernier, et la version de chacun.
    'fichiers', (select jsonb_build_object('n', count(*), 'entreprises', count(distinct f.entreprise), 'dernier', max(f.ecrit_le))
                   from ventes.efacture f join socle.entreprise e on e.id = f.entreprise where not e.essai),
    'versions', (select coalesce(jsonb_agg(jsonb_build_object('version', v.version, 'n', v.n) order by v.version desc), '[]'::jsonb)
                   from (select f.version, count(*) n from ventes.efacture f join socle.entreprise e on e.id = f.entreprise
                          where not e.essai group by f.version) v),
    -- Écrits et pas encore signés ; signés (et le dernier).
    'aSigner', (select count(*) from ventes.efacture f join socle.entreprise e on e.id = f.entreprise
                 where not e.essai and not exists (select 1 from ventes.efacture_signee s where s.piece = f.piece)),
    'signees', (select jsonb_build_object('n', count(*), 'dernier', max(s.signe_le))
                  from ventes.efacture_signee s join socle.entreprise e on e.id = s.entreprise where not e.essai),
    -- L'envoi à la TTN, comme la liste des factures le dit à l'entreprise (brique 139) : signée sans envoi, en route,
    -- retenue (un compte absent ou refusé, une panne : la pièce attend avec son motif), déposée, acceptée, refusée.
    'ttn', (select jsonb_build_object(
              'sansEnvoi', (select count(*) from ventes.efacture_signee s join socle.entreprise x on x.id = s.entreprise
                             where not x.essai and not exists (select 1 from ventes.envoi_ttn t where t.piece = s.piece)),
              'enRoute', count(*) filter (where t.statut = 'a_envoyer' and t.motif is null),
              'retenues', count(*) filter (where t.statut = 'a_envoyer' and t.motif is not null),
              'deposees', count(*) filter (where t.statut = 'deposee'),
              'acceptees', count(*) filter (where t.statut = 'acceptee'),
              'refusees', count(*) filter (where t.statut = 'refusee'),
              'derniereAcceptee', max(t.accepte_le))
            from ventes.envoi_ttn t join socle.entreprise e on e.id = t.entreprise where not e.essai)
  );
end $$;

revoke execute on function plateforme.console_formats() from public;
grant execute on function plateforme.console_formats() to skanfact_app;
