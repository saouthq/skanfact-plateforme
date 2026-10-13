-- La console de SkanFact, deuxième partie (Console 2, 13/10/2026 ; skanfact docs/cadrage/10-console.md § 2.3, 2.4 ;
-- docs/console.md) : les cabinets, et ce qui accompagne les échéances des abonnements.
--
-- 1. Les cabinets : un cabinet est une organisation ; ses dossiers sont les entreprises qu'il tient lui-même (dossiers
--    tenus) et celles de ses clients qui lui ont donné un mandat (clients abonnés), ou le lui proposent. La liste fermée
--    (10 § 4) : son nom, ses collaborateurs (nom, adresse, rôles, dernière connexion), et de chaque dossier son
--    identifiant et son mandat. Le reste d'un dossier (son nom, son abonnement, son état) se lit dans la MÊME liste que
--    les clients (plateforme.console_entreprises) : la fiche d'un cabinet et la liste des clients disent la même chose
--    d'une entreprise (C3), et jamais le contenu d'un dossier.
-- 2. Les échéances : l'état de chaque abonnement se déduit au serveur (serveur/abonnement/etat.ts), sur la liste des
--    clients. Ici, seulement ce qui l'accompagne : les relances parties pour l'échéance d'AUJOURD'HUI de chaque
--    entreprise (celles d'une échéance passée, avant une prolongation ou un paiement, ne comptent plus), et le dernier
--    événement de chaque sorte qu'un écran raconte (une prolongation d'essai, un abonnement offert, une suspension), avec
--    son motif et son auteur.

-- ── 1. Les cabinets ──────────────────────────────────────────────────────────────────────────────────────────────────
create function plateforme.console_cabinets() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'nom', o.nom, 'creeLe', (o.cree_le at time zone 'Africa/Tunis')::date,
      'collaborateurs', (select coalesce(jsonb_agg(jsonb_build_object('nom', u.nom, 'email', u.email, 'roles', m.roles, 'depuis', m.depuis,
                            'derniereConnexion', (select max(s.derniere_activite) from socle.session s where s.utilisateur = u.id))
                            order by ('supervision' = any(m.roles)) desc, u.nom, u.id), '[]'::jsonb)
                           from socle.membre m join socle.utilisateur u on u.id = m.utilisateur
                          where m.organisation = o.id and m.actif),
      -- Les dossiers tenus portent aussi le mandat que leur création a posé ; un client, celui qu'il a donné ou proposé.
      -- Un mandat terminé n'en fait plus un dossier du cabinet. Jamais une entreprise d'exemple.
      'dossiers', (select coalesce(jsonb_agg(jsonb_build_object('entreprise', e.id, 'tenu', e.tenue_par = o.id,
                       'mandat', (select jsonb_build_object('statut', d.statut, 'debut', d.debut) from socle.mandat d
                                   where d.cabinet = o.id and d.entreprise = e.id and d.statut in ('propose', 'actif')
                                   order by d.statut = 'actif' desc, d.cree_le desc, d.id desc limit 1))
                       order by e.raison_sociale, e.id), '[]'::jsonb)
                     from socle.entreprise e
                    where not e.essai
                      and (e.tenue_par = o.id
                           or exists (select 1 from socle.mandat d where d.cabinet = o.id and d.entreprise = e.id and d.statut in ('propose', 'actif'))))
    ) order by o.cree_le desc, o.id), '[]'::jsonb)
    from socle.organisation o where o.type = 'cabinet');
end $$;

-- ── 2. Ce qui accompagne les échéances ───────────────────────────────────────────────────────────────────────────────
create function plateforme.console_echeances() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, socle, plateforme as $$
begin
  perform plateforme.exiger_role_console(array['direction', 'support']);
  return jsonb_build_object(
    -- Pour chaque entreprise, les relances de son échéance d'aujourd'hui (la même que serveur/abonnement/etat.ts,
    -- `echeanceDe` : la fin de l'essai, ou celle de la période payée si elle va plus loin), rang par rang, avec l'instant
    -- du départ.
    'relances', (select coalesce(jsonb_agg(jsonb_build_object('entreprise', x.entreprise, 'echeance', x.echeance, 'rangs', x.rangs)), '[]'::jsonb)
                   from (select r.entreprise, r.echeance, jsonb_object_agg(r.rang, r.partie_le) rangs
                           from plateforme.relance_abonnement r
                           join plateforme.abonnement a on a.entreprise = r.entreprise
                           join socle.entreprise e on e.id = r.entreprise and not e.essai
                          where r.echeance = greatest(a.essai_jusqu_au, coalesce(a.paye_jusqu_au, a.essai_jusqu_au))
                          group by r.entreprise, r.echeance) x),
    -- Le dernier événement de chaque sorte racontée, par entreprise : son motif (une note de SkanFact, que l'entreprise
    -- ne voit jamais) et son auteur dans l'équipe (aucun : l'outil de l'exploitation, ou le serveur lui-même).
    'evenements', (select coalesce(jsonb_agg(jsonb_build_object('entreprise', v.entreprise, 'nature', v.nature, 'le', v.le, 'motif', v.motif,
                       'jours', v.apres->'jours',
                       'qui', (select jsonb_build_object('nom', u.nom, 'role', g.role) from plateforme.geste_console g
                                 join socle.utilisateur u on u.id = g.qui where g.evenement = v.id))), '[]'::jsonb)
                     from (select distinct on (v.entreprise, v.nature) v.* from plateforme.evenement_abonnement v
                             join socle.entreprise e on e.id = v.entreprise and not e.essai
                            where v.nature in ('essai_prolonge', 'offert', 'suspendu')
                            order by v.entreprise, v.nature, v.le desc, v.id desc) v));
end $$;

-- Par le serveur seulement.
revoke execute on function plateforme.console_cabinets(), plateforme.console_echeances() from public;
grant execute on function plateforme.console_cabinets(), plateforme.console_echeances() to skanfact_app;
